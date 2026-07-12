#!/usr/bin/env bash
# Cerberus (cerberus-term) notification hook for Claude Code.
# Gated on CERBERUS_PANE_ID: fires only inside a native cerberus-term pane, so it
# coexists with the tmux mycli hook (which gates on $TMUX_PANE) — no double push.
# Best-effort and non-blocking: must never fail or stall the Claude session.

[ -z "${CERBERUS_PANE_ID:-}" ] && exit 0

payload=$(cat)

json_escape() {
  local s=${1//\\/\\\\}
  printf '%s' "${s//\"/\\\"}"
}
pane=$(json_escape "${CERBERUS_PANE_ID:-}")
cfg=$(json_escape "${CLAUDE_CONFIG_DIR:-}")

body=$(cat <<EOF
{"cerberus_pane":"${pane}","config_dir":"${cfg}","hook":${payload:-null}}
EOF
)

curl -s -m 3 -X POST "http://127.0.0.1:${CERBERUS_PORT:-8898}/event" \
  -H 'content-type: application/json' \
  -d "$body" >/dev/null 2>&1 &

exit 0
