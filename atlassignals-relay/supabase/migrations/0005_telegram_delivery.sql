-- ============================================================================
-- AtlasSignals Relay — 0005 · Telegram push delivery via pg_net (no worker)
-- ----------------------------------------------------------------------------
-- WHY (latency + minimal config):
--   • Vercel (the primary host) is serverless — a polling delivery worker via
--     Vercel cron is unusable (Hobby: 1 run/day; Pro: 1 run/minute). This
--     project also has NO background jobs by design (free-tier safe).
--   • pg_net lets Postgres fire HTTP requests asynchronously. An AFTER INSERT
--     trigger on delivery_outbox enqueues the Telegram send INSIDE THE SAME
--     TRANSACTION as the signal insert; the request goes out from a background
--     worker immediately after commit. The webhook response is never blocked
--     on Telegram — the critical path stays <100ms.
--   • Idempotency is preserved: duplicate signals (409) never reach the
--     insert, so they can never re-trigger a send.
--
-- SECRETS (never committed here): the bot token and chat id are read from
-- custom GUCs at trigger runtime. Configure them ONCE in the Supabase SQL
-- editor (real values only there, never in this file):
--
--   alter database postgres set app.telegram_bot_token = '<BOT_TOKEN>';
--   alter database postgres set app.telegram_chat_id   = '<CHAT_ID>';
--
-- Until set, the trigger is a no-op: the outbox row stays 'pending' (the
-- durable audit trail showing delivery was enqueued). The same secrets are
-- ALSO set as Vercel env vars (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) so the
-- backend's manual sender (src/services/deliveryService.ts) can be used too.
-- ============================================================================

create extension if not exists pg_net;

-- pg_net's net schema is locked down by default. The trigger function is
-- SECURITY DEFINER (owner = postgres) so postgres already has execute; grant
-- service_role for parity when rows are inserted server-side.
grant usage on schema net to postgres, service_role;
grant execute on all functions in schema net to postgres, service_role;

-- ─── Trigger function: dispatch a 'telegram' outbox job via pg_net ───────────
-- Runs inside the same transaction as the signal + outbox insert, so the
-- enqueue is atomic with the signal write (rollback rolls both back). The
-- actual HTTP POST happens right after commit in a pg_net background worker.
create or replace function public.dispatch_outbox_telegram()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token  text := current_setting('app.telegram_bot_token', true);
  v_chat   text := current_setting('app.telegram_chat_id', true);
  v_signal record;
  v_text   text;
begin
  if v_token is null or v_chat is null then
    raise notice
      'telegram delivery not configured (app.telegram_bot_token / app.telegram_chat_id) — job % stays pending',
      new.id;
    return new;
  end if;

  select symbol, direction, timeframe, entry, stop_loss, take_profit,
         confidence, setup_name, market_state, analysis_version, created_at
    into v_signal
    from public.signals
   where signal_id = new.signal_id;
  if not found then
    raise notice 'outbox %: signal % not found — cannot send', new.id, new.signal_id;
    return new;
  end if;

  -- Mirror of buildTelegramMessage() in src/services/deliveryService.ts
  -- (plain text — no HTML parse_mode, nothing to escape).
  v_text := '⚡ ATLAS SIGNAL — ' || v_signal.direction || ' ' || v_signal.symbol
            || ' (' || v_signal.timeframe || ')' || E'\n'
            || '────────────────────────────────' || E'\n'
            || 'Entry:        ' || v_signal.entry::text || E'\n'
            || 'Stop Loss:    ' || v_signal.stop_loss::text || E'\n'
            || 'Take Profit:  ' || v_signal.take_profit::text || E'\n'
            || 'Confidence:   ' || v_signal.confidence::text || '/100' || E'\n'
            || 'Setup:        ' || v_signal.setup_name || E'\n'
            || 'Market:       ' || v_signal.market_state || E'\n'
            || 'Engine:       ' || v_signal.analysis_version || E'\n'
            || 'Signal time:  ' || v_signal.created_at::text;

  -- Fire-and-forget enqueue (pg_net posts it after commit). Best-effort by
  -- design: an enqueue failure must NEVER fail the signal insert — log and
  -- let the row stay 'pending' (ops can re-enqueue or inspect net._http_response).
  begin
    perform net.http_post(
      url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'chat_id', v_chat,
        'text', v_text,
        'disable_web_page_preview', true
      ),
      timeout_milliseconds := 8000
    );
  exception when others then
    raise notice 'outbox %: telegram enqueue failed (%) — job stays pending', new.id, sqlerrm;
  end;

  return new;
end;
$$;

-- ─── Trigger ────────────────────────────────────────────────────────────────
drop trigger if exists outbox_dispatch_telegram on public.delivery_outbox;
create trigger outbox_dispatch_telegram
  after insert on public.delivery_outbox
  for each row
  when (new.channel = 'telegram')
  execute function public.dispatch_outbox_telegram();
