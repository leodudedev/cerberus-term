import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_DOC_GLOBS,
  findProjectRoot,
  globStartDir,
  globToRegExp,
  isMarkdown,
  scanDocs,
  sortDocs
} from '../src/core/docs-scan.js';
import type { DocEntry } from '../src/core/docs-bridge.js';

const roots: string[] = [];
function fakeHome(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cerberus-docs-')));
  roots.push(dir);
  return dir;
}
function file(path: string, body = '# t', mtime?: number): string {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
  if (mtime !== undefined) utimesSync(path, mtime, mtime);
  return path;
}
function project(home: string, name = 'proj'): string {
  const root = join(home, name);
  mkdirSync(join(root, '.git'), { recursive: true });
  return root;
}
afterEach(() => {
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('globToRegExp', () => {
  it('keeps * inside a segment', () => {
    expect(globToRegExp('doc/*').test('doc/a.md')).toBe(true);
    expect(globToRegExp('doc/*').test('doc/sub/a.md')).toBe(false);
  });

  it('crosses directories with **', () => {
    expect(globToRegExp('docs/**').test('docs/a/b/c.md')).toBe(true);
  });

  it('matches zero segments for **/', () => {
    expect(globToRegExp('docs/**/x.md').test('docs/x.md')).toBe(true);
    expect(globToRegExp('docs/**/x.md').test('docs/a/x.md')).toBe(true);
  });

  it('treats a bare directory as everything under it', () => {
    expect(globToRegExp('documenti').test('documenti/a.md')).toBe(true);
  });

  it('does not let a dot in the pattern match any character', () => {
    expect(globToRegExp('docs/a.md').test('docs/axmd')).toBe(false);
  });
});

describe('globStartDir', () => {
  it('returns the literal prefix a walk can start at', () => {
    expect(globStartDir('docs/**')).toBe('docs');
    expect(globStartDir('a/b/*.md')).toBe('a/b');
    expect(globStartDir('**/*.md')).toBe('');
    expect(globStartDir('docs/api.md')).toBe('docs');
  });
});

describe('findProjectRoot', () => {
  it('walks up to the nearest .git', () => {
    const home = fakeHome();
    const root = project(home);
    mkdirSync(join(root, 'src', 'renderer'), { recursive: true });
    expect(findProjectRoot(join(root, 'src', 'renderer'), home)).toBe(root);
  });

  it('falls back to the cwd when there is no project', () => {
    const home = fakeHome();
    const dir = join(home, 'loose');
    mkdirSync(dir, { recursive: true });
    expect(findProjectRoot(dir, home)).toBe(dir);
  });

  it('never climbs past home', () => {
    const home = fakeHome();
    mkdirSync(join(home, '.git'), { recursive: true }); // a repo *at* home
    const dir = join(home, 'x', 'y');
    mkdirSync(dir, { recursive: true });
    expect(findProjectRoot(dir, home)).toBe(home);
  });
});

describe('scanDocs', () => {
  it('always lists root markdown, whatever the globs say', () => {
    const root = project(fakeHome());
    file(join(root, 'README.md'));
    file(join(root, 'notes.mdx'));
    const { entries } = scanDocs(root, []);
    expect(entries.map((e) => e.rel).sort()).toEqual(['README.md', 'notes.mdx']);
  });

  it('follows the configured globs and nothing else', () => {
    const root = project(fakeHome());
    file(join(root, 'docs', 'guide.md'));
    file(join(root, 'other', 'hidden.md'));
    const { entries } = scanDocs(root, ['docs/**']);
    expect(entries.map((e) => e.rel)).toEqual(['docs/guide.md']);
  });

  it('skips vendored trees', () => {
    const root = project(fakeHome());
    file(join(root, 'node_modules', 'pkg', 'README.md'));
    file(join(root, 'docs', 'a.md'));
    const { entries } = scanDocs(root, ['**/*.md']);
    expect(entries.map((e) => e.rel)).toEqual(['docs/a.md']);
  });

  it('ignores non-markdown', () => {
    const root = project(fakeHome());
    file(join(root, 'docs', 'a.md'));
    file(join(root, 'docs', 'b.txt'));
    const { entries } = scanDocs(root, ['docs/**']);
    expect(entries.map((e) => e.rel)).toEqual(['docs/a.md']);
  });

  it('does not follow a symlink out of the project', () => {
    const home = fakeHome();
    const root = project(home);
    const outside = join(home, 'secrets');
    file(join(outside, 'private.md'));
    mkdirSync(join(root, 'docs'), { recursive: true });
    symlinkSync(outside, join(root, 'docs', 'link'));
    const { entries } = scanDocs(root, ['docs/**']);
    expect(entries.map((e) => e.rel)).toEqual([]);
  });

  it('pins the well-known names and sorts the rest by mtime', () => {
    const root = project(fakeHome());
    file(join(root, 'old.md'), '# old', 1_000);
    file(join(root, 'new.md'), '# new', 2_000);
    file(join(root, 'README.md'), '# r', 500);
    file(join(root, 'CLAUDE.md'), '# c', 400);
    const { entries } = scanDocs(root, []);
    expect(entries.map((e) => e.rel)).toEqual(['CLAUDE.md', 'README.md', 'new.md', 'old.md']);
  });
});

describe('sortDocs', () => {
  const entry = (rel: string, mtimeMs: number, pinned = false): DocEntry => ({
    rel,
    abs: `/p/${rel}`,
    mtimeMs,
    pinned
  });

  it('keeps pinned files first in their own order', () => {
    const out = sortDocs([
      entry('a.md', 9),
      entry('README.md', 1, true),
      entry('CLAUDE.md', 0, true)
    ]);
    expect(out.map((e) => e.rel)).toEqual(['CLAUDE.md', 'README.md', 'a.md']);
  });
});

describe('isMarkdown / defaults', () => {
  it('accepts .md and .mdx only', () => {
    expect(isMarkdown('a.md')).toBe(true);
    expect(isMarkdown('a.MDX')).toBe(true);
    expect(isMarkdown('a.markdown')).toBe(false);
  });

  it('ships a default glob list', () => {
    expect(DEFAULT_DOC_GLOBS).toContain('docs/**');
  });
});
