import { app, type BrowserWindow } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { applySettingsToEnv } from '../settings.js';
import { loadEnvFile } from './env.js';
import { installClaudeHooks } from './hook-install.js';
import { startDaemon } from './daemon.js';

// Boot the Cerberus remote-control core from the Electron main process:
// load Telegram creds, point persistence at userData, install CLI hooks,
// start the loopback daemon + Telegram bot.
export function startCerberus(getWindow: () => BrowserWindow | null): void {
  loadEnvFile(); // dev fallback: fills only missing env
  applySettingsToEnv(); // in-app settings override .env
  // persist uses a stable ~/.cerberus-term path resolved at import time, so
  // registry/mute rehydrate correctly across restarts (no setStatePath needed).

  // Dev: resources/ under the repo root. Packaged: extraResources land in
  // process.resourcesPath (outside the asar, so the shell can exec them).
  const base = app.isPackaged
    ? process.resourcesPath
    : join(app.getAppPath(), 'resources');
  const notifyScript = join(base, 'hooks', 'notify.sh');
  if (existsSync(notifyScript)) {
    installClaudeHooks(notifyScript);
  } else {
    console.error('[cerberus] notify.sh not found at', notifyScript);
  }

  startDaemon(getWindow);
}
