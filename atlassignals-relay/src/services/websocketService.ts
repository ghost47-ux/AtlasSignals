/**
 * websocketService.ts — real-time broadcast layer (Server-Sent Events).
 *
 * A lightweight in-process broadcaster emits every newly inserted signal to
 * subscribed clients. The React dashboard will subscribe to GET /stream
 * without polling. On long-running hosts (Railway / Render / Fly.io) this
 * streams indefinitely; on Vercel serverless it is disabled via SSE_ENABLED.
 *
 * ACCESS CONTROL: access is validated at connection time (route preHandler)
 * AND re-validated before EVERY signal is delivered to a client. If a user's
 * trial/paid window expires mid-connection (or an admin downgrades them),
 * their stream is terminated on the next broadcast — query-time enforcement
 * has no bypass path through the SSE channel.
 */
import { EventEmitter } from 'node:events';
import type { FastifyReply } from 'fastify';

export interface BroadcastableSignal {
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
  created_at: string;
}

const HEARTBEAT_MS = 25_000;

export class SignalBroadcaster extends EventEmitter {
  private heartbeatMs: number;

  constructor(heartbeatMs: number = HEARTBEAT_MS) {
    super();
    this.heartbeatMs = heartbeatMs;
  }

  /**
   * Fire-and-forget broadcast. Each client's send handler re-validates its
   * own access before writing; async errors are swallowed (never crash the
   * webhook path — a broadcast is best-effort by design).
   */
  broadcast(signal: BroadcastableSignal): void {
    const listeners = this.listeners('signal') as Array<
      (s: BroadcastableSignal) => unknown
    >;
    for (const listener of listeners) {
      try {
        const result = listener(signal) as unknown;
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch(() => {
            /* client-level failure — the stream is torn down by the sender */
          });
        }
      } catch {
        /* ignore listener errors */
      }
    }
  }

  /**
   * Attach an SSE client. `canReceive` is re-checked before every delivery;
   * when it returns false the stream is closed with an access_denied event.
   * Returns a cleanup function.
   */
  registerClient(reply: FastifyReply, canReceive: () => Promise<boolean> = async () => true): () => void {
    let closed = false;

    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      this.off('signal', send);
      reply.raw.removeListener('close', cleanup);
      reply.raw.removeListener('error', cleanup);
    };

    const send = async (signal: BroadcastableSignal): Promise<void> => {
      if (closed || reply.raw.destroyed) {
        cleanup();
        return;
      }
      let allowed: boolean;
      try {
        allowed = await canReceive();
      } catch {
        allowed = false; // conservative: drop on any check failure
      }
      if (!allowed) {
        if (!reply.raw.destroyed) {
          reply.raw.write('event: access_denied\ndata: {"error":"access_denied"}\n\n');
          reply.raw.end();
        }
        cleanup();
        return;
      }
      if (closed || reply.raw.destroyed) {
        cleanup();
        return;
      }
      reply.raw.write(`data: ${JSON.stringify(signal)}\n\n`);
    };

    const heartbeat = setInterval(() => {
      if (closed || reply.raw.destroyed) {
        cleanup();
        return;
      }
      reply.raw.write(': ping\n\n');
    }, this.heartbeatMs);

    this.on('signal', send);
    reply.raw.on('close', cleanup);
    reply.raw.on('error', cleanup);
    return cleanup;
  }
}

/** Module-level singleton shared across routes. */
export const broadcaster = new SignalBroadcaster();
