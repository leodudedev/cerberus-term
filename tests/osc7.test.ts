import { describe, expect, it } from 'vitest';
import { extractOsc7Cwd } from '../src/core/osc7.js';

const ESC = '\x1b';
const BEL = '\x07';

const osc7 = (path: string, host = 'DESKTOP-01'): string =>
  `${ESC}]7;file://${host}/${path}${BEL}`;

describe('extractOsc7Cwd', () => {
  it('reads a plain path and returns it with Windows separators', () => {
    expect(extractOsc7Cwd(osc7('C:/Users/leo/dev'))).toBe('C:\\Users\\leo\\dev');
  });

  it('decodes percent-encoded segments', () => {
    expect(extractOsc7Cwd(osc7('C:/Users/leo/My%20Projects'))).toBe(
      'C:\\Users\\leo\\My Projects'
    );
  });

  it('decodes non-ASCII segments', () => {
    expect(extractOsc7Cwd(osc7('C:/Users/leo/citt%C3%A0'))).toBe('C:\\Users\\leo\\città');
  });

  it('keeps a segment whose encoding is malformed instead of dropping the path', () => {
    // A bare `%` the shell failed to encode would throw in decodeURIComponent.
    expect(extractOsc7Cwd(osc7('C:/Users/100%/logs'))).toBe('C:\\Users\\100%\\logs');
  });

  it('accepts an ST terminator as well as BEL', () => {
    const st = `${ESC}]7;file://HOST/C:/tmp${ESC}\\`;
    expect(extractOsc7Cwd(st)).toBe('C:\\tmp');
  });

  it('takes the last report in a chunk of several redraws', () => {
    const chunk = osc7('C:/one') + 'PS> ' + osc7('C:/two') + 'PS> ' + osc7('C:/three');
    expect(extractOsc7Cwd(chunk)).toBe('C:\\three');
  });

  it('finds the report among surrounding terminal output', () => {
    const chunk = `${ESC}[2J${ESC}[H` + osc7('C:/work') + `${ESC}[32mPS C:\\work>${ESC}[0m `;
    expect(extractOsc7Cwd(chunk)).toBe('C:\\work');
  });

  it('ignores the host, whatever COMPUTERNAME says', () => {
    expect(extractOsc7Cwd(osc7('C:/tmp', ''))).toBe('C:\\tmp');
    expect(extractOsc7Cwd(osc7('C:/tmp', 'a-very-long-machine-name'))).toBe('C:\\tmp');
  });

  it('returns undefined for output carrying no OSC 7', () => {
    expect(extractOsc7Cwd('just some output\n')).toBeUndefined();
    expect(extractOsc7Cwd(`${ESC}]0;a title${BEL}`)).toBeUndefined();
    expect(extractOsc7Cwd('')).toBeUndefined();
  });

  it('ignores an unterminated sequence, so a split chunk cannot report a truncated cwd', () => {
    expect(extractOsc7Cwd(`${ESC}]7;file://HOST/C:/Users/le`)).toBeUndefined();
  });

  it('is not affected by a previous call (no sticky lastIndex leak)', () => {
    const chunk = osc7('C:/same');
    expect(extractOsc7Cwd(chunk)).toBe('C:\\same');
    expect(extractOsc7Cwd(chunk)).toBe('C:\\same');
  });
});
