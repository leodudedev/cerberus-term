#!/usr/bin/env bash
# Cerberus (cerberus-term) notification hook for Codex CLI.
#
# PreToolUse / PostToolUse / SessionEnd: fire-and-forget, same shape as
# notify.sh (Claude Code) and copilot-notify.sh.
#
# PermissionRequest is answered natively instead: this script blocks on the
# daemon, which holds the HTTP request open until a Telegram tap resolves it
# or its own ~25s timeout passes (see src/main/cerberus/codex-decisions.ts and
# docs/todo.md #1.7b), then prints the daemon's response to stdout as-is.
# `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{...}}}`
# tells Codex how to answer; `{}` (an abstain, e.g. on timeout or when muted)
# has no such key and is ignored, falling through to Codex's own prompt.
#
# MUST always exit 0: a non-zero exit here is a deny in Codex, and a daemon
# that's down or slow must fail open to the local prompt, never freeze the turn.

[ -z "${CERBERUS_PANE_ID:-}" ] && exit 0

payload=$(cat)

event=""
if [[ "$payload" =~ \"hook_event_name\":\"([^\"]*)\" ]]; then
  event="${BASH_REMATCH[1]}"
fi

json_escape() {
  local s=${1//\\/\\\\}
  printf '%s' "${s//\"/\\\"}"
}

pane=$(json_escape "${CERBERUS_PANE_ID:-}")
# CODEX_HOME is Codex's own CLAUDE_CONFIG_DIR equivalent for running more than
# one account/config side by side; empty when unset, same as Claude's default.
cfg=$(json_escape "${CODEX_HOME:-}")

body=$(cat <<EOF
{"cerberus_pane":"${pane}","config_dir":"${cfg}","agent":"codex","hook":${payload:-null}}
EOF
)

if [ "$event" = "PermissionRequest" ]; then
  # -m above the daemon's own wait: a ceiling for a dead/hung daemon, not the
  # thing that's supposed to fire in the normal case.
  curl -s -m 30 -X POST "http://127.0.0.1:${CERBERUS_PORT:-8898}/event" \
    -H 'content-type: application/json' \
    -H "x-cerberus-token: ${CERBERUS_TOKEN:-}" \
    -d "$body"
else
  curl -s -m 3 -X POST "http://127.0.0.1:${CERBERUS_PORT:-8898}/event" \
    -H 'content-type: application/json' \
    -H "x-cerberus-token: ${CERBERUS_TOKEN:-}" \
    -d "$body" >/dev/null 2>&1 &
fi

exit 0
