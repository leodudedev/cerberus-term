import { app } from 'electron';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import {
  mergeSettings,
  migrateHookTargets,
  isPreWindowsConsent,
  type Settings
} from '../core/settings.js';
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
export function migrateHookSettings(available: TargetId[], installed: TargetId[]): void {
  // Drop a Windows answer given while we couldn't install, so the consent
  // dialog gets to ask it for real. Done before the agentHooks migration so
  // that one sees an undecided install, which is what it is.
  if (isPreWindowsConsent(getSettings(), process.platform)) {
    console.log('[hooks] discarding a hook answer recorded before Windows support — asking again');
    saveSettings({ ...getSettings(), hookTargets: undefined });
  }

  const ids = migrateHookTargets(getSettings(), available, installed);
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

// What the environment held before any setting was applied: the shell's env
// plus the dev .env file. Captured once, on the first apply, so a field cleared
// in Settings falls back to it — the same value the next launch would use —
// instead of keeping whatever the field said before it was cleared.
type EnvKey = 'TELEGRAM_BOT_TOKEN' | 'TELEGRAM_CHAT_ID' | 'TELEGRAM_ALLOWED_CHATS' | 'CERBERUS_LANG';
let launchEnv: Record<EnvKey, string | undefined> | null = null;

// Make the env the daemon/bot read match the settings, so in-app settings win
// over .env. Removals count as much as values: clearing the token or a chat in
// Settings has to stop the bot or revoke the chat now, not on the next launch.
export function applySettingsToEnv(): void {
  launchEnv ??= {
    TELEGRAM_BOT_TOKEN: process.env['TELEGRAM_BOT_TOKEN'],
    TELEGRAM_CHAT_ID: process.env['TELEGRAM_CHAT_ID'],
    TELEGRAM_ALLOWED_CHATS: process.env['TELEGRAM_ALLOWED_CHATS'],
    CERBERUS_LANG: process.env['CERBERUS_LANG']
  };
  const tg = getSettings().telegram;
  const effective: Record<EnvKey, string | undefined> = {
    TELEGRAM_BOT_TOKEN: tg.token || launchEnv.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: tg.chatId || launchEnv.TELEGRAM_CHAT_ID,
    TELEGRAM_ALLOWED_CHATS: tg.allowedChats || launchEnv.TELEGRAM_ALLOWED_CHATS,
    CERBERUS_LANG: tg.lang || launchEnv.CERBERUS_LANG
  };
  for (const [key, value] of Object.entries(effective)) {
    if (value) process.env[key] = value;
    else delete process.env[key];
  }
}
