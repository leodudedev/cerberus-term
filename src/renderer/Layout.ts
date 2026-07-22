import { createTerminalPane, type TerminalPane } from './Terminal.js';
import { makeSplitter } from './Splitter.js';
import { makePaneHeader } from './PaneHeader.js';
import { isFavorite } from './favorites.js';
import type { PaneNode } from './pane-tree.js';

interface LeafEntry {
  el: HTMLElement;
  pane: TerminalPane;
  setFavoriteActive: (active: boolean) => void;
}

// One-shot overrides for a leaf about to be created (follower panes opened via
// POST /pane): cwd, header title, an initial command to run, read-only.
export interface PaneSpec {
  cwd?: string;
  title?: string;
  initialCommand?: string;
  readOnly?: boolean;
}

function collectLeafIds(node: PaneNode, out: Set<string>): void {
  if (node.type === 'leaf') {
    out.add(node.id);
    return;
  }
  collectLeafIds(node.a, out);
  collectLeafIds(node.b, out);
}

// Size a child (leaf or split) inside its parent flex container via proportional
// flex-grow, so a fixed-px splitter can sit between children without overflow.
// Re-applied every render so stale flex from a previous layout can't linger.
function sizeChild(el: HTMLElement, grow: number): void {
  el.style.flex = `${grow} 1 0`;
  el.style.overflow = 'hidden';
  el.style.minWidth = '0';
  el.style.minHeight = '0';
}

