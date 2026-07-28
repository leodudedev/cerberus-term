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
  // Register the notification hooks in each installed agent CLI's config on
  // every launch. Turning this off also removes the ones already there —
  // without the flag the next launch would just put them back. Undefined
  // counts as on. Was `claudeHooks` before Copilot joined the list.
  agentHooks?: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  telegram: {},
  skipCloseConfirm: false,
  agentHooks: true
};

// Fill the gaps in a settings object read off disk (or handed over by the
// renderer) with the defaults. Every field has to be listed: this rebuilds the
// object rather than spreading, so a field forgotten here is silently dropped
// on save and reverts to its default on the next read.
export function mergeSettings(parsed: Partial<Settings> | null | undefined): Settings {
  const p = parsed ?? {};
  // claudeHooks was the pre-Copilot name. Read it once so anyone who had opted
  // out doesn't silently get the hooks reinstalled by the rename.
  const legacyHooks = (p as { claudeHooks?: boolean }).claudeHooks;
  return {
    telegram: { ...DEFAULT_SETTINGS.telegram, ...(p.telegram ?? {}) },
    defaultShell: p.defaultShell ?? DEFAULT_SETTINGS.defaultShell,
    skipCloseConfirm: p.skipCloseConfirm ?? DEFAULT_SETTINGS.skipCloseConfirm,
    agentHooks: p.agentHooks ?? legacyHooks ?? DEFAULT_SETTINGS.agentHooks
  };
}

export type SaveResult = { ok: true } | { ok: false; error: string };

export interface HookTargetStatus {
  id: string;
  label: string; // "Claude Code"
  file: string; // the config we'd edit
  available: boolean; // its config dir exists — the CLI is installed here
  installed: boolean;
}

export interface SettingsBridge {
  get(): Promise<Settings>;
  save(s: Settings): Promise<SaveResult>;
  hooksStatus(): Promise<HookTargetStatus[]>;
}
