import { ipcMain, type BrowserWindow } from 'electron';
import { spawn as ptySpawn, type IPty } from 'node-pty';
import { randomUUID } from 'node:crypto';
import { readlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { SpawnOptions } from '../core/terminal-bridge.js';

// Electron-side backing of TerminalBridge: owns every pty, bridges IPC.
// paneId (uuid) namespaces the renderer<->pty traffic on shared channels.
interface PaneProc {
  proc: IPty;
  spawnCwd: string;
}
const ptys = new Map<string, PaneProc>();

function defaultShell(): string {
  if (process.platform === 'win32') return 'powershell.exe';
  return process.env['SHELL'] ?? '/bin/zsh';
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

export function registerBridge(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('pty:spawn', (_e, opts: SpawnOptions): string => {
    const paneId = randomUUID();
    const spawnCwd = opts.cwd ?? process.env['HOME'] ?? process.cwd();
    const proc = ptySpawn(opts.shell ?? defaultShell(), [], {
      name: 'xterm-color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: spawnCwd,
      env: cleanEnv(opts.env)
    });
    ptys.set(paneId, { proc, spawnCwd });

    proc.onData((data) => {
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
}

export function killAllPtys(): void {
  for (const { proc } of ptys.values()) proc.kill();
  ptys.clear();
}
