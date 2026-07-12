import type { Agent, Profile } from "./profile.js";
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
  toolName: string; // tool awaiting permission (e.g. "Bash"), "" if none
  command: string; // command / input summary of that tool
  options: string[]; // AskUserQuestion answer labels → per-option buttons
  hasAlways: boolean; // dialog offers a "don't ask again" option (read from pane)
  isPermission: boolean; // event was a permission request (buttons make sense)
  lastSeen: number;
}

// Restored from the snapshot so buttons/replies keep working after a daemon
// restart (stale entries fall to the sweep / action TTL anyway).
const sessions = new Map<string, SessionInfo>(
  Object.entries(loadState().sessions ?? {}) as [string, SessionInfo][],
);

// Telegram message_id -> sessionId, so a reply to a notification routes back
// to the session that produced it. Ephemeral by design.
const messageToSession = new Map<number, string>();

// Long-running daemon: keep the maps bounded. Sessions idle beyond the TTL are
// swept on write; the message map keeps only the most recent links.
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MESSAGE_LINKS_MAX = 500;

function sweep(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of sessions) if (s.lastSeen < cutoff) sessions.delete(id);
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
  saveState({ sessions: Object.fromEntries(sessions) });
  return record;
}

export function getSession(sessionId: string): SessionInfo | undefined {
  return sessions.get(sessionId);
}

export function listSessions(): SessionInfo[] {
  return [...sessions.values()].sort((a, b) => b.lastSeen - a.lastSeen);
}

export function mostRecentSession(): SessionInfo | undefined {
  return listSessions()[0];
}

export function linkMessage(messageId: number, sessionId: string): void {
  messageToSession.set(messageId, sessionId);
}

export function sessionForMessage(messageId: number): SessionInfo | undefined {
  const id = messageToSession.get(messageId);
  return id ? sessions.get(id) : undefined;
}