// Renders a PaneNode tree to nested flex layout while keeping live terminals.
// Leaf DOM is persistent and moved (appendChild) into freshly built split
// wrappers, so xterm state + pty survive relayout.
export class Layout {
  private leaves = new Map<string, LeafEntry>();
  private paneSpecs = new Map<string, PaneSpec>();
  private lockedTitles = new Set<string>(); // leaves with a fixed custom title
  private focusedLeafId: string | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly onFocusChange: (leafId: string) => void,
    private readonly onRatioChange: (splitId: string, ratio: number) => void,
    private readonly cwdFor: (leafId: string) => string | undefined = () => undefined
  ) {}

  // Snapshot each leaf's live cwd (for persistence) and refresh pane titles.
  async snapshotCwds(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const [id, entry] of this.leaves) {
      try {
        const paneId = await entry.pane.paneId;
        const cwd = await window.cerberus.cwd(paneId);
        out[id] = cwd;
        entry.setFavoriteActive(isFavorite(cwd));
        if (this.lockedTitles.has(id)) continue; // follower panes keep their title
        const title = entry.el.querySelector<HTMLElement>('.pane-title');
        if (title) title.textContent = cwd.split('/').pop() || cwd;
      } catch {
        /* pane gone */
      }
    }
    return out;
  }

  render(root: PaneNode | null): void {
    // Dispose leaves no longer in the tree before rebuilding.
    const present = new Set<string>();
    if (root) collectLeafIds(root, present);
    for (const [id, entry] of this.leaves) {
      if (!present.has(id)) {
        entry.pane.dispose();
        entry.el.remove();
        this.leaves.delete(id);
        this.lockedTitles.delete(id);
        this.paneSpecs.delete(id);
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

  paneIdOf(leafId: string): Promise<string> | null {
    return this.leaves.get(leafId)?.pane.paneId ?? null;
  }

  // Register overrides for a leaf that will be built on the next render.
  setPaneSpec(leafId: string, spec: PaneSpec): void {
    this.paneSpecs.set(leafId, spec);
  }

  // Auto-tiling target for an externally-opened pane: split the largest leaf
  // along its longer side (wide -> row, tall -> column) so repeated opens tend
  // toward a balanced grid instead of ever-thinner columns.
  pickTileTarget(): { leafId: string; dir: 'row' | 'column' } | null {
    let best: string | null = null;
    let bestArea = -1;
    let w = 0;
    let h = 0;
    for (const [id, entry] of this.leaves) {
      const r = entry.el.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) {
        bestArea = area;
        best = id;
        w = r.width;
        h = r.height;
      }
    }
    if (!best) return null;
    return { leafId: best, dir: w >= h ? 'row' : 'column' };
  }

  // Geometric nearest leaf from `fromId` in a direction (for keyboard focus nav).
  leafInDirection(
    fromId: string,
    dir: 'left' | 'right' | 'up' | 'down'
  ): string | null {
    const from = this.leaves.get(fromId);
    if (!from) return null;
    const r = from.el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;

    let best: string | null = null;
    let bestDist = Infinity;
    for (const [id, entry] of this.leaves) {
      if (id === fromId) continue;
      const rr = entry.el.getBoundingClientRect();
      const dx = rr.left + rr.width / 2 - cx;
      const dy = rr.top + rr.height / 2 - cy;
      let inDir = false;
      if (dir === 'right') inDir = dx > 5 && Math.abs(dy) <= Math.abs(dx);
      else if (dir === 'left') inDir = dx < -5 && Math.abs(dy) <= Math.abs(dx);
      else if (dir === 'down') inDir = dy > 5 && Math.abs(dx) <= Math.abs(dy);
      else if (dir === 'up') inDir = dy < -5 && Math.abs(dx) <= Math.abs(dy);
      if (!inDir) continue;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = id;
      }
    }
    return best;
  }

  // Re-measure every live pane. Called when this layout's tab becomes visible
  // again: panes deferred their fit while the tab was display:none.
  refit(): void {
    for (const entry of this.leaves.values()) entry.pane.refit();
  }

  focusLeaf(leafId: string): void {
    this.focusedLeafId = leafId;
    this.leaves.get(leafId)?.pane.focus();
    this.applyFocusStyles();
  }

  // Reverse lookup paneId -> leafId. paneId is async (resolved once at spawn);
  // only called on rare permission events, so the linear scan is fine.
  async leafForPaneId(paneId: string): Promise<string | null> {
    for (const [leafId, entry] of this.leaves) {
      try {
        if ((await entry.pane.paneId) === paneId) return leafId;
      } catch {
        /* pane gone */
      }
    }
    return null;
  }

  markLeafAttention(leafId: string): void {
    this.leaves.get(leafId)?.el.classList.add('attention');
  }

  clearLeafAttention(leafId: string): void {
    this.leaves.get(leafId)?.el.classList.remove('attention');
  }

  private build(node: PaneNode): HTMLElement {
    if (node.type === 'leaf') return this.leafEl(node.id);

    const div = document.createElement('div');
    div.className = 'split';
    div.style.cssText = `display:flex;flex-direction:${node.dir};width:100%;height:100%`;

    const a = this.build(node.a);
    const b = this.build(node.b);
    sizeChild(a, node.ratio);
    sizeChild(b, 1 - node.ratio);

    const splitter = makeSplitter(
      node.dir,
      (ratio) => {
        // live: cheap flex-grow update, no tree render
        a.style.flexGrow = String(ratio);
        b.style.flexGrow = String(1 - ratio);
      },
      (ratio) => this.onRatioChange(node.id, ratio)
    );

    div.append(a, splitter, b);
    return div;
  }

  private leafEl(id: string): HTMLElement {
    let entry = this.leaves.get(id);
    if (!entry) {
      const el = document.createElement('div');
      el.className = 'pane';
      el.dataset['leafId'] = id;
      el.style.cssText =
        'position:relative;display:flex;flex-direction:column;width:100%;height:100%;overflow:hidden;background:var(--bg);box-sizing:border-box';

      const body = document.createElement('div');
      body.className = 'pane-body';
      body.style.cssText = 'flex:1 1 0;position:relative;overflow:hidden;min-height:0';

      const spec = this.paneSpecs.get(id);
      const cwd = spec?.cwd ?? this.cwdFor(id);
      const pane = createTerminalPane(body, cwd);
      const { el: header, setFavoriteActive } = makePaneHeader(id, () => pane.focus(), {
        favorites: !spec?.readOnly
      });
      const titleEl = header.querySelector<HTMLElement>('.pane-title');
      const initialTitle = spec?.title || (cwd ? cwd.split('/').pop() || cwd : '');
      if (titleEl && initialTitle) titleEl.textContent = initialTitle;
      if (cwd) setFavoriteActive(isFavorite(cwd));

      if (spec) {
        this.paneSpecs.delete(id); // one-shot
        if (spec.title) this.lockedTitles.add(id);
        if (spec.readOnly) pane.setReadOnly(true);
        if (spec.initialCommand) {
          void pane.paneId.then((pid) => window.cerberus.write(pid, spec.initialCommand!));
        }
      }

      el.append(header, body);
      pane.onFocus(() => {
        this.focusedLeafId = id;
        this.applyFocusStyles();
        this.onFocusChange(id);
      });
      entry = { el, pane, setFavoriteActive };
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
