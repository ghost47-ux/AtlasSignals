import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import type { FastifyReply } from 'fastify';
import { SignalBroadcaster, type BroadcastableSignal } from '../../src/services/websocketService';

class FakeRaw extends EventEmitter {
  destroyed = false;
  ended = false;
  writes: string[] = [];
  write(chunk: string | Buffer): boolean {
    this.writes.push(chunk.toString());
    return true;
  }
  end(): void {
    this.ended = true;
    this.destroyed = true;
  }
}

function makeReply(): { reply: FastifyReply; raw: FakeRaw } {
  const raw = new FakeRaw();
  return { reply: { raw } as unknown as FastifyReply, raw };
}

function signal(n: number): BroadcastableSignal {
  return {
    signal_id: `sig-${n}`,
    symbol: 'XAU/USD',
    direction: 'BUY',
    timeframe: '15M',
    entry: 3365.42,
    stop_loss: 3358.1,
    take_profit: 3378.9,
    confidence: 84,
    setup_name: 'TIER_A',
    market_state: 'TRENDING_UP',
    created_at: '2026-08-07T06:15:00.000+00:00',
  };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('SignalBroadcaster access re-check', () => {
  it('delivers signals while access is allowed', async () => {
    const b = new SignalBroadcaster(1000);
    const { reply, raw } = makeReply();
    b.registerClient(reply, async () => true);
    b.broadcast(signal(1));
    await tick();
    expect(raw.writes.some((w) => w.includes('"signal_id":"sig-1"'))).toBe(true);
    expect(raw.ended).toBe(false);
  });

  it('drops a client whose access expired (access_denied + close)', async () => {
    const b = new SignalBroadcaster(1000);
    const { reply, raw } = makeReply();
    let allowed = true;
    b.registerClient(reply, async () => allowed);

    b.broadcast(signal(1));
    await tick();
    expect(raw.writes.some((w) => w.includes('"signal_id":"sig-1"'))).toBe(true);

    // window expires mid-connection
    allowed = false;
    b.broadcast(signal(2));
    await tick();

    expect(raw.writes.some((w) => w.includes('access_denied'))).toBe(true);
    expect(raw.ended).toBe(true);

    // nothing more is written after the drop
    const writesAfterDrop = raw.writes.length;
    b.broadcast(signal(3));
    await tick();
    expect(raw.writes.length).toBe(writesAfterDrop);
  });

  it('is conservative when the access check errors', async () => {
    const b = new SignalBroadcaster(1000);
    const { reply, raw } = makeReply();
    b.registerClient(reply, async () => {
      throw new Error('db down');
    });
    b.broadcast(signal(1));
    await tick();
    expect(raw.writes.some((w) => w.includes('access_denied'))).toBe(true);
    expect(raw.ended).toBe(true);
  });
});
