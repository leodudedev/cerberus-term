import { createRequire } from 'node:module';
import { fork, execFile } from 'node:child_process';

// "Which programs are attached to this pane's console" — the Windows answer to
// the question tcgetpgrp answers on POSIX, and the only one available: node-pty
// hands JS no ConPTY handle, so GetConsoleProcessList can't be called on it
// directly.
//
// It doesn't have to be: node-pty already ships the native module that reads
// the list (prebuilt for both win32-x64 and win32-arm64) AND the worker that
// has to host it. The worker exists because GetConsoleProcessList attaches the
// CALLING process to the console it asks about, and a process can be attached
// to exactly one — so it can never run in the main process without dragging
// Electron's main onto a pane's console. We fork the same worker node-pty uses
// internally for its own kill path.
//
// Everything here fails OPEN — an empty result, never an exception. The guard
// reading it would rather deliver one message too many than refuse delivery
// forever because of a transient error. See core/sensitive-process.ts.

const require_ = createRequire(import.meta.url);

// The worker is a fork, not a syscall, so it gets a ceiling. This is only ever
// on the path of an incoming Telegram message, never the pty's.
const AGENT_TIMEOUT_MS = 2000;

// Pids attached to the shell's console, null when we can't tell.
function consolePids(shellPid: number): Promise<number[] | null> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (v: number[] | null): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(v);
    };

    let child;
    try {
      // ELECTRON_RUN_AS_NODE: fork runs process.execPath, which is Electron —
      // without it we'd launch a second copy of the app instead of a worker.
      child = fork(require_.resolve('node-pty/lib/conpty_console_list_agent.js'), [String(shellPid)], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'ignore', 'ignore', 'ipc']
      });
    } catch {
      finish(null); // module gone, or not a Windows build
      return;
    }

    timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, AGENT_TIMEOUT_MS);

    child.on('message', (m) => {
      const list = (m as { consoleProcessList?: unknown }).consoleProcessList;
      if (!Array.isArray(list)) {
        finish(null);
        return;
      }
      // The list always carries the process that asked for it — the fork we
      // just made, which exits before its name could ever be resolved.
      finish(list.filter((p): p is number => typeof p === 'number' && p !== child.pid));
    });
    child.on('error', () => finish(null));
    // Died without reporting: winpty instead of ConPTY, or the native module
    // failed to load. Not an error worth surfacing — just unknown.
    child.on('exit', () => finish(null));
  });
}

// pid -> image name for the pids we care about, in one call. `tasklist` rather
// than PowerShell: no runspace to start, and the image name is all we need.
function imageNames(pids: readonly number[]): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      'tasklist',
      ['/FO', 'CSV', '/NH'],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        const wanted = new Set(pids);
        const names: string[] = [];
        for (const line of stdout.split(/\r?\n/)) {
          const m = /^"([^"]+)","(\d+)"/.exec(line);
          if (m && wanted.has(Number(m[2]))) names.push(m[1]);
        }
        resolve(names);
      }
    );
  });
}

// Image names of the processes sharing the shell's console, the shell itself
// excluded. Empty when the pane is idle — which is also the cheap path: with
// nothing to name, tasklist is never spawned at all.
export async function consoleProcessNames(shellPid: number): Promise<string[]> {
  if (!shellPid) return [];
  const pids = await consolePids(shellPid);
  if (!pids) return [];
  const others = pids.filter((p) => p !== shellPid);
  if (others.length === 0) return [];
  return imageNames(others);
}
