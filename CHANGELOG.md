# Changelog

All notable changes to Cerberus. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html), and while it's
pre-1.0 minor bumps can still change behaviour.

Installers for each version are on the
[releases page](https://github.com/leodudedev/cerberus-term/releases).

## [Unreleased]

### Added

- **Register Claude Code hooks** setting. Unchecking it removes the three
  entries Cerberus added to Claude's `settings.json` — and only those — and
  stops re-adding them on the next launch. The Settings pane names the exact
  file it will edit, honouring `CLAUDE_CONFIG_DIR`.

### Changed

- Session labels are derived from `CLAUDE_CONFIG_DIR` instead of a hardcoded
  list: an alias exporting `CLAUDE_CONFIG_DIR=~/.claude-work` now shows up as
  `claude-work`, and the default `~/.claude` as `claude`.
- README spells out what the app writes outside itself: the two paths, the exact
  JSON appended, the backup, and how to opt out.

## [0.7.0] — 2026-07-28

### Added

- Global do-not-disturb toggle in the tab bar: one click silences Telegram
  pushes for every session, one more restores them all. Independent of the
  per-project `mute` and of `/mute` from the chat, and it survives a restart.
- The toggle reads as Telegram (paper plane, crossed out when muted) and opens a
  confirm dialog spelling out what changes — and what doesn't.

### Fixed

- The toggle no longer promises silence it isn't causing: without a bot token
  and chat ID it stays visible but dimmed and inert, and explains why. It wakes
  up as soon as credentials are saved, no restart needed.

## [0.6.0] — 2026-07-27

### Added

- Find bar over the pane scrollback (`Cmd+F` / `Ctrl+Shift+F`) with
  case-sensitivity and regex toggles.
- Surviving ptys reattach after a renderer restart, so `Cmd+R` no longer costs
  you your sessions — and is enabled again.
- `POST /event` and `POST /pane` are token-gated, and requests carrying an
  `Origin` header are rejected — closing the one genuinely remote path into a
  loopback daemon.
- First vitest suite over the Electron-free logic, running in CI.

### Fixed

- App secrets are kept out of the pane environment, renderer navigation is
  pinned, and OSC sequences are stripped from terminal output.
- Follower paths and the project-config walk are confined to safe roots.
- Copy/paste routes to the focused terminal instead of the shell's own keys.
- Reload stays out of the production menu — `Ctrl+R` is the shell's
  reverse-i-search.
- Local mac builds no longer fail on update-info.

## [0.5.0] — 2026-07-22

### Added

- Panes and their tab chip flash when a session asks for a permission, so you
  can find the one waiting on you without reading four scrollbacks.

## [0.4.0] — 2026-07-22

### Added

- Tab system with close confirmation, truecolor, and a login shell.
- Pane favorites: star a pane's cwd, jump back to it from any pane.
- Splits inherit the focused pane's cwd.

### Changed

- Renderer moved to WebGL.

## [0.3.5] — 2026-07-19

### Changed

- Approving from the phone now reacts 👍 on the original request instead of
  posting a separate completion message.

## [0.3.4] — 2026-07-19

### Changed

- Buttons retire when a prompt is approved locally, and the completion feed is
  slimmer.

## [0.3.3] — 2026-07-19

### Added

- Drag and drop files onto a pane to type their paths.
- `Shift+Enter` inserts a newline instead of submitting.

## [0.3.2] — 2026-07-19

### Fixed

- Dark-by-default theme with a full ANSI palette, so TUIs stay readable.

## [0.3.1] — 2026-07-16

### Fixed

- Hooks register at a stable path outside the app bundle, so they survive an
  app update.
- Windows: bash hook installation is skipped; `POST /pane` is rejected.
- macOS: ptys are killed when the window closes; zoom keys are blocked only
  there.
- The Telegram language setting applies without a restart of the language layer.
- Atomic writes for state, settings, and the Claude hook file.
- Daemon request bodies are capped at 4 MB.
- The "always allow" probe is scoped to the dialog's options block.
- `os.homedir()` is the spawn cwd fallback.
- File menu with About/Quit on Windows and Linux.

### Added

- CI: typecheck and build on every push and pull request.

## [0.3.0] — 2026-07-15

### Added

- Brand assets: README logo and a custom app icon.

### Fixed

- The `claude-stream` follower ships its jq program as an ASCII resource, fixing
  mojibake.

## [0.2.0] — 2026-07-14

### Added

- `POST /pane` accepts `format: "claude-stream"` — a readable projection of
  Claude Code's stream-json instead of a raw `tail -f`.

## [0.1.0] — 2026-07-14

Initial public release.

### Added

- Native pane multiplexing with no tmux: split, kill, resize, and focus with the
  mouse or a tmux-style `Ctrl+B` leader.
- Telegram remote control — permission prompts pushed to your phone with
  🟢 🟡 🔴 risk tags and Approve / Always / Deny buttons that land in the right
  pane; free text is forwarded as a prompt.
- Completion feed for remotely approved tools, on Claude Code and Copilot CLI.
- Per-project `.cerberus.json` overrides (`mute`, `chatId`, `minRisk`,
  `notifyIdle`) with an in-app editor.
- Global settings UI with per-path overrides.
- `POST /pane` opens read-only follower panes that auto-tile into a grid.
- Session restore, pane titles, and a light/dark theme.
- Cross-platform packaging for macOS, Windows, and Linux.
