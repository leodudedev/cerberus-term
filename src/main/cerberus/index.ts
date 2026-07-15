import { app, type BrowserWindow } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { applySettingsToEnv } from '../settings.js';
import { loadEnvFile } from './env.js';
import { installClaudeHooks, syncHookScripts } from './hook-install.js';
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
  const bundledHooks = join(base, 'hooks');
  if (existsSync(join(bundledHooks, 'notify.sh'))) {
    // Copy the scripts to a stable ~/.cerberus-term/hooks and register THAT
    // path: hooks run in every Claude session, so a path inside the .app would
    // break them all if the app is moved/removed.
    try {
      const stableNotify = syncHookScripts(bundledHooks);
      installClaudeHooks(stableNotify);
    } catch (e) {
      console.error('[cerberus] hook sync failed:', (e as Error).message);
    }
  } else {
    console.error('[cerberus] bundled hooks not found at', bundledHooks);
  }

  // jq program for the claude-stream follower projection (shipped as a resource
  // so its non-ASCII-free markers never travel as a string through the pty).
  const fmtPath = join(base, 'bin', 'claude-stream.jq');

  startDaemon(getWindow, { fmtPath });
}
