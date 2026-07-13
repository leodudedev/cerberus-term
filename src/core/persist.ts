import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

// Tiny JSON snapshot so mute-set and the Telegram session registry survive a
// restart. Best-effort: a missing/corrupt file yields empty state, a failed
// write only logs.
//
// The path is resolved WITHOUT electron and is stable, so registry.ts / mute.ts
// (which seed their maps at import time, before main can call anything) read the
// same file that later writes go to. setStatePath can still override it.

let statePath = join(homedir(), ".cerberus-term", "cerberus-state.json");

export function setStatePath(path: string): void {
  statePath = path;
}

export interface PersistedState {
  muted?: Record<string, number | null>; // cwd -> expiry epoch ms, null = forever
  sessions?: Record<string, unknown>; // sessionId -> SessionInfo
}

export function loadState(): PersistedState {
  try {
    return JSON.parse(readFileSync(statePath, "utf8")) as PersistedState;
  } catch {
    return {};
  }
}

// Read-modify-write so the two writers (mute, registry) don't clobber each
// other's slice of the state.
export function saveState(patch: Partial<PersistedState>): void {
  const cur = loadState();
  Object.assign(cur, patch);
  try {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify(cur));
  } catch (e) {
    console.error("[persist] write failed:", (e as Error).message);
  }
}
