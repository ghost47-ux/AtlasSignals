/**
 * server.ts — standalone Node.js server entrypoint.
 *
 * Used locally and on any long-running Node host (Railway, Render, Fly.io,
 * Docker). Vercel uses api/index.ts instead.
 *
 * Fails fast with a clear message when required environment variables are
 * missing — the backend must never boot half-configured.
 */
import { loadEnv, REQUIRED_RUNTIME_ENV } from './config/env';
import { logger } from './utils/logger';
import { buildApp } from './app';

async function main(): Promise<void> {
  const env = loadEnv();

  const missing = REQUIRED_RUNTIME_ENV.filter((key) => !env[key]);
  if (missing.length > 0) {
    logger.error(
      { missing },
      'Missing required environment variables. Set them in .env (see .env.example) and restart.',
    );
    process.exit(1);
  }

  const app = await buildApp();
  const port = env.port;
  const host = '0.0.0.0';

  await app.listen({ port, host });
  logger.info(`AtlasSignals Relay listening on http://${host}:${port} (${env.nodeEnv})`);
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
