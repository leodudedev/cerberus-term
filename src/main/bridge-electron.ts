import { ipcMain, type BrowserWindow } from 'electron';
import { spawn as ptySpawn, type IPty } from 'node-pty';
import { randomUUID } from 'node:crypto';
import { readlinkSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { config } from '../core/config.js';
import { getSettings } from './settings.js';
import type { SpawnOptions } from '../core/terminal-bridge.js';

// Electron-side backing of TerminalBridge: owns every pty, bridges IPC.
// paneId (uuid) namespaces the renderer<->pty traffic on shared channels.
interface PaneProc {
  proc: IPty;
  spawnCwd: string;
  buf: string; // rolling raw-output tail; feeds capturePane (no tmux)
  // False while no renderer owns this pane (between a reload/crash and the
  // reattach). Output still accumulates in buf and is replayed on attach, so
  // nothing is lost while the window is gone.
  attached: boolean;
}
const ptys = new Map<string, PaneProc>();

// Rolling per-pane output tail. It serves two readers: the Cerberus daemon,
// which only needs the current screen to spot a permission dialog, and the
// reattach replay after a renderer restart, which wants real scrollback — hence
// the generous size, with CAPTURE_MAX slicing the small window back out.
const BUFFER_MAX = 256 * 1024;
const CAPTURE_MAX = 16 * 1024;
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[()][AB0]|\x1b[<=>]|[\x00-\x08\x0b\x0c\x0e-\x1f]/g;

function defaultShell(): string {
  const configured = getSettings().defaultShell?.trim();
  if (configured) return configured;
  if (process.platform === 'win32') return 'powershell.exe';
  return process.env['SHELL'] ?? '/bin/zsh';
}

// Spawn the shell as a LOGIN shell (like Terminal.app / iTerm do). Without this
// ~/.zprofile / ~/.profile never run, so PATH additions, brew shellenv, and
// interactive plugins (zsh-autosuggestions, fish) aren't loaded — which is why
// the greyed-out next-command suggestion is missing. Interactivity is implied
// by the pty tty. PowerShell/other shells: no login flag.
function shellArgs(shell: string): string[] {
  if (process.platform === 'win32') return [];
  const base = shell.split('/').pop() ?? '';
  if (base === 'zsh' || base === 'bash' || base === 'fish') return ['-l'];
  return [];
}

// node-pty wants a fully-defined string env; drop undefined values.
function cleanEnv(extra?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) out[k] = v;
  }
  return { ...out, ...(extra ?? {}) };
}

// Best-effort live cwd of a pty's shell process. Falls back to the spawn cwd
// on Windows or any failure.
function liveCwd(pid: number, fallback: string): string {
  try {
    if (process.platform === 'linux') {
      return readlinkSync(`/proc/${pid}/cwd`);
    }
    if (process.platform === 'darwin') {
      const out = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
        encoding: 'utf8'
      });
      const line = out.split('\n').find((l) => l.startsWith('n'));
      if (line) return line.slice(1);
    }
  } catch {
    /* fall through */
  }
  return fallback;
}

export function getPaneCwd(paneId: string): string {
  const entry = ptys.get(paneId);
  if (!entry) return process.env['HOME'] ?? process.cwd();
  return liveCwd(entry.proc.pid, entry.spawnCwd);
}

// --- Cerberus core seam (used by pane-control.ts) ---

export function paneExists(paneId: string): boolean {
  return ptys.has(paneId);
}

// Inject raw bytes into a pane's pty (replaces `tmux send-keys`).
export function writeKeys(paneId: string, data: string): void {
  ptys.get(paneId)?.proc.write(data);
}

// ANSI-stripped tail of a pane's output (replaces `tmux capture-pane`).
export function getPaneBuffer(paneId: string): string {
  const buf = ptys.get(paneId)?.buf ?? '';
  return buf.slice(-CAPTURE_MAX).replace(ANSI_RE, '');
}

