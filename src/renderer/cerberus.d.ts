import type { TerminalBridge } from '../core/terminal-bridge.js';

declare global {
  interface Window {
    cerberus: TerminalBridge;
  }
}

export {};
