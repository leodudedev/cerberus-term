import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { currentTheme, searchDecorations, xtermTheme, type Theme } from './themes.js';

// Scrollback search, as the find bar needs it. Deliberately narrower than the
// addon's own surface: the overlay shouldn't have to know about decorations or
// carry the addon import.
export interface PaneSearchOptions {
  caseSensitive?: boolean;
  regex?: boolean;
  incremental?: boolean;
}
export interface PaneSearch {
  findNext(query: string, opts?: PaneSearchOptions): boolean;
  findPrevious(query: string, opts?: PaneSearchOptions): boolean;
  // Drops the highlights and the active-match selection.
  clear(): void;
  selection(): string;
  // Returns an unsubscribe. index is -1 once the addon stops tracking position
  // (more matches than it will decorate).
  onResults(cb: (r: { index: number; count: number }) => void): () => void;
}

// A live terminal pane: xterm bound to one pty, with a lifecycle the pane tree
// can manage (focus, dispose). The tree owns creation/teardown; this owns the
// xterm<->pty wiring and self-fitting via ResizeObserver (covers window resize,
// relayout, and Step 3 splitter drags through a single path).
export interface TerminalPane {
  readonly paneId: Promise<string>;
  // The resolved pty id, or null while the spawn/attach is still in flight.
  // beforeunload has no time to await the promise.
  paneIdNow(): string | null;
  focus(): void;
  onFocus(cb: () => void): void;
  setReadOnly(v: boolean): void;
  // Edit menu clipboard. copySelection() reports false when there's nothing
  // selected, so the caller can fall back to Chromium's native handler.
  copySelection(): boolean;
  pasteText(text: string): void;
  readonly search: PaneSearch;
  // Re-measure and resize the pty to the container. Called on tab activation:
  // a pane living in a display:none tab can't measure, so its fit is deferred
  // until the tab is shown again.
  refit(): void;
  dispose(): void;
}

// Temporary Step 2 driver: Cmd-based combos dispatched as a window event so the
// tree (in main.ts) can act on the focused pane. Step 8 replaces this.
function emitPaneCmd(cmd: 'split-right' | 'split-down' | 'kill'): void {
  window.dispatchEvent(new CustomEvent('pane-cmd', { detail: { cmd } }));
}

export interface PaneInit {
  cwd?: string;
  /**
   * A pty that survived the previous renderer (reload/crash). When it's still
   * alive the pane reattaches and replays its output instead of spawning a new
   * shell, so the running session — a `claude`, a build — is never lost.
   */
  attachPaneId?: string;
}

