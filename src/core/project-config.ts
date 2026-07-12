import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

// Copied from mycli/src/project-config.ts, adapted: Risk is inlined here so this
// module stays self-contained until classify.ts is copied in Step 6.
// Per-project overrides in `.cerberus.json` at (or above) the pane cwd.

type Risk = 'safe' | 'caution' | 'danger';

export interface ProjectConfig {
  mute?: boolean;
  chatId?: string;
  minRisk?: Risk;
  notifyIdle?: boolean; // false = skip "waiting for input" notifications
}

const FILENAME = '.cerberus.json';
const cache = new Map<string, { mtimeMs: number; cfg: ProjectConfig }>();

// Walk up from cwd to $HOME looking for the nearest config file.
export function findConfigFile(startDir: string): string | null {
  const stop = homedir();
  let dir = startDir;
  while (true) {
    const p = join(dir, FILENAME);
    try {
      if (statSync(p).isFile()) return p;
    } catch {
      // not here, keep walking
    }
    const parent = dirname(dir);
    if (dir === stop || parent === dir) break; // reached home boundary or fs root
    dir = parent;
  }
  return null;
}

// The path the editor should open/write: the nearest existing config, or a new
// `.cerberus.json` in the given cwd.
export function resolveConfigTarget(cwd: string): { path: string; exists: boolean } {
  const existing = cwd ? findConfigFile(cwd) : null;
  if (existing) return { path: existing, exists: true };
  return { path: join(cwd || homedir(), FILENAME), exists: false };
}

export function readProjectConfig(cwd: string): ProjectConfig {
  if (!cwd) return {};
  const file = findConfigFile(cwd);
  if (!file) return {};

  try {
    const { mtimeMs } = statSync(file);
    const hit = cache.get(file);
    if (hit && hit.mtimeMs === mtimeMs) return hit.cfg;

    const parsed = JSON.parse(readFileSync(file, 'utf8')) as ProjectConfig;
    const cfg: ProjectConfig = {
      mute: parsed.mute === true,
      chatId: typeof parsed.chatId === 'string' ? parsed.chatId : undefined,
      minRisk: (['safe', 'caution', 'danger'] as const).includes(parsed.minRisk as Risk)
        ? parsed.minRisk
        : undefined,
      notifyIdle: parsed.notifyIdle === false ? false : undefined
    };
    cache.set(file, { mtimeMs, cfg });
    return cfg;
  } catch (e) {
    console.error(`[project-config] ${file} unreadable:`, (e as Error).message);
    return {};
  }
}
