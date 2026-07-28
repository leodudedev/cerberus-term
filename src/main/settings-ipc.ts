import { ipcMain } from 'electron';
import { getSettings, saveSettings, applySettingsToEnv } from './settings.js';
import {
  claudeHooksStatus,
  installClaudeHooks,
  stableNotifyScript,
  uninstallClaudeHooks
} from './cerberus/hook-install.js';
import type { Settings, SaveResult } from '../core/settings.js';

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', (): Settings => getSettings());

  ipcMain.handle('settings:save', (_e, s: Settings): SaveResult => {
    if (!s || typeof s !== 'object') return { ok: false, error: 'Invalid settings' };
    const wasEnabled = getSettings().claudeHooks !== false;
    try {
      saveSettings(s);
      applySettingsToEnv(); // refresh env now; bot re-polls a new token on next launch
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }

    // Apply the hook toggle immediately: waiting for the next launch would leave
    // the settings.json saying one thing and Claude doing another.
    const nowEnabled = s.claudeHooks !== false;
    if (process.platform !== 'win32' && nowEnabled !== wasEnabled) {
      if (nowEnabled) installClaudeHooks(stableNotifyScript());
      else {
        const res = uninstallClaudeHooks();
        if (!res.ok) return { ok: false, error: res.error ?? 'Hook removal failed' };
      }
    }
    return { ok: true };
  });

  ipcMain.handle('settings:claude-hooks-status', () => claudeHooksStatus());
}
