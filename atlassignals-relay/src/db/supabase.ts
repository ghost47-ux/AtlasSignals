/**
 * supabase.ts — Supabase Postgres client (Service Role).
 *
 * The backend uses the SERVICE ROLE key for persistence: it bypasses Row Level
 * Security, which is exactly what a trusted server-side service needs. The
 * anon key is provided for future public/client-side access (RLS policies are
 * added in the auth phase — see supabase/migrations).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadEnv, type AppEnv } from '../config/env';

export type DbClient = SupabaseClient;

export function createSupabaseClient(env: AppEnv = loadEnv()): DbClient {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to create the Supabase client.',
    );
  }
  // Lazy require: keeps the (heavy) supabase-js runtime out of the hot path —
  // tests inject a fake DB and never load it, and Vercel cold starts stay lean.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js');
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { 'x-application-name': 'atlassignals-relay' },
    },
  });
}
