import { readFileSync } from 'node:fs';

// Minimal .env loader (no dep). Optional dev fallback for the Telegram
// credentials before they're set in-app: point CERBERUS_ENV_FILE at a .env file.
// No default path — credentials normally come from Settings. Never overwrites a
// value already present in the environment.
export function loadEnvFile(): void {
  const path = process.env['CERBERUS_ENV_FILE'];
  if (!path) return;

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
