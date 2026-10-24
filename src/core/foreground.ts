// Whether a pane's own shell is back in the foreground of its terminal — the
// agent that was running there is gone, and a line of text sent now would be
// run by the shell. Asked through the terminal's foreground process group
// (tpgid): while an agent runs it owns the group; at the prompt the shell does.
// Parsers only; the reads live in main/bridge-electron.ts.

// Linux: field 8 of /proc/<pid>/stat. The command name (field 2) is wrapped in
// parentheses and may itself contain spaces or parentheses, so count fields
// from the last ')'.
export function tpgidFromProcStat(stat: string): number | null {
  const rest = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
  // state ppid pgrp session tty_nr tpgid
  const tpgid = Number(rest[5]);
  return Number.isInteger(tpgid) && tpgid > 0 ? tpgid : null;
}

// macOS: `ps -o tpgid= -p <pid>`.
export function tpgidFromPs(out: string): number | null {
  const tpgid = Number(out.trim());
  return Number.isInteger(tpgid) && tpgid > 0 ? tpgid : null;
}
