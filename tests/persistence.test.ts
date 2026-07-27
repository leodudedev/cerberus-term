import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaneNode } from '../src/renderer/pane-tree.js';
import {
  clearWorkspace,
  loadWorkspace,
  saveWorkspace,
  type SavedWorkspace
} from '../src/renderer/persistence.js';

const KEY = 'cerberus.layout';

// Minimal localStorage stand-in: persistence.ts is the only renderer module that
// touches it, so a Map beats pulling in a whole DOM environment.
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

let store: MemoryStorage;
beforeEach(() => {
  store = new MemoryStorage();
  vi.stubGlobal('localStorage', store);
});

const leaf = (id: string): PaneNode => ({ type: 'leaf', id });
const put = (v: unknown): void => store.setItem(KEY, JSON.stringify(v));

describe('save/load round-trip', () => {
  it('reads back what it wrote', () => {
    const ws: SavedWorkspace = {
      version: 3,
      tabs: [
        {
          id: 't1',
          tree: leaf('l1'),
          cwds: { l1: '/tmp' },
          ptys: { l1: 'pty-1' },
          focusedLeafId: 'l1'
        }
      ],
      activeTabId: 't1'
    };
    saveWorkspace(ws);
    expect(loadWorkspace()).toEqual(ws);
  });

  it('clearWorkspace wipes it', () => {
    saveWorkspace({ version: 3, tabs: [{ id: 't', tree: leaf('l'), cwds: {}, focusedLeafId: 'l' }], activeTabId: 't' });
    clearWorkspace();
    expect(loadWorkspace()).toBeNull();
  });

  it('returns null when nothing was ever saved', () => {
    expect(loadWorkspace()).toBeNull();
  });
});

describe('migrations', () => {
  it('accepts a v2 snapshot and reports it as v3 (no ptys to reattach)', () => {
    put({
      version: 2,
      tabs: [{ id: 't1', tree: leaf('l1'), cwds: { l1: '/a' }, focusedLeafId: 'l1' }],
      activeTabId: 't1'
    });
    const got = loadWorkspace();
    expect(got?.version).toBe(3);
    expect(got?.tabs[0]?.ptys).toBeUndefined();
  });

  it('wraps a v1 single-tree snapshot in one tab', () => {
    put({ tree: leaf('l1'), cwds: { l1: '/a' } });
    const got = loadWorkspace();
    expect(got).toEqual({
      version: 3,
      tabs: [{ id: 'tab-0', tree: leaf('l1'), cwds: { l1: '/a' }, focusedLeafId: 'l1' }],
      activeTabId: 'tab-0'
    });
  });

  it('tolerates a v1 snapshot with no cwds', () => {
    put({ tree: leaf('l1') });
    expect(loadWorkspace()?.tabs[0]?.cwds).toEqual({});
  });
});

describe('corrupt or hostile snapshots', () => {
  it('returns null on invalid JSON', () => {
    store.setItem(KEY, '{not json');
    expect(loadWorkspace()).toBeNull();
  });

  it('returns null on an unknown version', () => {
    put({ version: 99, tabs: [{ id: 't', tree: leaf('l'), cwds: {}, focusedLeafId: 'l' }] });
    expect(loadWorkspace()).toBeNull();
  });

  it('returns null when tabs is not an array', () => {
    put({ version: 3, tabs: 'nope', activeTabId: 't' });
    expect(loadWorkspace()).toBeNull();
  });

  it('drops tabs missing a tree or an id, and null entries', () => {
    put({
      version: 3,
      tabs: [
        null,
        { id: 't1' },
        { tree: leaf('l2') },
        { id: 't3', tree: leaf('l3'), cwds: {}, focusedLeafId: 'l3' }
      ],
      activeTabId: 't3'
    });
    const got = loadWorkspace();
    expect(got?.tabs.map((t) => t.id)).toEqual(['t3']);
  });

  it('returns null when every tab is dropped', () => {
    put({ version: 3, tabs: [null, { id: 'x' }], activeTabId: 'x' });
    expect(loadWorkspace()).toBeNull();
  });

  it('falls back to the first tab when activeTabId points nowhere', () => {
    put({
      version: 3,
      tabs: [
        { id: 't1', tree: leaf('l1'), cwds: {}, focusedLeafId: 'l1' },
        { id: 't2', tree: leaf('l2'), cwds: {}, focusedLeafId: 'l2' }
      ],
      activeTabId: 'gone'
    });
    expect(loadWorkspace()?.activeTabId).toBe('t1');
  });
});

describe('storage failures are swallowed', () => {
  it('saveWorkspace does not throw when the quota is exceeded', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined
    });
    expect(() =>
      saveWorkspace({
        version: 3,
        tabs: [{ id: 't', tree: leaf('l'), cwds: {}, focusedLeafId: 'l' }],
        activeTabId: 't'
      })
    ).not.toThrow();
  });
});
