// Which CLI agent produced the event. Claude Code, GitHub Copilot CLI and Codex
// CLI have different hook payloads and permission-dialog keystrokes.
export type Agent = "claude" | "copilot" | "codex";

// A short label shown next to every notification so several sessions are
// tellable apart on the phone. It's derived from CLAUDE_CONFIG_DIR, which is
// how people run more than one Claude account side by side: an alias exporting
// CLAUDE_CONFIG_DIR=~/.claude-work gets labelled "claude-work".
//
// Copilot sessions have no CLAUDE_CONFIG_DIR: they get the "copilot" label.
// Codex sessions read CODEX_HOME the same way, and fall back to "codex".
export type Profile = string;

const DEFAULT_PROFILE = "claude";

export function profileFromConfigDir(
  configDir: string | undefined | null,
  defaultProfile: Profile = DEFAULT_PROFILE,
): Profile {
  const raw = configDir?.trim();
  if (!raw) return defaultProfile; // unset => the agent's own default config dir

  // Basename, tolerating a trailing slash and both path separators.
  const name = raw.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "";
  const label = name.replace(/^\.+/, ""); // ~/.claude-work => claude-work

  return label || defaultProfile;
}
