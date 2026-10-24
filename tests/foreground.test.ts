import { describe, expect, it } from 'vitest';
import { tpgidFromProcStat, tpgidFromPs } from '../src/core/foreground.js';

describe('foreground process group parsers', () => {
  it('reads tpgid from /proc/<pid>/stat, whatever the command name holds', () => {
    expect(tpgidFromProcStat('4242 (zsh) S 4200 4242 4242 34816 4300 4194560 0')).toBe(4300);
    expect(tpgidFromProcStat('4242 (my (odd) name) S 4200 4242 4242 34816 4242 4194560')).toBe(4242);
    expect(tpgidFromProcStat('4242 (zsh) S 4200 4242 4242 0 -1 4194560')).toBeNull();
    expect(tpgidFromProcStat('')).toBeNull();
  });

  it('reads tpgid from ps output', () => {
    expect(tpgidFromPs(' 40643\n')).toBe(40643);
    expect(tpgidFromPs('')).toBeNull();
    expect(tpgidFromPs('0')).toBeNull();
  });
});
