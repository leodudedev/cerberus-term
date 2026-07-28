# Orchestration cockpit

> ⚗️ **Experimental.** The APIs below work but are young and may change — treat
> this as a preview of the tool's second head.

Beyond supervising single sessions, Cerberus can act as a **cockpit for
multi-session orchestration**: one interactive session drives a queue of
headless workers, each worker streams live into a read-only follower pane, and
the human gates (merge/push approvals) still arrive on your phone.

## The model

- **Orchestrator** — one *interactive* session (e.g. `claude`) in a Cerberus
  pane. It's the only interactive session, so it's the only one that prompts →
  its sensitive gates (merge, push, deploy) reach **Telegram** and you approve
  from your phone.
- **Workers** — headless runs (`claude -p`, `copilot -p`, aider, any script)
  launched by the orchestrator. They never prompt; they're **muted** so they
  don't spam notifications, and **observable** live in read-only follower panes
  that auto-tile into a grid.

The orchestrator is **agent-agnostic**: each task carries its own worker command,
so you can mix Claude, Copilot, and plain scripts in one queue. The whole thing
also runs *outside* Cerberus — the supervision layer just no-ops.

## Two integration points

### 1. Mute the workers

The CLI hooks are gated on `CERBERUS_PANE_ID`, which child processes inherit.
Launch workers with it unset so only the orchestrator notifies:

```bash
env -u CERBERUS_PANE_ID claude -p "…" --output-format stream-json
```

### 2. Open follower panes

Ask the daemon (loopback-only) for a read-only pane tailing a worker log —
best-effort, no-op outside Cerberus:

```bash
curl -fsS -X POST "http://127.0.0.1:$CERBERUS_PORT/pane" \
  -H 'content-type: application/json' \
  -H "x-cerberus-token: $CERBERUS_TOKEN" \
  -d '{"file":"'$PWD'/out/t1.log","title":"t1","format":"claude-stream"}' || true
```

`CERBERUS_PORT` and `CERBERUS_TOKEN` are injected into every Cerberus pane;
outside one, read the token from `~/.cerberus-term/token`. The path must be
absolute.

`format` is opt-in:

| Value | Rendering |
|-------|-----------|
| `claude-stream` | Claude Code stream-json as a readable projection — assistant text, `> tool {input}`, and a `-- result \| turns \| cost` footer |
| `raw` (default) | plain `tail -f` of any other agent's log |

## Try it

[`orchestrate.sh`](orchestrate.sh) is a minimal agent-agnostic driver. It walks a
task queue ([`queue.json`](queue.json)), respects dependency ordering, opens a
follower pane per worker, and persists `pending → done | blocked` back into the
queue file so a crashed run resumes where it stopped.

```bash
cd your-project
cp path/to/examples/{orchestrate.sh,queue.json} .
# edit queue.json: one entry per task, any CLI as "cmd"
./orchestrate.sh
```

Requires `jq` and `curl`.

### Queue format

```json
{
  "id": "t2-copilot",
  "cmd": "copilot -p 'Summarize work/t1.txt into work/t2.txt' --allow-all-tools",
  "outFile": "work/t2.txt",
  "logFormat": "raw",
  "status": "pending",
  "dependsOn": ["t1-claude"]
}
```

| Field | Meaning |
|-------|---------|
| `id` | unique task name; also the log filename (`out/<id>.log`) and the follower pane title |
| `cmd` | anything runnable by `sh -c` — the worker |
| `outFile` | the artifact that must exist for the task to count as done |
| `logFormat` | `claude-stream` or `raw` |
| `status` | `pending` → `done` \| `blocked`, written back by the driver |
| `dependsOn` | task ids that must be `done` first |

A task is `blocked` if the worker exits non-zero **or** finishes without
producing `outFile`; stderr lands in `out/<id>.err`. Re-running the script picks
up whatever is still `pending`.

## Adding judgment on top

The script is mechanics only — it has no opinion about whether the work is any
good. For that, run an interactive session in a Cerberus pane
(`claude --model opus`) and prompt it to read the queue, drive the script as its
engine, review the outputs, and perform the gated actions. Those gates are what
land on your phone as Telegram approvals.
