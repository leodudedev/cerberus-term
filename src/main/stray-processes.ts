import { execFileSync, execFile } from 'node:child_process';
import {
  parsePsTable,
  parseWinProcessCsv,
  paneProcesses,
  describeProcess,
  type ProcRow
} from '../core/process-tree.js';

// Quit-path guard: what did the user leave running inside a pane that killing
// the pty won't take down? See core/process-tree.ts for how they're found.
//
// The snapshot is synchronous because of when it has to happen: right before
// the ptys are killed, in handlers Electron gives us no way to await in. It
// costs one `ps` fork (a few ms — bridge-electron already forks lsof the same
// way on every cwd refresh). Windows pays more for its PowerShell query, but
// only on the quit path, which is once per run.
//
// Everything that came out of that snapshot and is still alive a moment after
// the kill is a genuine survivor: the transient half went with the hangup, so
// nothing has to be guessed about which process would have ignored SIGHUP.
//
// Fails OPEN everywhere: an unreadable process table means an empty list, so a
// broken `ps` delays nobody's quit.

const SCAN_TIMEOUT_MS = 3000;
/** Long enough for a SIGHUP'ed job to finish dying, short enough not to be felt. */
export const HANGUP_GRACE_MS = 300;
/** Between our SIGTERM and the SIGKILL that follows it. */
const TERM_GRACE_MS = 2000;

export interface Stray {
  pid: number;
  /** Display label, e.g. `electron-vite.js dev`. */
  label: string;
}

function processTable(): ProcRow[] {
  const opts = { timeout: SCAN_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' } as const;
  if (process.platform === 'win32') {
    return parseWinProcessCsv(
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation'
        ],
        opts
      )
    );
  }
  // `command` last: it's the only field that can contain spaces, so the parser
  // can take the rest of the line for it. `=` on each field suppresses the
  // header, so there's never one to skip.
  return parsePsTable(execFileSync('ps', ['-Ao', 'pid=,ppid=,tty=,command='], opts));
}

/**
 * Everything running under the pane shells right now, shells excluded. Most of
 * these die with the pty — call {@link stillRunning} after the kill to narrow
 * the list to the ones that didn't.
 */
export function snapshotPaneProcesses(shellPids: readonly number[]): Stray[] {
  if (shellPids.length === 0) return [];
  try {
    return paneProcesses(processTable(), shellPids)
      .filter((r) => r.pid !== process.pid && r.command !== '')
      .map((r) => ({ pid: r.pid, label: describeProcess(r.command) }));
  } catch {
    return []; // fail open: never block the quit on a scan
  }
}

/** The subset still alive. Signal 0 tests for existence without delivering one. */
export function stillRunning(strays: readonly Stray[]): Stray[] {
  return strays.filter((s) => {
    try {
      process.kill(s.pid, 0);
      return true;
    } catch {
      return false; // exited, or no longer ours to signal
    }
  });
}

/**
 * SIGTERM, a grace period, then SIGKILL for whoever ignored it. Windows has no
 * such distinction: taskkill /T /F is the only forceful option, and it takes
 * the process tree with it.
 */
export async function terminate(strays: readonly Stray[]): Promise<void> {
  if (strays.length === 0) return;

  if (process.platform === 'win32') {
    await Promise.all(
      strays.map(
        (s) =>
          new Promise<void>((resolve) => {
            execFile(
              'taskkill.exe',
              ['/PID', String(s.pid), '/T', '/F'],
              { timeout: SCAN_TIMEOUT_MS },
              () => resolve()
            );
          })
      )
    );
    return;
  }

  for (const s of strays) {
    try {
      process.kill(s.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  await new Promise((r) => setTimeout(r, TERM_GRACE_MS));
  for (const s of stillRunning(strays)) {
    try {
      process.kill(s.pid, 'SIGKILL');
    } catch {
      /* died during the grace period */
    }
  }
}
