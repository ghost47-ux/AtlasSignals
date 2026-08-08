# AtlasSignals Relay — Architecture

## 1. Purpose

AtlasSignals is a low-latency XAU/USD trading signal system split into two
parts:

1. **Hugging Face Space** (`aka465355/AtlasSignals`) — the *analysis engine*.
   It hydrates market data (Bybit → Twelve Data fallback), builds 15M/1H/4H/5M
   multi-timeframe context, scores setups with the Dynamic Opportunity Scoring
   Engine (ITER_32), and generates one signal per trading session.
2. **AtlasSignals Relay** (this repo) — the *source of truth*. It receives
   every approved signal through a signed webhook, validates it, stores it in
   Supabase Postgres, and schedules notification delivery through an outbox.

> Rule: the Space produces signals; the Relay persists and delivers them.
> The Space must "send every approved signal to the backend through a secure
> webhook and then get out of the way."

## 2. Data flow

```
[Bybit/TwelveData] ─▶ HF Space engine ─▶ signal dict
                                            │  signal_relay.py (HF Space)
                                            ▼
                    canonical JSON event + HMAC-SHA256 signature
                                            │
                                            ▼
        POST /webhooks/signal  ──▶ verify signature ──▶ Zod validate
                                            │
                                            ▼
                              idempotency check (idempotency_key)
                                            │
                          ┌─────────────────┴──────────────────┐
                          │ duplicate → 409                     │
                          │ new → insert into signals (Postgres)│
                          └─────────────────┬──────────────────┘
                                            │
                          insert delivery_outbox job (telegram)
                          broadcast signal via SSE (GET /stream)
                          respond 200 { received, signal_id }
```

The webhook path is kept minimal for latency (target < 100ms). Nothing blocks
on external services: Supabase inserts are the only I/O, and the delivery
outbox write is non-blocking (a failure there is logged, never fatal).

## 3. Repository layout

```
src/
  server.ts               standalone entrypoint (Railway/Render/Fly/Docker)
  app.ts                  Fastify app factory (DI-friendly, testable)
  config/env.ts           Zod-validated environment config
  routes/
    webhook.ts            POST /webhooks/signal
    signals.ts            GET /signals*, GET /stream (SSE)
    health.ts             GET /health
  services/
    signalService.ts      persistence + queries (source of truth)
    deliveryService.ts    outbox + placeholder channel senders
    paystackService.ts    Paystack signature verify + webhook dispatch + initialize
    websocketService.ts   SSE broadcaster
  db/supabase.ts          service-role Supabase client
  schemas/signal.ts       THE canonical Zod schema
  schemas/paystack.ts     Paystack webhook event schema
  middleware/verifySignature.ts  HMAC-SHA256 verification
  middleware/requireAuth.ts      JWT auth + signal-access enforcement (RPC)
  routes/
    webhook.ts            POST /webhooks/signal
    paystackWebhook.ts    POST /webhooks/paystack
    payments.ts           POST /payments/initialize
  utils/logger.ts         pino
  utils/idempotency.ts    deterministic idempotency keys
api/index.ts              Vercel serverless bridge
supabase/migrations/      SQL schema (0001–0004) + RLS + functions
tests/                    Vitest suite
docs/                     this documentation
```

## 4. Canonical signal schema

`src/schemas/signal.ts` defines the one schema used everywhere
(`signalEventSchema`, Zod, `.passthrough()`):

| Field            | Type   | Notes                                   |
|------------------|--------|-----------------------------------------|
| `signal_id`      | UUID   | unique canonical id                     |
| `symbol`         | string | e.g. `XAU/USD`                          |
| `direction`      | enum   | `BUY` \| `SELL`                         |
| `timeframe`      | string | e.g. `15M`                              |
| `entry`          | number |                                         |
| `stop_loss`      | number |                                         |
| `take_profit`    | number |                                         |
| `confidence`     | 0–100  |                                         |
| `setup_name`     | string | engine scenario / tier                  |
| `market_state`   | string | `main_regime/sub_classifier`            |
| `analysis_version`| string | e.g. `ITER_32`                         |
| `created_at`     | ISO-8601 | UTC with offset                       |
| `idempotency_key`| string | content-derived duplicate guard         |

