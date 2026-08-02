import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import {
  installAgentHooks,
  uninstallAgentHooks,
  hooksStatus,
  availableTargets,
  installedTargets,
  stableScript
} from '../src/main/cerberus/hook-install.js';
import { commandFor, isStaleCommand, type TargetId } from '../src/core/hook-targets.js';

// install/uninstall/status all take the home dir, so a tmpdir keeps the real
// ~/.claude and ~/.copilot out of it. The registered command still points at
// the real ~/.cerberus-term — that's the stable path, not a target.
let home: string;
const NOTIFY = join(homedir(), '.cerberus-term', 'hooks', 'notify.sh');
const COPILOT_NOTIFY = join(homedir(), '.cerberus-term', 'hooks', 'copilot-notify.sh');

// Every agent, i.e. what the consent dialog produces when nothing is unticked.
const ALL = ['claude', 'copilot'] as const;

const claudeFile = (): string => join(home, '.claude', 'settings.json');
const copilotFile = (): string => join(home, '.copilot', 'settings.json');

interface ClaudeSettings {
  hooks: Record<string, { matcher?: string; hooks: { type: string; command: string }[] }[]>;
  [k: string]: unknown;
}
interface CopilotSettings {
  hooks: Record<string, { type?: string; bash?: string; timeoutSec?: number }[]>;
  [k: string]: unknown;
}

const read = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
const commandsFor = (s: ClaudeSettings, event: string): string[] =>
  (s.hooks[event] ?? []).flatMap((g) => g.hooks.map((h) => h.command));

