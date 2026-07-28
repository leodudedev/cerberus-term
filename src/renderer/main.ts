import { Workspace } from './Workspace.js';
import { openSettingsEditor } from './SettingsEditor.js';
import { openHooksConsent } from './HooksConsent.js';
import { installKeymap, type CerberusAction } from './keymap.js';
import { applyPref, getPref, toggleTheme } from './themes.js';

// Theme first so the very first paint (and xterm) uses the right palette.
applyPref(getPref());

const host = document.querySelector<HTMLDivElement>('#app');

if (host) {
  const ws = new Workspace(host);
  void ws.start();

  // Per-pane header buttons (and Cmd+D/Cmd+K in Terminal) dispatch 'pane-cmd'.
  window.addEventListener('pane-cmd', (ev) => {
    const { cmd, leafId } = (ev as CustomEvent<{ cmd: string; leafId?: string }>).detail;
    ws.handlePaneCmd(cmd, leafId);
  });

  // Nothing has been written to any agent CLI's config yet if we've never
  // asked. Main answers null unless there's a real question, so this is a
  // no-op on every launch after the first.
  void (async () => {
    const targets = await window.cerberusSettings.hooksConsent();
    if (!targets) return;
    await window.cerberusSettings.setHookTargets(await openHooksConsent(targets));
  })();

  window.addEventListener('open-settings', () => void openSettingsEditor());
  // Native menu (Cmd+,) routes here — the reliable path on macOS.
  window.cerberusUI.onOpenSettings(() => void openSettingsEditor());

  // External driver (POST /pane) -> read-only follower pane.
  window.cerberusUI.onOpenPane((p) => ws.openFollowerPane(p));

  // Permission-hook fork: flash the requesting pane (and its tab chip).
  window.cerberusUI.onPaneAttention((p) => void ws.markPaneAttention(p.pane));

  // tmux-style keyboard control (leader Ctrl+B).
  installKeymap();
  window.addEventListener('cerberus-action', (ev) => {
    ws.handleCerberusAction((ev as CustomEvent<CerberusAction>).detail);
  });

  // Tab shortcuts routed from the native menu / main process.
  window.cerberusUI.onTab((action, index) => ws.handleTabAction(action, index));

  // Theme toggle (native menu View -> Toggle Theme).
  window.cerberusUI.onToggleTheme(() => toggleTheme());

  // Edit menu -> the focused terminal, or back to Chromium when no pane wants it
  // (settings modal inputs, or a copy with nothing selected).
  window.cerberusUI.onEdit((action, text) => {
    if (!ws.handleEdit(action, text)) window.cerberusUI.editFallback(action);
  });
}
