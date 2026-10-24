import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setStatePath } from '../src/core/persist.js';

// The Telegram layer end to end, with grammy and the panes replaced: no network,
// no bot token, no keystroke reaches a real terminal.
type Handler = (ctx: any, next?: () => Promise<void>) => Promise<unknown> | unknown;
const tg = vi.hoisted(() => ({
  middleware: [] as Handler[],
  handlers: new Map<string, Handler>(),
  nextMessageId: 1,
  sent: [] as { chat: string; text: string; buttons: string[]; messageId: number }[]
}));
vi.mock('grammy', () => {
  class InlineKeyboard {
    buttons: string[] = [];
    text(_label: string, data: string) {
      this.buttons.push(data);
      return this;
    }
    row() {
      return this;
    }
  }
  class Bot {
    api = {
      sendMessage: vi.fn(async (chat: string, text: string, opts: { reply_markup?: InlineKeyboard }) => {
        const messageId = tg.nextMessageId++;
        tg.sent.push({ chat, text, buttons: opts?.reply_markup?.buttons ?? [], messageId });
        return { message_id: messageId };
      }),
      editMessageReplyMarkup: vi.fn(async () => {}),
      setMessageReaction: vi.fn(async () => {})
    };
    constructor() {
      tg.middleware = [];
      tg.handlers.clear();
    }
    use(fn: Handler) {
      tg.middleware.push(fn);
    }
    on(event: string, fn: Handler) {
      tg.handlers.set(event, fn);
    }
    command(name: string, fn: Handler) {
      tg.handlers.set(`/${name}`, fn);
    }
    start() {
      return new Promise(() => {});
    }
    async stop() {}
    isRunning() {
      return true;
    }
  }
  return { Bot, InlineKeyboard, GrammyError: class extends Error {} };
});
const pane = vi.hoisted(() => ({
  paneAlive: vi.fn(async () => true),
  paneBlockedBy: vi.fn(async (_pane: string) => ''),
  sendKey: vi.fn(async (_pane: string, _key: string) => true),
  sendPrompt: vi.fn(async (_pane: string, _text: string) => true)
}));
vi.mock('../src/main/pane-control.js', () => pane);

let bot: typeof import('../src/main/cerberus/bot.js');
let reg: typeof import('../src/core/registry.js');
let dir: string;
let updateId = 1;

