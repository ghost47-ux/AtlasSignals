# Handoff — Continue-From-Here Guide

This document is written so another AI agent (or engineer) can open the repo
and continue development immediately, without asking basic questions.

---

## Project purpose

AtlasSignals = low-latency XAU/USD trading signals.

- **Hugging Face Space** (`aka465355/AtlasSignals`, separate repo): analysis
  engine — hydration, MTF context, scoring, signal generation, and webhook
  relay (`signal_relay.py`).
- **This repo (`atlassignals-relay`)**: the source-of-truth backend. Ingests
  signed signals, stores them in Supabase, and (future) delivers notifications.

## Current scope (what works)

- [x] Signed webhook ingestion (`POST /webhooks/signal`) with HMAC-SHA256
      verification, Zod validation, idempotency (fast-path + UNIQUE backstop).
- [x] Supabase persistence (`signals` table), full canonical event preserved
      in `raw_payload`.
- [x] Delivery outbox: Telegram job inserted per signal; worker + channel
      senders are placeholders.
- [x] Read API: `GET /signals/latest`, `GET /signals`, `GET /signals/:signal_id`.
- [x] SSE stream `GET /stream` (long-running hosts).
- [x] `GET /health`.
- [x] Multi-user layer fully built: Paystack payments, subscription windows,
      RLS policies, query-time access functions, auth provisioning trigger.
- [x] Paystack lifecycle: `POST /payments/initialize` + `POST /webhooks/paystack`
      (HMAC-SHA512 verified, DB-owned idempotency + window math).
- [x] Read API gated by Supabase JWT + `user_can_access_signals_for` RPC.
- [x] Telegram multi-user: one-time link codes, bot webhook (`/webhooks/telegram`,
      X-Telegram-Bot-Api-Secret-Token), per-user fan-out trigger (0007) —
      signals go to every linked user with live access; unlinked chats get nothing.
- [x] Weekend-aware free trial (0008): signups on Sat/Sun start the 24h trial
      when the market opens Monday. Realtime publication for the dashboard (0009).
- [x] CORS for the website origin (hand-rolled onRequest hook, no new deps).
- [x] **Website live** (`atlassignals-web`, React PWA) at
      https://atlassignals-web.vercel.app — Google+email auth, RLS dashboard
      with Realtime, Paystack upgrade, Telegram linking, Groq support assistant.
- [x] Vitest suite (79 tests) + typecheck + build.

## Repository map

```
src/server.ts                 standalone entrypoint
src/app.ts                    Fastify factory (inject db/secret for tests)
src/config/env.ts             all env config (Zod)
src/schemas/signal.ts         canonical schema — change here first
src/middleware/verifySignature.ts  HMAC verification + raw-body capture hook in app.ts
src/services/signalService.ts persistence/queries
src/services/deliveryService.ts    outbox + placeholders
src/services/paystackService.ts    Paystack verify + dispatch + initialize
src/services/websocketService.ts   SSE broadcaster
src/routes/webhook.ts         POST /webhooks/signal
src/routes/paystackWebhook.ts POST /webhooks/paystack
src/routes/payments.ts        POST /payments/initialize
src/routes/signals.ts         read API + /stream (JWT + access gated)
src/routes/health.ts          health
src/routes/telegram.ts        POST /telegram/link + POST /webhooks/telegram (bot)
src/services/telegramService.ts link codes + redeem + bot replies
src/middleware/requireAuth.ts JWT auth + access enforcement
api/index.ts                  Vercel bridge
supabase/migrations/0001–0009  schema + RLS + functions + triggers
tests/                        Vitest (fake DB in tests/helpers/fakeDb.ts)

---

## Website repo (`atlassignals-web/` — sibling directory)

React PWA (Vite + react-router + @supabase/supabase-js + vite-plugin-pwa).

- `src/pages/` — Home (landing), Auth (Google+email), Dashboard (live feed),
  Settings (profile/Telegram/billing), NotFound.
- `src/components/` — glass UI kit, Background canvas, Ticker, SignalCard,
  Sparkline, Countdown, Pricing, Faq, TelegramConnect, ChatWidget.
- `api/chat.ts` — Groq agentic assistant (tools: navigate_to, link_telegram,
  start_checkout; `tool_choice:'required'` on action intents + plain-text
  fallback + keyword action extraction).
- Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_RELAY_BASE`,
  `VITE_SITE_URL`, `VITE_TELEGRAM_BOT_USERNAME`, `VITE_PLAN_AMOUNT_MAJOR`,
  `VITE_PLAN_CURRENCY`, `VITE_CONTACT_EMAIL`, `GROQ_API_KEY`.
