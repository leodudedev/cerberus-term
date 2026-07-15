import type { TerminalBridge } from '../core/terminal-bridge.js';
import type { ConfigBridge } from '../core/config-bridge.js';
import type { SettingsBridge } from '../core/settings.js';

declare global {
  interface Window {
    cerberus: TerminalBridge;
    cerberusConfig: ConfigBridge;
    cerberusSettings: SettingsBridge;
    cerberusUI: {
      onOpenSettings(cb: () => void): void;
      onToggleTheme(cb: () => void): void;
      onOpenPane(
        cb: (p: {
          file: string;
          title: string;
          cwd: string;
          format?: 'raw' | 'claude-stream';
          fmtPath?: string;
        }) => void
      ): void;
    };
  }
}

export {};
