import { Layout } from './Layout.js';
import {
  newLeaf,
  splitLeaf,
  killLeaf,
  firstLeaf,
  setRatio,
  type Dir,
  type PaneNode
} from './pane-tree.js';

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

  const split = (dir: Dir): void => {
    const { root: next, newLeafId } = splitLeaf(root, focusedLeafId, dir);
    root = next;
    rerender(newLeafId);
  };

  const kill = (): void => {
    const next = killLeaf(root, focusedLeafId);
    // Killing the last pane would empty the workspace; respawn a fresh one so
    // the app stays usable.
    root = next ?? newLeaf();
    rerender(firstLeaf(root).id);
  };

  window.addEventListener('pane-cmd', (ev) => {
    const cmd = (ev as CustomEvent<{ cmd: string }>).detail.cmd;
    if (cmd === 'split-right') split('row');
    else if (cmd === 'split-down') split('column');
    else if (cmd === 'kill') kill();
  });

  layout.render(root);
  layout.focusLeaf(focusedLeafId);
}
