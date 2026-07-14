import { createServer, type IncomingMessage } from "node:http";
import { config } from "../../core/config.js";
import { profileFromConfigDir, type Agent, type Profile } from "../../core/profile.js";
import { upsertSession } from "../../core/registry.js";
import { initBot, pushAttention, pushCompletion } from "./bot.js";
import { takeApproval } from "./remote-approvals.js";
import { lastAssistantText, lastCopilotText, type ToolUse } from "../../core/transcript.js";
import { readProjectConfig } from "../../core/project-config.js";
import { isMuted } from "../../core/mute.js";
import { putPendingTool, peekPendingTool, summarizeToolArgs } from "../../core/pending-tools.js";
import { capturePane } from "../pane-control.js";

// A permission dialog offers a "don't ask again" / "allow all" option only
// sometimes, and whether it does can't be inferred from the tool or command —
// Claude attaches it to whatever sub-command it can turn into an allow rule. So
// we read the option straight from the pane instead of guessing.
// Match both the straight and typographic apostrophe (Claude renders "don’t"
// with U+2019), plus the "Yes, and …" allow-rule option and the Italian wording.
const ALWAYS_OPTION_RE =
  /don['’]?t ask again|allow all|always allow|yes,?\s+and\b|non chiedere|consenti sempre|approva sempre/i;

// HTTP daemon that receives detection events from the hook scripts.
// Two producers, one endpoint:
//  - Claude Code  `Notification` hook (hooks/notify.sh) — snake_case payload,
//    enriched by reading the session transcript (JSONL).
//  - Copilot CLI  `preToolUse` + `notification` hooks (hooks/copilot-notify.sh)
//    — camelCase payload, no transcript: preToolUse feeds an in-memory cache
//    that the permission notification reads back.

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

// Pull the answer labels out of an AskUserQuestion tool_input so the bot can
// render one button per real option. Only the simple single-question,
// single-select shape is supported; anything else falls back to no options
// (the user can still reply with free text), because multi-select and
// multi-question dialogs need more than a single "digit + Enter" keystroke.
function extractQuestionOptions(toolName: string, input: unknown): string[] | undefined {
  if (toolName !== "AskUserQuestion" || !input || typeof input !== "object") return undefined;
  const qs = (input as { questions?: unknown }).questions;
  if (!Array.isArray(qs) || qs.length !== 1) return undefined;
  const q = qs[0] as { multiSelect?: boolean; options?: unknown };
  if (q?.multiSelect) return undefined;
  if (!Array.isArray(q?.options)) return undefined;
  const labels = q.options
    .map((o) => String((o as { label?: unknown })?.label ?? "").trim())
    .filter(Boolean)
    .slice(0, 8);
  return labels.length ? labels : undefined;
}

// Pull a short human-readable result out of a PostToolUse tool_response, whose
// shape varies by tool (string, {stdout}, {filePath}, structured object).
function summarizeResult(resp: unknown): string {
  if (typeof resp === "string") return resp.trim();
  if (resp && typeof resp === "object") {
    const r = resp as Record<string, unknown>;
    for (const k of ["stdout", "message", "content", "filePath", "result"]) {
      const v = r[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    try {
      return JSON.stringify(r).slice(0, 400);
    } catch {
      return "";
    }
  }
  return "";
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : null;
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, ts: Date.now() }));
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

    const agent: Agent = body?.agent === "copilot" ? "copilot" : "claude";
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

    // Claude Code PreToolUse: same idea as Copilot's preToolUse. The permission
    // Notification carries neither tool_name nor tool_input, so cache the exact
    // tool + input now and read it back when the notification arrives. This
    // replaces the old, racy "guess the pending tool from the transcript",
    // which returned the wrong tool on parallel batches and null when the
    // tool_use had not been flushed yet. PreToolUse also fires inside subagents.
    // Exit-0 with no output leaves the normal permission flow untouched.
    if (agent === "claude" && hook.hook_event_name === "PreToolUse") {
      const name = String(hook.tool_name ?? "");
      const command = summarizeToolArgs(hook.tool_input);
      const options = extractQuestionOptions(name, hook.tool_input);
      putPendingTool(sessionId, name, command, options);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Claude PostToolUse: if this tool was approved from Telegram, push its
    // result back (completion feed). Locally-approved tools stay silent.
    if (agent === "claude" && hook.hook_event_name === "PostToolUse") {
      const appr = takeApproval(sessionId, String(hook.tool_name ?? ""));
      if (appr) {
        void pushCompletion({
          chatId: appr.chatId,
          messageId: appr.messageId,
          toolName: appr.toolName || String(hook.tool_name ?? ""),
          command: appr.command,
          result: summarizeResult(hook.tool_response),
        }).catch((e) => console.error("[bot] completion failed", e));
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
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

    // Enrichment.
    //  - Claude: last assistant text = the human-readable context ("what Claude
    //    said"); the tool + input come from the PreToolUse cache below.
    //  - Copilot: no transcript — tool + input from the preToolUse cache too.
    let detail = "";
    let tool: ToolUse | null = null;
    let options: string[] = [];
    if (agent === "claude") {
      detail = await lastAssistantText(hook.transcript_path);
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
    let hasAlways = false;
    if (isPermission && options.length === 0 && pane) {
      let dialog = await capturePane(pane);
      // The dialog may not be painted yet when the hook fires; retry once.
      if (!/\b\d+\.\s/.test(dialog)) {
        await sleep(200);
        dialog = await capturePane(pane);
      }
      hasAlways = ALWAYS_OPTION_RE.test(dialog);
    }

    const profile: Profile = agent === "copilot" ? "copilot" : profileFromConfigDir(body?.config_dir);
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
export function startDaemon(): void {
  server.listen(config.port, "127.0.0.1", () => {
    console.log(`[daemon] listening on http://127.0.0.1:${config.port}`);
    initBot();
  });
}