const ENV = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_ALLOWED_CHATS', 'CERBERUS_LANG'] as const;
const savedEnv = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cerberus-bot-'));
  setStatePath(join(dir, 'state.json'));
  process.env['TELEGRAM_BOT_TOKEN'] = 'test-token-1';
  process.env['TELEGRAM_CHAT_ID'] = '100';
  process.env['TELEGRAM_ALLOWED_CHATS'] = '200';
  delete process.env['CERBERUS_LANG'];
  reg = await import('../src/core/registry.js');
  bot = await import('../src/main/cerberus/bot.js');
  bot.initBot();
});
afterAll(() => {
  for (const k of ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  vi.clearAllMocks();
  pane.paneAlive.mockResolvedValue(true);
  pane.paneBlockedBy.mockResolvedValue('');
  pane.sendKey.mockResolvedValue(true);
  pane.sendPrompt.mockResolvedValue(true);
  tg.sent = [];
});

// Runs an update through the bot's middleware, then the matching handler.
async function dispatch(event: string, ctx: any): Promise<void> {
  ctx.update = { update_id: updateId++ };
  let i = 0;
  const next = async (): Promise<void> => {
    const mw = tg.middleware[i++];
    if (mw) await mw(ctx, next);
    else await tg.handlers.get(event)?.(ctx);
  };
  await next();
}

function tap(chat: string, data: string, messageId = 1) {
  const ctx = {
    chat: { id: Number(chat) },
    callbackQuery: { data, message: { message_id: messageId } },
    answerCallbackQuery: vi.fn(async () => {}),
    editMessageReplyMarkup: vi.fn(async () => {})
  };
  return dispatch('callback_query:data', ctx).then(() => ctx);
}

function say(chat: string, text: string, replyTo?: number) {
  const ctx = {
    chat: { id: Number(chat) },
    message: { text, ...(replyTo ? { reply_to_message: { message_id: replyTo } } : {}) },
    reply: vi.fn(async (_text: string) => {}),
    react: vi.fn(async (_emoji: string) => {})
  };
  return dispatch('message:text', ctx).then(() => ctx);
}

// A permission notification as the daemon would raise it, pushed to `chat`.
async function notify(sessionId: string, command: string, chat?: string) {
  const s = reg.upsertSession({
    sessionId,
    agent: 'claude',
    pane: `pane-${sessionId}`,
    profile: 'claude',
    cwd: `/proj/${sessionId}`,
    lastMessage: 'Claude needs your permission to use Bash',
    detail: '',
    toolName: 'Bash',
    command,
    options: [],
    hasAlways: false,
    isPermission: true,
    decisionId: reg.requestIdFor(sessionId, {
      message: 'Claude needs your permission to use Bash',
      toolName: 'Bash',
      command,
      options: [],
      isPermission: true
    })
  });
  expect(await bot.pushAttention(s, chat ? { chatId: chat } : {})).toBe(true);
  return tg.sent.at(-1)!;
}

const answer = (ctx: any): string => ctx.answerCallbackQuery.mock.calls[0]?.[0]?.text ?? '';

describe('buttons answer only the prompt they were sent for', () => {
  it('refuses a button from a prompt that a newer one replaced', async () => {
    const a = await notify('s1', 'echo A');
    const b = await notify('s1', 'rm -rf build');
    expect(a.buttons[0]).not.toBe(b.buttons[0]);

    const stale = await tap('100', a.buttons[0]!, a.messageId);
    expect(answer(stale)).toMatch(/Outdated/);
    expect(pane.sendKey).not.toHaveBeenCalled();

    const live = await tap('100', b.buttons[0]!, b.messageId);
    expect(answer(live)).toMatch(/^approve/);
    expect(pane.sendKey).toHaveBeenCalled();
  });

  it('acts on a double tap once', async () => {
    const m = await notify('s2', 'npm test');
    const [first, second] = await Promise.all([tap('100', m.buttons[0]!), tap('100', m.buttons[0]!)]);
    // approve = "1" + Enter for Claude: the sequence goes out once.
    expect(pane.sendKey.mock.calls).toEqual([
      ['pane-s2', '1'],
      ['pane-s2', 'Enter']
    ]);
    expect([answer(first), answer(second)].filter((a) => /Outdated/.test(a))).toHaveLength(1);
  });

  it('refuses a tap after the prompt was answered at the keyboard', async () => {
    const m = await notify('s3', 'git push');
    reg.clearRequest('s3');
    const ctx = await tap('100', m.buttons[0]!);
    expect(answer(ctx)).toMatch(/Outdated/);
    expect(pane.sendKey).not.toHaveBeenCalled();
  });

  it('refuses buttons from before request ids existed', async () => {
    await notify('s4', 'ls');
    const ctx = await tap('100', 'approve:s4');
    expect(answer(ctx)).toMatch(/Outdated/);
    expect(pane.sendKey).not.toHaveBeenCalled();
  });

  it('keeps the message working when Claude re-notifies the same pending prompt', async () => {
    const m = await notify('s5', 'make build');
    // Re-fired ~60s later: deduped, so no new message, and the old buttons still count.
    const s = reg.getSession('s5')!;
    reg.upsertSession({ ...s, decisionId: reg.requestIdFor('s5', { message: s.lastMessage, toolName: 'Bash', command: 'make build', options: [], isPermission: true }) });
    const ctx = await tap('100', m.buttons[0]!);
    expect(answer(ctx)).toMatch(/^approve/);
  });

  it('does not report success when the pane refused the keys', async () => {
    const m = await notify('s6', 'ls');
    pane.sendKey.mockResolvedValueOnce(false);
    const ctx = await tap('100', m.buttons[0]!);
    expect(answer(ctx)).toMatch(/Not delivered/);
    expect(ctx.editMessageReplyMarkup).not.toHaveBeenCalled();
  });
});

describe('text routing stays inside its chat', () => {
  it('routes a reply by chat and message id, so equal ids in two chats do not mix', async () => {
    tg.nextMessageId = 50;
    const one = await notify('t1', 'a', '100');
    tg.nextMessageId = 50;
    const two = await notify('t2', 'b', '200');
    expect(one.messageId).toBe(two.messageId);

    await say('200', 'continue', two.messageId);
    expect(pane.sendPrompt).toHaveBeenCalledWith('pane-t2', 'continue');
  });

  it('sends a bare message to the session last notified in that chat', async () => {
    await notify('t3', 'x', '100');
    await notify('t4', 'y', '200');
    await say('100', 'go on');
    expect(pane.sendPrompt).toHaveBeenLastCalledWith('pane-t3', 'go on');
  });

  it('refuses a reply it cannot trace instead of guessing a session', async () => {
    await notify('t5', 'z', '100');
    const ctx = await say('100', 'yes', 987654);
    expect(pane.sendPrompt).not.toHaveBeenCalled();
    expect(ctx.reply.mock.calls[0]?.[0]).toMatch(/can't tell which session/);
  });

  it('refuses a bare message in a chat no session has notified', async () => {
    reg.forgetMessageLinks();
    const ctx = await say('200', 'hello');
    expect(pane.sendPrompt).not.toHaveBeenCalled();
    expect(ctx.reply.mock.calls[0]?.[0]).toMatch(/No session has notified/);
  });

  it('does not confirm a prompt the pane refused', async () => {
    const m = await notify('t6', 'w', '100');
    pane.sendPrompt.mockResolvedValueOnce(false);
    pane.paneBlockedBy.mockResolvedValueOnce('').mockResolvedValueOnce('zsh');
    const ctx = await say('100', 'run it', m.messageId);
    expect(ctx.react).not.toHaveBeenCalled();
    expect(ctx.reply.mock.calls[0]?.[0]).toMatch(/running zsh, not the agent/);
  });
});

describe('settings changes take effect on the running bot', () => {
  it('revokes a chat removed from the allowlist', async () => {
    const m = await notify('u1', 'ls', '200');
    process.env['TELEGRAM_ALLOWED_CHATS'] = '';
    bot.restartBot();
    await say('200', 'still here?', m.messageId);
    expect(pane.sendPrompt).not.toHaveBeenCalled();
    process.env['TELEGRAM_ALLOWED_CHATS'] = '200';
    bot.restartBot();
  });

  it('stops pushing once the token is removed, and forgets the old bot\'s links', async () => {
    const m = await notify('u2', 'ls', '100');
    delete process.env['TELEGRAM_BOT_TOKEN'];
    expect(bot.restartBot()).toBe(false);
    expect(await bot.pushAttention(reg.getSession('u2')!)).toBe(false);

    process.env['TELEGRAM_BOT_TOKEN'] = 'test-token-2';
    expect(bot.restartBot()).toBe(true);
    expect(reg.hasMessageLink('100', m.messageId)).toBe(false);
  });
});
