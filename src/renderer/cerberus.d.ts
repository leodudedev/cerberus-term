import type { TerminalBridge } from '../core/terminal-bridge.js';
import type { ConfigBridge } from '../core/config-bridge.js';

declare global {
  interface Window {
    cerberus: TerminalBridge;
    cerberusConfig: ConfigBridge;
  }
}

export {};
