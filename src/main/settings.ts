import { app } from 'electron';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { mergeSettings, migrateHookTargets, type Settings } from '../core/settings.js';
import type { TargetId } from '../core/hook-targets.js';

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

// Turn the old agentHooks master switch into the explicit hookTargets list,
// once, at boot. Writes only when there's something to convert, so a fresh
// install stays undecided and reaches the consent dialog. The legacy field is
// dropped in the same write (undefined doesn't survive JSON.stringify).
export function migrateHookSettings(available: TargetId[]): void {
  const ids = migrateHookTargets(getSettings(), available);
  if (!ids) return;
  console.log('[hooks] migrated agentHooks ->', ids.length > 0 ? ids.join(', ') : '(none)');
  saveSettings({ ...getSettings(), hookTargets: ids, agentHooks: undefined });
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
