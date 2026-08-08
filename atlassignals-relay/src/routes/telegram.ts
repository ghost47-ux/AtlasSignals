/**
 * telegram.ts — Telegram multi-user routes.
 *
 *   POST /telegram/link      (JWT)  create a one-time deep-link code
 *   POST /webhooks/telegram  (secret token)  Telegram Bot API webhook
 *
 * The bot webhook is verified with Telegram's `X-Telegram-Bot-Api-Secret-Token`
 * header (set via setWebhook). It handles /start deep links (link redemption)
 * and friendly replies; it never owns signal state — the database does.
 */
import type { FastifyInstance } from 'fastify';
import type { DbClient } from '../db/supabase';
import type { AuthMiddleware } from '../middleware/requireAuth';
import { telegramUpdateSchema } from '../schemas/telegram';
import {
  createTelegramLinkCode,
  parseStartCommand,
  redeemTelegramLink,
  sendTelegramMessage,
} from '../services/telegramService';

export const WEBSITE_URL = 'https://atlassignals-web.vercel.app';

export interface TelegramRouteOptions {
  db: DbClient;
  requireAuth: AuthMiddleware;
  botToken: () => string;
  webhookSecret: () => string;
  fetchImpl?: typeof fetch;
}

export default async function telegramRoutes(
  app: FastifyInstance,
  opts: TelegramRouteOptions,
): Promise<void> {
  const { db, requireAuth, botToken, webhookSecret } = opts;

  app.post(
    '/telegram/link',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = request.appUser;
      if (!user) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      if (!botToken()) {
        return reply.code(503).send({ error: 'bot_not_configured' });
      }
      try {
        const outcome = await createTelegramLinkCode(db, user.id);
        return reply.send(outcome);
      } catch (err) {
        request.log.error({ err }, 'telegram: link code creation failed');
        return reply.code(500).send({ error: 'internal_error' });
      }
    },
  );

  app.post('/webhooks/telegram', async (request, reply) => {
    const token = botToken();
    if (!token) {
      return reply.code(503).send({ error: 'bot_not_configured' });
    }

    const expected = webhookSecret();
    const received = request.headers['x-telegram-bot-api-secret-token'];
    if (!expected || received !== expected) {
      request.log.warn({ remote: request.ip }, 'telegram: webhook secret mismatch');
      return reply.code(401).send({ error: 'invalid_secret' });
    }

    const parsed = telegramUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      // Not Telegram-shaped — ack (200) to avoid retry storms, log loudly.
      request.log.warn({ issues: parsed.error.issues.map((i) => i.path.join('.')) }, 'telegram: update parse failed');
      return reply.code(200).send({ received: true });
    }

    const message = parsed.data.message;
    const text = message?.text?.trim();
    if (!message || !text) {
      return reply.code(200).send({ received: true });
    }

    const chatId = message.chat.id;
    const fromName = message.from?.username ?? message.from?.first_name ?? 'there';
    const { payload } = parseStartCommand(text);

    let replyText: string;
    if (text.startsWith('/start') && payload) {
      // Deep link: t.me/<bot>?start=<code> — link this chat to the web user.
      try {
        const result = await redeemTelegramLink(db, payload, chatId, request.log);
        replyText = result.ok
          ? `✅ Linked to **${result.email}**.\n\nFrom now on you'll receive every approved AtlasSignals signal right here — instantly. Manage this in the website dashboard.`
          : `⚠️ That link code is invalid or expired.\n\nOpen ${WEBSITE_URL}, log in, and go to **Settings → Connect Telegram** to generate a fresh one.`;
      } catch (err) {
        request.log.error({ err }, 'telegram: redeem failed');
        replyText = '⚠️ Something went wrong while linking. Please try again in a moment.';
      }
    } else if (text.startsWith('/start')) {
      replyText =
        `Welcome to AtlasSignals ⚡, ${fromName}!\n\n` +
        `I deliver XAU/USD signals straight to this chat the moment they're approved — but first we need to link you.\n\n` +
        `1️⃣  Sign up or log in at ${WEBSITE_URL}\n` +
        `2️⃣  Open **Settings → Connect Telegram**\n` +
        `3️⃣  Tap the link there and this chat is linked.\n\n` +
        `Type /help for commands.`;
    } else if (text.startsWith('/help')) {
      replyText =
        `Commands:\n` +
        `• /start — welcome + linking instructions\n` +
        `• /help — this list\n\n` +
        `Everything else happens on the website (${WEBSITE_URL}): account, plan, signal history, and the support chat.`;
    } else {
      replyText =
        `I'm the AtlasSignals delivery bot ⚡ — I push approved XAU/USD signals to linked chats.\n\n` +
        `To link this chat: ${WEBSITE_URL} → Settings → Connect Telegram.`;
    }

    await sendTelegramMessage(token, chatId, replyText, opts.fetchImpl);
    return reply.code(200).send({ received: true });
  });
}
