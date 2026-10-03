export interface ChipSpan {
  left: number;
  right: number;
}

// Insertion slot (0..n) for a pointer at x, given the chips' spans in a shared
// coordinate space. A slot is a gap between chips: the pointer crossing a
// chip's midpoint moves the slot past it. Includes the dragged chip itself, so
// slot === from and slot === from + 1 both mean "stay where you are".
export function dropSlot(x: number, spans: readonly ChipSpan[]): number {
  let slot = 0;
  for (const s of spans) {
    if (x > (s.left + s.right) / 2) slot++;
    else break;
  }
  return slot;
}

// Where the dragged tab lands in `order` once taken out of it. `snapshot` is
// the id order the slot was computed against; it can drift from `order` if a
// tab was opened or closed mid-drag, so the anchor is the first snapshot tab
// at or after the slot that still exists. No anchor left -> end of the strip.
export function insertIndex(
  order: readonly string[],
  dragged: string,
  snapshot: readonly string[],
  slot: number
): number {
  const rest = order.filter((id) => id !== dragged);
  for (let i = slot; i < snapshot.length; i++) {
    const at = rest.indexOf(snapshot[i]!);
    if (at !== -1) return at;
  }
  return rest.length;
}

// Auto-scroll velocity (px/frame) for a pointer at x over a strip spanning
// [left, right]: ramps from 0 at `edge` px inside the border up to `max` at
// (or past) the border. Negative scrolls left.
export function edgeScrollStep(
  x: number,
  left: number,
  right: number,
  edge: number,
  max: number
): number {
  if (x < left + edge) return -max * Math.min(1, (left + edge - x) / edge);
  if (x > right - edge) return max * Math.min(1, (x - (right - edge)) / edge);
  return 0;
}
