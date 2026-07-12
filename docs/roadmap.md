# Cerberus Multiplexer — implementation roadmap

Repo: `cerberus-term` (fresh). Replaces the tmux Cerberus (`mycli`), which stays
as its own project. Reusable TS core is **copied over** from there, not shared.

## What we're building

Our own **GUI terminal emulator** (desktop app, category Warp/Wave/Hyper) with
Cerberus remote-control baked into the core. Panes split and resize with the
mouse (draggable splitters + per-pane header buttons), tmux-style keybindings as
a secondary method. We own the pty of every pane → no `send-keys`, no
`notify.sh`; keystrokes are injected directly and Windows runs native via ConPTY
(no WSL).

**Stack:** Electron + xterm.js + node-pty, all TypeScript, reusing the existing
Cerberus TS core. Architected behind a thin `TerminalBridge` seam so a later
swap to Tauri/Rust is a module replacement, not a rewrite.

## Model legend (no Fable access)

- **Opus 4.8** — architecture, cross-platform/pty/IPC wiring, Cerberus
  integration, security-sensitive work.
- **Sonnet 5** — standard feature implementation, UI wiring, packaging config.
- **Haiku 4.5** — mechanical/boilerplate, simple mappings, repetitive edits.

Rule of thumb: whoever writes it, **review with Opus** at the end of each step
that Opus didn't drive.

## Cross-cutting decisions (locked / open)

- **Flat structure, single package.** One app → no monorepo. Everything under
  `src/` (main, preload, renderer, core). Reusable modules (classify,
  transcript, registry, mute, project-config, i18n, icon, profile) are **copied
  from the `mycli` repo into `src/core/` on demand**, as steps need them.
- **`TerminalBridge` seam.** Frontend talks to the backend through one thin
  interface: `spawn / write / onData / resize / kill / onExit`. Electron backs
  it with IPC→node-pty; a future Tauri backs it with invoke→portable-pty.
- **Electron needs a bundler** (electron-vite) for the renderer — the repo's
  "no build step" rule does not carry over to the desktop app.
- **DECIDED — permission detection (hybrid, hook-primary).** Detection trigger
  and keystroke injection are separate concerns:
  - **Injection is always native**: `TerminalBridge.write` to the pty (replaces
    `send-keys`).
  - **Detection = CLI hooks for MVP** (reliable, structured: tool + risk +
    transcript; reuses the code built for the tmux version). Stream-parsing the
    pty output is deferred R&D (fragile, version-coupled) for hookless CLIs.
  - Native wins we take now: read the pane buffer directly (no `tmux
    capture-pane`); **inject `CERBERUS_PANE_ID` (and per-pane
    `CLAUDE_CONFIG_DIR`) into each pty's env at spawn** so the hook reports back
    an exact pane↔event correlation; app installs hooks silently on first run.

---

## Steps

### Step 0 — Electron skeleton (flat repo)
Scaffold the fresh `cerberus-term` repo with electron-vite: `src/main` +
`src/preload` + `src/renderer` (TS). Empty window that launches. See
`docs/step-0-spec.md` for the authoritative spec.
- Deliverable: `pnpm dev` opens a blank Cerberus window.
- Files: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `src/*`.
- **Model: Opus 4.8** (tooling + seams set the foundation).

### Step 1 — One pty pane rendering (the spike)
Single xterm.js instance wired to one node-pty through `TerminalBridge` (IPC +
preload). A real shell runs, input/output/resize work, ConPTY on Windows.
Validates the entire stack end to end.
- Deliverable: type in the window, run `claude`/`ls`, see output; resize reflows.
- Files: `apps/desktop/src/main/bridge-electron.ts`, `preload.ts`,
  `renderer/Terminal.ts`, shared `packages/core/terminal-bridge.ts` (interface).
- **Model: Opus 4.8** (first pty/IPC/xterm wiring + cross-platform gotchas).

