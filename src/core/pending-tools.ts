// Pending-tool cache fed by Copilot CLI `preToolUse` hook events.
// Copilot's `notification` event (permission_prompt) carries no tool info and
// no transcript path, so the daemon caches the most recent preToolUse per
// session and reads it back when the permission notification arrives.
// Read is non-destructive: a re-notification for the same dialog still finds
// the tool; staleness is bounded by the TTL and by the fact that every new
// tool call overwrites the entry.

export interface PendingTool {
  name: string;
  command: string; // shell command or input summary
  options?: string[]; // AskUserQuestion option labels, for per-option buttons
  ts: number;
}

const TTL_MS = 2 * 60 * 1000;
const MAX_ENTRIES = 200;
const pending = new Map<string, PendingTool>();

function sweep(now: number): void {
  if (pending.size < MAX_ENTRIES) return;
  for (const [k, t] of pending) if (now - t.ts > TTL_MS) pending.delete(k);
}

export function putPendingTool(
  sessionId: string,
  name: string,
  command: string,
  options?: string[],
): void {
  if (!sessionId) return;
  const now = Date.now();
  sweep(now);
  pending.set(sessionId, { name, command, options, ts: now });
}

export function peekPendingTool(sessionId: string): PendingTool | null {
  const t = pending.get(sessionId);
  if (!t) return null;
  if (Date.now() - t.ts > TTL_MS) {
    pending.delete(sessionId);
    return null;
  }
  return t;
}

// Copilot's toolArgs may arrive as an object or as a JSON string; extract the
// most human-meaningful field for the Telegram message and the risk classifier.
export function summarizeToolArgs(args: unknown): string {
  let a: unknown = args;
  if (typeof a === "string") {
    const raw = a;
    try {
      a = JSON.parse(raw);
    } catch {
      return raw.slice(0, 500); // plain string (e.g. a raw command)
    }
  }
  if (!a || typeof a !== "object") return "";
  const o = a as Record<string, unknown>;
  for (const k of ["command", "cmd", "script", "file_path", "filePath", "path", "url", "pattern", "query"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  try {
    return JSON.stringify(o).slice(0, 500);
  } catch {
    return "";
  }
}
