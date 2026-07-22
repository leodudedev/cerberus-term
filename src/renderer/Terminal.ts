import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { currentTheme, xtermTheme, type Theme } from './themes.js';

// A live terminal pane: xterm bound to one pty, with a lifecycle the pane tree
// can manage (focus, dispose). The tree owns creation/teardown; this owns the
// xterm<->pty wiring and self-fitting via ResizeObserver (covers window resize,
// relayout, and Step 3 splitter drags through a single path).
export interface TerminalPane {
  readonly paneId: Promise<string>;
  focus(): void;
  onFocus(cb: () => void): void;
  setReadOnly(v: boolean): void;
  dispose(): void;
}

// Temporary Step 2 driver: Cmd-based combos dispatched as a window event so the
// tree (in main.ts) can act on the focused pane. Step 8 replaces this.
function emitPaneCmd(cmd: 'split-right' | 'split-down' | 'kill'): void {
  window.dispatchEvent(new CustomEvent('pane-cmd', { detail: { cmd } }));
}

export function createTerminalPane(el: HTMLElement, cwd?: string): TerminalPane {
  const term = new Terminal({
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    fontSize: 13,
    cursorBlink: true,
    theme: xtermTheme(currentTheme())
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(el);
  fit.fit();

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

  const ro = new ResizeObserver(() => {
    if (disposed) return;
    fit.fit();
    if (paneId) window.cerberus.resize(paneId, term.cols, term.rows);
  });
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

  const paneIdPromise = window.cerberus
    .spawn({ cols: term.cols, rows: term.rows, ...(cwd ? { cwd } : {}) })
    .then((id) => {
      paneId = id;
      if (disposed) {
        window.cerberus.kill(id);
        return id;
      }
      unsub.push(window.cerberus.onData(id, (data) => term.write(data)));
      unsub.push(
        window.cerberus.onExit(id, () =>
          term.write('\r\n\x1b[90m[process exited]\x1b[0m\r\n')
        )
      );
      // read-only panes (e.g. a `tail -f` follower) don't forward keystrokes
      term.onData((data) => {
        if (!readOnly) window.cerberus.write(id, data);
      });
      // sync any size drift accumulated before spawn resolved
      window.cerberus.resize(id, term.cols, term.rows);
      return id;
    });

  return {
    paneId: paneIdPromise,
    focus: () => term.focus(),
    onFocus: (cb) => focusCbs.push(cb),
    setReadOnly: (v) => {
      readOnly = v;
    },
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
