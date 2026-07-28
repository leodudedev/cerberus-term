# Security

Cerberus runs shells and lets a chat app type into them. That's the whole point,
and it's also the reason the boundaries below are worth stating plainly.

## Reporting a vulnerability

Don't open a public issue. Use GitHub's
[private vulnerability reporting](https://github.com/leodudedev/cerberus-term/security/advisories/new),
or email **pinori@gmail.com**.

Include what you did, what happened, and the OS and app version. This is a
single-maintainer project — expect an acknowledgement within a few days, and a
fix in the next release if it's confirmed.

Supported: the **latest release**. Older versions don't get backports.

## What is protected

**The daemon binds loopback only** (`127.0.0.1`, default port 8898) and never
listens on an external interface.

**`POST /event` and `POST /pane` are token-gated.** Each run mints a UUID,
injected into every pane as `CERBERUS_TOKEN` and written to
`~/.cerberus-term/token` with mode `0600` so an orchestrator script outside a
pane can still authenticate. Requests must carry it in an `x-cerberus-token`
header, and any request carrying an `Origin` header is rejected outright.

That combination targets one specific attacker: **a web page**. Any site you
visit can `fetch('http://127.0.0.1:8898/…', {mode: 'no-cors'})` and, while it
can't read the reply, the side effect would land — a forged permission push to
your phone whose Approve button types into a real pane, or a follower pane
opened on an arbitrary file. A custom header forces a CORS preflight the daemon
never answers, and the page has no way to learn the token regardless.

**Telegram callbacks are checked against your allowed chats** — the configured
`chatId` plus any extras in `allowedChats`. A per-project `chatId` override in
`.cerberus.json` only works if that chat is already allowed, so a project file
can't redirect your notifications somewhere new.

**CLI hooks are gated on `CERBERUS_PANE_ID`**, so they fire only inside a
Cerberus pane and coexist with any tmux-based setup. Child processes launched
with it unset are silent by construction.

**Follower panes are path-confined** and `POST /pane` requires an absolute path
and shell-quotes everything it runs. Request bodies are capped at 4 MB.

**Terminal output is sanitized** — OSC sequences are stripped before they reach
xterm, so a hostile file printed into a pane can't drive the emulator. Renderer
navigation is pinned; the app window can't be steered to a remote origin.

**The bot token is kept out of the pane environment**, so a shell — or a
`claude` running in one — never sees it.

## What is not protected

**Any process running as your user.** It can read `CERBERUS_TOKEN` from a pane's
environment or from `~/.cerberus-term/token`, and drive the daemon. It could
also already read your SSH keys, so this is not a boundary Cerberus tries to
draw.

**Secrets at rest are plaintext.** Your bot token
(`~/.cerberus-term/cerberus-settings.json`, or the platform userData path) and
session state (`~/.cerberus-term/cerberus-state.json`) are stored unencrypted,
like a `.env`. Anyone with access to your user account can read them. Keep the
machine trusted, and revoke the token in @BotFather if you suspect otherwise.

**Whoever controls the Telegram chat controls the sessions.** Approve types into
a live pane and free text is forwarded as a prompt. If your phone or your bot
token is compromised, so is every session Cerberus is watching. Risk icons
(🟢 🟡 🔴) are an aid to judgement, not an enforcement boundary — nothing stops
you approving a 🔴.

**Approval is delegation.** The `♾️ Always` button stops asking for that tool for
the rest of the session; that decision is exactly as broad as it sounds.

**Builds are not signed or notarized.** Installers trip Gatekeeper and
SmartScreen, and you're trusting the GitHub Actions build. Verify against the
tag if that matters to you.
