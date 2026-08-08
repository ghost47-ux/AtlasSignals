# AtlasSignals Relay — Database

This document describes the Supabase Postgres schema, its relationships, the
Row Level Security model, and exactly what the database enforces versus the
backend. Read this before touching any table, policy, or access logic.

---

## 1. Migrations

Migrations live in [`supabase/migrations/`](../supabase/migrations/) and are
applied in filename order:

| File | Contents |
|------|----------|
| `0001_init.sql` | Baseline tables + RLS enablement (no policies yet) |
| `0002_payments_subscriptions.sql` | Paystack payment columns, subscription windows, auth linkage, constraints, indexes, `updated_at` triggers |
| `0003_access_functions.sql` | Query-time access functions + Paystack processors + strict grants |
| `0004_rls_policies.sql` | Full RLS policy set + auth provisioning trigger (`handle_new_user`) |
| `0005_telegram_delivery.sql` | pg_net-based Telegram push trigger on `delivery_outbox` (no worker/cron) |
| `0006_telegram_config.sql` | Server-only `app_config` table for Telegram credentials (Supabase denies custom GUCs for non-superusers); trigger reads config there |

Apply with the Supabase CLI (project is already linked):

```bash
supabase db push          # applies any pending local migrations
```

or paste each file into the Supabase Dashboard → SQL Editor in order.

> **Rule:** every migration is idempotent (`IF NOT EXISTS`, guarded `DO`
> blocks). A migration must never fail because it ran before.

## 2. Tables

### `users`
One row per person. The application-facing profile.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `email` | `text` UNIQUE NOT NULL | synced from Supabase Auth at signup |
| `role` | `text` NOT NULL | `free_trial` \| `paid` \| `admin` (CHECK) — no other tiers |
| `auth_id` | `uuid` UNIQUE | `auth.users.id` — links to Supabase Auth; NULL for server-created users |
| `created_at` / `updated_at` | `timestamptz` | `updated_at` auto-stamped |

**Created by:** the `handle_new_user` trigger (on Supabase Auth signup) or the
backend (service role, for internal/admin users).

### `subscriptions`
The access window. One **live** row per user (`trial` or `active`), plus
optional history rows (`canceled` / `expired`).

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → `users` | ON DELETE CASCADE |
| `status` | `text` NOT NULL | `trial` \| `active` \| `canceled` \| `expired` (CHECK) |
| `trial_ends_at` | `timestamptz` | 24h window: set at signup (`now() + 24 hours`) |
| `started_at` | `timestamptz` | |
| `ends_at` | `timestamptz` | paid window end = `paid_at + 1 month` |
| `created_at` / `updated_at` | `timestamptz` | |

**Invariant:** `uq_subscriptions_live_per_user` — a partial UNIQUE index on
`(user_id) WHERE status IN ('trial','active')` guarantees at most one live
subscription per user. Renewals UPDATE that row; old rows become history.

### `payments`
Paystack-backed payment records. **Write access is service-role only.**

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → `users` | ON DELETE CASCADE |
| `paystack_reference` | `text` UNIQUE NOT NULL | **the idempotency key** for the whole lifecycle |
| `paystack_transaction_id` | `text` | Paystack `data.id` |
| `amount` | `numeric(20,2)` | **major units** (₦5000, not 500000 kobo) |
| `currency` | `text` NOT NULL | `[A-Z]{3}`, default `NGN` |
| `status` | `text` NOT NULL | `pending` \| `success` \| `failed` \| `abandoned` (CHECK) |
| `payment_channel` | `text` | `card` / `bank` / `ussd` / … |
| `paid_at` | `timestamptz` | Paystack confirmation time |
| `raw_response` | `jsonb` | **full webhook payload** — audit/debugging |
| `created_at` / `updated_at` | `timestamptz` | |

### `signals`
The canonical source of truth — one row per signal event from the HF Space.

Columns: `id` PK, `signal_id` UNIQUE NOT NULL, `symbol`, `direction`
(`BUY`/`SELL`), `timeframe`, `entry`, `stop_loss`, `take_profit`,
`confidence` (0–100), `setup_name`, `market_state`, `analysis_version`,
`created_at`, `idempotency_key` UNIQUE NOT NULL (≥8 chars), `raw_payload`
jsonb, `inserted_at`.

**Duplicates are impossible:** UNIQUE on `signal_id` and on `idempotency_key`
(the content-derived key from the Space), plus a CHECK on key length.

### `delivery_channels`
Per-user notification destinations (self-managed via RLS).

`id`, `user_id` FK, `channel_type` (`telegram`/`discord`/`email`),
`channel_identifier`, `is_verified`, `created_at`.
UNIQUE on `(user_id, channel_type, channel_identifier)`.

### `delivery_outbox`
Async notification jobs (outbox pattern). Written by the webhook, read by the
future delivery worker. **No client policies — service role only.**

