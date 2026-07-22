import type { TerminalBridge } from '../core/terminal-bridge.js';
import type { ConfigBridge } from '../core/config-bridge.js';
import type { SettingsBridge } from '../core/settings.js';

export interface OpenPanePayload {
  file: string;
  title: string;
  cwd: string;
  format?: 'raw' | 'claude-stream';
  fmtPath?: string;
}

export type TabAction = 'new' | 'close' | 'next' | 'prev' | 'select';

export interface PaneAttentionPayload {
  pane: string;
  sessionId: string;
}

declare global {
  interface Window {
    cerberus: TerminalBridge;
    cerberusConfig: ConfigBridge;
    cerberusSettings: SettingsBridge;
    cerberusUI: {
      onOpenSettings(cb: () => void): void;
      onToggleTheme(cb: () => void): void;
      onOpenPane(cb: (p: OpenPanePayload) => void): void;
      onTab(cb: (action: TabAction, index?: number) => void): void;
      onPaneAttention(cb: (p: PaneAttentionPayload) => void): void;
      closeWindow(): void;
    };
  }
}

export {};
