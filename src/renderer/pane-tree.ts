// Binary pane tree. Pure, DOM-free, immutable ops — the spine every later step
// addresses panes through. A leaf is one terminal; a split holds two children.

export type Dir = 'row' | 'column';

export interface LeafNode {
  type: 'leaf';
  id: string; // stable node id (uuid), NOT the pty paneId
}

export interface SplitNode {
  type: 'split';
  id: string;
  dir: Dir;
  ratio: number; // fraction for child a, in (0,1); Step 3 mutates it
  a: PaneNode;
  b: PaneNode;
}

export type PaneNode = LeafNode | SplitNode;

export function newLeaf(): LeafNode {
  return { type: 'leaf', id: crypto.randomUUID() };
}

// Replace the target leaf with a split of {oldLeaf, newLeaf}. Returns the new
// root and the new leaf's id so the caller can focus it.
export function splitLeaf(
  root: PaneNode,
  leafId: string,
  dir: Dir
): { root: PaneNode; newLeafId: string } {
  const created = newLeaf();

  function rec(node: PaneNode): PaneNode {
    if (node.type === 'leaf') {
      if (node.id !== leafId) return node;
      return { type: 'split', id: crypto.randomUUID(), dir, ratio: 0.5, a: node, b: created };
    }
    return { ...node, a: rec(node.a), b: rec(node.b) };
  }

  return { root: rec(root), newLeafId: created.id };
}

// Remove the leaf; its parent split collapses so the sibling replaces the
// parent. Returns null when the last leaf is removed.
export function killLeaf(root: PaneNode, leafId: string): PaneNode | null {
  if (root.type === 'leaf') return root.id === leafId ? null : root;

  // Direct child is the target -> collapse: sibling takes this node's place.
  if (root.a.type === 'leaf' && root.a.id === leafId) return root.b;
  if (root.b.type === 'leaf' && root.b.id === leafId) return root.a;

  // Otherwise recurse into whichever subtree contains it (never returns null:
  // a split has >=2 leaves, so killing one leaves a non-null collapsed subtree).
  const newA = killLeaf(root.a, leafId);
  if (newA !== root.a) return { ...root, a: newA as PaneNode };
  const newB = killLeaf(root.b, leafId);
  if (newB !== root.b) return { ...root, b: newB as PaneNode };
  return root;
}

export function firstLeaf(node: PaneNode): LeafNode {
  return node.type === 'leaf' ? node : firstLeaf(node.a);
}

export function leaves(node: PaneNode): LeafNode[] {
  return node.type === 'leaf' ? [node] : [...leaves(node.a), ...leaves(node.b)];
}
