import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHmac } from 'node:crypto';
import { buildApp } from '../../src/app';
import { createFakeDb } from '../helpers/fakeDb';

const SECRET = 'sk_test_webhook';

function sign(body: string, secret: string = SECRET): string {
  return createHmac('sha512', secret).update(body).digest('hex');
}

function chargeSuccessEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event: 'charge.success',
    data: {
      id: 12345678,
      reference: 'atlas_test_ref_1',
      status: 'success',
      amount: 500000,
      currency: 'NGN',
      channel: 'card',
      paid_at: '2026-08-07T10:00:00.000Z',
      metadata: { user_id: 'user-1' },
      customer: { id: 99, email: 'payer@example.com' },
      ...overrides,
    },
  };
}

async function makeApp(fake: ReturnType<typeof createFakeDb>, paystackSecretKey?: string): Promise<FastifyInstance> {
  return buildApp({
    db: fake.db,
    webhookSecret: 'webhook-test-secret',
    // Explicitly unset unless the test provides one — a real PAYSTACK_SECRET_KEY
    // in the ambient .env must never leak into the "not configured" case.
    paystackSecretKey: paystackSecretKey ?? '',
    verifyJwt: async () => null,
    sseEnabled: false,
    logger: { level: 'silent' },
  });
}

function headers(body: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-paystack-signature': sign(body),
  };
}

describe('POST /webhooks/paystack', () => {
  it('answers 503 when PAYSTACK_SECRET_KEY is not configured', async () => {
    const fake = createFakeDb();
    const app = await makeApp(fake);
    const body = JSON.stringify(chargeSuccessEvent());
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/paystack',
      headers: { 'content-type': 'application/json' },
      payload: body,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('server_not_configured');
    await app.close();
  });

  it('rejects a request with an invalid signature (401)', async () => {
    const fake = createFakeDb();
    const app = await makeApp(fake, SECRET);
    const body = JSON.stringify(chargeSuccessEvent());
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/paystack',
      headers: { 'content-type': 'application/json', 'x-paystack-signature': sign(body, 'sk_test_wrong') },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid_signature');
    expect(fake.calls.rpcCalls.length).toBe(0);
    await app.close();
  });

  it('rejects an unparseable payload (400) even with a valid signature', async () => {
    const fake = createFakeDb();
    const app = await makeApp(fake, SECRET);
    const body = JSON.stringify({ event: 'charge.success' }); // missing data
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/paystack',
      headers: headers(body),
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_payload');
    expect(fake.calls.rpcCalls.length).toBe(0);
    await app.close();
  });

  it('processes charge.success through the DB processor (200)', async () => {
    let captured: Record<string, unknown> | null = null;
    const fake = createFakeDb({
      rpcHandlers: {
        handle_paystack_charge_success: (params) => {
          captured = params;
          return { data: { processed: true, expires_at: '2026-09-07T10:00:00.000Z' } };
        },
      },
    });
    const app = await makeApp(fake, SECRET);
    const body = JSON.stringify(chargeSuccessEvent());
    const res = await app.inject({ method: 'POST', url: '/webhooks/paystack', headers: headers(body), payload: body });

    expect(res.statusCode).toBe(200);
    expect(res.json().received).toBe(true);
    expect(captured).not.toBeNull();
    expect(captured!.p_paystack_reference).toBe('atlas_test_ref_1');
    expect(captured!.p_paystack_transaction_id).toBe('12345678');
    expect(captured!.p_amount_minor).toBe(500000);
    expect(captured!.p_currency).toBe('NGN');
    expect(captured!.p_channel).toBe('card');
    expect(captured!.p_user_id).toBe('user-1');
    expect(captured!.p_raw).toMatchObject({ event: 'charge.success' });
    await app.close();
  });

  it('answers 200 (not an error) for a duplicate charge.success — no retry loop', async () => {
    const fake = createFakeDb({
      rpcHandlers: {
        handle_paystack_charge_success: () => ({ data: { processed: false, reason: 'duplicate' } }),
      },
    });
    const app = await makeApp(fake, SECRET);
    const body = JSON.stringify(chargeSuccessEvent());
    const res = await app.inject({ method: 'POST', url: '/webhooks/paystack', headers: headers(body), payload: body });
    expect(res.statusCode).toBe(200);
    expect(fake.calls.rpcCalls.length).toBe(1);
    await app.close();
  });

  it('records charge.failed through the DB processor (200)', async () => {
    let called = false;
    const fake = createFakeDb({
      rpcHandlers: {
        handle_paystack_charge_failed: (params) => {
          called = true;
          expect(params.p_paystack_reference).toBe('atlas_test_ref_failed');
          return { data: { processed: true, status: 'failed' } };
        },
      },
    });
    const app = await makeApp(fake, SECRET);
    const body = JSON.stringify({
      event: 'charge.failed',
      data: { id: 555, reference: 'atlas_test_ref_failed', amount: 500000, currency: 'NGN', channel: 'card', metadata: { user_id: 'user-1' } },
    });
    const res = await app.inject({ method: 'POST', url: '/webhooks/paystack', headers: headers(body), payload: body });
    expect(res.statusCode).toBe(200);
    expect(called).toBe(true);
    await app.close();
  });

  it('acknowledges and ignores unrelated events (200, no rpc call)', async () => {
    const fake = createFakeDb();
    const app = await makeApp(fake, SECRET);
    const body = JSON.stringify({ event: 'transfer.success', data: { reference: 'TRF_123' } });
    const res = await app.inject({ method: 'POST', url: '/webhooks/paystack', headers: headers(body), payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json().received).toBe(true);
    expect(fake.calls.rpcCalls.length).toBe(0);
    await app.close();
  });
});
