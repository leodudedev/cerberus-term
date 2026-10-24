// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The terminal and the markdown pipeline are out of scope here: what's under
// test is the viewer's lifecycle against the pane that hosts it.
const terminals = vi.hoisted(() => ({ focus: vi.fn(), dispose: vi.fn() }));
vi.mock('../src/renderer/Terminal.js', () => ({
  createTerminalPane: () => ({
    paneId: Promise.resolve('pane'),
    paneIdNow: () => 'pane',
    focus: terminals.focus,
    onFocus() {},
    setReadOnly() {},
    dispose: terminals.dispose,
    refit() {}
  })
}));
vi.mock('../src/renderer/markdown.js', () => ({
  renderMarkdown: (s: string) => s,
  highlightCode: async () => {},
  renderMermaid: async () => {},
  slugify: (s: string) => s
}));

import { Layout } from '../src/renderer/Layout.js';
import { openMarkdownViewer, viewerFor, type ViewerHandle } from '../src/renderer/MarkdownViewer.js';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const entry = { abs: '/project/README.md', rel: 'README.md', mtimeMs: 1, pinned: false };

let docs: {
  read: ReturnType<typeof vi.fn>;
  mtime: ReturnType<typeof vi.fn>;
  asset: ReturnType<typeof vi.fn>;
  remoteAsset: ReturnType<typeof vi.fn>;
};
let themeListeners = 0;
// Intervals still running. Counted directly rather than with getTimerCount():
// jsdom schedules timers of its own (selection bookkeeping on focus).
const intervals = new Set<number>();

beforeEach(() => {
  vi.useFakeTimers();
  docs = {
    read: vi.fn(async () => ({ ok: true, content: '<p>doc</p>' })),
    mtime: vi.fn(async () => 1),
    asset: vi.fn(async () => null),
    remoteAsset: vi.fn(async () => null)
  };
  (window as unknown as { cerberusDocs: unknown }).cerberusDocs = docs;
  themeListeners = 0;
  intervals.clear();
  const setInterval = window.setInterval.bind(window);
  const clearInterval = window.clearInterval.bind(window);
  vi.spyOn(window, 'setInterval').mockImplementation(((...args: Parameters<typeof window.setInterval>) => {
    const id = setInterval(...args);
    intervals.add(id);
    return id;
  }) as typeof window.setInterval);
  vi.spyOn(window, 'clearInterval').mockImplementation(((id?: number) => {
    if (id !== undefined) intervals.delete(id);
    clearInterval(id);
  }) as typeof window.clearInterval);
  const add = window.addEventListener.bind(window);
  const remove = window.removeEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, ...rest) => {
    if (type === 'theme-change') themeListeners++;
    add(type, ...(rest as [EventListener]));
  });
  vi.spyOn(window, 'removeEventListener').mockImplementation((type, ...rest) => {
    if (type === 'theme-change') themeListeners--;
    remove(type, ...(rest as [EventListener]));
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  terminals.focus.mockClear();
  terminals.dispose.mockClear();
  document.body.replaceChildren();
});

function paneWithViewer(fullscreen: boolean, onClose?: () => void) {
  const container = document.createElement('div');
  document.body.append(container);
  const layout = new Layout(container, () => {}, () => {});
  layout.render({ type: 'leaf', id: 'leaf' });
  const host = layout.paneBodyOf('leaf')!;
  const viewer = openMarkdownViewer({
    paneId: 'pane',
    host,
    root: '/project',
    entry,
    fullscreen,
    remoteImages: true,
    onClose: onClose ?? (() => layout.focusLeaf('leaf'))
  });
  return { layout, host, viewer };
}

