import { ipcMain } from 'electron';
import { getSettings, saveSettings, applySettingsToEnv } from './settings.js';
import {
  hooksStatus,
  installAgentHooks,
  uninstallAgentHooks
} from './cerberus/hook-install.js';
import type { Settings, SaveResult } from '../core/settings.js';

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', (): Settings => getSettings());

  ipcMain.handle('settings:save', (_e, s: Settings): SaveResult => {
    if (!s || typeof s !== 'object') return { ok: false, error: 'Invalid settings' };
    const wasEnabled = getSettings().agentHooks !== false;
    try {
      saveSettings(s);
      applySettingsToEnv(); // refresh env now; bot re-polls a new token on next launch
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }

    // Apply the hook toggle immediately: waiting for the next launch would leave
    // the settings saying one thing and the CLIs doing another.
    const nowEnabled = s.agentHooks !== false;
    if (process.platform !== 'win32' && nowEnabled !== wasEnabled) {
      if (nowEnabled) installAgentHooks();
      else {
        const res = uninstallAgentHooks();
        if (!res.ok) return { ok: false, error: res.error ?? 'Hook removal failed' };
      }
    }
    return { ok: true };
  });

  ipcMain.handle('settings:hooks-status', () => hooksStatus());
}
