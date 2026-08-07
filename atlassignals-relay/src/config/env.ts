/**
 * env.ts — Zod-validated environment configuration.
 *
 * Every config value flows through here so the whole codebase reads from one
 * place. All values are OPTIONAL at parse time (so tests and the app factory
 * can boot without a full environment); `server.ts` enforces the variables
 * that are required for production operation at startup and exits with a
 * clear message.
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

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),

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
  telegramBotToken?: string;
  telegramChatId?: string;
  sseEnabled: boolean;
  version: string;
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(env);
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
    telegramBotToken: parsed.data.TELEGRAM_BOT_TOKEN,
    telegramChatId: parsed.data.TELEGRAM_CHAT_ID,
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
