import { ipcMain } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import { resolveConfigTarget } from '../core/project-config.js';
import { getPaneCwd } from './bridge-electron.js';
import type { ConfigTarget, SaveResult } from '../core/config-bridge.js';

const FILENAME = '.cerberus.json';
const TEMPLATE = `{
  "mute": false,
  "minRisk": "caution",
  "notifyIdle": true
}
`;

export function registerConfigIpc(): void {
  ipcMain.handle('config:resolve', (_e, paneId: string): ConfigTarget => {
    const cwd = getPaneCwd(paneId);
    const { path, exists } = resolveConfigTarget(cwd);
    let content = TEMPLATE;
    if (exists) {
      try {
        content = readFileSync(path, 'utf8');
      } catch {
        content = TEMPLATE;
      }
    }
    return { path, exists, content };
  });

  ipcMain.handle('config:save', (_e, path: string, content: string): SaveResult => {
    // Guard: only ever write an absolute .cerberus.json path.
    if (!isAbsolute(path) || basename(path) !== FILENAME) {
      return { ok: false, error: `Refusing to write to ${path}` };
    }
    try {
      JSON.parse(content); // validate before persisting
    } catch (e) {
      return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
    }
    try {
      writeFileSync(path, content, 'utf8');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
}
