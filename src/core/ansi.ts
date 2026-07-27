// Escape-sequence stripping for a captured pane buffer. Lives in core, away from
// the pty plumbing, because it is a security boundary: whatever survives this
// filter is what the permission-dialog heuristics get to read.

// OSC (ESC ] … BEL/ST) and DCS (ESC P … ST) must come FIRST: the trailing
// control-char class would otherwise eat their ESC and BEL and leave the
// payload behind as plain text. That matters — a program can write
// `ESC ]0;1. don't ask again BEL` and land text in the capture buffer that the
// user never sees on screen but the heuristics do read.
// eslint-disable-next-line no-control-regex
export const ANSI_RE =
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1bP[\s\S]*?\x1b\\|\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[()][AB0]|\x1b[<=>]|[\x00-\x08\x0b\x0c\x0e-\x1f]/g;

export function stripAnsi(s: string): string {
  // ANSI_RE is /g and therefore stateful; String.replace resets lastIndex itself,
  // but never share it with a .test() call.
  return s.replace(ANSI_RE, '');
}
