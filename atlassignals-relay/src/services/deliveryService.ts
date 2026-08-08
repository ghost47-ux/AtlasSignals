/**
 * deliveryService.ts — asynchronous notification delivery (outbox pattern).
 *
 * The webhook handler NEVER sends notifications inline. It only inserts a
 * `delivery_outbox` row (status=pending). A separate worker — run here
 * (`processPendingDeliveries`) via a cron/web worker, or in a future
 * notification service — picks up pending jobs and dispatches them through
 * the channel senders.
 *
 * PRODUCTION PATH (no worker, no cron): the Telegram send is driven by a
 * database trigger — migration 0005 (pg_net) fires on every delivery_outbox
 * insert and pushes to the Telegram Bot API immediately after commit. This
 * module is the manual / fallback path (and the base for future per-user
 * delivery via `delivery_channels`): `processPendingDeliveries` + the channel
 * senders can be run from a script or schedule if the trigger is ever
 * disabled. Discord / email senders remain placeholders.
 */
import { loadEnv } from '../config/env';
import type { DbClient } from '../db/supabase';
import { DELIVERY_OUTBOX_TABLE } from '../schemas/signal';
import type { StoredSignal } from './signalService';

export type ChannelType = 'telegram' | 'discord' | 'email';
export type OutboxStatus = 'pending' | 'sent' | 'failed';

export interface OutboxJob {
  id: string;
  signal_id: string;
  channel: ChannelType;
  status: OutboxStatus;
  attempts: number;
  created_at: string;
  sent_at: string | null;
}

export async function insertDeliveryJob(
  db: DbClient,
  signalId: string,
  channel: ChannelType,
): Promise<void> {
  const { error } = await db
    .from(DELIVERY_OUTBOX_TABLE)
    .insert({ signal_id: signalId, channel, status: 'pending', attempts: 0 });
  if (error) {
    throw error;
  }
}

// ─── Channel senders ─────────────────────────────────────────────────────────

export const TELEGRAM_API_BASE = 'https://api.telegram.org';

/** Timeout for a single Telegram sendMessage call (the worker retries). */
export const TELEGRAM_REQUEST_TIMEOUT_MS = 8_000;

/**
 * Render a signal as a plain-text Telegram message. Plain text (no HTML
 * parse_mode) keeps every field safe without escaping — signal strings like
 * setup_name / market_state may contain characters Telegram would try to
 * interpret as formatting.
 *
 * NOTE: this format is MIRRORED in the production delivery trigger
 * (supabase/migrations/0006_telegram_config.sql → dispatch_outbox_telegram,
 * which is what actually sends in production). If you change the card here,
 * update the SQL string there too — they must stay in sync.
 */
export function buildTelegramMessage(signal: StoredSignal): string {
  const line = (label: string, value: string | number | null | undefined): string =>
    `${label.padEnd(12)}${value ?? '—'}`;
  return [
    `⚡ ATLAS SIGNAL — ${signal.direction} ${signal.symbol} (${signal.timeframe})`,
    '────────────────────────────────',
    line('Entry:', signal.entry),
    line('Stop Loss:', signal.stop_loss),
    line('Take Profit:', signal.take_profit),
    line('Confidence:', `${signal.confidence}/100`),
    line('Setup:', signal.setup_name),
    line('Market:', signal.market_state),
    line('Engine:', signal.analysis_version),
    line('Signal time:', signal.created_at),
  ].join('\n');
}

/**
 * Deliver one outbox job through the Telegram Bot API.
 *
 * The signal row is fetched from the DB by signal_id (the outbox only stores
 * the reference — Telegram never becomes a source of truth). Sends to
 * TELEGRAM_CHAT_ID (per-user delivery via delivery_channels is the future
 * extension). Returns true only when the Bot API accepted the message.
 */
export async function sendTelegramSignal(
  job: OutboxJob,
  db: DbClient,
): Promise<boolean> {
  const env = loadEnv();
  const botToken = env.telegramBotToken;
  const chatId = env.telegramChatId;
  if (!botToken || !chatId) {
    return false;
  }

  const { data, error } = await db
    .from('signals')
    .select('*')
    .eq('signal_id', job.signal_id)
    .maybeSingle();
  if (error || !data) {
    return false;
  }

  const text = buildTelegramMessage(data as StoredSignal);
  try {
    const res = await fetch(
      `${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(TELEGRAM_REQUEST_TIMEOUT_MS),
      },
    );
    return res.ok;
  } catch {
    return false; // transient (network/timeout) — the worker retries the job
  }
}

export async function sendDiscordSignal(
  _job: OutboxJob,
  _db: DbClient,
): Promise<boolean> {
  // TODO(delivery): Discord webhook per-user delivery.
  return false;
}

export async function sendEmailSignal(
  _job: OutboxJob,
  _db: DbClient,
): Promise<boolean> {
  // TODO(delivery): transactional email provider per-user delivery.
  return false;
}

type ChannelSender = (job: OutboxJob, db: DbClient) => Promise<boolean>;

const CHANNEL_SENDERS: Record<ChannelType, ChannelSender> = {
  telegram: sendTelegramSignal,
  discord: sendDiscordSignal,
  email: sendEmailSignal,
};

/**
 * Process pending outbox jobs. Call this from a scheduler/cron (e.g. every 30s)
 * or a worker process. Each job gets `attempts` incremented; successful sends
 * are marked `sent` (with sent_at), failures stay `pending` for retry.
 */
export async function processPendingDeliveries(
  db: DbClient,
  options: { max?: number } = {},
): Promise<{ processed: number; sent: number }> {
  const max = options.max ?? 50;
  const { data, error } = await db
    .from(DELIVERY_OUTBOX_TABLE)
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(max);
  if (error) {
    throw error;
  }

  let sent = 0;
  const jobs = (data as OutboxJob[] | null) ?? [];
  for (const job of jobs) {
    const attempts = job.attempts + 1;
    let ok = false;
    try {
      ok = (await CHANNEL_SENDERS[job.channel]?.(job, db)) ?? false;
    } catch {
      ok = false;
    }
    if (ok) {
      sent += 1;
      await db
        .from(DELIVERY_OUTBOX_TABLE)
        .update({ status: 'sent', attempts, sent_at: new Date().toISOString() })
        .eq('id', job.id);
    } else {
      await db
        .from(DELIVERY_OUTBOX_TABLE)
        .update({ status: attempts >= 5 ? 'failed' : 'pending', attempts })
        .eq('id', job.id);
    }
  }
  return { processed: jobs.length, sent };
}
