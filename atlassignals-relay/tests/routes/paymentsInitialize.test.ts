import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import { createFakeDb } from '../helpers/fakeDb';

const GOOD_TOKEN = 'good.jwt.token';
const AUTH_UID = 'auth-user-1';
const USER_ID = 'user-1';

interface StubFetchOptions {
  ok?: boolean;
  status?: number;
  body?: Record<string, unknown>;
}

function stubFetch(opts: StubFetchOptions = {}): typeof fetch {
  return (async () => ({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    json: async () => opts.body ?? { status: true, data: {} },
  })) as unknown as typeof fetch;
}

function successBody(): Record<string, unknown> {
  return {
    status: true,
    message: 'Authorization URL created',
    data: {
      authorization_url: 'https://checkout.paystack.com/abc123',
      access_code: 'code-1',
      reference: 'atlas_expected_ref',
    },
  };
}

async function makeApp(
  fake: ReturnType<typeof createFakeDb>,
  opts: {
    paystackSecretKey?: string;
    paystackPlanAmount?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<FastifyInstance> {
  return buildApp({
    db: fake.db,
    webhookSecret: 'webhook-test-secret',
    verifyJwt: async (token: string) => (token === GOOD_TOKEN ? { sub: AUTH_UID } : null),
    // Explicitly unset unless the test provides one — real PAYSTACK_SECRET_KEY /
    // PAYSTACK_PLAN_AMOUNT in the ambient .env must never leak into the
    // "not configured" cases ('' and 0 are both falsy → route answers 503).
    paystackSecretKey: opts.paystackSecretKey ?? '',
    paystackPlanAmount: opts.paystackPlanAmount ?? 0,
    paystackCurrency: 'NGN',
    paystackPlanName: 'AtlasSignals Monthly',
    paystackFetch: opts.fetchImpl,
    sseEnabled: false,
    logger: { level: 'silent' },
  });
}

function provisionedFake(fetchImpl?: typeof fetch) {
  return createFakeDb({
    initialUsers: [{ id: USER_ID, auth_id: AUTH_UID, email: 'user@example.com', role: 'paid' }],
  });
}

const AUTH_HEADERS = { authorization: `Bearer ${GOOD_TOKEN}` };

describe('POST /payments/initialize', () => {
  it('rejects a request without a token (401)', async () => {
    const fake = provisionedFake();
    const app = await makeApp(fake, { paystackSecretKey: 'sk_test_x', paystackPlanAmount: 500000 });
    const res = await app.inject({ method: 'POST', url: '/payments/initialize' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('answers 503 when Paystack is not configured', async () => {
    const fake = provisionedFake();
    const app = await makeApp(fake);
    const res = await app.inject({ method: 'POST', url: '/payments/initialize', headers: AUTH_HEADERS });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('paystack_not_configured');
    await app.close();
  });

  it('answers 503 when the plan amount is not configured', async () => {
    const fake = provisionedFake();
    const app = await makeApp(fake, { paystackSecretKey: 'sk_test_x' });
    const res = await app.inject({ method: 'POST', url: '/payments/initialize', headers: AUTH_HEADERS });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('plan_not_configured');
    await app.close();
  });

  it('returns 502 when Paystack reports an upstream error', async () => {
    const fake = provisionedFake();
    const app = await makeApp(fake, {
      paystackSecretKey: 'sk_test_x',
      paystackPlanAmount: 500000,
      fetchImpl: stubFetch({ ok: false, status: 401, body: { status: false, message: 'Invalid key' } }),
    });
    const res = await app.inject({ method: 'POST', url: '/payments/initialize', headers: AUTH_HEADERS });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('paystack_upstream_error');
    await app.close();
  });

  it('creates a pending payment and returns the authorization URL (200)', async () => {
    const fetchImpl = stubFetch({ body: successBody() });
    const fake = provisionedFake();
    const app = await makeApp(fake, {
      paystackSecretKey: 'sk_test_x',
      paystackPlanAmount: 500000,
      fetchImpl,
    });
    const res = await app.inject({ method: 'POST', url: '/payments/initialize', headers: AUTH_HEADERS });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.authorization_url).toBe('https://checkout.paystack.com/abc123');
    expect(json.reference).toBe('atlas_expected_ref');
    expect(json.amount_minor).toBe(500000);
    expect(json.currency).toBe('NGN');

    // The pending payment row must be persisted (major units, status pending).
    expect(fake.payments.length).toBe(1);
    expect(fake.payments[0].paystack_reference).toBe('atlas_expected_ref');
    expect(fake.payments[0].user_id).toBe(USER_ID);
    expect(fake.payments[0].amount).toBe(5000);
    expect(fake.payments[0].status).toBe('pending');
    await app.close();
  });
});
