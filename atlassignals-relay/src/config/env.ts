/**
 * env.ts — Zod-validated environment configuration.
 *
 * Every config value flows through here so the whole codebase reads from one
 * place. All values are OPTIONAL at parse time (so tests and the app factory
 * can boot without a full environment); `server.ts` enforces the variables
 * that are required for production operation at startup and exits with a
 * clear message.
 *
 * Empty strings (`VAR=`) are treated as unset — `.env` templates ship blank
 * placeholders and a fresh copy must never fail to boot (see `loadEnv`).
 *
 * Paystack keys are intentionally optional: the server boots without them and
 * the payment routes answer 503 (paystack_not_configured) until they are set.
 */
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  SUPABASE_URL: z.string().trim().min(1).optional(),
  SUPABASE_ANON_KEY: z.string().trim().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().trim().min(1).optional(),

  WEBHOOK_SECRET: z.string().trim().min(1).optional(),

  // ── Paystack ──────────────────────────────────────────────────────────────
  PAYSTACK_SECRET_KEY: z.string().trim().min(1).optional(),
  PAYSTACK_PUBLIC_KEY: z.string().trim().min(1).optional(),
  PAYSTACK_CURRENCY: z.string().trim().min(3).max(3).default('NGN'),
  /** Monthly plan price in minor units (kobo for NGN). Required to enable /payments/initialize. */
  PAYSTACK_PLAN_AMOUNT: z.coerce.number().int().positive().optional(),
  PAYSTACK_PLAN_NAME: z.string().trim().min(1).max(64).default('AtlasSignals Monthly'),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  /** Secret token set via Telegram's setWebhook — verifies bot webhook calls. */
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),

  SSE_ENABLED: z.string().default('true'),
  VERSION: z.string().default('0.1.0'),
});

export interface AppEnv {
  port: number;
  nodeEnv: 'development' | 'test' | 'production';
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceRoleKey?: string;
  webhookSecret?: string;
  paystackSecretKey?: string;
  paystackPublicKey?: string;
  paystackCurrency: string;
  paystackPlanAmount?: number;
  paystackPlanName: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  telegramWebhookSecret?: string;
  sseEnabled: boolean;
  version: string;
}

/**
 * Load + validate the environment. Empty strings are normalized to `undefined`
 * first so `.env` template placeholders (`VAR=`) parse as unset rather than
 * failing validation.
 */
export function loadEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  const cleaned: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    cleaned[key] = value === '' ? undefined : value;
  }

  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return {
    port: parsed.data.PORT,
    nodeEnv: parsed.data.NODE_ENV,
    supabaseUrl: parsed.data.SUPABASE_URL,
    supabaseAnonKey: parsed.data.SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
    webhookSecret: parsed.data.WEBHOOK_SECRET,
    paystackSecretKey: parsed.data.PAYSTACK_SECRET_KEY,
    paystackPublicKey: parsed.data.PAYSTACK_PUBLIC_KEY,
    paystackCurrency: parsed.data.PAYSTACK_CURRENCY,
    paystackPlanAmount: parsed.data.PAYSTACK_PLAN_AMOUNT,
    paystackPlanName: parsed.data.PAYSTACK_PLAN_NAME,
    telegramBotToken: parsed.data.TELEGRAM_BOT_TOKEN,
    telegramChatId: parsed.data.TELEGRAM_CHAT_ID,
    telegramWebhookSecret: parsed.data.TELEGRAM_WEBHOOK_SECRET,
    sseEnabled: parsed.data.SSE_ENABLED.toLowerCase() === 'true',
    version: parsed.data.VERSION,
  };
}

/**
 * The config fields required for the relay to function at runtime.
 * (Env var names: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WEBHOOK_SECRET.)
 * Enforced at startup by src/server.ts.
 */
export const REQUIRED_RUNTIME_ENV: ReadonlyArray<keyof AppEnv> = [
  'supabaseUrl',
  'supabaseServiceRoleKey',
  'webhookSecret',
] as const;
