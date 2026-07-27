import type { TerminalBridge } from '../core/terminal-bridge.js';
import type { ConfigBridge } from '../core/config-bridge.js';
import type { SettingsBridge } from '../core/settings.js';
import type { MuteBridge } from '../core/mute-bridge.js';

export interface OpenPanePayload {
  file: string;
  title: string;
  cwd: string;
  format?: 'raw' | 'claude-stream';
  fmtPath?: string;
}

export type TabAction = 'new' | 'close' | 'next' | 'prev' | 'select';

// 'find' rides the Edit channel rather than a channel of its own: same menu,
// same one-way main -> renderer shape. Only copy/paste can fall back to
// Chromium, so editFallback still takes just those two.
export type EditAction = 'copy' | 'paste' | 'find';

export interface PaneAttentionPayload {
  pane: string;
  sessionId: string;
}

declare global {
  interface Window {
    cerberus: TerminalBridge;
    cerberusConfig: ConfigBridge;
    cerberusSettings: SettingsBridge;
    cerberusMute: MuteBridge;
    cerberusUI: {
      onOpenSettings(cb: () => void): void;
      onToggleTheme(cb: () => void): void;
      onOpenPane(cb: (p: OpenPanePayload) => void): void;
      onTab(cb: (action: TabAction, index?: number) => void): void;
      onPaneAttention(cb: (p: PaneAttentionPayload) => void): void;
      onEdit(cb: (action: EditAction, text?: string) => void): void;
      editFallback(action: EditAction): void;
      closeWindow(): void;
    };
  }
}

export {};
