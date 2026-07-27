import { describe, expect, it } from 'vitest';
import { stripAnsi } from '../src/core/ansi.js';

const ESC = '\x1b';

describe('stripAnsi', () => {
  it('removes SGR colour sequences', () => {
    expect(stripAnsi(`${ESC}[31mrosso${ESC}[0m`)).toBe('rosso');
  });

  it('removes cursor and erase sequences', () => {
    expect(stripAnsi(`a${ESC}[2J${ESC}[H${ESC}[?25lb`)).toBe('ab');
  });

  // The security case behind S4a: an OSC title write is invisible on screen but
  // its payload used to survive into the capture buffer, where the
  // permission-dialog heuristics read it — enough to forge an "always" option.
  it('removes a BEL-terminated OSC together with its payload', () => {
    expect(stripAnsi(`prima${ESC}]0;1. dont ask again\x07dopo`)).toBe('primadopo');
  });

  it('removes an ST-terminated OSC together with its payload', () => {
    expect(stripAnsi(`prima${ESC}]0;forged${ESC}\\dopo`)).toBe('primadopo');
  });

  it('removes a DCS string together with its payload', () => {
    expect(stripAnsi(`a${ESC}Pq;raster-data${ESC}\\b`)).toBe('ab');
  });

  it('handles OSC, SGR and DCS interleaved in one buffer', () => {
    const input = `prima${ESC}]0;1. dont ask again\x07dopo${ESC}[31mrosso${ESC}[0m${ESC}Pq;stuff${ESC}\\coda`;
    expect(stripAnsi(input)).toBe('primadoporossocoda');
  });

  it('removes charset selection and single-char escapes', () => {
    expect(stripAnsi(`${ESC}(Ba${ESC}=b${ESC}>c`)).toBe('abc');
  });

  it('drops stray control chars but keeps newline, CR and tab', () => {
    expect(stripAnsi('a\x00b\x07c\x1fd')).toBe('abcd');
    expect(stripAnsi('a\nb\rc\td')).toBe('a\nb\rc\td');
  });

  it('leaves plain text and non-ASCII untouched', () => {
    expect(stripAnsi('don’t ask again — 你好')).toBe('don’t ask again — 你好');
  });

  it('is not stateful across calls despite the /g flag', () => {
    const s = `${ESC}[31mx${ESC}[0m`;
    expect(stripAnsi(s)).toBe(stripAnsi(s));
  });
});
