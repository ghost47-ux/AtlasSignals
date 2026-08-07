"""
huggingface-example.py — reference sender for the AtlasSignals Relay webhook.

This is the canonical example of what the Hugging Face Space does in
production (see the Space's `signal_relay.py` for the full implementation):

  1. load WEBHOOK_URL + WEBHOOK_SECRET
  2. build a canonical signal payload
  3. sign the EXACT body bytes with HMAC-SHA256
  4. POST with the x-atlas-signature header
  5. print the response

Usage:
    WEBHOOK_URL=https://your-backend.vercel.app/webhooks/signal \
    WEBHOOK_SECRET=your-shared-secret \
    python huggingface-example.py
"""
import hashlib
import hmac
import json
import os
import uuid
from datetime import datetime, timezone

import requests

WEBHOOK_URL = os.environ.get("WEBHOOK_URL", "").strip()
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "").strip()


def sign(body_bytes: bytes, secret: str) -> str:
    """Hex HMAC-SHA256 of the exact bytes being sent."""
    return hmac.new(secret.encode("utf-8"), body_bytes, hashlib.sha256).hexdigest()


def build_signal() -> dict:
    """A canonical signal event (matching the backend Zod schema)."""
    return {
        "signal_id": str(uuid.uuid4()),
        "symbol": "XAU/USD",
        "direction": "BUY",
        "timeframe": "15M",
        "entry": 3365.42,
        "stop_loss": 3358.10,
        "take_profit": 3378.90,
        "confidence": 84,
        "setup_name": "TIER_A_HIGH_QUALITY",
        "market_state": "TRENDING_UP/TRENDING",
        "analysis_version": "ITER_32",
        "created_at": datetime.now(timezone.utc).isoformat(),
        # Same signal content → same key → backend never stores duplicates.
        "idempotency_key": "example-key-0001",
        "metadata": {"setup_tier": "A", "execution_type": "MARKET"},
    }


def main() -> None:
    if not WEBHOOK_URL or not WEBHOOK_SECRET:
        raise SystemExit("WEBHOOK_URL and WEBHOOK_SECRET are required.")

    payload = build_signal()
    body = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    signature = sign(body, WEBHOOK_SECRET)

    print(f"POST {WEBHOOK_URL}")
    print(f"signature: {signature}")
    print(f"payload:   {payload}")

    resp = requests.post(
        WEBHOOK_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "x-atlas-signature": signature,
            "x-atlas-idempotency-key": payload["idempotency_key"],
        },
        timeout=10,
    )

    print(f"\nHTTP {resp.status_code}")
    print(resp.text)

    # Expected:
    #   200 → {"received": true, "signal_id": "…", "inserted_at": "…"}
    #   409 → {"error": "duplicate_idempotency_key", "signal_id": "…"} (re-sent)
    #   401 → {"error": "invalid_signature"} (secret mismatch)
    #   422 → {"error": "invalid_payload", …} (schema violation)


if __name__ == "__main__":
    main()
