import type { Agent } from "./profile.js";

// Central config loaded from environment (see .env.example)

// Keystrokes sent for each button action, per agent. Isolated here because the
// permission-prompt UI (numbered options) of each CLI can change between
// versions. Each entry is a sequence of tmux send-keys tokens (literal digits
// or key names).
export const actionKeys: Record<Agent, Record<string, string[]>> = {
  claude: {
    approve: ["1", "Enter"], // first option = yes (this once)
    // second option = "yes, and don't ask again for this command". Persists an
    // allow rule for the command prefix — more consequential than a one-off yes.
    always: ["2", "Enter"],
    // deny defaults to Escape (safe cancel). The "No" option number varies by
    // Claude version and picking the wrong digit could hit "yes, don't ask again".
    // Set to e.g. ["3", "Enter"] once verified on the live prompt.
    deny: ["Escape"],
    esc: ["Escape"],
  },
  copilot: {
    // Copilot CLI permission dialog: verify on a live prompt before trusting
    // approve/always — same caveat as Claude, the option order can change per version.
    approve: ["1", "Enter"],
    always: ["2", "Enter"],
    deny: ["Escape"],
    esc: ["Escape"],
  },
  // Unused today: Codex answers PermissionRequest natively (see
  // codex-decisions.ts and docs/todo.md #1.7b), so bot.ts never reaches
  // actionKeysFor() for a codex session. Kept so Record<Agent, ...> stays
  // exhaustive and this doesn't silently break if that ever changes.
  codex: {
    approve: ["1", "Enter"],
    always: ["2", "Enter"],
    deny: ["Escape"],
    esc: ["Escape"],
  },
};

export function actionKeysFor(agent: Agent | undefined): Record<string, string[]> {
  return actionKeys[agent ?? "claude"] ?? actionKeys.claude;
}

// Default port 8899 — away from common dev ranges and from headroom (8787/8788).
// Language for the Telegram-facing strings: English by default, CERBERUS_LANG=it
// switches to Italian. Only our own chrome is translated; text coming from the
// CLI (assistant recap, tool command) stays in whatever language it arrives in.
// Default port 8898 for cerberus-term (the tmux mycli daemon owns 8899, so we
// bind a distinct port and inject CERBERUS_PORT into each pty so hooks reach us).
//
// Getters, not plain values: ES module imports are resolved (and this module
// evaluated) before any code runs, which is before startCerberus() gets to
// call loadEnvFile() — a plain `port: Number(process.env.CERBERUS_PORT ?? …)`
// would freeze in the default forever, no matter what CERBERUS_ENV_FILE says.
// A getter reads process.env fresh on every access, once callers actually
// read config.port/config.lang at runtime, after loadEnvFile() has run.
export const config = {
  get port(): number {
    return Number(process.env.CERBERUS_PORT ?? process.env.PORT ?? 8898);
  },
  get lang(): "en" | "it" {
    return (process.env.CERBERUS_LANG ?? "").toLowerCase().startsWith("it") ? "it" : "en";
  },
};
