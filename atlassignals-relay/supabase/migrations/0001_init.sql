-- ============================================================================
-- AtlasSignals Relay — initial schema
-- ----------------------------------------------------------------------------
-- Run this file in the Supabase SQL editor (or via `supabase db push`).
--
-- Design notes:
--   • Signals are the canonical, source-of-truth records produced by the
--     Hugging Face analysis engine and ingested via POST /webhooks/signal.
--   • Users / subscriptions / delivery_channels / payments are the future
--     multi-user foundation. They are intentionally simple (roles:
--     free_trial | paid | admin) and NOT yet wired into the signal pipeline —
--     the signal core is independent of any user or channel.
--   • Delivery is decoupled through the delivery_outbox (outbox pattern).
--   • RLS is enabled with NO policies yet: the backend uses the service-role
--     key (bypasses RLS), and client/anon policies are added in the auth phase.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ─── USERS ───────────────────────────────────────────────────────────────────
create table if not exists public.users (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  role       text not null default 'free_trial'
             check (role in ('free_trial', 'paid', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── SUBSCRIPTIONS ───────────────────────────────────────────────────────────
create table if not exists public.subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  status        text not null default 'trial'
                check (status in ('trial', 'active', 'canceled', 'expired')),
  trial_ends_at timestamptz,
  started_at    timestamptz not null default now(),
  ends_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_subscriptions_user_id on public.subscriptions (user_id);

-- ─── DELIVERY CHANNELS (per-user, added during the multi-user phase) ─────────
create table if not exists public.delivery_channels (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users(id) on delete cascade,
  channel_type       text not null
                     check (channel_type in ('telegram', 'discord', 'email')),
  channel_identifier text not null,
  is_verified        boolean not null default false,
  created_at         timestamptz not null default now()
);
create index if not exists idx_delivery_channels_user_id on public.delivery_channels (user_id);

-- ─── PAYMENTS (placeholder structure only — checkout comes later) ───────────
create table if not exists public.payments (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users(id) on delete cascade,
  provider           text,
  provider_reference text,
  amount             numeric(20, 2),
  currency           text not null default 'USD',
  status             text not null default 'pending',
  created_at         timestamptz not null default now()
);
create index if not exists idx_payments_user_id on public.payments (user_id);

-- ─── SIGNALS (canonical source of truth) ─────────────────────────────────────
create table if not exists public.signals (
  id               uuid primary key default gen_random_uuid(),
  signal_id        uuid not null unique,
  symbol           text not null,
  direction        text not null check (direction in ('BUY', 'SELL')),
  timeframe        text not null,
  entry            numeric not null,
  stop_loss        numeric not null,
  take_profit      numeric not null,
  confidence       integer not null check (confidence between 0 and 100),
  setup_name       text not null,
  market_state     text not null,
  analysis_version text not null,
  created_at       timestamptz not null,
  idempotency_key  text not null unique,        -- duplicate guard (backend)
  raw_payload      jsonb,                        -- full canonical event + metadata
  inserted_at      timestamptz not null default now()
);
create index if not exists idx_signals_created_at on public.signals (created_at desc);
create index if not exists idx_signals_symbol     on public.signals (symbol);
create index if not exists idx_signals_direction  on public.signals (direction);

-- ─── DELIVERY OUTBOX (async notification jobs) ───────────────────────────────
create table if not exists public.delivery_outbox (
  id         uuid primary key default gen_random_uuid(),
  signal_id  uuid not null references public.signals(signal_id) on delete cascade,
  channel    text not null check (channel in ('telegram', 'discord', 'email')),
  status     text not null default 'pending'
             check (status in ('pending', 'sent', 'failed')),
  attempts   integer not null default 0,
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
create index if not exists idx_outbox_pending
  on public.delivery_outbox (created_at) where status = 'pending';

-- ─── updated_at TRIGGER ──────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- ─── ROW LEVEL SECURITY (prepared, not yet enforced) ─────────────────────────
-- The backend uses the service-role key (bypasses RLS). When auth arrives,
-- add policies here per table — the schema does not need to change.
alter table public.users            enable row level security;
alter table public.subscriptions    enable row level security;
alter table public.delivery_channels enable row level security;
alter table public.payments         enable row level security;
alter table public.signals          enable row level security;
alter table public.delivery_outbox  enable row level security;

-- No policies are defined yet — anon access is fully blocked until the
-- auth/visibility phase (free_trial / paid / admin) is implemented.
