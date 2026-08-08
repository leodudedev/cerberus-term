// Parser for `lsof -Fpn` field output, used on macOS to read the live cwd of
// several pty shells with a single fork instead of one per pane.
//
// The format is line-oriented and stateful: a `p<pid>` line opens a process
// set, and every following line describes a file belonging to it until the
// next `p`. With `-d cwd` there is exactly one such file per process, so the
// `n<path>` line right after a `p` line is that process's cwd:
//
//   p4711
//   n/Users/leo/dev
//   p4712
//   n/Users/leo
//
// A pid with no readable cwd simply contributes no `n` line and is absent from
// the result — the caller keeps its fallback for those.
export function parseLsofCwds(output: string): Map<number, string> {
  const out = new Map<number, string>();
  let pid: number | null = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) {
      const n = Number(line.slice(1));
      pid = Number.isInteger(n) ? n : null;
    } else if (line.startsWith('n') && pid !== null) {
      // First n line wins: a later one would belong to another fd that `-d cwd`
      // should have excluded anyway.
      if (!out.has(pid)) out.set(pid, line.slice(1));
    }
  }
  return out;
}
