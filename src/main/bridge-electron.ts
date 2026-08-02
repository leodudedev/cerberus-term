import { ipcMain, type BrowserWindow } from 'electron';
import { spawn as ptySpawn, type IPty } from 'node-pty';
import { randomUUID } from 'node:crypto';
import { readlinkSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { config } from '../core/config.js';
import { getSettings } from './settings.js';
import { getDaemonToken } from './cerberus/token.js';
import { stripAnsi } from '../core/ansi.js';
import { consoleProcessNames } from './win-console.js';
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

// The app's own secrets, which a pane must never inherit. Settings and .env are
// loaded into process.env at boot, and a pty gets a copy of it — so without this
// every shell, every `claude`, every npm postinstall and every `env` typed
// during a screen share would hand out the Telegram bot token. With token and
// chat id, anything running in a pane can poll the bot (stealing the taps on the
// approval buttons) and push forged permission requests to the phone.
// CERBERUS_PANE_ID / CERBERUS_PORT stay: the hooks need them.
const PRIVATE_ENV = new Set([
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'TELEGRAM_ALLOWED_CHATS',
  'CERBERUS_ENV_FILE'
]);

// node-pty wants a fully-defined string env; drop undefined values.
function cleanEnv(extra?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !PRIVATE_ENV.has(k)) out[k] = v;
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

// Live cwds of every pane, for the follower-path check: a project outside home
// is legitimate only while a pane is actually sitting in it. Uses the spawn cwd
// rather than liveCwd() — this runs on a request path and liveCwd shells out to
// lsof per pane on macOS.
export function paneSpawnCwds(): string[] {
  return [...ptys.values()].map((e) => e.spawnCwd);
}

// --- Cerberus core seam (used by pane-control.ts) ---

export function paneExists(paneId: string): boolean {
  return ptys.has(paneId);
}

// Name of the process currently owning the pane's tty. node-pty reads the
// foreground process group, so this is the program a keystroke would actually
// reach — the shell when nothing is running, `ssh`/`sudo` when one of those is.
// '' when the pane is gone.
//
// Platform-dependent, and only two of the three tell the truth: macOS reads the
// foreground pgrp's comm, Linux reads argv[0] out of /proc/<pgrp>/cmdline, and
// Windows returns the `name` we passed to spawn ('xterm-256color') — not a
// process at all. So on Windows this value is useless and paneConsoleProcesses
// below answers the question instead. Fails OPEN everywhere it can't tell.
// See core/sensitive-process.ts.
export function paneForeground(paneId: string): string {
  const entry = ptys.get(paneId);
  if (!entry) return '';
  try {
    return entry.proc.process ?? '';
  } catch {
    return ''; // pty exited between the lookup and the read
  }
}

// The Windows half of the same question: image names of every process attached
// to the pane's console, the shell excluded. Async because the console process
// list can only be read out of process — see win-console.ts. [] on any other
// platform and on any error, so the guard keeps failing open.
export async function paneConsoleProcesses(paneId: string): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  const entry = ptys.get(paneId);
  if (!entry) return [];
  try {
    return await consoleProcessNames(entry.proc.pid);
  } catch {
    return []; // pty exited between the lookup and the read
  }
}

// Inject raw bytes into a pane's pty (replaces `tmux send-keys`).
export function writeKeys(paneId: string, data: string): void {
  ptys.get(paneId)?.proc.write(data);
}

// ANSI-stripped tail of a pane's output (replaces `tmux capture-pane`).
export function getPaneBuffer(paneId: string): string {
  const buf = ptys.get(paneId)?.buf ?? '';
  return stripAnsi(buf.slice(-CAPTURE_MAX));
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
        CERBERUS_PORT: String(config.port),
        // Lets the CLI hooks authenticate to the daemon. Deliberately readable
        // by anything in the pane: it isn't a defence against this user's own
        // processes, it's what keeps a web page from POSTing to our loopback
        // port. See cerberus/token.ts.
        CERBERUS_TOKEN: getDaemonToken()
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
