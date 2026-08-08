/**
 * telegramService.ts — Telegram multi-user linking + bot webhook handling.
 *
 * The bot is an EXTENSION of the website/backend, never a second app:
 *   • The website (logged-in user) requests a one-time link code
 *     (POST /telegram/link). The code row lives in `telegram_link_codes`.
 *   • The user taps t.me/<bot>?start=<code>; Telegram delivers /start <code>
 *     to the backend's bot webhook (setWebhook mode — Vercel-safe).
 *   • The backend redeems the code (RPC `redeem_telegram_link`) and the chat
 *     becomes a verified `delivery_channels` row for that user.
 *   • Signal fan-out to linked users happens in the database trigger
 *     (migrations 0005–0007) — never in this service.
 */
import type { DbClient } from '../db/supabase';
import { randomBytes } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { TELEGRAM_API_BASE } from './deliveryService';

export const TELEGRAM_LINK_TTL_SECONDS = 600; // 10 minutes

/** A unique, unguessable one-time code: `atlas_<16 hex>`. */
export function generateLinkCode(): string {
  return `atlas_${randomBytes(8).toString('hex')}`;
}

export interface TelegramLinkOutcome {
  code: string;
  expires_at: string;
  expires_in_seconds: number;
}

/** Create a one-time link code for a logged-in user (service-role insert). */
export async function createTelegramLinkCode(
  db: DbClient,
  userId: string,
): Promise<TelegramLinkOutcome> {
  const code = generateLinkCode();
  const expiresAt = new Date(Date.now() + TELEGRAM_LINK_TTL_SECONDS * 1000);
  const { error } = await db.from('telegram_link_codes').insert({
    user_id: userId,
    code,
    expires_at: expiresAt.toISOString(),
  });
  if (error) {
    throw error;
  }
  return { code, expires_at: expiresAt.toISOString(), expires_in_seconds: TELEGRAM_LINK_TTL_SECONDS };
}

export interface RedeemResult {
  ok: boolean;
  email?: string;
  reason?: string;
}

/** Redeem a link code via the DB function (validates, links, marks used). */
export async function redeemTelegramLink(
  db: DbClient,
  code: string,
  chatId: number | string,
  log: FastifyBaseLogger,
): Promise<RedeemResult> {
  const { data, error } = await db.rpc('redeem_telegram_link', {
    p_code: code,
    p_chat_id: String(chatId),
  });
  if (error) {
    log.error({ err: error, code }, 'telegram: redeem rpc failed');
    throw error;
  }
  return (data as RedeemResult | null) ?? { ok: false, reason: 'no_response' };
}

/** Send a plain-text message from the bot to a chat. Returns true on 2xx. */
export async function sendTelegramMessage(
  token: string,
  chatId: number | string,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchImpl(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Parse the payload of a Telegram deep link. `t.me/<bot>?start=atlas_xxx`
 * arrives as the message text `/start atlas_xxx`.
 */
export function parseStartCommand(text: string | undefined): { payload?: string } {
  if (!text) return {};
  const trimmed = text.trim();
  if (!trimmed.startsWith('/start')) return {};
  return { payload: trimmed.split(/\s+/)[1] };
}

/** Point Telegram at the backend's bot webhook (call once after deploy). */
export async function setTelegramWebhook(
  token: string,
  url: string,
  secretToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const res = await fetchImpl(`${TELEGRAM_API_BASE}/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, secret_token: secretToken, drop_pending_updates: true }),
  });
  return res.ok;
}
