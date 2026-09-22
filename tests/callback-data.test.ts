import { describe, expect, it, vi } from 'vitest';
import {
  CALLBACK_DATA_MAX,
  DECISION_ID_CHARS,
  callbackData
} from '../src/core/callback-data.js';

// Real shapes: both Codex and Claude session ids are UUIDs, and the request id
// is DECISION_ID_CHARS of hex.
const SESSION = '01a0c385-3247-7253-af23-dedd9f76fabe';
const DECISION = 'a1b2c3d4';
const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');

describe('callbackData', () => {
  it('addresses a session, and a specific request when there is one', () => {
    expect(callbackData('approve', SESSION)).toBe(`approve:${SESSION}`);
    expect(callbackData('approve', SESSION, DECISION)).toBe(`approve:${SESSION}:${DECISION}`);
  });

  // The regression this file exists for: a full UUID as the request id made
  // `approve:<uuid>:<uuid>` 81 bytes, and Telegram answered 400
  // BUTTON_DATA_INVALID — which drops the whole notification, text included,
  // not just the button. Every action we send has to fit with room to spare.
  it.each(['approve', 'always', 'deny', 'esc', 'noop'])(
    'keeps %s inside the 64-byte limit with a real session and request id',
    (action) => {
      expect(bytes(callbackData(action, SESSION, DECISION))).toBeLessThanOrEqual(
        CALLBACK_DATA_MAX
      );
    }
  );

  it('leaves the budget room for the id length the daemon actually mints', () => {
    const longest = callbackData('approve', SESSION, 'f'.repeat(DECISION_ID_CHARS));
    expect(bytes(longest)).toBeLessThanOrEqual(CALLBACK_DATA_MAX);
  });

  it('complains loudly rather than letting Telegram reject the message silently', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    callbackData('approve', SESSION, 'x'.repeat(64));
    expect(err).toHaveBeenCalledOnce();
    err.mockRestore();
  });

  it('says nothing when the data fits', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    callbackData('approve', SESSION, DECISION);
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
