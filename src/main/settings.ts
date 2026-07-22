import { app } from 'electron';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type Settings } from '../core/settings.js';

// Global settings store: userData/cerberus-settings.json, cached, deep-merged
// over defaults. In-app values override .env (applySettingsToEnv force-sets).

let cached: Settings | null = null;

function file(): string {
  return join(app.getPath('userData'), 'cerberus-settings.json');
}

function merge(parsed: Partial<Settings>): Settings {
  return {
    telegram: { ...DEFAULT_SETTINGS.telegram, ...(parsed.telegram ?? {}) },
    launchCmds: { ...DEFAULT_SETTINGS.launchCmds, ...(parsed.launchCmds ?? {}) },
    defaultShell: parsed.defaultShell ?? DEFAULT_SETTINGS.defaultShell,
    skipCloseConfirm: parsed.skipCloseConfirm ?? DEFAULT_SETTINGS.skipCloseConfirm
  };
}

export function getSettings(): Settings {
  if (cached) return cached;
  try {
    cached = merge(JSON.parse(readFileSync(file(), 'utf8')) as Partial<Settings>);
  } catch {
    cached = merge({});
  }
  return cached;
}

export function saveSettings(s: Settings): void {
  cached = merge(s);
  const path = file();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(cached, null, 2));
  renameSync(tmp, path); // atomic
}

// Force-set the env the daemon/bot read, so in-app settings win over .env.
export function applySettingsToEnv(): void {
  const tg = getSettings().telegram;
  if (tg.token) process.env['TELEGRAM_BOT_TOKEN'] = tg.token;
  if (tg.chatId) process.env['TELEGRAM_CHAT_ID'] = tg.chatId;
  if (tg.allowedChats) process.env['TELEGRAM_ALLOWED_CHATS'] = tg.allowedChats;
  if (tg.lang) process.env['CERBERUS_LANG'] = tg.lang;
}
