import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { DEFAULT_DOC_GLOBS, type DocEntry, type DocsListResult } from './docs-bridge.js';

// Which markdown files the pane's ▤ button lists. The scan is rooted at the
// project the pane sits in and never leaves it: the dropdown is a project tool,
// not a file browser, and a viewer that can be pointed anywhere is a viewer that
// can be pointed at ~/.ssh by a bad glob in a shared .cerberus.json.

// Always listed, whatever the globs say, and floated to the top of the list in
// this order: in an agentic session these are the files you reach for.
export { DEFAULT_DOC_GLOBS };

export const PINNED_NAMES = ['CLAUDE.md', 'AGENTS.md', 'README.md'];

// Never descended into. Vendored trees carry thousands of md files that belong
// to somebody else's project.
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  '.next',
  '.turbo',
  '.cache'
]);

const MAX_FILES = 500;
const MAX_DEPTH = 6;

export function isMarkdown(name: string): boolean {
  return /\.mdx?$/i.test(name);
}

// A bare directory ("docs") means everything under it — what anyone typing it
// in Settings expects, rather than a pattern that matches nothing.
function normalizeGlob(pattern: string): string {
  const p = pattern.trim().replace(/^\.?\//, '').replace(/\/+$/, '');
  if (!p) return '';
  return /[*?]/.test(p) || isMarkdown(p) ? p : `${p}/**`;
}

// Glob -> RegExp over a root-relative, forward-slash path. `**` crosses
// directory boundaries, `*` and `?` stay inside one segment.
export function globToRegExp(pattern: string): RegExp {
  const p = normalizeGlob(pattern);
  let out = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i] as string;
    if (c === '*') {
      if (p[i + 1] === '*') {
        // `**/` also has to match zero segments, so `docs/**/x.md` finds docs/x.md
        if (p[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 'i');
}

// The literal directory a pattern starts with, so the walk opens `docs/` rather
// than the whole project and filters afterwards.
export function globStartDir(pattern: string): string {
  const p = normalizeGlob(pattern);
  const segments = p.split('/');
  const literal: string[] = [];
  for (const seg of segments) {
    if (/[*?]/.test(seg)) break;
    literal.push(seg);
  }
  // The last literal segment may be the file itself ("docs/api.md").
  if (literal.length === segments.length && literal.length > 0) literal.pop();
  return literal.join('/');
}

// The project the pane is in: nearest ancestor holding a .git (a worktree has a
// .git *file*, so don't require a directory). Falls back to the cwd itself, and
// never climbs past $HOME — outside home there is no boundary worth trusting.
export function findProjectRoot(cwd: string, home = homedir()): string {
  if (!cwd || !isAbsolute(cwd)) return cwd;
  const start = realpathSyncSafe(cwd);
  if (!start) return cwd;
  const inHome = start === home || start.startsWith(home.endsWith(sep) ? home : home + sep);
  let cursor = start;
  while (true) {
    if (existsSync(join(cursor, '.git'))) return cursor;
    // Outside home there is no boundary the walk could trust, so the cwd is the
    // root and nothing above it is even looked at.
    if (!inHome || cursor === home) break;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return start;
}

function realpathSyncSafe(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

// Pinned names first (in PINNED_NAMES order), then most recently modified —
// in an agentic session the file the agent just wrote is the one you want.
export function sortDocs(entries: DocEntry[]): DocEntry[] {
  const rank = (e: DocEntry): number => {
    const i = PINNED_NAMES.indexOf(e.rel);
    return i < 0 ? PINNED_NAMES.length : i;
  };
  return [...entries].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned && b.pinned) return rank(a) - rank(b);
    return b.mtimeMs - a.mtimeMs;
  });
}

interface WalkState {
  root: string;
  matchers: RegExp[];
  found: Map<string, DocEntry>;
  truncated: boolean;
}

function relPath(root: string, abs: string): string {
  return relative(root, abs).split(sep).join('/');
}

function addFile(state: WalkState, abs: string, name: string): void {
  if (state.found.size >= MAX_FILES) {
    state.truncated = true;
    return;
  }
  if (!isMarkdown(name) || state.found.has(abs)) return;
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(abs).mtimeMs;
  } catch {
    return; // vanished between readdir and stat
  }
  const rel = relPath(state.root, abs);
  state.found.set(abs, { rel, abs, mtimeMs, pinned: PINNED_NAMES.includes(rel) });
}

function walk(state: WalkState, dir: string, depth: number): void {
  if (depth > MAX_DEPTH || state.found.size >= MAX_FILES) return;
  let dirents;
  try {
    dirents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory — skip it, not the whole scan
  }
  for (const d of dirents) {
    // A symlink is the one way a walk rooted at the project leaves it.
    if (d.isSymbolicLink()) continue;
    const abs = join(dir, d.name);
    if (d.isDirectory()) {
      if (SKIP_DIRS.has(d.name)) continue;
      walk(state, abs, depth + 1);
    } else if (d.isFile() && state.matchers.some((re) => re.test(relPath(state.root, abs)))) {
      addFile(state, abs, d.name);
    }
  }
}

export function scanDocs(root: string, globs: string[] = DEFAULT_DOC_GLOBS): DocsListResult {
  const state: WalkState = {
    root,
    matchers: globs.filter(Boolean).map(globToRegExp),
    found: new Map(),
    truncated: false
  };

  // Root-level markdown is unconditional: README.md and CLAUDE.md are the point
  // of the button, and no glob should have to be configured to see them.
  try {
    for (const d of readdirSync(root, { withFileTypes: true })) {
      if (d.isFile() && isMarkdown(d.name)) addFile(state, join(root, d.name), d.name);
    }
  } catch {
    return { root, entries: [], truncated: false };
  }

  // Open only the directories the globs actually reach into.
  const starts = new Set(globs.filter(Boolean).map(globStartDir));
  for (const start of starts) {
    const dir = start ? join(root, start) : root;
    // An empty start means a root-anchored pattern like `**/*.md`: walking the
    // whole project is what was asked for, skip-list and depth cap still apply.
    walk(state, dir, start ? start.split('/').length : 0);
  }

  return { root, entries: sortDocs([...state.found.values()]), truncated: state.truncated };
}
