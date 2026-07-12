import { createTerminalPane, type TerminalPane } from './Terminal.js';
import type { PaneNode } from './pane-tree.js';

interface LeafEntry {
  el: HTMLElement;
  pane: TerminalPane;
}

function collectLeafIds(node: PaneNode, out: Set<string>): void {
  if (node.type === 'leaf') {
    out.add(node.id);
    return;
  }
  collectLeafIds(node.a, out);
  collectLeafIds(node.b, out);
}

// Size a child (leaf or split) inside its parent flex container. Re-applied
// every render so stale flex from a previous layout can't linger.
function sizeChild(el: HTMLElement, pct: number): void {
  el.style.flex = `0 0 ${pct}%`;
  el.style.overflow = 'hidden';
  el.style.minWidth = '0';
  el.style.minHeight = '0';
}

// Renders a PaneNode tree to nested flex layout while keeping live terminals.
// Leaf DOM is persistent and moved (appendChild) into freshly built split
// wrappers, so xterm state + pty survive relayout.
export class Layout {
  private leaves = new Map<string, LeafEntry>();
  private focusedLeafId: string | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly onFocusChange: (leafId: string) => void
  ) {}

  render(root: PaneNode | null): void {
    // Dispose leaves no longer in the tree before rebuilding.
    const present = new Set<string>();
    if (root) collectLeafIds(root, present);
    for (const [id, entry] of this.leaves) {
      if (!present.has(id)) {
        entry.pane.dispose();
        entry.el.remove();
        this.leaves.delete(id);
      }
    }

    if (!root) {
      this.container.replaceChildren();
      return;
    }

    const newRoot = this.build(root);
    // Root fills the container regardless of any stale flex from prior layouts.
    newRoot.style.flex = '';
    newRoot.style.width = '100%';
    newRoot.style.height = '100%';
    this.container.replaceChildren(newRoot);
    this.applyFocusStyles();
  }

  focusLeaf(leafId: string): void {
    this.focusedLeafId = leafId;
    this.leaves.get(leafId)?.pane.focus();
    this.applyFocusStyles();
  }

  private build(node: PaneNode): HTMLElement {
    if (node.type === 'leaf') return this.leafEl(node.id);

    const div = document.createElement('div');
    div.className = 'split';
    div.style.cssText = `display:flex;flex-direction:${node.dir};width:100%;height:100%`;

    const a = this.build(node.a);
    const b = this.build(node.b);
    sizeChild(a, node.ratio * 100);
    sizeChild(b, 100 - node.ratio * 100);
    div.append(a, b);
    return div;
  }

  private leafEl(id: string): HTMLElement {
    let entry = this.leaves.get(id);
    if (!entry) {
      const el = document.createElement('div');
      el.className = 'pane';
      el.dataset['leafId'] = id;
      el.style.cssText =
        'position:relative;width:100%;height:100%;overflow:hidden;background:#1a1a1a;box-sizing:border-box';
      const pane = createTerminalPane(el);
      pane.onFocus(() => {
        this.focusedLeafId = id;
        this.applyFocusStyles();
        this.onFocusChange(id);
      });
      entry = { el, pane };
      this.leaves.set(id, entry);
    }
    return entry.el;
  }

  private applyFocusStyles(): void {
    for (const [id, entry] of this.leaves) {
      entry.el.classList.toggle('focused', id === this.focusedLeafId);
    }
  }
}
