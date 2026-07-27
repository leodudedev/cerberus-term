import { describe, expect, it } from 'vitest';
import {
  ALWAYS_OPTION_RE,
  dialogOptionsBlock,
  extractQuestionOptions
} from '../src/core/dialog.js';

const hasAlways = (buf: string): boolean => ALWAYS_OPTION_RE.test(dialogOptionsBlock(buf));

describe('dialogOptionsBlock', () => {
  it('narrows to the last numbered-options block', () => {
    const buf = ['1. old option', 'chatter', '❯ 1. Yes', '  2. No'].join('\n');
    expect(dialogOptionsBlock(buf)).toBe('❯ 1. Yes\n  2. No');
  });

  it('accepts the ")" form and the various selection markers', () => {
    expect(dialogOptionsBlock('noise\n> 1) Yes\n  2) No')).toBe('> 1) Yes\n  2) No');
    expect(dialogOptionsBlock('noise\n» 1. Yes\n  2. No')).toBe('» 1. Yes\n  2. No');
  });

  it('falls back to the whole buffer when there is no numbered option', () => {
    expect(dialogOptionsBlock('just text')).toBe('just text');
  });
});

describe('ALWAYS_OPTION_RE over the narrowed block', () => {
  it.each([
    "1. Yes\n2. Yes, and don't ask again\n3. No",
    '1. Yes\n2. Yes, and don’t ask again\n3. No', // typographic apostrophe
    '1. Yes\n2. Allow all\n3. No',
    '1. Yes\n2. Always allow\n3. No',
    '1. Sì\n2. Sì, e non chiedere più\n3. No',
    '1. Sì\n2. Consenti sempre\n3. No'
  ])('detects the always option in %j', (buf) => expect(hasAlways(buf)).toBe(true));

  it('does not fire on a plain two-option dialog', () => {
    expect(hasAlways('1. Yes\n2. No')).toBe(false);
  });

  // The reason the block is narrowed at all: tapping a phantom "always" button
  // sends "2⏎", which on a 2-option dialog means No.
  it('ignores an "always"-looking phrase above the options block', () => {
    const buf = ['Yes, and I will also refactor the tests.', '', '❯ 1. Yes', '  2. No'].join('\n');
    expect(ALWAYS_OPTION_RE.test(buf)).toBe(true); // whole buffer would misfire
    expect(hasAlways(buf)).toBe(false); // narrowed block does not
  });
});

describe('extractQuestionOptions', () => {
  const q = (o: unknown): unknown => ({ questions: [o] });

  it('returns the labels of a single-question single-select dialog', () => {
    const got = extractQuestionOptions(
      'AskUserQuestion',
      q({ options: [{ label: 'Postgres' }, { label: 'SQLite' }] })
    );
    expect(got).toEqual(['Postgres', 'SQLite']);
  });

  it('trims labels and drops empty ones', () => {
    expect(
      extractQuestionOptions('AskUserQuestion', q({ options: [{ label: '  a  ' }, { label: '' }] }))
    ).toEqual(['a']);
  });

  it('caps at 8 labels', () => {
    const options = Array.from({ length: 12 }, (_, i) => ({ label: `o${i}` }));
    expect(extractQuestionOptions('AskUserQuestion', q({ options }))).toHaveLength(8);
  });

  it.each([
    ['another tool', 'Bash', q({ options: [{ label: 'a' }] })],
    ['multi-select', 'AskUserQuestion', q({ multiSelect: true, options: [{ label: 'a' }] })],
    ['multi-question', 'AskUserQuestion', { questions: [{ options: [] }, { options: [] }] }],
    ['no options array', 'AskUserQuestion', q({})],
    ['only empty labels', 'AskUserQuestion', q({ options: [{ label: '  ' }] })],
    ['null input', 'AskUserQuestion', null],
    ['no questions key', 'AskUserQuestion', {}]
  ])('returns undefined for %s', (_name, tool, input) => {
    expect(extractQuestionOptions(tool as string, input)).toBeUndefined();
  });
});
