# Changelog

All notable changes to Cerberus. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html), and while it's
pre-1.0 minor bumps can still change behaviour.

Installers for each version are on the
[releases page](https://github.com/leodudedev/cerberus-term/releases).

## [Unreleased]

### Added

- Nothing is written to an agent CLI's config until you say so. The first launch
  asks, listing the agents found on this machine, the file each one would edit,
  the events, and the command — then registers only what you tick. Declining is
  recorded, so you're asked once and never again; it also removes any entry of
  ours already sitting in those files, so the answer is true of the disk and not
  just of the settings.
- Copilot CLI hooks are registered automatically, in Copilot's own format and
  under its own events. Previously this was a copy-paste step in the README.
- Settings lists every agent config file the app touches, one line each, with
  its real state — registered, not registered, or skipped because that CLI isn't
  installed here.

### Changed

- An agent is only offered if its config folder already exists. The app no
  longer creates `~/.claude` (or `~/.copilot`) just to put hooks in it, so a
  machine without Claude Code installed stays untouched.
- **Register Claude Code hooks** — one switch over one file — is now a tickbox
  per agent under **Agent CLI hooks**. Unticking one removes our entries from
  that file only and leaves the other agents registered.
- An agent installed *after* Cerberus now appears in Settings unticked instead
  of being wired up on the next launch. Enabling it is a decision, not a side
  effect of installing something else.
- Upgrades keep working without a prompt: an existing on/off setting becomes the
  equivalent per-agent list on first run. The hooks are already in those files,
  so asking after the fact would be theatre. Versions old enough to have no such
  setting are read from the config files themselves — whatever is registered
  there is adopted as-is, including entries added by hand from the README.

### Removed

- `CLAUDE_CONFIG_DIR` no longer decides where hooks are installed. A packaged
  app launched from Finder never sees it, so it only ever fired under
  `pnpm dev` — where it made dev and release builds write to different files.
  The runtime read in `notify.sh` is untouched: session labels still follow the
  config dir of the shell the agent runs in.

## [0.8.0] — 2026-07-28

### Added

- **Register Claude Code hooks** setting. Unchecking it removes the three
  entries Cerberus added to Claude's `settings.json` — and only those — and
  stops re-adding them on the next launch. The Settings pane names the exact
  file it will edit, honouring `CLAUDE_CONFIG_DIR`.

### Changed

- Tab bar past eight tabs. Chips now shrink to a floor before the strip
  scrolls, so a default window fits them all; the scrollbar that used to eat a
  third of the 34px bar is gone (wheel, trackpad and Cmd+1..9 still scroll it,
  and the active chip scrolls itself into view); the edge with hidden tabs
  behind it fades instead of slicing a chip mid-letter; and **+** moved next to
  the Telegram button, where it can no longer scroll out of reach.
- Session labels are derived from `CLAUDE_CONFIG_DIR` instead of a hardcoded
  list: an alias exporting `CLAUDE_CONFIG_DIR=~/.claude-work` now shows up as
  `claude-work`, and the default `~/.claude` as `claude`.
- README spells out what the app writes outside itself: the two paths, the exact
  JSON appended, the backup, and how to opt out.

### Fixed

- **Register Claude Code hooks** now stays unchecked. Saving it off removed the
  hooks correctly, but the flag itself was dropped on write: reopening Settings
  showed the box ticked again, saving a second time did nothing, and the next
  launch put the hooks back.

### Removed

- The two **Launch: claude** / **Launch: copilot** command fields. They were
  stored and read back but never used to spawn anything — panes have always run
  a shell, and you type the agent command in it.

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
