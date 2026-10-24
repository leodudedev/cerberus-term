import { randomBytes } from "node:crypto";
import type { Agent, Profile } from "./profile.js";
import { DECISION_ID_CHARS } from "./callback-data.js";
import { loadState, saveState } from "./persist.js";

// In-memory registry of live sessions, keyed by the agent's session id.
// Maps a session to its tmux pane so remote replies (Fase 3) can be routed
// back with `tmux send-keys`. Last-write-wins on pane, since a session_id is
// stable but could be re-attached to a different pane.

export interface SessionInfo {
  sessionId: string;
  agent: Agent; // which CLI produced the event (drives the button keymap)
  pane: string;
  profile: Profile;
  cwd: string;
  lastMessage: string;
  detail: string; // last assistant text from the transcript (the actual question)
  title?: string; // session name set with /rename (Claude only), "" if none
  toolName: string; // tool awaiting permission (e.g. "Bash"), "" if none
  command: string; // command / input summary of that tool
  options: string[]; // AskUserQuestion answer labels → per-option buttons
  hasAlways: boolean; // dialog offers a "don't ask again" option (read from pane)
  isPermission: boolean; // event was a permission request (buttons make sense)
  // The id of the request this session's buttons answer, carried in every
  // button's callback so a tap can be matched to the prompt it was shown for.
  // Codex: the PermissionRequest the hook is blocked on (see codex-decisions;
  // a value restored from the snapshot is necessarily stale there and resolves
  // to "expired"). Claude/Copilot: a nonce minted per prompt, consumed by the
  // first tap and cleared when the prompt is answered at the keyboard, so a
  // button left behind by an earlier prompt can never type into this one.
  // Undefined when no buttoned prompt is pending.
  decisionId?: string;
  lastSeen: number;
}

// Restored from the snapshot so buttons/replies keep working after a daemon
// restart (stale entries fall to the sweep / action TTL anyway).
const sessions = new Map<string, SessionInfo>(
  Object.entries(loadState().sessions ?? {}) as [string, SessionInfo][],
);

// Telegram (chat, message) -> sessionId, so a reply to a notification routes
// back to the session that produced it. Keyed by both: a message_id is only
// unique within its chat, and two allowed chats reuse the same numbers.
// Ephemeral by design.
const messageToSession = new Map<string, string>();
const messageKey = (chatId: string, messageId: number): string => `${chatId}:${messageId}`;

// Telegram chat id -> the session last notified in it: where a bare message
// (not a reply) typed in that chat goes. Per chat, so one chat can never steer
// a session that was only ever shown in another. Persisted so a restart
// doesn't leave a bare message with nowhere to go.
const chatTargets = new Map<string, string>(Object.entries(loadState().chatTargets ?? {}));

// Long-running daemon: keep the maps bounded. Sessions idle beyond the TTL are
// swept on write and ignored on read; the message map keeps only the most
// recent links.
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MESSAGE_LINKS_MAX = 500;

const isLive = (s: SessionInfo): boolean => Date.now() - s.lastSeen < SESSION_TTL_MS;

function persist(): void {
  saveState({ sessions: Object.fromEntries(sessions), chatTargets: Object.fromEntries(chatTargets) });
}

function sweep(): void {
  for (const [id, s] of sessions) if (!isLive(s)) sessions.delete(id);
  for (const [chat, id] of chatTargets) if (!sessions.has(id)) chatTargets.delete(chat);
  // Maps iterate in insertion order: drop the oldest links beyond the cap.
  while (messageToSession.size > MESSAGE_LINKS_MAX) {
    const oldest = messageToSession.keys().next().value;
    if (oldest === undefined) break;
    messageToSession.delete(oldest);
  }
}

export function upsertSession(info: Omit<SessionInfo, "lastSeen">): SessionInfo {
  sweep();
  const record: SessionInfo = { ...info, lastSeen: Date.now() };
  sessions.set(info.sessionId, record);
  persist();
  return record;
}

// Forget a session the moment its agent says it's over (SessionEnd), instead of
// waiting out SESSION_TTL_MS. A session left in the map keeps its pane
// targetable, and the pane by then may be running something else entirely —
// see core/sensitive-process.ts for what that costs.
export function dropSession(sessionId: string): boolean {
  if (!sessions.delete(sessionId)) return false;
  persist();
  return true;
}

// Past the TTL a session is gone even before the next write sweeps it: its pane
// may be running anything by now.
export function getSession(sessionId: string): SessionInfo | undefined {
  const s = sessions.get(sessionId);
  return s && isLive(s) ? s : undefined;
}

export function listSessions(): SessionInfo[] {
  return [...sessions.values()].filter(isLive).sort((a, b) => b.lastSeen - a.lastSeen);
}

// Spend the pending request's id: true exactly once per id, for the tap that
// matches it. Synchronous, so two taps racing through their awaits can't both
// get past it, and a prompt that replaced the one the button was for (new id)
// makes the old button fail.
export function consumeRequest(sessionId: string, decisionId: string | undefined): boolean {
  const s = getSession(sessionId);
  if (!s || !decisionId || s.decisionId !== decisionId) return false;
  s.decisionId = undefined;
  persist();
  return true;
}

// The id a Claude/Copilot prompt's buttons carry (see SessionInfo.decisionId).
// None when the notification has no buttons. The same id again when Claude
// re-fires the notification for the prompt still pending — same text, same
// tool, same options, id not yet spent — so the message already on the phone
// keeps working; a new one for anything else, which retires every older button.
export function requestIdFor(
  sessionId: string,
  p: { message: string; toolName: string; command: string; options: string[]; isPermission: boolean },
): string | undefined {
  if (!p.isPermission && p.options.length === 0) return undefined;
  const prev = getSession(sessionId);
  const samePrompt =
    !!prev?.decisionId &&
    prev.isPermission === p.isPermission &&
    prev.lastMessage === p.message &&
    prev.toolName === p.toolName &&
    prev.command === p.command &&
    prev.options.join("\u0000") === p.options.join("\u0000");
  return samePrompt ? prev.decisionId : randomBytes(DECISION_ID_CHARS / 2).toString("hex");
}

// The prompt was answered at the keyboard: no button may answer it again.
export function clearRequest(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (!s || s.decisionId === undefined) return;
  s.decisionId = undefined;
  persist();
}

export function linkMessage(chatId: string, messageId: number, sessionId: string): void {
  messageToSession.set(messageKey(chatId, messageId), sessionId);
  chatTargets.set(chatId, sessionId);
  persist();
}

export function sessionForMessage(chatId: string, messageId: number): SessionInfo | undefined {
  const id = messageToSession.get(messageKey(chatId, messageId));
  return id ? getSession(id) : undefined;
}

// Whether this message was ever linked to a session, regardless of whether that
// session is still alive. Lets a reply to a now-dead session be refused rather
// than silently retargeted.
export function hasMessageLink(chatId: string, messageId: number): boolean {
  return messageToSession.has(messageKey(chatId, messageId));
}

// The session a bare message typed in this chat goes to, if it is still alive.
export function sessionForChat(chatId: string): SessionInfo | undefined {
  const id = chatTargets.get(chatId);
  return id ? getSession(id) : undefined;
}

// A different bot token is a different bot: its message ids and chats owe
// nothing to the old one's, so none of the old routing may carry over.
export function forgetMessageLinks(): void {
  messageToSession.clear();
  chatTargets.clear();
  persist();
}
