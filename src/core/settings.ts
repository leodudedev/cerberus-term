import { HOOK_TARGETS, type TargetId } from './hook-targets.js';

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
  // The agent CLIs we register notification hooks in. These are files outside
  // the app, owned by other tools, so the list is only ever what someone
  // explicitly ticked. Undefined means nobody has been asked yet — that, and
  // only that, opens the first-run consent dialog. An empty array is a
  // recorded "no" and stays one.
  hookTargets?: TargetId[];
  // Which platform the hookTargets answer was given on. Stamped on every write
  // from 0.10 onwards; its absence is what identifies an answer recorded before
  // the platform in question could act on it. See isPreWindowsConsent.
  hookTargetsPlatform?: string;
  // Pre-0.9 master switch (and `claudeHooks` before that). Read once at boot to
  // build hookTargets, then dropped — never written back. Deliberately has no
  // default: undefined is what tells a fresh install apart from an upgrade.
  agentHooks?: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  telegram: {},
  skipCloseConfirm: false
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
    // No default on either: undefined is meaningful for both, and an empty
    // hookTargets must survive as an empty array rather than fall through.
    hookTargets: p.hookTargets ? parseTargetIds(p.hookTargets) : undefined,
    hookTargetsPlatform: p.hookTargetsPlatform,
    agentHooks: p.agentHooks ?? legacyHooks
  };
}

// A hook answer recorded on Windows before Windows was a platform we installed
// on. Until 0.10 the Settings dialog wrote hookTargets there like anywhere else
// while the install half was gated off, so the stored answer describes nothing
// that ever reached disk — and it defaults to every available agent, i.e. "yes".
// Trusting it would install into other tools' config on the next launch without
// anyone having been asked, which is the one thing that list exists to prevent.
// Answers carrying a platform stamp were made with the install live: trusted.
export function isPreWindowsConsent(s: Settings, platform: string): boolean {
  return platform === 'win32' && !!s.hookTargets && !s.hookTargetsPlatform;
}

// Keep only ids we actually have a target for. The list round-trips through
// IPC and a JSON file on disk, so an unknown string is a real possibility —
// a downgrade after an agent was added is enough to produce one.
export function parseTargetIds(value: unknown): TargetId[] {
  if (!Array.isArray(value)) return [];
  const known = HOOK_TARGETS.map((t) => t.id) as string[];
  return value.filter((v): v is TargetId => typeof v === 'string' && known.includes(v));
}

// One-shot upgrade to the explicit per-agent list. Returns null only for a
// genuinely fresh install, which is the one case that must reach the consent
// dialog. Nobody who already has an arrangement is asked to re-confirm it: the
// hooks are in their config either way, so the question would be theatre and a
// "no" answer would leave entries behind that Settings then denies having.
export function migrateHookTargets(
  s: Settings,
  available: TargetId[],
  installed: TargetId[]
): TargetId[] | null {
  if (s.hookTargets) return null; // already decided, [] included
  if (s.agentHooks === false) return []; // an explicit opt-out stays one
  if (s.agentHooks === true) return available;
  // No switch in the file at all: either ≤0.7.0, which registered hooks on
  // every launch with no way to say no, or a hand-registered entry from the
  // README. Both are existing arrangements — keep exactly what's there.
  return installed.length > 0 ? installed : null;
}

export type SaveResult = { ok: true } | { ok: false; error: string };

export interface HookTargetStatus {
  id: TargetId;
  label: string; // "Claude Code"
  file: string; // the config we'd edit
  events: string[]; // the events we'd register under, in that file
  command: string; // the exact command the entries run
  available: boolean; // its config dir exists — the CLI is installed here
  installed: boolean;
}

export interface SettingsBridge {
  get(): Promise<Settings>;
  save(s: Settings): Promise<SaveResult>;
  hooksStatus(): Promise<HookTargetStatus[]>;
  // The agents to ask about at first run, or null when there's nothing to ask:
  // already decided, no agent CLI on this machine, or a platform we don't
  // install on.
  hooksConsent(): Promise<HookTargetStatus[] | null>;
  // Record the answer and act on it. Also the "no" path, with an empty array.
  setHookTargets(ids: string[]): Promise<SaveResult>;
}
