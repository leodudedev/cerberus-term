# Step 10 spec — polish: session restore & theme

Repo: `cerberus-term` · Model: **Haiku 4.5** (Sonnet for restore edge cases)
Status: **draft review — no code until approved**

## Goal

Reopen the app and get the workspace back: pane layout + each pane's cwd,
pane titles (cwd basename), and a light/dark theme.

## Session restore (renderer-local)

The pane tree is already a plain serializable `PaneNode`. Persist it + a per-leaf
cwd map to `localStorage` (no IPC/file needed for layout).

- `src/renderer/persistence.ts`: `saveLayout(tree, cwds)`, `loadLayout()`,
  `clearLayout()` over `localStorage['cerberus.layout']`.
- Boot: `loadLayout()` → `root = saved.tree ?? newLeaf()`; the saved cwd map is
  handed to `Layout` so each restored leaf spawns in its cwd.
- `TerminalBridge` gains `cwd(paneId)` (IPC → `getPaneCwd`). `Layout.snapshotCwds()`
  awaits each leaf's paneId → cwd, and doubles as the **title updater** (sets the
  header `.pane-title` to the cwd basename).
- `createTerminalPane(el, cwd?)` passes cwd to `spawn`. `bridge-electron` spawn
  falls back to `$HOME` if the requested cwd no longer exists.
- Persistence cadence: debounced save after structural changes (split/kill/
  resize) + a periodic snapshot (~4s) that refreshes cwds/titles and saves.

## Theme (light/dark)

- `src/renderer/themes.ts`: `ThemePref = 'system'|'light'|'dark'`, resolve via
  `matchMedia`, `xtermTheme(theme)` (bg/fg/cursor), `getPref/setPref`
  (localStorage), `applyPref()` sets `<html data-theme>` and dispatches
  `theme-change`.
- `index.html`: CSS custom properties for both palettes (`--bg/--panel/--text/
  --muted/--border/--accent/--header-bg/--header-focus/--splitter`); default
  dark, `[data-theme="light"]` overrides, `prefers-color-scheme` for `system`.
  Existing hardcoded colors switch to the vars.
- `Terminal.ts`: initial `xtermTheme(resolve(pref))`; on `theme-change` update
  `term.options.theme` live; unhook on dispose.
- Toggle: native menu **View → Toggle Theme** → `cerberus:toggle-theme` →
  renderer cycles dark/light and persists.

## Files touched

```
src/renderer/persistence.ts   # NEW — localStorage layout store
src/renderer/themes.ts        # NEW — theme tokens + xterm palette
src/renderer/Terminal.ts      # EDIT — cwd param, theme wiring
src/renderer/Layout.ts        # EDIT — cwdFor, snapshotCwds + title update
src/renderer/main.ts          # EDIT — load/save layout, theme init, toggle
src/renderer/index.html       # EDIT — CSS vars for both themes
src/main/bridge-electron.ts   # EDIT — cwd() ipc, spawn cwd existence guard
src/main/index.ts             # EDIT — menu Toggle Theme
src/preload/index.ts          # EDIT — pty:cwd, onToggleTheme
src/renderer/cerberus.d.ts    # EDIT — cwd(), onToggleTheme types
```

No new deps.

## Deliverable / verification

- Split a few panes, `cd` around, quit, relaunch → same layout, panes back in
  their cwds, titles show the folder names.
- A stale cwd falls back to `$HOME` (no spawn crash).
- Toggle Theme flips DOM + xterm colors live and survives relaunch.
- persistence save/load + theme resolve covered by assertions; typecheck + build
  green; restore + theme exercised by hand.

## Explicitly out of scope

Restoring scrollback/process state (only cwd), the Telegram registry restore
follow-up (separate from pane layout), per-pane manual titles, syncing theme to
the global settings file (localStorage is enough here).
```