- Build/deploy: `npm run build && vercel deploy --prod --yes`.
```

## Database schema

Tables: `users`, `subscriptions`, `delivery_channels`, `payments`
(Paystack-backed), `signals`, `delivery_outbox`. Key constraints:
`signals.signal_id UNIQUE`, `signals.idempotency_key UNIQUE`,
`payments.paystack_reference UNIQUE`, one live subscription per user (partial
UNIQUE), `delivery_outbox.signal_id → signals.signal_id`. RLS fully enforced
with explicit policies; helper functions (`user_can_access_signals_for`,
`handle_paystack_charge_*`) provide query-time enforcement. See
`docs/database.md` + `docs/payments.md`.

## API routes

| Method | Path | Notes |
|--------|------|-------|
| POST   | `/webhooks/signal` | signed; 401/409/422/500/503 |
| POST   | `/webhooks/paystack` | HMAC-SHA512; 503/401/400/500/200 |
| POST   | `/payments/initialize` | JWT; 401/503/502/500/200 |
| GET    | `/signals/latest`  | JWT + access; 401/403/404 |
| GET    | `/signals`         | JWT + access; `?limit=` (≤200) `&offset=` |
| GET    | `/signals/:signal_id` | JWT + access; canonical UUID |
| GET    | `/stream`          | JWT + access (`?token=` ok); disabled on Vercel |
| GET    | `/health`          | DB-aware |

## Deployment process

**LIVE (Aug 2026):** https://atlassignals-relay.vercel.app ·
https://atlassignals-web.vercel.app (website) · Supabase project
`spelcbrxsxnxhjlidfii` (migrations 0001–0009 applied) · HF Space
`aka465355/AtlasSignals` pointed at the live webhook. Supabase Auth:
`site_url` + `uri_allow_list` include the website (Google OAuth enabled).

1. Apply migrations: `supabase db push` (project pre-linked) or the SQL editor.
2. Set env vars (see `deployment.md`), including Paystack when ready.
3. Vercel: `vercel link --yes` + `vercel deploy --prod --yes`
   (`vercel.json` = `builds` + `bodyParser:false`; never combine with
   `functions`).
4. Other hosts: `npm ci && npm run build && npm start`.
5. HF Space secrets `ATLAS_WEBHOOK_URL` + matching `WEBHOOK_SECRET` — set.
6. Register the Paystack webhook URL `https://atlassignals-relay.vercel.app/
   webhooks/paystack` in the Paystack dashboard (test AND live modes).
7. Telegram push credentials (migrations 0005 + 0006) live in the
   server-only `public.app_config` table — DONE via the Management API:
   `insert into public.app_config (key, value) values
   ('telegram_bot_token', '<token>'), ('telegram_chat_id', '<chat>')` —
   never commit the values.

## Environment variables

See `.env.example`. Required at boot: `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `WEBHOOK_SECRET`.

## What remains intentionally unimplemented (roadmap)

1. **Delivery** — DONE (no worker/cron): Telegram delivery is a **database
   trigger** (`supabase/migrations/0005–0007`, pg_net) that fires inside the
   outbox insert transaction and pushes to the Telegram Bot API immediately
   after commit — works on Vercel serverless. Credentials live in the
   server-only `app_config` table (`telegram_bot_token` / `telegram_chat_id`,
   inserted once via the Management API — never committed; GUCs were abandoned
   because Supabase denies them for non-superusers). 0007 fans out to EVERY
   user with live access + a verified linked chat (free_trial/paid/admin),
   falling back to the operator chat when nobody has linked yet. Live-verified:
   webhook → outbox insert → trigger → Telegram HTTP 200 in ~0.36s. The TS
   `sendTelegramSignal()` / `processPendingDeliveries()` remain as a manual
   fallback path.
2. **Auth & access control** — DONE: Supabase Auth (Google + email), JWT
   verification, RLS, weekend-aware trial (0008). Verify a fresh Google signup
   in production when convenient.
3. **Payments** — DONE (Paystack only): initialize + verified webhook + DB
   activation (test-mode keys live; webhook URL registered in the Paystack
   dashboard). Remaining: swap to live keys + register the live webhook URL.
4. **Website** — DONE and live: https://atlassignals-web.vercel.app. Google
   + email auth, RLS dashboard with Realtime (0009), Paystack upgrade,
   Telegram linking UI, Groq support assistant (`/api/chat`).
5. **Extensible signal metadata** — already additive via `metadata`
   passthrough + `raw_payload` JSONB.

## Roadmap (remaining)

- Paystack `abandoned` transition (mark stale `pending` rows after timeout).
- Admin panel on the website (list users, grant admin, see payments).
- Market-hours signal gating in the engine (currently signals can be pushed
  any day; the trial logic already accounts for weekends).
- Multi-symbol expansion (engine side) + delivery channel preference UI.

## Rules for the next agent

- **Never change the canonical schema shape** without updating
  `hf-space/signal_relay.py` + this contract — the Space and Relay must agree.
- **Never send notifications inline** in the webhook — always the outbox.
- **Never compute subscription expiry in TS** — call
  `user_can_access_signals_for` (RPC) or the RLS rule; the DB is the single
  source of truth.
- **Never edit an applied migration** — add a new file under
  `supabase/migrations/` and run `supabase db push`.
- **Never commit `.env`** or real secrets.
- Run `npm run typecheck && npm test` before considering work done.

## Verification checklist (after any change)

```bash
npm run typecheck
npm test
supabase migration list   # all migrations applied
npm run build && npm start
# curl -s localhost:3000/health
# python docs/huggingface-example.py   # with .env loaded, sends a real signed event

# live checks (all verified 2026-08-08):
# curl -s https://atlassignals-relay.vercel.app/health
# signed POST → 200, duplicate → 409, bad signature → 401
# JWT read path: /signals, /signals/latest (200), RLS blocks anon ([])
# Paystack: /payments/initialize → checkout URL; signed charge.success → paid
```

