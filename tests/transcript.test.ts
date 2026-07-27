import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lastAssistantText, lastCopilotText } from '../src/core/transcript.js';

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
