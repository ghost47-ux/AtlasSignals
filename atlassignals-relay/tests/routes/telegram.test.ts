import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import { createFakeDb } from '../helpers/fakeDb';

const BOT_TOKEN = 'bot-test-token';
const WEBHOOK_SECRET = 'tg-webhook-secret';
const GOOD_TOKEN = 'good.jwt.token';
const AUTH_UID = 'auth-user-1';
const USER_ID = 'user-1';

function stubFetch(replyOk = true): { fetchStub: ReturnType<typeof vi.fn>; sent: Array<{ url: string; body: Record<string, unknown> }> } {
  const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchStub = vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    return { ok: replyOk, status: replyOk ? 200 : 500, json: async () => ({}) };
  });
  return { fetchStub, sent };
}

async function makeApp(
  fake: ReturnType<typeof createFakeDb>,
  opts: { botToken?: string; webhookSecret?: string; fetchImpl?: typeof fetch } = {},
): Promise<FastifyInstance> {
  return buildApp({
    db: fake.db,
    webhookSecret: 'webhook-test-secret',
    verifyJwt: async (token: string) => (token === GOOD_TOKEN ? { sub: AUTH_UID } : null),
    telegramBotToken: opts.botToken ?? '',
    telegramWebhookSecret: opts.webhookSecret ?? '',
    telegramFetch: opts.fetchImpl,
    sseEnabled: false,
    logger: { level: 'silent' },
  });
}

function provisionedFake() {
  return createFakeDb({
    initialUsers: [{ id: USER_ID, auth_id: AUTH_UID, email: 'user@example.com', role: 'paid' }],
  });
}

function botUpdate(text: string, chatId = 8772474262): Record<string, unknown> {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      from: { id: 123, is_bot: false, first_name: 'Test', username: 'tester' },
      chat: { id: chatId, type: 'private', first_name: 'Test' },
      date: 1_700_000_000,
      text,
    },
  };
}

function tgHeaders(body: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET };
}

