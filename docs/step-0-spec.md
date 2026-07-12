# Step 0 spec — Electron skeleton (fresh `cerberus-term` repo)

Repo: `cerberus-term` · Model: **Opus 4.8**
Status: **draft for review — no code until approved**

## Goal

Fresh repo that builds and opens a blank Electron window titled "Cerberus". Sets
the tooling (electron-vite + TS) and the flat layout everything else builds on.

## Why

Every later step (pty pane, tree, buttons, remote control) needs a buildable
Electron shell. This is the smallest thing that proves the toolchain works.

## Decisions

- **Fresh repo, no tmux.** `cerberus-term` replaces the tmux Cerberus. Reusable
  TS is **copied from `mycli` on demand** into `src/core/` in later steps — none
  needed yet.
- **Flat structure, single package** (one app → no monorepo). Everything under
  `src/`.
- **electron-vite** (Vite: TS + HMR for main/preload/renderer, minimal config).
- **pnpm** (matches the other repo).
- **node-pty is a Step 1 concern** — no native modules in Step 0.

## Files to create

```
package.json                 # name "cerberus-term", electron + electron-vite, scripts
electron.vite.config.ts       # main / preload / renderer entries
tsconfig.json
.gitignore                    # node_modules, out, dist
src/main/index.ts             # create BrowserWindow (title "Cerberus"), load renderer
src/preload/index.ts          # empty (contextBridge added in Step 1)
src/renderer/index.html
src/renderer/main.ts          # renders a "Cerberus" placeholder
```

`src/core/` is created later when the first reusable module is copied over.

## Deliverable / verification

- `pnpm install` clean.
- `pnpm dev` (electron-vite) opens a blank window titled **Cerberus** on macOS.
- `pnpm typecheck` (tsc --noEmit) green.
- `pnpm build` produces an unpacked app without error (packaging targets = Step 9).

## Out of scope (explicitly)

pty, xterm.js, panes, splitters, buttons, config editor, Cerberus/Telegram
integration, packaging, cross-platform verification.

## Notes

- Work should continue **from inside the `cerberus-term` repo** (a new session
  rooted there is cleanest). This `mycli` session is for the tmux product.
- The repo's first commit will include these docs + the Step 0 scaffold once
  approved.
