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

  const split = (dir: Dir, leafId: string): void => {
    const { root: next, newLeafId } = splitLeaf(root, leafId, dir);
    root = next;
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
    if (detail.cmd === 'split-right') split('row', target);
    else if (detail.cmd === 'split-down') split('column', target);
    else if (detail.cmd === 'kill') kill(target);
    else if (detail.cmd === 'config') {
      const paneIdPromise = layout.paneIdOf(target);
      if (paneIdPromise) void paneIdPromise.then((paneId) => openConfigEditor(paneId));
    }
  });

  window.addEventListener('open-settings', () => void openSettingsEditor());
  // Native menu (Cmd+,) routes here — the reliable path on macOS.
  window.cerberusUI.onOpenSettings(() => void openSettingsEditor());

  // External driver (POST /pane) -> open a read-only follower pane tailing a log.
  const shellQuote = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;
  window.cerberusUI.onOpenPane(({ file, title, cwd }) => {
    const { root: next, newLeafId } = splitLeaf(root, focusedLeafId, 'row');
    root = next;
    layout.setPaneSpec(newLeafId, {
      ...(cwd ? { cwd } : {}),
      title: title || `tail:${file.split('/').pop() ?? file}`,
      initialCommand: `tail -f ${shellQuote(file)}\r`,
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
      split(dir === 'down' ? 'column' : 'row', focusedLeafId);
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
