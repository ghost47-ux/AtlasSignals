/**
 * paystackService.ts — Paystack payment lifecycle.
 *
 * Webhook flow (idempotent, stateless where possible):
 *   1. the route verifies x-paystack-signature (HMAC-SHA512 over the exact
 *      raw body, key = PAYSTACK_SECRET_KEY)
 *   2. charge.success → `handle_paystack_charge_success` (RPC)
 *      charge.failed  → `handle_paystack_charge_failed`  (RPC)
 *   3. the DATABASE owns idempotency (unique paystack_reference + advisory
 *      lock) and the subscription window math (ends_at = paid_at + 1 month).
 *      The backend never computes expiry itself — it trusts the DB result.
 *
 * Initialize flow:
 *   POST /payments/initialize (authenticated) → Paystack Initialize API →
 *   a `pending` payment row is stored with the reference we generated.
 *   Amounts are converted to/from minor units at the edges; the database
 *   stores major units (numeric(20,2)).
 */
import type { DbClient } from '../db/supabase';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type {
  PaystackInitializeResult,
  PaystackWebhookEvent,
} from '../schemas/paystack';
import {
  PAYSTACK_CHARGE_FAILED_EVENT,
  PAYSTACK_CHARGE_SUCCESS_EVENT,
} from '../schemas/paystack';

export const PAYSTACK_API_BASE = 'https://api.paystack.co';

/** Convert Paystack minor units (kobo) to major units (naira). */
export function fromKobo(minor: number | undefined): number | null {
  if (minor == null) return null;
  return minor / 100;
}

/** Convert major units to Paystack minor units. */
export function toKobo(major: number): number {
  return Math.round(major * 100);
}

/**
 * Verify the x-paystack-signature header. Paystack signs the EXACT raw body
 * with HMAC-SHA512 using the secret key. Constant-time comparison.
 */
