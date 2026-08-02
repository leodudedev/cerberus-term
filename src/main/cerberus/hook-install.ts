import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  renameSync
} from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  HOOK_TARGETS,
  isStaleCommand,
  commandFor,
  type HookPlatform,
  type HookTarget,
  type TargetId
} from '../../core/hook-targets.js';
import type { HookTargetStatus } from '../../core/settings.js';

// Silently install the notification hooks so a native pane's CLI reports back
// to our daemon. Idempotent + backed up: we APPEND to the existing hook lists
// without touching unrelated hooks (rtk, mycli, the user's own). Coexistence
// with a tmux-gated hook is by env gating (CERBERUS_PANE_ID vs TMUX_PANE).
//
// One row per agent in core/hook-targets.ts. An agent is registered only if its
// config dir already exists: we never create ~/.claude or ~/.copilot to put
// hooks in it, because their absence means that CLI isn't installed here.
//
// The registered command points at a STABLE copy under ~/.cerberus-term/hooks,
// refreshed from the app bundle on every launch — never inside the .app or the
// repo. Hooks are global: every session on the machine (VS Code, plain
// terminal…) runs them, and a path into a moved/deleted .app would error in all
// of them. The stable copy survives app reinstalls, and outside a Cerberus pane
// the script exits 0 instantly (CERBERUS_PANE_ID gate). Stale entries pointing
// into an app bundle or a repo checkout are migrated to the stable path.

interface AgentSettings {
  hooks?: Record<string, unknown[]>;
  [k: string]: unknown;
}

export function stableHooksDir(): string {
  return join(homedir(), '.cerberus-term', 'hooks');
}

export function stableScript(name: string): string {
  return join(stableHooksDir(), name);
}

// Resolved here, not inside core/hook-targets.ts, so the shape logic stays a
// pure function of its arguments and the win32 cases are testable without
// faking a global.
export function hookPlatform(): HookPlatform {
  return process.platform === 'win32' ? 'win32' : 'posix';
}

// The exact string we register for a target, wherever its script lives.
function commandOf(t: HookTarget, platform: HookPlatform): string {
  return commandFor(stableScript(t.script(platform)), platform);
}

function readSettings(file: string): AgentSettings | null {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as AgentSettings;
  } catch (e) {
    console.error('[hooks] unreadable, leaving alone:', file, (e as Error).message);
    return null;
  }
}

// Backup once, then swap atomically: never risk leaving someone else's config
// truncated, and always leave the pre-Cerberus file recoverable.
function writeSettings(file: string, settings: AgentSettings): void {
  if (existsSync(file) && !existsSync(`${file}.cerberus-bak`)) {
    copyFileSync(file, `${file}.cerberus-bak`);
  }
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.cerberus-tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2));
  renameSync(tmp, file);
}

// Ours, wherever it currently points: the stable path, or a stale .app/repo one.
// Compared against the full registered command, not the bare script path — on
// Windows those two differ, and getting it wrong means either never recognising
// our own entries again or, worse, deleting somebody else's.
function ownership(t: HookTarget, platform: HookPlatform): (command: string) => boolean {
  const script = t.script(platform);
  const stable = commandOf(t, platform);
  return (command) => command === stable || isStaleCommand(command, script, stable);
}

// What we'd edit and what's actually there, per agent, so the UI can show the
// real list — the exact files, events and command — instead of naming one
// hardcoded path and asking to be trusted on the rest.
export function hooksStatus(home = homedir(), platform = hookPlatform()): HookTargetStatus[] {
  return HOOK_TARGETS.map((t) => {
    const file = t.settingsFile(home);
    const settings = readSettings(file);
    const isOurs = ownership(t, platform);
    const installed = Object.values(settings?.hooks ?? {}).some(
      (list) => Array.isArray(list) && t.prune(list, isOurs).removed > 0
    );
    return {
      id: t.id,
      label: t.label,
      file,
      events: [...t.events],
      command: commandOf(t, platform),
      // An agent we don't register on this platform is reported the same way as
      // one that isn't installed: nothing to tick, nothing to ask about.
      available: t.supported(platform) && existsSync(t.configDir(home)),
      installed
    };
  });
}