// Pretend the CLI is installed here: it's the config dir existing that decides
// whether we register at all.
const withConfigDir = (name: string): void => {
  mkdirSync(join(home, name), { recursive: true });
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cerberus-home-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('hook install / uninstall', () => {
  it('points at the stable path under ~/.cerberus-term', () => {
    expect(stableScript('notify.sh')).toBe(NOTIFY);
  });

  it('skips an agent whose config dir does not exist, and never creates it', () => {
    installAgentHooks(ALL, home);
    expect(existsSync(join(home, '.claude'))).toBe(false);
    expect(existsSync(join(home, '.copilot'))).toBe(false);

    const status = hooksStatus(home);
    expect(status.map((t) => t.available)).toEqual([false, false]);
    expect(status.every((t) => !t.installed)).toBe(true);
  });

  it('registers one entry per event and is idempotent', () => {
    withConfigDir('.claude');
    installAgentHooks(ALL, home);

    const first = read<ClaudeSettings>(claudeFile());
    expect(Object.keys(first.hooks)).toEqual([
      'PreToolUse',
      'PostToolUse',
      'Notification',
      'SessionEnd'
    ]);
    expect(hooksStatus(home).find((t) => t.id === 'claude')?.installed).toBe(true);

    installAgentHooks(ALL, home);
    expect(read<ClaudeSettings>(claudeFile())).toEqual(first);
  });

  it('registers Copilot in its own flat shape, on its own events', () => {
    withConfigDir('.copilot');
    installAgentHooks(ALL, home);

    const s = read<CopilotSettings>(copilotFile());
    expect(Object.keys(s.hooks)).toEqual(['preToolUse', 'notification', 'agentStop']);
    expect(s.hooks['preToolUse']).toEqual([
      { type: 'command', bash: COPILOT_NOTIFY, timeoutSec: 5 }
    ]);
  });

  it('registers each installed agent independently', () => {
    withConfigDir('.copilot');
    installAgentHooks(ALL, home);

    expect(existsSync(copilotFile())).toBe(true);
    expect(existsSync(claudeFile())).toBe(false); // no ~/.claude — left alone
  });

  it('registers only the agents it was given, even when both are installed', () => {
    withConfigDir('.claude');
    withConfigDir('.copilot');
    installAgentHooks(['copilot'], home);

    expect(existsSync(copilotFile())).toBe(true);
    expect(existsSync(claudeFile())).toBe(false); // present, but not asked for
  });

  it('registers nothing at all for an empty list', () => {
    withConfigDir('.claude');
    withConfigDir('.copilot');
    installAgentHooks([], home);

    expect(existsSync(claudeFile())).toBe(false);
    expect(existsSync(copilotFile())).toBe(false);
  });

  it('unticking one agent leaves the other one registered', () => {
    withConfigDir('.claude');
    withConfigDir('.copilot');
    installAgentHooks(ALL, home);

    const res = uninstallAgentHooks(['copilot'], home);
    expect(res.ok).toBe(true);
    expect(res.removed).toBe(3);

    const byId = Object.fromEntries(hooksStatus(home).map((t) => [t.id, t.installed]));
    expect(byId['claude']).toBe(true);
    expect(byId['copilot']).toBe(false);
  });

  it('reports only the agents whose config dir exists', () => {
    expect(availableTargets(home)).toEqual([]);
    withConfigDir('.copilot');
    expect(availableTargets(home)).toEqual(['copilot']);
  });

  // What the <=0.7.0 upgrade path reads: those installs registered on every
  // launch with no switch in the settings file, so what's on disk is the only
  // record of the arrangement to carry over.
  it('reports the agents that already carry an entry of ours', () => {
    withConfigDir('.claude');
    withConfigDir('.copilot');
    expect(installedTargets(home)).toEqual([]);
    installAgentHooks(['claude'], home);
    expect(installedTargets(home)).toEqual(['claude']);
  });

  // The shape settings-ipc applies on every answer: register what's ticked,
  // strip what isn't. Deliberately not a diff against the previously ticked
  // list — reading a full "before" as "nothing new to add" is what once made
  // the first-run "yes" record consent and then install nothing.
  it('converges the config files onto the ticked list', () => {
    withConfigDir('.claude');
    withConfigDir('.copilot');
    const converge = (chosen: readonly TargetId[]): void => {
      installAgentHooks(chosen, home);
      uninstallAgentHooks(
        ALL.filter((id) => !chosen.includes(id)),
        home
      );
    };

    converge(ALL);
    expect(installedTargets(home)).toEqual(['claude', 'copilot']);
    converge(ALL); // idempotent: saying the same thing twice changes nothing
    expect(installedTargets(home)).toEqual(['claude', 'copilot']);
    converge(['claude']);
    expect(installedTargets(home)).toEqual(['claude']);
    converge([]);
    expect(installedTargets(home)).toEqual([]);
  });

  it('appends to existing hooks instead of replacing them', () => {
    withConfigDir('.claude');
    writeFileSync(
      claudeFile(),
      JSON.stringify({
        model: 'opus',
        hooks: {
          PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: '/opt/mycli/hook.sh' }] }]
        }
      })
    );
    installAgentHooks(ALL, home);

    const s = read<ClaudeSettings>(claudeFile());
    expect(s['model']).toBe('opus');
    expect(commandsFor(s, 'PreToolUse')).toEqual(['/opt/mycli/hook.sh', NOTIFY]);
  });

  it('backs the original up once, before the first write', () => {
    withConfigDir('.claude');
    writeFileSync(claudeFile(), JSON.stringify({ model: 'opus' }));
    installAgentHooks(ALL, home);
    expect(JSON.parse(readFileSync(`${claudeFile()}.cerberus-bak`, 'utf8'))).toEqual({
      model: 'opus'
    });
  });

  it('removes only our entries, from every agent at once', () => {
    withConfigDir('.claude');
    withConfigDir('.copilot');
    writeFileSync(
      claudeFile(),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: '/opt/mycli/hook.sh' }] }]
        }
      })
    );
    writeFileSync(
      copilotFile(),
      JSON.stringify({
        model: 'sonnet',
        hooks: { preToolUse: [{ type: 'command', bash: '/opt/other/hook.sh' }] }
      })
    );
    installAgentHooks(ALL, home);

    const res = uninstallAgentHooks(ALL, home);
    expect(res.ok).toBe(true);
    expect(res.removed).toBe(7); // four events for Claude, three for Copilot

    const c = read<ClaudeSettings>(claudeFile());
    expect(c.hooks['PreToolUse']).toEqual([
      { matcher: '', hooks: [{ type: 'command', command: '/opt/mycli/hook.sh' }] }
    ]);
    // Events that only ever held our hook are dropped, not left empty.
    expect(c.hooks['PostToolUse']).toBeUndefined();

    const p = read<CopilotSettings>(copilotFile());
    expect(p['model']).toBe('sonnet');
    expect(p.hooks['preToolUse']).toEqual([{ type: 'command', bash: '/opt/other/hook.sh' }]);
    expect(p.hooks['agentStop']).toBeUndefined();

    expect(hooksStatus(home).every((t) => !t.installed)).toBe(true);
  });

  it('is a no-op when nothing of ours is registered', () => {
    withConfigDir('.claude');
    writeFileSync(claudeFile(), JSON.stringify({ hooks: {} }));
    expect(uninstallAgentHooks(ALL, home)).toEqual({ ok: true, removed: 0 });
  });

  it('refuses to touch an unparseable config', () => {
    withConfigDir('.claude');
    writeFileSync(claudeFile(), '{ not json');
    installAgentHooks(ALL, home);
    expect(readFileSync(claudeFile(), 'utf8')).toBe('{ not json');
    expect(existsSync(`${claudeFile()}.cerberus-bak`)).toBe(false);
    expect(uninstallAgentHooks(ALL, home).ok).toBe(false);
  });

  it('migrates a stale .app path to the stable one', () => {
    withConfigDir('.claude');
    const stale = '/Applications/Cerberus.app/Contents/Resources/hooks/notify.sh';
    writeFileSync(
      claudeFile(),
      JSON.stringify({
        hooks: { PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: stale }] }] }
      })
    );
    installAgentHooks(ALL, home);

    expect(commandsFor(read<ClaudeSettings>(claudeFile()), 'PreToolUse')).toEqual([NOTIFY]);
  });

  it('leaves another tool hook that merely lives in a repo checkout alone', () => {
    withConfigDir('.claude');
    const theirs = '/Users/x/dev/cerberus-term/resources/hooks/their-hook.sh';
    writeFileSync(
      claudeFile(),
      JSON.stringify({
        hooks: { PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: theirs }] }] }
      })
    );
    installAgentHooks(ALL, home);

    expect(commandsFor(read<ClaudeSettings>(claudeFile()), 'PreToolUse')).toEqual([theirs, NOTIFY]);
  });
});

