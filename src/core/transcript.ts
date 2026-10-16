import { open, type FileHandle } from "node:fs/promises";
import type { Stats } from "node:fs";

// Best-effort readers over an agent transcript (JSONL).
//
// Transcripts grow for the whole life of a session — tens or hundreds of MB
// of tool output — and a notification only needs the end of the current turn.
// So nothing here reads a file whole: the turn is found walking back from the
// end under a fixed byte budget, and the /rename title (which can sit anywhere)
// comes from a forward scan that resumes where the previous notification for
// the same file stopped. When a budget runs out before the answer is certain,
// the answer is "" (no context) rather than a guess from an older turn.

export interface ToolUse {
  name: string;
  command: string; // command (Bash) or input summary for other tools
}

export interface TranscriptLimits {
  // Most bytes read backward from the end looking for the current turn. Also
  // the cap on a single line: a longer one can't be judged, so it ends the walk.
  tailBytes: number;
  // Most bytes the title scan reads forward in one call. A larger backlog is
  // worked off over the next calls; until then the title is unknown.
  titleScanBytes: number;
}

export const DEFAULT_TRANSCRIPT_LIMITS: TranscriptLimits = {
  tailBytes: 8 * 1024 * 1024,
  titleScanBytes: 64 * 1024 * 1024
};

const CHUNK_BYTES = 64 * 1024;
// A custom-title row is a short name plus a session id; anything longer is
// some other row and is skipped without being buffered.
const TITLE_LINE_MAX_BYTES = 64 * 1024;
// Files whose title scan position is remembered (one entry per session).
const TITLE_INDEX_MAX = 64;
// Lookups running at once across all files, each bounded by the limits above.
const MAX_CONCURRENT_LOOKUPS = 2;

const NEWLINE = 0x0a;
const TITLE_MARKER = Buffer.from('"custom-title"');

function parseLine(line: Buffer): any {
  if (line.length === 0) return null;
  try {
    return JSON.parse(line.toString("utf8"));
  } catch {
    return null; // a row still being written, or not JSON at all
  }
}

// ---- concurrency ------------------------------------------------------------

let activeLookups = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(job: () => Promise<T>): Promise<T> {
  while (activeLookups >= MAX_CONCURRENT_LOOKUPS) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  activeLookups++;
  try {
    return await job();
  } finally {
    activeLookups--;
    waiting.shift()?.();
  }
}

// One lookup per file at a time. A caller arriving while one runs joins the
// single queued lookup, which starts after the running one ends — so it reads
// everything written before the caller arrived, never an older snapshot.
interface Lane {
  current: Promise<unknown>;
  queued: Promise<unknown> | null;
}
const lanes = new Map<string, Lane>();

function settleLane(key: string): void {
  const lane = lanes.get(key);
  if (!lane) return;
  if (!lane.queued) {
    lanes.delete(key);
    return;
  }
  lane.current = lane.queued.finally(() => settleLane(key));
  lane.queued = null;
}

function coalesced<T>(key: string, job: () => Promise<T>): Promise<T> {
  const lane = lanes.get(key);
  if (!lane) {
    const current = withSlot(job);
    lanes.set(key, { current: current.finally(() => settleLane(key)), queued: null });
    return current;
  }
  if (!lane.queued) {
    lane.queued = lane.current.then(() => withSlot(job));
  }
  return lane.queued as Promise<T>;
}

// Opens the file for one lookup. Every read goes through the same handle, so a
// transcript rotated (renamed away) mid-lookup is still read consistently.
async function withFile<T>(
  path: string | undefined,
  fallback: T,
  kind: string,
  job: (fh: FileHandle, st: Stats, path: string) => Promise<T>
): Promise<T> {
  if (!path) return fallback;
  return coalesced(`${kind}\0${path}`, async () => {
    let fh: FileHandle | undefined;
    try {
      fh = await open(path, "r");
      return await job(fh, await fh.stat(), path);
    } catch {
      return fallback; // missing, unreadable, or changed under us
    } finally {
      await fh?.close().catch(() => {});
    }
  });
}

// ---- backward walk (current turn) ---------------------------------------------

