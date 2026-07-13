import type { PaneNode } from './pane-tree.js';

// Renderer-local session restore: the pane tree + a per-leaf cwd map, in
// localStorage. Layout is a pure client concern, so no IPC/file is needed.

const KEY = 'cerberus.layout';

export interface SavedLayout {
  tree: PaneNode;
  cwds: Record<string, string>; // leafId -> cwd
}

export function saveLayout(tree: PaneNode, cwds: Record<string, string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ tree, cwds }));
  } catch {
    /* quota/serialization — best effort */
  }
}

export function loadLayout(): SavedLayout | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<SavedLayout>;
    if (!data.tree) return null;
    return { tree: data.tree, cwds: data.cwds ?? {} };
  } catch {
    return null;
  }
}

export function clearLayout(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
