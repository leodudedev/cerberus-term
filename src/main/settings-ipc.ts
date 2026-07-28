import { ipcMain } from 'electron';
import { getSettings, saveSettings, applySettingsToEnv } from './settings.js';
import { hooksStatus, installAgentHooks, uninstallAgentHooks } from './cerberus/hook-install.js';
import { parseTargetIds } from '../core/settings.js';
import type { Settings, SaveResult, HookTargetStatus } from '../core/settings.js';
import type { TargetId } from '../core/hook-targets.js';

// Bash hooks can't run there, so nothing is ever registered and nothing should
// be asked. Kept in one place so the three handlers agree.
const canInstall = (): boolean => process.platform !== 'win32';

// Apply a change to the ticked-agents list to the config files themselves.
// Only the difference: an agent that stayed ticked is left completely alone.
function applyTargetDiff(before: TargetId[], after: TargetId[]): SaveResult {
  if (!canInstall()) return { ok: true };
  const added = after.filter((id) => !before.includes(id));
  const dropped = before.filter((id) => !after.includes(id));
  if (added.length > 0) installAgentHooks(added);
  if (dropped.length > 0) {
    const res = uninstallAgentHooks(dropped);
    if (!res.ok) return { ok: false, error: res.error ?? 'Hook removal failed' };
  }
  return { ok: true };
}

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', (): Settings => getSettings());

  ipcMain.handle('settings:save', (_e, s: Settings): SaveResult => {
    if (!s || typeof s !== 'object') return { ok: false, error: 'Invalid settings' };
    const before = getSettings().hookTargets ?? [];
    const after = parseTargetIds(s.hookTargets);
    try {
      saveSettings({ ...s, hookTargets: after });
      applySettingsToEnv(); // refresh env now; bot re-polls a new token on next launch
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }

    // Apply the hook changes immediately: waiting for the next launch would
    // leave the settings saying one thing and the CLIs doing another.
    return applyTargetDiff(before, after);
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
    if (canInstall() && chosen.length > 0) installAgentHooks(chosen);
    return { ok: true };
  });
}
