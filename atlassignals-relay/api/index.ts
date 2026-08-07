/**
 * api/index.ts — Vercel serverless entrypoint.
 *
 * Bridges Vercel's Node.js runtime request/response onto the same Fastify app
 * used by the standalone server. The app instance is cached across warm
 * invocations to avoid re-initializing plugins and hooks on every cold start.
 *
 * vercel.json sets `bodyParser: false` for this function so Vercel does NOT
 * consume the request stream — Fastify reads the raw body itself, which is
 * required for x-atlas-signature verification.
 *
 * NOTE: SSE (/stream) is disabled on Vercel serverless (see SSE_ENABLED).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { FastifyInstance } from 'fastify';
import { loadEnv } from '../src/config/env';
import { buildApp } from '../src/app';

let cachedApp: FastifyInstance | null = null;

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (!cachedApp) {
    const env = loadEnv();
    cachedApp = await buildApp({
      version: env.version,
      sseEnabled: false,
    });
  }
  await cachedApp.ready();
  cachedApp.server.emit('request', req, res);
}
