// Pending-tool cache fed by PreToolUse-shaped hook events (Claude Code,
// Copilot CLI, Codex).
// Claude's `Notification` and Copilot's `notification` (permission_prompt)
// carry no tool info and no transcript path, so the daemon caches the most
// recent preToolUse per session and reads it back when the permission
// notification arrives. Codex's `PermissionRequest` is self-sufficient and
// doesn't need this read-back, but its PreToolUse still feeds the cache the
// same way so the completion feed (PostToolUse) has a tool name to report.
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

// Codex's apply_patch reports its patch text in the same `command` field
// summarizeToolArgs reads first — so without this, the Telegram push would
// read "*** Begin Patch *** Add File: test.md…" instead of the file it
// touches. Pull the target paths out of the patch headers instead. See
// docs/todo.md #1.4b.
const PATCH_FILE_RE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;

export function summarizeApplyPatch(patchText: string): string {
  const files: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = PATCH_FILE_RE.exec(patchText))) files.push(m[1]!.trim());
  return files.length ? files.join(", ") : patchText.slice(0, 200);
}

// Codex's tool_input needs the apply_patch detour above; everything else
// (Bash, exec_command, MCP tools) goes through the same generic summary Claude
// and Copilot use.
export function summarizeCodexToolArgs(toolName: string, args: unknown): string {
  if (toolName === "apply_patch") {
    const a = typeof args === "object" && args ? (args as Record<string, unknown>) : {};
    return summarizeApplyPatch(String(a.command ?? ""));
  }
  return summarizeToolArgs(args);
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
