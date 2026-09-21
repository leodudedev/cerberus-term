import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import {
  awaitCodexDecision,
  cancelCodexDecision,
  resolveCodexDecision,
  type Outcome
} from '../src/main/cerberus/codex-decisions.js';

// The daemon holds a Codex PermissionRequest open while Telegram is asked, so
// it needs to notice the hook dying under it — Codex timing it out, Escape at
// the keyboard, the pane going away. Otherwise the waiter outlives the hook
// and a later tap is reported to the phone as an approval Codex never got.
//
// Which stream carries that signal is not obvious and was measured, not
// reasoned about: on an aborted request whose body had already been consumed
// — always the case in the daemon, readJson() runs first — `res` emits
// 'close' at the abort and `req` never emits it at all. This reproduces the
// daemon's shape around the real waiter so that stays true.

let server: Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

interface Run {
  outcome: Promise<Outcome>;
  reqClosed: () => boolean;
  resClosed: () => boolean;
}

// Mirrors the daemon: consume the body, register the waiter, then wait.
// Resolves the port once listening; `run` resolves when a request is in flight.
async function serve(
  sessionId: string,
  decisionId: string
): Promise<{ port: number; run: Promise<Run> }> {
  let ready: (r: Run) => void;
  const run = new Promise<Run>((r) => (ready = r));

  const srv = createServer(async (req, res) => {
    for await (const _ of req) void _; // body first, as readJson() does
    const seen = { req: false, res: false };
    req.on('close', () => (seen.req = true));

    const outcome = awaitCodexDecision(sessionId, decisionId, 5_000);
    res.on('close', () => {
      seen.res = true;
      cancelCodexDecision(sessionId, decisionId);
    });

    ready({ outcome, reqClosed: () => seen.req, resClosed: () => seen.res });

    const decision = await outcome;
    if (!res.destroyed && !res.writableEnded) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(decision === 'timeout' ? '{}' : JSON.stringify({ decision }));
    }
  });
  server = srv;

  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return { port: (srv.address() as { port: number }).port, run };
}

describe('codex permission request, client abort', () => {
  it('abstains when the hook dies mid-wait, and refuses a tap afterwards', async () => {
    const { port, run: pending } = await serve('s-abort', 'r1');
    const ac = new AbortController();
    void fetch(`http://127.0.0.1:${port}/event`, {
      method: 'POST',
      body: '{"hook":{}}',
      signal: ac.signal
    }).catch(() => {});

    const run = await pending;
    ac.abort();

    expect(await run.outcome).toBe('timeout');
    // The measured asymmetry this guards: cancelling on `req` would never fire.
    expect(run.resClosed()).toBe(true);
    expect(run.reqClosed()).toBe(false);
    // A tap arriving now must not be reported as an approval.
    expect(resolveCodexDecision('s-abort', 'r1', 'allow')).toBe(false);
  });

  it('does not cancel a healthy request that is simply still waiting', async () => {
    const { port, run: pending } = await serve('s-live', 'r1');
    const res = fetch(`http://127.0.0.1:${port}/event`, { method: 'POST', body: '{"hook":{}}' });

    const run = await pending;
    await new Promise((r) => setTimeout(r, 150)); // long enough for a premature close
    expect(run.resClosed()).toBe(false);

    // Still answerable, and the answer reaches the client.
    expect(resolveCodexDecision('s-live', 'r1', 'allow')).toBe(true);
    expect(await run.outcome).toBe('allow');
    await expect((await res).json()).resolves.toEqual({ decision: 'allow' });
  });
});
