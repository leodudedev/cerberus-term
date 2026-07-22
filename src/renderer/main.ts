import { Layout } from './Layout.js';
import { openConfigEditor } from './ConfigEditor.js';
import { openSettingsEditor } from './SettingsEditor.js';
import {
  newLeaf,
  splitLeaf,
  killLeaf,
  firstLeaf,
  leaves,
  setRatio,
  resizeNearest,
  type Dir,
  type PaneNode
} from './pane-tree.js';
import { installKeymap, type CerberusAction } from './keymap.js';
import { loadLayout, saveLayout } from './persistence.js';
import { applyPref, getPref, toggleTheme } from './themes.js';
import { toggleFavorite } from './favorites.js';
import { openFavoritesOverlay } from './FavoritesOverlay.js';

const shellQuote = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;

// Theme first so the very first paint (and xterm) uses the right palette.
applyPref(getPref());

const container = document.querySelector<HTMLDivElement>('#app');

if (container) {
  container.style.cssText = 'width:100vw;height:100vh;background:var(--bg)';

  // Restore the saved layout + cwds, or start with one pane.
  const saved = loadLayout();
  const savedCwds = saved?.cwds ?? {};
  let root: PaneNode = saved?.tree ?? newLeaf();
  let focusedLeafId = firstLeaf(root).id;

  const layout = new Layout(
    container,
    (id) => {
      focusedLeafId = id;
    },
    // commit a drag into the model; DOM already reflects it, so no re-render
    (splitId, ratio) => {
      root = setRatio(root, splitId, ratio);
      schedulePersist();
    },
    (leafId) => savedCwds[leafId]
  );

  // Debounced persist (tree + a fresh cwd snapshot, which also refreshes titles).
  let persistTimer: number | undefined;
  const schedulePersist = (): void => {
    if (persistTimer !== undefined) window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      void layout.snapshotCwds().then((cwds) => saveLayout(root, cwds));
    }, 800);
  };

  const rerender = (nextFocus: string): void => {
    layout.render(root);
    focusedLeafId = nextFocus;
    layout.focusLeaf(nextFocus);
    schedulePersist();
  };

  const split = async (dir: Dir, leafId: string): Promise<void> => {
    // Inherit the source pane's live cwd so the new pane opens in the same dir.
    let cwd: string | undefined;
    try {
      const srcPaneId = await layout.paneIdOf(leafId);
      if (srcPaneId) cwd = await window.cerberus.cwd(srcPaneId);
    } catch {
      /* source pane gone — fall back to default cwd */
    }
    const { root: next, newLeafId } = splitLeaf(root, leafId, dir);
    root = next;
    if (cwd) layout.setPaneSpec(newLeafId, { cwd });
    rerender(newLeafId);
  };

  const kill = (leafId: string): void => {
    const next = killLeaf(root, leafId);
    // Killing the last pane would empty the workspace; respawn a fresh one so
    // the app stays usable.
    root = next ?? newLeaf();
    // Preserve focus if the focused pane still exists (button-killing a
    // background pane); otherwise fall back to the first leaf.
    const stillFocused = leaves(root).some((l) => l.id === focusedLeafId);
    rerender(stillFocused ? focusedLeafId : firstLeaf(root).id);
  };

  window.addEventListener('pane-cmd', (ev) => {
    const detail = (ev as CustomEvent<{ cmd: string; leafId?: string }>).detail;
    const target = detail.leafId ?? focusedLeafId;
    if (detail.cmd === 'split-right') void split('row', target);
    else if (detail.cmd === 'split-down') void split('column', target);
    else if (detail.cmd === 'kill') kill(target);
    else if (detail.cmd === 'config') {
      const paneIdPromise = layout.paneIdOf(target);
      if (paneIdPromise) void paneIdPromise.then((paneId) => openConfigEditor(paneId));
    } else if (detail.cmd === 'toggle-favorite') {
      const paneIdPromise = layout.paneIdOf(target);
      if (paneIdPromise) {
        void paneIdPromise
          .then((paneId) => window.cerberus.cwd(paneId))
          .then((cwd) => {
            toggleFavorite(cwd);
            // Re-sync every pane's star immediately rather than waiting for the
            // next periodic snapshot (also used for title/persistence refresh).
            void layout.snapshotCwds();
          });
      }
    } else if (detail.cmd === 'open-favorites') {
      const paneIdPromise = layout.paneIdOf(target);
      if (paneIdPromise) {
        void paneIdPromise.then((paneId) => {
          openFavoritesOverlay((path) => {
            window.cerberus.write(paneId, `cd ${shellQuote(path)}\r`);
          });
        });
      }
    }
  });

  window.addEventListener('open-settings', () => void openSettingsEditor());
  // Native menu (Cmd+,) routes here — the reliable path on macOS.
  window.cerberusUI.onOpenSettings(() => void openSettingsEditor());

  // External driver (POST /pane) -> open a read-only follower pane tailing a log.
  window.cerberusUI.onOpenPane(({ file, title, cwd, format, fmtPath }) => {
    // Auto-tile: split the largest pane along its longer side (grid-ish growth).
    const target = layout.pickTileTarget();
    const parentLeaf = target?.leafId ?? focusedLeafId;
    const dir: Dir = target?.dir ?? 'row';
    const { root: next, newLeafId } = splitLeaf(root, parentLeaf, dir);
    root = next;

    const q = shellQuote(file);
    // raw branch unchanged. claude-stream pipes tail through jq reading the
    // program from a shipped ASCII file (-f), so no non-ASCII jq program travels
    // through the pty; degrades to a raw tail if jq is missing.
    const initialCommand =
      format === 'claude-stream' && fmtPath
        ? `command -v jq >/dev/null 2>&1 && tail -f ${q} | jq -Rr --unbuffered -f ${shellQuote(fmtPath)} || tail -f ${q}\r`
        : `tail -f ${q}\r`;

    layout.setPaneSpec(newLeafId, {
      ...(cwd ? { cwd } : {}),
      title: title || `tail:${file.split('/').pop() ?? file}`,
      initialCommand,
      readOnly: true
    });
    rerender(focusedLeafId); // render the follower without stealing focus
  });

  // tmux-style keyboard control (leader Ctrl+B).
  const RESIZE_STEP = 0.04;
  installKeymap();
  window.addEventListener('cerberus-action', (ev) => {
    const { type, dir } = (ev as CustomEvent<CerberusAction>).detail;
    if (type === 'split') {
      void split(dir === 'down' ? 'column' : 'row', focusedLeafId);
    } else if (type === 'kill') {
      kill(focusedLeafId);
    } else if (type === 'focus' && dir) {
      const target = layout.leafInDirection(focusedLeafId, dir);
      if (target) {
        focusedLeafId = target;
        layout.focusLeaf(target);
      }
    } else if (type === 'resize' && dir) {
      const axis: Dir = dir === 'left' || dir === 'right' ? 'row' : 'column';
      const delta = dir === 'right' || dir === 'down' ? RESIZE_STEP : -RESIZE_STEP;
      root = resizeNearest(root, focusedLeafId, axis, delta);
      layout.render(root);
      layout.focusLeaf(focusedLeafId);
      schedulePersist();
    }
  });

  // Theme toggle (native menu View -> Toggle Theme).
  window.cerberusUI.onToggleTheme(() => toggleTheme());

  // Periodic snapshot: refresh cwds/titles and persist (catches `cd` without a
  // structural change).
  window.setInterval(() => {
    void layout.snapshotCwds().then((cwds) => saveLayout(root, cwds));
  }, 4000);

  layout.render(root);
  layout.focusLeaf(focusedLeafId);
}
