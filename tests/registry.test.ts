import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setStatePath } from '../src/core/persist.js';

// registry.ts seeds its maps at import time: redirect the state file first.
let reg: typeof import('../src/core/registry.js');
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cerberus-registry-'));
  setStatePath(join(dir, 'state.json'));
  reg = await import('../src/core/registry.js');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.useRealTimers());

const prompt = { message: 'Claude needs your permission to use Bash', toolName: 'Bash', command: 'ls', options: [], isPermission: true };

function session(id: string, extra: Partial<import('../src/core/registry.js').SessionInfo> = {}) {
  return reg.upsertSession({
    sessionId: id,
    agent: 'claude',
    pane: `pane-${id}`,
    profile: 'claude',
    cwd: '/proj',
    lastMessage: prompt.message,
    detail: '',
    toolName: prompt.toolName,
    command: prompt.command,
    options: [],
    hasAlways: false,
    isPermission: true,
    ...extra
  });
}

describe('request ids', () => {
  it('mints one per buttoned prompt and none without buttons', () => {
    expect(reg.requestIdFor('fresh', prompt)).toMatch(/^[0-9a-f]{8}$/);
    expect(reg.requestIdFor('fresh', { ...prompt, isPermission: false })).toBeUndefined();
    expect(reg.requestIdFor('fresh', { ...prompt, isPermission: false, options: ['a', 'b'] })).toMatch(/^[0-9a-f]{8}$/);
  });

  it('keeps the id when the same pending prompt is notified again, and changes it otherwise', () => {
    session('r1', { decisionId: 'aaaa1111' });
    expect(reg.requestIdFor('r1', prompt)).toBe('aaaa1111');
    expect(reg.requestIdFor('r1', { ...prompt, command: 'rm -rf build' })).not.toBe('aaaa1111');
    expect(reg.requestIdFor('r1', { ...prompt, options: ['x'] })).not.toBe('aaaa1111');
  });

  it('is spent by exactly one tap', () => {
    session('r2', { decisionId: 'bbbb2222' });
    expect(reg.consumeRequest('r2', 'bbbb2222')).toBe(true);
    expect(reg.consumeRequest('r2', 'bbbb2222')).toBe(false);
    // An answered prompt asked again word for word gets a fresh id.
    expect(reg.requestIdFor('r2', prompt)).not.toBe('bbbb2222');
  });

  it('refuses an id from an earlier prompt, a missing id, and an answered prompt', () => {
    session('r3', { decisionId: 'new00000' });
    expect(reg.consumeRequest('r3', 'old00000')).toBe(false);
    expect(reg.consumeRequest('r3', undefined)).toBe(false);
    reg.clearRequest('r3');
    expect(reg.consumeRequest('r3', 'new00000')).toBe(false);
  });
});

describe('message routing', () => {
  it('keys links by chat, so equal message ids in two chats never collide', () => {
    session('a');
    session('b');
    reg.linkMessage('111', 7, 'a');
    reg.linkMessage('222', 7, 'b');
    expect(reg.sessionForMessage('111', 7)?.sessionId).toBe('a');
    expect(reg.sessionForMessage('222', 7)?.sessionId).toBe('b');
    expect(reg.hasMessageLink('333', 7)).toBe(false);
  });

  it('sends a bare message to the session last notified in that chat only', () => {
    session('c');
    session('d');
    reg.linkMessage('111', 8, 'c');
    reg.linkMessage('222', 9, 'd');
    expect(reg.sessionForChat('111')?.sessionId).toBe('c');
    expect(reg.sessionForChat('222')?.sessionId).toBe('d');
    expect(reg.sessionForChat('999')).toBeUndefined();
  });

  it('forgets every link when the bot changes', () => {
    session('e');
    reg.linkMessage('111', 10, 'e');
    reg.forgetMessageLinks();
    expect(reg.hasMessageLink('111', 10)).toBe(false);
    expect(reg.sessionForChat('111')).toBeUndefined();
  });
});

describe('session expiry', () => {
  it('stops resolving a session past its TTL, before any write sweeps it', () => {
    vi.useFakeTimers({ now: new Date('2026-10-24T08:00:00Z') });
    session('old', { decisionId: 'cccc3333' });
    reg.linkMessage('111', 11, 'old');
    vi.setSystemTime(new Date('2026-10-25T08:00:01Z'));
    expect(reg.getSession('old')).toBeUndefined();
    expect(reg.sessionForMessage('111', 11)).toBeUndefined();
    expect(reg.sessionForChat('111')).toBeUndefined();
    expect(reg.consumeRequest('old', 'cccc3333')).toBe(false);
  });
});
