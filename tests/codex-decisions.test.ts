import { afterEach, describe, expect, it, vi } from 'vitest';
import { awaitCodexDecision, resolveCodexDecision } from '../src/main/cerberus/codex-decisions.js';

afterEach(() => vi.useRealTimers());

describe('codex-decisions', () => {
  it('resolves with the decision a matching tap sends', async () => {
    const wait = awaitCodexDecision('s1');
    expect(resolveCodexDecision('s1', 'allow')).toBe(true);
    expect(await wait).toBe('allow');
  });

  it('resolves "timeout" once the window passes, with nothing to answer it', async () => {
    vi.useFakeTimers();
    const wait = awaitCodexDecision('s2', 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await wait).toBe('timeout');
  });

  it('a tap for an unknown or already-settled session reports failure, not a decision', () => {
    expect(resolveCodexDecision('never-registered', 'allow')).toBe(false);
  });

  it('a second tap after the first resolved finds no waiter', async () => {
    const wait = awaitCodexDecision('s3');
    expect(resolveCodexDecision('s3', 'deny')).toBe(true);
    await wait;
    expect(resolveCodexDecision('s3', 'allow')).toBe(false);
  });

  it('a tap past the timeout finds no waiter either', async () => {
    vi.useFakeTimers();
    const wait = awaitCodexDecision('s4', 1000);
    await vi.advanceTimersByTimeAsync(1000);
    await wait;
    expect(resolveCodexDecision('s4', 'allow')).toBe(false);
  });

  it('keeps two sessions independent', async () => {
    const waitA = awaitCodexDecision('a');
    const waitB = awaitCodexDecision('b');
    resolveCodexDecision('b', 'deny');
    resolveCodexDecision('a', 'allow');
    expect(await waitA).toBe('allow');
    expect(await waitB).toBe('deny');
  });
});
