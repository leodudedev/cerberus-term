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

// Most recent assistant text block — what Claude last "said".
export async function lastAssistantText(path: string | undefined): Promise<string> {
  if (!path) return "";
  try {
    const lines = await readLines(path);
    for (let i = lines.length - 1; i >= 0; i--) {
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
