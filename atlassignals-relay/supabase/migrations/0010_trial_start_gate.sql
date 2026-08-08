-- ============================================================================
-- AtlasSignals Relay — 0010 · gate trial access on started_at
-- ----------------------------------------------------------------------------
-- Migration 0008 made weekend signups start their 24h trial when the market
-- opens (subscriptions.started_at = next Monday 00:00 UTC, trial_ends_at =
-- started_at + 24h). But user_can_access_signals_for only checked
-- `now() < trial_ends_at` — for a future-dated trial that is ALWAYS true, so
-- the user got access immediately instead of on Monday. That contradicts the
-- product rule (trial starts when the market opens) and disagreed with the
-- website's "trial starts Monday" lock screen.
--
-- Fix: a free_trial user also needs `now() >= started_at`. Existing users are
-- unaffected (their started_at is in the past). CREATE OR REPLACE preserves
-- the existing EXECUTE grants.
-- ============================================================================

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
            and now() >= coalesce(s.started_at, u.created_at)
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
