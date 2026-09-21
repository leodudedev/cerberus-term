import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  awaitCodexDecision,
  cancelCodexDecision,
  resolveCodexDecision
} from '../src/main/cerberus/codex-decisions.js';

afterEach(() => vi.useRealTimers());

describe('codex-decisions', () => {
  it('resolves with the decision a matching tap sends', async () => {
    const wait = awaitCodexDecision('s1', 'r1');
    expect(resolveCodexDecision('s1', 'r1', 'allow')).toBe(true);
    expect(await wait).toBe('allow');
  });

  it('resolves "timeout" once the window passes, with nothing to answer it', async () => {
    vi.useFakeTimers();
    const wait = awaitCodexDecision('s2', 'r1', 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await wait).toBe('timeout');
  });

  it('a tap for an unknown session reports failure, not a decision', () => {
    expect(resolveCodexDecision('never-registered', 'r1', 'allow')).toBe(false);
  });

  it('a second tap after the first resolved finds no waiter', async () => {
    const wait = awaitCodexDecision('s3', 'r1');
    expect(resolveCodexDecision('s3', 'r1', 'deny')).toBe(true);
    await wait;
    expect(resolveCodexDecision('s3', 'r1', 'allow')).toBe(false);
  });

  it('a tap past the timeout finds no waiter either', async () => {
    vi.useFakeTimers();
    const wait = awaitCodexDecision('s4', 'r1', 1000);
    await vi.advanceTimersByTimeAsync(1000);
    await wait;
    expect(resolveCodexDecision('s4', 'r1', 'allow')).toBe(false);
  });

  it('keeps two sessions independent', async () => {
    const waitA = awaitCodexDecision('a', 'r1');
    const waitB = awaitCodexDecision('b', 'r1');
    resolveCodexDecision('b', 'r1', 'deny');
    resolveCodexDecision('a', 'r1', 'allow');
    expect(await waitA).toBe('allow');
    expect(await waitB).toBe('deny');
  });

  // The leftover-message case: a permission answered at the keyboard leaves its
  // Telegram message with live buttons, and tapping it later must not settle
  // whatever request the session is on now.
  it('refuses a tap carrying another request id', async () => {
    const wait = awaitCodexDecision('s5', 'current');
    expect(resolveCodexDecision('s5', 'stale', 'allow')).toBe(false);
    expect(resolveCodexDecision('s5', undefined, 'allow')).toBe(false);
    expect(resolveCodexDecision('s5', 'current', 'allow')).toBe(true);
    expect(await wait).toBe('allow');
  });

  it('cancels only its own request, and abstains when it does', async () => {
    const wait = awaitCodexDecision('s6', 'mine');
    cancelCodexDecision('s6', 'someone-else'); // no-op
    expect(resolveCodexDecision('s6', 'mine', 'allow')).toBe(true);
    expect(await wait).toBe('allow');

    const wait2 = awaitCodexDecision('s7', 'mine');
    cancelCodexDecision('s7', 'mine');
    expect(await wait2).toBe('timeout');
    expect(resolveCodexDecision('s7', 'mine', 'allow')).toBe(false);
  });

  // A hook Codex abandoned leaves its waiter behind. The replacement must take
  // the slot, and the old one must settle rather than hang on its own timer.
  it('settles a superseded waiter instead of orphaning it', async () => {
    vi.useFakeTimers();
    const first = awaitCodexDecision('s8', 'old', 10_000);
    const second = awaitCodexDecision('s8', 'new', 10_000);
    expect(await first).toBe('timeout');

    expect(resolveCodexDecision('s8', 'old', 'allow')).toBe(false);
    expect(resolveCodexDecision('s8', 'new', 'allow')).toBe(true);
    expect(await second).toBe('allow');
  });

  // The bug this pairs with: the superseded waiter's timer used to delete the
  // map entry unconditionally, evicting the live request that had replaced it.
  it("an old waiter's timer does not evict the request that replaced it", async () => {
    vi.useFakeTimers();
    const first = awaitCodexDecision('s9', 'old', 1000);
    await vi.advanceTimersByTimeAsync(500);
    const second = awaitCodexDecision('s9', 'new', 10_000);
    await first;

    // Past the first waiter's original deadline: its timer must not have
    // touched the slot the second one now owns.
    await vi.advanceTimersByTimeAsync(1000);
    expect(resolveCodexDecision('s9', 'new', 'deny')).toBe(true);
    expect(await second).toBe('deny');
  });
});
