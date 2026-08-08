/**
 * paystack.ts — Paystack webhook event schema.
 *
 * Parsed with `.passthrough()` and minimal required fields: Paystack's `data`
 * object varies per event type, and the full payload is preserved verbatim in
 * `payments.raw_response` (jsonb) for audit/debugging.
 *
 * The authoritative processing happens in the database
 * (`handle_paystack_charge_success` / `handle_paystack_charge_failed`) — this
 * schema only needs enough structure to decide which handler to call.
 */
import { z } from 'zod';

export const paystackWebhookEventSchema = z
  .object({
    event: z.string().min(1),
    data: z
      .object({
        /** Paystack transaction id (number) — stored as text. */
        id: z.number().int().positive().optional(),
        /** The reference we generated at initialize time — THE idempotency key. */
        reference: z.string().min(1).optional(),
        status: z.string().optional(),
        /** Paystack amounts are always in minor units (kobo for NGN). */
        amount: z.number().optional(),
        currency: z.string().optional(),
        /** payment channel, e.g. card / bank / ussd / transfer. */
        channel: z.string().optional(),
        paid_at: z.string().datetime({ offset: true }).optional(),
        created_at: z.string().datetime({ offset: true }).optional(),
        /** initialize-time metadata — carries `user_id` (the app user uuid). */
        metadata: z.record(z.unknown()).optional(),
        customer: z
          .object({
            id: z.number().int().optional(),
            email: z.string().email().optional(),
          })
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type PaystackWebhookEvent = z.infer<typeof paystackWebhookEventSchema>;

/** Events the relay actually acts on. Everything else is acknowledged + ignored. */
export const PAYSTACK_CHARGE_SUCCESS_EVENT = 'charge.success';
export const PAYSTACK_CHARGE_FAILED_EVENT = 'charge.failed';

export interface PaystackInitializeResult {
  reference: string;
  authorization_url: string;
  access_code?: string;
}
