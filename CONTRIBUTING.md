# Contributing to Cerberus

Thanks for taking a look. Bug reports, platform fixes, and hooks for other AI
CLIs are all welcome — this started as a personal tool and it shows in the
places it hasn't been run yet.

## Before you start

For anything larger than a bug fix, open an issue first and say what you have in
mind. It's cheaper to disagree about an approach in a paragraph than in a diff.

Especially useful right now:

- **Windows and Linux quirks.** Most development happens on macOS. ConPTY,
  AppImage packaging, and the bash-based hooks are the thin spots.
- **Hooks for other CLIs.** The notification path is generic; adding an agent is
  a hook script, a parser for its permission prompt, and a row in
  `src/core/hook-targets.ts` describing where its config lives and what shape
  its hook entries take. The consent dialog, the Settings tickboxes and the
  install/uninstall are all driven off that table.
- **Bug reports** with the OS, the app version, and what the pane was running.

## Setup

Requirements: **Node ≥22**, **pnpm 10**, and a C toolchain (`node-pty` is
compiled against the Electron ABI by the `postinstall`).

```bash
git clone https://github.com/leodudedev/cerberus-term.git
cd cerberus-term
pnpm install     # postinstall rebuilds node-pty
pnpm dev         # launch with HMR
```

Before pushing:

```bash
pnpm typecheck
pnpm test
```

Both run in CI (`.github/workflows/ci.yml`) along with a full
`electron-vite build`, on every push and pull request.

To check a packaged build:

```bash
pnpm run pack          # unpacked app in dist/
pnpm run dist          # installer for the current OS
```

Use `pnpm run pack`/`dist`, not `pnpm pack`/`dist` — `pack` collides with a pnpm
builtin.

## Layout

```
src/main/        Electron main process — ptys, menus, IPC, settings
src/main/cerberus/   daemon, Telegram bot, hook installation
src/renderer/    xterm panes, pane tree, tab bar, overlays
src/core/        Electron-free logic: risk, mute, project config, i18n
src/preload/     the contextBridge surface
tests/           vitest, over src/core + the pure renderer modules
examples/        orchestration walkthrough + a runnable driver script
```

`src/core` is deliberately free of Electron imports so it can be unit-tested in
plain Node. New pure logic belongs there; that's also where a test is expected.

`docs/` is gitignored — local working notes, not part of the repo.

## Code conventions

- **TypeScript, `strict: true`.** No `any` unless there's a comment saying why.
- **Comments explain _why_, not _what_.** The codebase leans on short prose
  above a function to record the constraint that shaped it — the failure mode it
  avoids, the platform quirk it works around. Match that, and skip comments that
  restate the line below.
- `camelCase` for values, `PascalCase` for types and classes,
  `UPPER_SNAKE_CASE` for constants, `kebab-case` for filenames.
- No formatter is enforced; follow the surrounding file (2-space indent, single
  quotes in the renderer, double in `src/main/cerberus`).

## Tests

`tests/` covers the Electron-free logic — risk classification, escape-sequence
stripping, permission-dialog parsing, the pane tree, workspace snapshot
migrations. A change to any of those should come with a test. UI and pty
behaviour is not covered; say in the PR how you verified it by hand.

## Commits and pull requests

Commits follow [Conventional Commits](https://www.conventionalcommits.org) with
a scope, and the subject reads as a sentence about behaviour rather than a
mechanical summary:

```
feat(search): find bar over the pane scrollback
fix(security): confine follower paths and the project-config walk
fix(menu): keep Reload out of the production menu — Ctrl+R is reverse-i-search
```

Scopes in use: `main`, `renderer`, `cerberus`, `security`, `search`, `mute`,
`tabs`, `menu`, `win`, `macos`, `build`, `ci`, `docs`, `test`, `chore`.

For the PR itself: one topic per PR, describe what changes for the user, and
note which OS you tested on. `CHANGELOG.md` is maintained at release time — you
don't need to touch it.

## Security

Don't open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md)
for how to report one privately.

## Maintainers: releasing

1. Bump `version` in `package.json`, update `CHANGELOG.md`, commit as
   `chore: release vX.Y.Z`.
2. Tag and push:
   ```bash
   git tag v0.7.0 && git push --tags
   ```
3. `.github/workflows/build.yml` builds macOS / Windows / Linux in a matrix and
   publishes the installers to a GitHub Release.

The tag must match the `package.json` version — electron-builder names the
artifacts from it, and the download links in the README point at
`releases/latest`.