### Step 2 — Pane tree + split (v/h) + kill
Binary-tree pane model (each node = split direction + ratio + children; leaves =
terminals). Operations: split vertical, split horizontal, kill (with tree
collapse). Nested flex layout renders the tree.
- Deliverable: split/kill from a temporary keypress; layout recomputes correctly.
- Files: `renderer/pane-tree.ts` (model), `renderer/Layout.ts` (render).
- **Model: Opus 4.8** (the tree model + collapse/layout math is the heart).

### Step 3 — Draggable splitters (resize)
Drag the border between panes to change ratios; clamp to minimums; persist
ratios in the tree.
- Deliverable: mouse-drag resize, smooth, ratios survive further splits.
- Files: `renderer/Splitter.ts`, updates to `pane-tree.ts`.
- **Model: Sonnet 5** (standard DnD resize, well-trodden).

### Step 4 — Per-pane header + buttons
Thin header per pane: title left, buttons right — **split-v, split-h, kill**, and
a slightly separated **config** gear. Wire to Step 2/3 operations. Header also
acts as a future drag handle.
- Deliverable: all pane operations driven by clicking header buttons.
- Files: `renderer/PaneHeader.ts`, styles.
- **Model: Sonnet 5** (UI wiring on top of the existing model).

### Step 5 — Config editor button (`.cerberus.json`)
Gear opens/creates the nearest `.cerberus.json` for the pane's cwd in an in-app
editor; save writes it. Reuse the walk-up logic from `packages/core/project-config`.
- Deliverable: edit per-project config without leaving the app.
- Files: `renderer/ConfigEditor.ts`, reuse `packages/core/project-config.ts`.
- **Model: Sonnet 5**.

### Step 6 — Integrate the Cerberus core (remote control)
Run the TS core in the Electron main process. Replace `tmux send-keys` with
direct `TerminalBridge.write`; replace hooks OR keep them (decide the OPEN item).
Telegram push on attention; button/reply → inject into the right pane. Map
sessions to panes natively (we own them now).
- Deliverable: a pane asks permission → Telegram push → approve from phone →
  keystroke lands in that pane. Risk icons intact.
- Files: `apps/desktop/src/main/cerberus.ts` (glue), reuse
  `packages/core/{classify,transcript,registry,mute,bot}.ts`.
- **Model: Opus 4.8** (integration + send-keys→pty rethink + security-sensitive
  keystroke routing).

### Step 7 — Global settings + per-path override UI
Settings screen: Telegram token/chatId, default layout, per-agent launch cmds.
Global config file + `.cerberus.json` override (same precedence model as today).
- Deliverable: configure Telegram entirely in-app; overrides honored.
- Files: `renderer/Settings.ts`, reuse the settings layer concept.
- **Model: Sonnet 5**.

### Step 8 — Keyboard shortcuts (secondary method)
tmux-style keybindings as an alternative to the buttons (split/kill/focus/resize).
- Deliverable: full keyboard control mirroring the buttons.
- Files: `renderer/keymap.ts`.
- **Model: Haiku 4.5** (mechanical key→action mapping over existing ops).

### Step 9 — Packaging & cross-platform
electron-builder targets: macOS (dmg), Windows (nsis, ConPTY verified), Linux
(AppImage/deb). App icon, basic auto-update deferred.
- Deliverable: installable artifacts on all three OSes.
- Files: `apps/desktop/electron-builder.yml`, CI matrix.
- **Model: Sonnet 5** (packaging config; **Opus** if code-signing/notarization
  gets thorny).

### Step 10 — Polish: session restore & theme
Restore the pane layout + cwds on relaunch, pane titles, light/dark theme.
- Deliverable: reopen the app and get your workspace back.
- Files: `renderer/persistence.ts`, theme tokens.
- **Model: Haiku 4.5** (Sonnet for restore edge cases).

---

## MVP cut-line

Steps **0–6** = a usable native multiplexer with mouse-driven panes and working
Telegram remote control. Steps 7–10 make it a polished product.

## Communication rule

Before starting each step: a short written spec (what + why + files touched),
reviewed together, **then** code. No large decisions taken solo.
