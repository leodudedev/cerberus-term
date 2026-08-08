import { describe, expect, it } from 'vitest';
import { parseLsofCwds } from '../src/core/lsof.js';

describe('parseLsofCwds', () => {
  it('maps every pid in the batch to its cwd', () => {
    const out = parseLsofCwds('p4711\nn/Users/leo/dev\np4712\nn/Users/leo\n');
    expect(out.get(4711)).toBe('/Users/leo/dev');
    expect(out.get(4712)).toBe('/Users/leo');
    expect(out.size).toBe(2);
  });

  it('handles a single process, the one-pane case', () => {
    expect(parseLsofCwds('p900\nn/tmp\n').get(900)).toBe('/tmp');
  });

  it('keeps paths containing spaces intact', () => {
    expect(parseLsofCwds('p1\nn/Users/leo/My Projects/app\n').get(1)).toBe(
      '/Users/leo/My Projects/app'
    );
  });

  it('skips a pid that reported no cwd instead of shifting it onto the next one', () => {
    // 4711 is unreadable (lsof printed the process but no file), 4712 is fine.
    const out = parseLsofCwds('p4711\np4712\nn/Users/leo\n');
    expect(out.has(4711)).toBe(false);
    expect(out.get(4712)).toBe('/Users/leo');
  });

  it('ignores field lines other than p and n', () => {
    const out = parseLsofCwds('p4711\nfcwd\na \nn/Users/leo/dev\n');
    expect(out.get(4711)).toBe('/Users/leo/dev');
    expect(out.size).toBe(1);
  });

  it('ignores an n line before any p line', () => {
    expect(parseLsofCwds('n/orphan\np5\nn/real\n').size).toBe(1);
  });

  it('keeps the first cwd when a process somehow reports two files', () => {
    expect(parseLsofCwds('p7\nn/first\nn/second\n').get(7)).toBe('/first');
  });

  it('returns an empty map for empty or non-field output', () => {
    expect(parseLsofCwds('').size).toBe(0);
    expect(parseLsofCwds('lsof: WARNING: something\n').size).toBe(0);
  });

  it('ignores a malformed pid line', () => {
    expect(parseLsofCwds('pnotanumber\nn/Users/leo\n').size).toBe(0);
  });
});
