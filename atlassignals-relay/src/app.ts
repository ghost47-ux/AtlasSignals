/**
 * app.ts — Fastify application factory.
 *
 * `buildApp()` is dependency-injectable so the webhook tests can boot the full
 * app with a fake database, a fixed secret, a stub JWT verifier and a stubbed
 * Paystack API, while production boots with the real Supabase client from the
 * environment.
 */
import Fastify, { type FastifyInstance, type FastifyLoggerOptions } from 'fastify';
import { loadEnv } from './config/env';
import { createSupabaseClient, type DbClient } from './db/supabase';
import webhookRoutes from './routes/webhook';
import signalRoutes from './routes/signals';
import healthRoutes from './routes/health';
import paystackWebhookRoutes from './routes/paystackWebhook';
import paymentRoutes from './routes/payments';
import telegramRoutes from './routes/telegram';
import {
  createDefaultVerifyJwt,
  makeRequireAuth,
  makeRequireSignalAccess,
  type VerifyJwtFn,
} from './middleware/requireAuth';

export interface BuildAppOptions {
  db?: DbClient;
  webhookSecret?: string;

  // ── Paystack (optional — payment routes 503 until configured) ─────────────
  paystackSecretKey?: string;
  paystackPublicKey?: string;
  paystackCurrency?: string;
  paystackPlanAmount?: number;
  paystackPlanName?: string;
  /** Injected for tests; defaults to the real Paystack API. */
  paystackFetch?: typeof fetch;
  paystackApiBaseUrl?: string;

  /** JWT verifier for the read API. Defaults to Supabase Auth (service role). */
  verifyJwt?: VerifyJwtFn;

  // ── Telegram (multi-user bot + linking) ───────────────────────────────────
  telegramBotToken?: string;
  telegramWebhookSecret?: string;
  /** Injected for tests; defaults to the real Telegram API. */
  telegramFetch?: typeof fetch;

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

  // ── CORS — allow the browser website to call the API ─────────────────────
  // The React website (atlassignals-web) calls POST /payments/initialize and
  // POST /telegram/link from the browser with the user's Supabase JWT.
  // Server-to-server callers (HF Space, Paystack, Telegram) send no Origin
  // header and are completely unaffected. Only allowlisted browser origins
  // receive CORS headers; disallowed origins get none (and preflights are
  // rejected), so a random site cannot read responses cross-origin.
  const CORS_ALLOWED_ORIGINS: RegExp[] = [
    /^https:\/\/atlassignals-web(?:-[a-z0-9-]+)*\.vercel\.app$/,
    /^http:\/\/localhost(?::\d+)?$/,
    /^http:\/\/127\.0\.0\.1(?::\d+)?$/,
  ];

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    const allowed =
      typeof origin === 'string' &&
      CORS_ALLOWED_ORIGINS.some((re) => re.test(origin));
    if (allowed && typeof origin === 'string') {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Vary', 'Origin');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      reply.header(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Atlas-Signature, X-Atlas-Idempotency-Key, X-Telegram-Bot-Api-Secret-Token',
      );
      reply.header('Access-Control-Max-Age', '86400');
    }
    if (request.method === 'OPTIONS') {
      return reply.code(allowed ? 204 : 403).send();
    }
    return undefined;
  });

  const db: DbClient = options.db ?? createSupabaseClient(env);
  const getSecret = (): string => options.webhookSecret ?? env.webhookSecret ?? '';
  const sseEnabled = options.sseEnabled ?? env.sseEnabled;

  // ── Auth middleware (read API + payments) ─────────────────────────────────
  const verifyJwt: VerifyJwtFn = options.verifyJwt ?? createDefaultVerifyJwt(db);
  const requireAuth = makeRequireAuth({ db, verifyJwt });
  const requireAuthForStream = makeRequireAuth({ db, verifyJwt, allowQueryToken: true });
  const requireSignalAccess = makeRequireSignalAccess(db);

  await app.register(webhookRoutes, { db, getSecret });
  await app.register(signalRoutes, {
    db,
    sseEnabled,
    requireAuth,
    requireAuthForStream,
    requireSignalAccess,
  });
  await app.register(healthRoutes, { db, version });

  // ── Payments (Paystack) ────────────────────────────────────────────────────
  await app.register(paystackWebhookRoutes, {
    db,
    getSecret: (): string => options.paystackSecretKey ?? env.paystackSecretKey ?? '',
  });
  // ── Telegram (multi-user) ─────────────────────────────────────────────────
  await app.register(telegramRoutes, {
    db,
    requireAuth,
    botToken: (): string => options.telegramBotToken ?? env.telegramBotToken ?? '',
    webhookSecret: (): string =>
      options.telegramWebhookSecret ?? env.telegramWebhookSecret ?? '',
    fetchImpl: options.telegramFetch,
  });

  await app.register(paymentRoutes, {
    db,
    requireAuth,
    paystack: {
      secretKey: options.paystackSecretKey ?? env.paystackSecretKey,
      publicKey: options.paystackPublicKey ?? env.paystackPublicKey,
      currency: options.paystackCurrency ?? env.paystackCurrency,
      planAmount: options.paystackPlanAmount ?? env.paystackPlanAmount,
      planName: options.paystackPlanName ?? env.paystackPlanName,
      fetchImpl: options.paystackFetch,
      apiBaseUrl: options.paystackApiBaseUrl,
    },
  });

  return app;
}