// Visits complete rows from the last one back, parsed (null if unparsable),
// until `visit` returns true. Reads at most `budget` bytes. Lines are split on
// raw 0x0a bytes, which never occur inside a UTF-8 multi-byte sequence, and
// decoded whole, so a character straddling two reads is never mangled.
// Running out of budget (or a file truncated mid-read) just ends the walk: the
// caller's answer stays empty rather than coming from an older row.
async function walkBack(
  fh: FileHandle,
  size: number,
  budget: number,
  visit: (row: any) => boolean
): Promise<void> {
  const floor = Math.max(0, size - budget);
  let pos = size;
  // Pieces of the line being assembled, in file order. Bounded by the budget.
  let parts: Buffer[] = [];
  while (pos > floor) {
    const len = Math.min(CHUNK_BYTES, pos - floor);
    pos -= len;
    const chunk = Buffer.allocUnsafe(len);
    const { bytesRead } = await fh.read(chunk, 0, len, pos);
    if (bytesRead !== len) return; // truncated while we read it
    let end = len;
    while (end > 0) {
      const nl = chunk.lastIndexOf(NEWLINE, end - 1);
      if (nl === -1) break;
      const line = chunk.subarray(nl + 1, end);
      if (visit(parseLine(parts.length ? Buffer.concat([line, ...parts]) : line))) return;
      parts = [];
      end = nl;
    }
    if (end > 0) parts.unshift(chunk.subarray(0, end));
  }
  // The first line of the file is complete; one cut by the budget is not.
  if (pos === 0 && parts.length) visit(parseLine(Buffer.concat(parts)));
}

// ---- forward scan (/rename title) ---------------------------------------------

interface TitleMark {
  dev: number;
  ino: number;
  offset: number; // where the next scan resumes
  skipping: boolean; // offset sits inside an over-long row
  title: string;
}

// Insertion-ordered, so the first key is the least recently used.
const titleIndex = new Map<string, TitleMark>();

function rememberTitle(path: string, mark: TitleMark): void {
  titleIndex.delete(path);
  titleIndex.set(path, mark);
  if (titleIndex.size > TITLE_INDEX_MAX) {
    const oldest = titleIndex.keys().next().value;
    if (oldest !== undefined) titleIndex.delete(oldest);
  }
}

// Whether a remembered position still belongs to this file: same inode, not
// shorter than where we stopped, and still at a row boundary (a file rewritten
// in place almost never keeps a newline at exactly that byte).
async function markStillValid(fh: FileHandle, st: Stats, mark: TitleMark): Promise<boolean> {
  if (mark.dev !== st.dev || mark.ino !== st.ino || mark.offset > st.size) return false;
  if (mark.offset === 0 || mark.skipping) return true;
  const probe = Buffer.alloc(1);
  const { bytesRead } = await fh.read(probe, 0, 1, mark.offset - 1);
  return bytesRead === 1 && probe[0] === NEWLINE;
}

// The name the user gave the session with /rename, stored as a `custom-title`
// row. Renaming again appends a new row, so the last one wins; an empty title
// means the name was cleared. Claude's auto-generated `ai-title` is ignored —
// only a deliberate name is worth a spot in the notification header.
async function scanTitle(
  path: string,
  fh: FileHandle,
  st: Stats,
  budget: number
): Promise<string> {
  const known = titleIndex.get(path);
  let mark: TitleMark =
    known && (await markStillValid(fh, st, known))
      ? { ...known }
      : { dev: st.dev, ino: st.ino, offset: 0, skipping: false, title: "" };

  const stop = Math.min(st.size, mark.offset + budget);
  let pos = mark.offset;
  let lineStart = mark.offset;
  let carry: Buffer | null = null;
  let skipping = mark.skipping;
  let title = mark.title;
  while (pos < stop) {
    const len = Math.min(CHUNK_BYTES, stop - pos);
    const chunk = Buffer.allocUnsafe(len);
    const { bytesRead } = await fh.read(chunk, 0, len, pos);
    if (bytesRead !== len) {
      titleIndex.delete(path); // truncated under us: start over next time
      return "";
    }
    let start = 0;
    for (let nl = chunk.indexOf(NEWLINE, start); nl !== -1; nl = chunk.indexOf(NEWLINE, start)) {
      if (!skipping) {
        const line: Buffer = carry ? Buffer.concat([carry, chunk.subarray(start, nl)]) : chunk.subarray(start, nl);
        if (line.includes(TITLE_MARKER)) {
          const j = parseLine(line);
          if (j?.type === "custom-title") title = String(j.customTitle ?? "").trim();
        }
      }
      carry = null;
      skipping = false;
      start = nl + 1;
      lineStart = pos + start;
    }
    if (!skipping && start < len) {
      const rest = chunk.subarray(start);
      if ((carry?.length ?? 0) + rest.length > TITLE_LINE_MAX_BYTES) {
        carry = null;
        skipping = true;
      } else {
        carry = carry ? Buffer.concat([carry, rest]) : Buffer.from(rest);
      }
    }
    pos += len;
  }

  // An incomplete last row is re-read next time; an over-long one is skipped
  // from where we are.
  mark = { ...mark, offset: skipping ? pos : lineStart, skipping, title };
  rememberTitle(path, mark);
  if (stop < st.size) return "";
  // A last row without its newline counts if it already parses whole.
  if (carry?.includes(TITLE_MARKER)) {
    const j = parseLine(carry);
    if (j?.type === "custom-title") return String(j.customTitle ?? "").trim();
  }
  return title;
}

