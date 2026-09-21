import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { type BrowserWindow } from "electron";
import { config } from "../../core/config.js";
import { profileFromConfigDir, type Agent, type Profile } from "../../core/profile.js";
import { upsertSession, dropSession } from "../../core/registry.js";
import { initBot, pushAttention, pushCompletion, markHandledLocally } from "./bot.js";
import { takeApproval } from "./remote-approvals.js";
import {
  lastAssistantText,
  lastCopilotText,
  lastCodexText,
  type ToolUse
} from "../../core/transcript.js";
import { readProjectConfig } from "../../core/project-config.js";
import { isMuted } from "../../core/mute.js";
import {
  putPendingTool,
  peekPendingTool,
  summarizeToolArgs,
  summarizeCodexToolArgs
} from "../../core/pending-tools.js";
import { capturePane } from "../pane-control.js";
import { requestAttention } from "../attention.js";
import { ALWAYS_OPTION_RE, dialogOptionsBlock, extractQuestionOptions } from "../../core/dialog.js";
import { resolveFollowPath } from "../../core/follow-path.js";
import { paneSpawnCwds } from "../bridge-electron.js";
import { getDaemonToken } from "./token.js";
import {
  awaitCodexDecision,
  cancelCodexDecision,
  type Outcome
} from "./codex-decisions.js";

// HTTP daemon that receives detection events from the hook scripts.
// Three producers, one endpoint:
//  - Claude Code  `Notification` hook (hooks/notify.sh) — snake_case payload,
//    enriched by reading the session transcript (JSONL).
//  - Copilot CLI  `preToolUse` + `notification` hooks (hooks/copilot-notify.sh)
//    — camelCase payload, no transcript: preToolUse feeds an in-memory cache
//    that the permission notification reads back.
//  - Codex CLI  `PreToolUse` + `PostToolUse` + `PermissionRequest` hooks
//    (hooks/codex-notify.sh) — snake_case payload, close to Claude's shape.
//    `PermissionRequest` carries its own tool_name/tool_input (Claude's
//    `Notification` carries neither), so it doesn't need the pending-tool
//    read-back, and it can answer allow/deny natively instead of us typing
//    into the pane — see codex-decisions.ts and docs/todo.md #1.7b. Its HTTP
//    request is held open until Telegram answers or a short timeout passes.

interface HookPayload {
  // Claude Code (snake_case)
  session_id?: string;
  hook_event_name?: string;
  transcript_path?: string;
  // Copilot CLI (camelCase; PascalCase hook variants use snake_case)
  sessionId?: string;
  notification_type?: string;
  title?: string;
  toolName?: string;
  tool_name?: string;
  toolArgs?: unknown;
  tool_input?: unknown;
  tool_response?: unknown; // PostToolUse result
  // Common
  cwd?: string;
  message?: string;
  [k: string]: unknown;
}

interface EventBody {
  cerberus_pane?: string; // our pty paneId (from CERBERUS_PANE_ID); native panes
  tmux_pane?: string; // legacy tmux pane id (kept so tmux hooks still parse)
  config_dir?: string;
  agent?: string; // "copilot" from copilot-notify.sh; absent = claude
  event?: string; // copilot hook event name ("preToolUse" | "notification")
  hook?: HookPayload | null;
}

// Copilot fires notifications for lots of lifecycle moments; only these need
// the phone. shell_completed & co. would be pure spam.
const COPILOT_NOTIFY_TYPES = new Set([
  "permission_prompt",
  "elicitation_dialog",
  "agent_idle",
  "agent_completed",
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Cap the request body: a local process could otherwise stream an unbounded
// payload and block the main process on Buffer.concat + JSON.parse (UI freeze).
const MAX_BODY_BYTES = 4 * 1024 * 1024;

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY_BYTES) {
      req.destroy();
      throw new Error("payload_too_large");
    }
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : null;
}

// Codex's PermissionRequest carries tool_input.description — the exact,
// already-localised prompt text it put on screen (docs/todo.md #1.7c).
function codexInputFields(input: unknown): { description: string } {
  const o = typeof input === "object" && input ? (input as Record<string, unknown>) : {};
  return { description: typeof o.description === "string" ? o.description : "" };
}

// Bridge to the renderer (set in startDaemon), used by external endpoints like
// POST /pane to ask the UI to open a follower pane.
let emit: ((channel: string, payload: unknown) => void) | null = null;
let claudeStreamFmtPath: string | undefined;