// The platform is an argument all the way down, so these run on any host — no
// module reset, no faked global. That's the reason it's an argument.
describe('windows', () => {
  const PS1 = join(homedir(), '.cerberus-term', 'hooks', 'notify.ps1');
  const WIN_COMMAND = `Invoke-Expression (Get-Content -Raw '${PS1}')`;

  it('registers a .ps1 through an invocation, not a bare path', () => {
    expect(commandFor('/Users/x/.cerberus-term/hooks/notify.sh', 'posix')).toBe(
      '/Users/x/.cerberus-term/hooks/notify.sh'
    );
    expect(commandFor('C:\\Users\\x\\.cerberus-term\\hooks\\notify.ps1', 'win32')).toBe(
      "Invoke-Expression (Get-Content -Raw 'C:\\Users\\x\\.cerberus-term\\hooks\\notify.ps1')"
    );
  });

  it("doubles a single quote in the path, which would otherwise end PowerShell's string", () => {
    expect(commandFor("C:\\Users\\o'brien\\hooks\\notify.ps1", 'win32')).toBe(
      "Invoke-Expression (Get-Content -Raw 'C:\\Users\\o''brien\\hooks\\notify.ps1')"
    );
  });

  it('writes that command into the agent config, and recognises it as ours', () => {
    withConfigDir('.claude');
    installAgentHooks(ALL, home, 'win32');

    const s = read<ClaudeSettings>(claudeFile());
    expect(commandsFor(s, 'PreToolUse')).toEqual([WIN_COMMAND]);
    expect(hooksStatus(home, 'win32').find((t) => t.id === 'claude')?.command).toBe(WIN_COMMAND);
    expect(installedTargets(home, 'win32')).toEqual(['claude']);

    // The half that breaks if ownership() still compares against a bare path:
    // the entry stops being recognised and can never be removed again.
    const res = uninstallAgentHooks(ALL, home, 'win32');
    expect(res.removed).toBe(4);
    expect(read<ClaudeSettings>(claudeFile()).hooks).toEqual({});
  });

  it('is idempotent, so a relaunch does not stack a second entry', () => {
    withConfigDir('.claude');
    installAgentHooks(ALL, home, 'win32');
    const first = read<ClaudeSettings>(claudeFile());
    installAgentHooks(ALL, home, 'win32');
    expect(read<ClaudeSettings>(claudeFile())).toEqual(first);
  });

  it('leaves Copilot alone: its hook field is called bash and nobody has tested it there', () => {
    withConfigDir('.copilot');
    installAgentHooks(ALL, home, 'win32');

    expect(existsSync(copilotFile())).toBe(false);
    expect(availableTargets(home, 'win32')).toEqual([]);
    expect(hooksStatus(home, 'win32').find((t) => t.id === 'copilot')?.available).toBe(false);
  });

  it('does not confuse a POSIX entry with a Windows one', () => {
    withConfigDir('.claude');
    installAgentHooks(ALL, home, 'posix');
    // Same machine, other platform's command: not ours to touch from here.
    expect(uninstallAgentHooks(ALL, home, 'win32').removed).toBe(0);
    expect(commandsFor(read<ClaudeSettings>(claudeFile()), 'PreToolUse')).toEqual([NOTIFY]);
  });

  it('recognises a stale backslash path, which the old forward-slash match missed', () => {
    const stale =
      'C:\\Users\\x\\dev\\cerberus-term\\resources\\hooks\\notify.ps1';
    expect(isStaleCommand(stale, 'notify.ps1', WIN_COMMAND)).toBe(true);
    // Migrated in place rather than left behind on every session's hot path.
    withConfigDir('.claude');
    writeFileSync(
      claudeFile(),
      JSON.stringify({
        hooks: { PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: stale }] }] }
      })
    );
    installAgentHooks(ALL, home, 'win32');
    expect(commandsFor(read<ClaudeSettings>(claudeFile()), 'PreToolUse')).toEqual([WIN_COMMAND]);
  });

  it('still refuses to claim a hook that is merely near ours', () => {
    // The script name has to sit directly under the stale root.
    expect(
      isStaleCommand(
        'C:\\Users\\x\\dev\\cerberus-term\\resources\\hooks\\their-hook.ps1',
        'notify.ps1',
        WIN_COMMAND
      )
    ).toBe(false);
    // Our own current command is not stale.
    expect(isStaleCommand(WIN_COMMAND, 'notify.ps1', WIN_COMMAND)).toBe(false);
    // A path that mentions the root somewhere but points elsewhere.
    expect(
      isStaleCommand(
        'C:\\tools\\cerberus-term\\resources\\hooks\\sub\\notify.ps1',
        'notify.ps1',
        WIN_COMMAND
      )
    ).toBe(false);
  });
});
