// Programs that must never receive keystrokes routed in from Telegram.
//
// A pane stays targetable long after its agent is gone: `/exit` fires no hook,
// so the registry keeps the session for SESSION_TTL_MS and resolveTarget still
// resolves it. Whatever the user started in that pane next owns the tty by
// then — and a line of chat text typed into an `ssh` or `sudo` password prompt
// is echoed nowhere but lands in the remote host's auth log. SessionEnd closes
// the common case; this list is what catches the rest (kill -9, a crash, a
// session that ended before Cerberus registered the hook).
//
// Deliberately a deny-list, not an allow-list: agents run under too many
// process names to enumerate (node, claude, copilot, python, a wrapper script),
// while the programs that turn a stray line of text into a leaked credential
// are few and well known.
const SENSITIVE_PROCESSES = new Set([
  'ssh',
  'sudo',
  'su',
  'doas',
  'gpg',
  'scp',
  'sftp',
  'mysql',
  'psql',
  'passwd',
  'ftp',
  'telnet'
]);

// node-pty reports the foreground process differently per platform: a bare
// command name on macOS, sometimes a full path or a whole command line
// elsewhere, and a login shell shows up as `-zsh`. Reduce all of that to the
// bare executable name.
export function normalizeProcessName(raw: string): string {
  const first = raw.trim().split(/\s+/)[0] ?? '';
  const base = first.split(/[/\\]/).pop() ?? '';
  return base.replace(/^-/, '').replace(/\.exe$/i, '').toLowerCase();
}

// The offending program's name when the pane is holding one, '' when it is safe
// to type into. Returning the name rather than a boolean is what lets the
// refusal say which program blocked it.
export function sensitiveProcess(raw: string): string {
  const name = normalizeProcessName(raw);
  return SENSITIVE_PROCESSES.has(name) ? name : '';
}

// The first offending program among several candidates, '' when none of them is
// one. Windows can't name a single foreground process the way tcgetpgrp does:
// what's readable there is the set of processes attached to the pane's console,
// and for this guard that set is the better question anyway — if `ssh` is in the
// pane at all, we must not type into it, whoever holds the input focus.
export function firstSensitiveProcess(raws: readonly string[]): string {
  for (const raw of raws) {
    const hit = sensitiveProcess(raw);
    if (hit) return hit;
  }
  return '';
}