export function availableTargets(home = homedir(), platform = hookPlatform()): TargetId[] {
  return HOOK_TARGETS.filter((t) => t.supported(platform) && existsSync(t.configDir(home))).map(
    (t) => t.id
  );
}

// Agents whose config already carries an entry of ours, whoever put it there.
export function installedTargets(home = homedir(), platform = hookPlatform()): TargetId[] {
  return hooksStatus(home, platform)
    .filter((t) => t.installed)
    .map((t) => t.id);
}

// Remove only the entries we registered, from the given agents only, leaving
// every other hook exactly where it is. Empty groups and events left behind
// are dropped. Takes the ids explicitly: unticking one agent in Settings must
// not disturb the others.
export function uninstallAgentHooks(
  ids: readonly TargetId[],
  home = homedir(),
  platform = hookPlatform()
): {
  ok: boolean;
  removed: number;
  error?: string;
} {
  let removed = 0;
  const errors: string[] = [];

  for (const t of HOOK_TARGETS) {
    if (!ids.includes(t.id)) continue;
    const file = t.settingsFile(home);
    if (!existsSync(file)) continue;

    const settings = readSettings(file);
    if (!settings) {
      errors.push(`Can't parse ${file}`);
      continue;
    }

    const isOurs = ownership(t, platform);
    let touched = 0;
    for (const [ev, list] of Object.entries(settings.hooks ?? {})) {
      if (!Array.isArray(list)) continue;
      const res = t.prune(list, isOurs);
      touched += res.removed;
      if (res.list.length > 0) settings.hooks![ev] = res.list;
      else delete settings.hooks![ev];
    }
    if (touched === 0) continue;

    try {
      writeSettings(file, settings);
      console.log('[hooks] removed', touched, 'entries from', file);
      removed += touched;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }

  if (errors.length > 0) return { ok: false, removed, error: errors.join('; ') };
  return { ok: true, removed };
}

// Copy the hook scripts from the app bundle to the stable dir (refreshed every
// launch so updates propagate). Returns the stable dir.
export function syncHookScripts(
  bundledHooksDir: string,
  targetDir = stableHooksDir(),
  platform = hookPlatform()
): string {
  mkdirSync(targetDir, { recursive: true });
  for (const t of HOOK_TARGETS) {
    if (!t.supported(platform)) continue;
    const script = t.script(platform);
    const src = join(bundledHooksDir, script);
    if (!existsSync(src)) continue;
    const dst = join(targetDir, script);
    copyFileSync(src, dst);
    // Nothing executes these by their mode bit on Windows, and the invocation
    // reads the file rather than loading it as a script.
    if (platform !== 'win32') chmodSync(dst, 0o755);
  }
  return targetDir;
}

function installOne(t: HookTarget, home: string, platform: HookPlatform): void {
  if (!t.supported(platform)) return; // not an agent we register on this platform
  if (!existsSync(t.configDir(home))) return; // CLI not installed here — not ours to create
  const file = t.settingsFile(home);

  const settings = readSettings(file);
  if (!settings) return; // unreadable — never clobber it

  const command = commandOf(t, platform);
  const isOurs = ownership(t, platform);
  settings.hooks ??= {};

  let changed = false;
  for (const ev of t.events) {
    const before = Array.isArray(settings.hooks[ev]) ? settings.hooks[ev] : [];

    // Migrate stale entries (old .app / repo paths) off every session's hot path.
    const pruned = t.prune(before, (c) => c !== command && isOurs(c));
    if (pruned.removed > 0) changed = true;

    let list = pruned.list;
    if (!t.has(list, command)) {
      list = t.add(list, command);
      changed = true;
    }
    settings.hooks[ev] = list;
  }

  if (!changed) return; // already installed — nothing to do

  try {
    writeSettings(file, settings);
    console.log('[hooks] registered', t.label, 'hooks in', file);
  } catch (e) {
    console.error('[hooks] install failed for', t.label, (e as Error).message);
  }
}

// Register only the agents that were explicitly ticked. An id whose config dir
// is gone is skipped by installOne, not an error: someone can keep Copilot
// enabled across an uninstall/reinstall of Copilot itself.
export function installAgentHooks(
  ids: readonly TargetId[],
  home = homedir(),
  platform = hookPlatform()
): void {
  for (const t of HOOK_TARGETS) if (ids.includes(t.id)) installOne(t, home, platform);
}
