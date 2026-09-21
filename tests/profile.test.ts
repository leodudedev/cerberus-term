import { describe, it, expect } from 'vitest';
import { profileFromConfigDir } from '../src/core/profile.js';

describe('profileFromConfigDir', () => {
  it('falls back to claude when CLAUDE_CONFIG_DIR is unset', () => {
    expect(profileFromConfigDir(undefined)).toBe('claude');
    expect(profileFromConfigDir(null)).toBe('claude');
    expect(profileFromConfigDir('   ')).toBe('claude');
  });

  it('labels the default dir like the fallback', () => {
    expect(profileFromConfigDir('/Users/me/.claude')).toBe('claude');
  });

  it('names a second account after its config dir', () => {
    expect(profileFromConfigDir('/Users/me/.claude-work')).toBe('claude-work');
    expect(profileFromConfigDir('/Users/me/dev/.claude-oss')).toBe('claude-oss');
  });

  it('tolerates trailing separators and windows paths', () => {
    expect(profileFromConfigDir('/Users/me/.claude-work/')).toBe('claude-work');
    expect(profileFromConfigDir('C:\\Users\\me\\.claude-work')).toBe('claude-work');
  });

  it('never returns an empty label', () => {
    expect(profileFromConfigDir('/')).toBe('claude');
    expect(profileFromConfigDir('...')).toBe('claude');
  });

  it("falls back to a caller-given default, e.g. Codex's own", () => {
    expect(profileFromConfigDir(undefined, 'codex')).toBe('codex');
    expect(profileFromConfigDir('   ', 'codex')).toBe('codex');
    expect(profileFromConfigDir('/')).not.toBe('codex'); // default stays claude when omitted
  });

  it('still names a second account after its dir when a default is given', () => {
    expect(profileFromConfigDir('/Users/me/.codex-work', 'codex')).toBe('codex-work');
  });
});
