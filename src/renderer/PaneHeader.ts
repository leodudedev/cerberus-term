// Thin per-pane header: title left, operation buttons right. Buttons dispatch
// the same 'pane-cmd' window event as the temp keymap, tagged with this pane's
// leafId so they act on their own pane regardless of focus.

import { ICONS } from './icons.js';

type PaneCmd =
  | 'split-right'
  | 'split-down'
  | 'kill'
  | 'config'
  | 'toggle-favorite'
  | 'open-favorites'
  | 'open-docs'
  | 'zoom';

function emit(cmd: PaneCmd, leafId: string): void {
  window.dispatchEvent(new CustomEvent('pane-cmd', { detail: { cmd, leafId } }));
}

function button(icon: string, title: string, cmd: PaneCmd, leafId: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'pane-btn';
  b.type = 'button';
  b.innerHTML = icon;
  b.title = title;
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    emit(cmd, leafId);
  });
  return b;
}

// The buttons come in groups — read, favorites, split, window — and a hairline
// between them is what keeps eight same-weight icons from reading as one run.
function separator(): HTMLElement {
  const s = document.createElement('span');
  s.className = 'pane-sep';
  return s;
}

export interface PaneHeader {
  el: HTMLElement;
  /** Flip the zoom button between "zoom" and "restore". */
  setZoomActive: (active: boolean) => void;
  setFavoriteActive: (active: boolean) => void;
}

export function makePaneHeader(
  leafId: string,
  focus: () => void,
  opts: { favorites?: boolean } = {}
): PaneHeader {
  const header = document.createElement('div');
  header.className = 'pane-header';

  const title = document.createElement('span');
  title.className = 'pane-title';
  title.textContent = 'terminal';

  const buttons = document.createElement('div');
  buttons.className = 'pane-buttons';

  // Favorites act on a pane's live cwd; follower/read-only panes tail a log and
  // have no interactive shell to cd, so they don't get the star/heart buttons.
  // Same gate for the document list: a follower tails a log outside any project
  // of its own, so it would be listing someone else's markdown.
  const showFavorites = opts.favorites !== false;
  const star = button(ICONS.star, 'Add to favorites', 'toggle-favorite', leafId);
  star.classList.add('pane-btn-star');
  const heart = button(ICONS.heart, 'Open favorites', 'open-favorites', leafId);
  const docs = button(ICONS.doc, 'Project docs', 'open-docs', leafId);
  docs.classList.add('pane-btn-docs');

  const zoom = button(ICONS.expand, 'Zoom pane (Ctrl+B z)', 'zoom', leafId);

  if (showFavorites) buttons.append(docs, separator(), star, heart, separator());
  buttons.append(
    button(ICONS.splitRight, 'Split right', 'split-right', leafId),
    button(ICONS.splitDown, 'Split down', 'split-down', leafId),
    separator(),
    button(ICONS.sliders, 'Edit .cerberus.json', 'config', leafId),
    zoom,
    button(ICONS.close, 'Close pane', 'kill', leafId)
  );

  header.append(title, buttons);

  // Clicking header background (not a button) focuses the pane.
  header.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    focus();
  });

  const setFavoriteActive = (active: boolean): void => {
    star.innerHTML = active ? ICONS.starFilled : ICONS.star;
    star.title = active ? 'Remove from favorites' : 'Add to favorites';
    star.classList.toggle('pane-btn-star-active', active);
  };

  const setZoomActive = (active: boolean): void => {
    zoom.innerHTML = active ? ICONS.collapse : ICONS.expand;
    zoom.title = active ? 'Restore pane (Ctrl+B z)' : 'Zoom pane (Ctrl+B z)';
  };

  return { el: header, setFavoriteActive, setZoomActive };
}