export function verifyPaystackSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
  secretKey: string | undefined,
): boolean {
  if (!rawBody || rawBody.length === 0 || !signatureHeader || !secretKey) {
    return false;
  }
  const expected = createHmac('sha512', secretKey).update(rawBody).digest('hex');
  const provided = Buffer.from(signatureHeader.trim(), 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (expectedBuf.length !== provided.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, provided);
}

/** Resolve the app user id from a webhook payload: metadata.user_id first,
 *  then a customer-email lookup. Returns null when unresolvable. */
export async function resolveWebhookUserId(
  db: DbClient,
  event: PaystackWebhookEvent,
): Promise<string | null> {
  const meta = event.data.metadata as Record<string, unknown> | undefined;
  const fromMeta = meta?.user_id;
  if (typeof fromMeta === 'string' && fromMeta.length > 0) {
    return fromMeta;
  }
  const email = event.data.customer?.email;
  if (email) {
    const { data, error } = await db
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (!error && data) {
      return (data as { id: string }).id;
    }
  }
  return null;
}

export interface PaystackProcessResult {
  handled: boolean;
  duplicate?: boolean;
  reason?: string;
}

/**
 * Process a verified charge.success webhook by delegating to the database.
 * The DB function is atomic + idempotent (unique reference + advisory lock):
 *   - first delivery: marks payment success, sets paid_at, upgrades role,
 *     sets ends_at = paid_at + 1 month (or extends an active window)
 *   - duplicate delivery: no-op (returns processed:false, reason:duplicate)
 */
export async function processChargeSuccess(
  db: DbClient,
  event: PaystackWebhookEvent,
  log: FastifyBaseLogger,
): Promise<PaystackProcessResult> {
  const reference = event.data.reference;
  if (!reference) {
    return { handled: false, reason: 'no_reference' };
  }

  const userId = await resolveWebhookUserId(db, event);

  const { data, error } = await db.rpc('handle_paystack_charge_success', {
    p_paystack_reference: reference,
    p_paystack_transaction_id: event.data.id != null ? String(event.data.id) : null,
    p_amount_minor: event.data.amount ?? 0,
    p_currency: event.data.currency ?? 'NGN',
    p_channel: event.data.channel ?? null,
    p_paid_at: event.data.paid_at ?? new Date().toISOString(),
    p_user_id: userId,
    p_raw: event,
  });

  if (error) {
    log.error({ err: error, reference }, 'paystack: charge.success rpc failed');
    throw error;
  }

  const result = (data as { processed?: boolean; reason?: string } | null) ?? {};
  if (result.processed === false) {
    if (result.reason === 'duplicate') {
      log.info({ reference }, 'paystack: duplicate charge.success — already processed');
      return { handled: true, duplicate: true, reason: 'duplicate' };
    }
    // no_user = a genuine Paystack payment we cannot attribute to any account.
    // The money moved but NO payment row exists — surface loudly for ops.
    log.error(
      { reference, reason: result.reason },
      'paystack: charge.success NOT processed — no user binding; payment not recorded. Investigate immediately.',
    );
    return { handled: true, reason: result.reason ?? 'skipped' };
  }

  log.info({ reference, result }, 'paystack: charge.success processed — subscription activated/extended');
  return { handled: true };
}

/**
 * Process a verified charge.failed webhook. Only records the failure — the
 * DB function never touches roles or subscriptions on failure.
 */
export async function processChargeFailed(
  db: DbClient,
  event: PaystackWebhookEvent,
  log: FastifyBaseLogger,
): Promise<PaystackProcessResult> {
  const reference = event.data.reference;
  if (!reference) {
    return { handled: false, reason: 'no_reference' };
  }

  const userId = await resolveWebhookUserId(db, event);

  const { data, error } = await db.rpc('handle_paystack_charge_failed', {
    p_paystack_reference: reference,
    p_paystack_transaction_id: event.data.id != null ? String(event.data.id) : null,
    p_amount_minor: event.data.amount ?? 0,
    p_currency: event.data.currency ?? 'NGN',
    p_channel: event.data.channel ?? null,
    p_user_id: userId,
    p_raw: event,
  });

  if (error) {
    log.error({ err: error, reference }, 'paystack: charge.failed rpc failed');
    throw error;
  }

  log.info({ reference }, 'paystack: charge.failed recorded');
  return { handled: true };
}

export interface InitializeOptions {
  db: DbClient;
  secretKey: string;
  amountMinor: number;
  currency: string;
  planName: string;
  user: { id: string; email: string };
  /** Injected for tests; defaults to the real Paystack endpoint + global fetch. */
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}

export interface InitializeOutcome {
  authorization_url: string;
  reference: string;
  access_code?: string;
}

/**
 * Create a Paystack transaction and persist a `pending` payment row.
 * The reference is generated here and echoed back in the webhook payload —
 * it is the idempotency key for the whole lifecycle.
 */
export async function initializePaystackTransaction(
  opts: InitializeOptions,
): Promise<InitializeOutcome> {
  const { db, secretKey, amountMinor, currency, planName, user } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const apiBase = opts.apiBaseUrl ?? PAYSTACK_API_BASE;

  const reference = `atlas_${randomUUID()}`;

  const res = await fetchImpl(`${apiBase}/transaction/initialize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: user.email,
      amount: amountMinor,
      currency,
      reference,
      metadata: { user_id: user.id, plan: planName },
    }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    status?: boolean;
    message?: string;
    data?: { authorization_url?: string; reference?: string; access_code?: string };
  };

  if (!res.ok || body.status !== true || !body.data?.authorization_url) {
    const err = new Error(`Paystack initialize failed (${res.status}): ${body.message ?? 'unknown error'}`);
    (err as Error & { code?: string }).code = 'PAYSTACK_UPSTREAM';
    throw err;
  }

  const amountMajor = fromKobo(amountMinor);
  const { error } = await db.from('payments').insert({
    user_id: user.id,
    paystack_reference: body.data.reference ?? reference,
    amount: amountMajor,
    currency,
    status: 'pending',
    raw_response: { initialize: body },
  });
  if (error) {
    throw error;
  }

  return {
    authorization_url: body.data.authorization_url,
    reference: body.data.reference ?? reference,
    access_code: body.data.access_code,
  };
}
