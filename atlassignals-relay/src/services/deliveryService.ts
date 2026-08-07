/**
 * deliveryService.ts — asynchronous notification delivery (outbox pattern).
 *
 * The webhook handler NEVER sends notifications inline. It only inserts a
 * `delivery_outbox` row (status=pending). A separate worker — run here
 * (`processPendingDeliveries`) via a cron/web worker, or in a future
 * notification service — picks up pending jobs and dispatches them through
 * the channel senders.
 *
 * Channel senders are intentionally placeholders: the signal pipeline,
 * persistence and outbox are complete; only the actual Telegram / Discord /
 * email integrations remain (see docs/handoff.md → roadmap).
 */
import type { DbClient } from '../db/supabase';
import { DELIVERY_OUTBOX_TABLE } from '../schemas/signal';

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

// ─── Channel senders (placeholders — NOT yet implemented) ───────────────────

export async function sendTelegramSignal(job: OutboxJob): Promise<boolean> {
  // TODO(delivery): call the Telegram Bot API with TELEGRAM_BOT_TOKEN /
  // TELEGRAM_CHAT_ID, then mark the outbox row sent.
  return false;
}

export async function sendDiscordSignal(job: OutboxJob): Promise<boolean> {
  // TODO(delivery): Discord webhook per-user delivery.
  return false;
}

export async function sendEmailSignal(job: OutboxJob): Promise<boolean> {
  // TODO(delivery): transactional email provider per-user delivery.
  return false;
}

const CHANNEL_SENDERS: Record<ChannelType, (job: OutboxJob) => Promise<boolean>> = {
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
      ok = await CHANNEL_SENDERS[job.channel]?.(job) ?? false;
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
