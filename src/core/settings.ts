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
}

export const DEFAULT_SETTINGS: Settings = {
  telegram: {},
  launchCmds: { claude: 'claude', copilot: 'copilot' },
  skipCloseConfirm: false
};

export type SaveResult = { ok: true } | { ok: false; error: string };

export interface SettingsBridge {
  get(): Promise<Settings>;
  save(s: Settings): Promise<SaveResult>;
}
