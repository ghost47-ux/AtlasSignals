import { describe, expect, it } from 'vitest';
import { signalEventSchema } from '../../src/schemas/signal';
import { signalIdempotencyKey } from '../../src/utils/idempotency';

function validEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    signal_id: '3f2c2c3a-1b2c-4d5e-8f90-abcdef123456',
    symbol: 'XAU/USD',
    direction: 'BUY',
    timeframe: '15M',
    entry: 3365.42,
    stop_loss: 3358.1,
    take_profit: 3378.9,
    confidence: 84,
    setup_name: 'TIER_A_HIGH_QUALITY',
    market_state: 'TRENDING_UP/TRENDING',
    analysis_version: 'ITER_32',
    created_at: '2026-08-07T06:15:00.000+00:00',
    idempotency_key: signalIdempotencyKey({
      direction: 'BUY',
      entry: 3365.42,
      stopLoss: 3358.1,
      takeProfit: 3378.9,
      barTime: '2026-08-07T06:15:00.000+00:00',
    }),
    ...overrides,
  };
}

describe('signalEventSchema (canonical event)', () => {
  it('accepts a valid canonical event', () => {
    const result = signalEventSchema.safeParse(validEvent());
    expect(result.success).toBe(true);
  });

  it('rejects when a required field is missing', () => {
    const event = validEvent();
    delete event.entry;
    const result = signalEventSchema.safeParse(event);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'entry')).toBe(true);
    }
  });

  it('rejects an invalid direction', () => {
    const result = signalEventSchema.safeParse(validEvent({ direction: 'LONG' }));
    expect(result.success).toBe(false);
  });

  it('rejects confidence outside 0–100', () => {
    expect(signalEventSchema.safeParse(validEvent({ confidence: 101 })).success).toBe(false);
    expect(signalEventSchema.safeParse(validEvent({ confidence: -1 })).success).toBe(false);
  });

  it('rejects a non-ISO created_at', () => {
    expect(signalEventSchema.safeParse(validEvent({ created_at: 'yesterday' })).success).toBe(false);
  });

  it('rejects a non-UUID signal_id', () => {
    expect(signalEventSchema.safeParse(validEvent({ signal_id: 'not-a-uuid' })).success).toBe(false);
  });

  it('accepts additive passthrough metadata (future-safe)', () => {
    const event = validEvent({ metadata: { market_category: 'metals', visibility: 'paid', priority: 1 } });
    const result = signalEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });
});
