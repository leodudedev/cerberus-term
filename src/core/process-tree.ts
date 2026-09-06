// Who is still running inside a pane, beyond the shell itself.
//
// Killing a pty kills the shell and, through the tty hangup, its foreground
// process group. What survives is everything detached from it: a `nohup`ed
// command, a background job that was `disown`ed, a dev server left running on
// purpose. Those are the processes worth asking about before the app quits,
// and they're invisible to node-pty — it only knows the shell.
//
// Two things tie a process to a pane, and both are read BEFORE the shells die:
//
//   - the parent chain down from the shell, which is what an orphan loses the
//     moment its own parent exits (it reparents to launchd/init);
//   - the controlling terminal, which an orphan keeps — the pane's pts is still
//     its tty long after whatever started it is gone.
//
// The union of the two is the answer. Session ids would be the single clean
// question to ask, but macOS `ps` reports the session column as 0 for every
// process, so they aren't available where this is most needed.
//
// Nothing here catches a real daemon — double-forked, `setsid`, its own session
// from the start. That's by design: a process that went to those lengths to
// outlive its terminal is not the terminal's to kill.

export interface ProcRow {
  pid: number;
  ppid: number;
  /** Controlling terminal, e.g. `ttys004`. '' when there is none, and on Windows. */
  tty: string;
  /** Full command line, as reported by ps / Win32_Process. */
  command: string;
}

/**
 * Parse `ps -Ao pid=,ppid=,tty=,command=`. ps writes `??` (macOS) or `?`
 * (Linux) for a process with no controlling terminal; both normalise to ''.
 * Malformed lines are dropped rather than thrown on: this runs on the quit
 * path, where a partial answer beats none.
 */
export function parsePsTable(output: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of output.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S.*)$/.exec(line);
    if (!m) continue;
    const tty = m[3]!;
    rows.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      tty: tty === '?' || tty === '??' || tty === '-' ? '' : tty,
      command: m[4]!.trim()
    });
  }
  return rows;
}

/**
 * Parse the CSV of
 * `Get-CimInstance Win32_Process | Select ProcessId,ParentProcessId,CommandLine`
 * piped through `ConvertTo-Csv -NoTypeInformation`: a header line, then one
 * quoted record per process. CommandLine is empty for processes we can't read.
 */
export function parseWinProcessCsv(output: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of output.split('\n')) {
    const fields = splitCsvLine(line.trim());
    if (fields.length < 3) continue;
    const pid = Number(fields[0]);
    const ppid = Number(fields[1]);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue; // header row
    rows.push({ pid, ppid, tty: '', command: fields[2]!.trim() });
  }
  return rows;
}

// Minimal CSV reader for the shape PowerShell emits: every field quoted, a
// doubled quote for a literal one. A command line can contain commas, so
// splitting on them isn't an option.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * Every descendant of the given roots, roots excluded. Breadth-first, so a
 * grandchild is reached through a parent that's still listed even if it has
 * already exited.
 */
export function descendantsOf(rows: readonly ProcRow[], roots: readonly number[]): ProcRow[] {
  const byParent = new Map<number, ProcRow[]>();
  for (const r of rows) {
    const siblings = byParent.get(r.ppid);
    if (siblings) siblings.push(r);
    else byParent.set(r.ppid, [r]);
  }

  const seen = new Set<number>(roots);
  const out: ProcRow[] = [];
  const queue = [...roots];
  while (queue.length > 0) {
    for (const child of byParent.get(queue.shift()!) ?? []) {
      if (seen.has(child.pid)) continue; // a pid cycle would otherwise spin here
      seen.add(child.pid);
      out.push(child);
      queue.push(child.pid);
    }
  }
  return out;
}

/**
 * Everything the panes are responsible for: descendants of the shells, plus
 * anything sharing a pane's controlling terminal (the shells themselves
 * excluded). The tty half is what keeps an orphan — a `nohup`ed job whose
 * launching shell has already exited — from disappearing off the list.
 *
 * On Windows no row carries a tty, so this reduces to the parent walk.
 */
export function paneProcesses(rows: readonly ProcRow[], shellPids: readonly number[]): ProcRow[] {
  const shells = new Set(shellPids);
  const ttys = new Set(
    rows.filter((r) => shells.has(r.pid) && r.tty !== '').map((r) => r.tty)
  );

  const found = descendantsOf(rows, shellPids);
  const seen = new Set(found.map((r) => r.pid));
  for (const r of rows) {
    if (shells.has(r.pid) || seen.has(r.pid)) continue;
    if (r.tty !== '' && ttys.has(r.tty)) found.push(r);
  }
  return found;
}

/**
 * One label per stray, for the dialog. Collapses the interpreter noise that
 * makes every Node process look alike — `node /very/long/.pnpm/…/vite.js dev`
 * reads as `vite.js dev` — and caps the length so a pathological command line
 * can't stretch the dialog off screen.
 */
export function describeProcess(command: string, maxLength = 60): string {
  const parts = command.trim().split(/\s+/);
  const bin = (parts[0] ?? '').split(/[/\\]/).pop() ?? '';
  const rest = parts.slice(1);
  let words = [bin, ...rest];

  // An interpreter's first argument is a script path: that script is the
  // program anyone would name, not the interpreter running it. A leading flag
  // (`python -m http.server`) isn't a script, so that form is left intact.
  if (/^(node|python[\d.]*|ruby|perl|deno|bun|php)(\.exe)?$/i.test(bin) && rest.length > 0) {
    const script = (rest[0] ?? '').split(/[/\\]/).pop() ?? '';
    if (script && !script.startsWith('-')) words = [script, ...rest.slice(1)];
  }

  const label = words.join(' ').trim() || command.trim();
  return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label;
}
