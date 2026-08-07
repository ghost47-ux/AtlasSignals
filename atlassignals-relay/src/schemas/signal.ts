/**
 * signal.ts — THE canonical signal schema.
 *
 * This schema is used everywhere: webhook validation, persistence mapping and
 * (implicitly) the HF Space payload contract. `.passthrough()` keeps the event
 * extensible — additive metadata (market category, visibility level, delivery
 * priority, source identifier, …) flows through into `raw_payload` without
 * breaking validation.
 */
import { z } from 'zod';

export const signalEventSchema = z
  .object({
    signal_id: z.string().uuid(),
    symbol: z.string().trim().min(1).max(32),
    direction: z.enum(['BUY', 'SELL']),
    timeframe: z.string().trim().min(1).max(16),
    entry: z.number(),
    stop_loss: z.number(),
    take_profit: z.number(),
    confidence: z.number().min(0).max(100),
    setup_name: z.string().trim().min(1).max(128),
    market_state: z.string().trim().min(1).max(128),
    analysis_version: z.string().trim().min(1).max(32),
    created_at: z.string().datetime({ offset: true }),
    idempotency_key: z.string().trim().min(8).max(128),
  })
  .passthrough();

export type SignalEvent = z.infer<typeof signalEventSchema>;

export const SIGNALS_TABLE = 'signals';
export const DELIVERY_OUTBOX_TABLE = 'delivery_outbox';
