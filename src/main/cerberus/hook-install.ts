import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

// Silently install the Claude Code hooks so a native pane's CLI reports back to
// our daemon. Idempotent + backed up: we APPEND our notify.sh to the existing
// PreToolUse/Notification arrays without touching unrelated hooks (rtk, mycli).
// Coexistence with the tmux mycli hook is by env gating (CERBERUS_PANE_ID vs
// TMUX_PANE), so both can be registered at once.

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

function groupHasCommand(groups: HookGroup[], command: string): boolean {
  return groups.some((g) => g.hooks?.some((h) => h.command === command));
}

export function installClaudeHooks(notifyScript: string): void {
  const file = claudeSettingsPath();

  let settings: ClaudeSettings = {};
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, 'utf8')) as ClaudeSettings;
    } catch (e) {
      console.error('[hooks] settings.json unreadable, skipping install:', (e as Error).message);
      return;
    }
  }

  settings.hooks ??= {};
  const events = ['PreToolUse', 'PostToolUse', 'Notification'] as const;

  let changed = false;
  for (const ev of events) {
    const groups = (settings.hooks[ev] ??= []);
    if (!groupHasCommand(groups, notifyScript)) {
      groups.push({ matcher: '', hooks: [{ type: 'command', command: notifyScript }] });
      changed = true;
    }
  }

  if (!changed) return; // already installed — nothing to do

  try {
    // one-time backup before the first write
    if (existsSync(file) && !existsSync(`${file}.cerberus-bak`)) {
      copyFileSync(file, `${file}.cerberus-bak`);
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(settings, null, 2));
    console.log('[hooks] installed Claude hooks ->', notifyScript);
  } catch (e) {
    console.error('[hooks] install failed:', (e as Error).message);
  }
}
