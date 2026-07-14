// Correlates a remote (Telegram) approval with the tool result that follows, so
// the daemon can push a completion feed ONLY for tools the user approved from
// their phone — local keyboard approvals stay silent.

export interface RemoteApproval {
  toolName: string;
  command: string;
  chatId: string;
  messageId?: number; // the notification message, to thread the result under it
  ts: number;
}

const pending = new Map<string, RemoteApproval>(); // sessionId -> approval
const TTL_MS = 10 * 60 * 1000;

export function putApproval(sessionId: string, a: RemoteApproval): void {
  pending.set(sessionId, a);
}

// Return + clear the approval for this session iff it's fresh and matches the
// tool that just finished. A mismatched tool leaves it pending (the approved
// tool's PostToolUse may still be coming).
export function takeApproval(sessionId: string, toolName: string): RemoteApproval | null {
  const a = pending.get(sessionId);
  if (!a) return null;
  if (Date.now() - a.ts > TTL_MS) {
    pending.delete(sessionId);
    return null;
  }
  if (a.toolName && toolName && a.toolName !== toolName) return null;
  pending.delete(sessionId);
  return a;
}
