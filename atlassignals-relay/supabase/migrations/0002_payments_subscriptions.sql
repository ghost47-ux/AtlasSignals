-- ============================================================================
-- AtlasSignals Relay — 0002 · payments (Paystack), subscription lifecycle,
--                       auth linkage, constraints & indexes
-- ----------------------------------------------------------------------------
-- Upgrade path: applies on top of 0001_init.sql. Every statement is defensive
-- (IF NOT EXISTS / guarded) so the file is safe whether or not 0001 was already
-- applied, and can be re-run harmlessly.
--
-- Design rules (Supabase free tier):
--   • No background jobs / cron. All expiry is evaluated at query time with
--     now() comparisons (see 0003_access_functions.sql).
--   • Only lightweight triggers: updated_at stampers (fires once per UPDATE).
--   • Subscription windows live on `subscriptions` (trial_ends_at / ends_at);
--     RLS + access functions read them at query time.
-- ============================================================================

-- ─── USERS: Supabase Auth linkage ────────────────────────────────────────────
-- `auth_id` = auth.users.id for users who signed up through Supabase Auth.
-- RLS ownership policies key off this column (auth.uid() = auth_id). Users
-- created server-side (service role) may have auth_id = NULL — they are
-- internal-only and cannot be reached through client RLS.
alter table public.users add column if not exists auth_id uuid
  references auth.users (id) on delete cascade;

create unique index if not exists uq_users_auth_id on public.users (auth_id);

-- ─── SUBSCRIPTIONS: time windows + one live row per user ─────────────────────
alter table public.subscriptions add column if not exists updated_at timestamptz not null default now();

-- At most ONE live subscription per user (trial OR active). Canceled / expired
-- rows are kept for history — the partial index intentionally excludes them so
-- a new paid window can always be created.
create unique index if not exists uq_subscriptions_live_per_user
  on public.subscriptions (user_id) where status in ('trial', 'active');

-- The paid-access hot path is `now() < ends_at` — keep it indexed.
create index if not exists idx_subscriptions_ends_at
  on public.subscriptions (ends_at) where ends_at is not null;

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ─── PAYMENTS: replace the placeholder with the Paystack-backed table ────────
-- Legacy placeholder columns from 0001 are dropped (never used, no data).
alter table public.payments
  drop column if exists provider,
  drop column if exists provider_reference;

alter table public.payments
  add column if not exists paystack_reference      text,             -- webhook idempotency key
  add column if not exists paystack_transaction_id text,
  add column if not exists payment_channel         text,
  add column if not exists paid_at                 timestamptz,      -- Paystack confirmation time
  add column if not exists raw_response            jsonb,            -- full webhook payload (audit)
  add column if not exists updated_at              timestamptz not null default now();

-- paystack_reference is THE idempotency key — unique per payment.
create unique index if not exists uq_payments_paystack_reference
  on public.payments (paystack_reference);

create index if not exists idx_payments_created_at on public.payments (created_at);

-- Paystack's native currency is the default.
alter table public.payments alter column currency set default 'NGN';

-- NOT NULL for the critical Paystack columns — enforced only while the table
-- is empty (the live database is empty today; the guard keeps the migration
-- safe for any environment that already stored rows under the 0001 shape).
do $$
begin
  if (select count(*) from public.payments) = 0 then
    alter table public.payments alter column paystack_reference set not null;
  end if;
end $$;

-- Payment invariants (idempotent adds)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_status_check') then
    alter table public.payments add constraint payments_status_check
      check (status in ('pending', 'success', 'failed', 'abandoned'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payments_amount_check') then
    alter table public.payments add constraint payments_amount_check check (amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payments_currency_check') then
    alter table public.payments add constraint payments_currency_check
      check (currency ~ '^[A-Z]{3}$');
  end if;
end $$;

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

-- ─── DELIVERY CHANNELS: one record per user / type / identifier ──────────────
create unique index if not exists uq_delivery_channels_user_type_identifier
  on public.delivery_channels (user_id, channel_type, channel_identifier);

-- ─── DELIVERY OUTBOX: attempts sanity guard ──────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'outbox_attempts_check') then
    alter table public.delivery_outbox add constraint outbox_attempts_check check (attempts >= 0);
  end if;
end $$;

-- ─── SIGNALS: defense-in-depth duplicate guard ────────────────────────────────
-- Backend enforces idempotency_key >= 8 chars (Zod); mirror it in the DB so no
-- other writer can bypass it. Duplicate signals are already impossible via the
-- UNIQUE constraints on signal_id and idempotency_key (0001).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'signals_idempotency_key_len_check') then
    alter table public.signals add constraint signals_idempotency_key_len_check
      check (char_length(idempotency_key) >= 8);
  end if;
end $$;
