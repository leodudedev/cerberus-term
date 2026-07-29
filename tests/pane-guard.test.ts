import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeProcessName, sensitiveProcess } from '../src/core/sensitive-process.js';
import { setStatePath } from '../src/core/persist.js';

// registry.ts seeds its map at import time, so the state path has to be
// redirected before the module is pulled in — hence the dynamic import.
let reg: typeof import('../src/core/registry.js');
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cerberus-registry-'));
  setStatePath(join(dir, 'state.json'));
  reg = await import('../src/core/registry.js');
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('foreground process name normalisation', () => {
  it('reduces paths, login-shell dashes and args to a bare name', () => {
    expect(normalizeProcessName('/usr/bin/ssh')).toBe('ssh');
    expect(normalizeProcessName('-zsh')).toBe('zsh');
    expect(normalizeProcessName('SSH')).toBe('ssh');
    expect(normalizeProcessName('ssh user@host')).toBe('ssh');
    expect(normalizeProcessName('/usr/bin/sudo -u nobody id')).toBe('sudo');
    expect(normalizeProcessName('C:\\Windows\\System32\\OpenSSH\\ssh.exe')).toBe('ssh');
    expect(normalizeProcessName('  ')).toBe('');
  });
});

describe('sensitive process deny-list', () => {
  it('blocks the programs that turn stray text into a leaked credential', () => {
    for (const p of ['ssh', 'sudo', 'su', 'doas', 'gpg', 'scp', 'sftp', 'mysql', 'psql', 'passwd', 'ftp', 'telnet']) {
      expect(sensitiveProcess(p)).toBe(p);
    }
  });

  it('returns the matched name so the refusal can say what blocked it', () => {
    expect(sensitiveProcess('/usr/bin/sudo')).toBe('sudo');
  });

  it('lets an agent and a plain shell through', () => {
    for (const p of ['node', 'claude', 'copilot', 'zsh', '-zsh', 'bash', 'python3', '']) {
      expect(sensitiveProcess(p)).toBe('');
    }
  });

  it('matches whole names only, so a prefix is not a match', () => {
    // `su` must not swallow `sublime`, and `ssh` must not swallow `ssh-agent`
    // (which holds no prompt and is harmless).
    expect(sensitiveProcess('sublime')).toBe('');
    expect(sensitiveProcess('ssh-agent')).toBe('');
    expect(sensitiveProcess('sudoedit')).toBe('');
  });
});

describe('session lifetime', () => {
  const session = (id: string) => ({
    sessionId: id,
    agent: 'claude' as const,
    pane: `pane-${id}`,
    profile: 'claude' as const,
    cwd: '/proj',
    lastMessage: '',
    detail: '',
    toolName: '',
    command: '',
    options: [],
    hasAlways: false,
    isPermission: false
  });

  it('drops a session so its pane stops being a target', () => {
    reg.upsertSession(session('s1'));
    expect(reg.getSession('s1')).toBeDefined();

    expect(reg.dropSession('s1')).toBe(true);
    expect(reg.getSession('s1')).toBeUndefined();
    expect(reg.mostRecentSession()?.sessionId).not.toBe('s1');
  });

  it('is a no-op for an unknown session', () => {
    expect(reg.dropSession('never-existed')).toBe(false);
  });

  it('keeps the message link after the session is dropped, so a reply is refused', () => {
    reg.upsertSession(session('s2'));
    reg.linkMessage(42, 's2');
    expect(reg.sessionForMessage(42)?.sessionId).toBe('s2');

    reg.dropSession('s2');
    // The link survives on purpose: hasMessageLink true + sessionForMessage
    // undefined is what tells the bot to refuse rather than fall back to the
    // most recent session.
    expect(reg.hasMessageLink(42)).toBe(true);
    expect(reg.sessionForMessage(42)).toBeUndefined();
  });

  it('reports no link for a message that was never a notification', () => {
    expect(reg.hasMessageLink(999)).toBe(false);
  });
});
