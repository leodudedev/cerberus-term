#!/usr/bin/env bash
# Minimal, agent-agnostic orchestration driver for Cerberus.
#
# Reads a task queue (queue.json), runs each pending task's worker command
# headless, opens a read-only Cerberus follower pane on the worker's log
# (best-effort: outside Cerberus it silently no-ops), and advances the queue.
#
# Agent-agnostic by design: each task carries its own `cmd` — Claude Code,
# Copilot CLI, aider, a plain script… anything that writes a log file works.
# `logFormat` controls the follower pane projection:
#   - "claude-stream" -> readable projection of Claude Code stream-json
#   - "raw" (default) -> plain tail -f
#
# Two Cerberus-specific tricks (both no-ops outside Cerberus):
#   1. Workers are launched with CERBERUS_PANE_ID unset, so only the
#      orchestrator session (this pane) triggers Telegram notifications.
#   2. Follower panes are opened via POST /pane on the loopback daemon.
set -euo pipefail

Q="${1:-queue.json}"
mkdir -p out work

# Open a read-only follower pane on a log file. No-op outside Cerberus.
open_follower() { # $1=log file  $2=title  $3=format
  [ -n "${CERBERUS_PORT:-}" ] || return 0
  curl -fsS -X POST "http://127.0.0.1:$CERBERUS_PORT/pane" \
    -H 'content-type: application/json' \
    -d "{\"file\":\"$1\",\"title\":\"$2\",\"format\":\"$3\"}" >/dev/null 2>&1 || true
}

# All dependencies of a task done?
deps_done() { # $1=task id
  local pending
  pending=$(jq -r --arg i "$1" '
    (.[] | select(.id==$i) | .dependsOn // []) as $deps
    | [.[] | select(.id as $x | $deps | index($x)) | select(.status!="done")] | length
  ' "$Q")
  [ "$pending" = "0" ]
}

set_status() { # $1=task id  $2=status
  local t
  t=$(mktemp)
  jq --arg i "$1" --arg s "$2" '(.[] | select(.id==$i) | .status) = $s' "$Q" > "$t" && mv "$t" "$Q"
}

ran_something=1
while [ "$ran_something" = "1" ]; do
  ran_something=0
  for id in $(jq -r '.[] | select(.status=="pending") | .id' "$Q"); do
    deps_done "$id" || continue

    cmd=$(jq -r --arg i "$id" '.[] | select(.id==$i) | .cmd' "$Q")
    out=$(jq -r --arg i "$id" '.[] | select(.id==$i) | .outFile' "$Q")
    fmt=$(jq -r --arg i "$id" '.[] | select(.id==$i) | .logFormat // "raw"' "$Q")
    log="$PWD/out/$id.log"
    : > "$log"

    open_follower "$log" "$id" "$fmt"

    echo "> $id"
    # Headless + muted: only the orchestrator pane keeps CERBERUS_PANE_ID,
    # so workers never spam Telegram.
    if env -u CERBERUS_PANE_ID sh -c "$cmd" > "$log" 2>"out/$id.err"; then
      if [ -f "$out" ]; then
        set_status "$id" "done"
        echo "  ok $id -> $out"
        ran_something=1
      else
        set_status "$id" "blocked"
        echo "  FAIL $id: expected output missing (see out/$id.err)" >&2
      fi
    else
      set_status "$id" "blocked"
      echo "  FAIL $id: worker exited non-zero (see out/$id.err)" >&2
    fi
  done
done

blocked=$(jq -r '[.[] | select(.status=="blocked")] | length' "$Q")
[ "$blocked" = "0" ] && echo "Queue completed." || { echo "$blocked task(s) blocked." >&2; exit 1; }
