#!/usr/bin/env bash
# Cerberus (cerberus-term) hook for GitHub Copilot CLI.
# Registered for preToolUse / notification / agentStop. Gated on CERBERUS_PANE_ID
# so it only fires in a native cerberus-term pane.
# MUST always exit 0 (Copilot treats non-zero preToolUse as "deny").

event="${1:-unknown}"
[ -z "${CERBERUS_PANE_ID:-}" ] && exit 0

payload=$(cat)

json_escape() {
  local s=${1//\\/\\\\}
  printf '%s' "${s//\"/\\\"}"
}
pane=$(json_escape "${CERBERUS_PANE_ID:-}")
evt=$(json_escape "$event")

body=$(cat <<EOF
{"agent":"copilot","event":"${evt}","cerberus_pane":"${pane}","hook":${payload:-null}}
EOF
)

curl -s -m 3 -X POST "http://127.0.0.1:${CERBERUS_PORT:-8898}/event" \
  -H 'content-type: application/json' \
  -d "$body" >/dev/null 2>&1 &

exit 0
