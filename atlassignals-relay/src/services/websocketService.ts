/**
 * websocketService.ts — real-time broadcast layer (Server-Sent Events).
 *
 * A lightweight in-process broadcaster emits every newly inserted signal to
 * subscribed clients. The React dashboard will subscribe to GET /stream
 * without polling. On long-running hosts (Railway / Render / Fly.io) this
 * streams indefinitely; on Vercel serverless it is disabled via SSE_ENABLED.
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

  broadcast(signal: BroadcastableSignal): void {
    this.emit('signal', signal);
  }

  /** Attach an SSE client. Returns a cleanup function. */
  registerClient(reply: FastifyReply): () => void {
    const send = (signal: BroadcastableSignal): void => {
      if (reply.raw.destroyed) {
        return;
      }
      reply.raw.write(`data: ${JSON.stringify(signal)}\n\n`);
    };

    const heartbeat = setInterval(() => {
      if (reply.raw.destroyed) {
        clearInterval(heartbeat);
        return;
      }
      reply.raw.write(': ping\n\n');
    }, this.heartbeatMs);

    this.on('signal', send);

    const cleanup = (): void => {
      clearInterval(heartbeat);
      this.off('signal', send);
    };
    reply.raw.on('close', cleanup);
    reply.raw.on('error', cleanup);
    return cleanup;
  }
}

/** Module-level singleton shared across routes. */
export const broadcaster = new SignalBroadcaster();
