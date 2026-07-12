import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

// A live terminal pane: xterm bound to one pty, with a lifecycle the pane tree
// can manage (focus, dispose). The tree owns creation/teardown; this owns the
// xterm<->pty wiring and self-fitting via ResizeObserver (covers window resize,
// relayout, and Step 3 splitter drags through a single path).
export interface TerminalPane {
  readonly paneId: Promise<string>;
  focus(): void;
  onFocus(cb: () => void): void;
  dispose(): void;
}

// Temporary Step 2 driver: Cmd-based combos dispatched as a window event so the
// tree (in main.ts) can act on the focused pane. Step 8 replaces this.
function emitPaneCmd(cmd: 'split-right' | 'split-down' | 'kill'): void {
  window.dispatchEvent(new CustomEvent('pane-cmd', { detail: { cmd } }));
}

export function createTerminalPane(el: HTMLElement): TerminalPane {
  const term = new Terminal({
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    fontSize: 13,
    cursorBlink: true,
    theme: { background: '#1a1a1a', foreground: '#e0e0e0' }
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(el);
  fit.fit();

  let paneId: string | null = null;
  let disposed = false;
  const focusCbs: Array<() => void> = [];
  const unsub: Array<() => void> = [];

  el.addEventListener('focusin', () => focusCbs.forEach((cb) => cb()));

  const ro = new ResizeObserver(() => {
    if (disposed) return;
    fit.fit();
    if (paneId) window.cerberus.resize(paneId, term.cols, term.rows);
  });
  ro.observe(el);

  // Swallow our Cmd combos so they never reach the shell.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
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
    }
    return true;
  });

  const paneIdPromise = window.cerberus
    .spawn({ cols: term.cols, rows: term.rows })
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
      term.onData((data) => window.cerberus.write(id, data));
      // sync any size drift accumulated before spawn resolved
      window.cerberus.resize(id, term.cols, term.rows);
      return id;
    });

  return {
    paneId: paneIdPromise,
    focus: () => term.focus(),
    onFocus: (cb) => focusCbs.push(cb),
    dispose: () => {
      disposed = true;
      ro.disconnect();
      unsub.forEach((u) => u());
      if (paneId) window.cerberus.kill(paneId);
      term.dispose();
    }
  };
}
