/**
 * api.ts — thin client for the relay backend (browser → relay).
 *
 * Only two endpoints need the relay from the browser: payments/initialize
 * (Paystack secret lives server-side) and telegram/link (one-time link codes
 * are service-role inserts). Both take the user's Supabase JWT.
 */
import { RELAY_BASE } from './site';

export interface ApiError {
  error?: string;
  message?: string;
}

export interface InitializePaymentResponse {
  authorization_url: string;
  reference: string;
  access_code?: string;
  currency: string;
  amount_minor: number;
}

export interface TelegramLinkResponse {
  code: string;
  expires_at: string;
  expires_in_seconds: number;
}

async function relayFetch<T>(path: string, token: string | null): Promise<T> {
  const res = await fetch(`${RELAY_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: '{}',
  });
  const body = (await res.json().catch(() => ({}))) as T & ApiError;
  if (!res.ok) {
    const err = new Error(body.error ?? body.message ?? `Request failed (${res.status})`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  return body;
}

/** Start a Paystack checkout. Returns the Paystack authorization URL. */
export function initializePayment(token: string): Promise<InitializePaymentResponse> {
  return relayFetch<InitializePaymentResponse>('/payments/initialize', token);
}

/** Create a one-time Telegram link code for the signed-in user. */
export function createTelegramLink(token: string): Promise<TelegramLinkResponse> {
  return relayFetch<TelegramLinkResponse>('/telegram/link', token);
}
