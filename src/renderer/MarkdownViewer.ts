import type { DocEntry } from '../core/docs-bridge.js';
import { highlightCode, renderMarkdown, renderMermaid, slugify } from './markdown.js';
import { currentTheme } from './themes.js';

// The document viewer opened from the ▤ dropdown. Two modes, switchable from
// its own toolbar: over the pane (keeps the other sessions visible) or over the
// whole window (what a wide mermaid diagram needs). Either way it's an overlay,
// never a pane: the pty underneath is never resized, so the TUI in it doesn't
// redraw when a document is opened or closed.

export interface ViewerHandle {
  close(): void;
  openFind(): void;
  isOpen(): boolean;
}

export interface ViewerOptions {
  paneId: string;
  // The .pane element this viewer belongs to, and where it renders in pane mode.
  host: HTMLElement;
  root: string;
  entry: DocEntry;
  fullscreen: boolean;
  // Called once the viewer is gone, so the caller can put focus back in the pty.
  onClose(): void;
  // Persisted when the toolbar toggle is used, so the choice sticks.
  onFullscreenChange?(fullscreen: boolean): void;
}

const FIND_HIGHLIGHT = 'md-find';
const FIND_ACTIVE_HIGHLIGHT = 'md-find-active';

const openViewers = new WeakMap<HTMLElement, ViewerHandle>();

export function viewerFor(host: HTMLElement): ViewerHandle | undefined {
  return openViewers.get(host);
}

// Path helpers: the renderer has no node:path, and these only ever see paths
// that came out of the scan (plus a relative href from a document).
function isWindowsPath(abs: string): boolean {
  return /^[a-z]:\\/i.test(abs) || (abs.includes('\\') && !abs.includes('/'));
}

function resolveRelative(baseAbs: string, href: string, root: string): string | null {
  const sep = isWindowsPath(baseAbs) ? '\\' : '/';
  const parts = baseAbs.split(/[/\\]/);
  parts.pop(); // drop the file name — links are relative to its directory
  const start = href.startsWith('/') ? root.split(/[/\\]/) : parts;
  const out = [...start];
  for (const seg of href.replace(/^\//, '').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (out.length > 1) out.pop();
      continue;
    }
    out.push(seg);
  }
  const resolved = out.join(sep);
  return resolved || null;
}

function relFrom(root: string, abs: string): string {
  const normalizedRoot = root.replace(/[/\\]+$/, '');
  if (!abs.startsWith(normalizedRoot)) return abs;
  return abs.slice(normalizedRoot.length + 1).split('\\').join('/');
}

function button(className: string, glyph: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = glyph;
  b.title = title;
  return b;
}

