// Which CLI agent produced the event. Claude Code and GitHub Copilot CLI have
// different hook payloads and permission-dialog keystrokes.
export type Agent = "claude" | "copilot";

// A short label shown next to every notification so several sessions are
// tellable apart on the phone. It's derived from CLAUDE_CONFIG_DIR, which is
// how people run more than one Claude account side by side: an alias exporting
// CLAUDE_CONFIG_DIR=~/.claude-work gets labelled "claude-work".
//
// Copilot sessions have no CLAUDE_CONFIG_DIR: they get the "copilot" label.
export type Profile = string;

const DEFAULT_PROFILE = "claude";

export function profileFromConfigDir(configDir: string | undefined | null): Profile {
  const raw = configDir?.trim();
  if (!raw) return DEFAULT_PROFILE; // unset => Claude's own default, ~/.claude

  // Basename, tolerating a trailing slash and both path separators.
  const name = raw.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "";
  const label = name.replace(/^\.+/, ""); // ~/.claude-work => claude-work

  return label || DEFAULT_PROFILE;
}
