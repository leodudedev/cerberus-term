import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setStatePath, loadState } from '../src/core/persist.js';

// mute.ts seeds its state at import time, so the state path has to be redirected
// before the module is pulled in — hence the dynamic import.
let m: typeof import('../src/core/mute.js');
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cerberus-mute-'));
  setStatePath(join(dir, 'state.json'));
  m = await import('../src/core/mute.js');
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('per-project mute', () => {
  it('mutes a cwd and everything under it', () => {
    m.mute('/proj/a');
    expect(m.isMuted('/proj/a')).toBe(true);
    expect(m.isMuted('/proj/a/sub')).toBe(true);
    expect(m.isMuted('/proj/b')).toBe(false);
    expect(m.unmute('/proj/a')).toBe(true);
    expect(m.isMuted('/proj/a')).toBe(false);
  });
});

describe('global mute', () => {
  it('silences every cwd while on, and leaves per-project mutes intact', () => {
    m.mute('/proj/a');
    m.setMutedAll(true);
    expect(m.isMutedAll()).toBe(true);
    expect(m.isMuted('/proj/b')).toBe(true);
    expect(m.isMuted('/anything')).toBe(true);

    m.setMutedAll(false);
    expect(m.isMuted('/proj/b')).toBe(false);
    expect(m.isMuted('/proj/a')).toBe(true); // the project mute survived
    m.unmute('/proj/a');
  });

  it('persists the flag and notifies listeners only on a real change', () => {
    const seen: boolean[] = [];
    const off = m.onMuteAllChange((v) => seen.push(v));

    m.setMutedAll(true);
    m.setMutedAll(true); // no-op
    expect(loadState().muteAll).toBe(true);

    m.setMutedAll(false);
    expect(loadState().muteAll).toBe(false);
    expect(seen).toEqual([true, false]);

    off();
    m.setMutedAll(true);
    expect(seen).toEqual([true, false]);
    m.setMutedAll(false);
  });
});
