import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeContext, lastCodexText, lastCopilotText } from '../src/core/transcript.js';

const lastAssistantText = async (p: string | undefined): Promise<string> => (await claudeContext(p)).text;
const sessionTitle = async (p: string | undefined): Promise<string> => (await claudeContext(p)).title;

// Wrapped so a test can count how many times a transcript is actually opened.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Write a JSONL fixture; raw strings are emitted verbatim so a truncated last
// line can be reproduced.
function jsonl(lines: Array<unknown | string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'cerberus-transcript-'));
  dirs.push(dir);
  const path = join(dir, 'transcript.jsonl');
  writeFileSync(path, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n'));
  return path;
}

const user = (text: string): unknown => ({ type: 'user', message: { content: text } });
const assistant = (...blocks: unknown[]): unknown => ({
  type: 'assistant',
  message: { content: blocks }
});
const text = (t: string): unknown => ({ type: 'text', text: t });

describe('lastAssistantText', () => {
  it('returns the assistant text of the current turn', async () => {
    const p = jsonl([user('do it'), assistant(text('working on it'))]);
    expect(await lastAssistantText(p)).toBe('working on it');
  });

  it('picks the last non-empty text block of the entry', async () => {
    const p = jsonl([user('go'), assistant(text('first'), text('  '), text('second'))]);
    expect(await lastAssistantText(p)).toBe('second');
  });

  // The scoping rule: a tool call with no preamble must not resurface what
  // Claude said in an earlier turn.
  it('does not reach back past the last real user prompt', async () => {
    const p = jsonl([
      user('first ask'),
      assistant(text('old answer')),
      user('second ask'),
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } }
    ]);
    expect(await lastAssistantText(p)).toBe('');
  });

  it('ignores a tool_result echo stored as a user entry', async () => {
    const p = jsonl([
      user('do it'),
      assistant(text('here goes')),
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }
    ]);
    expect(await lastAssistantText(p)).toBe('here goes');
  });

  it('treats an array-content user prompt as a real prompt', async () => {
    const p = jsonl([
      assistant(text('old')),
      { type: 'user', message: { content: [text('new ask')] } }
    ]);
    expect(await lastAssistantText(p)).toBe('');
  });

  it('skips a malformed trailing line instead of failing', async () => {
    const p = jsonl([user('go'), assistant(text('answer')), '{"type":"assist']);
    expect(await lastAssistantText(p)).toBe('answer');
  });

  it('returns "" for a missing path or a missing file', async () => {
    expect(await lastAssistantText(undefined)).toBe('');
    expect(await lastAssistantText('/no/such/transcript.jsonl')).toBe('');
  });
});

describe('lastCopilotText', () => {
  it('returns the most recent assistant.message content', async () => {
    const p = jsonl([
      { type: 'assistant.message', data: { content: 'first' } },
      { type: 'tool.call', data: {} },
      { type: 'assistant.message', data: { content: 'latest' } }
    ]);
    expect(await lastCopilotText(p)).toBe('latest');
  });

  it('skips rows with blank or non-string content', async () => {
    const p = jsonl([
      { type: 'assistant.message', data: { content: 'real' } },
      { type: 'assistant.message', data: { content: '   ' } },
      { type: 'assistant.message', data: { content: 42 } }
    ]);
    expect(await lastCopilotText(p)).toBe('real');
  });

  it('returns "" when there is no assistant.message row', async () => {
    expect(await lastCopilotText(jsonl([{ type: 'tool.call', data: {} }]))).toBe('');
  });

  it('returns "" for a missing path or a missing file', async () => {
    expect(await lastCopilotText(undefined)).toBe('');
    expect(await lastCopilotText('/no/such/events.jsonl')).toBe('');
  });
});

// Codex's rollout: a flat event_msg stream sharing the file with token-usage
// records and other bookkeeping. The turn boundary is a UserMessage item; the
// text is the last AgentMessage after it.
const codexUser = (t: string): unknown => ({
  type: 'event_msg',
  payload: { item: { type: 'UserMessage', content: [{ type: 'text', text: t }] } }
});
const codexAgent = (t: string): unknown => ({
  type: 'event_msg',
  payload: { item: { type: 'AgentMessage', content: [{ type: 'Text', text: t }] } }
});

