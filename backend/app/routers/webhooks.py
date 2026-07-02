"""
Teable → FinTrack real-time webhook receiver.

────────────────────────────────────────────────────────────────────────
How to set up in Teable (do once per table):
  1. Open the table  →  Automations  →  "Create automation"
  2. Trigger: "When record created"  OR  "When record updated"
  3. Action:  "Send HTTP request"
       Method : POST
       URL    : https://<your-hf-space>.hf.space/api/webhooks/teable
       Headers: Content-Type: application/json
                X-Teable-Table-Id: <table_id>          ← required
                X-Webhook-Secret: <TEABLE_WEBHOOK_SECRET> ← if set
       Body   : (use the "Insert field" button to template all fields)
                {
                  "id":    "{{Record ID}}",
                  "event": "record.created",
                  "fields": { ...all your fields... }
                }
  4. Repeat for "When record deleted" — use event "record.deleted" and
     only send the Record ID field.
────────────────────────────────────────────────────────────────────────

Payload formats accepted
────────────────────────
Teable automations let you template the body freely, so we handle
several common shapes (all with `tableId` from the header):

  A) { "id": "recXXX", "fields": {...}, "event": "record.created" }
  B) { "record": { "id": "recXXX", "fields": {...} }, "event": "..." }
  C) { "records": [{ "id": "...", "fields": {...} }, ...] }
  D) { "recordId": "recXXX", "event": "record.deleted" }

The X-Teable-Table-Id header (or a "tableId" body field) is used to
route to the correct mirror table.
"""

import hashlib
import hmac
import logging
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from ..config import settings
from ..db.postgres import get_pool
from ..db.sync import upsert_record, mark_deleted, _table_config

logger = logging.getLogger("fintrack.webhooks")

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


# ── Signature verification ───────────────────────────────────────────────────

def _verify_signature(raw_body: bytes, signature: Optional[str]) -> bool:
    """
    Authenticate a webhook when TEABLE_WEBHOOK_SECRET is configured.

    Two header forms are accepted so the simple Teable Automation setup works:
      • X-Webhook-Secret: <the plain secret>        (what the setup docs describe)
      • X-Webhook-Secret: sha256=<HMAC-SHA256 hex>  (signed body, stronger)

    Both comparisons are constant-time.

    Fail-closed policy: when TEABLE_WEBHOOK_SECRET is not configured the
    endpoint rejects every request (returns False) so no one can forge
    unauthenticated writes into the PG mirrors. The only exception is when the
    operator explicitly opts in via WEBHOOK_ALLOW_UNSIGNED=true (local dev).
    """
    secret = settings.teable_webhook_secret
    if not secret:
        if settings.webhook_allow_unsigned:
            return True   # explicit dev opt-in — accept unsigned (logged at startup)
        logger.warning(
            "Webhook rejected: TEABLE_WEBHOOK_SECRET is not set (fail-closed). "
            "Set it in secrets and add the same X-Webhook-Secret header in Teable, "
            "or set WEBHOOK_ALLOW_UNSIGNED=true for local development."
        )
        return False
    if not signature:
        logger.warning("Webhook received without X-Webhook-Secret header")
        return False

    # Signed-body form
    expected_hmac = "sha256=" + hmac.new(
        secret.encode(), raw_body, digestmod=hashlib.sha256
    ).hexdigest()
    if hmac.compare_digest(expected_hmac, signature):
        return True
    # Plain-secret form (matches the documented Teable Automation header)
    return hmac.compare_digest(secret, signature)


# ── Payload parser ───────────────────────────────────────────────────────────

def _parse_payload(body: dict) -> list[tuple[str, dict, str]]:
    """
    Returns list of (teable_id, fields, event) tuples.
    `event` is one of: "create" | "update" | "delete"
    """
    results: list[tuple[str, dict, str]] = []

    raw_event = body.get("event", "")
    is_delete = "delete" in raw_event.lower()

    # Format D: explicit deletion by ID only
    if is_delete and "recordId" in body:
        rid = body["recordId"]
        if isinstance(rid, list):
            for r in rid:
                results.append((str(r), {}, "delete"))
        else:
            results.append((str(rid), {}, "delete"))
        return results

    # Format C: array of records
    if "records" in body:
        for rec in body["records"]:
            rid    = rec.get("id", "")
            fields = rec.get("fields", rec)   # fallback: the rec itself is the fields
            if rid:
                results.append((rid, fields, "delete" if is_delete else "upsert"))
        return results

    # Format B: { "record": { "id": ..., "fields": ... } }
    if "record" in body:
        rec    = body["record"]
        rid    = rec.get("id", "")
        fields = rec.get("fields", {})
        if rid:
            results.append((rid, fields, "delete" if is_delete else "upsert"))
        return results

    # Format A: flat  { "id": "rec...", "fields": {...} }
    rid    = body.get("id", "")
    fields = body.get("fields", {})
    if rid:
        results.append((rid, fields, "delete" if is_delete else "upsert"))

    return results


