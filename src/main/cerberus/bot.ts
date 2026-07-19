import { basename } from "node:path";
import { Bot, InlineKeyboard } from "grammy";
import { actionKeysFor } from "../../core/config.js";
import { RISK_ICON, RISK_RANK, riskFor, type Risk } from "../../core/classify.js";
import {
  linkMessage,
  mostRecentSession,
  sessionForMessage,
  getSession,
  type SessionInfo,
} from "../../core/registry.js";
import { paneAlive, sendKey, sendPrompt } from "../pane-control.js";
import { putApproval } from "./remote-approvals.js";
import { mute, unmute, listMuted, parseDuration } from "../../core/mute.js";
import { iconForProject } from "../../core/icon.js";
import { t, timeLocale } from "../../core/i18n.js";

// Telegram layer: push attention events, and route replies/buttons back to the
// originating tmux pane via send-keys.

let bot: Bot | null = null;
let chatId: string | null = null;
// Chats allowed as notification targets and as command sources: the default
// chat plus TELEGRAM_ALLOWED_CHATS (csv). Guards per-project chatId overrides.
const allowedChats = new Set<string>();

// Live buttoned permission messages, keyed by session. Lets a LOCAL (keyboard)
// approval on the PC retire the now-useless Telegram buttons instead of leaving
// them dangling. Set when a message with buttons is sent; cleared when a tap
// resolves it or markHandledLocally() fires.
const livePerm = new Map<string, { chatId: string; messageId: number }>();

export function initBot(): boolean {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  chatId = process.env.TELEGRAM_CHAT_ID ?? null;

  if (!token || !chatId) {
    console.warn("[bot] TELEGRAM_BOT_TOKEN/CHAT_ID mancanti — push disabilitato");
    return false;
  }

  allowedChats.clear();
  allowedChats.add(chatId);
  for (const id of (process.env.TELEGRAM_ALLOWED_CHATS ?? "").split(","))
    if (id.trim()) allowedChats.add(id.trim());

  bot = new Bot(token);

  // Whitelist: ignore anything not from an allowed chat.
  bot.use(async (ctx, next) => {
    if (!allowedChats.has(String(ctx.chat?.id))) return;
    await next();
  });

  // Buttons: approve / deny / esc -> keystrokes into the session's pane.
  bot.on("callback_query:data", async (ctx) => {
    const [action, sessionId] = ctx.callbackQuery.data.split(":");
    // Inert marker button left after a handled message: nothing to do.
    if (action === "noop") {
      await ctx.answerCallbackQuery({ text: t.handled });
      return;
    }
    const s = sessionId ? getSession(sessionId) : undefined;
    // `optN` = pick the Nth option of an AskUserQuestion dialog (digit + Enter);
    // everything else is a fixed keymap that depends on the agent.
    const optMatch = action ? /^opt(\d+)$/.exec(action) : null;
    const keys = !s
      ? undefined
      : optMatch
        ? [optMatch[1], "Enter"]
        : action
          ? actionKeysFor(s.agent)[action]
          : undefined;

    if (!s || !keys) {
      await ctx.answerCallbackQuery({ text: t.noSession });
      return;
    }
    // Stale-tap guard: past the TTL the dialog is likely gone and the
    // keystroke would land in the session's input instead.
    if (Date.now() - s.lastSeen > ACTION_TTL_MS) {
      await ctx.answerCallbackQuery({ text: t.expired });
      return;
    }
    if (!(await paneAlive(s.pane))) {
      await ctx.answerCallbackQuery({ text: t.paneDead(s.pane) });
      return;
    }

    for (const k of keys) await sendKey(s.pane, k);

    // Remote-approved a tool -> remember it so PostToolUse can push the result
    // back (completion feed). Only approve/always let the tool actually run.
    if (action === "approve" || action === "always") {
      putApproval(sessionId!, {
        toolName: s.toolName,
        command: s.command,
        chatId: String(ctx.chat?.id ?? ""),
        messageId: ctx.callbackQuery.message?.message_id,
        ts: Date.now(),
      });
    }

    // Mark the message as handled: swap the buttons for a single inert label so
    // it's obvious at a glance which action was taken, and re-taps are no-ops.
    const label = optMatch
      ? t.markOption(optMatch[1]!)
      : { approve: t.markApproved, always: t.markAlways, deny: t.markDenied, esc: t.markCancelled }[
          action
        ] ?? action;
    const when = new Date().toLocaleTimeString(timeLocale(), { hour: "2-digit", minute: "2-digit" });
    livePerm.delete(sessionId); // tapped -> resolved remotely, never local-mark it
    try {
      await ctx.editMessageReplyMarkup({
        reply_markup: new InlineKeyboard().text(`${label} · ${when}`, `noop:${sessionId}`),
      });
    } catch {
      // message too old or already edited — ignore
    }
    await ctx.answerCallbackQuery({ text: `${action} → ${s.profile} ${s.pane}` });
  });

  // Resolve which session a command/message targets: reply -> that session,
  // otherwise the most recent one.
  const resolveTarget = (ctx: any) => {
    const replyId = ctx.message?.reply_to_message?.message_id;
    return (replyId && sessionForMessage(replyId)) || mostRecentSession();
  };

  // /mute [durata]  — mute the targeted project (e.g. /mute 2h). No arg = forever.
  bot.command("mute", async (ctx) => {
    const target = resolveTarget(ctx);
    if (!target) return void ctx.reply(t.noSessionToMute);

    const arg = ctx.match.trim();
    const ttl = arg ? parseDuration(arg) : undefined;
    if (arg && ttl === null) return void ctx.reply(t.badDuration);

    mute(target.cwd, ttl ?? undefined);
    const dur = ttl ? t.muteFor(arg) : t.muteForever;
    await ctx.reply(t.muted(basename(target.cwd), dur));
  });

  // /unmute — unmute the targeted project.
  bot.command("unmute", async (ctx) => {
    const target = resolveTarget(ctx);
    if (!target) return void ctx.reply(t.noSession2);
    const was = unmute(target.cwd);
    await ctx.reply(was ? t.unmuted(basename(target.cwd)) : t.wasNotMuted);
  });

  // /muted — list currently muted projects.
  bot.command("muted", async (ctx) => {
    const list = listMuted();
    if (!list.length) return void ctx.reply(t.noMutedProjects);
    const lines = list.map((m) => {
      const when = m.until === Infinity ? "∞" : new Date(m.until).toLocaleTimeString(timeLocale());
      return t.mutedEntry(basename(m.cwd), when);
    });
    await ctx.reply(lines.join("\n"));
  });

  // Free text: a reply to a notification targets that session; a bare message
  // targets the most recent session. Sends the text as a prompt. Slash texts
  // still land here unless consumed by a bot command above, so CLI slash
  // commands (/model, /compact, ...) are forwarded to the session.
  const RESERVED = new Set(["start", "help"]); // never forward these to the CLI
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) {
      const cmd = text.slice(1).split(/[\s@]/)[0]!.toLowerCase();
      if (RESERVED.has(cmd)) return;
    }

    const target = resolveTarget(ctx);
    if (!target) {
      await ctx.reply(t.noKnownSession);
      return;
    }
    if (!(await paneAlive(target.pane))) {
      await ctx.reply(t.paneDead(target.pane));
      return;
    }

    await sendPrompt(target.pane, text);
    // Silent delivery confirmation: react to the user's message instead of
    // sending an extra chat message.
    try {
      await ctx.react("👍");
    } catch {
      await ctx.reply(t.sentTo(target.profile));
    }
  });

  bot
    .start({ onStart: (me) => console.log(`[bot] @${me.username} attivo`) })
    .catch((e) => console.error("[bot] polling terminato con errore:", e?.message ?? e));
  return true;
}

