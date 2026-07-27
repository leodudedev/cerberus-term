// Reading a CLI agent's permission dialog out of a pane buffer. Pure string
// work, kept out of the daemon so it can be tested without Electron — it decides
// which buttons the Telegram message gets, and a wrong answer sends the wrong
// keystroke into a live session.

// A permission dialog offers a "don't ask again" / "allow all" option only
// sometimes, and whether it does can't be inferred from the tool or command —
// Claude attaches it to whatever sub-command it can turn into an allow rule. So
// we read the option straight from the pane instead of guessing.
// Match both the straight and typographic apostrophe (Claude renders "don’t"
// with U+2019), plus the "Yes, and …" allow-rule option and the Italian wording.
export const ALWAYS_OPTION_RE =
  /don['’]?t ask again|allow all|always allow|yes,?\s+and\b|non chiedere|consenti sempre|approva sempre/i;

// Narrow the 16KB pane buffer to just the numbered-options block of the current
// dialog (from its last "1." line to the end). Testing ALWAYS_OPTION_RE on the
// whole buffer could match "yes, and …" in earlier assistant text and wrongly
// show the "always" button — whose tap sends "2⏎", i.e. "No" on a 2-option
// dialog. Falls back to the full buffer if no numbered option is found.
export function dialogOptionsBlock(buf: string): string {
  const lines = buf.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*[❯>»]?\s*1[.)]\s/.test(lines[i]!)) return lines.slice(i).join("\n");
  }
  return buf;
}

// Pull the answer labels out of an AskUserQuestion tool_input so the bot can
// render one button per real option. Only the simple single-question,
// single-select shape is supported; anything else falls back to no options
// (the user can still reply with free text), because multi-select and
// multi-question dialogs need more than a single "digit + Enter" keystroke.
export function extractQuestionOptions(toolName: string, input: unknown): string[] | undefined {
  if (toolName !== "AskUserQuestion" || !input || typeof input !== "object") return undefined;
  const qs = (input as { questions?: unknown }).questions;
  if (!Array.isArray(qs) || qs.length !== 1) return undefined;
  const q = qs[0] as { multiSelect?: boolean; options?: unknown };
  if (q?.multiSelect) return undefined;
  if (!Array.isArray(q?.options)) return undefined;
  const labels = q.options
    .map((o) => String((o as { label?: unknown })?.label ?? "").trim())
    .filter(Boolean)
    .slice(0, 8);
  return labels.length ? labels : undefined;
}
