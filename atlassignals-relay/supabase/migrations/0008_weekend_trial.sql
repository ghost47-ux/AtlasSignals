-- ============================================================================
-- AtlasSignals Relay — 0008 · weekend-aware free trial start
-- ----------------------------------------------------------------------------
-- XAU/USD signals are generated Monday–Friday only. A user who signs up on
-- Saturday or Sunday (UTC) would otherwise burn their 24-hour trial while the
-- market is closed. This migration makes the trial start when the market
-- reopens instead:
--
--   • signup during the weekend close (Sat 00:00 UTC → Mon 00:00 UTC)
--     → trial_ends_at = next Monday 00:00 UTC + 24 hours
--   • signup any other time → trial_ends_at = now() + 24 hours (unchanged)
--
-- Access is still evaluated at query time by user_can_access_signals_for
-- (now() < trial_ends_at) — no new jobs, no cron. While the trial is in the
-- future, the user simply has no live window, which is the correct behaviour.
-- The dashboard surfaces the pending start (subscriptions.started_at).
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id      uuid;
  v_now          timestamptz;
  v_trial_start  timestamptz;
  v_trial_end    timestamptz;
begin
  v_now := now();

  -- Weekend (UTC) signup → trial begins at the next Monday 00:00 UTC.
  -- date_trunc('week', …) snaps to the current week's Monday 00:00 UTC;
  -- + 7 days is the FOLLOWING Monday.
  v_trial_start := case
    when extract(dow from v_now at time zone 'UTC') in (0, 6)
      then date_trunc('week', v_now at time zone 'UTC') + interval '7 days'
    else v_now
  end;
  v_trial_end := v_trial_start + interval '24 hours';

  insert into public.users (auth_id, email, role, created_at, updated_at)
  values (new.id, new.email, 'free_trial', v_now, v_now)
  returning id into v_user_id;

  insert into public.subscriptions (user_id, status, trial_ends_at, started_at, ends_at)
  values (v_user_id, 'trial', v_trial_end, v_trial_start, null);

  return new;
end;
$$;

-- The trigger itself is unchanged (same signature) — it keeps firing on signup.
