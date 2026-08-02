// Throwaway probe: can we tell WHICH program owns a pane's tty on this
// platform? That's the single assumption the pane reuse guard rests on
// (src/core/sensitive-process.ts, paneForeground + paneConsoleProcesses in
// bridge-electron.ts, main/win-console.ts).
//
// Run from the repo root, with the SAME runtime the app uses — node-pty is a
// native module rebuilt for Electron, so plain `node` will refuse to load it:
//
//   macOS   ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron docs/probe-fg.cjs
//   Linux   ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron docs/probe-fg.cjs
//   Windows set ELECTRON_RUN_AS_NODE=1 && node_modules\electron\dist\electron.exe docs\probe-fg.cjs
//
// On Windows it also runs against an INSTALLED release, which is how the guard
// was first verified there — no checkout and no build needed:
//
//   $env:ELECTRON_RUN_AS_NODE = "1"
//   & "$env:LOCALAPPDATA\Programs\cerberus-term\Cerberus.exe" docs\probe-fg.cjs
//
// Two columns are printed. `fg` is node-pty's foreground process; `console` is
// the Windows console process list, empty everywhere else.
//
// Expected:
//   macOS   fg: zsh -> cat -> zsh -> ssh                  (verified 2026-07-29)
//   Linux   fg: argv[0] of the foreground pgrp, so bash/-bash -> cat -> ssh
//   Windows fg: 'xterm-256color' on every line — it returns the spawn `name`,
//           not a process. The truth is in `console`, which must be empty at
//           idle and must contain ssh.exe while ssh is up. (verified 2026-08-01)
//
// Any line where a held tty still reports the shell — and, on Windows, an empty
// `console` while ssh is up — means the guard cannot see what it's protecting
// against on that platform, and the deny-list is theatre.

const path = require('path');
const { fork, execFile } = require('child_process');
const pty = require('node-pty');

const isWin = process.platform === 'win32';
const shell = isWin ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
const args = isWin ? [] : ['-l'];
// `cat` with no args holds the tty exactly like an interactive password prompt.
const hold = isWin ? 'more' : 'cat';

// --- Windows console process list ------------------------------------------
// Same shape as main/win-console.ts, duplicated on purpose: this file has to
// run standalone against a packaged app, where src/ doesn't exist.

const AGENT = (() => {
  try {
    return require.resolve('node-pty/lib/conpty_console_list_agent.js');
  } catch (e) {
    return null;
  }
})();

const consolePids = (shellPid) =>
  new Promise((resolve) => {
    if (!AGENT) return resolve(null);
    let child;
    try {
      child = fork(AGENT, [String(shellPid)], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'ignore', 'ignore', 'ipc']
      });
    } catch (e) {
      return resolve(null);
    }
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, 2000);
    child.on('message', (m) => {
      const list = m && m.consoleProcessList;
      // The list always carries the process that asked for it.
      finish(Array.isArray(list) ? list.filter((x) => x !== child.pid) : null);
    });
    child.on('error', () => finish(null));
    child.on('exit', () => finish(null));
  });

const imageNames = (pids) =>
  new Promise((resolve) => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 8 << 20 }, (err, out) => {
      if (err) return resolve(pids.map((p) => `${p}:?`));
      const seen = new Map();
      for (const line of out.split(/\r?\n/)) {
        const m = /^"([^"]+)","(\d+)"/.exec(line);
        if (m) seen.set(Number(m[2]), m[1]);
      }
      resolve(pids.map((p) => `${p}:${seen.get(p) || '?'}`));
    });
  });

const consoleView = async (shellPid) => {
  if (!isWin) return [];
  const pids = await consolePids(shellPid);
  if (!pids) return ['<unavailable>'];
  const others = pids.filter((p) => p !== shellPid);
  if (others.length === 0) return [];
  return imageNames(others);
};

// --- probe ------------------------------------------------------------------

const p = pty.spawn(shell, args, {
  name: 'xterm-256color',
  cols: 80,
  rows: 24,
  cwd: process.env.HOME || process.env.USERPROFILE
});
p.onData(() => {});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const show = async (label) => {
  const con = await consoleView(p.pid);
  console.log(label.padEnd(20), 'fg:', JSON.stringify(p.process), ' console:', JSON.stringify(con));
};

(async () => {
  console.log('shell pid:', p.pid, isWin ? `(agent: ${AGENT || 'NOT RESOLVED'})` : '');

  await wait(1500);
  await show('idle shell');

  p.write(`${hold}\r`);
  await wait(1500);
  await show(`while ${hold}`);

  p.write('\x04'); // ctrl-D
  await wait(1200);
  await show('back to shell');

  // A real ssh, aimed at a black-holed address so it hangs on connect instead
  // of failing DNS and exiting before we can look at it.
  p.write('ssh -o ConnectTimeout=20 nobody@10.255.255.1\r');
  await wait(3000);
  await show('while ssh');

  p.kill();
  process.exit(0);
})();