describe('lastCodexText', () => {
  it('returns the agent text of the current turn', async () => {
    const p = jsonl([codexUser('do it'), codexAgent('working on it')]);
    expect(await lastCodexText(p)).toBe('working on it');
  });

  it('does not reach back past the last real user message', async () => {
    const p = jsonl([
      codexUser('first ask'),
      codexAgent('old answer'),
      codexUser('second ask'),
      { type: 'event_msg', payload: { type: 'task_started' } }
    ]);
    expect(await lastCodexText(p)).toBe('');
  });

  it('ignores unrelated event_msg rows (token usage, world_state, ...)', async () => {
    const p = jsonl([
      codexUser('go'),
      { type: 'token_usage_record', payload: {} },
      codexAgent('answer'),
      { type: 'world_state', payload: {} }
    ]);
    expect(await lastCodexText(p)).toBe('answer');
  });

  it('skips a malformed trailing line instead of failing', async () => {
    const p = jsonl([codexUser('go'), codexAgent('answer'), '{"type":"event_m']);
    expect(await lastCodexText(p)).toBe('answer');
  });

  it('returns "" for a missing path or a missing file', async () => {
    expect(await lastCodexText(undefined)).toBe('');
    expect(await lastCodexText('/no/such/rollout.jsonl')).toBe('');
  });
});

describe('sessionTitle', () => {
  const rename = (t: string): unknown => ({ type: 'custom-title', customTitle: t, sessionId: 's' });

  it('returns the latest /rename', () => {
    const p = jsonl([rename('first'), user('hi'), rename('orchestrator'), assistant(text('ok'))]);
    return expect(sessionTitle(p)).resolves.toBe('orchestrator');
  });

  it('ignores the auto-generated ai-title', async () => {
    const p = jsonl([{ type: 'ai-title', aiTitle: 'Fix login bug' }, user('hi')]);
    expect(await sessionTitle(p)).toBe('');
  });

  it('is empty without a transcript', async () => {
    expect(await sessionTitle(undefined)).toBe('');
    expect(await sessionTitle('/no/such/transcript.jsonl')).toBe('');
  });
});

