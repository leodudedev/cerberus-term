import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

// Shared secret guarding the loopback daemon.
//
// It does NOT try to defend against a hostile process running as this user —
// that process can read the pane's env or the token file anyway, and it could
// already do worse. What it does stop is the one genuinely remote path into a
// 127.0.0.1 server: a web page. Any site the user visits can POST to
// http://127.0.0.1:8898 with `mode: 'no-cors'` and, while it can't read the
// reply, the side effect lands — a forged permission push to the phone whose
// Approve button types into a real pane, or a follower pane opened on an
// arbitrary file. Requiring a custom header forces a CORS preflight the daemon
// never answers, and the page has no way to learn the value regardless.

let token: string | null = null;

export function tokenPath(): string {
  return join(homedir(), '.cerberus-term', 'token');
}

// Minted once per app run. Also written to disk (0600) so an external
// orchestrator script can drive POST /pane without living inside a pane.
export function getDaemonToken(): string {
  if (token) return token;
  token = randomUUID();
  const path = tokenPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, token, { mode: 0o600 });
    chmodSync(path, 0o600); // an existing file keeps its old mode otherwise
  } catch (e) {
    console.error('[cerberus] could not persist daemon token:', (e as Error).message);
  }
  return token;
}