`id`, `signal_id` FK → `signals(signal_id)`, `channel`, `status`
(`pending`/`sent`/`failed`), `attempts` (≥0), `created_at`, `sent_at`.

## 3. Relationships

```
auth.users ──1:1──▶ users ──1:N──▶ subscriptions
                        │
                        ├──1:N──▶ payments
                        │
                        └──1:N──▶ delivery_channels

signals ──1:N──▶ delivery_outbox (via signal_id)
```

All user-owned tables cascade-delete with `users`.

## 4. Access functions (query-time, no cron)

Everything is evaluated **at query time with `now()` comparisons**. There is
no background job, no scheduled expiry — the instant the clock passes a
window, access stops.

| Function | Purpose |
|----------|---------|
| `current_user_id()` | `public.users.id` for the caller's JWT (`auth.uid() = auth_id`) |
| `is_admin()` | true when the caller's user row has `role = 'admin'` |
| `user_can_access_signals_for(uuid)` | **core rule** for a given user id |
| `user_can_access_signals()` | wrapper for the RLS policy (uses the caller JWT) |
| `handle_paystack_charge_success(...)` | atomic, idempotent activation (service_role only) |
| `handle_paystack_charge_failed(...)` | idempotent failure recording (service_role only) |

The core rule `user_can_access_signals_for`:

| Role | Access |
|------|--------|
| `admin` | always true |
| `free_trial` | true while `now() < trial_ends_at` (24h from signup) |
| `paid` | true while `now() < subscriptions.ends_at` (1 month from Paystack confirmation) |
| anything else / expired | false |

All four access helpers are `SECURITY DEFINER`, `search_path`-pinned, and
granted `EXECUTE` to `authenticated` (RLS policies call them) and
`service_role` (the backend calls `user_can_access_signals_for` after JWT
verification).

## 5. RLS rules per role

RLS is enabled on all six tables. `anon` has **no policies anywhere** —
public access is fully blocked. `service_role` bypasses RLS entirely (backend).

| Table | `authenticated` user | admin (`authenticated` + admin role) |
|-------|----------------------|--------------------------------------|
| `users` | SELECT own row only | SELECT/UPDATE/DELETE all |
| `subscriptions` | SELECT own only | SELECT/UPDATE all |
| `payments` | SELECT own only | SELECT own+all (no writes) |
| `signals` | SELECT **only while live trial/paid window** | SELECT all |
| `delivery_channels` | SELECT/INSERT/UPDATE/DELETE own | everything |
| `delivery_outbox` | — (no policies) | — (no policies) |

Clients can **never** INSERT/UPDATE/DELETE `payments`, `subscriptions`, or
`signals`, and can never self-promote their role (users UPDATE is admin-only).

## 6. Enforced in the DB vs the backend

| Concern | Enforced by |
|---------|-------------|
| Signal deduplication (`signal_id`, `idempotency_key`) | **DB** (UNIQUE + CHECK) + backend fast-path |
| Role values | **DB** (CHECK) |
| One live subscription per user | **DB** (partial UNIQUE index) |
| Trial/paid expiry | **DB** — `user_can_access_signals_for()` at query time + RLS |
| Payment status transitions | **DB** — `handle_paystack_charge_*` (service-role-only functions) |
| Webhook idempotency (`paystack_reference`) | **DB** (UNIQUE + advisory lock) |
| Client visibility of premium data | **DB** — RLS policies |
| JWT verification, signature verification | **backend** (Supabase Auth, HMAC) |
| Paystack API calls (initialize) | **backend** |
| Signal ingestion, outbox writes | **backend** (service role) |

The backend **never re-implements** the subscription window math — it calls
`user_can_access_signals_for` (RPC) so app and database cannot disagree.

## 7. Client access patterns (frontend)

Safe client reads go through **Supabase directly with the anon key** — RLS is
the gate. Recommended queries:

```ts
// Signals — the client sees rows only while its trial/paid window is live
supabase.from('signals').select('*').order('created_at', { ascending: false });

// Own subscription status (drives "upgrade" / "renew" UI)
supabase.from('subscriptions').select('status, trial_ends_at, ends_at').single();

// Own payment history
supabase.from('payments').select('*').order('created_at', { ascending: false });
```

The relay's own read API (`GET /signals*`, `GET /stream`) requires a Supabase
JWT and applies the identical rule via RPC — it is meant for the dashboard
when it does not want to talk to PostgREST directly.

## 8. Extending the schema safely

- Add a column → `alter table ... add column if not exists ...` in a NEW
  migration file (never edit an applied one).
- Change an access rule → edit `user_can_access_signals_for` in a new
  migration; the backend and RLS pick it up automatically (no TS changes
  needed for the core rule).
- Add a policy → follow the naming pattern `<table>_<action>_<scope>` and
  always `drop policy if exists` before `create policy`.
- Run `supabase db push` and verify with `supabase migration list`.
