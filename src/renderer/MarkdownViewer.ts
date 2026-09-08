import type { DocEntry } from '../core/docs-bridge.js';
import { highlightCode, renderMarkdown, renderMermaid, slugify } from './markdown.js';
import { currentTheme } from './themes.js';
import { ICONS } from './icons.js';

// The document viewer opened from the pane header's document dropdown. Two
// modes, switchable from its own toolbar: over the pane (keeps the other
// sessions visible) or over the whole window (what a wide mermaid diagram
// needs). Either way it's an overlay, never a pane: the pty underneath is never
// resized, so the TUI in it doesn't redraw when a document is opened or
// closed.

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
  // Whether a document may pull the images it points at off the network.
  remoteImages: boolean;
  // Called once the viewer is gone, so the caller can put focus back in the pty.
  onClose(): void;
  // Persisted when the toolbar toggle is used, so the choice sticks.
  onFullscreenChange?(fullscreen: boolean): void;
  onRemoteImagesChange?(remoteImages: boolean): void;
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

function remoteImagesTitle(on: boolean): string {
  return on ? 'Web images on — click to stop fetching them' : 'Load images from the web';
}

function button(className: string, icon: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.innerHTML = icon;
  b.title = title;
  return b;
}

export function openMarkdownViewer(opts: ViewerOptions): ViewerHandle {
  const { paneId, host, root, onClose, onFullscreenChange, onRemoteImagesChange } = opts;

  const existing = openViewers.get(host);
  if (existing) existing.close();

  let fullscreen = opts.fullscreen;
  let remoteImages = opts.remoteImages;
  let current: DocEntry = opts.entry;
  // Where "back" goes: every internal link followed pushes the document it left.
  const history: DocEntry[] = [];

  const overlay = document.createElement('div');
  overlay.className = 'md-viewer';

  const bar = document.createElement('div');
  bar.className = 'md-bar';

  const back = button('md-btn', ICONS.back, 'Back');
  back.disabled = true;
  const title = document.createElement('span');
  title.className = 'md-title';
  const spacer = document.createElement('span');
  spacer.className = 'md-spacer';
  const findBtn = button('md-btn', ICONS.find, 'Find in document (Cmd+F)');
  const remoteBtn = button('md-btn', ICONS.globe, remoteImagesTitle(remoteImages));
  remoteBtn.classList.toggle('md-btn-on', remoteImages);
  const expand = button(
    'md-btn',
    fullscreen ? ICONS.collapse : ICONS.expand,
    'Toggle full window'
  );
  const closeBtn = button('md-btn md-close', ICONS.close, 'Close (Esc)');

  bar.append(back, title, spacer, remoteBtn, findBtn, expand, closeBtn);

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
  // remote, so main hands the bytes over inlined.
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
    parkRemoteImages();
    if (remoteImages) void loadRemoteImages();
  };

  // A README's badge row. The page can't load those itself (CSP), and leaving
  // the URL in place buys a broken-image glyph painted over the alt text, so the
  // src moves to a data-attribute and main fetches it right after. With the
  // toolbar toggle off the alt text stands in as a chip instead.
  const parkRemoteImages = (): void => {
    for (const img of article.querySelectorAll<HTMLImageElement>('img[src]')) {
      const src = img.getAttribute('src') ?? '';
      if (!/^https?:/i.test(src)) continue;
      img.dataset['mdRemote'] = src;
      img.removeAttribute('src');
      img.classList.add('md-img-missing');
    }
  };

  // In parallel: a badge row is a dozen requests to the same host, and doing
  // them one after another would have the document filling in for seconds.
  const loadRemoteImages = async (): Promise<void> => {
    const images = [...article.querySelectorAll<HTMLImageElement>('img[data-md-remote]')];
    await Promise.all(
      images.map(async (img) => {
        const url = img.dataset['mdRemote'];
        if (!url || img.getAttribute('src')) return;
        const data = await window.cerberusDocs.remoteAsset(url);
        // No data: offline, not an image, too big. The chip stays.
        if (!data) return;
        img.src = data;
        img.classList.remove('md-img-missing');
      })
    );
  };

  const dropRemoteImages = (): void => {
    for (const img of article.querySelectorAll<HTMLImageElement>('img[data-md-remote]')) {
      img.removeAttribute('src');
      img.classList.add('md-img-missing');
    }
  };

  const load = async (entry: DocEntry, anchor?: string, keepScroll = false): Promise<void> => {
    current = entry;
    title.textContent = relFrom(root, entry.abs);
    title.title = entry.abs;
    back.disabled = history.length === 0;
    clearFind();
    const scroll = content.scrollTop;

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
    // A reload keeps you where you were reading; opening a document starts at
    // the top. Either way the mtime we just rendered is the one to compare
    // against, so a save that lands mid-read isn't missed.
    content.scrollTop = keepScroll ? scroll : 0;
    seenMtime = await window.cerberusDocs.mtime(paneId, entry.abs);
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

  remoteBtn.addEventListener('click', () => {
    remoteImages = !remoteImages;
    remoteBtn.classList.toggle('md-btn-on', remoteImages);
    remoteBtn.title = remoteImagesTitle(remoteImages);
    if (remoteImages) void loadRemoteImages();
    else dropRemoteImages();
    onRemoteImagesChange?.(remoteImages);
  });

  expand.addEventListener('click', () => {
    fullscreen = !fullscreen;
    expand.innerHTML = fullscreen ? ICONS.collapse : ICONS.expand;
    mount();
    onFullscreenChange?.(fullscreen);
    content.focus();
  });

  // Documents are read once, so a file rewritten underneath — an agent editing
  // the very spec you have open — would sit there stale until reopened. Polling
  // the mtime rather than fs.watch: an editor (or our own settings writer) that
  // saves through a temp file and a rename replaces the inode, which a watch on
  // the old one never hears about.
  let seenMtime: number | null = null;
  const RELOAD_POLL_MS = 1500;
  // The mtime of a file still being written, held until it stops moving.
  let pendingMtime: number | null = null;
  const poll = window.setInterval(() => {
    // Nothing to poll for a window in the background or a document sitting in
    // an inactive tab — those keep their DOM, so only the layout knows.
    if (document.hidden || overlay.offsetParent === null) return;
    void (async () => {
      const at = await window.cerberusDocs.mtime(paneId, current.abs);
      // Null is a deleted or unreadable file: keep showing what we have rather
      // than blanking the document someone is reading.
      if (at === null) return;
      if (seenMtime === null) {
        seenMtime = at; // a stat that failed earlier, answering again now
        return;
      }
      if (at === seenMtime) return;
      // One tick of quiet before re-rendering. A file being appended to (a log,
      // an agent writing a long document) would otherwise re-parse, re-highlight
      // and re-draw its mermaid diagrams on every single tick.
      if (at !== pendingMtime) {
        pendingMtime = at;
        return;
      }
      pendingMtime = null;
      await load(current, undefined, true);
    })();
  }, RELOAD_POLL_MS);

  const onTheme = (): void => decorate();
  window.addEventListener('theme-change', onTheme);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    clearFind();
    window.clearInterval(poll);
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
