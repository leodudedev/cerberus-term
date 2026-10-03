import { describe, expect, it } from 'vitest';
import { dropSlot, edgeScrollStep, insertIndex } from '../src/renderer/tab-reorder.js';

// Three 100px chips, 2px apart: [0,100] [102,202] [204,304]
const spans = [
  { left: 0, right: 100 },
  { left: 102, right: 202 },
  { left: 204, right: 304 }
];

describe('dropSlot', () => {
  it('is 0 before the first midpoint and n past the last', () => {
    expect(dropSlot(-20, spans)).toBe(0);
    expect(dropSlot(49, spans)).toBe(0);
    expect(dropSlot(400, spans)).toBe(3);
  });

  it('advances one slot per midpoint crossed', () => {
    expect(dropSlot(51, spans)).toBe(1);
    expect(dropSlot(151, spans)).toBe(1);
    expect(dropSlot(153, spans)).toBe(2);
    expect(dropSlot(253, spans)).toBe(2);
    expect(dropSlot(255, spans)).toBe(3);
  });

  it('handles an empty strip', () => {
    expect(dropSlot(10, [])).toBe(0);
  });
});

describe('insertIndex', () => {
  const order = ['a', 'b', 'c', 'd'];

  it('keeps the position for slot === from and from + 1', () => {
    expect(insertIndex(order, 'b', order, 1)).toBe(1);
    expect(insertIndex(order, 'b', order, 2)).toBe(1);
  });

  it('moves forward and backward', () => {
    expect(insertIndex(order, 'a', order, 3)).toBe(2); // a lands before d
    expect(insertIndex(order, 'd', order, 0)).toBe(0);
    expect(insertIndex(order, 'a', order, 4)).toBe(3); // end of the strip
  });

  it('falls back to the next surviving tab when the anchor was closed', () => {
    // drop slot pointed before "c", which was closed mid-drag
    expect(insertIndex(['a', 'b', 'd'], 'a', order, 2)).toBe(1); // before d
  });

  it('appends when no anchor survives', () => {
    expect(insertIndex(['a', 'b'], 'a', order, 2)).toBe(1);
  });

  it('ignores tabs opened mid-drag (they are not in the snapshot)', () => {
    expect(insertIndex(['a', 'b', 'c', 'x'], 'a', ['a', 'b', 'c'], 2)).toBe(1);
  });
});

describe('edgeScrollStep', () => {
  it('is 0 away from the edges', () => {
    expect(edgeScrollStep(200, 0, 400, 40, 12)).toBe(0);
  });

  it('ramps toward the edge and caps at max', () => {
    expect(edgeScrollStep(20, 0, 400, 40, 12)).toBe(-6);
    expect(edgeScrollStep(0, 0, 400, 40, 12)).toBe(-12);
    expect(edgeScrollStep(-50, 0, 400, 40, 12)).toBe(-12);
    expect(edgeScrollStep(380, 0, 400, 40, 12)).toBe(6);
    expect(edgeScrollStep(500, 0, 400, 40, 12)).toBe(12);
  });
});
