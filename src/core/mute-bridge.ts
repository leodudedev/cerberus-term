// Contract for the global do-not-disturb switch, exposed to the renderer as
// window.cerberusMute. The flag itself lives in main (core/mute.ts) because the
// daemon reads it on every hook event; the renderer only drives the toggle.

export interface MuteBridge {
  getAll(): Promise<boolean>;
  setAll(on: boolean): Promise<boolean>;
  // Whether a bot token + chat id exist at all. Without them nothing pushes,
  // so the toggle has nothing to silence and says so instead of lying.
  configured(): Promise<boolean>;
  // Fired when the flag changes outside this window's own toggle.
  onChange(cb: (active: boolean) => void): void;
}
