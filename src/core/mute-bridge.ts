// Contract for the global do-not-disturb switch, exposed to the renderer as
// window.cerberusMute. The flag itself lives in main (core/mute.ts) because the
// daemon reads it on every hook event; the renderer only drives the toggle.

// Health of the Telegram long poll. 'off' is a working state — no credentials,
// or a deliberate stop; 'error' is the one worth showing, because every other
// symptom of it is silence.
export type BotState = 'off' | 'starting' | 'online' | 'error';

export interface BotStatus {
  state: BotState;
  reason?: string;
}

export interface MuteBridge {
  getAll(): Promise<boolean>;
  setAll(on: boolean): Promise<boolean>;
  // Whether a bot token + chat id exist at all. Without them nothing pushes,
  // so the toggle has nothing to silence and says so instead of lying.
  configured(): Promise<boolean>;
  // Fired when the flag changes outside this window's own toggle.
  onChange(cb: (active: boolean) => void): void;
  // Poller health, for the same button: a dead poller has no other symptom than
  // a phone that stops ringing while the panes carry on. Pulled once on mount
  // (a reload would miss every push sent before it) and pushed on every change.
  botStatus(): Promise<BotStatus>;
  onBotStatus(cb: (s: BotStatus) => void): void;
}
