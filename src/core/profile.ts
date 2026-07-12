// Which CLI agent produced the event. Claude Code and GitHub Copilot CLI have
// different hook payloads and permission-dialog keystrokes.
export type Agent = "claude" | "copilot";

// Map CLAUDE_CONFIG_DIR to a human profile label.
// Empty / ~/.claude => aziendale, .claude-leo => personale.
// Copilot sessions have no CLAUDE_CONFIG_DIR: they get the "copilot" label.

export type Profile = "aziendale" | "personale" | "copilot" | "unknown";

export function profileFromConfigDir(configDir: string | undefined | null): Profile {
  if (!configDir || configDir.trim() === "") return "aziendale";
  if (configDir.includes(".claude-leo")) return "personale";
  return "unknown";
}