// Dedupe: suppress an identical (session + message) re-notification within this
// window. Claude Code re-fires the Notification hook (~60s idle) with the same
// text; without this the user gets duplicates.
const DEDUPE_MS = 90_000;
const CMD_MAX = 200; // truncate long commands in the message
// Buttons older than this are refused: the permission dialog is likely gone
// and the keystrokes would end up in the session's prompt input.
const ACTION_TTL_MS = 10 * 60 * 1000;
const lastPush = new Map<string, number>(); // key: sessionId::message

function pruneLastPush(now: number): void {
  if (lastPush.size < 200) return;
  for (const [k, t] of lastPush) if (now - t > DEDUPE_MS) lastPush.delete(k);
}

export interface PushOptions {
  chatId?: string; // per-project target override (must be in allowedChats)
  minRisk?: Risk; // skip notifications below this risk level
}

export async function pushAttention(s: SessionInfo, opts: PushOptions = {}): Promise<void> {
  if (!bot || !chatId) return;

  const risk = s.toolName ? riskFor(s.toolName, s.command) : "caution";
  if (opts.minRisk && RISK_RANK[risk] < RISK_RANK[opts.minRisk]) return;

  // Resolve target: honor a per-project override only if allow-listed.
  let target = chatId;
  if (opts.chatId) {
    if (allowedChats.has(opts.chatId)) target = opts.chatId;
    else console.warn(`[bot] chatId ${opts.chatId} non in allowlist — uso default`);
  }

  // Include the tool + command: Claude's permission `message` is generic
  // ("Claude needs your permission"), so keying on it alone would collapse two
  // different permission requests into one and suppress the second.
  const key = `${s.sessionId}::${target}::${s.lastMessage}::${s.toolName}::${s.command}`;
  const now = Date.now();
  const prev = lastPush.get(key) ?? 0;
  if (now - prev < DEDUPE_MS) return;
  pruneLastPush(now);
  lastPush.set(key, now);

  const kb = buildKeyboard(s);

  const folder = basename(s.cwd) || s.cwd;
  let text = `${iconForProject(folder)} *${escapeMd(cap(s.profile))}* · \`${escapeCode(folder)}\`\n${escapeMd(s.lastMessage)}`;

  // Tool awaiting permission, prefixed with its risk icon. Inline code spans
  // cannot contain newlines in MarkdownV2: flatten multiline commands.
  if (s.toolName) {
    const flat = s.command.replace(/\s*\n\s*/g, " ⏎ ");
    const cmd = flat ? `: \`${escapeCode(truncate(flat, CMD_MAX))}\`` : "";
    text += `\n\n${RISK_ICON[risk]} *${escapeMd(s.toolName)}*${cmd}`;
  }
  // The useful part of a recap ("what to do next") is at the END, so keep the
  // tail, not the head. Telegram caps a message at 4096 chars; header+tool are
  // small, so 1400 for the detail is safe.
  if (s.detail) text += `\n\n💬 ${escapeMd(tailText(s.detail, 1400))}`;

  let sent;
  try {
    sent = await bot.api.sendMessage(target, text, {
      parse_mode: "MarkdownV2",
      reply_markup: kb,
    });
  } catch (e) {
    // Never lose a notification to formatting: retry as plain text.
    console.error("[bot] markdown push failed, retrying plain:", (e as Error).message);
    const flatCmd = s.command.replace(/\s*\n\s*/g, " ⏎ ");
    const plain =
      `${iconForProject(folder)} ${cap(s.profile)} · ${folder}\n${s.lastMessage}` +
      (s.toolName ? `\n\n${RISK_ICON[risk]} ${s.toolName}: ${truncate(flatCmd, CMD_MAX)}` : "") +
      (s.detail ? `\n\n💬 ${tailText(s.detail, 1400)}` : "");
    sent = await bot.api.sendMessage(target, plain, { reply_markup: kb });
  }
  // Link the message so a reply routes back to this session.
  linkMessage(sent.message_id, s.sessionId);
  // Buttoned message -> track it so a local approval can retire the buttons.
  if (kb) livePerm.set(s.sessionId, { chatId: target, messageId: sent.message_id });
}

