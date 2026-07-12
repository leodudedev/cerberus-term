# Step 1 spec — one pty pane rendering (the spike)

Repo: `cerberus-term` · Model: **Opus 4.8**
Status: **draft review — no code until approved**

## Goal

One `xterm.js` instance wired to one `node-pty` through the `TerminalBridge`
seam (IPC + preload). A real shell runs: input, output, resize all work; ConPTY
path on Windows. Validates the whole stack end to end.

## Why

First contact with native modules (node-pty), IPC, and the frontend/backend
seam. Everything after (pane tree, splitters, remote control) rides on this
exact wiring. Getting `TerminalBridge` right now is what lets a later Tauri swap
be a module replacement, not a rewrite.

## Path correction vs roadmap

Roadmap Step 1 lists `apps/desktop/…` + `packages/core/…` (monorepo-era paths).
**Step 0 locked flat `src/`** — so real paths are:

- `src/core/terminal-bridge.ts` — the interface (backend-agnostic contract)
- `src/main/bridge-electron.ts` — Electron impl (IPC ↔ node-pty)
- `src/preload/index.ts` — contextBridge exposing the bridge to the renderer
- `src/renderer/Terminal.ts` — xterm.js mount + wiring

## The seam

```ts
// src/core/terminal-bridge.ts  (pure types, no electron/node imports)
export interface SpawnOptions {
  shell?: string;         // default per-OS
  cwd?: string;
  env?: Record<string, string>;
  cols: number;
  rows: number;
}
export interface TerminalBridge {
  spawn(opts: SpawnOptions): Promise<string>;        // returns paneId
  write(paneId: string, data: string): void;
  resize(paneId: string, cols: number, rows: number): void;
  kill(paneId: string): void;
  onData(paneId: string, cb: (data: string) => void): () => void; // unsubscribe
  onExit(paneId: string, cb: (code: number) => void): () => void;
}
```

Renderer only ever sees this interface (via `window.cerberus`). Electron backs it
with IPC → node-pty; a future Tauri backs it with invoke → portable-pty.

## Decisions / open items

1. **node-pty native rebuild.** node-pty ships an N-API prebuild but the ABI must
   match Electron's, not system Node. Add `@electron/rebuild`, run it postinstall
   (or `electron-vite`'s recommended flow). node-pty stays in **dependencies**
   and **externalized** from the main bundle (can't bundle a `.node`). — *needs
   confirming it builds against electron 33 on macOS arm64.*
2. **IPC shape.** `spawn/write/resize/kill` = `ipcRenderer.invoke`/`send`;
   pty→renderer data/exit = `webContents.send` on a per-pane channel, bridged in
   preload to the `onData/onExit` callbacks. paneId (uuid) namespaces channels.
3. **Security.** `contextIsolation: true`, `nodeIntegration: false`, `sandbox`
   stays **false** (preload needs Node to reach the main-side bridge via IPC —
   node-pty itself lives in main, never in renderer). Only the typed bridge is
   exposed on `window.cerberus`. CSP gains `'unsafe-inline'` for style (xterm
   injects inline styles) — script stays `'self'`.
4. **Default shell.** macOS/Linux `process.env.SHELL || /bin/zsh`; Windows
   `powershell.exe` via ConPTY (node-pty handles the ConPTY vs winpty choice).
5. **xterm addons.** `@xterm/xterm` + `@xterm/addon-fit`. Fit on mount + on
   window `resize`; `fit()` → `bridge.resize` with new cols/rows.
6. **Single pane only.** No tree, no splits, no header. One full-window terminal.
   paneId plumbing exists (for Step 2) but exactly one is spawned.

## Files touched

```
src/core/terminal-bridge.ts     # NEW — interface + SpawnOptions
src/main/bridge-electron.ts     # NEW — node-pty impl + IPC handlers
src/main/index.ts               # EDIT — register bridge IPC, contextIsolation on
src/preload/index.ts            # EDIT — contextBridge → window.cerberus
src/renderer/Terminal.ts        # NEW — xterm mount, wire to window.cerberus
src/renderer/main.ts            # EDIT — mount Terminal instead of placeholder
src/renderer/index.html         # EDIT — CSP style 'unsafe-inline', xterm css
package.json                    # EDIT — node-pty, @xterm/*, @electron/rebuild
electron.vite.config.ts         # EDIT — externalize node-pty in main
```

## Deliverable / verification

- Type in the window, run `ls` / `claude` → output renders.
- Resize the window → terminal reflows, shell sees new size (`tput cols`).
- `pnpm typecheck` + `pnpm build` green; `pnpm dev` shows a live shell.
- Clean pty teardown on window close (no orphaned shell processes).

## Explicitly out of scope

Pane tree/splits (Step 2), splitters (Step 3), headers (Step 4), config editor
(Step 5), Cerberus core / Telegram (Step 6). Windows verification is best-effort
here (primary dev is macOS); real ConPTY sign-off lands in Step 9 packaging.
