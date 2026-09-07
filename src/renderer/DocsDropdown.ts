import type { DocEntry } from '../core/docs-bridge.js';

// The document button's dropdown: every markdown file in the project the pane sits in.
// Anchored inside the pane element (like the find bar) rather than centred on
// the window — a pane holding half the screen gets a list half the screen wide,
// which is what "open the docs of *this* pane" should look like.

const openDropdowns = new WeakMap<HTMLElement, () => void>();

export interface DocsDropdownOptions {
  host: HTMLElement;
  root: string;
  entries: DocEntry[];
  truncated: boolean;
  onSelect(entry: DocEntry): void;
  onClose?(): void;
}

function splitRel(rel: string): { dir: string; name: string } {
  const i = rel.lastIndexOf('/');
  return i < 0 ? { dir: '', name: rel } : { dir: rel.slice(0, i + 1), name: rel.slice(i + 1) };
}

export function openDocsDropdown(opts: DocsDropdownOptions): void {
  const { host, root, entries, truncated, onSelect, onClose } = opts;

  // A second click on the button closes it, the way every dropdown behaves.
  const already = openDropdowns.get(host);
  if (already) {
    already();
    return;
  }

  const panel = document.createElement('div');
  panel.className = 'docs-dropdown';

  const header = document.createElement('div');
  header.className = 'docs-head';
  const rootLabel = document.createElement('span');
  rootLabel.className = 'docs-root';
  rootLabel.textContent = root.split('/').pop() || root;
  rootLabel.title = root;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'search-nav';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close (Esc)';
  header.append(rootLabel, closeBtn);

  const filter = document.createElement('input');
  filter.className = 'search-input docs-filter';
  filter.type = 'text';
  filter.placeholder = 'Filter';
  filter.spellcheck = false;

  const list = document.createElement('div');
  list.className = 'docs-list';

  let rows: { el: HTMLElement; entry: DocEntry }[] = [];
  let cursor = 0;

  const close = (): void => {
    panel.remove();
    openDropdowns.delete(host);
    document.removeEventListener('pointerdown', onOutside, true);
    onClose?.();
  };

  const onOutside = (e: PointerEvent): void => {
    const target = e.target as HTMLElement | null;
    if (panel.contains(target)) return;
    // The button itself toggles; letting the outside handler fire too would
    // close and immediately reopen.
    if (target?.closest('.pane-btn-docs')) return;
    close();
  };

  const setCursor = (next: number): void => {
    if (rows.length === 0) return;
    cursor = (next + rows.length) % rows.length;
    rows.forEach((r, i) => r.el.classList.toggle('active', i === cursor));
    rows[cursor]?.el.scrollIntoView({ block: 'nearest' });
  };

  const renderList = (): void => {
    const q = filter.value.trim().toLowerCase();
    const matched = q ? entries.filter((e) => e.rel.toLowerCase().includes(q)) : entries;
    list.replaceChildren();
    rows = [];

    if (matched.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'settings-hint';
      empty.textContent = entries.length
        ? 'No file matches that filter.'
        : 'No markdown in this project — check the docs globs in Settings.';
      list.append(empty);
      return;
    }

    for (const entry of matched) {
      const index = rows.length;
      const row = document.createElement('div');
      row.className = 'docs-row';
      if (entry.pinned) row.classList.add('pinned');

      const { dir, name } = splitRel(entry.rel);
      const path = document.createElement('span');
      path.className = 'docs-path';
      if (dir) {
        const dirEl = document.createElement('span');
        dirEl.className = 'docs-dir';
        dirEl.textContent = dir;
        path.append(dirEl);
      }
      path.append(document.createTextNode(name));
      path.title = entry.rel;

      row.append(path);
      row.addEventListener('click', () => {
        close();
        onSelect(entry);
      });
      row.addEventListener('pointerenter', () => setCursor(index));
      list.append(row);
      rows.push({ el: row, entry });
    }
    setCursor(0);
  };

  filter.addEventListener('input', renderList);
  // Nothing typed in here belongs to the pane below, or to any modal listening
  // on document (see SearchOverlay).
  filter.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor(cursor + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(cursor - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[cursor];
      if (!row) return;
      close();
      onSelect(row.entry);
    }
  });

  closeBtn.addEventListener('click', close);

  panel.append(header, filter, list);
  if (truncated) {
    const note = document.createElement('div');
    note.className = 'settings-hint docs-note';
    note.textContent = 'Showing the first 500 files.';
    panel.append(note);
  }
  host.append(panel);
  openDropdowns.set(host, close);
  document.addEventListener('pointerdown', onOutside, true);

  renderList();
  filter.focus();
}
