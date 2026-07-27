import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

// Which files `POST /pane` is allowed to open a follower on.
//
// The token from S3 already limits callers to processes running as this user,
// and such a process can read any of these files directly — so this is not a
// confidentiality boundary. What it does buy: the contents never land in a pane
// buffer, which the daemon captures and can push to Telegram, and an
// orchestrator script with a bad path variable can't quietly tail a key file.

// Directories whose contents must never be tailed. All relative to home; each
// is matched as a prefix, so subdirectories are covered too.
const DENIED_UNDER_HOME = [
  '.ssh',
  '.gnupg',
  '.aws',
  '.config',
  '.docker',
  '.kube',
  '.cerberus-term',
  '.claude',
  '.codex',
  'Library/Keychains'
];

export interface FollowRootsOptions {
  home?: string;
  // cwds of the live panes: a project checked out outside home (/Volumes/...,
  // /opt/...) is legitimate, but only while a pane is actually sitting in it.
  paneCwds?: string[];
}

function isUnder(child: string, parent: string): boolean {
  if (child === parent) return true;
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

// Resolve symlinks without requiring the file to exist: an orchestrator asks for
// a follower on a log its worker has not written yet. The parent directory must
// exist, which is enough to stop a symlinked directory from escaping the roots.
function resolveLexicalReal(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    /* not there yet — fall through to the parent */
  }
  try {
    return join(realpathSync(dirname(path)), basename(path));
  } catch {
    return null;
  }
}

export type FollowPathResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'relative' | 'unresolvable' | 'outside_roots' | 'denied_directory' };

export function resolveFollowPath(file: string, opts: FollowRootsOptions = {}): FollowPathResult {
  if (!file || !isAbsolute(file)) return { ok: false, reason: 'relative' };

  const real = resolveLexicalReal(file);
  if (!real) return { ok: false, reason: 'unresolvable' };

  const home = resolve(opts.home ?? homedir());
  for (const denied of DENIED_UNDER_HOME) {
    if (isUnder(real, join(home, denied))) return { ok: false, reason: 'denied_directory' };
  }

  // A dotenv anywhere is off limits: it is the one secret file that routinely
  // sits in the middle of a project tree, right next to the logs.
  if (/^\.env(\..+)?$/.test(basename(real))) return { ok: false, reason: 'denied_directory' };

  const roots = [home, ...(opts.paneCwds ?? []).map((c) => resolveLexicalReal(c)).filter(Boolean)];
  if (!roots.some((root) => isUnder(real, root as string))) {
    return { ok: false, reason: 'outside_roots' };
  }

  return { ok: true, path: real };
}