// A permission approved/handled on the PC (no remote tap): strip the dangling
// buttons from its Telegram message so the chat doesn't keep a dead prompt.
export async function markHandledLocally(sessionId: string): Promise<void> {
  const m = livePerm.get(sessionId);
  if (!m || !bot) return;
  livePerm.delete(sessionId);
  const when = new Date().toLocaleTimeString(timeLocale(), { hour: "2-digit", minute: "2-digit" });
  try {
    await bot.api.editMessageReplyMarkup(m.chatId, m.messageId, {
      reply_markup: new InlineKeyboard().text(`${t.markHandledLocal} · ${when}`, `noop:${sessionId}`),
    });
  } catch {
    // message too old or already edited — ignore
  }
}

// Completion feed for a remotely-approved tool: threaded under the original
// notification. Best-effort; a formatting failure retries as plain text.
export async function pushCompletion(o: {
  chatId: string;
  messageId?: number;
}): Promise<void> {
  if (!bot || !o.messageId) return;
  // React on the original request instead of sending a message: a remotely
  // approved tool finishing is a low-signal event, and a 👍 on the exact prompt
  // conveys "done" without adding a line to the chat. (✅ isn't a valid Telegram
  // reaction; 👍 is.)
  try {
    await bot.api.setMessageReaction(o.chatId, o.messageId, [{ type: "emoji", emoji: "👍" }]);
  } catch (e) {
    console.error("[bot] completion reaction failed:", (e as Error).message);
  }
}

function cap(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function buildKeyboard(s: SessionInfo): InlineKeyboard | undefined {
  // AskUserQuestion: one button per real answer (digit + Enter). The user can
  // still reply with free text for the implicit "Other" option.
  if (s.options.length > 0) {
    const kb = new InlineKeyboard();
    s.options.forEach((label, i) => {
      kb.text(`${i + 1}. ${truncate(label, 28)}`, `opt${i + 1}:${s.sessionId}`).row();
    });
    kb.text(t.btnCancel, `esc:${s.sessionId}`);
    return kb;
  }
  // Standard permission dialog. Buttons only here: on "waiting for input" a tap
  // would type into the session's prompt. "Nega" uses Escape, which cancels any
  // dialog regardless of option count, so a separate "Esc" button is redundant.
  if (s.isPermission) {
    const kb = new InlineKeyboard().text(t.btnApprove, `approve:${s.sessionId}`);
    if (s.hasAlways) kb.text(t.btnAlways, `always:${s.sessionId}`);
    kb.text(t.btnDeny, `deny:${s.sessionId}`);
    return kb;
  }
  return undefined;
}

// Keep the END of a long string — recaps put the actionable summary last, so
// tail-truncate instead of head. Drops a partial leading line and marks the cut.
function tailText(s: string, max: number): string {
  if (s.length <= max) return s;
  let cut = s.slice(s.length - max);
  const nl = cut.indexOf("\n");
  if (nl >= 0 && nl < 240) cut = cut.slice(nl + 1);
  return "…\n" + cut;
}

// Minimal MarkdownV2 escaping for the dynamic fields.
function escapeMd(s: string): string {
  return s.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

// Inside MarkdownV2 code spans only backslash and backtick are special;
// escaping anything else renders literal backslashes.
function escapeCode(s: string): string {
  return s.replace(/[`\\]/g, (c) => `\\${c}`);
}
