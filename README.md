<div align="center">

# 🐕‍🦺 Cerberus

**A GUI terminal multiplexer with remote control** — split panes with the mouse or tmux-style keys, and approve, deny, or prompt Claude Code &amp; GitHub Copilot CLI from your phone, over Telegram, straight into the right pane.

<sub>native panes · no tmux · permission prompts · risk-tagged commands · multi-account · session restore · light/dark</sub>

![CI](https://img.shields.io/github/actions/workflow/status/leodudedev/cerberus-term/build.yml?label=build&logo=github)
![Electron](https://img.shields.io/badge/Electron-2C2E3B?logo=electron&logoColor=9FEAF9)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Node.js ≥22](https://img.shields.io/badge/Node.js-%E2%89%A522-5FA04E?logo=nodedotjs&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-F69220?logo=pnpm&logoColor=white)
![Telegram](https://img.shields.io/badge/Telegram-26A5E4?logo=telegram&logoColor=white)
![xterm.js](https://img.shields.io/badge/xterm.js-2E2E2E?logo=gnometerminal&logoColor=white)
![license MIT](https://img.shields.io/badge/license-MIT-blue)

[Download](#download) · [First run](#first-run) · [Controls](#controls) · [Config](#per-project-config) · [Development](#development)

</div>

> Your company won't enable remote control? No problem — Cerberus is your
> three-headed guard dog, and it works the night shift for free. 🐕‍🦺

Run your AI coding sessions in native panes — no tmux, every pane is a pty
Cerberus owns. When a session needs you — a permission prompt, waiting for input
— it pushes a Telegram notification. From your phone you **approve / deny**, or
**type a prompt** that lands in the right pane. Every pending command is tagged
with a risk icon 🟢 🟡 🔴 so you know what you're approving. Approve something
remotely and the result is pushed back to you.

```mermaid
flowchart LR
    subgraph app["Cerberus (Electron)"]
        A["pane · claude<br/>└ notify.sh"]
        B["pane · copilot<br/>└ copilot-notify.sh"]
        D["daemon 127.0.0.1:8898<br/>enrich + push"]
        A --> D
        B --> D
    end
    subgraph tg["Telegram"]
        T["🔔 + 🟢🟡🔴<br/>approve · deny · reply"]
    end
    D -->|push| T
    T -->|"keystroke / prompt"| A
```

## Download

Grab the installer for your OS from the latest release:

| OS | File |
|----|------|
| macOS (Apple Silicon) | [`Cerberus-mac-arm64.dmg`](https://github.com/leodudedev/cerberus-term/releases/latest/download/Cerberus-mac-arm64.dmg) |
| Windows | [`Cerberus-win-x64.exe`](https://github.com/leodudedev/cerberus-term/releases/latest/download/Cerberus-win-x64.exe) |
| Linux (AppImage) | [`Cerberus-linux-x86_64.AppImage`](https://github.com/leodudedev/cerberus-term/releases/latest/download/Cerberus-linux-x86_64.AppImage) |

Or see all assets on the [releases page](https://github.com/leodudedev/cerberus-term/releases/latest).

> Builds aren't code-signed yet: on macOS right-click → **Open** the first time;
> on Windows dismiss the SmartScreen prompt. Signing/notarization is on the list.

## First run

1. Open the app.
2. **Cmd+,** (or menu → **Settings…**) → set your Telegram **bot token** and
   **chat ID**. Restart to start polling.
3. In any pane run `claude` (or `copilot`). Cerberus installs the CLI hooks
   silently on first run; when a session needs you, you get a Telegram push with
   🟢 🟡 🔴 risk and Approve / Deny / prompt buttons that land in that pane.

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

## Per-project config

Drop a `.cerberus.json` in a project (edit it via the pane's ⚙ gear) to override
the global settings for sessions running there:

| Key | Meaning |
|-----|---------|
| `mute` | silence notifications for this project |
| `chatId` | route its pushes to a different Telegram chat |
| `minRisk` | only notify at/above this risk (`safe` \| `caution` \| `danger`) |
| `notifyIdle` | also notify on waiting-for-input, not just permissions |

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

### Releases

Push a tag and GitHub Actions builds + publishes the installers to a Release:

```bash
git tag v0.1.0 && git push --tags
```

The `build` workflow (`.github/workflows/build.yml`) builds macOS / Windows /
Linux in a matrix.

## Security

The daemon binds **loopback only** (`127.0.0.1`). Telegram callbacks are checked
against your allowed chat(s). CLI hooks are gated on `CERBERUS_PANE_ID`, so they
fire only inside a Cerberus pane and coexist with any tmux-based setup.

## Stack

Electron · xterm.js · node-pty · TypeScript · electron-vite · electron-builder ·
grammY (Telegram). The backend sits behind a thin `TerminalBridge` seam, so a
future Tauri/Rust swap is a module replacement, not a rewrite.

## License

MIT — see [LICENSE](LICENSE).
