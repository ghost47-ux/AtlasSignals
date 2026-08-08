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
                                              │   outbox → pg_net trigger → Telegram │
                                              │   GET /signals (API)           │
                                              │   GET /health                  │
                                              └────────────────────────────────┘
```

The **website** (`atlassignals-web`, React PWA) is the user surface: signup/
login (Google + email via Supabase Auth), live dashboard (reads signals
through RLS), Paystack upgrade, Telegram linking, and a Groq-powered support
assistant — see the Website section below.

- **Space** = produces signals. **Relay** = persists + delivers them.
- **Website** = dashboard + payment surface. **Telegram bot** = notification
  extension of the website (never a second app).
- Signals and users are separate concerns — the multi-user subscription layer
  (`users`, `subscriptions`, `delivery_channels`, `payments`) is fully built
  (Paystack-backed, RLS-enforced), but the signal core does not depend on it.

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

| Method | Path                    | Description                                      |
|--------|-------------------------|--------------------------------------------------|
| POST   | `/webhooks/signal`      | Ingest a signed canonical signal event           |
| POST   | `/webhooks/paystack`    | Paystack payment webhook (HMAC-SHA512 verified)  |
| POST   | `/payments/initialize`  | Start a Paystack checkout (JWT required)         |
| GET    | `/signals/latest`       | Latest stored signal (JWT + active window)       |
| GET    | `/signals`              | Paginated list (JWT + active window)             |
| GET    | `/signals/:signal_id`   | Signal by canonical `signal_id` (JWT + window)   |
| GET    | `/stream`               | SSE feed of new signals (JWT + active window)    |
| POST   | `/telegram/link`        | Create a one-time Telegram link code (JWT)       |
| POST   | `/webhooks/telegram`    | Telegram bot webhook (X-Telegram-Bot-Api-Secret-Token) |
| GET    | `/health`               | Status, uptime, DB connectivity, version         |

See [`docs/webhook-contract.md`](docs/webhook-contract.md) for the exact
webhook contract, and [`docs/architecture.md`](docs/architecture.md) for the
full design.

## Website (`atlassignals-web`)

**Live: https://atlassignals-web.vercel.app** — React PWA (`Vite`, `react-router`,
`@supabase/supabase-js`, `vite-plugin-pwa`).

- **Auth**: Google OAuth + email/password via Supabase Auth (PKCE). New users
  get a 24h free trial — weekend signups start it when the market opens Monday
  (migration 0008).
- **Dashboard**: reads signals through RLS (anon key + session) with Realtime
  live updates (migration 0009) + polling fallback; shows trial/paid countdowns,
  Paystack upgrade, and the Telegram linking flow.
- **Telegram linking**: `POST /telegram/link` → deep link `t.me/Atlas_sign_albot?start=<code>`
  → the bot webhook redeems it and the chat becomes the user's verified channel.
  Signals fan out to every linked user with live access (free_trial/paid/admin)
  via the DB trigger. A random `/start` without a code only gets instructions.
- **Support assistant**: `POST /api/chat` (Vercel function) calls Groq
  (`llama-3.3-70b-versatile`, key = `GROQ_API_KEY`) with tool calling — it
  answers from a product knowledge base and can navigate the user, open the
  Telegram linking flow, or start checkout. Tool failures fall back to a plain
  answer + keyword action extraction, so the chat never 500s.
- **Deploy**: `vercel link --yes && vercel deploy --prod --yes`. Env:
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_RELAY_BASE`,
  `VITE_SITE_URL`, `VITE_TELEGRAM_BOT_USERNAME`, `VITE_PLAN_AMOUNT_MAJOR`,
  `VITE_PLAN_CURRENCY`, `VITE_CONTACT_EMAIL`, `GROQ_API_KEY` (serverless only).

## Environment variables

| Variable                    | Required | Purpose                                          |
|-----------------------------|----------|--------------------------------------------------|
| `PORT`                      | no       | Port (default `3000`)                            |
| `NODE_ENV`                  | no       | `development` / `test` / `production`            |
| `SUPABASE_URL`              | yes*     | Supabase project URL                             |
| `SUPABASE_SERVICE_ROLE_KEY` | yes*     | Service-role key (server-side persistence)       |
| `SUPABASE_ANON_KEY`         | no       | Client-side reads — RLS enforces visibility      |
| `WEBHOOK_SECRET`            | yes*     | HMAC secret — MUST match the HF Space's value    |
| `PAYSTACK_SECRET_KEY`       | no*      | Paystack webhook + API (503 until set)           |
| `PAYSTACK_PUBLIC_KEY`       | no       | Frontend Paystack checkout (optional)            |
| `PAYSTACK_PLAN_AMOUNT`      | no*      | Monthly price in minor units (kobo)              |
| `PAYSTACK_CURRENCY`         | no       | Default `NGN`                                    |
| `TELEGRAM_BOT_TOKEN`        | no       | Telegram delivery (pg_net trigger + bot webhook replies) |
| `TELEGRAM_CHAT_ID`          | no       | Fallback chat for the delivery trigger                  |
| `TELEGRAM_WEBHOOK_SECRET`   | no*      | X-Telegram-Bot-Api-Secret-Token for the bot webhook     |
| `SSE_ENABLED`               | no       | `true` (default) on long-running hosts; `false` on Vercel |

\* `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `WEBHOOK_SECRET` are enforced
at startup by `src/server.ts` — the server refuses to boot without them.
Paystack variables are optional: the payment routes answer `503` until set.

## Payments & access control

- **Paystack lifecycle** (initialize → webhook → activation) is fully
  implemented. See [`docs/payments.md`](docs/payments.md).
- **Access control is enforced by the database** (RLS + query-time
  `user_can_access_signals_for`): `free_trial` = 24h window, `paid` = 1-month
  window from Paystack confirmation, `admin` = always. No cron, no background
  jobs — expiry is evaluated with `now()` at query time.
- The read API requires a Supabase JWT; the frontend can also read directly
  with the anon key and RLS applies the same rules. See
  [`docs/database.md`](docs/database.md).

## Database

Schema lives in [`supabase/migrations/`](supabase/migrations/) (0001–0009):
`users`, `subscriptions`, `delivery_channels`, `payments` (Paystack-backed),
`signals` (canonical), `delivery_outbox` — with full constraints, indexes,
lightweight triggers, helper functions and RLS policies. Delivery is push-based:
0005 adds a pg_net trigger that sends Telegram immediately after each outbox
insert (no worker/cron — Vercel-safe). Apply with `supabase db push` (project
pre-linked) or the Supabase SQL editor. See [`docs/database.md`](docs/database.md).

## Testing

Vitest covers: canonical schema validation, HMAC signature verification
(signal + Paystack), idempotency-key derivation, the signal webhook endpoint
(fake DB), the Paystack webhook (signature, dispatch, idempotency), the
payments initialize route, and JWT-gated signal access — happy paths, invalid
signatures/payloads, duplicates, and the unique-violation race.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — system design & data flow
- [`docs/webhook-contract.md`](docs/webhook-contract.md) — exact webhook contract
- [`docs/deployment.md`](docs/deployment.md) — Vercel + other hosts
- [`docs/handoff.md`](docs/handoff.md) — continue-from-here guide for the next agent
- [`docs/huggingface-example.py`](docs/huggingface-example.py) — Python sender example
