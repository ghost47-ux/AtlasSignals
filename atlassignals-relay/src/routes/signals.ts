/**
 * signals.ts — signal read API + real-time stream.
 *
 *   GET /signals/latest     latest stored signal      (auth + access required)
 *   GET /signals            paginated list            (auth + access required)
 *   GET /signals/:signal_id single signal by signal_id (auth + access required)
 *   GET /stream             SSE broadcast of new signals (auth + access required)
 *
 * All read routes are gated by requireAuth (Supabase JWT) + requireSignalAccess
 * (the same query-time DB function the RLS policies use). The frontend can
 * alternatively query Supabase directly with the anon key — RLS enforces the
 * identical rule there. `?token=` is accepted on /stream only (EventSource
 * cannot set Authorization headers).
 */
import type { FastifyInstance } from 'fastify';
import type { DbClient } from '../db/supabase';
import type { AuthMiddleware } from '../middleware/requireAuth';
import {
  getLatestSignal,
  listSignals,
  getSignalBySignalId,
} from '../services/signalService';
import { broadcaster } from '../services/websocketService';

export interface SignalRouteOptions {
  db: DbClient;
  sseEnabled: boolean;
  requireAuth: AuthMiddleware;
  /** Same as requireAuth but also accepts ?token= (EventSource compat). */
  requireAuthForStream: AuthMiddleware;
  requireSignalAccess: AuthMiddleware;
}

export default async function signalRoutes(
  app: FastifyInstance,
  opts: SignalRouteOptions,
): Promise<void> {
  const { db, sseEnabled, requireAuth, requireAuthForStream, requireSignalAccess } = opts;

  app.get(
    '/signals/latest',
    { preHandler: [requireAuth, requireSignalAccess] },
    async (_request, reply) => {
      const signal = await getLatestSignal(db);
      if (!signal) {
        return reply.code(404).send({ error: 'no_signals_yet' });
      }
      return reply.send(signal);
    },
  );

  app.get(
    '/signals',
    { preHandler: [requireAuth, requireSignalAccess] },
    async (request, reply) => {
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
    },
  );

  app.get(
    '/signals/:signal_id',
    { preHandler: [requireAuth, requireSignalAccess] },
    async (request, reply) => {
      const { signal_id } = request.params as { signal_id: string };
      const signal = await getSignalBySignalId(db, signal_id);
      if (!signal) {
        return reply.code(404).send({ error: 'signal_not_found', signal_id });
      }
      return reply.send(signal);
    },
  );

  // ── Real-time stream (SSE) — dashboard subscribes here, no polling ───────
  // EventSource can't send headers, so /stream also accepts ?token= (a
  // documented tradeoff for long-lived streams).
  app.get(
    '/stream',
    { preHandler: [requireAuthForStream, requireSignalAccess] },
    (request, reply) => {
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
      // Access is re-validated before EVERY delivery — an expired trial/paid
      // user (or a downgraded one) is dropped on the next signal.
      const user = request.appUser!;
      broadcaster.registerClient(reply, async () => {
        const { data, error } = await db.rpc('user_can_access_signals_for', {
          p_user_id: user.id,
        });
        return !error && data === true;
      });
      request.raw.on('close', () => {
        /* cleanup handled inside registerClient */
      });
      return undefined;
    },
  );
}
