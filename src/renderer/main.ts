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

// Step 2: boot one pane, drive split/kill from temporary Cmd combos (dispatched
// as 'pane-cmd' window events by each terminal).
const container = document.querySelector<HTMLDivElement>('#app');

if (container) {
  container.style.cssText = 'width:100vw;height:100vh;background:#1a1a1a';

  let root: PaneNode = newLeaf();
  let focusedLeafId = root.id;

  const layout = new Layout(
    container,
    (id) => {
      focusedLeafId = id;
    },
    // commit a drag into the model; DOM already reflects it, so no re-render
    (splitId, ratio) => {
      root = setRatio(root, splitId, ratio);
    }
  );

  const rerender = (nextFocus: string): void => {
    layout.render(root);
    focusedLeafId = nextFocus;
    layout.focusLeaf(nextFocus);
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
    }
  });

  layout.render(root);
  layout.focusLeaf(focusedLeafId);
}
