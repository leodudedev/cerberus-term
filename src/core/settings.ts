// Global app settings, edited in-app and persisted to userData. Per-project
// .cerberus.json still overrides the overlapping fields (chatId/minRisk/…) in
// the daemon; this is the global default that used to come from .env.

export interface TelegramSettings {
  token?: string;
  chatId?: string;
  allowedChats?: string; // csv
  lang?: 'en' | 'it';
}

export interface Settings {
  telegram: TelegramSettings;
  launchCmds: Record<string, string>; // agent -> command (claude, copilot, …)
  defaultShell?: string; // pty shell when a pane doesn't specify one
  skipCloseConfirm?: boolean; // when true, closing a pane/tab skips the confirm
  // Register the notification hooks in Claude's settings.json on every launch.
  // Turning this off also removes the ones already there — without the flag the
  // next launch would just put them back. Undefined counts as on.
  claudeHooks?: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  telegram: {},
  launchCmds: { claude: 'claude', copilot: 'copilot' },
  skipCloseConfirm: false,
  claudeHooks: true
};

export type SaveResult = { ok: true } | { ok: false; error: string };

export interface ClaudeHooksStatus {
  file: string; // the settings.json we'd edit, honouring CLAUDE_CONFIG_DIR
  installed: boolean;
}

export interface SettingsBridge {
  get(): Promise<Settings>;
  save(s: Settings): Promise<SaveResult>;
  claudeHooksStatus(): Promise<ClaudeHooksStatus>;
}