describe('POST /telegram/link', () => {
  it('rejects a request without a token (401)', async () => {
    const fake = provisionedFake();
    const app = await makeApp(fake, { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET });
    const res = await app.inject({ method: 'POST', url: '/telegram/link' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('answers 503 when the bot is not configured', async () => {
    const fake = provisionedFake();
    const app = await makeApp(fake, { webhookSecret: WEBHOOK_SECRET });
    const res = await app.inject({
      method: 'POST',
      url: '/telegram/link',
      headers: { authorization: `Bearer ${GOOD_TOKEN}` },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('bot_not_configured');
    await app.close();
  });

  it('creates a one-time code for the authenticated user (200)', async () => {
    const fake = provisionedFake();
    const app = await makeApp(fake, { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET });
    const res = await app.inject({
      method: 'POST',
      url: '/telegram/link',
      headers: { authorization: `Bearer ${GOOD_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.code).toMatch(/^atlas_[0-9a-f]{16}$/);
    expect(json.expires_in_seconds).toBe(600);
    expect(fake.linkCodes.length).toBe(1);
    expect(fake.linkCodes[0].user_id).toBe(USER_ID);
    expect(fake.linkCodes[0].code).toBe(json.code);
    await app.close();
  });
});

describe('POST /webhooks/telegram', () => {
  it('answers 503 when the bot is not configured', async () => {
    const fake = createFakeDb();
    const app = await makeApp(fake, { webhookSecret: WEBHOOK_SECRET });
    const body = JSON.stringify(botUpdate('/start'));
    const res = await app.inject({ method: 'POST', url: '/webhooks/telegram', headers: tgHeaders(body), payload: body });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it('rejects a request without the secret token (401)', async () => {
    const fake = createFakeDb();
    const app = await makeApp(fake, { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET });
    const body = JSON.stringify(botUpdate('/start'));
    // Telegram always sends content-type: application/json; the missing piece
    // here is the secret token — that must be rejected before any handling.
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/telegram',
      headers: { 'content-type': 'application/json' },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid_secret');
    await app.close();
  });

  it('rejects a request with a wrong secret token (401)', async () => {
    const fake = createFakeDb();
    const app = await makeApp(fake, { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET });
    const body = JSON.stringify(botUpdate('/start'));
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/telegram',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'wrong' },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    expect(fake.calls.rpcCalls.length).toBe(0);
    await app.close();
  });

  it('redeems a deep-link code, replies with the email and acks (200)', async () => {
    const { fetchStub, sent } = stubFetch();
    const fake = createFakeDb({
      rpcHandlers: {
        redeem_telegram_link: (params) => {
          expect(params.p_code).toBe('atlas_abc123');
          expect(params.p_chat_id).toBe('8772474262');
          return { data: { ok: true, email: 'user@example.com' } };
        },
      },
    });
    const app = await makeApp(fake, { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET, fetchImpl: fetchStub as unknown as typeof fetch });
    const body = JSON.stringify(botUpdate('/start atlas_abc123'));
    const res = await app.inject({ method: 'POST', url: '/webhooks/telegram', headers: tgHeaders(body), payload: body });

    expect(res.statusCode).toBe(200);
    expect(res.json().received).toBe(true);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(sent[0].body.chat_id).toBe(8772474262);
    expect(String(sent[0].body.text)).toContain('user@example.com');
    await app.close();
  });

  it('tells the user when the link code is invalid or expired', async () => {
    const { fetchStub, sent } = stubFetch();
    const fake = createFakeDb({
      rpcHandlers: {
        redeem_telegram_link: () => ({ data: { ok: false, reason: 'invalid_or_expired' } }),
      },
    });
    const app = await makeApp(fake, { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET, fetchImpl: fetchStub as unknown as typeof fetch });
    const body = JSON.stringify(botUpdate('/start atlas_expired'));
    const res = await app.inject({ method: 'POST', url: '/webhooks/telegram', headers: tgHeaders(body), payload: body });
    expect(res.statusCode).toBe(200);
    expect(String(sent[0].body.text)).toContain('invalid or expired');
    await app.close();
  });

  it('welcomes on /start without a payload and points to the website', async () => {
    const { fetchStub, sent } = stubFetch();
    const fake = createFakeDb();
    const app = await makeApp(fake, { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET, fetchImpl: fetchStub as unknown as typeof fetch });
    const body = JSON.stringify(botUpdate('/start'));
    const res = await app.inject({ method: 'POST', url: '/webhooks/telegram', headers: tgHeaders(body), payload: body });
    expect(res.statusCode).toBe(200);
    const text = String(sent[0].body.text);
    expect(text).toContain('Sign up or log in');
    expect(text).toContain('atlassignals-web.vercel.app');
    await app.close();
  });

  it('answers /help with the command list', async () => {
    const { fetchStub, sent } = stubFetch();
    const fake = createFakeDb();
    const app = await makeApp(fake, { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET, fetchImpl: fetchStub as unknown as typeof fetch });
    const body = JSON.stringify(botUpdate('/help'));
    const res = await app.inject({ method: 'POST', url: '/webhooks/telegram', headers: tgHeaders(body), payload: body });
    expect(res.statusCode).toBe(200);
    expect(String(sent[0].body.text)).toContain('/start');
    await app.close();
  });

  it('acknowledges non-command messages with guidance', async () => {
    const { fetchStub, sent } = stubFetch();
    const fake = createFakeDb();
    const app = await makeApp(fake, { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET, fetchImpl: fetchStub as unknown as typeof fetch });
    const body = JSON.stringify(botUpdate('hello there'));
    const res = await app.inject({ method: 'POST', url: '/webhooks/telegram', headers: tgHeaders(body), payload: body });
    expect(res.statusCode).toBe(200);
    expect(String(sent[0].body.text)).toContain('delivery bot');
    await app.close();
  });

  it('acks malformed updates without replying (no retry storm)', async () => {
    const { fetchStub } = stubFetch();
    const fake = createFakeDb();
    const app = await makeApp(fake, { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET, fetchImpl: fetchStub as unknown as typeof fetch });
    const body = JSON.stringify({ update_id: 2 }); // missing message
    const res = await app.inject({ method: 'POST', url: '/webhooks/telegram', headers: tgHeaders(body), payload: body });
    expect(res.statusCode).toBe(200);
    expect(fetchStub).not.toHaveBeenCalled();
    await app.close();
  });
});
