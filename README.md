# 🐕‍🦺 Cerberus

**GUI terminal multiplexer with remote control.** Split panes with the mouse or
tmux-style keys; when an AI coding session (Claude Code / Copilot CLI) needs you
— a permission prompt, waiting for input — Cerberus pushes a risk-tagged Telegram
notification, and you **approve / deny / prompt** from your phone straight into
the right pane. No tmux: every pane is a native pty we own.

## Download

Grab the installer for your OS from the latest release
(**replace `OWNER/REPO`** with the GitHub repo path):

| OS | File |
|----|------|
| macOS (Apple Silicon) | [`Cerberus-mac-arm64.dmg`](https://github.com/OWNER/REPO/releases/latest/download/Cerberus-mac-arm64.dmg) |
| Windows | [`Cerberus-win-x64.exe`](https://github.com/OWNER/REPO/releases/latest/download/Cerberus-win-x64.exe) |
| Linux (AppImage) | [`Cerberus-linux-x64.AppImage`](https://github.com/OWNER/REPO/releases/latest/download/Cerberus-linux-x64.AppImage) |

Or see all assets on the [releases page](https://github.com/OWNER/REPO/releases/latest).

> Builds aren't code-signed yet: on macOS right-click → **Open** the first time;
> on Windows dismiss the SmartScreen prompt. Signing/notarization is on the list.

## First run

1. Open the app.
2. **Cmd+,** (or menu → **Settings…**) → set your Telegram **bot token** and
   **chat ID**. Restart to start polling.
3. In any pane run `claude` (or `copilot`). Cerberus installs the CLI hooks
   silently on first run; when a session needs you, you get a Telegram push with
   🟢 🟡 🔴 risk and Approve / Deny / prompt buttons that land in that pane.

Per-project overrides live in `.cerberus.json` (edit via the pane's ⚙ gear):
`mute`, `chatId`, `minRisk`, `notifyIdle`.

## Controls

| Action | Mouse / button | Keyboard |
|--------|----------------|----------|
| Split right / down | ◧ / ⬓ in the pane header | `Ctrl+B` then `%` / `"` (or Cmd+D / Cmd+Shift+D) |
| Kill pane | ✕ | `Ctrl+B` then `x` (or Cmd+K) |
| Focus pane | click | `Ctrl+B` then `h/j/k/l` or arrows |
| Resize | drag the divider | `Ctrl+B` then `H/J/K/L` |
| Edit `.cerberus.json` | ⚙ | — |
| Settings | menu → Settings… | `Cmd+,` |
| Toggle theme | menu → View → Toggle Theme | `Cmd+Shift+L` |

The layout, per-pane cwds, and theme are restored on relaunch.

## Development

```bash
pnpm install     # postinstall rebuilds node-pty for the Electron ABI
pnpm dev         # launch the app (HMR)
pnpm typecheck
```

Build installers locally:

```bash
pnpm run dist          # current OS
pnpm run dist:mac      # / dist:win / dist:linux
```

> Use `pnpm run pack`/`dist`, not `pnpm pack`/`dist` — `pack` collides with a
> pnpm builtin.

## Releases

Push a tag to build + publish installers via GitHub Actions:

```bash
git tag v0.1.0 && git push --tags
```

The `build` workflow (`.github/workflows/build.yml`) builds macOS / Windows /
Linux in a matrix and uploads the installers to the GitHub Release.

## Stack

Electron · xterm.js · node-pty · TypeScript · electron-vite · electron-builder ·
grammY (Telegram). Backend sits behind a thin `TerminalBridge` seam so a future
Tauri/Rust swap is a module replacement, not a rewrite.

## License

MIT — see [LICENSE](LICENSE).
