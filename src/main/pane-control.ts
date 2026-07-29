import { paneExists, writeKeys, getPaneBuffer, paneForeground } from './bridge-electron.js';
import { sensitiveProcess } from '../core/sensitive-process.js';

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

// Name of the sensitive program holding the pane, '' when it is safe to type
// into. Call sites use it to say WHICH program refused the delivery; the send
// helpers below re-check it themselves, so a future call site can't quietly
// skip the guard. The read is a syscall, not a spawn — doing it twice is fine.
export function paneBlockedBy(pane: string): string {
  if (!pane) return '';
  return sensitiveProcess(paneForeground(pane));
}

// The three senders return false when the guard refused, so a caller that
// reports success can't do it for a keystroke that never landed.

// Send literal text into a pane (no trailing newline).
export async function sendText(pane: string, text: string): Promise<boolean> {
  if (paneBlockedBy(pane)) return false;
  writeKeys(pane, text);
  return true;
}

// Send a named key (e.g. "Enter", "Escape") into a pane.
export async function sendKey(pane: string, key: string): Promise<boolean> {
  if (paneBlockedBy(pane)) return false;
  writeKeys(pane, translateKey(key));
  return true;
}

// Type a prompt and submit it.
export async function sendPrompt(pane: string, text: string): Promise<boolean> {
  if (paneBlockedBy(pane)) return false;
  writeKeys(pane, text);
  writeKeys(pane, '\r');
  return true;
}

// ANSI-stripped tail of the pane's output (the live permission dialog).
export async function capturePane(pane: string): Promise<string> {
  if (!pane) return '';
  return getPaneBuffer(pane);
}
