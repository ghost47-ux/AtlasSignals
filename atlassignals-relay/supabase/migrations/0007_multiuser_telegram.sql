-- ============================================================================
-- AtlasSignals Relay — 0007 · Telegram multi-user: link codes, bot linking,
--                       per-user signal fan-out
-- ----------------------------------------------------------------------------
-- Flow:
--   1. A logged-in website user asks the backend for a one-time link code
--      (POST /telegram/link, JWT). The backend inserts a row here.
--   2. The user taps the Telegram deep link (t.me/<bot>?start=<code>); the
--      bot webhook (POST /webhooks/telegram on the backend) calls
--      redeem_telegram_link(code, chat_id).
--   3. The RPC marks the code used and upserts the verified delivery channel
--      (user_id, telegram, chat_id) — the web user and Telegram chat are now
--      the same account (persistence).
--   4. On every new signal, dispatch_outbox_telegram (migrations 0005/0006)
--      now fans out to EVERY accessible user's verified Telegram chat
--      (free_trial / paid / admin, all evaluated at query time by
--      user_can_access_signals_for) — with a fallback to the operator/global
--      chat when no user has linked yet (legacy behaviour).
-- ============================================================================

-- ─── One-time link codes (server-only; no client policies) ──────────────────
create table if not exists public.telegram_link_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  code       text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

alter table public.telegram_link_codes enable row level security;
-- No policies: anon/authenticated cannot read/write it. The backend (service
-- role) inserts codes; redeem_telegram_link (SECURITY DEFINER) consumes them.

create index if not exists idx_telegram_link_codes_user_id
  on public.telegram_link_codes (user_id);
create index if not exists idx_telegram_link_codes_unused
  on public.telegram_link_codes (expires_at) where used_at is null;

-- ─── Redeem RPC (service_role only) ─────────────────────────────────────────
-- Validates the code (unused + unexpired), marks it used, and upserts the
-- user's verified Telegram delivery channel. Returns the linked email so the
-- bot can confirm to the user which account the chat now belongs to.
create or replace function public.redeem_telegram_link(p_code text, p_chat_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_email   text;
begin
  if p_code is null or p_chat_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_params');
  end if;

  select user_id into v_user_id
    from public.telegram_link_codes
   where code = p_code
     and used_at is null
     and expires_at > now()
   limit 1;

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_or_expired');
  end if;

  update public.telegram_link_codes set used_at = now() where code = p_code;

  insert into public.delivery_channels (user_id, channel_type, channel_identifier, is_verified)
  values (v_user_id, 'telegram', p_chat_id, true)
  on conflict (user_id, channel_type, channel_identifier)
  do update set is_verified = true;

  select email into v_email from public.users where id = v_user_id;

  return jsonb_build_object('ok', true, 'user_id', v_user_id, 'email', v_email);
end;
$$;

revoke execute on function public.redeem_telegram_link(text, text) from public;
grant execute on function public.redeem_telegram_link(text, text) to service_role;

-- ─── Per-user fan-out trigger (replaces the single-chat version) ────────────
create or replace function public.dispatch_outbox_telegram()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token   text;
  v_chat    text;
  v_fallback text;
  v_signal  record;
  v_text    text;
  v_sent    integer := 0;
begin
  select value into v_token from public.app_config where key = 'telegram_bot_token';
  select value into v_fallback from public.app_config where key = 'telegram_chat_id';

  if v_token is null then
    raise notice 'telegram delivery not configured (app_config telegram_bot_token) — job % stays pending', new.id;
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

  -- Fan out to every user with live access (free_trial / paid / admin —
  -- user_can_access_signals_for) who has linked a verified Telegram chat.
  for v_chat in
    select dc.channel_identifier
      from public.users u
      join public.delivery_channels dc on dc.user_id = u.id
     where dc.channel_type = 'telegram'
       and dc.is_verified
       and public.user_can_access_signals_for(u.id)
  loop
    begin
      perform net.http_post(
        url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object('chat_id', v_chat, 'text', v_text, 'disable_web_page_preview', true),
        timeout_milliseconds := 8000
      );
      v_sent := v_sent + 1;
    exception when others then
      raise notice 'outbox %: telegram enqueue to % failed (%)', new.id, v_chat, sqlerrm;
    end;
  end loop;

  -- Fallback: nobody linked yet → send to the operator/global chat so signals
  -- still flow (legacy behaviour until the first user links their Telegram).
  if v_sent = 0 and v_fallback is not null then
    begin
      perform net.http_post(
        url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object('chat_id', v_fallback, 'text', v_text, 'disable_web_page_preview', true),
        timeout_milliseconds := 8000
      );
    exception when others then
      raise notice 'outbox %: telegram fallback enqueue failed (%)', new.id, sqlerrm;
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists outbox_dispatch_telegram on public.delivery_outbox;
create trigger outbox_dispatch_telegram
  after insert on public.delivery_outbox
  for each row
  when (new.channel = 'telegram')
  execute function public.dispatch_outbox_telegram();
