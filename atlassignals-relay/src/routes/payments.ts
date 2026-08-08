/**
 * payments.ts — POST /payments/initialize (authenticated)
 *
 * Starts the Paystack lifecycle for the current user:
 *   1. verifies the caller's Supabase JWT (requireAuth)
 *   2. asks Paystack to initialize a transaction (amount = PAYSTACK_PLAN_AMOUNT
 *      in minor units, reference generated here, user_id embedded in metadata)
 *   3. stores a `pending` payment row keyed on paystack_reference
 *   4. returns the authorization_url for the client to redirect to
 *
 * The client never reports success — only the verified Paystack webhook can
 * flip the payment to success and activate the subscription.
 *
 * Requires PAYSTACK_SECRET_KEY + PAYSTACK_PLAN_AMOUNT (503 until configured).
 */
import type { FastifyInstance } from 'fastify';
import type { DbClient } from '../db/supabase';
import type { AuthMiddleware } from '../middleware/requireAuth';
import { initializePaystackTransaction } from '../services/paystackService';

export interface PaymentRouteOptions {
  db: DbClient;
  requireAuth: AuthMiddleware;
  paystack: {
    secretKey?: string;
    publicKey?: string;
    currency: string;
    planAmount?: number;
    planName: string;
    fetchImpl?: typeof fetch;
    apiBaseUrl?: string;
  };
}

export default async function paymentRoutes(
  app: FastifyInstance,
  opts: PaymentRouteOptions,
): Promise<void> {
  const { db, requireAuth, paystack } = opts;

  app.post(
    '/payments/initialize',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!paystack.secretKey) {
        return reply.code(503).send({ error: 'paystack_not_configured' });
      }
      if (!paystack.planAmount) {
        return reply.code(503).send({ error: 'plan_not_configured' });
      }
      const user = request.appUser;
      if (!user) {
        return reply.code(401).send({ error: 'unauthorized' });
      }

      try {
        const outcome = await initializePaystackTransaction({
          db,
          secretKey: paystack.secretKey,
          amountMinor: paystack.planAmount,
          currency: paystack.currency,
          planName: paystack.planName,
          user: { id: user.id, email: user.email },
          fetchImpl: paystack.fetchImpl,
          apiBaseUrl: paystack.apiBaseUrl,
        });
        return reply.send({
          authorization_url: outcome.authorization_url,
          reference: outcome.reference,
          access_code: outcome.access_code,
          currency: paystack.currency,
          amount_minor: paystack.planAmount,
        });
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'PAYSTACK_UPSTREAM') {
          request.log.error({ err }, 'payments: Paystack upstream error');
          return reply.code(502).send({ error: 'paystack_upstream_error' });
        }
        request.log.error({ err }, 'payments: initialize failed');
        return reply.code(500).send({ error: 'internal_error' });
      }
    },
  );
}
