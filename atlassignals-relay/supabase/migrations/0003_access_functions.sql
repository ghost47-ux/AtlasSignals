-- ============================================================================
-- AtlasSignals Relay — 0003 · query-time access functions + Paystack
--                       idempotent payment processors
-- ----------------------------------------------------------------------------
-- ALL access logic here is evaluated at query time (now() comparisons) — there
-- is NO background job, cron, or scheduled expiry. Expiry "just happens" the
-- moment now() passes trial_ends_at / ends_at.
--
-- Security model:
--   • The four access helpers are SECURITY DEFINER (owner = postgres) and are
--     callable by `authenticated` — RLS policies on the tables call them.
--   • The two Paystack processors are SECURITY DEFINER and callable ONLY by
--     `service_role` (the backend webhook). anon/authenticated are revoked.
--   • Every security-definer function pins search_path to prevent hijacking.
-- ============================================================================

-- ─── Access helpers ──────────────────────────────────────────────────────────

-- The public.users row for the currently authenticated Supabase user, or NULL.
create or replace function public.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.users where auth_id = auth.uid();
$$;

-- True when the current authenticated user is an admin (role bypass).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.users where auth_id = auth.uid() and role = 'admin'
  );
$$;

-- Core visibility rule for a given user id (used by RLS via the wrapper and by
-- the backend read API after JWT verification):
--   admin      → always true (bypasses all windows)
--   free_trial → true only while now() < trial window (24h from activation)
--   paid       → true only while now() < active subscription ends_at
--              (ends_at = paystack paid_at + 1 month, set by the webhook)
create or replace function public.user_can_access_signals_for(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
       u.role = 'admin'
    or (u.role = 'free_trial' and exists (
          select 1 from public.subscriptions s
          where s.user_id = u.id and s.status = 'trial'
            and now() < coalesce(s.trial_ends_at, u.created_at + interval '24 hours')
        ))
    or (u.role = 'paid' and exists (
          select 1 from public.subscriptions s
          where s.user_id = u.id and s.status = 'active'
            and now() < s.ends_at
        ))
  from public.users u
  where u.id = p_user_id;
$$;

-- Same rule resolved from the caller's JWT — used inside the signals RLS policy.
create or replace function public.user_can_access_signals()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.user_can_access_signals_for(public.current_user_id());
$$;

-- ─── Paystack processors (service_role only) ─────────────────────────────────

-- Atomic, idempotent processing of a verified charge.success webhook.
-- Idempotency: pg_advisory_xact_lock keyed on the reference serializes
-- concurrent deliveries; a payment already in status 'success' is a no-op.
-- On first processing it:
--   1. marks the payment success (paid_at = Paystack's paid_at, else now())
--   2. upgrades users.role free_trial → paid (never downgrades an admin)
--   3. sets the subscription window: ends_at = max(now(), current ends_at) + 1 month
-- Returns { processed: bool, reason?, expires_at?, user_id? }.
create or replace function public.handle_paystack_charge_success(
  p_paystack_reference      text,
  p_paystack_transaction_id text,
  p_amount_minor            numeric,   -- Paystack amount (minor units, e.g. kobo)
  p_currency                text,
  p_channel                 text,
  p_paid_at                 timestamptz,
  p_user_id                 uuid,
  p_raw                     jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id  uuid;
  v_status   text;
  v_paid_at  timestamptz;
  v_old_ends timestamptz;
  v_new_ends timestamptz;
begin
  -- Serialize concurrent webhook deliveries for the same reference.
  perform pg_advisory_xact_lock(hashtext('atlas_paystack:' || p_paystack_reference)::bigint);

  select user_id, status into v_user_id, v_status
    from public.payments
   where paystack_reference = p_paystack_reference;

  if found then
    if v_status = 'success' then
      return jsonb_build_object('processed', false, 'reason', 'duplicate');
    end if;
    v_paid_at := coalesce(p_paid_at, now());
    update public.payments
       set status                   = 'success',
           paystack_transaction_id  = coalesce(p_paystack_transaction_id, paystack_transaction_id),
           amount                   = coalesce(p_amount_minor / 100.0, amount), -- major units (preserve existing)
           currency                 = coalesce(p_currency, currency),
           payment_channel          = coalesce(p_channel, payment_channel),
           paid_at                  = v_paid_at,
           raw_response             = p_raw,
           updated_at               = now()
     where paystack_reference = p_paystack_reference;
  else
    if p_user_id is null then
      return jsonb_build_object('processed', false, 'reason', 'no_user');
    end if;
    v_user_id := p_user_id;
    v_paid_at := coalesce(p_paid_at, now());
    insert into public.payments (
      user_id, paystack_reference, paystack_transaction_id, amount,
      currency, status, payment_channel, paid_at, raw_response
    ) values (
      v_user_id, p_paystack_reference, p_paystack_transaction_id,
      coalesce(p_amount_minor, 0) / 100.0, coalesce(p_currency, 'NGN'),
      'success', p_channel, v_paid_at, p_raw
    );
  end if;

  -- Upgrade free_trial → paid (admins are never downgraded).
  update public.users
     set role = 'paid', updated_at = now()
   where id = v_user_id and role <> 'admin';

  -- Compute the new window: renewals extend from the current end, otherwise
  -- one month from the paid_at moment (the exact Paystack confirmation time).
  select ends_at into v_old_ends
    from public.subscriptions
   where user_id = v_user_id and status in ('trial', 'active')
   order by (status = 'active') desc, ends_at desc nulls last
   limit 1
   for update;

  v_new_ends := case
    when v_old_ends is not null and v_old_ends > v_paid_at then v_old_ends + interval '1 month'
    else v_paid_at + interval '1 month'
  end;

  insert into public.subscriptions (user_id, status, trial_ends_at, started_at, ends_at)
  values (v_user_id, 'active', null, v_paid_at, v_new_ends)
  on conflict (user_id) where status in ('trial', 'active')
  do update set
    status      = 'active',
    trial_ends_at = null,
    ends_at     = excluded.ends_at,
    updated_at  = now();

  return jsonb_build_object(
    'processed', true,
    'user_id',   v_user_id,
    'paid_at',   v_paid_at,
    'expires_at', v_new_ends
  );
end;
$$;

-- Idempotent processing of a verified charge.failed webhook. Records the
-- failure permanently; NEVER touches the subscription or role. A payment that
-- already reached 'success' is left untouched (success wins over a later
-- retried failure event).
create or replace function public.handle_paystack_charge_failed(
  p_paystack_reference      text,
  p_paystack_transaction_id text,
  p_amount_minor            numeric,
  p_currency                text,
  p_channel                 text,
  p_user_id                 uuid,
  p_raw                     jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
begin
  select user_id into v_user_id
    from public.payments
   where paystack_reference = p_paystack_reference;

  if v_user_id is null then
    v_user_id := p_user_id;
  end if;

  if v_user_id is null then
    return jsonb_build_object('processed', false, 'reason', 'no_user');
  end if;

  insert into public.payments (
    user_id, paystack_reference, paystack_transaction_id, amount,
    currency, status, payment_channel, raw_response
  ) values (
    v_user_id, p_paystack_reference, p_paystack_transaction_id,
    coalesce(p_amount_minor, 0) / 100.0, coalesce(p_currency, 'NGN'),
    'failed', p_channel, p_raw
  )
  on conflict (paystack_reference) do update set
    status                  = case when public.payments.status = 'success' then 'success' else 'failed' end,
    paystack_transaction_id = coalesce(excluded.paystack_transaction_id, public.payments.paystack_transaction_id),
    raw_response            = excluded.raw_response,
    updated_at              = now();

  return jsonb_build_object('processed', true, 'status', 'failed');
end;
$$;

-- ─── Grants ──────────────────────────────────────────────────────────────────
-- Postgres grants EXECUTE to PUBLIC by default. Lock these down:
--   • access helpers → authenticated (RLS policies) + service_role (backend)
--   • Paystack processors → service_role ONLY (backend webhook)
revoke execute on function public.current_user_id()             from public;
revoke execute on function public.is_admin()                    from public;
revoke execute on function public.user_can_access_signals()     from public;
revoke execute on function public.user_can_access_signals_for(uuid) from public;
revoke execute on function public.handle_paystack_charge_success(text, text, numeric, text, text, timestamptz, uuid, jsonb) from public;
revoke execute on function public.handle_paystack_charge_failed(text, text, numeric, text, text, uuid, jsonb) from public;

grant execute on function public.current_user_id()             to authenticated, service_role;
grant execute on function public.is_admin()                    to authenticated, service_role;
grant execute on function public.user_can_access_signals()     to authenticated, service_role;
grant execute on function public.user_can_access_signals_for(uuid) to authenticated, service_role;

grant execute on function public.handle_paystack_charge_success(text, text, numeric, text, text, timestamptz, uuid, jsonb) to service_role;
grant execute on function public.handle_paystack_charge_failed(text, text, numeric, text, text, uuid, jsonb) to service_role;
