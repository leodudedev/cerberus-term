import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

// Step 1: one xterm instance bound to one pty via window.cerberus.
// paneId plumbing is real (Step 2 spawns many); here exactly one is created.
export async function mountTerminal(container: HTMLElement): Promise<void> {
  const term = new Terminal({
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    fontSize: 13,
    cursorBlink: true,
    theme: { background: '#1a1a1a', foreground: '#e0e0e0' }
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(container);
  fit.fit();

  const paneId = await window.cerberus.spawn({ cols: term.cols, rows: term.rows });

  window.cerberus.onData(paneId, (data) => term.write(data));
  window.cerberus.onExit(paneId, () => term.write('\r\n\x1b[90m[process exited]\x1b[0m\r\n'));
  term.onData((data) => window.cerberus.write(paneId, data));

  const syncSize = () => {
    fit.fit();
    window.cerberus.resize(paneId, term.cols, term.rows);
  };
  window.addEventListener('resize', syncSize);

  term.focus();
}
