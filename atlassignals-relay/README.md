# ⚡ AtlasSignals Relay

**The source of truth for all AtlasSignals trading signals.**

The Hugging Face Space (`aka465355/AtlasSignals`) is the **analysis engine
only** — it hydrates data, builds multi-timeframe context, scores setups, and
generates signals. Every approved signal is relayed here through a **signed
webhook** (`POST /webhooks/signal`). This backend validates, stores, and
(pending the delivery worker) notifies — it is the single source of truth.

---

## Architecture at a glance

```
Hugging Face Space (analysis engine)          AtlasSignals Relay (this repo)
┌──────────────────────────────┐              ┌────────────────────────────────┐
│ data hydration               │              │ POST /webhooks/signal          │
│ MTF context / scoring        │  ────────▶   │   HMAC-SHA256 signature check  │
│ signal generation            │   signed     │   Zod validation               │
│ signal_relay.py              │   webhook    │   idempotency (duplicate 409)  │
└──────────────────────────────┘              │   store in Supabase (signals)  │
                                              │   delivery_outbox job (async)  │
                                              │   SSE broadcast (GET /stream)  │
                                              │   GET /signals (API)           │
                                              │   GET /health                  │
                                              └────────────────────────────────┘
```

- **Space** = produces signals. **Relay** = persists + delivers them.
- Signals and users are separate concerns — the multi-user subscription layer
  (`users`, `subscriptions`, `delivery_channels`, `payments`) is scaffolded and
  ready, but the signal core does not depend on it.

## Tech stack

Node.js 20+ · TypeScript · Fastify · @supabase/supabase-js · Zod · dotenv ·
pino · Vitest — deployable on **Vercel** (preferred), Railway, Render, Fly.io,
Docker, or any standard Node host.

## Quick start

```bash
npm install
cp .env.example .env        # fill in real values (never commit .env)
npm run dev                 # tsx watch, http://localhost:3000
```

Production:

```bash
npm run build               # tsc → dist/
npm start                   # node dist/src/server.js
```

Run the tests:

```bash
npm test
npm run typecheck
```

## API

| Method | Path                  | Description                                      |
|--------|-----------------------|--------------------------------------------------|
| POST   | `/webhooks/signal`    | Ingest a signed canonical signal event           |
| GET    | `/signals/latest`     | Latest stored signal                             |
| GET    | `/signals`            | Paginated list (`?limit=50&offset=0`, max 200)   |
| GET    | `/signals/:signal_id` | Signal by canonical `signal_id` (UUID)           |
| GET    | `/stream`             | Server-Sent Events feed of new signals           |
| GET    | `/health`             | Status, uptime, DB connectivity, version         |

See [`docs/webhook-contract.md`](docs/webhook-contract.md) for the exact
webhook contract, and [`docs/architecture.md`](docs/architecture.md) for the
full design.

## Environment variables

| Variable                    | Required | Purpose                                          |
|-----------------------------|----------|--------------------------------------------------|
| `PORT`                      | no       | Port (default `3000`)                            |
| `NODE_ENV`                  | no       | `development` / `test` / `production`            |
| `SUPABASE_URL`              | yes*     | Supabase project URL                             |
| `SUPABASE_SERVICE_ROLE_KEY` | yes*     | Service-role key (server-side persistence)       |
| `SUPABASE_ANON_KEY`         | no       | Reserved for future client-side access / RLS     |
| `WEBHOOK_SECRET`            | yes*     | HMAC secret — MUST match the HF Space's value    |
| `TELEGRAM_BOT_TOKEN`        | no       | Telegram delivery (worker not implemented yet)   |
| `TELEGRAM_CHAT_ID`          | no       | Telegram delivery (worker not implemented yet)   |
| `SSE_ENABLED`               | no       | `true` (default) on long-running hosts; `false` on Vercel |

\* Enforced at startup by `src/server.ts` — the server refuses to boot without
them.

## Database

Schema lives in [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql):
`users`, `subscriptions`, `delivery_channels`, `payments` (placeholder),
`signals` (canonical), `delivery_outbox`. Apply it in the Supabase SQL editor
(or `supabase db push`).

## Testing

Vitest covers: canonical schema validation, HMAC signature verification,
idempotency-key derivation, and the full webhook endpoint (fake DB) — happy
path, invalid signature, invalid payload, duplicates, and the unique-violation
race.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — system design & data flow
- [`docs/webhook-contract.md`](docs/webhook-contract.md) — exact webhook contract
- [`docs/deployment.md`](docs/deployment.md) — Vercel + other hosts
- [`docs/handoff.md`](docs/handoff.md) — continue-from-here guide for the next agent
- [`docs/huggingface-example.py`](docs/huggingface-example.py) — Python sender example
