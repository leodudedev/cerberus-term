import {
  paneExists,
  writeKeys,
  getPaneBuffer,
  paneForeground,
  paneConsoleProcesses
} from './bridge-electron.js';
import { sensitiveProcess, firstSensitiveProcess } from '../core/sensitive-process.js';

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

// On POSIX reading the foreground process is a syscall, so the double-check
// below costs nothing. On Windows it's a fork plus a tasklist, and a single
// Telegram delivery asks twice — once to name the blocker in the refusal, once
// inside the sender. This window is short enough that nothing can start and
// take over a pane inside it, and long enough to make the second read free.
const GUARD_CACHE_MS = 500;
const guardCache = new Map<string, { at: number; blocked: string }>();

// Name of the sensitive program holding the pane, '' when it is safe to type
// into. Call sites use it to say WHICH program refused the delivery; the send
// helpers below re-check it themselves, so a future call site can't quietly
// skip the guard.
//
// Async only because of Windows: there the answer is a set of process names
// read out of process, not a single value read from the tty. Both branches fail
// open. See core/sensitive-process.ts and main/win-console.ts.
export async function paneBlockedBy(pane: string): Promise<string> {
  if (!pane) return '';
  if (process.platform !== 'win32') return sensitiveProcess(paneForeground(pane));

  const now = Date.now();
  const hit = guardCache.get(pane);
  if (hit && now - hit.at < GUARD_CACHE_MS) return hit.blocked;

  const blocked = firstSensitiveProcess(await paneConsoleProcesses(pane));
  guardCache.set(pane, { at: now, blocked });
  // Panes are few, but they're created and killed for the life of the app —
  // drop what's already expired instead of growing forever.
  if (guardCache.size > 64) {
    for (const [k, v] of guardCache) if (now - v.at >= GUARD_CACHE_MS) guardCache.delete(k);
  }
  return blocked;
}

// The three senders return false when the guard refused, so a caller that
// reports success can't do it for a keystroke that never landed.

// Send literal text into a pane (no trailing newline).
export async function sendText(pane: string, text: string): Promise<boolean> {
  if (await paneBlockedBy(pane)) return false;
  writeKeys(pane, text);
  return true;
}

// Send a named key (e.g. "Enter", "Escape") into a pane.
export async function sendKey(pane: string, key: string): Promise<boolean> {
  if (await paneBlockedBy(pane)) return false;
  writeKeys(pane, translateKey(key));
  return true;
}

// Type a prompt and submit it.
export async function sendPrompt(pane: string, text: string): Promise<boolean> {
  if (await paneBlockedBy(pane)) return false;
  writeKeys(pane, text);
  writeKeys(pane, '\r');
  return true;
}

// ANSI-stripped tail of the pane's output (the live permission dialog).
export async function capturePane(pane: string): Promise<string> {
  if (!pane) return '';
  return getPaneBuffer(pane);
}
