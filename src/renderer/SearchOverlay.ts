// Find bar for a single pane (Cmd+F). Lives inside the pane element, so each
// pane searches its own scrollback and two panes can hold two searches at once.
//
// The pane element already carries `position:relative`, so the bar is absolutely
// positioned against it and never disturbs the terminal's box — an inline bar
// would change the pane height and force a pty resize on every open/close, which
// makes a full-screen TUI redraw from scratch.

import type { PaneSearch } from './Terminal.js';

const openBars = new WeakMap<HTMLElement, () => void>();

export function openSearchOverlay(host: HTMLElement, search: PaneSearch): void {
  // Already open on this pane: re-focus and select, the way a second Cmd+F
  // behaves in every editor.
  const refocus = openBars.get(host);
  if (refocus) {
    refocus();
    return;
  }

  const bar = document.createElement('div');
  bar.className = 'search-bar';

  const input = document.createElement('input');
  input.className = 'search-input';
  input.type = 'text';
  input.placeholder = 'Find';
  input.spellcheck = false;

  const count = document.createElement('span');
  count.className = 'search-count';

  const toggle = (label: string, title: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'search-toggle';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', () => {
      b.classList.toggle('active');
      run('next', true);
      input.focus();
    });
    return b;
  };
  const caseBtn = toggle('Aa', 'Match case');
  const regexBtn = toggle('.*', 'Regular expression');

  const nav = (label: string, title: string, dir: 'next' | 'prev'): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'search-nav';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', () => {
      run(dir);
      input.focus();
    });
    return b;
  };

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'search-nav';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close (Esc)';

  // `restart` re-runs the search from the top instead of stepping: what an edit
  // to the query or a flag change means, as opposed to pressing Enter.
  const run = (dir: 'next' | 'prev', restart = false): void => {
    const q = input.value;
    if (!q) {
      search.clear();
      count.textContent = '';
      input.classList.remove('no-match');
      return;
    }
    const opts = {
      caseSensitive: caseBtn.classList.contains('active'),
      regex: regexBtn.classList.contains('active'),
      incremental: restart
    };
    const found = dir === 'next' ? search.findNext(q, opts) : search.findPrevious(q, opts);
    // A malformed regex mid-typing ("(" ) throws inside the addon and is caught
    // there; treat "not found" and "not valid" the same way visually.
    input.classList.toggle('no-match', !found);
    if (!found) count.textContent = '0';
  };

  const close = (): void => {
    search.clear();
    bar.remove();
    openBars.delete(host);
    unsubscribe();
    focusTerminal();
  };
  const focusTerminal = (): void => {
    host.querySelector<HTMLElement>('.xterm-helper-textarea')?.focus();
  };

  const unsubscribe = search.onResults(({ index, count: total }) => {
    // index is -1 when the addon stops tracking (too many matches to decorate).
    count.textContent = total === 0 ? '0' : index < 0 ? `${total}` : `${index + 1}/${total}`;
    input.classList.toggle('no-match', total === 0 && input.value !== '');
  });

  closeBtn.addEventListener('click', close);

  input.addEventListener('input', () => run('next', true));
  input.addEventListener('keydown', (e) => {
    // Nothing typed in the find bar belongs to anyone else — in particular Esc
    // must close this bar, not the settings modal listening on `document`.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(e.shiftKey ? 'prev' : 'next');
    }
  });

  bar.append(
    input,
    count,
    caseBtn,
    regexBtn,
    nav('‹', 'Previous (Shift+Enter)', 'prev'),
    nav('›', 'Next (Enter)', 'next'),
    closeBtn
  );
  host.append(bar);

  openBars.set(host, () => {
    input.focus();
    input.select();
  });

  // Seed from the current selection, like macOS apps do.
  const selected = search.selection();
  if (selected && !selected.includes('\n')) {
    input.value = selected;
    run('next', true);
  }
  input.focus();
  input.select();
}
