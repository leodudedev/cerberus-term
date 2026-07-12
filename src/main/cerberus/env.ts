import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Minimal .env loader (no dep). For dev we reuse the tmux mycli .env for the
// Telegram credentials; CERBERUS_ENV_FILE overrides the path. Never overwrites a
// value already present in the environment.
export function loadEnvFile(): void {
  const path =
    process.env['CERBERUS_ENV_FILE'] ??
    join(homedir(), 'Documents', 'leo', 'dev', 'mycli', '.env');

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return; // no file — rely on the ambient environment
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}
