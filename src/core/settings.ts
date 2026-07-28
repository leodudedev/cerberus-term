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
  defaultShell?: string; // pty shell when a pane doesn't specify one
  skipCloseConfirm?: boolean; // when true, closing a pane/tab skips the confirm
  // Register the notification hooks in Claude's settings.json on every launch.
  // Turning this off also removes the ones already there — without the flag the
  // next launch would just put them back. Undefined counts as on.
  claudeHooks?: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  telegram: {},
  skipCloseConfirm: false,
  claudeHooks: true
};

// Fill the gaps in a settings object read off disk (or handed over by the
// renderer) with the defaults. Every field has to be listed: this rebuilds the
// object rather than spreading, so a field forgotten here is silently dropped
// on save and reverts to its default on the next read.
export function mergeSettings(parsed: Partial<Settings> | null | undefined): Settings {
  const p = parsed ?? {};
  return {
    telegram: { ...DEFAULT_SETTINGS.telegram, ...(p.telegram ?? {}) },
    defaultShell: p.defaultShell ?? DEFAULT_SETTINGS.defaultShell,
    skipCloseConfirm: p.skipCloseConfirm ?? DEFAULT_SETTINGS.skipCloseConfirm,
    claudeHooks: p.claudeHooks ?? DEFAULT_SETTINGS.claudeHooks
  };
}

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