// Bounded reads: a notification only ever reads the end of the transcript, and
// when that window can't settle the answer the answer is "", never a guess.
describe('transcript budgets', () => {
  const toolResult = (size: number): unknown => ({
    type: 'user',
    message: { content: [{ type: 'tool_result', content: 'x'.repeat(size) }] }
  });
  const filler = (bytes: number): unknown[] => Array.from({ length: Math.ceil(bytes / 1000) }, () => toolResult(950));
  const rename = (t: string): unknown => ({ type: 'custom-title', customTitle: t, sessionId: 's' });
  const small = { tailBytes: 64 * 1024, titleScanBytes: 64 * 1024 * 1024 };

  it('finds the current turn at the end of a transcript far larger than the budget', async () => {
    const p = jsonl([user('go'), ...filler(512 * 1024), assistant(text('latest'))]);
    expect((await claudeContext(p, small)).text).toBe('latest');
  });

  it('returns no context when the turn boundary is outside the window', async () => {
    const p = jsonl([
      user('first ask'),
      assistant(text('old answer')),
      user('second ask'),
      ...filler(256 * 1024),
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } }
    ]);
    expect((await claudeContext(p, small)).text).toBe('');
    // With the whole file in budget the same transcript is still answered right.
    expect((await claudeContext(p)).text).toBe('');
  });

  it('does not resurface an earlier turn with the default budget either', async () => {
    const p = jsonl([user('old'), assistant(text('old answer')), user('new'), ...filler(9 * 1024 * 1024)]);
    expect((await claudeContext(p)).text).toBe('');
  });

  it('gives up on a row longer than the budget instead of skipping past it', async () => {
    const p = jsonl([assistant(text('old answer')), user('x'.repeat(128 * 1024))]);
    expect((await claudeContext(p, small)).text).toBe('');
  });

  it('decodes multi-byte UTF-8 split across read chunks', async () => {
    const long = 'àè€😀'.repeat(40_000); // ~400 KB, crosses many 64 KiB reads
    const p = jsonl([user('go'), assistant(text(long))]);
    expect((await claudeContext(p)).text).toBe(long);
  });

  it('applies the budget to Codex and Copilot transcripts too', async () => {
    const codex = jsonl([codexUser('a'), codexAgent('old'), codexUser('b'), ...filler(256 * 1024)]);
    expect(await lastCodexText(codex, small)).toBe('');
    const copilot = jsonl([{ type: 'assistant.message', data: { content: 'old' } }, ...filler(256 * 1024)]);
    expect(await lastCopilotText(copilot, small)).toBe('');
    expect(await lastCopilotText(copilot)).toBe('old');
  });

  it('finds a /rename far behind the tail window', async () => {
    const p = jsonl([rename('far back'), user('go'), ...filler(256 * 1024), assistant(text('ok'))]);
    expect(await claudeContext(p, small)).toEqual({ text: 'ok', title: 'far back' });
  });

  it('picks up a /rename appended after the previous notification', async () => {
    const p = jsonl([rename('first'), user('go'), assistant(text('ok'))]);
    expect((await claudeContext(p)).title).toBe('first');
    appendFileSync(p, '\n' + JSON.stringify(rename('second')) + '\n');
    expect((await claudeContext(p)).title).toBe('second');
    appendFileSync(p, JSON.stringify(rename('')) + '\n');
    expect((await claudeContext(p)).title).toBe('');
  });

  it('counts a complete /rename that has no trailing newline yet', async () => {
    const p = jsonl([user('go'), rename('fresh')]);
    expect((await claudeContext(p)).title).toBe('fresh');
  });

  it('starts over when the transcript is truncated or replaced', async () => {
    const p = jsonl([rename('before'), user('go'), ...filler(8 * 1024), assistant(text('ok'))]);
    expect((await claudeContext(p)).title).toBe('before');
    writeFileSync(p, [user('go'), assistant(text('ok'))].map((l) => JSON.stringify(l)).join('\n'));
    expect((await claudeContext(p)).title).toBe('');

    expect((await claudeContext(p)).text).toBe('ok');
    renameSync(p, p + '.old');
    writeFileSync(p, [rename('rotated'), user('go'), assistant(text('new'))].map((l) => JSON.stringify(l)).join('\n'));
    expect(await claudeContext(p)).toEqual({ text: 'new', title: 'rotated' });
  });

  it('works off a title backlog larger than one scan over several calls', async () => {
    const limits = { tailBytes: 64 * 1024, titleScanBytes: 64 * 1024 };
    const p = jsonl([rename('named'), user('go'), ...filler(200 * 1024), assistant(text('ok'))]);
    const titles: string[] = [];
    for (let i = 0; i < 5; i++) titles.push((await claudeContext(p, limits)).title);
    // Unknown until the scan has caught up, then the real title.
    expect(titles.slice(0, 3)).toEqual(['', '', '']);
    expect(titles.at(-1)).toBe('named');
  });

  it('skips an over-long row in the title scan without buffering it', async () => {
    const p = jsonl([rename('a'), user('y'.repeat(200 * 1024)), rename('b'), assistant(text('ok'))]);
    expect((await claudeContext(p)).title).toBe('b');
  });

  it('serves concurrent lookups of one file from at most two reads', async () => {
    const p = jsonl([user('go'), ...filler(64 * 1024), assistant(text('ok'))]);
    const opened = vi.mocked(open);
    opened.mockClear();
    const results = await Promise.all(Array.from({ length: 8 }, () => claudeContext(p)));
    expect(results.every((r) => r.text === 'ok')).toBe(true);
    expect(opened.mock.calls.filter(([f]) => f === p).length).toBeLessThanOrEqual(2);
  });

  it('never answers a caller with a read that started before it arrived', async () => {
    const p = jsonl([user('go'), assistant(text('first'))]);
    const early = claudeContext(p);
    appendFileSync(p, '\n' + JSON.stringify(user('next')) + '\n' + JSON.stringify(assistant(text('second'))) + '\n');
    const late = claudeContext(p);
    expect((await early).text).toMatch(/^(first|second)$/);
    expect((await late).text).toBe('second');
  });
});
