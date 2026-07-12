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
  write(paneId: string, data: string): void;
  resize(paneId: string, cols: number, rows: number): void;
  kill(paneId: string): void;
  /** Subscribe to pty output. Returns an unsubscribe fn. */
  onData(paneId: string, cb: (data: string) => void): () => void;
  /** Subscribe to pty exit. Returns an unsubscribe fn. */
  onExit(paneId: string, cb: (code: number) => void): () => void;
}
