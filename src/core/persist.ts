import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Tiny JSON snapshot so mute-set and session registry survive a restart.
// Best-effort: a missing/corrupt file yields empty state, a failed write only
// logs. The path is set by main at startup (Electron userData); until then it
// falls back to cwd/cerberus-state.json.

let statePath = join(process.cwd(), "cerberus-state.json");

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
    writeFileSync(statePath, JSON.stringify(cur));
  } catch (e) {
    console.error("[persist] write failed:", (e as Error).message);
  }
}
