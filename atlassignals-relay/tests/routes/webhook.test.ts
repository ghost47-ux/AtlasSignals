import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import { computeSignature } from '../../src/middleware/verifySignature';
import { createFakeDb } from '../helpers/fakeDb';
import { signalIdempotencyKey } from '../../src/utils/idempotency';

const SECRET = 'webhook-test-secret';

function validEvent(): Record<string, unknown> {
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
    metadata: { setup_tier: 'A', sweep_reclaim: true },
  };
}

function sign(body: string): string {
  return computeSignature(Buffer.from(body), SECRET);
}

function jsonEventBody(event: Record<string, unknown>): string {
  return JSON.stringify(event);
}

async function makeApp(fake: ReturnType<typeof createFakeDb>): Promise<FastifyInstance> {
  return buildApp({
    db: fake.db,
    webhookSecret: SECRET,
    sseEnabled: false,
    logger: { level: 'silent' },
  });
}

describe('POST /webhooks/signal', () => {
  it('rejects a request without a signature (401)', async () => {
    const fake = createFakeDb();
    const app = await makeApp(fake);
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/signal',
      headers: { 'content-type': 'application/json' },
      payload: jsonEventBody(validEvent()),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid_signature');
    expect(fake.signals.length).toBe(0);
    await app.close();
  });

  it('rejects a request with an invalid signature (401)', async () => {
    const fake = createFakeDb();
    const app = await makeApp(fake);
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/signal',
      headers: {
        'content-type': 'application/json',
        'x-atlas-signature': computeSignature(Buffer.from('something-else'), SECRET),
      },
      payload: jsonEventBody(validEvent()),
    });
    expect(res.statusCode).toBe(401);
    expect(fake.signals.length).toBe(0);
    await app.close();
  });

  it('rejects an invalid payload (422) even with a valid signature', async () => {
    const fake = createFakeDb();
    const app = await makeApp(fake);
    const event = validEvent();
    delete event.entry; // missing required field
    const body = jsonEventBody(event);
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/signal',
      headers: {
        'content-type': 'application/json',
        'x-atlas-signature': sign(body),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('invalid_payload');
    expect(fake.signals.length).toBe(0);
    await app.close();
  });

  it('stores a valid signal, inserts a delivery job and returns 200 quickly', async () => {
    const fake = createFakeDb();
    const app = await makeApp(fake);
    const body = jsonEventBody(validEvent());
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/signal',
      headers: {
        'content-type': 'application/json',
        'x-atlas-signature': sign(body),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.received).toBe(true);
    expect(json.signal_id).toBe(validEvent().signal_id);

    expect(fake.signals.length).toBe(1);
    expect(fake.signals[0].signal_id).toBe(validEvent().signal_id);
    expect(fake.signals[0].idempotency_key).toBe(validEvent().idempotency_key);
    expect(fake.calls.outboxInserts).toBe(1);
    expect(fake.outboxRows[0].channel).toBe('telegram');
    expect(fake.outboxRows[0].status).toBe('pending');
    await app.close();
  });

  it('rejects a duplicate idempotency_key (409) and does not insert twice', async () => {
    const fake = createFakeDb();
    const app = await makeApp(fake);
    const event = validEvent();
    const body = jsonEventBody(event);
    const headers = {
      'content-type': 'application/json',
      'x-atlas-signature': sign(body),
    };

    const first = await app.inject({ method: 'POST', url: '/webhooks/signal', headers, payload: body });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({ method: 'POST', url: '/webhooks/signal', headers, payload: body });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('duplicate_idempotency_key');
    expect(second.json().signal_id).toBe(event.signal_id);

    expect(fake.signals.length).toBe(1);
    expect(fake.calls.outboxInserts).toBe(1);
    await app.close();
  });

  it('handles the unique-violation race path (409)', async () => {
    const fake = createFakeDb({ selectMissesDuplicates: true });
    const app = await makeApp(fake);
    const body = jsonEventBody(validEvent());
    const headers = {
      'content-type': 'application/json',
      'x-atlas-signature': sign(body),
    };

    const first = await app.inject({ method: 'POST', url: '/webhooks/signal', headers, payload: body });
    expect(first.statusCode).toBe(200);

    // Fast-path SELECT now misses (selectMissesDuplicates), so the insert hits
    // the unique constraint → route must still answer 409, not 500.
    const second = await app.inject({ method: 'POST', url: '/webhooks/signal', headers, payload: body });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('duplicate_idempotency_key');
    expect(fake.signals.length).toBe(1);
    await app.close();
  });
});
