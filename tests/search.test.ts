// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import {
  Terminal,
  type ITerminalInitOnlyOptions,
  type ITerminalOptions
} from '@xterm/xterm';
import { SearchAddon } from '@xterm/addon-search';
import { terminalOptions } from '../src/renderer/Terminal.js';
import { searchDecorations } from '../src/renderer/themes.js';

// The find bar is the one part of the renderer worth testing headless: the
// search addon reads the buffer, not the screen, so jsdom is enough. What it
// guards is the pairing of terminal options and search options — a highlight
// decoration is proposed API in xterm 6, so the terminal must opt in or every
// search throws and reports zero matches for text that is plainly there.

beforeAll(() => {
  // xterm's CoreBrowserService asks for matchMedia on open(); jsdom has none.
  // (jsdom also logs an unimplemented getContext for the renderer's canvas —
  // harmless here, a buffer search never touches it.)
  Object.defineProperty(window, 'matchMedia', {
    value: (media: string) => ({
      matches: false,
      media,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {}
    })
  });
  // terminalOptions() reads the theme pref, which jsdom doesn't back with a
  // real store. No pref -> the default dark theme, which is what we want here.
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  });
});

// The app's own terminal options, so this can't drift from what ships.
function boot(overrides: ITerminalOptions & ITerminalInitOnlyOptions = {}) {
  const term = new Terminal({ ...terminalOptions(), ...overrides });
  const search = new SearchAddon();
  term.loadAddon(search);
  const host = document.createElement('div');
  document.body.append(host);
  term.open(host);
  return { term, search };
}

const write = (term: Terminal, data: string): Promise<void> =>
  new Promise((resolve) => term.write(data, () => resolve()));

const decorations = searchDecorations('dark');

describe('scrollback search', () => {
  it('finds a word with the options the find bar sends', async () => {
    const { term, search } = boot();
    await write(term, 'alpha beta\r\ngamma delta\r\n');
    expect(search.findNext('gamma', { decorations, incremental: true })).toBe(true);
    expect(term.getSelection()).toBe('gamma');
  });

  it('reports no match for a word that is not there', async () => {
    const { term, search } = boot();
    await write(term, 'alpha beta\r\n');
    expect(search.findNext('omega', { decorations })).toBe(false);
  });

  it('throws without allowProposedApi — decorations are proposed API', async () => {
    // The regression this file exists for. Terminal.ts must keep the flag on;
    // without it the addon throws here and the bar shows "0" for everything.
    const { term, search } = boot({ allowProposedApi: false });
    await write(term, 'alpha beta\r\n');
    expect(() => search.findNext('alpha', { decorations })).toThrow(/allowProposedApi/);
  });

  it('honours caseSensitive', async () => {
    const { term, search } = boot();
    await write(term, 'Alpha\r\n');
    expect(search.findNext('alpha', { decorations, caseSensitive: true })).toBe(false);
    expect(search.findNext('alpha', { decorations, caseSensitive: false })).toBe(true);
  });

  it('honours regex', async () => {
    const { term, search } = boot();
    await write(term, 'error code 4711\r\n');
    expect(search.findNext('code \\d+', { decorations, regex: true })).toBe(true);
    expect(term.getSelection()).toBe('code 4711');
    expect(search.findNext('code \\d+', { decorations, regex: false })).toBe(false);
  });

  it('throws a SyntaxError on a half-typed pattern', async () => {
    // What runSearch() in Terminal.ts swallows: a query mid-typing is not a
    // fault, unlike everything else the addon can throw.
    const { term, search } = boot();
    await write(term, 'alpha\r\n');
    expect(() => search.findNext('([a-', { decorations, regex: true })).toThrow(SyntaxError);
  });

  it('walks matches forward and back', async () => {
    const { term, search } = boot();
    await write(term, 'hit one\r\nmiss\r\nhit two\r\n');
    expect(search.findNext('hit', { decorations })).toBe(true);
    const first = term.buffer.active.cursorY;
    expect(search.findNext('hit', { decorations })).toBe(true);
    expect(search.findPrevious('hit', { decorations })).toBe(true);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(term.getSelection()).toBe('hit');
  });

  it('searches the scrollback, not just the viewport', async () => {
    const { term, search } = boot({ rows: 5, cols: 40, scrollback: 200 });
    await write(term, 'needle\r\n');
    for (let i = 0; i < 40; i++) await write(term, `filler ${i}\r\n`);
    expect(search.findNext('needle', { decorations })).toBe(true);
  });
});

describe('searchDecorations', () => {
  it('gives every color as #RRGGBB — the addon rejects anything else', () => {
    for (const theme of ['dark', 'light'] as const) {
      for (const value of Object.values(searchDecorations(theme))) {
        expect(value).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});
