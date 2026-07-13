# Step 7 spec — global settings + per-path override UI

Repo: `cerberus-term` · Model: **Sonnet 5** (driven by Opus here)
Status: **draft review — no code until approved**

## Goal

An in-app settings screen: Telegram token/chatId (+ allowed chats, language),
default shell, per-agent launch commands. Persisted to a global config file.
Per-project `.cerberus.json` keeps overriding the global (same precedence as the
daemon already applies). Removes the `.env` dependency for Telegram.

## Settings shape — `src/core/settings.ts`

```ts
export interface TelegramSettings {
  token?: string; chatId?: string; allowedChats?: string; lang?: 'en' | 'it';
}
export interface Settings {
  telegram: TelegramSettings;
  launchCmds: Record<string, string>; // agent -> command (extensible: claude, copilot, …)
  defaultShell?: string;              // pty shell when a pane doesn't specify one
}
export const DEFAULT_SETTINGS: Settings =
  { telegram: {}, launchCmds: { claude: 'claude', copilot: 'copilot' } };
export interface SettingsBridge {
  get(): Promise<Settings>;
  save(s: Settings): Promise<{ ok: true } | { ok: false; error: string }>;
}
```

## Store + precedence — `src/main/settings.ts`

- File: `userData/cerberus-settings.json`. `getSettings()` (cached, deep-merged
  over defaults), `saveSettings()`.
- `applySettingsToEnv()`: writes `TELEGRAM_BOT_TOKEN/CHAT_ID/ALLOWED_CHATS` and
  `CERBERUS_LANG` from settings — **force-set**, so in-app wins over `.env`.
- `startCerberus` order: `loadEnvFile()` (dev fallback, fills only missing) →
  `applySettingsToEnv()` (override) → `setStatePath` → install hooks → daemon.
- **Precedence (unchanged where it matters):** per-project `.cerberus.json`
  (chatId/minRisk/notifyIdle/mute) > global settings. The daemon already applies
  the per-project override in `pushAttention`; global just becomes the bot's
  default instead of coming from `.env`.

`bridge-electron.defaultShell()` consults `getSettings().defaultShell` before the
`$SHELL` fallback — a real consumer now. `launchCmds` are stored for a later
"new agent pane" action (not consumed yet).

## IPC + preload

`src/main/settings-ipc.ts`: `settings:get` → `getSettings()`; `settings:save` →
validate, `saveSettings()`, `applySettingsToEnv()` (env refreshed live; the bot
picks up a new **token** on next launch — modal notes this). Preload exposes
`window.cerberusSettings`.

## UI — `src/renderer/SettingsEditor.ts`

A modal form (reuses the config-modal styling): Telegram token (masked), chatId,
allowed chats (csv), language (en/it), default shell, launch cmds (claude,
copilot). Save/Cancel, Esc/backdrop to close. A hint line: changing the Telegram
token needs an app restart to re-poll.

Entry point: **Cmd+,** intercepted in the terminal key handler (like the pane
Cmd combos) → dispatch `open-settings`; `main` opens the editor. (No global
toolbar exists yet; the shortcut is the discoverable entry.)

## Files touched

```
src/core/settings.ts          # NEW — Settings/SettingsBridge types + defaults
src/main/settings.ts          # NEW — store, getSettings/saveSettings, env apply
src/main/settings-ipc.ts      # NEW — get/save IPC
src/main/bridge-electron.ts   # EDIT — defaultShell() from settings
src/main/index.ts             # EDIT — registerSettingsIpc()
src/main/cerberus/index.ts    # EDIT — applySettingsToEnv() in the boot order
src/preload/index.ts          # EDIT — window.cerberusSettings
src/renderer/cerberus.d.ts    # EDIT — window.cerberusSettings type
src/renderer/SettingsEditor.ts# NEW — settings modal
src/renderer/Terminal.ts      # EDIT — Cmd+, -> open-settings
src/renderer/main.ts          # EDIT — handle open-settings
```

No new deps.

## Deliverable / verification

- Cmd+, opens settings; save writes `cerberus-settings.json`; reopening shows the
  saved values.
- With a token set in-app (no `.env`), relaunch → bot enabled from settings.
- `.cerberus.json` chatId still overrides the global for that project.
- `defaultShell` honored by new panes.
- Settings load/merge/env-apply covered by assertions; typecheck + build green;
  modal exercised by hand.

## Explicitly out of scope

Live bot re-init on token change (restart for now), consuming `launchCmds` /
"new agent pane" (later), secret encryption at rest (plaintext like `.env`),
session/layout restore (Step 10).
```
