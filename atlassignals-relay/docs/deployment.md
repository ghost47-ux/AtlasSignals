# Deployment

## Prerequisites

- Node.js 20+ locally.
- A Supabase project with the schema applied
  (`supabase/migrations/0001_init.sql` → Supabase SQL editor).
- The four required env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `WEBHOOK_SECRET`, plus optional `SUPABASE_ANON_KEY`).

## Vercel (preferred)

The project is pre-configured with `vercel.json`:

- Builds `api/index.ts` with `@vercel/node` and **`bodyParser: false`** so the
  request stream is preserved for HMAC verification.
- `api/index.ts` bridges the Fastify app onto Vercel's request/response
  (app instance cached across warm invocations).
- The standalone `npm run build` / `npm start` path is unaffected (used by
  other hosts).

Steps:

1. Push the repo to GitHub.
2. In Vercel: **New Project → Import** the repo. Framework preset: **Other**.
3. Add the environment variables (see below) in Project → Settings →
   Environment Variables.
4. Deploy. The webhook URL becomes
   `https://<your-project>.vercel.app/webhooks/signal`.

Vercel notes:

- Set `SSE_ENABLED=false` (serverless functions cannot stream SSE).
- Function `maxDuration` is set to 30s; the webhook itself responds in ms.
- Cold starts add latency to the first request after idle — expected on the
  Hobby plan; keep-alive + the cached app instance mitigate it.

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
| `SUPABASE_ANON_KEY`         | no       | reserved for future RLS/client access       |
| `WEBHOOK_SECRET`            | yes      | MUST match the HF Space's secret            |
| `NODE_ENV`                  | no       | `production` in prod                        |
| `PORT`                      | no       | default 3000                                |
| `SSE_ENABLED`               | no       | `false` on Vercel, `true` elsewhere         |
| `TELEGRAM_BOT_TOKEN`        | no       | for the future delivery worker              |
| `TELEGRAM_CHAT_ID`          | no       | for the future delivery worker              |

> **Critical:** set the same `WEBHOOK_SECRET` on the backend and in the HF
> Space secrets, then set the Space's `ATLAS_WEBHOOK_URL` to
> `https://<your-project>.vercel.app/webhooks/signal`.

## Health check

`GET /health` returns `200` when the DB is reachable, `503` otherwise — wire
it into your platform's health check.
