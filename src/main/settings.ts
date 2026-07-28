import { app } from 'electron';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { mergeSettings, type Settings } from '../core/settings.js';

// Global settings store: userData/cerberus-settings.json, cached, deep-merged
// over defaults. In-app values override .env (applySettingsToEnv force-sets).

let cached: Settings | null = null;

function file(): string {
  return join(app.getPath('userData'), 'cerberus-settings.json');
}

export function getSettings(): Settings {
  if (cached) return cached;
  try {
    cached = mergeSettings(JSON.parse(readFileSync(file(), 'utf8')) as Partial<Settings>);
  } catch {
    cached = mergeSettings({});
  }
  return cached;
}

export function saveSettings(s: Settings): void {
  cached = mergeSettings(s);
  const path = file();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(cached, null, 2));
  renameSync(tmp, path); // atomic
}

// Does the bot have what it needs to push at all? Same pair initBot() checks,
// read from settings first because the env is only populated once startCerberus
// runs — the renderer can ask earlier than that.
export function telegramConfigured(): boolean {
  const tg = getSettings().telegram;
  const token = tg.token || process.env['TELEGRAM_BOT_TOKEN'];
  const chatId = tg.chatId || process.env['TELEGRAM_CHAT_ID'];
  return Boolean(token && chatId);
}

// Force-set the env the daemon/bot read, so in-app settings win over .env.
export function applySettingsToEnv(): void {
  const tg = getSettings().telegram;
  if (tg.token) process.env['TELEGRAM_BOT_TOKEN'] = tg.token;
  if (tg.chatId) process.env['TELEGRAM_CHAT_ID'] = tg.chatId;
  if (tg.allowedChats) process.env['TELEGRAM_ALLOWED_CHATS'] = tg.allowedChats;
  if (tg.lang) process.env['CERBERUS_LANG'] = tg.lang;
}
