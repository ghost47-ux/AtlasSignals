import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildTelegramMessage,
  processPendingDeliveries,
  sendTelegramSignal,
  TELEGRAM_API_BASE,
} from '../../src/services/deliveryService';
import { createFakeDb, type FakeOutboxRow, type FakeSignalRow } from '../helpers/fakeDb';

const ENV_KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.TELEGRAM_BOT_TOKEN = 'bot-test-token';
  process.env.TELEGRAM_CHAT_ID = 'chat-test-id';
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
});

function signalRow(): FakeSignalRow {
  return {
    id: 's1',
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
    idempotency_key: 'key-1',
    inserted_at: '2026-08-07T06:15:01.000+00:00',
    raw_payload: { e2e: true },
  };
}

function outboxJob(): FakeOutboxRow {
  return {
    id: 'o1',
    signal_id: signalRow().signal_id,
    channel: 'telegram',
    status: 'pending',
    attempts: 0,
    created_at: '2026-08-07T06:15:01.000+00:00',
    sent_at: null,
  };
}

function stubFetch(ok: boolean, status: number): ReturnType<typeof vi.fn> {
  const stub = vi.fn(async () => ({ ok, status, json: async () => ({}) }));
  vi.stubGlobal('fetch', stub as unknown as typeof fetch);
  return stub;
}

describe('buildTelegramMessage', () => {
  it('renders a plain-text card with every signal field', () => {
    const text = buildTelegramMessage(signalRow());
    expect(text).toContain('ATLAS SIGNAL — BUY XAU/USD (15M)');
    expect(text).toContain('Entry:');
    expect(text).toContain('3365.42');
    expect(text).toContain('Stop Loss:');
    expect(text).toContain('3358.1');
    expect(text).toContain('Take Profit:');
    expect(text).toContain('3378.9');
    expect(text).toContain('Confidence:');
    expect(text).toContain('84/100');
    expect(text).toContain('TIER_A_HIGH_QUALITY');
    expect(text).toContain('TRENDING_UP/TRENDING');
    expect(text).toContain('ITER_32');
    expect(text).toContain('2026-08-07T06:15:00.000+00:00');
  });
});

describe('sendTelegramSignal', () => {
  it('sends the signal to the configured chat and returns true on acceptance', async () => {
    const fetchStub = stubFetch(true, 200);
    const fake = createFakeDb({ initialSignals: [signalRow()] });

    const ok = await sendTelegramSignal(outboxJob(), fake.db);

    expect(ok).toBe(true);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${TELEGRAM_API_BASE}/botbot-test-token/sendMessage`);
    const body = JSON.parse(String(init.body)) as { chat_id: string; text: string };
    expect(body.chat_id).toBe('chat-test-id');
    expect(body.text).toContain('BUY XAU/USD');
  });

  it('returns false (no fetch) when the bot is not configured', async () => {
    const fetchStub = stubFetch(true, 200);
    delete process.env.TELEGRAM_BOT_TOKEN;
    const fake = createFakeDb({ initialSignals: [signalRow()] });

    const ok = await sendTelegramSignal(outboxJob(), fake.db);

    expect(ok).toBe(false);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('returns false when the signal row cannot be found', async () => {
    const fetchStub = stubFetch(true, 200);
    const fake = createFakeDb(); // no signals

    const ok = await sendTelegramSignal(outboxJob(), fake.db);

    expect(ok).toBe(false);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('returns false when the Bot API rejects the message (5xx)', async () => {
    const fetchStub = stubFetch(false, 500);
    const fake = createFakeDb({ initialSignals: [signalRow()] });

    const ok = await sendTelegramSignal(outboxJob(), fake.db);

    expect(ok).toBe(false);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('returns false (not throw) on a network error', async () => {
    const stub = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', stub as unknown as typeof fetch);
    const fake = createFakeDb({ initialSignals: [signalRow()] });

    const ok = await sendTelegramSignal(outboxJob(), fake.db);

    expect(ok).toBe(false);
  });
});

describe('processPendingDeliveries', () => {
  it('dispatches a pending Telegram job, marks it sent and counts it', async () => {
    stubFetch(true, 200);
    const fake = createFakeDb({
      initialSignals: [signalRow()],
      initialOutbox: [outboxJob()],
    });

    const result = await processPendingDeliveries(fake.db);

    expect(result).toEqual({ processed: 1, sent: 1 });

    expect(fake.outboxRows[0].status).toBe('sent');
    expect(fake.outboxRows[0].attempts).toBe(1);
    expect(fake.outboxRows[0].sent_at).toBeTruthy();
  });

  it('keeps a failed send pending with an incremented attempt count', async () => {
    stubFetch(false, 500);
    const fake = createFakeDb({
      initialSignals: [signalRow()],
      initialOutbox: [outboxJob()],
    });

    const result = await processPendingDeliveries(fake.db);

    expect(result).toEqual({ processed: 1, sent: 0 });
    expect(fake.outboxRows[0].status).toBe('pending');
    expect(fake.outboxRows[0].attempts).toBe(1);
  });
});
