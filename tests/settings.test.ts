import { describe, it, expect } from 'vitest';
import {
  mergeSettings,
  migrateHookTargets,
  parseTargetIds,
  DEFAULT_SETTINGS,
  type Settings
} from '../src/core/settings.js';

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
  // a field missing from it round-trips to undefined. For the hooks flag that
  // read as "on", which put the hooks back on the next launch after you'd
  // removed them. Every boolean defaulting to true must survive being false.
  it('round-trips every field, false included', () => {
    const saved: Settings = {
      telegram: { token: 't', chatId: '1', allowedChats: '1,2', lang: 'it' },
      defaultShell: '/bin/zsh',
      skipCloseConfirm: true,
      hookTargets: ['claude']
    };
    expect(mergeSettings(saved)).toEqual(saved);
    // …and again, as it would be on the next app start.
    expect(mergeSettings(mergeSettings(saved))).toEqual(saved);
  });

  // The three states are all meaningful and all different: never asked, asked
  // and said no, asked and picked something. Collapsing the first two would
  // either nag on every launch or install without an answer.
  it('keeps hookTargets undefined and empty apart', () => {
    expect(mergeSettings({}).hookTargets).toBeUndefined();
    expect(mergeSettings({ hookTargets: [] }).hookTargets).toEqual([]);
    expect(mergeSettings({ hookTargets: ['copilot'] }).hookTargets).toEqual(['copilot']);
  });

  it('drops ids it has no target for', () => {
    expect(parseTargetIds(['claude', 'codex', 42, null])).toEqual(['claude']);
    expect(parseTargetIds('claude')).toEqual([]);
    expect(parseTargetIds(undefined)).toEqual([]);
  });

  it('drops fields that are no longer part of Settings', () => {
    const legacy = { launchCmds: { claude: 'claude' } } as Partial<Settings>;
    expect(mergeSettings(legacy)).not.toHaveProperty('launchCmds');
  });
});

describe('migrateHookTargets', () => {
  // Someone upgrading already has the hooks in their config. Asking after the
  // fact would be theatre, so they're converted silently to the equivalent
  // explicit list — every agent they have installed right now.
  it('turns the old master switch into the installed agents', () => {
    expect(migrateHookTargets(mergeSettings({ agentHooks: true }), ['claude'], [])).toEqual([
      'claude'
    ]);
  });

  it('turns an opt-out into a recorded no', () => {
    expect(migrateHookTargets(mergeSettings({ agentHooks: false }), ['claude'], [])).toEqual([]);
  });

  // claudeHooks was the pre-Copilot name, read through mergeSettings. Someone
  // who had opted out under that name must not come back as opted in.
  it('honours the legacy claudeHooks name', () => {
    const legacy = mergeSettings({ claudeHooks: false } as Partial<Settings>);
    expect(migrateHookTargets(legacy, ['claude', 'copilot'], [])).toEqual([]);
  });

  // An opt-out beats what's on disk: entries still lying around are exactly
  // what the migration should record as unwanted, not as consent.
  it('keeps an opt-out even when entries are still in the config', () => {
    const optedOut = mergeSettings({ agentHooks: false });
    expect(migrateHookTargets(optedOut, ['claude'], ['claude'])).toEqual([]);
  });

  // <=0.7.0 had no switch and registered on every launch. On upgrade the hooks
  // are already in their config: asking would be a question about a done deal,
  // and a "no" would leave entries behind that Settings then denies.
  it('adopts what is already registered when the file has no switch at all', () => {
    expect(migrateHookTargets(mergeSettings({}), ['claude', 'copilot'], ['claude'])).toEqual([
      'claude'
    ]);
  });

  it('leaves a fresh install undecided, so the consent dialog runs', () => {
    expect(migrateHookTargets(mergeSettings({}), ['claude'], [])).toBeNull();
  });

  it('never overwrites an answer already given, empty included', () => {
    const declined = mergeSettings({ hookTargets: [] });
    expect(migrateHookTargets(declined, ['claude'], ['claude'])).toBeNull();
    const picked = mergeSettings({ hookTargets: ['claude'], agentHooks: false });
    expect(migrateHookTargets(picked, ['copilot'], [])).toBeNull();
  });
});
