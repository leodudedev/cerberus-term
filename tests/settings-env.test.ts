import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ dir: '' }));
vi.mock('electron', () => ({ app: { getPath: () => state.dir } }));
state.dir = mkdtempSync(join(tmpdir(), 'cerberus-settings-'));

import { applySettingsToEnv, getSettings, saveSettings } from '../src/main/settings.js';

const KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_ALLOWED_CHATS', 'CERBERUS_LANG'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterAll(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(state.dir, { recursive: true, force: true });
});

const setTelegram = (telegram: Record<string, string>) => saveSettings({ ...getSettings(), telegram });

describe('applySettingsToEnv', () => {
  it('applies removals, falling back to what the environment held at launch', () => {
    for (const k of KEYS) delete process.env[k];
    process.env['TELEGRAM_CHAT_ID'] = 'launch-chat'; // e.g. from the dev .env file

    setTelegram({ token: 'tok-1', chatId: 'chat-1', allowedChats: '5,6' });
    applySettingsToEnv();
    expect(process.env['TELEGRAM_BOT_TOKEN']).toBe('tok-1');
    expect(process.env['TELEGRAM_CHAT_ID']).toBe('chat-1');
    expect(process.env['TELEGRAM_ALLOWED_CHATS']).toBe('5,6');

    // Cleared in Settings: gone now, not on the next launch.
    setTelegram({ token: '', chatId: '', allowedChats: '' });
    applySettingsToEnv();
    expect(process.env['TELEGRAM_BOT_TOKEN']).toBeUndefined();
    expect(process.env['TELEGRAM_ALLOWED_CHATS']).toBeUndefined();
    // Not a value from Settings: the launch environment's own, as a restart would see it.
    expect(process.env['TELEGRAM_CHAT_ID']).toBe('launch-chat');
  });
});
