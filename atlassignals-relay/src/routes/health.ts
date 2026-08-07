/**
 * health.ts — GET /health
 *
 * Returns process status, uptime, database connectivity and version.
 * Used by uptime monitors and by deployment platforms' health checks.
 */
import type { FastifyInstance } from 'fastify';
import type { DbClient } from '../db/supabase';
import { checkDatabaseHealth } from '../services/signalService';

export interface HealthRouteOptions {
  db: DbClient;
  version: string;
}

export default async function healthRoutes(
  app: FastifyInstance,
  opts: HealthRouteOptions,
): Promise<void> {
  const { db, version } = opts;

  app.get('/health', async (_request, reply) => {
    let dbOk = false;
    try {
      dbOk = await checkDatabaseHealth(db);
    } catch {
      dbOk = false;
    }
    return reply.code(dbOk ? 200 : 503).send({
      status: dbOk ? 'ok' : 'degraded',
      uptime: Math.round(process.uptime()),
      database: dbOk ? 'connected' : 'unreachable',
      version,
    });
  });
}
