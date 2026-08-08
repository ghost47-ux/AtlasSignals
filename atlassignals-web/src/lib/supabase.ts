/**
 * supabase.ts — Supabase client (ANON key only).
 *
 * Security model: every read is enforced by Row Level Security with the
 * user's session. An anonymous visitor sees nothing; an authenticated user
 * sees only signals while their trial/paid window is live (the exact same
 * rule the backend enforces). No service-role key ever touches the browser.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Fail loudly in dev; Vercel builds inject these at build time.
  throw new Error(
    'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required. See .env.example.',
  );
}

export const supabase: SupabaseClient = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
  global: {
    headers: { 'x-application-name': 'atlassignals-web' },
  },
});

/** Typed row shapes used across the app (mirror of the SQL schema). */
export interface ProfileRow {
  id: string;
  auth_id: string | null;
  email: string;
  role: 'free_trial' | 'paid' | 'admin';
  created_at: string;
  updated_at: string;
}

export interface SubscriptionRow {
  id: string;
  user_id: string;
  status: 'trial' | 'active' | 'canceled' | 'expired';
  trial_ends_at: string | null;
  started_at: string;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeliveryChannelRow {
  id: string;
  user_id: string;
  channel_type: 'telegram' | 'discord' | 'email';
  channel_identifier: string;
  is_verified: boolean;
  created_at: string;
}

export interface PaymentRow {
  id: string;
  user_id: string;
  paystack_reference: string | null;
  amount: number | null;
  currency: string;
  status: 'pending' | 'success' | 'failed' | 'abandoned';
  payment_channel: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SignalRow {
  id: string;
  signal_id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  timeframe: string;
  entry: number;
  stop_loss: number;
  take_profit: number;
  confidence: number;
  setup_name: string;
  market_state: string;
  analysis_version: string;
  created_at: string;
  inserted_at: string;
  /** Full canonical event + passthrough metadata (JSONB), incl. setup_tier. */
  raw_payload?: { metadata?: { setup_tier?: string } } | null;
}

/** Conviction tier (A/B/C) from the engine's passthrough metadata, if present. */
export function signalTier(signal: SignalRow): string | null {
  const tier = signal.raw_payload?.metadata?.setup_tier;
  return tier && /^[ABC]$/i.test(tier) ? tier.toUpperCase() : null;
}
