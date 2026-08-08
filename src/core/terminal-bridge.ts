// Backend-agnostic contract between the frontend and whatever runs the pty.
// Electron backs it with IPC -> node-pty; a future Tauri backs it with
// invoke -> portable-pty. The renderer only ever sees this interface.

export interface SpawnOptions {
  /** Shell binary. Defaults per-OS when omitted. */
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
  cols: number;
  rows: number;
}

export interface TerminalBridge {
  /** Spawn a pty, returns its paneId. */
  spawn(opts: SpawnOptions): Promise<string>;
  /** paneIds of ptys that outlived the previous renderer, for session restore. */
  list(): Promise<string[]>;
  /**
   * Re-own a surviving pty and get its raw output tail to replay into the
   * terminal. Null when the pty no longer exists — spawn a fresh one instead.
   */
  attach(paneId: string, cols: number, rows: number): Promise<string | null>;
  /** Kill every unclaimed leftover pty once a restore has settled. */
  reap(keep: string[]): Promise<number>;
  write(paneId: string, data: string): void;
  resize(paneId: string, cols: number, rows: number): void;
  kill(paneId: string): void;
  /** Subscribe to pty output. Returns an unsubscribe fn. */
  onData(paneId: string, cb: (data: string) => void): () => void;
  /** Subscribe to pty exit. Returns an unsubscribe fn. */
  onExit(paneId: string, cb: (code: number) => void): () => void;
  /** Live cwd of a pane's shell (for session-restore snapshots + titles). */
  cwd(paneId: string): Promise<string>;
  /**
   * Live cwds of several panes in one round trip, keyed by paneId. Panes that
   * no longer exist are absent. Preferred over cwd() in a loop: on macOS the
   * lookup forks an lsof, and this pays for one instead of one per pane.
   */
  cwds(paneIds: string[]): Promise<Record<string, string>>;
  /** Absolute path of a dropped File (for drag-and-drop into the pty). */
  pathForFile(file: File): string;
}
