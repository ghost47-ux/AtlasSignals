import { describe, expect, it } from 'vitest';
import { makeIdempotencyKey, signalIdempotencyKey } from '../../src/utils/idempotency';

describe('makeIdempotencyKey', () => {
  it('produces the same key for identical inputs', () => {
    expect(makeIdempotencyKey(['BUY', '3365.42', '3358.10', '3378.90', 'bar'])).toBe(
      makeIdempotencyKey(['BUY', '3365.42', '3358.10', '3378.90', 'bar']),
    );
  });

  it('produces a different key when any input changes', () => {
    expect(makeIdempotencyKey(['BUY', '3365.42'])).not.toBe(
      makeIdempotencyKey(['SELL', '3365.42']),
    );
    expect(makeIdempotencyKey(['BUY', '3365.42'])).not.toBe(
      makeIdempotencyKey(['BUY', '3365.43']),
    );
  });

  it('returns a 32-char hex key', () => {
    const key = makeIdempotencyKey(['X']);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('signalIdempotencyKey', () => {
  const input = {
    direction: 'BUY',
    entry: 3365.42,
    stopLoss: 3358.1,
    takeProfit: 3378.9,
    barTime: '2026-08-07T06:15:00+00:00',
  };

  it('is stable for the same signal content', () => {
    expect(signalIdempotencyKey(input)).toBe(signalIdempotencyKey(input));
  });

  it('changes when prices change (new signal)', () => {
    expect(signalIdempotencyKey(input)).not.toBe(
      signalIdempotencyKey({ ...input, entry: 3370.0 }),
    );
  });
});
