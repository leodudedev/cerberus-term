// Types shared between main, preload and renderer for the markdown browser.
// Deliberately free of node: imports — the renderer bundle loads this file, and
// anything reaching node:path through it would fail there (see SettingsEditor).

// Root-level markdown is always listed; these cover where the rest usually
// lives. `.claude` is in by default because that is where an agent's own docs
// end up. Lives here rather than in docs-scan so the Settings UI can show it
// without pulling node:fs into the renderer bundle.
export const DEFAULT_DOC_GLOBS = ['docs/**', 'doc/**', 'documenti/**', '.claude/**'];

export interface DocEntry {
  // Path relative to the project root, as shown in the dropdown.
  rel: string;
  abs: string;
  mtimeMs: number;
  // README.md / CLAUDE.md and friends, kept at the top of the list.
  pinned: boolean;
}

export interface DocsListResult {
  // Project root the scan was rooted at (git root, or the pane cwd).
  root: string;
  entries: DocEntry[];
  // Set when the scan hit its file budget, so the UI can say the list is partial.
  truncated: boolean;
}

// What the viewer does with a file a document links to. Markdown renders;
// plain text (a LICENSE, a script, a config) shows verbatim; anything else is
// refused with a message rather than a click that does nothing. An allowlist,
// not a binary sniff alone: a README linking `.env` shouldn't put secrets on
// screen, and dotfiles never match (`.env` has no extension, only a name).
const TEXT_EXTENSIONS: Record<string, string> = {
  '.txt': '',
  '.log': '',
  '.csv': '',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.ps1': '',
  '.json': 'json',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.toml': 'ini',
  '.ini': 'ini',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.css': 'css',
  '.html': 'xml',
  '.xml': 'xml',
  '.py': 'python',
  '.php': 'php',
  '.sql': 'sql',
  '.diff': 'diff',
  '.patch': 'diff'
};
const TEXT_NAMES: Record<string, string> = {
  license: '',
  licence: '',
  copying: '',
  notice: '',
  authors: '',
  contributors: '',
  makefile: 'makefile',
  dockerfile: ''
};

export type DocKind = 'markdown' | 'text';

function splitName(path: string): { stem: string; ext: string } {
  const name = (path.split(/[/\\]/).pop() ?? '').toLowerCase();
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { stem: name, ext: '' }; // `.env`: a name, not an extension
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

export function docKind(path: string): DocKind | null {
  const { stem, ext } = splitName(path);
  if (ext === '.md' || ext === '.mdx') return 'markdown';
  if (ext ? Object.hasOwn(TEXT_EXTENSIONS, ext) : Object.hasOwn(TEXT_NAMES, stem)) return 'text';
  // LICENSE.txt is covered by .txt; LICENSE-MIT and friends by the stem.
  if (/^licen[cs]e\b/.test(stem) && (!ext || ext === '.txt')) return 'text';
  return null;
}

// highlight.js language for a text file, '' to show it plain.
export function textLanguage(path: string): string {
  const { stem, ext } = splitName(path);
  const table = ext ? TEXT_EXTENSIONS : TEXT_NAMES;
  const key = ext || stem;
  return Object.hasOwn(table, key) ? (table[key] ?? '') : '';
}

export type DocsReadResult = { ok: true; content: string } | { ok: false; error: string };

export interface DocsBridge {
  list(paneId: string): Promise<DocsListResult>;
  // `abs` must sit under the same project root the listing was rooted at; main
  // re-derives that root from the pane rather than trusting the caller.
  read(paneId: string, abs: string): Promise<DocsReadResult>;
  // An image a document references, as a data: URL. The page's CSP allows
  // `data:` and nothing remote, so this is how a repo's own screenshots show up
  // without opening the renderer to the network. Null when it can't be served.
  asset(paneId: string, abs: string): Promise<string | null>;
  // A badge or any other image a document points at over https, fetched by main
  // (off the browser session, so no cookies) and returned as a data: URL. The
  // viewer only calls it when the user has turned remote images on.
  remoteAsset(url: string): Promise<string | null>;
  // Modification time of an open document, polled by the viewer so a file
  // rewritten under it (an agent editing the very spec you are reading) shows
  // up without being reopened. Null when it's gone or outside the root.
  mtime(paneId: string, abs: string): Promise<number | null>;
}
