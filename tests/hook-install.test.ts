import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import {
  installClaudeHooks,
  uninstallClaudeHooks,
  claudeHooksStatus,
  stableNotifyScript
} from '../src/main/cerberus/hook-install.js';

// The module resolves its target from CLAUDE_CONFIG_DIR, so a tmpdir is enough
// to keep the real ~/.claude/settings.json out of it.
let dir: string;
let file: string;
const NOTIFY = join(homedir(), '.cerberus-term', 'hooks', 'notify.sh');

interface Settings {
  hooks: Record<string, { matcher?: string; hooks: { type: string; command: string }[] }[]>;
  [k: string]: unknown;
}

const readJson = (): Settings => JSON.parse(readFileSync(file, 'utf8')) as Settings;
const commandsFor = (s: Settings, event: string): string[] =>
  (s.hooks[event] ?? []).flatMap((g) => g.hooks.map((h) => h.command));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cerberus-hooks-'));
  file = join(dir, 'settings.json');
  process.env['CLAUDE_CONFIG_DIR'] = dir;
});

afterEach(() => {
  delete process.env['CLAUDE_CONFIG_DIR'];
  rmSync(dir, { recursive: true, force: true });
});

describe('hook install / uninstall', () => {
  it('points at the stable path under ~/.cerberus-term', () => {
    expect(stableNotifyScript()).toBe(NOTIFY);
  });

  it('registers one entry per event and is idempotent', () => {
    installClaudeHooks(NOTIFY);
    const first = readJson();
    expect(Object.keys(first.hooks)).toEqual(['PreToolUse', 'PostToolUse', 'Notification']);
    expect(claudeHooksStatus().installed).toBe(true);

    installClaudeHooks(NOTIFY);
    expect(readJson()).toEqual(first);
  });

  it('appends to existing hooks instead of replacing them', () => {
    writeFileSync(
      file,
      JSON.stringify({
        model: 'opus',
        hooks: {
          PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: '/opt/mycli/hook.sh' }] }]
        }
      })
    );
    installClaudeHooks(NOTIFY);

    const s = readJson();
    expect(s['model']).toBe('opus');
    expect(commandsFor(s, 'PreToolUse')).toEqual(['/opt/mycli/hook.sh', NOTIFY]);
  });

  it('backs the original up once, before the first write', () => {
    writeFileSync(file, JSON.stringify({ model: 'opus' }));
    installClaudeHooks(NOTIFY);
    expect(JSON.parse(readFileSync(`${file}.cerberus-bak`, 'utf8'))).toEqual({ model: 'opus' });
  });

  it('removes only our entries on uninstall', () => {
    writeFileSync(
      file,
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: '/opt/mycli/hook.sh' }] }]
        }
      })
    );
    installClaudeHooks(NOTIFY);

    const res = uninstallClaudeHooks();
    expect(res.ok).toBe(true);
    expect(res.removed).toBe(3); // one per event

    const s = readJson();
    expect(s.hooks['PreToolUse']).toEqual([
      { matcher: '', hooks: [{ type: 'command', command: '/opt/mycli/hook.sh' }] }
    ]);
    // Events that only ever held our hook are dropped, not left empty.
    expect(s.hooks['PostToolUse']).toBeUndefined();
    expect(claudeHooksStatus().installed).toBe(false);
  });

  it('is a no-op when nothing of ours is registered', () => {
    writeFileSync(file, JSON.stringify({ hooks: {} }));
    expect(uninstallClaudeHooks()).toEqual({ ok: true, removed: 0 });
  });

  it('refuses to touch an unparseable settings.json', () => {
    writeFileSync(file, '{ not json');
    installClaudeHooks(NOTIFY);
    expect(readFileSync(file, 'utf8')).toBe('{ not json');
    expect(existsSync(`${file}.cerberus-bak`)).toBe(false);
    expect(uninstallClaudeHooks().ok).toBe(false);
  });

  it('migrates a stale .app path to the stable one', () => {
    const stale = '/Applications/Cerberus.app/Contents/Resources/hooks/notify.sh';
    writeFileSync(
      file,
      JSON.stringify({
        hooks: { PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: stale }] }] }
      })
    );
    installClaudeHooks(NOTIFY);

    expect(commandsFor(readJson(), 'PreToolUse')).toEqual([NOTIFY]);
  });
});
