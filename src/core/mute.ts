import { loadState, saveState } from "./persist.js";

// Runtime mute-set, keyed by project cwd. Complements the static .cerberus.json
// mute: this one is toggled live (e.g. from Telegram) and supports a TTL.
// Snapshotted to state.json so it survives a daemon restart.

const muted = new Map<string, number>(); // cwd -> expiry epoch ms (Infinity = forever)

// Restore snapshot (null = forever).
for (const [cwd, until] of Object.entries(loadState().muted ?? {}))
  muted.set(cwd, until === null ? Infinity : until);

function persist(): void {
  const out: Record<string, number | null> = {};
  for (const [cwd, until] of muted) out[cwd] = until === Infinity ? null : until;
  saveState({ muted: out });
}

// Global do-not-disturb. One switch that silences every project's Telegram
// push, orthogonal to the per-project mute set above: flipping it off restores
// exactly the mutes that were there before. Meant for "I'm at the keyboard" —
// the local pane flash is unaffected, only the phone goes quiet.
let mutedAll = loadState().muteAll === true;

type MuteAllListener = (active: boolean) => void;
const allListeners = new Set<MuteAllListener>();

// Lets main mirror a flip back to the renderer, so the UI toggle stays in sync
// when the flag is changed from somewhere else.
export function onMuteAllChange(cb: MuteAllListener): () => void {
  allListeners.add(cb);
  return () => void allListeners.delete(cb);
}

export function isMutedAll(): boolean {
  return mutedAll;
}

export function setMutedAll(on: boolean): boolean {
  if (mutedAll === on) return mutedAll;
  mutedAll = on;
  saveState({ muteAll: on });
  for (const cb of allListeners) cb(on);
  return mutedAll;
}

export function mute(cwd: string, ttlMs?: number): void {
  muted.set(cwd, ttlMs && ttlMs > 0 ? Date.now() + ttlMs : Infinity);
  persist();
}

export function unmute(cwd: string): boolean {
  const removed = muted.delete(cwd);
  if (removed) persist();
  return removed;
}

// A cwd is muted if the global switch is on, or it matches a muted entry or
// sits under one.
export function isMuted(cwd: string): boolean {
  if (mutedAll) return true;
  const now = Date.now();
  for (const [dir, until] of muted) {
    if (until <= now) {
      muted.delete(dir);
      continue;
    }
    if (cwd === dir || cwd.startsWith(dir + "/")) return true;
  }
  return false;
}

export function listMuted(): { cwd: string; until: number }[] {
  const now = Date.now();
  const out: { cwd: string; until: number }[] = [];
  for (const [cwd, until] of muted) {
    if (until <= now) muted.delete(cwd);
    else out.push({ cwd, until });
  }
  return out;
}

// Parse a duration like "90s", "30m", "2h", "1d". Returns ms, or null if invalid.
export function parseDuration(s: string): number | null {
  const m = /^(\d+)\s*([smhd])$/.exec(s.trim().toLowerCase());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2] as "s" | "m" | "h" | "d"];
  return n * unit;
}
