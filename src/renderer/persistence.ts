import { firstLeaf, type PaneNode } from './pane-tree.js';

// Renderer-local session restore: a set of tabs, each holding a pane tree + a
// per-leaf cwd map, in localStorage. Layout is a pure client concern, so no
// IPC/file is needed.

const KEY = 'cerberus.layout';

export interface SavedTab {
  id: string;
  tree: PaneNode;
  cwds: Record<string, string>; // leafId -> cwd
  // leafId -> paneId of the pty that was running. The ptys live in main and
  // survive a renderer restart, so on restore a leaf whose pty is still alive
  // reattaches to it instead of spawning a new shell (v3+).
  ptys?: Record<string, string>;
  focusedLeafId: string;
  title?: string;
}

export interface SavedWorkspace {
  version: 3;
  tabs: SavedTab[];
  activeTabId: string;
}

// Legacy v1 shape: a single untabbed { tree, cwds }. Kept only to migrate.
interface LegacyLayout {
  tree: PaneNode;
  cwds?: Record<string, string>;
}

export function saveWorkspace(ws: SavedWorkspace): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ws));
  } catch {
    /* quota/serialization — best effort */
  }
}

export function loadWorkspace(): SavedWorkspace | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Omit<Partial<SavedWorkspace>, 'version'> &
      Partial<LegacyLayout> & { version?: number };

    // v2/v3: validated tab list. v3 only adds the optional per-leaf pty map, so
    // a v2 snapshot reads fine — its tabs just have no pty to reattach.
    if ((data.version === 2 || data.version === 3) && Array.isArray(data.tabs)) {
      const tabs = data.tabs.filter((t): t is SavedTab => !!t && !!t.tree && !!t.id);
      if (tabs.length === 0) return null;
      const activeTabId = tabs.some((t) => t.id === data.activeTabId)
        ? (data.activeTabId as string)
        : tabs[0]!.id;
      return { version: 3, tabs, activeTabId };
    }

    // v1 -> v3 migration: wrap the single tree in one tab.
    if (data.tree) {
      const id = 'tab-0';
      return {
        version: 3,
        tabs: [
          {
            id,
            tree: data.tree,
            cwds: data.cwds ?? {},
            focusedLeafId: firstLeaf(data.tree).id
          }
        ],
        activeTabId: id
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function clearWorkspace(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
