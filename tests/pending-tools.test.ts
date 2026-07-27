import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  peekPendingTool,
  putPendingTool,
  summarizeToolArgs
} from '../src/core/pending-tools.js';

afterEach(() => vi.useRealTimers());

describe('putPendingTool / peekPendingTool', () => {
  it('round-trips a tool for its session', () => {
    putPendingTool('s1', 'Bash', 'ls -la');
    expect(peekPendingTool('s1')).toMatchObject({ name: 'Bash', command: 'ls -la' });
  });

  it('reading is non-destructive — a re-notification finds the same tool', () => {
    putPendingTool('s2', 'Bash', 'ls');
    expect(peekPendingTool('s2')).not.toBeNull();
    expect(peekPendingTool('s2')).not.toBeNull();
  });

  it('a newer tool call overwrites the entry', () => {
    putPendingTool('s3', 'Bash', 'first');
    putPendingTool('s3', 'Read', 'second');
    expect(peekPendingTool('s3')).toMatchObject({ name: 'Read', command: 'second' });
  });

  it('keeps the AskUserQuestion option labels', () => {
    putPendingTool('s4', 'AskUserQuestion', '', ['a', 'b']);
    expect(peekPendingTool('s4')?.options).toEqual(['a', 'b']);
  });

  it('ignores an empty session id', () => {
    putPendingTool('', 'Bash', 'ls');
    expect(peekPendingTool('')).toBeNull();
  });

  it('returns null for an unknown session', () => {
    expect(peekPendingTool('never-seen')).toBeNull();
  });

  it('expires after the 2-minute TTL', () => {
    vi.useFakeTimers();
    putPendingTool('ttl', 'Bash', 'ls');
    vi.advanceTimersByTime(2 * 60 * 1000 - 1);
    expect(peekPendingTool('ttl')).not.toBeNull();
    vi.advanceTimersByTime(2);
    expect(peekPendingTool('ttl')).toBeNull();
  });
});

describe('summarizeToolArgs', () => {
  it('prefers the command field of an object', () => {
    expect(summarizeToolArgs({ command: 'ls -la', cwd: '/tmp' })).toBe('ls -la');
  });

  it('parses a JSON string first', () => {
    expect(summarizeToolArgs('{"command":"git status"}')).toBe('git status');
  });

  it('returns a non-JSON string as-is', () => {
    expect(summarizeToolArgs('git status')).toBe('git status');
  });

  it('walks the key preference order, not the object order', () => {
    expect(summarizeToolArgs({ url: 'http://x', command: 'ls' })).toBe('ls');
    expect(summarizeToolArgs({ url: 'http://x', path: '/a' })).toBe('/a');
    expect(summarizeToolArgs({ query: 'q', url: 'http://x' })).toBe('http://x');
  });

  it('skips blank values', () => {
    expect(summarizeToolArgs({ command: '   ', file_path: '/a/b' })).toBe('/a/b');
  });

  it('falls back to the serialised object when no known key matches', () => {
    expect(summarizeToolArgs({ weird: 'x' })).toBe('{"weird":"x"}');
  });

  it('truncates a long plain string to 500 chars', () => {
    expect(summarizeToolArgs('x'.repeat(1000))).toHaveLength(500);
  });

  it('returns an empty string for non-objects', () => {
    expect(summarizeToolArgs(null)).toBe('');
    expect(summarizeToolArgs(42)).toBe('');
  });
});
