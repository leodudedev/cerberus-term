import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// findConfigFile walks up to $HOME, so the tests need a home they can write in.
let home = '';
vi.mock('node:os', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:os')>();
  return { ...real, homedir: () => home };
});

const { findConfigFile, readProjectConfig, resolveConfigTarget } = await import(
  '../src/core/project-config.js'
);

const trash: string[] = [];
function tmp(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  trash.push(dir);
  return dir;
}
function config(dir: string, body: unknown = {}): string {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, '.cerberus.json');
  writeFileSync(p, JSON.stringify(body));
  return p;
}

beforeEach(() => {
  home = tmp('cerberus-home-');
});
afterEach(() => {
  for (const d of trash.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('findConfigFile — the walk', () => {
  it('finds a config in the directory itself', () => {
    const dir = join(home, 'proj');
    const p = config(dir);
    expect(findConfigFile(dir)).toBe(p);
  });

  it('walks up to the nearest ancestor', () => {
    const p = config(join(home, 'proj'));
    const deep = join(home, 'proj', 'a', 'b', 'c');
    mkdirSync(deep, { recursive: true });
    expect(findConfigFile(deep)).toBe(p);
  });

  it('prefers the nearest config over one further up', () => {
    config(join(home, 'proj'));
    const near = config(join(home, 'proj', 'a'));
    expect(findConfigFile(join(home, 'proj', 'a'))).toBe(near);
  });

  it('finds a config sitting in home itself', () => {
    const p = config(home);
    const deep = join(home, 'x', 'y');
    mkdirSync(deep, { recursive: true });
    expect(findConfigFile(deep)).toBe(p);
  });

  it('stops at home and does not climb past it', () => {
    // A config above home must not be picked up.
    config(join(home, '..'));
    const deep = join(home, 'proj');
    mkdirSync(deep, { recursive: true });
    expect(findConfigFile(deep)).toBeNull();
  });

  it('returns null when nothing is there', () => {
    const dir = join(home, 'proj');
    mkdirSync(dir, { recursive: true });
    expect(findConfigFile(dir)).toBeNull();
  });
});

describe('findConfigFile — validation', () => {
  it('rejects a relative path', () => {
    config(join(home, 'proj'));
    expect(findConfigFile('proj')).toBeNull();
  });

  it('rejects an empty path', () => {
    expect(findConfigFile('')).toBeNull();
  });

  it('rejects a directory that does not exist', () => {
    expect(findConfigFile(join(home, 'gone'))).toBeNull();
  });

  it('rejects a file passed where a directory is expected', () => {
    const p = config(join(home, 'proj'));
    expect(findConfigFile(p)).toBeNull();
  });

  it('resolves symlinks before walking', () => {
    const p = config(join(home, 'real'));
    const link = join(home, 'link');
    symlinkSync(join(home, 'real'), link);
    expect(findConfigFile(link)).toBe(p);
  });
});

describe('findConfigFile — outside home', () => {
  it('reads a config in the directory itself', () => {
    const outside = tmp('cerberus-out-');
    const p = config(join(outside, 'proj'));
    expect(findConfigFile(join(outside, 'proj'))).toBe(p);
  });

  it('does not walk up towards the fs root', () => {
    // The old loop compared against $HOME to stop; outside home that never
    // matched, so it climbed to / and picked up whatever it found on the way.
    const outside = tmp('cerberus-out-');
    config(outside);
    const deep = join(outside, 'a', 'b');
    mkdirSync(deep, { recursive: true });
    expect(findConfigFile(deep)).toBeNull();
  });
});

describe('readProjectConfig', () => {
  it('returns {} with no cwd and no config', () => {
    expect(readProjectConfig('')).toEqual({});
    const dir = join(home, 'proj');
    mkdirSync(dir, { recursive: true });
    expect(readProjectConfig(dir)).toEqual({});
  });

  it('keeps only known fields, with the documented defaults', () => {
    const dir = join(home, 'proj');
    config(dir, { mute: true, chatId: '123', minRisk: 'danger', notifyIdle: false, junk: 1 });
    expect(readProjectConfig(dir)).toEqual({
      mute: true,
      chatId: '123',
      minRisk: 'danger',
      notifyIdle: false
    });
  });

  it('drops an out-of-range minRisk and a non-string chatId', () => {
    const dir = join(home, 'proj');
    config(dir, { minRisk: 'nuclear', chatId: 42, mute: 'yes', notifyIdle: true });
    expect(readProjectConfig(dir)).toEqual({
      mute: false,
      chatId: undefined,
      minRisk: undefined,
      notifyIdle: undefined
    });
  });

  it('survives malformed json', () => {
    const dir = join(home, 'proj');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.cerberus.json'), '{ not json');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(readProjectConfig(dir)).toEqual({});
    spy.mockRestore();
  });
});

describe('resolveConfigTarget', () => {
  it('points at an existing config', () => {
    const p = config(join(home, 'proj'));
    expect(resolveConfigTarget(join(home, 'proj'))).toEqual({ path: p, exists: true });
  });

  it('proposes a new file in the cwd when none exists', () => {
    const dir = join(home, 'proj');
    mkdirSync(dir, { recursive: true });
    expect(resolveConfigTarget(dir)).toEqual({
      path: join(dir, '.cerberus.json'),
      exists: false
    });
  });

  it('falls back to home for an empty cwd', () => {
    expect(resolveConfigTarget('')).toEqual({
      path: join(home, '.cerberus.json'),
      exists: false
    });
  });
});
