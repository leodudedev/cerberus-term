// OSC 7 ("report current directory") as emitted by the PowerShell shell
// integration in bridge-electron: `ESC ]7;file://HOST/seg%20ment/... BEL`.
// Windows has no /proc/pid/cwd and no lsof, so a pane there learns its live
// cwd only because the shell keeps announcing it.
//
// The host part is ignored: it's whatever $env:COMPUTERNAME says, and the
// sequence never leaves this machine anyway. Path segments are percent-encoded
// one by one (the `/` separators are not), so decoding is per-segment too.
const OSC7_RE = /\x1b\]7;file:\/\/[^/\x07\x1b]*\/([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

// Last OSC 7 in the chunk wins: a burst of redraws only needs the freshest cwd.
// Returns undefined when the chunk carries none, which is the common case —
// the caller keeps whatever it already had.
export function extractOsc7Cwd(data: string): string | undefined {
  let m: RegExpExecArray | null;
  let last: string | undefined;
  OSC7_RE.lastIndex = 0;
  while ((m = OSC7_RE.exec(data))) last = m[1];
  if (last === undefined) return undefined;
  return last
    .split('/')
    .map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        // Malformed escape (a literal `%` the shell didn't encode): keep the
        // raw segment rather than losing the whole path.
        return seg;
      }
    })
    .join('\\');
}
