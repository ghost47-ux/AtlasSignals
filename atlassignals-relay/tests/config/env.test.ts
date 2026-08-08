import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';

describe('loadEnv with empty-string placeholders (.env template copies)', () => {
  it('treats empty required-ish vars as unset (no boot crash)', () => {
    const env = loadEnv({
      PORT: '',
      NODE_ENV: '',
      SUPABASE_URL: '',
      SUPABASE_ANON_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      WEBHOOK_SECRET: '',
      PAYSTACK_SECRET_KEY: '',
      PAYSTACK_PUBLIC_KEY: '',
      PAYSTACK_PLAN_AMOUNT: '',
      PAYSTACK_CURRENCY: '',
      PAYSTACK_PLAN_NAME: '',
      SSE_ENABLED: '',
      VERSION: '',
    } as NodeJS.ProcessEnv);

    expect(env.port).toBe(3000);
    expect(env.nodeEnv).toBe('development');
    expect(env.supabaseUrl).toBeUndefined();
    expect(env.supabaseServiceRoleKey).toBeUndefined();
    expect(env.webhookSecret).toBeUndefined();
    expect(env.paystackSecretKey).toBeUndefined();
    expect(env.paystackPlanAmount).toBeUndefined();
    expect(env.paystackCurrency).toBe('NGN');
    expect(env.paystackPlanName).toBe('AtlasSignals Monthly');
    expect(env.sseEnabled).toBe(true);
    expect(env.version).toBe('0.1.0');
  });

  it('parses real Paystack values', () => {
    const env = loadEnv({
      PAYSTACK_SECRET_KEY: 'sk_live_abc',
      PAYSTACK_PLAN_AMOUNT: '500000',
      PAYSTACK_CURRENCY: 'NGN',
      PAYSTACK_PLAN_NAME: 'AtlasSignals Monthly',
    } as NodeJS.ProcessEnv);
    expect(env.paystackSecretKey).toBe('sk_live_abc');
    expect(env.paystackPlanAmount).toBe(500000);
    expect(env.paystackCurrency).toBe('NGN');
  });
});