export function openMarkdownViewer(opts: ViewerOptions): ViewerHandle {
  const { paneId, host, root, onClose, onFullscreenChange } = opts;

  const existing = openViewers.get(host);
  if (existing) existing.close();

  let fullscreen = opts.fullscreen;
  let current: DocEntry = opts.entry;
  // Where "back" goes: every internal link followed pushes the document it left.
  const history: DocEntry[] = [];

  const overlay = document.createElement('div');
  overlay.className = 'md-viewer';

  const bar = document.createElement('div');
  bar.className = 'md-bar';

  const back = button('md-btn', '‹', 'Back');
  back.disabled = true;
  const title = document.createElement('span');
  title.className = 'md-title';
  const spacer = document.createElement('span');
  spacer.className = 'md-spacer';
  const findBtn = button('md-btn', '⌕', 'Find in document (Cmd+F)');
  const expand = button('md-btn', fullscreen ? '⤡' : '⤢', 'Toggle full window');
  const closeBtn = button('md-btn md-close', '✕', 'Close (Esc)');

  bar.append(back, title, spacer, findBtn, expand, closeBtn);

  const content = document.createElement('div');
  content.className = 'md-content';

  const article = document.createElement('article');
  article.className = 'md-body';
  content.append(article);

  overlay.append(bar, content);

  // ---- find in document ----------------------------------------------------
  // CSS Custom Highlights rather than wrapping matches in <mark>: no DOM
  // mutation, so a re-render (theme change, navigation) can't tear apart the
  // markup the highlighter injected, and nothing shifts on screen.
  const findBar = document.createElement('div');
  findBar.className = 'search-bar md-find';
  const findInput = document.createElement('input');
  findInput.className = 'search-input';
  findInput.type = 'text';
  findInput.placeholder = 'Find in document';
  findInput.spellcheck = false;
  const findCount = document.createElement('span');
  findCount.className = 'search-count';
  const findPrev = button('search-nav', '‹', 'Previous (Shift+Enter)');
  const findNext = button('search-nav', '›', 'Next (Enter)');
  const findClose = button('search-nav', '✕', 'Close (Esc)');
  findBar.append(findInput, findCount, findPrev, findNext, findClose);

  let ranges: Range[] = [];
  let activeMatch = -1;

  const highlightsAvailable = (): boolean =>
    typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

  const clearFind = (): void => {
    ranges = [];
    activeMatch = -1;
    if (!highlightsAvailable()) return;
    CSS.highlights.delete(FIND_HIGHLIGHT);
    CSS.highlights.delete(FIND_ACTIVE_HIGHLIGHT);
  };

  // One flat string for the whole document plus the text node each offset came
  // from, so a match spanning `**bold**` (three nodes) still becomes one Range.
  const textIndex = (): { text: string; nodes: { node: Text; start: number }[] } => {
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    const nodes: { node: Text; start: number }[] = [];
    let text = '';
    let node = walker.nextNode() as Text | null;
    while (node) {
      nodes.push({ node, start: text.length });
      text += node.data;
      node = walker.nextNode() as Text | null;
    }
    return { text, nodes };
  };

  const rangeFor = (
    nodes: { node: Text; start: number }[],
    from: number,
    to: number
  ): Range | null => {
    const locate = (offset: number): { node: Text; offset: number } | null => {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (n && offset >= n.start) return { node: n.node, offset: offset - n.start };
      }
      return null;
    };
    const startAt = locate(from);
    const endAt = locate(to);
    if (!startAt || !endAt) return null;
    const range = document.createRange();
    try {
      range.setStart(startAt.node, Math.min(startAt.offset, startAt.node.data.length));
      range.setEnd(endAt.node, Math.min(endAt.offset, endAt.node.data.length));
    } catch {
      return null;
    }
    return range;
  };

  const paintFind = (): void => {
    if (!highlightsAvailable()) return;
    CSS.highlights.set(FIND_HIGHLIGHT, new Highlight(...ranges));
    const active = ranges[activeMatch];
    if (active) CSS.highlights.set(FIND_ACTIVE_HIGHLIGHT, new Highlight(active));
    else CSS.highlights.delete(FIND_ACTIVE_HIGHLIGHT);
  };

  const scrollToMatch = (): void => {
    const active = ranges[activeMatch];
    if (!active) return;
    const target = active.startContainer.parentElement;
    target?.scrollIntoView({ block: 'center' });
  };

  const runFind = (restart: boolean): void => {
    const query = findInput.value;
    clearFind();
    if (!query) {
      findCount.textContent = '';
      findInput.classList.remove('no-match');
      return;
    }
    if (!highlightsAvailable()) {
      findCount.textContent = 'n/a';
      return;
    }
    const { text, nodes } = textIndex();
    const haystack = text.toLowerCase();
    const needle = query.toLowerCase();
    let at = haystack.indexOf(needle);
    while (at >= 0 && ranges.length < 2000) {
      const range = rangeFor(nodes, at, at + needle.length);
      if (range) ranges.push(range);
      at = haystack.indexOf(needle, at + needle.length);
    }
    findInput.classList.toggle('no-match', ranges.length === 0);
    if (ranges.length === 0) {
      findCount.textContent = '0';
      return;
    }
    activeMatch = restart ? 0 : Math.min(Math.max(activeMatch, 0), ranges.length - 1);
    paintFind();
    findCount.textContent = `${activeMatch + 1}/${ranges.length}`;
    if (restart) scrollToMatch();
  };

  const step = (delta: number): void => {
    if (ranges.length === 0) return;
    activeMatch = (activeMatch + delta + ranges.length) % ranges.length;
    paintFind();
    findCount.textContent = `${activeMatch + 1}/${ranges.length}`;
    scrollToMatch();
  };

  const findOpen = (): boolean => findBar.isConnected;

  const openFind = (): void => {
    if (!findOpen()) overlay.append(findBar);
    findInput.focus();
    findInput.select();
    if (findInput.value) runFind(true);
  };

  const closeFind = (): void => {
    clearFind();
    findBar.remove();
    findCount.textContent = '';
    content.focus();
  };

  findInput.addEventListener('input', () => runFind(true));
  findInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      closeFind();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    }
  });
  findPrev.addEventListener('click', () => step(-1));
  findNext.addEventListener('click', () => step(1));
  findClose.addEventListener('click', closeFind);

  // ---- document loading ----------------------------------------------------

  const decorate = (): void => {
    void highlightCode(article);
    void renderMermaid(article, currentTheme() === 'dark');
  };

  // A document's own screenshots. The page's CSP allows `data:` and nothing
  // remote, so main hands the bytes over inlined; anything with a scheme
  // (a shields.io badge) is left alone and simply doesn't load.
  const inlineImages = async (): Promise<void> => {
    const images = article.querySelectorAll<HTMLImageElement>('img[data-md-src]');
    for (const img of images) {
      const src = img.dataset['mdSrc'];
      if (!src) continue;
      const abs = resolveRelative(current.abs, src, root);
      if (!abs) {
        img.classList.add('md-img-missing');
        continue;
      }
      const data = await window.cerberusDocs.asset(paneId, abs);
      if (data) img.src = data;
      else img.classList.add('md-img-missing');
    }
    // Remote images (a README's badge row) are blocked by the page's CSP. Style
    // them as the alt-text chip rather than leaving a broken-image glyph.
    for (const img of article.querySelectorAll<HTMLImageElement>('img[src^="http"]')) {
      img.classList.add('md-img-missing');
    }
  };

  const load = async (entry: DocEntry, anchor?: string): Promise<void> => {
    current = entry;
    title.textContent = relFrom(root, entry.abs);
    title.title = entry.abs;
    back.disabled = history.length === 0;
    clearFind();

    const res = await window.cerberusDocs.read(paneId, entry.abs);
    if (!res.ok) {
      article.replaceChildren();
      const err = document.createElement('div');
      err.className = 'md-error';
      err.textContent = res.error;
      article.append(err);
      return;
    }
    article.innerHTML = renderMarkdown(res.content);
    content.scrollTop = 0;
    decorate();
    void inlineImages();
    if (anchor) {
      const target = article.querySelector(`#${CSS.escape(anchor)}`);
      target?.scrollIntoView({ block: 'start' });
    }
    if (findOpen() && findInput.value) runFind(true);
  };

  // Links: a relative .md opens in place (with history), an anchor scrolls, and
  // anything http(s) is left to the window's will-navigate handler, which hands
  // it to the system browser.
  article.addEventListener('click', (e) => {
    const link = (e.target as HTMLElement | null)?.closest('a');
    const href = link?.getAttribute('href');
    if (!href) return;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return; // absolute URL — not ours

    e.preventDefault();
    if (href.startsWith('#')) {
      const target = article.querySelector(`#${CSS.escape(slugify(href.slice(1)))}`);
      target?.scrollIntoView({ block: 'start' });
      return;
    }
    const [path, anchor] = href.split('#');
    if (!path) return;
    if (!/\.mdx?$/i.test(path)) return; // only markdown navigates in the viewer
    const abs = resolveRelative(current.abs, path, root);
    if (!abs) return;
    history.push(current);
    void load({ rel: relFrom(root, abs), abs, mtimeMs: 0, pinned: false }, anchor);
  });

  back.addEventListener('click', () => {
    const previous = history.pop();
    if (previous) void load(previous);
  });

  // ---- mode, theme, lifecycle ---------------------------------------------

  const mount = (): void => {
    const scroll = content.scrollTop;
    overlay.classList.toggle('fullscreen', fullscreen);
    (fullscreen ? document.body : host).append(overlay);
    content.scrollTop = scroll;
  };

  expand.addEventListener('click', () => {
    fullscreen = !fullscreen;
    expand.textContent = fullscreen ? '⤡' : '⤢';
    mount();
    onFullscreenChange?.(fullscreen);
    content.focus();
  });

  const onTheme = (): void => decorate();
  window.addEventListener('theme-change', onTheme);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    clearFind();
    window.removeEventListener('theme-change', onTheme);
    overlay.remove();
    openViewers.delete(host);
    onClose();
  };

  // Esc closes the find bar first, then the viewer. Nothing is forwarded to the
  // pty: an Esc that reached the agent CLI underneath would interrupt its turn.
  overlay.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (findOpen()) closeFind();
      else close();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openFind();
    }
  });

  closeBtn.addEventListener('click', close);
  findBtn.addEventListener('click', openFind);

  // Focusable so the overlay itself takes the keys (and the arrows scroll it)
  // the moment it opens, without stealing them back from the find bar.
  content.tabIndex = 0;

  mount();
  const handle: ViewerHandle = { close, openFind, isOpen: () => !closed };
  openViewers.set(host, handle);
  void load(current).then(() => content.focus());
  return handle;
}