export function createTerminalPane(el: HTMLElement, init: PaneInit = {}): TerminalPane {
  const { cwd, attachPaneId } = init;
  const term = new Terminal({
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    fontSize: 13,
    cursorBlink: true,
    theme: xtermTheme(currentTheme())
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const searchAddon = new SearchAddon();
  term.loadAddon(searchAddon);
  term.open(el);
  // A detached/hidden container (a background tab) measures 0 — fitting against
  // it would resize the pty to a garbage 1x1. Only fit while actually visible;
  // refit() re-runs this the moment the pane's tab is shown.
  const isVisible = (): boolean => el.isConnected && el.offsetParent !== null;
  if (isVisible()) fit.fit();

  // The base DOM renderer has a known dirty-row repaint bug: glyphs land in the
  // buffer (proven by Enter forcing a redraw that reveals them) but don't paint
  // to screen right at an autowrap boundary. The GPU renderer repaints per-frame
  // instead of per-DOM-node and doesn't have this gap. Guard both failure modes:
  // a synchronous throw on load, and an async WebGL context loss at runtime —
  // dispose on the latter so xterm transparently falls back to the DOM renderer
  // instead of freezing on a dead GL context.
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
  } catch {
    /* GPU unavailable — fall back to default DOM renderer */
  }

  const onTheme = (e: Event): void => {
    term.options.theme = xtermTheme((e as CustomEvent<Theme>).detail);
  };
  window.addEventListener('theme-change', onTheme);

  let paneId: string | null = null;
  let disposed = false;
  let readOnly = false;
  const focusCbs: Array<() => void> = [];
  const unsub: Array<() => void> = [];

  el.addEventListener('focusin', () => focusCbs.forEach((cb) => cb()));

  // Drag-and-drop: insert dropped file paths into the pty (e.g. an image onto a
  // Claude Code session). preventDefault on dragover is required or the browser
  // swallows the drop; on drop it stops Electron from navigating to file://.
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (!files?.length || !paneId || readOnly) return;
    const quoted = Array.from(files)
      .map((f) => window.cerberus.pathForFile(f))
      .filter(Boolean)
      // POSIX single-quote so paths with spaces/specials stay one token
      .map((p) => `'${p.replace(/'/g, "'\\''")}'`)
      .join(' ');
    if (quoted) window.cerberus.write(paneId, quoted + ' ');
  });

  const fitNow = (): void => {
    if (disposed || !isVisible()) return;
    fit.fit();
    if (paneId) window.cerberus.resize(paneId, term.cols, term.rows);
  };
  const ro = new ResizeObserver(fitNow);
  ro.observe(el);

  // Swallow our Cmd combos so they never reach the shell.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    // Shift+Enter -> literal newline. xterm sends CR (\r) for both Enter and
    // Shift+Enter; TUIs like Claude Code treat CR as "submit" and LF as
    // "insert newline", so send LF ourselves (what `/terminal-setup` does).
    if (e.key === 'Enter' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault(); // stop the hidden textarea from inserting its own newline
      if (paneId && !readOnly) window.cerberus.write(paneId, '\n');
      return false;
    }
    if (e.metaKey && !e.ctrlKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'd') {
        emitPaneCmd(e.shiftKey ? 'split-down' : 'split-right');
        return false;
      }
      if (k === 'k') {
        emitPaneCmd('kill');
        return false;
      }
      // Cmd+, (settings) is handled by a window-level capture listener in
      // main.ts — more reliable than xterm focus. Swallow it here so the comma
      // never reaches the shell.
      if (e.key === ',') return false;
      // xterm has no built-in mapping for Cmd+Arrow (only Alt+Arrow sends a meta
      // escape natively). Mac terminals conventionally translate Cmd+Left/Right
      // to readline's start/end-of-line, so replicate that ourselves.
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (paneId && !readOnly) window.cerberus.write(paneId, '\x01');
        return false;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (paneId && !readOnly) window.cerberus.write(paneId, '\x05');
        return false;
      }
    }
    return true;
  });

  // Wire a resolved pty to this xterm. `onOutput` decides what happens to
  // incoming data: live panes write straight through, a reattaching pane holds
  // chunks back until its replay has landed so the order stays right.
  const bind = (id: string, onOutput: (data: string) => void): string => {
    paneId = id;
    if (disposed) {
      window.cerberus.kill(id);
      return id;
    }
    unsub.push(window.cerberus.onData(id, onOutput));
    unsub.push(
      window.cerberus.onExit(id, () => term.write('\r\n\x1b[90m[process exited]\x1b[0m\r\n'))
    );
    // sync any size drift accumulated before the pty resolved
    window.cerberus.resize(id, term.cols, term.rows);
    return id;
  };

  // Keystrokes follow whatever pty the pane currently owns (it changes once if
  // a reattach falls back to a fresh spawn). read-only panes (a `tail -f`
  // follower) don't forward them at all.
  term.onData((data) => {
    if (!readOnly && paneId) window.cerberus.write(paneId, data);
  });

  const spawnFresh = (): Promise<string> =>
    window.cerberus
      .spawn({ cols: term.cols, rows: term.rows, ...(cwd ? { cwd } : {}) })
      .then((id) => bind(id, (data) => term.write(data)));

  // Reattach: subscribe *before* asking main to resume the pty, so no chunk
  // falls in the gap between the buffer snapshot and the live feed. Anything
  // that arrives early is queued and flushed right after the replay.
  const reattach = (id: string): Promise<string> => {
    let replayed = false;
    const queued: string[] = [];
    bind(id, (data) => {
      if (replayed) term.write(data);
      else queued.push(data);
    });
    if (disposed) return Promise.resolve(id);
    return window.cerberus.attach(id, term.cols, term.rows).then((replay) => {
      if (replay === null) {
        // The shell exited while the window was down — start a clean one.
        unsub.splice(0).forEach((u) => u());
        return spawnFresh();
      }
      term.write(replay);
      replayed = true;
      for (const chunk of queued) term.write(chunk);
      queued.length = 0;
      // A full-screen TUI (Claude Code, vim, htop) paints on demand, so the
      // replay alone leaves a stale frame. Nudging the size makes it redraw
      // from scratch on SIGWINCH; the delay lets it settle between the two.
      window.setTimeout(() => {
        if (disposed || !isVisible()) return;
        window.cerberus.resize(id, term.cols, Math.max(1, term.rows - 1));
        window.setTimeout(() => {
          if (!disposed) window.cerberus.resize(id, term.cols, term.rows);
        }, 60);
      }, 60);
      return id;
    });
  };

  // A half-typed regex ("(", "[a-") is a normal state of the find bar, and the
  // addon throws on it rather than returning false. No match and no valid
  // pattern look the same to the caller.
  const runSearch = (q: string, opts: PaneSearchOptions | undefined, back: boolean): boolean => {
    const searchOptions = { ...opts, decorations: searchDecorations(currentTheme()) };
    try {
      return back
        ? searchAddon.findPrevious(q, searchOptions)
        : searchAddon.findNext(q, searchOptions);
    } catch {
      return false;
    }
  };

  const paneIdPromise = attachPaneId ? reattach(attachPaneId) : spawnFresh();

  return {
    paneId: paneIdPromise,
    paneIdNow: () => paneId,
    focus: () => term.focus(),
    onFocus: (cb) => focusCbs.push(cb),
    setReadOnly: (v) => {
      readOnly = v;
    },
    // Writing the clipboard is allowed for the focused document without a
    // permission prompt; reading isn't, which is why main hands us the text.
    copySelection: () => {
      const sel = term.getSelection();
      if (!sel) return false;
      void navigator.clipboard.writeText(sel);
      return true;
    },
    // term.paste() (not a raw write) so xterm normalises newlines and wraps the
    // text in bracketed-paste markers when the app asked for them — without it a
    // multi-line paste is executed line by line by the shell.
    pasteText: (text) => {
      if (readOnly || !text) return;
      term.paste(text);
    },
    search: {
      // Decorations are resolved per call rather than captured once: the theme
      // can change while the find bar is open, and the addon only reads these
      // colors at search time.
      findNext: (q, opts) => runSearch(q, opts, false),
      findPrevious: (q, opts) => runSearch(q, opts, true),
      clear: () => {
        searchAddon.clearDecorations();
        term.clearSelection();
      },
      selection: () => term.getSelection(),
      onResults: (cb) => {
        const sub = searchAddon.onDidChangeResults(({ resultIndex, resultCount }) =>
          cb({ index: resultIndex, count: resultCount })
        );
        return () => sub.dispose();
      }
    },
    refit: () => fitNow(),
    dispose: () => {
      disposed = true;
      ro.disconnect();
      window.removeEventListener('theme-change', onTheme);
      unsub.forEach((u) => u());
      if (paneId) window.cerberus.kill(paneId);
      term.dispose();
    }
  };
}
