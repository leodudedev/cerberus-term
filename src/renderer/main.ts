import { Workspace } from './Workspace.js';
import { openSettingsEditor } from './SettingsEditor.js';
import { installKeymap, type CerberusAction } from './keymap.js';
import { applyPref, getPref, toggleTheme } from './themes.js';

// Theme first so the very first paint (and xterm) uses the right palette.
applyPref(getPref());

const host = document.querySelector<HTMLDivElement>('#app');

if (host) {
  const ws = new Workspace(host);
  ws.start();

  // Per-pane header buttons (and Cmd+D/Cmd+K in Terminal) dispatch 'pane-cmd'.
  window.addEventListener('pane-cmd', (ev) => {
    const { cmd, leafId } = (ev as CustomEvent<{ cmd: string; leafId?: string }>).detail;
    ws.handlePaneCmd(cmd, leafId);
  });

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
}
