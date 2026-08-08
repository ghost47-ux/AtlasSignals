/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_RELAY_BASE: string;
  readonly VITE_SITE_URL: string;
  readonly VITE_TELEGRAM_BOT_USERNAME: string;
  readonly VITE_PLAN_AMOUNT_MAJOR?: string;
  readonly VITE_PLAN_CURRENCY?: string;
  readonly VITE_CONTACT_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