// Gate for everything that has a side effect. Two independent checks:
//  - the shared token, which a web page cannot know;
//  - the absence of an Origin header, which a browser always attaches to a
//    cross-origin request and a curl from a hook never does.
// Either one alone would do; together they make a browser-driven POST to our
// loopback port a non-event. See token.ts for why that's the threat we care
// about (a process running as this user can read the token anyway).
function authorized(req: IncomingMessage): boolean {
  if (req.headers["origin"]) return false;
  const got = req.headers["x-cerberus-token"];
  return typeof got === "string" && got === getDaemonToken();
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, ts: Date.now() }));
    return;
  }

  if (!authorized(req)) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  // External driver (e.g. an orchestrator script) asks Cerberus to open a
  // read-only pane that follows a worker log. Loopback-only; require an absolute
  // file path so nothing shell-injectable reaches the follower's tail command.
  if (req.method === "POST" && req.url === "/pane") {
    // Follower panes run POSIX commands (tail -f, jq) — not supported on Windows
    // yet. Reject cleanly instead of opening a broken pane.
    if (process.platform === "win32") {
      res.writeHead(501, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_supported_on_windows" }));
      return;
    }
    let body: { file?: string; title?: string; cwd?: string; format?: string };
    try {
      body = (await readJson(req)) as typeof body;
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "bad_json" }));
      return;
    }
    if (!body?.file || !body.file.startsWith("/")) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "missing_or_relative_file" }));
      return;
    }
    // Symlinks resolved, and the target confined to home or a live pane's cwd,
    // minus the directories that hold keys and tokens. See core/follow-path.ts
    // for what this does and does not defend against.
    const resolved = resolveFollowPath(body.file, { paneCwds: paneSpawnCwds() });
    if (!resolved.ok) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "forbidden_file", reason: resolved.reason }));
      return;
    }
    // Opt-in readable projection; any unknown value falls back to raw tail.
    const format = body.format === "claude-stream" ? "claude-stream" : "raw";
    emit?.("cerberus:open-pane", {
      file: resolved.path,
      title: body.title ?? "",
      cwd: body.cwd ?? "",
      format,
      ...(format === "claude-stream" ? { fmtPath: claudeStreamFmtPath } : {}),
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "POST" && req.url === "/event") {
    let body: EventBody;
    try {
      body = (await readJson(req)) as EventBody;
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "bad_json" }));
      return;
    }

    const agent: Agent =
      body?.agent === "copilot" ? "copilot" : body?.agent === "codex" ? "codex" : "claude";
    const hook = body?.hook ?? {};
    // Pane identity: native panes report cerberus_pane (our paneId); tmux hooks
    // still send tmux_pane. Either way it's just the key we inject keystrokes to.
    const pane = body?.cerberus_pane || body?.tmux_pane || "";
    const sessionId = String(hook.session_id ?? hook.sessionId ?? "unknown");

    // Copilot preToolUse: cache the tool about to run and stop here — the
    // permission notification (if any) follows as a separate event.
    // Copilot does NOT pass the CLI arg through the `bash` hook field, so
    // body.event is "unknown" in practice. Detect preToolUse from the payload
    // shape instead: it carries toolName/toolArgs and, unlike notifications,
    // has no notification_type / hook_event_name. (The arg path is kept as a
    // fast-path in case a future Copilot build restores it.)
    const looksLikePreTool =
      !hook.notification_type &&
      hook.hook_event_name !== "Notification" &&
      (hook.toolName != null || hook.tool_name != null);
    if (agent === "copilot" && (body?.event === "preToolUse" || looksLikePreTool)) {
      const name = String(hook.toolName ?? hook.tool_name ?? "");
      const command = summarizeToolArgs(hook.toolArgs ?? hook.tool_input);
      putPendingTool(sessionId, name, command);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // SessionEnd (Claude, Codex): the session is over (/exit, /clear, logout).
    // Drop it now instead of letting it idle out after SESSION_TTL_MS — until
    // it's gone, resolveTarget still resolves it and a Telegram reply gets
    // typed into whatever the user started in that pane next.
    if ((agent === "claude" || agent === "codex") && hook.hook_event_name === "SessionEnd") {
      const dropped = dropSession(sessionId);
      console.log("[session-end]", sessionId, dropped ? "dropped" : "(unknown)");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // PreToolUse (Claude, Codex): same idea as Copilot's preToolUse. Claude's
    // permission Notification carries neither tool_name nor tool_input, so
    // cache the exact tool + input now and read it back when the notification
    // arrives. This replaces the old, racy "guess the pending tool from the
    // transcript", which returned the wrong tool on parallel batches and null
    // when the tool_use had not been flushed yet. PreToolUse also fires inside
    // subagents. Exit-0 with no output leaves the normal permission flow
    // untouched. Codex's PermissionRequest is self-sufficient (docs/todo.md
    // #1.7c) and doesn't read this back, but PostToolUse's completion feed
    // still wants a tool name, so the cache is kept for both agents alike.
    if ((agent === "claude" || agent === "codex") && hook.hook_event_name === "PreToolUse") {
      const name = String(hook.tool_name ?? "");
      const command =
        agent === "codex"
          ? summarizeCodexToolArgs(name, hook.tool_input)
          : summarizeToolArgs(hook.tool_input);
      const options = extractQuestionOptions(name, hook.tool_input);
      putPendingTool(sessionId, name, command, options);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // PostToolUse (Claude, Codex): if this tool was approved from Telegram,
    // push its result back (completion feed). Locally-approved tools stay
    // silent. Codex can retry a sandboxed call before the user is ever asked
    // (docs/todo.md #1.7c) — that PostToolUse arrives with no approval on
    // record and no live Telegram message for this session yet, so takeApproval
    // returns null and markHandledLocally is a no-op; nothing is stripped
    // prematurely.
    if ((agent === "claude" || agent === "codex") && hook.hook_event_name === "PostToolUse") {
      const appr = takeApproval(sessionId, String(hook.tool_name ?? ""));
      if (appr) {
        void pushCompletion({ chatId: appr.chatId, messageId: appr.messageId }).catch((e) =>
          console.error("[bot] completion failed", e),
        );
      } else {
        // Not remotely approved -> handled locally on the PC. Strip the now-dead
        // buttons from the Telegram permission message so the chat stays clean.
        void markHandledLocally(sessionId).catch((e) =>
          console.error("[bot] local-mark failed", e),
        );
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // PermissionRequest (Codex): self-sufficient — tool_name and tool_input
    // arrive on the same event, so there's no read-back through the
    // pending-tool cache the way Claude's Notification needs one. Answered
    // natively: the HTTP response stays open while codex-decisions.ts waits
    // for a Telegram tap, so the hook returns an allow/deny decision instead
    // of us typing into a Codex TUI we've never parsed (docs/todo.md #1.7b).
    if (agent === "codex" && hook.hook_event_name === "PermissionRequest") {
      const name = String(hook.tool_name ?? "");
      const { description } = codexInputFields(hook.tool_input);
      const command = summarizeCodexToolArgs(name, hook.tool_input);
      putPendingTool(sessionId, name, command);

      const detail = await lastCodexText(hook.transcript_path);
      const profile = profileFromConfigDir(body?.config_dir, "codex");
      // Identifies this request for the whole round trip. A permission answered
      // at the keyboard leaves its Telegram message with live buttons (nothing
      // fires a PostToolUse to retire them when the answer was "no"), so
      // without an id a tap on that leftover would settle whatever request is
      // open now — approving a command the user never read.
      const decisionId = randomUUID();
      const session = upsertSession({
        sessionId,
        agent,
        pane,
        profile,
        cwd: hook.cwd ?? "",
        // description is the exact, already-localised prompt Codex put on
        // screen (docs/todo.md #1.7c) — quote it instead of reconstructing
        // intent from the command, which we can't do for Claude.
        lastMessage: description || command,
        detail,
        toolName: name,
        command,
        options: [],
        hasAlways: false, // no TUI "don't ask again" parsing for Codex — 1.7b
        isPermission: true,
        decisionId,
      });

      if (pane) emit?.("cerberus:pane-attention", { pane, sessionId: session.sessionId });
      requestAttention();

      const pcfg = readProjectConfig(session.cwd);
      let decision: Outcome = "timeout";
      if (pcfg.mute || isMuted(session.cwd)) {
        // Muted: no message is coming, so don't hold the turn hostage waiting
        // for a tap on it. Abstain immediately and let Codex ask on screen.
        console.log("[mute]", session.cwd);
      } else {
        // Registered before the push so a tap can never land before there is
        // something to receive it.
        const wait = awaitCodexDecision(sessionId, decisionId);
        // The hook can die while we hold its request open — Codex timing it
        // out, the user pressing Escape, the pane going away. The socket
        // closing is the only signal we get; without acting on it the waiter
        // survives, and a tap arriving afterwards would be reported to the
        // phone as an approval that Codex never received.
        req.on("close", () => cancelCodexDecision(sessionId, decisionId));

        // Awaited, not fire-and-forget: its answer decides whether waiting is
        // meaningful at all. It returns false whenever no message went out —
        // no bot configured, below the project's minRisk, suppressed as a
        // duplicate — and in every one of those cases blocking would freeze
        // the turn for the full window with Codex's own prompt hidden behind
        // it and nothing able to end it early. Installing the Codex hooks
        // without ever setting up Telegram is the common shape of that.
        const sent = await pushAttention(session, {
          chatId: pcfg.chatId,
          minRisk: pcfg.minRisk,
        }).catch((e) => {
          console.error("[bot] push failed", e);
          return false;
        });
        if (sent) {
          decision = await wait;
        } else {
          cancelCodexDecision(sessionId, decisionId);
          console.log("[codex] nothing pushed — abstaining", session.cwd);
        }
      }

      // The hook may already be gone (see the close handler above); writing to
      // its socket then is harmless but pointless.
      if (!res.destroyed && !res.writableEnded) {
        res.writeHead(200, { "content-type": "application/json" });
        // An abstain has to be an object Codex accepts and finds no decision
        // in. `{}` validates: its output schema defaults every property and
        // requires none — while rejecting anything unknown, which is why the
        // daemon's old generic `{"ok":true}` reply produced "hook returned
        // invalid permission-request JSON output" on every Codex permission.
        res.end(
          decision === "timeout"
            ? "{}"
            : JSON.stringify({
                hookSpecificOutput: {
                  hookEventName: "PermissionRequest",
                  decision: { behavior: decision },
                },
              }),
        );
      }
      return;
    }

    const notifyType = String(hook.notification_type ?? "");

    // Copilot agentStop: the agent finished its response. The payload carries a
    // `stopReason` (e.g. "end_turn") plus a transcriptPath, but no message and
    // no notification_type — so without this it would be suppressed as an empty
    // event. Treat it as a non-permission "done" notification and enrich it with
    // the last assistant text from the transcript (Claude-style feedback).
    const isCopilotStop = agent === "copilot" && typeof hook.stopReason === "string";
    let doneText = "";
    if (isCopilotStop) {
      doneText = await lastCopilotText(String(hook.transcriptPath ?? ""));

      // Copilot has no PostToolUse hook, so the completion feed for a
      // remotely-approved tool is delivered at turn end (agentStop) instead:
      // if an approval is pending for this session, push the result threaded
      // under the original notification and skip the generic "done" push.
      const appr = takeApproval(sessionId, "");
      if (appr) {
        void pushCompletion({ chatId: appr.chatId, messageId: appr.messageId }).catch((e) =>
          console.error("[bot] completion failed", e),
        );
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
    }

    const message = isCopilotStop ? doneText : String(hook.message ?? hook.title ?? "");

    if (agent === "copilot" && !isCopilotStop && notifyType && !COPILOT_NOTIFY_TYPES.has(notifyType)) {
      console.log("[copilot-skip]", notifyType);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    const isPermission =
      agent === "copilot" ? notifyType === "permission_prompt" : /permission/i.test(message);

    // Enrichment. Unreachable for codex today — PermissionRequest reads its
    // own transcript and returns above — kept correct anyway.
    //  - Claude: last assistant text = the human-readable context ("what Claude
    //    said"); the tool + input come from the PreToolUse cache below.
    //  - Copilot: no transcript — tool + input from the preToolUse cache too.
    let detail = "";
    let tool: ToolUse | null = null;
    let options: string[] = [];
    if (agent === "claude") {
      detail = await lastAssistantText(hook.transcript_path);
    } else if (agent === "codex") {
      detail = await lastCodexText(hook.transcript_path);
    }
    // Attach the pending tool when a permission is being asked, or when a fresh
    // AskUserQuestion is pending (it's an elicitation, not a "permission", but
    // its options still deserve per-option buttons). Freshness guards against
    // showing a stale tool on an idle recap.
    let pend = peekPendingTool(sessionId);
    const freshQuestion =
      !!pend && pend.name === "AskUserQuestion" && Date.now() - pend.ts < 4000;
    if (isPermission || freshQuestion) {
      // PreToolUse and the notification race on two HTTP requests: retry once.
      if (!pend) {
        await sleep(300);
        pend = peekPendingTool(sessionId);
      }
      if (pend) {
        tool = pend;
        options = pend.options ?? [];
      }
    }

    // Read the actual dialog from the pane to know whether a "don't ask again"
    // option is present — the only reliable source. Skip when we already have
    // AskUserQuestion options (those drive per-option buttons instead).
    //
    // The pane buffer is untrusted: it's whatever processes chose to print, and
    // a program can forge a numbered block offering "don't ask again". So only
    // consult it when a PreToolUse for this session landed moments ago, which is
    // the one signal that a real dialog is actually waiting. Without it there is
    // nothing to allow-always and the button must not appear.
    let hasAlways = false;
    const freshTool = !!pend && Date.now() - pend.ts < 4000;
    if (isPermission && options.length === 0 && pane && freshTool) {
      let dialog = await capturePane(pane);
      // The dialog may not be painted yet when the hook fires; retry once.
      if (!/\b\d+\.\s/.test(dialog)) {
        await sleep(200);
        dialog = await capturePane(pane);
      }
      hasAlways = ALWAYS_OPTION_RE.test(dialogOptionsBlock(dialog));
    }

    // Unreachable for codex in practice — PermissionRequest returns above, and
    // it's the only event we ask Codex to send an opinion through this path
    // for. Kept correct anyway rather than assuming that never changes.
    const profile: Profile =
      agent === "copilot"
        ? "copilot"
        : profileFromConfigDir(body?.config_dir, agent === "codex" ? "codex" : undefined);
    const session = upsertSession({
      sessionId,
      agent,
      pane,
      profile,
      cwd: hook.cwd ?? "",
      lastMessage: message,
      detail,
      toolName: tool?.name ?? "",
      command: tool?.command ?? "",
      options,
      hasAlways,
      isPermission,
    });
    console.log("[event]", {
      agent,
      profile,
      pane: session.pane || "(none)",
      session: session.sessionId,
      cwd: session.cwd,
      notifyType: notifyType || "(none)",
      message: session.lastMessage,
    });

    // Copilot fires the `notification` hook for several lifecycle moments; some
    // (e.g. agent_idle/agent_completed) arrive with no message, no transcript
    // and no pending tool. A push for that renders an empty bubble with no
    // buttons — pure noise. Suppress anything non-permission with nothing to
    // show. Permission prompts always render (buttons are the whole point).
    const contentless =
      !isPermission && !message && !detail && !tool && options.length === 0;

    // Local branch: flash the requesting pane in the renderer. Independent of
    // the Telegram gating below — "mute" silences the phone, not the screen in
    // front of you. Only real permission prompts with a known pane qualify.
    if (isPermission && pane) {
      emit?.("cerberus:pane-attention", { pane, sessionId: session.sessionId });
    }
    // Same idea one level up: the pane flash is invisible when the window isn't
    // the one being looked at, so ask the OS for the user's attention too. No
    // pane needed — this is about the app, not about which tab asked.
    if (isPermission) requestAttention();

    // Per-project overrides (.cerberus.json) + runtime mute applied before pushing.
    const pcfg = readProjectConfig(session.cwd);
    if (pcfg.mute || isMuted(session.cwd)) {
      console.log("[mute]", session.cwd);
    } else if (contentless) {
      console.log("[empty-skip]", notifyType || "(none)", session.cwd);
    } else if (!isPermission && pcfg.notifyIdle === false) {
      console.log("[idle-skip]", session.cwd);
    } else {
      // Fire-and-forget push; never block the hook response.
      void pushAttention(session, { chatId: pcfg.chatId, minRisk: pcfg.minRisk }).catch(
        (e) => console.error("[bot] push failed", e),
      );
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

// Inside Electron a port clash must NOT kill the app — just disable remote
// control and keep the terminal running.
server.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EADDRINUSE") {
    console.error(`[daemon] port ${config.port} busy — Cerberus remote control disabled`);
    return;
  }
  console.error("[daemon] server error:", e.message);
});

// Bind only on loopback: the daemon must never be reachable off-host.
export function startDaemon(
  getWindow: () => BrowserWindow | null,
  opts: { fmtPath?: string } = {},
): void {
  emit = (channel, payload) => getWindow()?.webContents.send(channel, payload);
  claudeStreamFmtPath = opts.fmtPath;
  server.listen(config.port, "127.0.0.1", () => {
    console.log(`[daemon] listening on http://127.0.0.1:${config.port}`);
    initBot();
  });
}
