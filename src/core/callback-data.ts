// Telegram caps inline-button `callback_data` at 64 BYTES, and rejects the
// whole sendMessage with `400 BUTTON_DATA_INVALID` when any button is over —
// so overrunning it doesn't degrade the buttons, it costs the entire
// notification. That failure mode is why this is a named, budgeted helper
// rather than a template literal at the call site: a session id and a request
// id are both UUIDs, and `approve:<uuid>:<uuid>` is 81 bytes.
export const CALLBACK_DATA_MAX = 64;

// Hex characters of request id the budget leaves room for, given the longest
// action we send and a UUID session id:
//   64 - len("approve:") - 36 - len(":") = 19
// Eight is well inside that and still 4 bytes of randomness, which only has to
// tell consecutive requests OF ONE SESSION apart inside a ~25s window.
export const DECISION_ID_CHARS = 8;

// `action:sessionId` for the agents we answer by keystroke, `action:sessionId:decisionId`
// for Codex, where the tap has to name the request it was shown for.
export function callbackData(action: string, sessionId: string, decisionId?: string): string {
  const data = decisionId ? `${action}:${sessionId}:${decisionId}` : `${action}:${sessionId}`;
  if (Buffer.byteLength(data, "utf8") > CALLBACK_DATA_MAX) {
    // Diagnosable instead of a bare BUTTON_DATA_INVALID from the API. Sending
    // it anyway is the least-bad option: the message itself still carries what
    // needs attention, and the buttons were going to be the part that failed.
    console.error(
      `[bot] callback_data over ${CALLBACK_DATA_MAX} bytes — Telegram will reject the message:`,
      data,
    );
  }
  return data;
}
