import { ipcMain } from 'electron';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, sep } from 'node:path';
import { getPaneCwd } from './bridge-electron.js';
import { getSettings } from './settings.js';
import { readProjectConfig } from '../core/project-config.js';
import { DEFAULT_DOC_GLOBS } from '../core/docs-bridge.js';
import type { DocsListResult, DocsReadResult } from '../core/docs-bridge.js';
import { findProjectRoot, isMarkdown, scanDocs } from '../core/docs-scan.js';
import { ASSET_TYPES, MAX_ASSET_BYTES, fetchRemoteImage, withinPixelLimit } from './doc-images.js';

// A markdown file big enough to matter here is a generated log, and the viewer
// would take the renderer down with it trying to lay it out.
const MAX_BYTES = 4_000_000;

// Both handlers re-derive the root from the pane rather than taking one from
// the renderer: the pane's cwd is the only thing that says which project the
// user is actually in, and it's the boundary `read` enforces.
function rootFor(paneId: string): string {
  return findProjectRoot(getPaneCwd(paneId));
}

function globsFor(cwd: string): string[] {
  const project = readProjectConfig(cwd).docs?.globs;
  if (project) return project; // per-project list replaces the global one
  return getSettings().docs?.globs ?? DEFAULT_DOC_GLOBS;
}

function isUnder(child: string, parent: string): boolean {
  if (child === parent) return true;
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

export function registerDocsIpc(): void {
  ipcMain.handle('docs:list', (_e, paneId: string): DocsListResult => {
    const cwd = getPaneCwd(paneId);
    const root = findProjectRoot(cwd);
    if (!root) return { root: '', entries: [], truncated: false };
    return scanDocs(root, globsFor(cwd));
  });

  ipcMain.handle('docs:asset', (_e, paneId: string, abs: string): string | null => {
    if (!abs || !isAbsolute(abs)) return null;
    const type = ASSET_TYPES[extname(abs).toLowerCase()];
    if (!type) return null;

    const root = rootFor(paneId);
    try {
      const real = realpathSync(abs);
      if (!isUnder(real, root)) return null;
      if (statSync(real).size > MAX_ASSET_BYTES) return null;
      const buf = readFileSync(real);
      if (!withinPixelLimit(buf)) return null;
      return `data:${type};base64,${buf.toString('base64')}`;
    } catch {
      return null; // missing, unreadable, or a broken link in the document
    }
  });

  // Async, unlike its neighbours: this one is polled while a document is open,
  // and a sync stat on a slow mount would hold up main — which is also where
  // every pane's output passes through.
  ipcMain.handle('docs:mtime', async (_e, paneId: string, abs: string): Promise<number | null> => {
    if (!abs || !isAbsolute(abs) || !isMarkdown(abs)) return null;
    const root = rootFor(paneId);
    try {
      const real = await realpath(abs);
      if (!isUnder(real, root)) return null;
      return (await stat(real)).mtimeMs;
    } catch {
      return null; // deleted, or replaced by something we don't read
    }
  });

  ipcMain.handle('docs:remote-asset', (_e, url: string): Promise<string | null> =>
    fetchRemoteImage(url)
  );

  ipcMain.handle('docs:read', (_e, paneId: string, abs: string): DocsReadResult => {
    if (!abs || !isAbsolute(abs)) return { ok: false, error: 'Not an absolute path' };
    if (!isMarkdown(abs)) return { ok: false, error: 'Not a markdown file' };

    const root = rootFor(paneId);
    let real: string;
    try {
      real = realpathSync(abs);
    } catch {
      return { ok: false, error: 'File not found' };
    }
    // The listing can only produce paths inside the root, so this rejects
    // exactly one thing: a path the renderer made up (or a link followed out of
    // the project). Resolved first, so a symlink can't step over the boundary.
    if (!isUnder(real, root)) return { ok: false, error: 'Outside the project root' };

    try {
      if (statSync(real).size > MAX_BYTES) return { ok: false, error: 'File too large to render' };
      return { ok: true, content: readFileSync(real, 'utf8') };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
}
