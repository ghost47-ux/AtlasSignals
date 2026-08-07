/**
 * signalService.ts — signal persistence and queries (source of truth).
 *
 * The canonical event is stored 1:1 into the `signals` table. The full event
 * (including any passthrough metadata from the engine) is preserved in
 * `raw_payload` so no analysis context is ever lost.
 */
import type { DbClient } from '../db/supabase';
import { SIGNALS_TABLE, type SignalEvent } from '../schemas/signal';

export interface StoredSignal {
  id: string;
  signal_id: string;
  symbol: string;
  direction: string;
  timeframe: string;
  entry: number;
  stop_loss: number;
  take_profit: number;
  confidence: number;
  setup_name: string;
  market_state: string;
  analysis_version: string;
  created_at: string;
  idempotency_key: string;
  raw_payload: unknown;
  inserted_at: string;
}

/** True when a PostgrestError is a unique-violation (duplicate idempotency_key). */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === '23505'
  );
}

export async function findSignalByIdempotencyKey(
  db: DbClient,
  idempotencyKey: string,
): Promise<{ signal_id: string } | null> {
  const { data, error } = await db
    .from(SIGNALS_TABLE)
    .select('signal_id')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return (data as { signal_id: string } | null) ?? null;
}

export async function insertSignal(
  db: DbClient,
  event: SignalEvent,
): Promise<StoredSignal> {
  const row = {
    signal_id: event.signal_id,
    symbol: event.symbol,
    direction: event.direction,
    timeframe: event.timeframe,
    entry: event.entry,
    stop_loss: event.stop_loss,
    take_profit: event.take_profit,
    confidence: event.confidence,
    setup_name: event.setup_name,
    market_state: event.market_state,
    analysis_version: event.analysis_version,
    created_at: event.created_at,
    idempotency_key: event.idempotency_key,
    raw_payload: event, // JSONB — full event incl. passthrough metadata
  };
  const { data, error } = await db
    .from(SIGNALS_TABLE)
    .insert(row)
    .select()
    .single();
  if (error) {
    throw error;
  }
  return data as StoredSignal;
}

export async function getLatestSignal(db: DbClient): Promise<StoredSignal | null> {
  const { data, error } = await db
    .from(SIGNALS_TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return (data as StoredSignal | null) ?? null;
}

export async function listSignals(
  db: DbClient,
  options: { limit: number; offset: number },
): Promise<StoredSignal[]> {
  const limit = Math.min(Math.max(options.limit, 1), 200);
  const offset = Math.max(options.offset, 0);
  const { data, error } = await db
    .from(SIGNALS_TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) {
    throw error;
  }
  return (data as StoredSignal[]) ?? [];
}

export async function getSignalBySignalId(
  db: DbClient,
  signalId: string,
): Promise<StoredSignal | null> {
  const { data, error } = await db
    .from(SIGNALS_TABLE)
    .select('*')
    .eq('signal_id', signalId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return (data as StoredSignal | null) ?? null;
}

export async function checkDatabaseHealth(db: DbClient): Promise<boolean> {
  const { error } = await db.from(SIGNALS_TABLE).select('id').limit(1);
  return !error;
}
