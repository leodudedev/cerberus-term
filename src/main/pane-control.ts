import {
  paneExists,
  writeKeys,
  getPaneBuffer,
  paneForeground,
  paneConsoleProcesses,
  paneShellInForeground
} from './bridge-electron.js';
import { sensitiveProcess, firstSensitiveProcess, normalizeProcessName } from '../core/sensitive-process.js';

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

// The checks below cost a fork on macOS (ps) and Windows (tasklist), and a
// single Telegram delivery asks more than once — once to name the blocker in
// the refusal, again inside each sender. This window is short enough that
// nothing can start and take over a pane inside it, and long enough to make
// the repeat reads free.
const GUARD_CACHE_MS = 500;
const guardCache = new Map<string, { at: number; blocked: string }>();

async function sensitiveIn(pane: string): Promise<string> {
  if (process.platform !== 'win32') return sensitiveProcess(paneForeground(pane));
  return firstSensitiveProcess(await paneConsoleProcesses(pane));
}

// Name of what holds the pane instead of the agent, '' when it is safe to type
// into. Call sites use it to say WHICH program refused the delivery; the send
// helpers below re-check it themselves, so a future call site can't quietly
// skip the guard.
//
// Two refusals. A sensitive program (ssh, sudo, ...) anywhere in the pane: see
// core/sensitive-process.ts. Or the pane's own shell back at its prompt: the
// agent exited without a SessionEnd (crash, kill -9, a CLI that never sent
// one), and text plus Enter would be run as a shell command. The shell check
// fails open when the answer can't be read, like the deny-list always has.
export async function paneBlockedBy(pane: string): Promise<string> {
  if (!pane) return '';
  const now = Date.now();
  const hit = guardCache.get(pane);
  if (hit && now - hit.at < GUARD_CACHE_MS) return hit.blocked;
  let blocked = await sensitiveIn(pane);
  if (!blocked && (await paneShellInForeground(pane)) === true) {
    blocked = (process.platform !== 'win32' && normalizeProcessName(paneForeground(pane))) || 'the shell';
  }
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
