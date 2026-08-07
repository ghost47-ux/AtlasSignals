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
- [x] Multi-user foundation tables (users, subscriptions, delivery_channels,
      payments) — scaffolded, not wired in.
- [x] Vitest suite + typecheck + build.

## Repository map

```
src/server.ts                 standalone entrypoint
src/app.ts                    Fastify factory (inject db/secret for tests)
src/config/env.ts             all env config (Zod)
src/schemas/signal.ts         canonical schema — change here first
src/middleware/verifySignature.ts  HMAC verification + raw-body capture hook in app.ts
src/services/signalService.ts persistence/queries
src/services/deliveryService.ts    outbox + placeholders
src/services/websocketService.ts   SSE broadcaster
src/routes/webhook.ts         ingestion endpoint
src/routes/signals.ts         read API + /stream
src/routes/health.ts          health
api/index.ts                  Vercel bridge
supabase/migrations/0001_init.sql  schema
tests/                        Vitest (fake DB in tests/helpers/fakeDb.ts)
```

## Database schema

Tables: `users`, `subscriptions`, `delivery_channels`, `payments`,
`signals`, `delivery_outbox`. Key constraints: `signals.signal_id UNIQUE`,
`signals.idempotency_key UNIQUE`, `delivery_outbox.signal_id → signals.signal_id`.
RLS enabled, no policies yet (service-role key bypasses).

## API routes

| Method | Path | Notes |
|--------|------|-------|
| POST   | `/webhooks/signal` | signed; 401/409/422/500/503 |
| GET    | `/signals/latest`  | 404 if empty |
| GET    | `/signals`         | `?limit=` (≤200) `&offset=` |
| GET    | `/signals/:signal_id` | canonical UUID |
| GET    | `/stream`          | SSE, disabled on Vercel |
| GET    | `/health`          | DB-aware |

## Deployment process

1. Apply `supabase/migrations/0001_init.sql`.
2. Set env vars (see `deployment.md`).
3. Vercel: import repo, deploy (`api/index.ts`, `bodyParser:false`).
4. Other hosts: `npm ci && npm run build && npm start`.
5. Set the HF Space secrets `ATLAS_WEBHOOK_URL` + matching `WEBHOOK_SECRET`.

## Environment variables

See `.env.example`. Required at boot: `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `WEBHOOK_SECRET`.

## What remains intentionally unimplemented (roadmap)

1. **Delivery worker** — implement `sendTelegramSignal()` in
   `src/services/deliveryService.ts` (Telegram Bot API with
   `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`), then run
   `processPendingDeliveries()` on a schedule (cron / vercel cron / worker).
   Consider per-user delivery via `delivery_channels` later.
2. **Auth & access control** — Supabase Auth, JWT verification, RLS policies
   (roles: `free_trial`/`paid`/`admin`). Wire visibility checks into
   `src/routes/signals.ts` without touching ingestion.
3. **Payments** — `payments` table is a placeholder; add checkout (Stripe etc.)
   and subscription lifecycle (`subscriptions.status`).
4. **Website / dashboard** — subscribe to `GET /stream` (or poll
   `GET /signals/latest`) from a React frontend.
5. **Extensible signal metadata** — already additive via `metadata`
   passthrough + `raw_payload` JSONB.

## Rules for the next agent

- **Never change the canonical schema shape** without updating
  `hf-space/signal_relay.py` + this contract — the Space and Relay must agree.
- **Never send notifications inline** in the webhook — always the outbox.
- **Never commit `.env`** or real secrets.
- Run `npm run typecheck && npm test` before considering work done.

## Verification checklist (after any change)

```bash
npm run typecheck
npm test
npm run build && npm start   # then:
# curl -s localhost:3000/health
# python docs/huggingface-example.py   # with .env loaded, sends a real signed event
```
