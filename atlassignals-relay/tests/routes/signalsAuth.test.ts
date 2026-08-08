import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import { createFakeDb, type FakeSignalRow } from '../helpers/fakeDb';

const GOOD_TOKEN = 'good.jwt.token';
const AUTH_UID = 'auth-user-1';
const USER_ID = 'user-1';

function signalRows(): FakeSignalRow[] {
  return [
    {
      id: 's1',
      signal_id: '3f2c2c3a-1b2c-4d5e-8f90-abcdef123456',
      symbol: 'XAU/USD',
      direction: 'BUY',
      idempotency_key: 'key-1',
      created_at: '2026-08-07T06:15:00.000+00:00',
    },
  ];
}

async function makeApp(
  _fake: ReturnType<typeof createFakeDb>,
  sseEnabled = false,
): Promise<FastifyInstance> {
  return buildApp({
    db: _fake.db,
    webhookSecret: 'webhook-test-secret',
    verifyJwt: async (token: string) => (token === GOOD_TOKEN ? { sub: AUTH_UID } : null),
    sseEnabled,
    logger: { level: 'silent' },
  });
}

describe('signal read API authentication', () => {
  function provisionedFake(access: boolean) {
    return createFakeDb({
      initialSignals: signalRows(),
      initialUsers: [{ id: USER_ID, auth_id: AUTH_UID, email: 'user@example.com', role: 'paid' }],
      rpcHandlers: {
        user_can_access_signals_for: () => ({ data: access }),
      },
    });
  }

  it('rejects a request without a token (401)', async () => {
    const fake = provisionedFake(true);
    const app = await makeApp(fake);
    const res = await app.inject({ method: 'GET', url: '/signals' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects an invalid token (401)', async () => {
    const fake = provisionedFake(true);
    const app = await makeApp(fake);
    const res = await app.inject({
      method: 'GET',
      url: '/signals',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid_token');
    await app.close();
  });

  it('rejects a valid token for an unprovisioned user (403)', async () => {
    const fake = createFakeDb({ initialSignals: signalRows() }); // no users rows
    const app = await makeApp(fake);
    const res = await app.inject({
      method: 'GET',
      url: '/signals',
      headers: { authorization: `Bearer ${GOOD_TOKEN}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('user_not_provisioned');
    await app.close();
  });

  it('blocks a user without a live subscription window (403 access_denied)', async () => {
    const fake = provisionedFake(false);
    const app = await makeApp(fake);
    const res = await app.inject({
      method: 'GET',
      url: '/signals',
      headers: { authorization: `Bearer ${GOOD_TOKEN}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('access_denied');
    expect(fake.calls.rpcCalls.some((c) => c.name === 'user_can_access_signals_for')).toBe(true);
    await app.close();
  });

  it('serves signals to a user with a live window (200)', async () => {
    const fake = provisionedFake(true);
    const app = await makeApp(fake);
    const res = await app.inject({
      method: 'GET',
      url: '/signals?limit=10',
      headers: { authorization: `Bearer ${GOOD_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.count).toBe(1);
    expect(json.signals[0].signal_id).toBe('3f2c2c3a-1b2c-4d5e-8f90-abcdef123456');
    await app.close();
  });

  it('serves /signals/latest to an authorized user (200)', async () => {
    const fake = provisionedFake(true);
    const app = await makeApp(fake);
    const res = await app.inject({
      method: 'GET',
      url: '/signals/latest',
      headers: { authorization: `Bearer ${GOOD_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('rejects /stream without a token (401)', async () => {
    const fake = provisionedFake(true);
    const app = await makeApp(fake);
    const res = await app.inject({ method: 'GET', url: '/stream' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('passes the auth gate on /stream with a query token and live access', async () => {
    // The SSE handler hijacks the socket and never ends, so inject can't await
    // the full stream — the preHandler gate (token → access check) is what we
    // assert here, and the 401/403 cases are covered by the tests above.
    const fake = provisionedFake(true);
    const app = await makeApp(fake, false); // sse disabled → handler short-circuits with 200 JSON
    const res = await app.inject({
      method: 'GET',
      url: `/stream?token=${GOOD_TOKEN}`,
    });
    expect(res.statusCode).toBe(200);
    expect(fake.calls.rpcCalls.some((c) => c.name === 'user_can_access_signals_for')).toBe(true);
    await app.close();
  });

  it('rejects /stream with a query token but no access (403)', async () => {
    const fake = provisionedFake(false);
    const app = await makeApp(fake);
    const res = await app.inject({
      method: 'GET',
      url: `/stream?token=${GOOD_TOKEN}`,
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
