/**
 * paystackWebhook.ts — POST /webhooks/paystack
 *
 * The single payment verification path from Paystack. Flow:
 *   1. verify x-paystack-signature (HMAC-SHA512 over the exact raw body)
 *   2. validate the event shape (Zod, passthrough — full payload preserved)
 *   3. dispatch:
 *        charge.success → handle_paystack_charge_success (DB, idempotent)
 *        charge.failed  → handle_paystack_charge_failed  (DB, idempotent)
 *        anything else  → acknowledged + ignored
 *   4. always answer 200 to verified, parseable events (even duplicates) so
 *      Paystack never loops retries on a webhook we already consumed.
 *
 * Trust model: the client NEVER sets payment status. Only this route (with a
 * valid Paystack signature) can move a payment to success and activate a
 * subscription, and only the database function performs the mutation.
 */
import type { FastifyInstance } from 'fastify';
import type { DbClient } from '../db/supabase';
import { paystackWebhookEventSchema } from '../schemas/paystack';
import {
  PAYSTACK_CHARGE_FAILED_EVENT,
  PAYSTACK_CHARGE_SUCCESS_EVENT,
} from '../schemas/paystack';
import {
  processChargeFailed,
  processChargeSuccess,
  verifyPaystackSignature,
} from '../services/paystackService';

export interface PaystackWebhookRouteOptions {
  db: DbClient;
  /** Returns PAYSTACK_SECRET_KEY (function so tests can swap it). */
  getSecret: () => string;
}

export default async function paystackWebhookRoutes(
  app: FastifyInstance,
  opts: PaystackWebhookRouteOptions,
): Promise<void> {
  const { db, getSecret } = opts;

  app.post('/webhooks/paystack', async (request, reply) => {
    const secret = getSecret();
    if (!secret) {
      return reply.code(503).send({ error: 'server_not_configured' });
    }

    const signature = request.headers['x-paystack-signature'] as string | undefined;
    if (!verifyPaystackSignature(request.rawBody, signature, secret)) {
      request.log.warn({ remote: request.ip }, 'paystack: invalid signature');
      return reply.code(401).send({ error: 'invalid_signature' });
    }

    const parsed = paystackWebhookEventSchema.safeParse(request.body);
    if (!parsed.success) {
      request.log.warn(
        { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
        'paystack: payload validation failed',
      );
      return reply.code(400).send({ error: 'invalid_payload' });
    }

    const event = parsed.data;

    switch (event.event) {
      case PAYSTACK_CHARGE_SUCCESS_EVENT:
        try {
          await processChargeSuccess(db, event, request.log);
        } catch (err) {
          request.log.error({ err }, 'paystack: charge.success processing failed');
          return reply.code(500).send({ error: 'internal_error' });
        }
        break;

      case PAYSTACK_CHARGE_FAILED_EVENT:
        try {
          await processChargeFailed(db, event, request.log);
        } catch (err) {
          request.log.error({ err }, 'paystack: charge.failed processing failed');
          return reply.code(500).send({ error: 'internal_error' });
        }
        break;

      default:
        request.log.info({ event: event.event }, 'paystack: event ignored');
    }

    return reply.code(200).send({ received: true });
  });
}
