import { join } from 'node:path';

// The CLIs whose config we register notification hooks in. One row per agent:
// where its config lives, which script it runs, which events it fires, and how
// its entries are shaped — the shapes genuinely differ, so a list of paths
// wouldn't be enough. Adding an agent should be adding a row here.
//
// Deliberately free of fs and Electron so the shape logic is testable on its
// own; the caller resolves the home dir and does the reading and writing.

export type TargetId = 'claude' | 'copilot';

export interface HookTarget {
  id: TargetId;
  label: string;
  script: string; // file name under ~/.cerberus-term/hooks
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

// An entry of ours registered under a now-obsolete location: inside an .app
// bundle or a repo checkout, both of which move or vanish. Deliberately narrow
// — it decides what we're allowed to delete, and other tools' hooks must never
// match it.
export function isStaleCommand(command: string, script: string, stablePath: string): boolean {
  if (command === stablePath) return false;
  if (!command.endsWith(`/${script}`)) return false;
  return (
    command.includes('Cerberus.app/Contents/Resources/hooks/') ||
    command.includes('cerberus-term/resources/hooks/')
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
  script: 'notify.sh',
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
  script: 'copilot-notify.sh',
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
