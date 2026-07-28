import { ipcMain } from 'electron';
import { getSettings, saveSettings, applySettingsToEnv } from './settings.js';
import { hooksStatus, installAgentHooks, uninstallAgentHooks } from './cerberus/hook-install.js';
import { parseTargetIds } from '../core/settings.js';
import type { Settings, SaveResult, HookTargetStatus } from '../core/settings.js';
import { HOOK_TARGETS, type TargetId } from '../core/hook-targets.js';

// Bash hooks can't run there, so nothing is ever registered and nothing should
// be asked. Kept in one place so the three handlers agree.
const canInstall = (): boolean => process.platform !== 'win32';

// Converge the config files onto the ticked list: register every agent in it,
// strip our entries from every agent that isn't. Deliberately not a diff
// against the previously ticked list — computing one is how the first-run
// answer ended up installing nothing, and it buys nothing anyway: both halves
// already no-op when the file matches, so an agent that didn't change is never
// rewritten. Sweeping the untouched ones also keeps a "no" true of the disk and
// not just of the settings.
function applyHookTargets(chosen: TargetId[]): SaveResult {
  if (!canInstall()) return { ok: true };
  installAgentHooks(chosen);
  const rest = HOOK_TARGETS.map((t) => t.id).filter((id) => !chosen.includes(id));
  const res = uninstallAgentHooks(rest);
  if (!res.ok) return { ok: false, error: res.error ?? 'Hook removal failed' };
  return { ok: true };
}

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', (): Settings => getSettings());

  ipcMain.handle('settings:save', (_e, s: Settings): SaveResult => {
    if (!s || typeof s !== 'object') return { ok: false, error: 'Invalid settings' };
    const chosen = parseTargetIds(s.hookTargets);
    try {
      saveSettings({ ...s, hookTargets: chosen });
      applySettingsToEnv(); // refresh env now; bot re-polls a new token on next launch
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }

    // Apply the hook changes immediately: waiting for the next launch would
    // leave the settings saying one thing and the CLIs doing another.
    return applyHookTargets(chosen);
  });

  ipcMain.handle('settings:hooks-status', (): HookTargetStatus[] => hooksStatus());

  // Null means don't ask: already decided (empty list included), no agent CLI
  // installed here, or a platform we never register on. Asking about an agent
  // that isn't there would be a question about nothing — and answering it would
  // freeze a decision the user can't yet make sense of.
  ipcMain.handle('settings:hooks-consent', (): HookTargetStatus[] | null => {
    if (!canInstall() || getSettings().hookTargets) return null;
    const available = hooksStatus().filter((t) => t.available);
    return available.length > 0 ? available : null;
  });

  ipcMain.handle('settings:hooks-consent-set', (_e, ids: unknown): SaveResult => {
    const chosen = parseTargetIds(ids);
    try {
      // Written before installing: if the install half-fails we must not ask
      // again on the next launch and re-run it behind their back.
      saveSettings({ ...getSettings(), hookTargets: chosen, agentHooks: undefined });
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    return applyHookTargets(chosen);
  });
}