describe('closing a pane with a document open', () => {
  for (const fullscreen of [false, true]) {
    const mode = fullscreen ? 'fullscreen' : 'inline';

    it(`closes the ${mode} viewer, its overlay, timer and theme listener`, async () => {
      const { layout, host, viewer } = paneWithViewer(fullscreen);
      await flush();
      expect(document.querySelector('.md-viewer')).not.toBeNull();
      layout.render(null);
      expect(viewer.isOpen()).toBe(false);
      expect(viewerFor(host)).toBeUndefined();
      expect(document.querySelector('.md-viewer')).toBeNull();
      expect(intervals.size).toBe(0);
      expect(themeListeners).toBe(0);
      expect(terminals.dispose).toHaveBeenCalledOnce();
    });

    it(`returns to baseline after 100 open/close-tab cycles (${mode})`, async () => {
      const viewers: ViewerHandle[] = [];
      for (let i = 0; i < 100; i++) {
        const { layout, viewer } = paneWithViewer(fullscreen);
        viewers.push(viewer);
        await flush();
        layout.render(null);
      }
      expect(viewers.every((v) => !v.isOpen())).toBe(true);
      expect(document.querySelectorAll('.md-viewer').length).toBe(0);
      expect(intervals.size).toBe(0);
      expect(themeListeners).toBe(0);
    });
  }

  it('does not hand focus back to the terminal it is tearing down', async () => {
    const { layout } = paneWithViewer(true);
    await flush();
    terminals.focus.mockClear();
    layout.render(null);
    expect(terminals.focus).not.toHaveBeenCalled();
    // A late focus request for the dead leaf is ignored too.
    layout.focusLeaf('leaf');
    expect(terminals.focus).not.toHaveBeenCalled();
  });
});

describe('async work finishing after close', () => {
  it('drops a document read that answers after the viewer closed', async () => {
    const read = deferred<{ ok: true; content: string }>();
    docs.read.mockReturnValueOnce(read.promise);
    const { layout } = paneWithViewer(true);
    layout.render(null);
    read.resolve({ ok: true, content: '<img data-md-src="shot.png">' });
    await flush();
    expect(docs.mtime).not.toHaveBeenCalled();
    expect(docs.asset).not.toHaveBeenCalled();
  });

  it('drops a reload poll that answers after the viewer closed', async () => {
    const { layout } = paneWithViewer(false);
    await flush();
    // offsetParent is always null under jsdom; pretend the overlay is shown.
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body);
    // First tick sees the file change and waits one tick for it to settle...
    docs.mtime.mockResolvedValueOnce(2);
    vi.advanceTimersByTime(1500);
    await flush();
    // ...the second would reload it, but the pane closes while it's out.
    const stat = deferred<number>();
    docs.mtime.mockReturnValueOnce(stat.promise);
    vi.advanceTimersByTime(1500);
    layout.render(null);
    stat.resolve(2);
    await flush();
    expect(docs.read).toHaveBeenCalledOnce();
  });

  it('does not paint a web image that arrives after the viewer closed', async () => {
    const image = deferred<string | null>();
    docs.read.mockResolvedValueOnce({ ok: true, content: '<img src="https://example.invalid/badge.svg">' });
    docs.remoteAsset.mockReturnValueOnce(image.promise);
    const { viewer, host } = paneWithViewer(false);
    await flush();
    const img = host.querySelector('img')!;
    expect(docs.remoteAsset).toHaveBeenCalledOnce();
    viewer.close();
    image.resolve('data:image/svg+xml;base64,AAAA');
    await flush();
    expect(img.getAttribute('src')).toBeNull();
  });

  it('does not paint a web image that arrives after web images were turned off', async () => {
    const image = deferred<string | null>();
    docs.read.mockResolvedValueOnce({ ok: true, content: '<img src="https://example.invalid/badge.svg">' });
    docs.remoteAsset.mockReturnValueOnce(image.promise);
    const { host } = paneWithViewer(false);
    await flush();
    const toggle = host.querySelector<HTMLButtonElement>('.md-btn-on')!;
    toggle.click(); // off
    image.resolve('data:image/svg+xml;base64,AAAA');
    await flush();
    expect(host.querySelector('img')!.getAttribute('src')).toBeNull();
    expect(host.querySelector('img')!.classList.contains('md-img-missing')).toBe(true);
  });
});

