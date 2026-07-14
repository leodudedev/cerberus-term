import { readFile } from "node:fs/promises";

// Best-effort readers over a Claude Code transcript (JSONL).

export interface ToolUse {
  name: string;
  command: string; // command (Bash) or input summary for other tools
}

async function readLines(path: string): Promise<any[]> {
  const raw = await readFile(path, "utf8");
  return raw
    .trimEnd()
    .split("\n")
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// A real user prompt (not a tool_result echo, which Claude Code also stores as a
// `user` entry). Marks the boundary of the current turn.
function isUserPrompt(j: any): boolean {
  if (j?.type !== "user") return false;
  const c = j.message?.content;
  if (typeof c === "string") return c.trim().length > 0;
  if (Array.isArray(c)) {
    return c.some((b) => b?.type === "text" && typeof b.text === "string" && b.text.trim());
  }
  return false;
}

// The assistant text of the CURRENT turn — what Claude said right before this
// tool/permission request. Scoped to entries after the last real user prompt so
// a preamble-less tool call can't surface a stale message from an earlier turn.
export async function lastAssistantText(path: string | undefined): Promise<string> {
  if (!path) return "";
  try {
    const lines = await readLines(path);
    let boundary = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (isUserPrompt(lines[i])) {
        boundary = i;
        break;
      }
    }
    for (let i = lines.length - 1; i > boundary; i--) {
      const j = lines[i];
      if (j?.type !== "assistant" || !Array.isArray(j.message?.content)) continue;
      const block = [...j.message.content]
        .reverse()
        .find((b) => b?.type === "text" && typeof b.text === "string" && b.text.trim());
      if (block) return String(block.text).trim();
    }
  } catch {
    // ignore
  }
  return "";
}

// Copilot's transcript (events.jsonl) is a flat list of {type, data, ...} rows.
// The most recent `assistant.message` row carries the final text in
// `data.content` — used to enrich the agentStop completion notification.
export async function lastCopilotText(path: string | undefined): Promise<string> {
  if (!path) return "";
  try {
    const lines = await readLines(path);
    for (let i = lines.length - 1; i >= 0; i--) {
      const j = lines[i];
      if (j?.type !== "assistant.message") continue;
      const c = j.data?.content;
      if (typeof c === "string" && c.trim()) return c.trim();
    }
  } catch {
    // ignore
  }
  return "";
}

// The pending tool + its input no longer come from the transcript: the daemon
// caches them from the PreToolUse hook (see src/pending-tools.ts), which is
// exact and race-free. Reading the transcript for the tool was unreliable —
// wrong tool on parallel batches, null before the tool_use was flushed.