// A renderer restart (reload, crash, dev HMR) leaves every pty without an
// owner. Mark them so their output is buffered instead of shouted at a dead
// webContents, and so an unclaimed pane can be reaped once the restore settles.
export function detachAllPtys(): void {
  for (const entry of ptys.values()) entry.attached = false;
}

export function registerBridge(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('pty:spawn', (_e, opts: SpawnOptions): string => {
    const paneId = randomUUID();
    // Restore may hand us a cwd that no longer exists; fall back to home.
    // os.homedir() works on Windows too (HOME is usually unset there).
    const home = homedir() || process.cwd();
    const spawnCwd = opts.cwd && existsSync(opts.cwd) ? opts.cwd : home;
    // Inject the pane identity + daemon port so the CLI hooks report back an
    // exact pane<->event correlation and reach our daemon (not mycli's :8899).
    const shell = opts.shell ?? defaultShell();
    const proc = ptySpawn(shell, shellArgs(shell), {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: spawnCwd,
      env: cleanEnv({
        ...(opts.env ?? {}),
        // Advertise 24-bit color so TUIs (Claude Code, bat, delta, syntax
        // highlighters) emit truecolor instead of collapsing onto the 16-color
        // ANSI palette — what iTerm/VS Code set. This is the main reason output
        // looked flat.
        COLORTERM: 'truecolor',
        CERBERUS_PANE_ID: paneId,
        CERBERUS_PORT: String(config.port)
      })
    });
    const entry: PaneProc = { proc, spawnCwd, buf: '', attached: true };
    ptys.set(paneId, entry);

    proc.onData((data) => {
      entry.buf = (entry.buf + data).slice(-BUFFER_MAX);
      // While detached the buffer is the only sink: the replay on attach hands
      // this same output to the terminal, so forwarding now would duplicate it.
      if (entry.attached) getWindow()?.webContents.send('pty:data', paneId, data);
    });
    proc.onExit(({ exitCode }) => {
      if (entry.attached) getWindow()?.webContents.send('pty:exit', paneId, exitCode);
      ptys.delete(paneId);
    });

    return paneId;
  });

  // Panes that outlived the previous renderer, for the restore to claim.
  ipcMain.handle('pty:list', (): string[] => [...ptys.keys()]);

  // Re-own a surviving pty: flips it back to attached and returns its raw
  // output tail for the terminal to replay. Null means the pty is gone (it
  // exited while the window was down) and the caller should spawn a fresh one.
  ipcMain.handle('pty:attach', (_e, paneId: string, cols: number, rows: number): string | null => {
    const entry = ptys.get(paneId);
    if (!entry) return null;
    try {
      entry.proc.resize(cols, rows);
    } catch {
      /* pty gone between the lookup and here */
    }
    // Flipping the flag in the same tick as the buf read is what makes the
    // handoff lossless: no chunk can slip between the snapshot and the resume.
    entry.attached = true;
    return entry.buf;
  });

  // Kill whatever the restore didn't claim, so a pane dropped from the layout
  // can't keep a headless shell (and its `claude`) running forever.
  ipcMain.handle('pty:reap', (_e, keep: string[]): number => {
    const claimed = new Set(keep);
    let killed = 0;
    for (const [id, entry] of ptys) {
      if (claimed.has(id) || entry.attached) continue;
      entry.proc.kill();
      ptys.delete(id);
      killed++;
    }
    return killed;
  });

  ipcMain.on('pty:write', (_e, paneId: string, data: string) => {
    ptys.get(paneId)?.proc.write(data);
  });

  ipcMain.on('pty:resize', (_e, paneId: string, cols: number, rows: number) => {
    // resize throws if the pty already exited; ignore that race.
    try {
      ptys.get(paneId)?.proc.resize(cols, rows);
    } catch {
      /* pty gone */
    }
  });

  ipcMain.on('pty:kill', (_e, paneId: string) => {
    ptys.get(paneId)?.proc.kill();
    ptys.delete(paneId);
  });

  ipcMain.handle('pty:cwd', (_e, paneId: string): string => getPaneCwd(paneId));
}

export function killAllPtys(): void {
  for (const { proc } of ptys.values()) proc.kill();
  ptys.clear();
}
