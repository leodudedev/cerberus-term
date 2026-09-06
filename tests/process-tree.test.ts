import { describe, it, expect } from 'vitest';
import {
  parsePsTable,
  parseWinProcessCsv,
  descendantsOf,
  paneProcesses,
  describeProcess
} from '../src/core/process-tree.js';

describe('ps table parsing', () => {
  const output = [
    '  501       1 ttys004  /bin/zsh',
    ' 1200     501 ttys004  node /repo/node_modules/.bin/vite dev',
    '  777       1 ??       /usr/sbin/cupsd -l',
    'garbage line without numbers',
    ''
  ].join('\n');

  it('reads pid, parent, tty and the full command line', () => {
    expect(parsePsTable(output)).toEqual([
      { pid: 501, ppid: 1, tty: 'ttys004', command: '/bin/zsh' },
      { pid: 1200, ppid: 501, tty: 'ttys004', command: 'node /repo/node_modules/.bin/vite dev' },
      { pid: 777, ppid: 1, tty: '', command: '/usr/sbin/cupsd -l' }
    ]);
  });

  it('normalises every "no controlling terminal" spelling to empty', () => {
    const rows = parsePsTable(['1 1 ? a', '2 1 ?? b', '3 1 - c'].join('\n'));
    expect(rows.map((r) => r.tty)).toEqual(['', '', '']);
  });

  it('keeps arguments that contain spaces', () => {
    const rows = parsePsTable('  42      1 ttys001 python -c import time; time.sleep(9)');
    expect(rows[0]!.command).toBe('python -c import time; time.sleep(9)');
  });

  it('drops lines it cannot read instead of throwing', () => {
    expect(parsePsTable('')).toEqual([]);
    expect(parsePsTable('PID PPID TTY COMMAND')).toEqual([]);
  });
});

describe('what belongs to the panes', () => {
  const rows = parsePsTable(
    [
      '  501       1 ttys004  /bin/zsh', // pane shell
      ' 1200     501 ttys004  node vite dev', // started from that shell
      ' 1201    1200 ttys004  esbuild --service', // its own child
      ' 1300       1 ttys004  node server.js', // orphan: parent already exited
      ' 1400       1 ??       node daemon.js', // setsid'ed away: not ours
      '  502       1 ttys009  /bin/zsh', // second pane shell, nothing under it
      '  777       1 ??       /usr/sbin/cupsd' // unrelated
    ].join('\n')
  );

  it('takes descendants and tty-mates, shells excluded', () => {
    expect(paneProcesses(rows, [501, 502]).map((r) => r.pid)).toEqual([1200, 1201, 1300]);
  });

  it('lists nothing when only the shells are left', () => {
    expect(paneProcesses(rows, [502])).toEqual([]);
    expect(paneProcesses(rows, [])).toEqual([]);
  });

  it('never lists the same process twice', () => {
    const pids = paneProcesses(rows, [501]).map((r) => r.pid);
    expect(new Set(pids).size).toBe(pids.length);
  });
});

describe('windows process tree', () => {
  const csv = [
    '"ProcessId","ParentProcessId","CommandLine"',
    '"900","4","powershell.exe"',
    '"901","900","node.exe C:\\repo\\server.js --port 3000"',
    '"902","901","node.exe C:\\repo\\worker.js"',
    '"903","4",""'
  ].join('\n');

  it('parses the quoted CSV and skips the header', () => {
    expect(parseWinProcessCsv(csv)).toEqual([
      { pid: 900, ppid: 4, tty: '', command: 'powershell.exe' },
      { pid: 901, ppid: 900, tty: '', command: 'node.exe C:\\repo\\server.js --port 3000' },
      { pid: 902, ppid: 901, tty: '', command: 'node.exe C:\\repo\\worker.js' },
      { pid: 903, ppid: 4, tty: '', command: '' }
    ]);
  });

  it('keeps commas that live inside a command line', () => {
    const rows = parseWinProcessCsv('"5","1","cmd.exe /c echo a,b,c"');
    expect(rows[0]!.command).toBe('cmd.exe /c echo a,b,c');
  });

  it('unescapes a doubled quote', () => {
    const rows = parseWinProcessCsv('"5","1","cmd.exe /c echo ""hi"""');
    expect(rows[0]!.command).toBe('cmd.exe /c echo "hi"');
  });

  it('walks children and grandchildren, roots excluded', () => {
    expect(descendantsOf(parseWinProcessCsv(csv), [900]).map((r) => r.pid)).toEqual([901, 902]);
  });

  it('falls back to the parent walk where no row has a tty', () => {
    expect(paneProcesses(parseWinProcessCsv(csv), [900]).map((r) => r.pid)).toEqual([901, 902]);
  });

  it('terminates on a parent cycle', () => {
    const cyclic = parseWinProcessCsv(['"10","11","a"', '"11","10","b"'].join('\n'));
    expect(descendantsOf(cyclic, [10]).map((r) => r.pid)).toEqual([11]);
  });
});

describe('process labels', () => {
  it('names the script an interpreter is running, not the interpreter', () => {
    expect(describeProcess('node /repo/node_modules/.bin/electron-vite dev')).toBe(
      'electron-vite dev'
    );
    expect(describeProcess('/usr/bin/python3 /srv/app/manage.py runserver')).toBe(
      'manage.py runserver'
    );
  });

  it('leaves a flag-led invocation alone', () => {
    expect(describeProcess('python3 -m http.server 8000')).toBe('python3 -m http.server 8000');
  });

  it('strips the path off a plain binary', () => {
    expect(describeProcess('/opt/homebrew/bin/rg --files')).toBe('rg --files');
    expect(describeProcess('C:\\Program\\node.exe server.js')).toBe('server.js');
  });

  it('truncates a command line that would stretch the dialog', () => {
    const label = describeProcess(`sleep ${'x'.repeat(200)}`, 20);
    expect(label).toHaveLength(20);
    expect(label.endsWith('…')).toBe(true);
  });
});
