import { CODEX_DECISION_WINDOW_MS } from "../../core/hook-targets.js";

// Native allow/deny channel for Codex's PermissionRequest hook (docs/todo.md
// #1.7b). Codex lets a PreToolUse-family hook answer the prompt directly —
// {"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{...}}}
// — instead of us injecting keystrokes into a TUI we've never parsed, the way
// Claude and Copilot approvals work. The daemon holds the hook's HTTP request
// open while it waits here; a Telegram tap within the window resolves it
// directly, and a tap outside it finds no waiter, which the caller reports as
// expired — by then the hook has abstained and Codex's own prompt is live at
// the keyboard.

export type Decision = "allow" | "deny";
export type Outcome = Decision | "timeout";

interface Waiter {
  // Identifies the request this waiter belongs to, so a decision can only
  // settle the request it was actually shown for. Keyed by session alone, an
  // Approve tapped on an older message — one left with live buttons because
  // its request was answered at the keyboard rather than from the phone —
  // would resolve whatever is pending NOW, approving a command nobody read.
  id: string;
  resolve: (outcome: Outcome) => void;
}

const waiters = new Map<string, Waiter>();

export function awaitCodexDecision(
  sessionId: string,
  id: string,
  timeoutMs = CODEX_DECISION_WINDOW_MS,
): Promise<Outcome> {
  // A session asks one permission at a time, but a hook Codex has already
  // abandoned can leave its waiter behind. Settle the stale one here instead
  // of letting it sit until its own timer fires — that timer would otherwise
  // wake up later and find this slot occupied by its successor.
  waiters.get(sessionId)?.resolve("timeout");

  return new Promise((resolve) => {
    const self: Waiter = {
      id,
      resolve: (outcome) => {
        clearTimeout(timer);
        // Only give up the slot if it is still ours. A newer request may have
        // taken it, and evicting that one would leave it unreachable: its
        // Telegram tap would find nothing and report expired, and the hook
        // would hang until its own timeout.
        if (waiters.get(sessionId) === self) waiters.delete(sessionId);
        resolve(outcome);
      },
    };
    const timer = setTimeout(() => self.resolve("timeout"), timeoutMs);
    waiters.set(sessionId, self);
  });
}

// Called from the Telegram button handler. False means the tap changed
// nothing — the window closed, or it came from a message for a different
// request — and the caller must not report it as an approval.
export function resolveCodexDecision(
  sessionId: string,
  id: string | undefined,
  decision: Decision,
): boolean {
  const w = waiters.get(sessionId);
  if (!w || w.id !== id) return false;
  w.resolve(decision);
  return true;
}

// The hook went away while we were waiting (Codex timed it out, the user hit
// Escape, the pane died). Abstain now rather than hold a decision open for a
// process that will never read it — and, more importantly, stop a later tap
// from being reported as an approval Codex never received.
export function cancelCodexDecision(sessionId: string, id: string): void {
  const w = waiters.get(sessionId);
  if (w?.id === id) w.resolve("timeout");
}
