-- ============================================================================
-- AtlasSignals Relay — 0004 · Row Level Security policies + auth provisioning
-- ----------------------------------------------------------------------------
-- RLS is the enforcement point for client (anon/authenticated) access — the
-- backend service-role key bypasses it, so every policy here only governs
-- direct client reads/writes through Supabase (PostgREST).
--
-- Access model:
--   admin       → sees and manages everything
--   paid        → signals only while now() < active subscription ends_at
--   free_trial  → signals only while now() < 24h trial window
--   public/anon → nothing (no anon policies are created anywhere)
--
-- Service-role-only tables get NO client policies at all:
--   payments (insert/update/delete), delivery_outbox (all ops).
-- ============================================================================

-- Re-assert RLS on every table (0001 enabled it; this keeps the guarantee
-- explicit and idempotent).
alter table public.users             enable row level security;
alter table public.subscriptions     enable row level security;
alter table public.delivery_channels enable row level security;
alter table public.payments          enable row level security;
alter table public.signals           enable row level security;
alter table public.delivery_outbox   enable row level security;

-- ─── USERS ───────────────────────────────────────────────────────────────────
-- Read: own profile or admin. Update/delete: admin only (role changes are an
-- admin/backend concern — clients must never be able to self-promote).
drop policy if exists "users_select_own_or_admin" on public.users;
create policy "users_select_own_or_admin" on public.users
  for select to authenticated
  using (auth.uid() = auth_id or public.is_admin());

drop policy if exists "users_update_admin" on public.users;
create policy "users_update_admin" on public.users
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "users_delete_admin" on public.users;
create policy "users_delete_admin" on public.users
  for delete to authenticated
  using (public.is_admin());

-- ─── SUBSCRIPTIONS ───────────────────────────────────────────────────────────
-- Read: own subscription history or admin. Mutations are admin/backend only
-- (activation happens through the Paystack webhook processor, service role).
drop policy if exists "subscriptions_select_own_or_admin" on public.subscriptions;
create policy "subscriptions_select_own_or_admin" on public.subscriptions
  for select to authenticated
  using (user_id = public.current_user_id() or public.is_admin());

drop policy if exists "subscriptions_update_admin" on public.subscriptions;
create policy "subscriptions_update_admin" on public.subscriptions
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ─── PAYMENTS ────────────────────────────────────────────────────────────────
-- Read: own payment history or admin. No insert/update/delete policies — only
-- the backend (service role) writes payments, after verifying Paystack.
drop policy if exists "payments_select_own_or_admin" on public.payments;
create policy "payments_select_own_or_admin" on public.payments
  for select to authenticated
  using (user_id = public.current_user_id() or public.is_admin());

-- ─── DELIVERY CHANNELS ───────────────────────────────────────────────────────
-- Users self-manage their own channels (e.g. linking a Telegram handle).
drop policy if exists "delivery_channels_select_own_or_admin" on public.delivery_channels;
create policy "delivery_channels_select_own_or_admin" on public.delivery_channels
  for select to authenticated
  using (user_id = public.current_user_id() or public.is_admin());

drop policy if exists "delivery_channels_insert_own" on public.delivery_channels;
create policy "delivery_channels_insert_own" on public.delivery_channels
  for insert to authenticated
  with check (user_id = public.current_user_id());

drop policy if exists "delivery_channels_update_own" on public.delivery_channels;
create policy "delivery_channels_update_own" on public.delivery_channels
  for update to authenticated
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id());

drop policy if exists "delivery_channels_delete_own" on public.delivery_channels;
create policy "delivery_channels_delete_own" on public.delivery_channels
  for delete to authenticated
  using (user_id = public.current_user_id());

-- ─── SIGNALS ─────────────────────────────────────────────────────────────────
-- THE premium-content gate. Visibility is resolved per user by
-- user_can_access_signals() (role + trial/paid window, all now() based).
-- Insert/update/delete are service-role only (the HF Space webhook).
drop policy if exists "signals_select_authorized" on public.signals;
create policy "signals_select_authorized" on public.signals
  for select to authenticated
  using (public.user_can_access_signals());

-- ─── DELIVERY OUTBOX ─────────────────────────────────────────────────────────
-- Intentionally NO policies: the outbox is written by the webhook (service
-- role) and read by the future delivery worker (service role). Clients never
-- touch it.

-- ─── AUTH PROVISIONING TRIGGER (lightweight, fires once per signup) ─────────
-- When a user signs up through Supabase Auth, create their profile row and the
-- 24-hour free-trial subscription. This is the only "automatic" row creation;
-- everything else is triggered by explicit application events (webhooks).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
begin
  insert into public.users (auth_id, email, role, created_at, updated_at)
  values (new.id, new.email, 'free_trial', now(), now())
  returning id into v_user_id;

  insert into public.subscriptions (user_id, status, trial_ends_at, started_at, ends_at)
  values (v_user_id, 'trial', now() + interval '24 hours', now(), null);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
