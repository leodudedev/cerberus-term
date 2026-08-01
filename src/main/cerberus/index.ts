import { app, type BrowserWindow } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { applySettingsToEnv, getSettings, migrateHookSettings } from '../settings.js';
import { loadEnvFile } from './env.js';
import {
  availableTargets,
  hookPlatform,
  installAgentHooks,
  installedTargets,
  syncHookScripts
} from './hook-install.js';
import { HOOK_TARGETS } from '../../core/hook-targets.js';
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

  // One hook script per platform: POSIX shell for macOS and Linux, PowerShell
  // for Windows. A target that has no script for this platform isn't registered
  // at all, so its absence here isn't an error — a missing script for one we DO
  // register is, because the entry would point at nothing on every tool call.
  const bundledHooks = join(base, 'hooks');
  const platform = hookPlatform();
  const bundled = HOOK_TARGETS.filter(
    (t) => t.supported(platform) && existsSync(join(bundledHooks, t.script(platform)))
  );
  if (bundled.length === 0) {
    console.error('[cerberus] bundled hooks not found at', bundledHooks);
  } else {
    try {
      // Copy the scripts to a stable ~/.cerberus-term/hooks and register THAT
      // path: hooks run in every session of that CLI, so a path inside the .app
      // would break them all if the app is moved/removed. Refreshed even when
      // nothing is registered, so a hand-written entry pointing at them works.
      syncHookScripts(bundledHooks);
      migrateHookSettings(availableTargets(), installedTargets());

      // Only what someone ticked, and nothing at all until they've been asked:
      // these are other tools' config files, so an undecided install writes to
      // none of them. The renderer opens the consent dialog on first window.
      const ids = getSettings().hookTargets;
      if (ids) installAgentHooks(ids);
      else console.log('[cerberus] agent hooks undecided — asking on first window');
    } catch (e) {
      console.error('[cerberus] hook sync failed:', (e as Error).message);
    }
  }

  // jq program for the claude-stream follower projection (shipped as a resource
  // so its non-ASCII-free markers never travel as a string through the pty).
  const fmtPath = join(base, 'bin', 'claude-stream.jq');

  startDaemon(getWindow, { fmtPath });
}
