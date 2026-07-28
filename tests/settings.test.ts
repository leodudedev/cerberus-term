import { describe, it, expect } from 'vitest';
import { mergeSettings, DEFAULT_SETTINGS, type Settings } from '../src/core/settings.js';

describe('mergeSettings', () => {
  it('fills an empty object with the defaults', () => {
    expect(mergeSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps telegram fields that are set and defaults the rest', () => {
    const s = mergeSettings({ telegram: { token: 'abc' } });
    expect(s.telegram.token).toBe('abc');
    expect(s.telegram.chatId).toBeUndefined();
  });

  // The bug this file exists for: merge rebuilds the object field by field, so
  // a field missing from it round-trips to undefined. For claudeHooks that read
  // as "on", which put the hooks back on the next launch after you'd removed
  // them. Every boolean that defaults to true has to survive being set false.
  it('round-trips every field, false included', () => {
    const saved: Settings = {
      telegram: { token: 't', chatId: '1', allowedChats: '1,2', lang: 'it' },
      defaultShell: '/bin/zsh',
      skipCloseConfirm: true,
      claudeHooks: false
    };
    expect(mergeSettings(saved)).toEqual(saved);
    // …and again, as it would be on the next app start.
    expect(mergeSettings(mergeSettings(saved))).toEqual(saved);
  });

  it('defaults claudeHooks to on only when it was never set', () => {
    expect(mergeSettings({}).claudeHooks).toBe(true);
    expect(mergeSettings({ claudeHooks: false }).claudeHooks).toBe(false);
  });

  it('drops fields that are no longer part of Settings', () => {
    const legacy = { launchCmds: { claude: 'claude' } } as Partial<Settings>;
    expect(mergeSettings(legacy)).not.toHaveProperty('launchCmds');
  });
});
