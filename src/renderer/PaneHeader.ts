// Thin per-pane header: title left, operation buttons right. Buttons dispatch
// the same 'pane-cmd' window event as the temp keymap, tagged with this pane's
// leafId so they act on their own pane regardless of focus.

type PaneCmd =
  | 'split-right'
  | 'split-down'
  | 'kill'
  | 'config'
  | 'toggle-favorite'
  | 'open-favorites';

function emit(cmd: PaneCmd, leafId: string): void {
  window.dispatchEvent(new CustomEvent('pane-cmd', { detail: { cmd, leafId } }));
}

// These glyphs come from different Unicode blocks (symbols, geometric shapes,
// dingbats) and render at different intrinsic sizes at the same font-size in
// the system font — scale each toward a common visual size.
const GLYPH_SCALE: Record<string, {size: number, top: number}> = {
  '☆': {size: 0.8, top: 2}, // star outline — renders oversized in the system font
  '★': {size: 0.8, top: 2},
  '♡': {size: 0.8, top: 2}, // heart suit — same, oversized
  '◧': {size: 1, top: 0}, // split-right — baseline
  '⬓': {size: 1, top: 0}, // split-down — baseline
  '✕': {size: 0.85, top: 2}, // kill — renders slightly bold/large
  '⚙': {size: 1.2, top: 1} // gear — renders as a near-invisible dot
};

function button(glyph: string, title: string, cmd: PaneCmd, leafId: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'pane-btn';
  b.type = 'button';
  b.textContent = glyph;
  b.title = title;
  b.style.fontSize = `${12 * (GLYPH_SCALE[glyph]?.size ?? 1)}px`;
  b.style.marginTop = `${(GLYPH_SCALE[glyph]?.top ?? 1)}px`;
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    emit(cmd, leafId);
  });
  return b;
}

export interface PaneHeader {
  el: HTMLElement;
  setFavoriteActive: (active: boolean) => void;
}

export function makePaneHeader(leafId: string, focus: () => void): PaneHeader {
  const header = document.createElement('div');
  header.className = 'pane-header';

  const title = document.createElement('span');
  title.className = 'pane-title';
  title.textContent = 'terminal';

  const buttons = document.createElement('div');
  buttons.className = 'pane-buttons';

  const star = button('☆', 'Add to favorites', 'toggle-favorite', leafId);
  star.classList.add('pane-btn-star');
  const heart = button('♡', 'Open favorites', 'open-favorites', leafId);

  buttons.append(
    star,
    heart,
    button('◧', 'Split right', 'split-right', leafId),
    button('⬓', 'Split down', 'split-down', leafId),
    button('✕', 'Close pane', 'kill', leafId)
  );

  const gear = button('⚙', 'Edit .cerberus.json', 'config', leafId);
  buttons.append(gear);

  header.append(title, buttons);

  // Clicking header background (not a button) focuses the pane.
  header.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    focus();
  });

  const setFavoriteActive = (active: boolean): void => {
    star.textContent = active ? '★' : '☆';
    star.title = active ? 'Remove from favorites' : 'Add to favorites';
    star.classList.toggle('pane-btn-star-active', active);
  };

  return { el: header, setFavoriteActive };
}
