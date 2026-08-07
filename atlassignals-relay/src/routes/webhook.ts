/**
 * webhook.ts — POST /webhooks/signal
 *
 * The single ingestion path from the Hugging Face analysis engine.
 *
 * Flow (target < 100ms):
 *   1. verify x-atlas-signature (HMAC-SHA256 over the raw body)
 *   2. validate the canonical event with Zod
 *   3. reject duplicates via idempotency_key (fast-path SELECT + UNIQUE
 *      constraint backstop)
 *   4. store the signal (source of truth)
 *   5. insert a Telegram delivery job into the outbox (async delivery)
 *   6. broadcast the signal to real-time subscribers
 *   7. return HTTP 200 quickly
 */
import type { FastifyInstance } from 'fastify';
import type { DbClient } from '../db/supabase';
import { signalEventSchema } from '../schemas/signal';
import { makeVerifySignature } from '../middleware/verifySignature';
import {
  findSignalByIdempotencyKey,
  insertSignal,
  isUniqueViolation,
} from '../services/signalService';
import { insertDeliveryJob } from '../services/deliveryService';
import { broadcaster } from '../services/websocketService';

export interface WebhookRouteOptions {
  db: DbClient;
  getSecret: () => string;
}

export default async function webhookRoutes(
  app: FastifyInstance,
  opts: WebhookRouteOptions,
): Promise<void> {
  const { db, getSecret } = opts;

  app.post(
    '/webhooks/signal',
    { preHandler: [makeVerifySignature(getSecret)] },
    async (request, reply) => {
      const parsed = signalEventSchema.safeParse(request.body);
      if (!parsed.success) {
        request.log.warn(
          { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
          'webhook: payload validation failed',
        );
        return reply.code(422).send({
          error: 'invalid_payload',
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const event = parsed.data;

      // ── Idempotency fast-path ────────────────────────────────────────────
      let existing;
      try {
        existing = await findSignalByIdempotencyKey(db, event.idempotency_key);
      } catch (err) {
        request.log.error({ err }, 'webhook: idempotency lookup failed');
        return reply.code(500).send({ error: 'internal_error' });
      }
      if (existing) {
        request.log.info(
          { signal_id: event.signal_id, idempotency_key: event.idempotency_key },
          'webhook: duplicate idempotency_key — rejected',
        );
        return reply
          .code(409)
          .send({ error: 'duplicate_idempotency_key', signal_id: existing.signal_id });
      }

      // ── Persist (source of truth) ────────────────────────────────────────
      let stored;
      try {
        stored = await insertSignal(db, event);
      } catch (err) {
        if (isUniqueViolation(err)) {
          // Race: another request inserted the same key first.
          const dup = await findSignalByIdempotencyKey(db, event.idempotency_key);
          request.log.info({ idempotency_key: event.idempotency_key }, 'webhook: unique violation on idempotency_key');
          return reply.code(409).send({
            error: 'duplicate_idempotency_key',
            signal_id: dup?.signal_id ?? event.signal_id,
          });
        }
        request.log.error({ err }, 'webhook: database insert failed');
        return reply.code(500).send({ error: 'internal_error' });
      }

      // ── Async delivery: outbox job for Telegram (never inline) ───────────
      try {
        await insertDeliveryJob(db, stored.signal_id, 'telegram');
      } catch (err) {
        // The signal is already stored — a failed outbox insert must not
        // fail the ingestion. Log and continue.
        request.log.error({ err }, 'webhook: failed to insert delivery job');
      }

      // ── Real-time broadcast ──────────────────────────────────────────────
      broadcaster.broadcast(stored);

      request.log.info(
        {
          signal_id: stored.signal_id,
          symbol: stored.symbol,
          direction: stored.direction,
          entry: stored.entry,
        },
        'webhook: signal stored',
      );
      return reply.code(200).send({
        received: true,
        signal_id: stored.signal_id,
        inserted_at: stored.inserted_at,
      });
    },
  );
}
