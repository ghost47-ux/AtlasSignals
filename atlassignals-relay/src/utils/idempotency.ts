/**
 * idempotency.ts — deterministic idempotency-key derivation.
 *
 * Mirrors the Hugging Face Space (`signal_relay.build_idempotency_key`):
 * the key is a SHA-256 digest of the signal's own content, so re-sending the
 * same engine signal always produces the same key and can never be stored
 * twice. The `signals.idempotency_key` column is UNIQUE — that constraint is
 * the final backstop even if the fast-path SELECT is bypassed.
 */
import { createHash } from 'node:crypto';

export function makeIdempotencyKey(parts: Array<string | number>): string {
  const raw = parts.map((p) => String(p)).join('|');
  return createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 32);
}

/**
 * Convenience: the exact derivation the HF Space uses
 * (direction | entry | stop_loss | take_profit | bar_time).
 */
export function signalIdempotencyKey(input: {
  direction: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  barTime: string;
}): string {
  return makeIdempotencyKey([
    input.direction.toUpperCase(),
    input.entry.toFixed(2),
    input.stopLoss.toFixed(2),
    input.takeProfit.toFixed(2),
    input.barTime,
  ]);
}
