import { describe, expect, it } from 'vitest';
import { docKind, textLanguage } from '../src/core/docs-bridge.js';

describe('docKind', () => {
  it('renders markdown and shows known text files verbatim', () => {
    expect(docKind('/p/README.md')).toBe('markdown');
    expect(docKind('/p/page.MDX')).toBe('markdown');
    for (const name of ['LICENSE', 'licence', 'COPYING', 'Makefile', 'LICENSE-MIT', 'LICENSE.txt', 'install.sh', 'a.json', 'b.yml']) {
      expect(docKind(`/p/${name}`), name).toBe('text');
    }
    expect(docKind('C:\\p\\scripts\\setup.ps1')).toBe('text');
  });

  it('refuses dotfiles, binaries and unknown types', () => {
    for (const name of ['.env', '.env.example', '.npmrc', 'shot.png', 'app.exe', 'examples', 'archive.tar.gz', 'constructor', '__proto__']) {
      expect(docKind(`/p/${name}`), name).toBeNull();
    }
  });
});

describe('textLanguage', () => {
  it('maps to a highlight.js language, or none', () => {
    expect(textLanguage('/p/install.sh')).toBe('bash');
    expect(textLanguage('/p/Makefile')).toBe('makefile');
    expect(textLanguage('/p/LICENSE')).toBe('');
    expect(textLanguage('/p/notes.txt')).toBe('');
    expect(textLanguage('/p/constructor')).toBe('');
  });
});
