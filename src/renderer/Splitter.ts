import type { Dir } from './pane-tree.js';

const THICKNESS = 6; // px
const MIN_PANE = 60; // px — min size per side

// A draggable bar placed between a split's two children. Self-contained: it
// reads its parent (the split div) rect on drag and derives the new ratio.
// onResize fires live (update child flex-grow); onCommit fires on pointerup
// (persist into the model).
export function makeSplitter(
  dir: Dir,
  onResize: (ratio: number) => void,
  onCommit: (ratio: number) => void
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'splitter';
  const horizontal = dir === 'row'; // children side by side -> vertical bar
  el.style.cssText = [
    'flex:0 0 ' + THICKNESS + 'px',
    'background:#2a2a2a',
    'z-index:2',
    horizontal ? 'cursor:col-resize' : 'cursor:row-resize',
    horizontal ? 'height:100%' : 'width:100%'
  ].join(';');

  let dragging = false;

  const ratioFromEvent = (e: PointerEvent): number => {
    const parent = el.parentElement;
    if (!parent) return 0.5;
    const rect = parent.getBoundingClientRect();
    const size = horizontal ? rect.width : rect.height;
    if (size <= 0) return 0.5;
    const pos = horizontal ? e.clientX - rect.left : e.clientY - rect.top;
    const min = MIN_PANE / size;
    return Math.min(1 - min, Math.max(min, pos / size));
  };

  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    el.setPointerCapture(e.pointerId);
    document.body.style.userSelect = 'none';
  });

  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    e.stopPropagation();
    onResize(ratioFromEvent(e));
  });

  const end = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    el.releasePointerCapture(e.pointerId);
    document.body.style.userSelect = '';
    onCommit(ratioFromEvent(e));
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  return el;
}
