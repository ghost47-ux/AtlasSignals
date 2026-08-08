-- ============================================================================
-- AtlasSignals Relay — 0006 · Telegram credentials via server-only config table
-- ----------------------------------------------------------------------------
-- WHY THIS FILE EXISTS:
--   • Migration 0005 read the Telegram credentials from custom GUCs
--     (`alter database postgres set app.telegram_bot_token = ...`). On hosted
--     Supabase the `postgres` role is NOT a superuser, so setting custom
--     parameters is denied (ERROR 42501: permission denied to set parameter).
--   • This migration replaces that mechanism with a tiny server-only config
--     table. The trigger reads the credentials from `app_config` at runtime;
--     nothing is stored in any migration file.
--
-- SECRETS (never committed): insert the real values once, in the Supabase SQL
-- editor (or via the Management API / `supabase db execute`):
--
--   insert into public.app_config (key, value) values
--     ('telegram_bot_token', '<BOT_TOKEN>'),
--     ('telegram_chat_id',   '<CHAT_ID>')
--   on conflict (key) do update set value = excluded.value, updated_at = now();
--
-- Until the rows exist the trigger is a no-op: the outbox row stays 'pending'
-- (the durable audit trail showing delivery was enqueued).
-- ============================================================================

-- ─── Server-only config table ───────────────────────────────────────────────
create table if not exists public.app_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

-- No policies on purpose: anon/authenticated cannot read or write it (RLS
-- blocks them entirely). Only server roles (postgres, service_role — which
-- bypass RLS) can access it. The backend does not need it; only the delivery
-- trigger reads it.
alter table public.app_config enable row level security;

-- ─── Rewrite the delivery trigger to read from app_config ───────────────────
create or replace function public.dispatch_outbox_telegram()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token  text;
  v_chat   text;
  v_signal record;
  v_text   text;
begin
  select value into v_token from public.app_config where key = 'telegram_bot_token';
  select value into v_chat  from public.app_config where key = 'telegram_chat_id';

  if v_token is null or v_chat is null then
    raise notice
      'telegram delivery not configured (app_config telegram_bot_token / telegram_chat_id) — job % stays pending',
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
  -- let the row stay 'pending' (ops can inspect net._http_response).
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

-- The trigger itself is unchanged (still fires on telegram-channel inserts);
-- this just guarantees it points at the current function definition.
drop trigger if exists outbox_dispatch_telegram on public.delivery_outbox;
create trigger outbox_dispatch_telegram
  after insert on public.delivery_outbox
  for each row
  when (new.channel = 'telegram')
  execute function public.dispatch_outbox_telegram();
