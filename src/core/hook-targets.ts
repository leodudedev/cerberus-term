import { join } from 'node:path';

// The CLIs whose config we register notification hooks in. One row per agent:
// where its config lives, which script it runs, which events it fires, and how
// its entries are shaped — the shapes genuinely differ, so a list of paths
// wouldn't be enough. Adding an agent should be adding a row here.
//
// Deliberately free of fs and Electron so the shape logic is testable on its
// own; the caller resolves the home dir and does the reading and writing.

export type TargetId = 'claude' | 'copilot';

// Passed in rather than read from process.platform in here: the targets are
// constants evaluated at import time, so a module-level read couldn't be faked
// after the fact and every win32 test would need vi.resetModules().
export type HookPlatform = 'posix' | 'win32';

export interface HookTarget {
  id: TargetId;
  label: string;
  // File name under ~/.cerberus-term/hooks. Platform-dependent because a POSIX
  // shell can't run a .ps1 and PowerShell can't run a .sh.
  script(platform: HookPlatform): string;
  // Whether we register this agent at all on a platform. Not the same question
  // as "is its config dir there".
  supported(platform: HookPlatform): boolean;
  events: readonly string[];
  // The agent's own config dir. We register only when it already exists: its
  // absence means the CLI was never run here, and creating someone else's
  // config dir to put hooks in it is not ours to do.
  configDir(home: string): string;
  settingsFile(home: string): string;
  // Entry-list operations, per event. The list is whatever was on disk, so
  // every one of these has to survive garbage.
  has(list: unknown[], command: string): boolean;
  add(list: unknown[], command: string): unknown[];
  prune(list: unknown[], isOurs: (command: string) => boolean): { list: unknown[]; removed: number };
}

// What we register in the agent's config, given the script's stable path.
//
// On POSIX the path is executable as-is. On Windows it isn't, and how we invoke
// it is load-bearing: a .ps1 handed to a script loader is subject to the
// machine's ExecutionPolicy, whose default on Windows client is Restricted — a
// blocked script prints UnauthorizedAccess on EVERY tool call of EVERY session,
// which is the exact regression the old win32 gate existed to prevent, and the
// CERBERUS_PANE_ID gate can't save us because the policy fires before the
// script runs. Spawning `powershell -ExecutionPolicy Bypass -File` instead is
// immune but costs a second PowerShell: 438ms per tool call, measured.
//
// Reading the file and evaluating it in the PowerShell the agent already
// started avoids both — ExecutionPolicy governs loading script FILES, not
// Invoke-Expression — while keeping the logic in a versioned file that
// syncHookScripts can refresh without rewriting anyone's config.
export function commandFor(scriptPath: string, platform: HookPlatform): string {
  if (platform !== 'win32') return scriptPath;
  // PowerShell single quotes are literal; a quote inside the path is escaped by
  // doubling it. Paths can legally contain one.
  const quoted = scriptPath.replace(/'/g, "''");
  return `Invoke-Expression (Get-Content -Raw '${quoted}')`;
}

// An entry of ours registered under a now-obsolete location: inside an .app
// bundle or a repo checkout, both of which move or vanish. Deliberately narrow
// — it decides what we're allowed to delete, and other tools' hooks must never
// match it. The script name has to sit DIRECTLY under one of those roots, which
// is stricter than matching the root and the name independently.
//
// Separators are normalised first: on Windows the path in a registered command
// carries backslashes, and comparing them against a hardcoded '/' silently
// matched nothing — leaving our own stale entries behind forever.
export function isStaleCommand(command: string, script: string, stableCommand: string): boolean {
  if (command === stableCommand) return false;
  const c = command.replace(/\\/g, '/');
  return (
    c.includes(`Cerberus.app/Contents/Resources/hooks/${script}`) ||
    c.includes(`cerberus-term/resources/hooks/${script}`)
  );
}

// --- Claude Code -----------------------------------------------------------
// hooks[Event] = [{ matcher, hooks: [{ type, command }] }]

interface ClaudeGroup {
  matcher?: string;
  hooks?: { type?: string; command?: string }[];
}

const claude: HookTarget = {
  id: 'claude',
  label: 'Claude Code',
  script: (platform) => (platform === 'win32' ? 'notify.ps1' : 'notify.sh'),
  supported: () => true,
  // SessionEnd is not a notification: it's what lets the daemon forget a
  // session as soon as it ends, so its pane stops being a target for Telegram
  // replies. `/exit` fires nothing else.
  events: ['PreToolUse', 'PostToolUse', 'Notification', 'SessionEnd'],
  configDir: (home) => join(home, '.claude'),
  settingsFile: (home) => join(home, '.claude', 'settings.json'),

  has: (list, command) =>
    (list as ClaudeGroup[]).some((g) => g?.hooks?.some((h) => h?.command === command)),

  add: (list, command) => [...list, { matcher: '', hooks: [{ type: 'command', command }] }],

  prune: (list, isOurs) => {
    let removed = 0;
    const groups = (list as ClaudeGroup[]).map((g) => {
      if (!g?.hooks) return g;
      const kept = g.hooks.filter((h) => !(h?.command && isOurs(h.command)));
      removed += g.hooks.length - kept.length;
      return { ...g, hooks: kept };
    });
    // A group we emptied was ours alone — drop it rather than leave a husk.
    return { list: groups.filter((g) => !g?.hooks || g.hooks.length > 0), removed };
  }
};

// --- GitHub Copilot CLI ----------------------------------------------------
// hooks[event] = [{ type: "command", bash, timeoutSec }] — a flat list, no
// matcher wrapper. ~/.copilot/settings.json is a documented inline hooks
// location alongside the standalone files in ~/.copilot/hooks/.
//
// preToolUse fails closed: a non-zero exit denies the tool call, so the script
// exits 0 unconditionally and we cap it with a short timeout (a timeout fails
// open) rather than let a stalled curl hold up the agent.

interface CopilotEntry {
  type?: string;
  bash?: string;
  timeoutSec?: number;
}

const copilot: HookTarget = {
  id: 'copilot',
  label: 'GitHub Copilot CLI',
  script: (platform) => (platform === 'win32' ? 'copilot-notify.ps1' : 'copilot-notify.sh'),
  // Not on Windows, for now. The field this target registers into is called
  // `bash`, and nobody has yet run a Copilot CLI on Windows to find out whether
  // that name is descriptive — putting a PowerShell line in it would fail on
  // every tool call. Claude Code's field is `command` and was measured: it runs
  // through PowerShell.
  supported: (platform) => platform !== 'win32',
  events: ['preToolUse', 'notification', 'agentStop'],
  configDir: (home) => join(home, '.copilot'),
  settingsFile: (home) => join(home, '.copilot', 'settings.json'),

  has: (list, command) => (list as CopilotEntry[]).some((e) => e?.bash === command),

  add: (list, command) => [...list, { type: 'command', bash: command, timeoutSec: 5 }],

  prune: (list, isOurs) => {
    const kept = (list as CopilotEntry[]).filter((e) => !(e?.bash && isOurs(e.bash)));
    return { list: kept, removed: list.length - kept.length };
  }
};

export const HOOK_TARGETS: readonly HookTarget[] = [claude, copilot];
