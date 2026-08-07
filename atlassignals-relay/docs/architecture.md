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
    websocketService.ts   SSE broadcaster
  db/supabase.ts          service-role Supabase client
  schemas/signal.ts       THE canonical Zod schema
  middleware/verifySignature.ts  HMAC-SHA256 verification
  utils/logger.ts         pino
  utils/idempotency.ts    deterministic idempotency keys
api/index.ts              Vercel serverless bridge
supabase/migrations/      SQL schema
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

See `supabase/migrations/0001_init.sql`. Highlights:

- `signals` — canonical records; `signal_id` UNIQUE, `idempotency_key` UNIQUE.
- `delivery_outbox` — pending notification jobs (`pending` → `sent`/`failed`).
- `users` / `subscriptions` / `delivery_channels` / `payments` — the future
  multi-user foundation (roles: `free_trial` | `paid` | `admin`). Present but
  not wired into the signal pipeline — that is intentional.
- RLS is enabled with no policies; the backend uses the service-role key
  (bypasses RLS). Policies arrive with the auth phase.

## 6. Delivery (outbox pattern)

- The webhook only **schedules** delivery (`delivery_outbox` row, channel
  `telegram`).
- `deliveryService.processPendingDeliveries()` runs the queue; channel senders
  (`sendTelegramSignal`, `sendDiscordSignal`, `sendEmailSignal`) are
  placeholders to be implemented in the delivery phase.
- Never send notifications inside the webhook request.

## 7. Real-time dashboard (SSE)

- `GET /stream` streams every newly inserted signal as Server-Sent Events.
- Works on long-running hosts. Disabled on Vercel serverless (`SSE_ENABLED=false`).
- A React dashboard subscribes here — no polling.

## 8. Security

- HMAC-SHA256 over the exact raw body; header `x-atlas-signature`.
- Constant-time comparison (`timingSafeEqual`).
- `WEBHOOK_SECRET` is shared between the Space and the Relay; never committed
  (`.env` is git-ignored).
- Payload size capped at 1 MB.
- Service-role key lives only on the server side.
