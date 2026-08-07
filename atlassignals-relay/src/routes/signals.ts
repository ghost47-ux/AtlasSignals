/**
 * signals.ts — signal read API + real-time stream.
 *
 *   GET /signals/latest     latest stored signal
 *   GET /signals            paginated list (?limit=50&offset=0, max limit 200)
 *   GET /signals/:signal_id single signal by canonical signal_id (UUID)
 *   GET /stream             Server-Sent Events broadcast of new signals
 *
 * NOTE: these endpoints are intentionally open for now. The architecture is
 * auth-ready — visibility rules (free_trial / paid / admin) and JWT checks
 * plug in here without touching the ingestion pipeline.
 */
import type { FastifyInstance } from 'fastify';
import type { DbClient } from '../db/supabase';
import {
  getLatestSignal,
  listSignals,
  getSignalBySignalId,
} from '../services/signalService';
import { broadcaster } from '../services/websocketService';

export interface SignalRouteOptions {
  db: DbClient;
  sseEnabled: boolean;
}

export default async function signalRoutes(
  app: FastifyInstance,
  opts: SignalRouteOptions,
): Promise<void> {
  const { db, sseEnabled } = opts;

  app.get('/signals/latest', async (_request, reply) => {
    const signal = await getLatestSignal(db);
    if (!signal) {
      return reply.code(404).send({ error: 'no_signals_yet' });
    }
    return reply.send(signal);
  });

  app.get('/signals', async (request, reply) => {
    const query = request.query as { limit?: string; offset?: string };
    const limit = Number.parseInt(query.limit ?? '50', 10) || 50;
    const offset = Number.parseInt(query.offset ?? '0', 10) || 0;
    const signals = await listSignals(db, { limit, offset });
    return reply.send({
      signals,
      limit,
      offset,
      count: signals.length,
    });
  });

  app.get('/signals/:signal_id', async (request, reply) => {
    const { signal_id } = request.params as { signal_id: string };
    const signal = await getSignalBySignalId(db, signal_id);
    if (!signal) {
      return reply.code(404).send({ error: 'signal_not_found', signal_id });
    }
    return reply.send(signal);
  });

  // ── Real-time stream (SSE) — dashboard subscribes here, no polling ───────
  app.get('/stream', (request, reply) => {
    if (!sseEnabled) {
      return reply.code(200).send({ error: 'sse_disabled' });
    }
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(': connected\n\n');
    broadcaster.registerClient(reply);
    request.raw.on('close', () => {
      /* cleanup handled inside registerClient */
    });
    return undefined;
  });
}
