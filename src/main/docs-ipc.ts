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

// A markdown file big enough to matter here is a generated log, and the viewer
// would take the renderer down with it trying to lay it out.
const MAX_BYTES = 4_000_000;

// Images are inlined as base64, which costs a third again in size — a repo
// screenshot fits, a design PSD export doesn't need to.
const MAX_ASSET_BYTES = 8_000_000;
const ASSET_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml'
};

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

// A README's badge row points at shields.io and friends. The renderer's CSP
// blocks anything remote, so main fetches the bytes and hands back a data: URL.
// Node's fetch, not Electron's net: nothing here rides on the browser session,
// so no cookie of the user's is ever attached to a request a document asked for.
// Only reached when the viewer's toggle is on — see DocsSettings.remoteImages.
const REMOTE_TIMEOUT_MS = 6000;
const MAX_REMOTE_BYTES = 2_000_000;
const REMOTE_TYPES = new Set(Object.values(ASSET_TYPES));

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
      return `data:${type};base64,${readFileSync(real).toString('base64')}`;
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

  ipcMain.handle('docs:remote-asset', async (_e, url: string): Promise<string | null> => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    // https only: a plain-http badge would leak the request in clear and is not
    // worth downgrading the connection for.
    if (parsed.protocol !== 'https:') return null;

    try {
      const res = await fetch(parsed, {
        signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
        redirect: 'follow',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: { accept: 'image/*' }
      });
      if (!res.ok) return null;
      const type = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
      if (!type || !REMOTE_TYPES.has(type)) return null;
      const declared = Number(res.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_REMOTE_BYTES) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > MAX_REMOTE_BYTES) return null;
      return `data:${type};base64,${buf.toString('base64')}`;
    } catch {
      return null; // offline, timed out, TLS, DNS — the document keeps its chip
    }
  });

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
