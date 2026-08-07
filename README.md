# ⚡ AtlasSignals

Low-latency XAU/USD trading signal system built from two cooperating parts:

| Component | Repo / Location | Role |
|---|---|---|
| **Hugging Face Space** | [`aka465355/AtlasSignals`](https://huggingface.co/spaces/aka465355/AtlasSignals) — lives in `hf-space/` (its own git repo) | **Analysis engine only** — hydrates data, builds multi-timeframe context, scores setups, generates one signal per session, relays it to the backend |
| **AtlasSignals Relay** | [`atlassignals-relay/`](atlassignals-relay/) — this GitHub repo | **Source of truth** — signed webhook ingestion, Supabase persistence, delivery outbox, real-time stream, read API |

## Signal flow

```
HF Space (analysis) ──signed webhook──▶ AtlasSignals Relay (backend)
                                          │ verify HMAC-SHA256
                                          │ validate canonical event (Zod)
                                          │ idempotency (duplicate → 409)
                                          ▼
                                     Supabase (signals) ──▶ delivery_outbox
                                          │
                                          └──▶ SSE /stream + GET /signals
```

## Repositories

- **Backend** → [github.com/ghost47-ux/AtlasSignals](https://github.com/ghost47-ux/AtlasSignals)
  (this repo). Start with [`atlassignals-relay/README.md`](atlassignals-relay/README.md).
- **HF Space** → huggingface.co/spaces/aka465355/AtlasSignals (separate repo,
  not tracked here). It contains `signal_relay.py` and the full engine.

## Security

Never commit `.env` files. `WEBHOOK_SECRET` must match between the Space and
the Relay. See each component's README for env vars and deployment.
