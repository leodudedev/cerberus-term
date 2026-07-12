import { paneExists, writeKeys, getPaneBuffer } from './bridge-electron.js';

// Native replacement for tmux.ts: same signatures the copied daemon/bot expect,
// but "pane" is our pty paneId and everything goes through the bridge — no
// `tmux send-keys`, no `capture-pane`. Async kept to match the old interface.

// Map a tmux-style key name to the bytes a pty expects.
function translateKey(key: string): string {
  switch (key) {
    case 'Enter':
      return '\r';
    case 'Escape':
      return '\x1b';
    case 'Tab':
      return '\t';
    case 'Space':
      return ' ';
    case 'BSpace':
      return '\x7f';
    case 'Up':
      return '\x1b[A';
    case 'Down':
      return '\x1b[B';
    case 'Right':
      return '\x1b[C';
    case 'Left':
      return '\x1b[D';
    default:
      // literal digits/letters and anything else pass through as-is
      return key;
  }
}

export async function paneAlive(pane: string): Promise<boolean> {
  return !!pane && paneExists(pane);
}

// Send literal text into a pane (no trailing newline).
export async function sendText(pane: string, text: string): Promise<void> {
  writeKeys(pane, text);
}

// Send a named key (e.g. "Enter", "Escape") into a pane.
export async function sendKey(pane: string, key: string): Promise<void> {
  writeKeys(pane, translateKey(key));
}

// Type a prompt and submit it.
export async function sendPrompt(pane: string, text: string): Promise<void> {
  writeKeys(pane, text);
  writeKeys(pane, '\r');
}

// ANSI-stripped tail of the pane's output (the live permission dialog).
export async function capturePane(pane: string): Promise<string> {
  if (!pane) return '';
  return getPaneBuffer(pane);
}
