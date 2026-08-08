# Deployment

## Prerequisites

- Node.js 20+ locally.
- The Supabase CLI (for migrations): `npm install -g supabase`, then
  `supabase login` and `supabase link --project-ref <ref>` once.
- A Supabase project with the schema applied — see *Applying migrations*
  below (or paste `supabase/migrations/*.sql` in the Dashboard SQL editor).
- The required env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `WEBHOOK_SECRET`, plus optional `SUPABASE_ANON_KEY` and Paystack keys).

## Applying migrations

```bash
supabase login                     # one-time
supabase link --project-ref <project-ref>
supabase db push                   # applies 0001 → 0009 in order
supabase migration list            # verify Local == Remote
```

Alternatively, paste each file in `supabase/migrations/` into the Supabase
Dashboard → SQL Editor in filename order.

## Vercel (preferred)

The project is pre-configured with `vercel.json`:

- Builds `api/index.ts` with `@vercel/node` and **`bodyParser: false`** so the
  request stream is preserved for HMAC verification.
- `api/index.ts` bridges the Fastify app onto Vercel's request/response
  (app instance cached across warm invocations).
- The standalone `npm run build` / `npm start` path is unaffected (used by
  other hosts).

**Live deployment (Aug 2026):** `https://atlassignals-relay.vercel.app`
(deployed from the CLI: `vercel link --yes` then `vercel deploy --prod --yes`;
project `ghost47-uxs-projects/atlassignals-relay`).

Steps:

1. Push the repo to GitHub (or deploy straight from the CLI — used here).
2. In Vercel: **New Project → Import** the repo (Root Directory =
   `atlassignals-relay`), or `vercel link --yes` + `vercel deploy --prod`.
3. Add the environment variables (see below) in Project → Settings →
   Environment Variables — or `echo "$VAL" | vercel env add NAME production`.
   **Every secret that is set locally must also be set here** (the deployed
   backend reads only Vercel env vars, never the local `.env`).
4. Deploy. The webhook URL is
   `https://atlassignals-relay.vercel.app/webhooks/signal`.

Vercel notes:

- `vercel.json` uses the legacy `builds` block with `bodyParser: false` —
  **required** so Fastify reads the raw request bytes for HMAC verification.
  Do NOT add a `functions` block: Vercel rejects `builds` + `functions`
  together ("The `functions` property cannot be used in conjunction with the
  `builds` property"). `maxDuration` therefore uses the platform default,
  which is fine — the webhook responds in ms.
- Set `SSE_ENABLED=false` (serverless functions cannot stream SSE).
- Cold starts add latency to the first request after idle — expected on the
  Hobby plan; the cached app instance (api/index.ts) mitigates it.

## Railway / Render / Fly.io / Docker (long-running hosts)

The standalone server is the entrypoint:

```bash
npm ci
npm run build
npm start          # node dist/src/server.js, listens on 0.0.0.0:PORT
```

Set `SSE_ENABLED=true` here so `GET /stream` streams in real time.

## Environment variables (all platforms)

| Variable                    | Required | Notes                                       |
|-----------------------------|----------|---------------------------------------------|
| `SUPABASE_URL`              | yes      |                                             |
| `SUPABASE_SERVICE_ROLE_KEY` | yes      | service-role key — never client-side        |
| `SUPABASE_ANON_KEY`         | no       | client-side reads — RLS enforces visibility |
| `WEBHOOK_SECRET`            | yes      | MUST match the HF Space's secret            |
| `PAYSTACK_SECRET_KEY`       | no*      | Paystack webhook + API (503 until set)      |
| `PAYSTACK_PUBLIC_KEY`       | no       | frontend Paystack checkout (optional)       |
| `PAYSTACK_PLAN_AMOUNT`      | no*      | monthly price, minor units (kobo)           |
| `PAYSTACK_CURRENCY`         | no       | default `NGN`                               |
| `PAYSTACK_PLAN_NAME`        | no       | default `AtlasSignals Monthly`              |
| `NODE_ENV`                  | no       | `production` in prod                        |
| `PORT`                      | no       | default 3000                                |
| `SSE_ENABLED`               | no       | `false` on Vercel, `true` elsewhere         |
| `TELEGRAM_BOT_TOKEN`        | no       | bot webhook replies + delivery trigger      |
| `TELEGRAM_CHAT_ID`          | no       | operator/fallback chat for the trigger      |
| `TELEGRAM_WEBHOOK_SECRET`   | no*      | X-Telegram-Bot-Api-Secret-Token (setWebhook) |

> **Critical:** the HF Space (`aka465355/AtlasSignals`) already has matching
> secrets set via the HF API: `ATLAS_WEBHOOK_URL =
> https://atlassignals-relay.vercel.app/webhooks/signal` and `WEBHOOK_SECRET`
> (= the backend's value). If you re-deploy to a new URL, update both.
>
> **Paystack:** `PAYSTACK_SECRET_KEY` + `PAYSTACK_PLAN_AMOUNT` are set on the
> deployment (test mode). Register the webhook URL
> `https://atlassignals-relay.vercel.app/webhooks/paystack` in the Paystack
> dashboard (Settings → API Keys & Webhooks) — **dashboard-only, no public
> API**. Test and live mode have separate URL fields. Paystack signs every
> webhook with your secret key — the relay verifies it before touching any
> payment. To go live later: swap the two Paystack keys (test → live) in
> Vercel env + `.env`, and re-register the webhook URL in live mode.

## Website deployment (`atlassignals-web/`)

**Live: https://atlassignals-web.vercel.app** (project
`ghost47-uxs-projects/atlassignals-web`). React PWA (Vite).

```bash
cd atlassignals-web
npm install
cp .env.example .env.local    # fill in the VITE_* values (see below)
vercel link --yes
vercel deploy --prod --yes
```

Env vars (set in Vercel for `production` **and** `preview`):

| Variable                    | Purpose                                        |
|-----------------------------|------------------------------------------------|
| `VITE_SUPABASE_URL`         | same value as the relay's `SUPABASE_URL`       |
| `VITE_SUPABASE_ANON_KEY`    | same value as the relay's `SUPABASE_ANON_KEY`  |
| `VITE_RELAY_BASE`           | `https://atlassignals-relay.vercel.app`        |
| `VITE_SITE_URL`             | `https://atlassignals-web.vercel.app`          |
| `VITE_TELEGRAM_BOT_USERNAME`| `Atlas_sign_albot`                             |
| `VITE_PLAN_AMOUNT_MAJOR`    | `10000` (₦10,000 — mirrors `PAYSTACK_PLAN_AMOUNT`) |
| `VITE_PLAN_CURRENCY`        | `NGN`                                          |
| `VITE_CONTACT_EMAIL`        | `support@atlassignals.com`                     |
| `GROQ_API_KEY`              | support assistant (serverless function only)   |

Supabase Auth is configured for the website (Google + email): `site_url` =
`https://atlassignals-web.vercel.app` and `uri_allow_list` includes the site
(plus `http://localhost:5173` for local dev) — set via the Management API
(`PATCH /v1/projects/<ref>/config/auth`). The relay answers CORS only for the
website + localhost origins.

## Health check

`GET /health` returns `200` when the DB is reachable, `503` otherwise — wire
it into your platform's health check.
