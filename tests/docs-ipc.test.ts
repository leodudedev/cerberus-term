import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The IPC handlers, without Electron: ipcMain.handle just records them, and the
// pane's cwd is a temporary project.
const state = vi.hoisted(() => ({ cwd: '', handlers: new Map<string, (...args: unknown[]) => unknown>() }));
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, cb: (...args: unknown[]) => unknown) => state.handlers.set(name, cb) }
}));
vi.mock('../src/main/bridge-electron.js', () => ({ getPaneCwd: () => state.cwd }));
vi.mock('../src/main/settings.js', () => ({ getSettings: () => ({}) }));

import { registerDocsIpc } from '../src/main/docs-ipc.js';

registerDocsIpc();
const read = (abs: string) => state.handlers.get('docs:read')!({}, 'pane', abs);
const mtime = (abs: string) => state.handlers.get('docs:mtime')!({}, 'pane', abs);

beforeEach(() => {
  state.cwd = realpathSync(mkdtempSync(join(tmpdir(), 'cerberus-docs-')));
  mkdirSync(join(state.cwd, '.git'));
});
afterEach(() => {
  rmSync(state.cwd, { recursive: true, force: true });
});

describe('docs:read', () => {
  it('reads a linked text file as well as markdown', async () => {
    writeFileSync(join(state.cwd, 'LICENSE'), 'MIT License\n');
    writeFileSync(join(state.cwd, 'README.md'), '# hi\n');
    expect(read(join(state.cwd, 'LICENSE'))).toEqual({ ok: true, content: 'MIT License\n' });
    expect(read(join(state.cwd, 'README.md'))).toEqual({ ok: true, content: '# hi\n' });
    expect(await mtime(join(state.cwd, 'LICENSE'))).toEqual(expect.any(Number));
  });

  it('refuses a text-named file that is actually binary', () => {
    writeFileSync(join(state.cwd, 'data.json'), Buffer.from([0x7b, 0x00, 0x01, 0x7d]));
    expect(read(join(state.cwd, 'data.json'))).toEqual({ ok: false, error: 'Not a text file' });
  });

  it('refuses dotfiles and other types without reading them', async () => {
    writeFileSync(join(state.cwd, '.env'), 'TOKEN=secret\n');
    writeFileSync(join(state.cwd, 'shot.png'), 'x');
    for (const name of ['.env', 'shot.png']) {
      const res = read(join(state.cwd, name)) as { ok: boolean; error?: string };
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/Markdown and plain-text/);
      expect(await mtime(join(state.cwd, name))).toBeNull();
    }
  });

  it('still refuses text files outside the project', () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'cerberus-outside-')));
    try {
      writeFileSync(join(outside, 'LICENSE'), 'elsewhere');
      expect(read(join(outside, 'LICENSE'))).toEqual({ ok: false, error: 'Outside the project root' });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