# ── Endpoint ─────────────────────────────────────────────────────────────────

@router.post("/teable", status_code=200)
async def receive_teable_webhook(
    request: Request,
    x_teable_table_id: Optional[str]  = Header(None, alias="X-Teable-Table-Id"),
    x_webhook_secret:  Optional[str]  = Header(None, alias="X-Webhook-Secret"),
    x_signature_256:   Optional[str]  = Header(None, alias="X-Signature-256"),
):
    """
    Receive a record-change event from a Teable Automation.
    Immediately upserts the record into the PostgreSQL mirror.
    Always returns 200 so Teable doesn't retry — errors are logged only.
    """
    raw_body = await request.body()

    # Verify signature (either header works)
    sig = x_webhook_secret or x_signature_256
    if not _verify_signature(raw_body, sig):
        logger.warning("Webhook signature mismatch — request rejected")
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        body = await request.json()
    except Exception:
        logger.warning("Webhook received non-JSON body")
        return {"ok": False, "reason": "invalid JSON"}

    # Determine table_id — prefer header, fall back to body field
    table_id = x_teable_table_id or body.get("tableId", "")
    if not table_id:
        logger.warning("Webhook missing tableId — cannot route. body keys: %s", list(body))
        return {"ok": False, "reason": "missing tableId"}

    config = _table_config(table_id)
    if not config:
        # Not one of our mirrored tables — ignore silently
        return {"ok": True, "reason": "table not mirrored"}

    source, mirror_table, extractor = config

    pool = get_pool()
    if not pool:
        logger.debug("Webhook received but PostgreSQL pool unavailable")
        return {"ok": False, "reason": "db unavailable"}

    items = _parse_payload(body)
    if not items:
        logger.warning("Webhook payload contained no parseable records: %s", body)
        return {"ok": False, "reason": "no records found in payload"}

    results = []
    any_change = False
    for teable_id, fields, event in items:
        try:
            if event == "delete":
                await mark_deleted(pool, source, mirror_table, teable_id)
                results.append({"id": teable_id, "action": "deleted"})
                logger.info("Webhook deleted %s/%s", source, teable_id)
                any_change = True
            else:
                action = await upsert_record(pool, source, mirror_table, teable_id, fields, extractor)
                results.append({"id": teable_id, "action": action})
                if action != "unchanged":
                    logger.info("Webhook %s %s/%s", action, source, teable_id)
                    any_change = True
        except Exception as exc:
            logger.error("Webhook upsert failed for %s/%s: %s", source, teable_id, exc)
            results.append({"id": teable_id, "action": "error", "detail": str(exc)})

    # Bust in-process + Valkey caches whenever the mirror actually changed.
    # Without this, Teable-originated edits (not going through the app) would
    # stay invisible for the full Valkey TTL (up to 5 minutes).
    if any_change:
        _bust_source_caches(source)

    return {"ok": True, "processed": results}


def _bust_source_caches(source: str) -> None:
    """
    Bust the in-process TTL cache and schedule a Valkey bust for `source`.
    The Valkey bust runs first (via task), then SSE subscribers are notified
    so the frontend reload reads fresh data, not a stale Valkey-cached response.
    Called after webhook updates so users see Teable-side changes immediately.
    """
    try:
        from ..utils.cache import cache as _mem_cache
        _mem_cache.bust(f"{source}:")
    except Exception:
        pass

    try:
        from ..db.valkey import cache_bust as _vk_bust, get_client as _vk_client

        async def _do_vk_bust_then_notify():
            # 1. Bust Valkey first so cache is empty before the frontend reloads
            try:
                vk = _vk_client()
                if vk:
                    await _vk_bust(f"{source}:")
                    if source == "status":
                        await vk.delete("chat:context")
                        await _vk_bust("report:")
            except Exception:
                pass
            # 2. Now notify SSE — frontend reload will read fresh PG data
            if source == "status":
                try:
                    from ..services.status import notify_status_change
                    notify_status_change()
                except Exception:
                    pass

        from ..utils.tasks import spawn
        spawn(_do_vk_bust_then_notify(), name="webhook-cache-bust")
    except Exception:
        pass
