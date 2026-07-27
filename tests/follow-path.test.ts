import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveFollowPath } from '../src/core/follow-path.js';

// A fake home, so the test never touches the real one.
const roots: string[] = [];
function fakeHome(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cerberus-home-')));
  roots.push(dir);
  return dir;
}
function file(path: string, body = 'x'): string {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
  return path;
}
afterEach(() => {
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('resolveFollowPath — accepted', () => {
  it('accepts a log under home', () => {
    const home = fakeHome();
    const log = file(join(home, 'proj', 'out', 't1.jsonl'));
    expect(resolveFollowPath(log, { home })).toEqual({ ok: true, path: log });
  });

  it('accepts a file that does not exist yet, if its directory does', () => {
    const home = fakeHome();
    mkdirSync(join(home, 'proj', 'out'), { recursive: true });
    const log = join(home, 'proj', 'out', 'not-written-yet.jsonl');
    expect(resolveFollowPath(log, { home })).toEqual({ ok: true, path: log });
  });

  it('accepts a path under a live pane cwd outside home', () => {
    const home = fakeHome();
    const elsewhere = fakeHome(); // stands in for /Volumes/work
    const log = file(join(elsewhere, 'out', 't1.log'));
    expect(resolveFollowPath(log, { home, paneCwds: [elsewhere] })).toEqual({
      ok: true,
      path: log
    });
  });
});

describe('resolveFollowPath — rejected', () => {
  it('rejects a relative path', () => {
    expect(resolveFollowPath('out/t1.log', { home: fakeHome() })).toEqual({
      ok: false,
      reason: 'relative'
    });
  });

  it('rejects an empty path', () => {
    expect(resolveFollowPath('', { home: fakeHome() }).ok).toBe(false);
  });

  it('rejects a path whose directory does not exist', () => {
    const home = fakeHome();
    expect(resolveFollowPath(join(home, 'nope', 'deeper', 'x.log'), { home })).toEqual({
      ok: false,
      reason: 'unresolvable'
    });
  });

  it('rejects a path outside home with no matching pane cwd', () => {
    const home = fakeHome();
    const elsewhere = fakeHome();
    const log = file(join(elsewhere, 'x.log'));
    expect(resolveFollowPath(log, { home })).toEqual({ ok: false, reason: 'outside_roots' });
  });

  it.each([
    ['.ssh/id_rsa', 'the audit example'],
    ['.gnupg/secring.gpg', 'gpg keyring'],
    ['.aws/credentials', 'aws creds'],
    ['.config/gh/hosts.yml', 'gh token'],
    ['.cerberus-term/token', 'our own daemon token'],
    ['.cerberus-term/cerberus-settings.json', 'the telegram bot token'],
    ['.claude/.credentials.json', 'claude credentials'],
    ['Library/Keychains/login.keychain-db', 'macos keychain']
  ])('rejects ~/%s (%s)', (rel) => {
    const home = fakeHome();
    const p = file(join(home, rel));
    expect(resolveFollowPath(p, { home })).toEqual({ ok: false, reason: 'denied_directory' });
  });

  it('rejects a dotenv sitting next to the logs', () => {
    const home = fakeHome();
    expect(resolveFollowPath(file(join(home, 'proj', '.env')), { home }).ok).toBe(false);
    expect(resolveFollowPath(file(join(home, 'proj', '.env.production')), { home }).ok).toBe(false);
  });

  it('does not let ".environment" trip the dotenv rule', () => {
    const home = fakeHome();
    expect(resolveFollowPath(file(join(home, 'p', '.environment')), { home }).ok).toBe(true);
  });
});

describe('resolveFollowPath — symlinks', () => {
  it('rejects a symlink pointing into a denied directory', () => {
    const home = fakeHome();
    const secret = file(join(home, '.ssh', 'id_rsa'));
    mkdirSync(join(home, 'proj'), { recursive: true });
    const link = join(home, 'proj', 'innocent.log');
    symlinkSync(secret, link);
    expect(resolveFollowPath(link, { home })).toEqual({ ok: false, reason: 'denied_directory' });
  });

  it('rejects a symlink escaping the roots entirely', () => {
    const home = fakeHome();
    const outside = fakeHome();
    const target = file(join(outside, 'secret.log'));
    mkdirSync(join(home, 'proj'), { recursive: true });
    const link = join(home, 'proj', 'innocent.log');
    symlinkSync(target, link);
    expect(resolveFollowPath(link, { home })).toEqual({ ok: false, reason: 'outside_roots' });
  });

  it('rejects a file reached through a symlinked directory', () => {
    const home = fakeHome();
    const secretDir = join(home, '.ssh');
    mkdirSync(secretDir, { recursive: true });
    file(join(secretDir, 'id_rsa'));
    const linkDir = join(home, 'logs');
    symlinkSync(secretDir, linkDir);
    expect(resolveFollowPath(join(linkDir, 'id_rsa'), { home })).toEqual({
      ok: false,
      reason: 'denied_directory'
    });
  });

  it('returns the resolved path, not the symlink', () => {
    const home = fakeHome();
    const real = file(join(home, 'proj', 'real.log'));
    const link = join(home, 'proj', 'link.log');
    symlinkSync(real, link);
    expect(resolveFollowPath(link, { home })).toEqual({ ok: true, path: real });
  });

  it('rejects a traversal that climbs out of home', () => {
    const home = fakeHome();
    mkdirSync(join(home, 'proj'), { recursive: true });
    expect(resolveFollowPath(join(home, 'proj', '..', '..', 'etc', 'passwd'), { home }).ok).toBe(
      false
    );
  });

  it('accepts a traversal that stays inside home', () => {
    const home = fakeHome();
    const log = file(join(home, 'proj', 'out', 't.log'));
    expect(resolveFollowPath(join(home, 'proj', 'src', '..', 'out', 't.log'), { home })).toEqual({
      ok: true,
      path: log
    });
  });
});