describe('web images per document', () => {
  const page = (urls: string[]): string => urls.map((u) => `<img src="${u}">`).join('');

  it('fetches a few at a time and each URL once', async () => {
    const urls = Array.from({ length: 12 }, (_, i) => `https://example.invalid/${i}.svg`);
    const pending: Deferred<string | null>[] = [];
    docs.read.mockResolvedValueOnce({ ok: true, content: page([...urls, urls[0]!, urls[0]!]) });
    docs.remoteAsset.mockImplementation(() => {
      const d = deferred<string | null>();
      pending.push(d);
      return d.promise;
    });
    const { host } = paneWithViewer(false);
    await flush();
    expect(pending.length).toBe(4);
    while (pending.length < 12) {
      pending.at(-1)!.resolve('data:image/svg+xml;base64,AAAA');
      await flush();
    }
    for (const d of pending) d.resolve('data:image/svg+xml;base64,AAAA');
    await flush();
    expect(docs.remoteAsset).toHaveBeenCalledTimes(12);
    expect([...host.querySelectorAll('img')].every((img) => img.getAttribute('src'))).toBe(true);
  });

  it('stops inlining once the document budget is spent', async () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(20 * 1024 * 1024);
    docs.read.mockResolvedValueOnce({
      ok: true,
      content: page(['https://example.invalid/1.png', 'https://example.invalid/2.png', 'https://example.invalid/3.png'])
    });
    docs.remoteAsset.mockResolvedValue(big);
    const { host } = paneWithViewer(false);
    await flush();
    const painted = [...host.querySelectorAll('img')].filter((img) => img.getAttribute('src'));
    expect(painted.length).toBe(2);
  });
});

describe('links', () => {
  // A cancelled navigation of the main window used to orphan every pane's
  // output, so no link may start one: absolute URLs go to window.open.
  it('opens an absolute link through window.open, never as a navigation', async () => {
    docs.read.mockResolvedValueOnce({
      ok: true,
      content: '<a href="https://github.com/x">web</a> <a href="mailto:a@b.c">mail</a>'
    });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { host } = paneWithViewer(false);
    await flush();
    for (const link of host.querySelectorAll('a')) {
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });
      link.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(true);
    }
    expect(open.mock.calls).toEqual([
      ['https://github.com/x', '_blank', 'noopener'],
      ['mailto:a@b.c', '_blank', 'noopener']
    ]);
  });

  it('opens a relative markdown link in place, without window.open', async () => {
    docs.read.mockResolvedValueOnce({ ok: true, content: '<a href="docs/guide.md">guide</a>' });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { host } = paneWithViewer(false);
    await flush();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    host.querySelector('a')!.dispatchEvent(click);
    await flush();
    expect(click.defaultPrevented).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(docs.read).toHaveBeenLastCalledWith('pane', '/project/docs/guide.md');
  });
  it('shows a linked text file verbatim, never as markup', async () => {
    docs.read
      .mockResolvedValueOnce({ ok: true, content: '<a href="LICENSE">license</a>' })
      .mockResolvedValueOnce({ ok: true, content: 'MIT <script>alert(1)</script> **not bold**' });
    const { host } = paneWithViewer(false);
    await flush();
    host.querySelector('a')!.click();
    await flush();
    expect(docs.read).toHaveBeenLastCalledWith('pane', '/project/LICENSE');
    const code = host.querySelector('.md-body pre.md-pre > code')!;
    expect(code.textContent).toBe('MIT <script>alert(1)</script> **not bold**');
    expect(host.querySelector('.md-body script, .md-body strong')).toBeNull();
    expect(code.hasAttribute('data-lang')).toBe(false);
    expect(host.querySelector('.md-title')!.textContent).toBe('LICENSE');
    // Back returns to the document the link was in.
    host.querySelector<HTMLButtonElement>('.md-bar .md-btn')!.click();
    await flush();
    expect(docs.read).toHaveBeenLastCalledWith('pane', '/project/README.md');
  });

  it('highlights a linked script by its extension', async () => {
    docs.read
      .mockResolvedValueOnce({ ok: true, content: '<a href="./install.sh">script</a>' })
      .mockResolvedValueOnce({ ok: true, content: 'echo hi' });
    const { host } = paneWithViewer(false);
    await flush();
    host.querySelector('a')!.click();
    await flush();
    expect(host.querySelector<HTMLElement>('.md-body code')!.dataset['lang']).toBe('bash');
  });

  it('says why a linked file cannot be shown instead of ignoring the click', async () => {
    docs.read
      .mockResolvedValueOnce({ ok: true, content: '<a href="shot.png">screenshot</a>' })
      .mockResolvedValueOnce({ ok: false, error: 'Only Markdown and plain-text files open in the viewer' });
    const { host } = paneWithViewer(false);
    await flush();
    host.querySelector('a')!.click();
    await flush();
    expect(docs.read).toHaveBeenLastCalledWith('pane', '/project/shot.png');
    expect(host.querySelector('.md-error')!.textContent).toMatch(/Markdown and plain-text/);
  });
});
