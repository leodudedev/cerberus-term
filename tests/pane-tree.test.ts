import { describe, expect, it } from 'vitest';
import {
  firstLeaf,
  killLeaf,
  leaves,
  newLeaf,
  resizeNearest,
  setRatio,
  splitLeaf,
  type PaneNode,
  type SplitNode
} from '../src/renderer/pane-tree.js';

const ids = (n: PaneNode): string[] => leaves(n).map((l) => l.id);

describe('splitLeaf', () => {
  it('replaces the target leaf with a 50/50 split of {old, new}', () => {
    const root = newLeaf();
    const { root: next, newLeafId } = splitLeaf(root, root.id, 'row');
    expect(next.type).toBe('split');
    const s = next as SplitNode;
    expect(s.dir).toBe('row');
    expect(s.ratio).toBe(0.5);
    expect(ids(next)).toEqual([root.id, newLeafId]);
  });

  it('splits a nested leaf without touching its siblings', () => {
    const a = newLeaf();
    const { root: r1, newLeafId: b } = splitLeaf(a, a.id, 'row');
    const { root: r2, newLeafId: c } = splitLeaf(r1, b, 'column');
    expect(ids(r2)).toEqual([a.id, b, c]);
  });

  it('is immutable — the original tree is untouched', () => {
    const a = newLeaf();
    const { root: r1 } = splitLeaf(a, a.id, 'row');
    const before = JSON.stringify(r1);
    splitLeaf(r1, leaves(r1)[0]!.id, 'row');
    expect(JSON.stringify(r1)).toBe(before);
  });

  it('no-ops on an unknown leaf id (but still mints a leaf id)', () => {
    const a = newLeaf();
    const { root: next } = splitLeaf(a, 'nope', 'row');
    expect(ids(next)).toEqual([a.id]);
  });
});

describe('killLeaf', () => {
  it('returns null when the last leaf goes', () => {
    const a = newLeaf();
    expect(killLeaf(a, a.id)).toBeNull();
  });

  it('collapses the parent split so the sibling takes its place', () => {
    const a = newLeaf();
    const { root: r1, newLeafId: b } = splitLeaf(a, a.id, 'row');
    const next = killLeaf(r1, b);
    expect(next).toMatchObject({ type: 'leaf', id: a.id });
  });

  it('collapses a nested split, keeping the rest of the tree', () => {
    const a = newLeaf();
    const { root: r1, newLeafId: b } = splitLeaf(a, a.id, 'row');
    const { root: r2, newLeafId: c } = splitLeaf(r1, b, 'column');
    expect(ids(killLeaf(r2, c)!)).toEqual([a.id, b]);
    expect(ids(killLeaf(r2, b)!)).toEqual([a.id, c]);
  });

  it('leaves the tree alone for an unknown leaf id', () => {
    const a = newLeaf();
    const { root: r1 } = splitLeaf(a, a.id, 'row');
    expect(killLeaf(r1, 'nope')).toBe(r1);
  });
});

describe('setRatio', () => {
  const built = (): { root: PaneNode; splitId: string } => {
    const a = newLeaf();
    const { root } = splitLeaf(a, a.id, 'row');
    return { root, splitId: (root as SplitNode).id };
  };

  it('sets the ratio of the addressed split', () => {
    const { root, splitId } = built();
    expect((setRatio(root, splitId, 0.3) as SplitNode).ratio).toBeCloseTo(0.3);
  });

  it('clamps to [0.05, 0.95] so a pane can never be collapsed to nothing', () => {
    const { root, splitId } = built();
    expect((setRatio(root, splitId, -5) as SplitNode).ratio).toBe(0.05);
    expect((setRatio(root, splitId, 5) as SplitNode).ratio).toBe(0.95);
  });

  it('no-ops on an unknown split id', () => {
    const { root } = built();
    expect((setRatio(root, 'nope', 0.2) as SplitNode).ratio).toBe(0.5);
  });
});

describe('resizeNearest', () => {
  // a | (b / c): the row split is the outer one, the column split the inner.
  const build = (): { root: PaneNode; a: string; c: string; outer: string; inner: string } => {
    const la = newLeaf();
    const { root: r1, newLeafId: b } = splitLeaf(la, la.id, 'row');
    const { root: r2, newLeafId: c } = splitLeaf(r1, b, 'column');
    const outer = (r2 as SplitNode).id;
    const inner = ((r2 as SplitNode).b as SplitNode).id;
    return { root: r2, a: la.id, c, outer, inner };
  };

  it('nudges the nearest ancestor split matching the axis', () => {
    const { root, c, inner } = build();
    const next = resizeNearest(root, c, 'column', 0.1);
    const innerNode = (next as SplitNode).b as SplitNode;
    expect(innerNode.id).toBe(inner);
    expect(innerNode.ratio).toBeCloseTo(0.6);
    expect((next as SplitNode).ratio).toBe(0.5); // outer untouched
  });

  it('walks past a non-matching inner split to the matching outer one', () => {
    const { root, c, outer } = build();
    const next = resizeNearest(root, c, 'row', -0.2) as SplitNode;
    expect(next.id).toBe(outer);
    expect(next.ratio).toBeCloseTo(0.3);
  });

  it('clamps the nudge', () => {
    const { root, c } = build();
    const next = resizeNearest(root, c, 'column', 10);
    expect(((next as SplitNode).b as SplitNode).ratio).toBe(0.95);
  });

  it('no-ops when no ancestor matches the axis', () => {
    const { root, a } = build();
    // `a` sits only under the row split, so a column resize has no target.
    expect(resizeNearest(root, a, 'column', 0.1)).toBe(root);
  });

  it('no-ops on an unknown leaf id', () => {
    const { root } = build();
    expect(resizeNearest(root, 'nope', 'row', 0.1)).toBe(root);
  });
});

describe('firstLeaf / leaves', () => {
  it('firstLeaf descends the a-side', () => {
    const a = newLeaf();
    const { root } = splitLeaf(a, a.id, 'row');
    expect(firstLeaf(root).id).toBe(a.id);
  });

  it('leaves returns them in a-then-b order', () => {
    const a = newLeaf();
    const { root: r1, newLeafId: b } = splitLeaf(a, a.id, 'row');
    const { root: r2, newLeafId: c } = splitLeaf(r1, a.id, 'column');
    expect(ids(r2)).toEqual([a.id, c, b]);
  });
});
