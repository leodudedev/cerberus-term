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
}
const ptys = new Map<string, PaneProc>();

// Keep the last ~16KB of each pane's output so the Cerberus daemon can read the
// live permission dialog (the native replacement for `tmux capture-pane`).
const BUFFER_MAX = 16 * 1024;
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
  return buf.replace(ANSI_RE, '');
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
    const entry: PaneProc = { proc, spawnCwd, buf: '' };
    ptys.set(paneId, entry);

    proc.onData((data) => {
      entry.buf = (entry.buf + data).slice(-BUFFER_MAX);
      getWindow()?.webContents.send('pty:data', paneId, data);
    });
    proc.onExit(({ exitCode }) => {
      getWindow()?.webContents.send('pty:exit', paneId, exitCode);
      ptys.delete(paneId);
    });

    return paneId;
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
