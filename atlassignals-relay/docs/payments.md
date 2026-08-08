# AtlasSignals Relay — Payments (Paystack)

How payments, subscriptions, and webhooks work end-to-end. Read this before
touching anything in `src/services/paystackService.ts`,
`src/routes/paystackWebhook.ts`, `src/routes/payments.ts`, or the
`handle_paystack_charge_*` functions in the migrations.

---

## 1. The flow

```
┌──────────┐  ① POST /payments/initialize (JWT)   ┌──────────────────┐
│ Frontend │ ───────────────────────────────────▶ │ Relay (service   │
│          │ ◀────────────────  authorization_url │  role key)       │
└────┬─────┘                                       └────────┬─────────┘
     │                                                     │ ② Paystack API
     │  ③ redirect user to Paystack checkout              ▼
     └───────────────────────────────▶  ┌─────────────────────────┐
                                        │   Paystack              │
                                        └────────────┬────────────┘
                                                     │ ④ webhook charge.success
                                                     ▼ (HMAC-SHA512, verified)
                                        ┌─────────────────────────┐
                                        │ POST /webhooks/paystack │
                                        │ → handle_paystack_      │
                                        │   charge_success (RPC)  │
                                        └────────┬────────────────┘
                                                 │ ⑤ DB (atomic):
                                                 │   payment → success
                                                 │   role → paid
                                                 │   ends_at = paid_at + 1 month
                                                 ▼
                                        subscription active
```

1. **Initialize** — the authenticated frontend calls
   `POST /payments/initialize`. The relay asks Paystack to create a
   transaction (`amount` = `PAYSTACK_PLAN_AMOUNT` in minor units, a generated
   `atlas_<uuid>` reference, `user_id` embedded in `metadata`), stores a
   `pending` payment row, and returns `authorization_url` + `reference`.
2. **Checkout** — the user pays on Paystack's hosted page.
3. **Webhook** — Paystack posts `charge.success` to `POST /webhooks/paystack`.
   The relay verifies `x-paystack-signature` (HMAC-SHA512 of the **exact raw
   body**, key = `PAYSTACK_SECRET_KEY`), then delegates to the database.
4. **Activation** — `handle_paystack_charge_success` (a `SECURITY DEFINER`,
   service-role-only function) atomically: marks the payment `success` with
   `paid_at`, sets `users.role = 'paid'` (never downgrades an admin), and sets
   the subscription window `ends_at = paid_at + 1 month` (renewals extend from
   the current `ends_at`).

Only step ③ can activate a subscription, and it can only do so with a
signature the client cannot forge. **The client never reports payment status.**

## 2. Idempotency & webhook safety

- `payments.paystack_reference` is **UNIQUE** — a reference can exist once.
- `handle_paystack_charge_success` takes a **transaction-level advisory lock**
  keyed on the reference, so concurrent duplicate deliveries are serialized.
- A payment already in `success` is a **no-op** (`processed: false,
  reason: duplicate`). Duplicate webhooks still get HTTP 200 so Paystack never
  retries in a loop.
- `charge.failed` only **records** the failure (`raw_response` stored for
  audit) — it never touches roles or subscriptions. A later failure event can
  never downgrade an earlier success.
- Unrelated events (`transfer.*`, `invoice.*`, …) are acknowledged and
  ignored.
- The **full webhook payload** is stored verbatim in `payments.raw_response`
  (jsonb) for audit/debugging.

## 3. Subscription lifecycle

| Stage | What happens | Access |
|-------|--------------|--------|
| Signup | `handle_new_user` creates the profile + `trial` subscription, `trial_ends_at = now() + 24h` | free_trial: 24h window |
| Trial expiry | nothing runs — the RLS/access rule `now() < trial_ends_at` turns false at the exact moment | blocked (403 / no rows) |
| Payment success | `handle_paystack_charge_success`: payment `success`, role `paid`, subscription `active`, `ends_at = paid_at + 1 month` | paid: 1-month window |
| Renewal | new reference → `ends_at` extends **from the current end** by 1 month | continuous access |
| Paid expiry | again, nothing runs — `now() < ends_at` turns false | blocked until renewed |
| Admin | `role = 'admin'` bypasses all windows | always |

`subscriptions` keeps history: expired/canceled rows stay, and the partial
UNIQUE index (one `trial`/`active` row per user) allows a fresh paid row to
appear next to them.

## 4. Amount units

Paystack communicates in **minor units** (kobo for NGN). The database stores
**major units** (`numeric(20,2)`).

- `PAYSTACK_PLAN_AMOUNT` (env) → minor units (e.g. `500000` = ₦5,000)
- `initializePaystackTransaction` sends `amountMinor` to Paystack and stores
  `amount = major units` on the `pending` row
- the DB processors divide the webhook `amount` by 100 before storing

`fromKobo` / `toKobo` in `paystackService.ts` are the only conversion points.

## 5. Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `PAYSTACK_SECRET_KEY` | for payments | webhook signature + Paystack API |
| `PAYSTACK_PUBLIC_KEY` | no | frontend Paystack Inline (optional) |
| `PAYSTACK_PLAN_AMOUNT` | for initialize | monthly price, minor units |
| `PAYSTACK_CURRENCY` | no | default `NGN` |
| `PAYSTACK_PLAN_NAME` | no | default `AtlasSignals Monthly` |

Without the secret key, both payment routes answer `503
paystack_not_configured`; without `PAYSTACK_PLAN_AMOUNT`, initialize answers
`503 plan_not_configured`. The server still boots and the signal pipeline is
unaffected.

## 6. Adding a webhook integration test

The webhook route is covered by `tests/routes/paystackWebhook.test.ts` with a
fake DB: the tests sign real bodies, stub the `rpc` result, and assert the
parameters forwarded to the database function. To add a case:

```ts
createFakeDb({
  rpcHandlers: {
    handle_paystack_charge_success: (params) => {
      // assert params here, then return the DB shape
      return { data: { processed: true } };
    },
  },
});
```

## 7. Extending payment logic safely

**Follow this order — never skip idempotency.**

1. **Schema change** → new migration with `alter table ... add column if not
   exists`. Never edit an applied migration.
2. **Database logic** → add/extend a `handle_paystack_*` function. Keep it
   `SECURITY DEFINER`, `set search_path = public, pg_temp`, keyed on
   `paystack_reference`, and start with the advisory lock if it mutates
   subscription state. Grant EXECUTE to `service_role` only.
3. **Backend service** → `src/services/paystackService.ts`: parse the event,
   verify, then call the RPC. Never compute expiry in TS.
4. **Route** → thin; verify signature → validate → dispatch → 200.
5. **Tests** → unit (signature/conversion) + route (fake DB + stub rpc).
6. **Docs** → update this file + `database.md`.

Examples of safe extensions: recording `payment_channel` analytics, adding a
`receipt_url`, handling `charge.pending` (Paystack sends it for some payment
methods), or a `refund` flag — all slot into the same pattern. Do **not** add
a second payment provider to this flow; that belongs in its own lifecycle.
