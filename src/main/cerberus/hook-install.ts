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

// Silently install the Claude Code hooks so a native pane's CLI reports back to
// our daemon. Idempotent + backed up: we APPEND to the existing hook arrays
// without touching unrelated hooks (rtk, mycli). Coexistence with the tmux
// mycli hook is by env gating (CERBERUS_PANE_ID vs TMUX_PANE).
//
// The registered command points at a STABLE copy under ~/.cerberus-term/hooks,
// refreshed from the app bundle on every launch — never inside the .app or the
// repo. Hooks are global: every Claude session (VS Code, plain terminal…) runs
// them, and a path into a moved/deleted .app would error in all of them. The
// stable copy survives app reinstalls, and outside a Cerberus pane it exits 0
// instantly (CERBERUS_PANE_ID gate). Stale entries pointing into an app bundle
// or a repo checkout are migrated to the stable path.

interface HookCmd {
  type: string;
  command: string;
}
interface HookGroup {
  matcher?: string;
  hooks?: HookCmd[];
}
interface ClaudeSettings {
  hooks?: Record<string, HookGroup[]>;
  [k: string]: unknown;
}

function claudeSettingsPath(): string {
  const dir = process.env['CLAUDE_CONFIG_DIR']?.trim() || join(homedir(), '.claude');
  return join(dir, 'settings.json');
}

export function stableHooksDir(): string {
  return join(homedir(), '.cerberus-term', 'hooks');
}

// Our own hook registered under a now-obsolete location (inside an .app bundle
// or a repo checkout). Deliberately narrow so mycli/rtk entries never match.
function isStaleCerberusCommand(command: string, stablePath: string): boolean {
  if (command === stablePath) return false;
  if (!command.endsWith('/notify.sh')) return false;
  return (
    command.includes('Cerberus.app/Contents/Resources/hooks/') ||
    command.includes('cerberus-term/resources/hooks/')
  );
}

function groupHasCommand(groups: HookGroup[], command: string): boolean {
  return groups.some((g) => g.hooks?.some((h) => h.command === command));
}

// Ours, wherever it currently points: the stable path, or a stale .app/repo one.
function isCerberusCommand(command: string, stablePath: string): boolean {
  return command === stablePath || isStaleCerberusCommand(command, stablePath);
}

function readSettings(file: string): ClaudeSettings | null {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as ClaudeSettings;
  } catch (e) {
    console.error('[hooks] settings.json unreadable:', (e as Error).message);
    return null;
  }
}

// Backup once, then swap atomically: never risk leaving Claude's settings.json
// truncated, and always leave the pre-Cerberus file recoverable.
function writeSettings(file: string, settings: ClaudeSettings): void {
  if (existsSync(file) && !existsSync(`${file}.cerberus-bak`)) {
    copyFileSync(file, `${file}.cerberus-bak`);
  }
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.cerberus-tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2));
  renameSync(tmp, file);
}

export function stableNotifyScript(): string {
  return join(stableHooksDir(), 'notify.sh');
}

// Whether our hook is currently registered, and in which file — so the UI can
// name the exact path it's about to edit.
export function claudeHooksStatus(): { file: string; installed: boolean } {
  const file = claudeSettingsPath();
  const settings = readSettings(file);
  const stable = stableNotifyScript();
  const installed = Object.values(settings?.hooks ?? {}).some((groups) =>
    groups.some((g) => g.hooks?.some((h) => isCerberusCommand(h.command, stable)))
  );
  return { file, installed };
}

// Remove only the entries we registered, leaving every other hook (rtk, mycli,
// the user's own) exactly where it is. Empty groups left behind are dropped.
export function uninstallClaudeHooks(): { ok: boolean; removed: number; error?: string } {
  const file = claudeSettingsPath();
  const settings = readSettings(file);
  if (!settings) return { ok: false, removed: 0, error: `Can't parse ${file}` };

  const stable = stableNotifyScript();
  let removed = 0;

  for (const [ev, groups] of Object.entries(settings.hooks ?? {})) {
    for (const g of groups) {
      if (!g.hooks) continue;
      const before = g.hooks.length;
      g.hooks = g.hooks.filter((h) => !isCerberusCommand(h.command, stable));
      removed += before - g.hooks.length;
    }
    const kept = groups.filter((g) => !g.hooks || g.hooks.length > 0);
    if (kept.length > 0) settings.hooks![ev] = kept;
    else delete settings.hooks![ev];
  }

  if (removed === 0) return { ok: true, removed: 0 };

  try {
    writeSettings(file, settings);
    console.log('[hooks] removed', removed, 'Cerberus hook entries from', file);
    return { ok: true, removed };
  } catch (e) {
    return { ok: false, removed: 0, error: (e as Error).message };
  }
}

// Copy the hook scripts from the app bundle to the stable dir (refreshed every
// launch so updates propagate). Returns the stable notify.sh path.
export function syncHookScripts(bundledHooksDir: string, targetDir = stableHooksDir()): string {
  mkdirSync(targetDir, { recursive: true });
  for (const name of ['notify.sh', 'copilot-notify.sh']) {
    const src = join(bundledHooksDir, name);
    if (!existsSync(src)) continue;
    const dst = join(targetDir, name);
    copyFileSync(src, dst);
    chmodSync(dst, 0o755);
  }
  return join(targetDir, 'notify.sh');
}

export function installClaudeHooks(notifyScript: string): void {
  const file = claudeSettingsPath();

  const settings = readSettings(file);
  if (!settings) return; // unreadable — never clobber it

  settings.hooks ??= {};
  const events = ['PreToolUse', 'PostToolUse', 'Notification'] as const;

  let changed = false;
  for (const ev of events) {
    let groups = (settings.hooks[ev] ??= []);

    // Migrate stale entries (old .app / repo paths) off every session's hot path.
    for (const g of groups) {
      if (!g.hooks) continue;
      const before = g.hooks.length;
      g.hooks = g.hooks.filter((h) => !isStaleCerberusCommand(h.command, notifyScript));
      if (g.hooks.length !== before) changed = true;
    }
    groups = groups.filter((g) => !g.hooks || g.hooks.length > 0);
    settings.hooks[ev] = groups;

    if (!groupHasCommand(groups, notifyScript)) {
      groups.push({ matcher: '', hooks: [{ type: 'command', command: notifyScript }] });
      changed = true;
    }
  }

  if (!changed) return; // already installed — nothing to do

  try {
    writeSettings(file, settings);
    console.log('[hooks] installed Claude hooks ->', notifyScript);
  } catch (e) {
    console.error('[hooks] install failed:', (e as Error).message);
  }
}