// ---- Claude -------------------------------------------------------------------

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

function assistantText(j: any): string | null {
  if (j?.type !== "assistant" || !Array.isArray(j.message?.content)) return null;
  const block = [...j.message.content]
    .reverse()
    .find((b) => b?.type === "text" && typeof b.text === "string" && b.text.trim());
  return block ? String(block.text).trim() : null;
}

export interface ClaudeContext {
  // The assistant text of the CURRENT turn — what Claude said right before this
  // tool/permission request. Scoped to entries after the last real user prompt
  // so a preamble-less tool call can't surface a stale message from an earlier
  // turn.
  text: string;
  // The /rename name, "" when there is none (or it isn't known yet).
  title: string;
}

export function claudeContext(
  path: string | undefined,
  limits: TranscriptLimits = DEFAULT_TRANSCRIPT_LIMITS
): Promise<ClaudeContext> {
  return withFile(path, { text: "", title: "" }, "claude", async (fh, st, file) => {
    let text = "";
    // Walking back, the first row that decides is either the prompt that
    // opened this turn (no text yet) or the turn's latest assistant text.
    await walkBack(fh, st.size, limits.tailBytes, (j) => {
      if (isUserPrompt(j)) return true;
      const t = assistantText(j);
      if (t) text = t;
      return t !== null;
    });
    const title = await scanTitle(file, fh, st, limits.titleScanBytes);
    return { text, title };
  });
}

// ---- Copilot ------------------------------------------------------------------

// Copilot's transcript (events.jsonl) is a flat list of {type, data, ...} rows.
// The most recent `assistant.message` row carries the final text in
// `data.content` — used to enrich the agentStop completion notification.
export function lastCopilotText(
  path: string | undefined,
  limits: TranscriptLimits = DEFAULT_TRANSCRIPT_LIMITS
): Promise<string> {
  return withFile(path, "", "copilot", async (fh, st) => {
    let text = "";
    await walkBack(fh, st.size, limits.tailBytes, (j) => {
      if (j?.type !== "assistant.message") return false;
      const c = j.data?.content;
      if (typeof c === "string" && c.trim()) text = c.trim();
      return text !== "";
    });
    return text;
  });
}

// ---- Codex --------------------------------------------------------------------

// Codex's rollout (~/.codex/sessions/**/rollout-*.jsonl) is a flat list of
// {type, payload} rows sharing one file with token-usage records and other
// bookkeeping we don't care about. The turn boundary is a `response_item` (or
// `event_msg`) whose `payload.item.type` is "UserMessage"; the text we want is
// the last "AgentMessage" after it. Block `type` casing is inconsistent
// ("text" on UserMessage, "Text" on AgentMessage) so this matches on the
// `text` field itself rather than the block type.
function isCodexUserMessage(j: any): boolean {
  return j?.type === "event_msg" && j?.payload?.item?.type === "UserMessage";
}

function codexMessageText(j: any): string | null {
  if (j?.type !== "event_msg" || j?.payload?.item?.type !== "AgentMessage") return null;
  const blocks = j.payload.item.content;
  if (!Array.isArray(blocks)) return null;
  const block = [...blocks].reverse().find((b) => typeof b?.text === "string" && b.text.trim());
  return block ? String(block.text).trim() : null;
}

export function lastCodexText(
  path: string | undefined,
  limits: TranscriptLimits = DEFAULT_TRANSCRIPT_LIMITS
): Promise<string> {
  return withFile(path, "", "codex", async (fh, st) => {
    let text = "";
    await walkBack(fh, st.size, limits.tailBytes, (j) => {
      if (isCodexUserMessage(j)) return true;
      const t = codexMessageText(j);
      if (t) text = t;
      return t !== null;
    });
    return text;
  });
}

// The pending tool + its input no longer come from the transcript: the daemon
// caches them from the PreToolUse hook (see src/pending-tools.ts), which is
// exact and race-free. Reading the transcript for the tool was unreliable —
// wrong tool on parallel batches, null before the tool_use was flushed.