Additional engine context flows through `metadata` (passthrough) and is stored
verbatim in `signals.raw_payload` (JSONB).

## 5. Database schema

See `supabase/migrations/0001_init.sql` → `0004_rls_policies.sql` and
[`docs/database.md`](database.md). Highlights:

- `signals` — canonical records; `signal_id` UNIQUE, `idempotency_key` UNIQUE.
- `delivery_outbox` — pending notification jobs (`pending` → `sent`/`failed`).
- `users` / `subscriptions` / `delivery_channels` / `payments` — the multi-user
  layer, fully built: Paystack-backed `payments`, one live `subscription` per
  user (partial UNIQUE index), `auth_id` linkage to Supabase Auth, and roles
  `free_trial` | `paid` | `admin`.
- RLS is **fully enforced** with explicit policies; the backend uses the
  service-role key (bypasses RLS) and the client/anon path is gated by RLS.

### 5a. Access control (query-time, no cron)

All enforcement is evaluated at query time with `now()` comparisons — there
are no background jobs (free-tier safe). `user_can_access_signals_for(uuid)`
is the single source of truth:

- `free_trial` → 24h window (`trial_ends_at`)
- `paid` → 1-month window from Paystack confirmation (`ends_at`)
- `admin` → always

The read API enforces it via RPC after JWT verification; RLS enforces the
same rule for direct anon-key client reads.

### 5b. Payments (Paystack)

`payments.paystack_reference` is the unique idempotency key. The DB function
`handle_paystack_charge_success` (service-role-only, advisory-locked) atomically
marks the payment success, upgrades the role, and sets/extends the window.
See [`docs/payments.md`](payments.md).

## 6. Delivery (outbox pattern + push trigger)

- The webhook only **schedules** delivery (`delivery_outbox` row, channel
  `telegram`) and responds — it never sends anything inline.
- **Production delivery is a database trigger** (`0005_telegram_delivery.sql`):
  pg_net (`net.http_post`) is enqueued inside the outbox insert transaction
  and the Telegram Bot API call fires from a background worker immediately
  after commit. No worker, no cron, no polling — works on Vercel serverless
  (Vercel cron is unusable: Hobby = 1/day) and keeps the webhook <100ms.
- Secrets are read from custom GUCs (`app.telegram_bot_token` /
  `app.telegram_chat_id`, set once in the Supabase SQL editor) — never
  committed.
- `deliveryService.processPendingDeliveries()` + `sendTelegramSignal` remain
  as a manual/fallback path (and the base for future per-user delivery via
  `delivery_channels`); `sendDiscordSignal` / `sendEmailSignal` are
  placeholders.
- Delivery is best-effort: a send/enqueue failure never fails signal
  ingestion (the row stays `pending` = audit trail).

## 7. Real-time dashboard (SSE)

- `GET /stream` streams every newly inserted signal as Server-Sent Events.
- Works on long-running hosts. Disabled on Vercel serverless (`SSE_ENABLED=false`).
- A React dashboard subscribes here — no polling.

## 8. Security

- HMAC-SHA256 over the exact raw body; header `x-atlas-signature` (signal webhook).
- HMAC-SHA512 over the exact raw body; header `x-paystack-signature` (Paystack).
- Constant-time comparison (`timingSafeEqual`) in both verifiers.
- `WEBHOOK_SECRET` is shared between the Space and the Relay; never committed
  (`.env` is git-ignored).
- Payload size capped at 1 MB.
- Service-role key lives only on the server side.
- Payment status is never trusted from the client — only the verified
  Paystack webhook can activate a subscription, and only the DB functions can
  write payments (revoked from `anon`/`authenticated`).
- RLS blocks `anon` on every table; premium signal content is visible to
  `authenticated` users only inside their live trial/paid window.
