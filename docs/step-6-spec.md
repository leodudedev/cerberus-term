# Step 6 spec — integrate the Cerberus core (remote control)

Repo: `cerberus-term` · Model: **Opus 4.8**
Status: **draft review — no code until approved** (open decisions below)

## Goal (MVP cut-line)

A pane asks permission → Telegram push (risk-iconed) → approve/deny/prompt from
the phone → the keystroke lands **in that exact pane**. We own the ptys, so
`tmux send-keys` is gone: injection is `TerminalBridge.write`.

## Architecture

Cerberus core runs in the **Electron main** process:

- **Detection = CLI hooks** (decided). Claude Code's `PreToolUse` + `Notification`
  hooks POST to a loopback HTTP daemon, exactly like the tmux version.
- **Pane identity**: `TMUX_PANE` → **`CERBERUS_PANE_ID`** (our pty paneId),
  injected into each pty's env at spawn. The hook forwards it; the daemon maps
  event → paneId → pane.
- **Injection**: native `bridge.write` (no `send-keys`, no `notify.sh` keystroke
  path). Key names → bytes: `Enter`→`\r`, `Escape`→`\x1b`, digits→literal.
- **Pane capture**: `tmux capture-pane` → a per-pane **rolling output buffer**
  kept in main (last ~16KB, ANSI-stripped on read). Feeds the "don't ask again"
  detection. This is the native win the roadmap called out.
- **paneAlive**: `ptys.has(paneId)`.

## Module copy-over (mycli → src/core/)

Copied, imports repointed, Claude path kept:

```
classify.ts      risk tagging (riskFor, RISK_ICON/RANK)   — as-is
transcript.ts    lastAssistantText (detail)               — as-is (drop copilot fn)
registry.ts      session store (upsert/get/link)          — as-is
mute.ts          runtime mute                             — as-is
icon.ts          project icon                             — as-is
i18n.ts          Telegram strings                         — as-is
config.ts        actionKeys, port, lang                   — as-is
profile.ts       Agent/Profile                            — as-is
pending-tools.ts PreToolUse cache                          — as-is
persist.ts       state snapshot                           — ADAPT: state file →
                                                            app.getPath('userData')
```

New main-side glue:

```
src/main/pane-control.ts   # drop-in for tmux.ts: paneAlive/sendKey/sendText/
                           # sendPrompt/capturePane over the bridge (paneId)
src/main/cerberus/daemon.ts# copied daemon, tmux import -> pane-control
src/main/cerberus/bot.ts   # copied bot,   tmux import -> pane-control
src/main/cerberus/index.ts # startCerberus(): boot daemon + bot from main
resources/hooks/notify.sh  # adapted: reads CERBERUS_PANE_ID, POSTs cerberus_pane
```

`bridge-electron.ts` EDIT: inject `CERBERUS_PANE_ID` (+ `CERBERUS_PORT`) into the
pty env at spawn; maintain the per-pane ring buffer; export `getPaneBuffer`,
`writeKeys`, `paneExists`.

## Scope trim for the MVP slice

**Claude Code only.** Copilot CLI branches (camelCase payload, `copilot-notify.sh`,
`lastCopilotText`, `COPILOT_NOTIFY_TYPES`) are dropped from the copied daemon and
added back in a later step. Cuts a large, version-fragile surface.

**Profiles/`CLAUDE_CONFIG_DIR` per pane** deferred: the daemon still reads
`config_dir` if present (profile label), but we don't yet inject a per-pane one.

## Telegram credentials (MVP)

Read `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` (+ `TELEGRAM_ALLOWED_CHATS`,
`CERBERUS_LANG`) from the environment / a dev `.env` loaded in main. The in-app
settings UI is **Step 7**; here env is enough to prove the loop.

## Hook install — THE open risk

The tmux Cerberus (`mycli`) has **already** installed its hooks into
`~/.claude/settings.json` pointing at `mycli/hooks/notify.sh`. Installing ours
naively either overwrites mycli (breaks it) or appends (double notifications, two
daemons on one port). This needs an explicit decision (below) before any code
touches that file. Whatever we choose: **back up the file, merge idempotently,
never clobber unrelated hooks.**

## Files touched (summary)

```
src/core/{classify,transcript,registry,mute,icon,i18n,config,profile,
          pending-tools,persist}.ts   # NEW (copied/adapted)
src/main/pane-control.ts               # NEW
src/main/cerberus/{daemon,bot,index}.ts# NEW (copied/adapted)
src/main/bridge-electron.ts            # EDIT (env inject, ring buffer, key write)
src/main/index.ts                      # EDIT (startCerberus after window)
resources/hooks/notify.sh              # NEW (adapted)
package.json                           # EDIT (grammy dep for the bot)
```

## Deliverable / verification

- Run `claude` in a pane, trigger a permission → Telegram push with the right
  risk icon + tool/command + project.
- Approve from phone → `1\r` lands in that pane; Deny → `Esc`. Option buttons for
  AskUserQuestion. Free-text reply → typed as a prompt into the right pane.
- Two panes running `claude` → each notification routes to its own pane.
- Mute (`/mute`) + `.cerberus.json` overrides honored (reuses Step 5 core).
- Daemon binds loopback only; `getPaneBuffer` drives has-always with no tmux.

## Explicitly out of scope

Copilot CLI (later), in-app Telegram settings (Step 7), per-pane profiles /
`CLAUDE_CONFIG_DIR` (later), packaging the hook path for a built app (Step 9;
dev uses the repo path).
```
