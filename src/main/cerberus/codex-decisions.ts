// Native allow/deny channel for Codex's PermissionRequest hook (docs/todo.md
// #1.7b). Codex lets a PreToolUse-family hook answer the prompt directly —
// {"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{...}}}
// — instead of us injecting keystrokes into a TUI we've never parsed, the way
// Claude and Copilot approvals work. The daemon holds the hook's HTTP request
// open while it waits here; a Telegram tap within the window resolves it
// directly, and a tap past the window finds no waiter and is reported as
// expired by the caller — the hook has already abstained and the local
// prompt is live at the keyboard by then.

export type Decision = "allow" | "deny";

interface Waiter {
  resolve: (d: Decision) => void;
}

const waiters = new Map<string, Waiter>();

// One open PermissionRequest at a time per session: Codex's own docs describe
// exactly this hybrid at a *turn* level, but the daemon is keyed by session
// throughout, and a session serialises its own turns already (a second
// PermissionRequest cannot arrive before the first is settled or timed out).
const DECISION_TIMEOUT_MS = 25_000;

export function awaitCodexDecision(
  sessionId: string,
  timeoutMs = DECISION_TIMEOUT_MS,
): Promise<Decision | "timeout"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiters.delete(sessionId);
      resolve("timeout");
    }, timeoutMs);
    waiters.set(sessionId, {
      resolve: (d) => {
        clearTimeout(timer);
        waiters.delete(sessionId);
        resolve(d);
      },
    });
  });
}

// Called from the Telegram button handler. Returns false when the window has
// already closed (timed out, or answered once already) — the caller must not
// report success for a decision the hook never sees.
export function resolveCodexDecision(sessionId: string, decision: Decision): boolean {
  const w = waiters.get(sessionId);
  if (!w) return false;
  w.resolve(decision);
  return true;
}
