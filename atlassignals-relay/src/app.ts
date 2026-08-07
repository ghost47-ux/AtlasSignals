/**
 * app.ts — Fastify application factory.
 *
 * `buildApp()` is dependency-injectable so the webhook tests can boot the full
 * app with a fake database and a fixed secret, while production boots with the
 * real Supabase client from the environment.
 */
import Fastify, { type FastifyInstance, type FastifyLoggerOptions } from 'fastify';
import { loadEnv } from './config/env';
import { createSupabaseClient, type DbClient } from './db/supabase';
import webhookRoutes from './routes/webhook';
import signalRoutes from './routes/signals';
import healthRoutes from './routes/health';

export interface BuildAppOptions {
  db?: DbClient;
  webhookSecret?: string;
  sseEnabled?: boolean;
  version?: string;
  /** pino options object (e.g. `{ level: 'silent' }` in tests). */
  logger?: FastifyLoggerOptions;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = loadEnv();
  const version = options.version ?? env.version;

  const app = Fastify({
    logger:
      options.logger ??
      ({
        level: env.nodeEnv === 'production' ? 'info' : 'debug',
        base: { service: 'atlassignals-relay', version },
      } as FastifyLoggerOptions),
    trustProxy: true,
    bodyLimit: 1_048_576, // 1 MB — more than enough for a signal event
  });

  // Capture the exact raw request body so HMAC signatures can be verified over
  // the bytes that were actually sent (re-serializing request.body would break
  // it). Fastify's JSON parser is replaced with a buffer-based one that stashes
  // the original bytes on `request.rawBody` before parsing. Body parsing runs
  // before preHandler hooks, so the signature middleware always sees the raw
  // body by the time it executes.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    request.rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
    if (!body || body.length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body.toString('utf8')));
    } catch (err) {
      done(err as Error);
    }
  });

  const db: DbClient = options.db ?? createSupabaseClient(env);
  const getSecret = (): string => options.webhookSecret ?? env.webhookSecret ?? '';
  const sseEnabled = options.sseEnabled ?? env.sseEnabled;

  await app.register(webhookRoutes, { db, getSecret });
  await app.register(signalRoutes, { db, sseEnabled });
  await app.register(healthRoutes, { db, version });

  return app;
}
