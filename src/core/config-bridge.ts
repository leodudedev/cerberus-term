// Contract for the in-app `.cerberus.json` editor, exposed to the renderer as
// window.cerberusConfig. Separate from TerminalBridge (terminal-only).

export interface ConfigTarget {
  path: string;
  exists: boolean;
  content: string; // existing file text, or a starter template when !exists
}

export type SaveResult = { ok: true } | { ok: false; error: string };

export interface ConfigBridge {
  resolve(paneId: string): Promise<ConfigTarget>;
  save(path: string, content: string): Promise<SaveResult>;
}
