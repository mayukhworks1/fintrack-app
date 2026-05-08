"""
Teable → PostgreSQL mirror sync.

Two-tier sync strategy
─────────────────────
1. INSTANT  (webhook path)
   Teable Automation fires "Send HTTP Request" to /api/webhooks/teable
   whenever a record is created or updated.  The webhook handler calls
   upsert_record() directly — mirror updated in < 1 s.

2. INCREMENTAL fallback  (every 30 s)
   Fetches the 200 most-recently-modified records from each table
   (ordered by lastModifiedTime DESC).  Catches anything the webhook
   missed (automation not set up, transient failures, deletions, etc.)

3. FULL reconciliation  (every 5 min)
   Fetches every record.  Ensures the mirror is always consistent even
   if incremental / webhook runs missed some records.

All three paths call the same upsert_record() function so behaviour
is identical regardless of which path triggers the update.
"""

import asyncio
import json
import logging
import time
from typing import Any, Optional

import httpx

from .postgres import get_pool
from ..config import settings

logger = logging.getLogger("fintrack.db.sync")

_INCREMENTAL_INTERVAL = 30    # seconds between incremental syncs
_FULL_INTERVAL        = 300   # seconds between full syncs
_TEABLE_TIMEOUT       = 30
_PAGE_SIZE            = 1000
_INCREMENTAL_TAKE     = 200   # most-recently-modified records to check

# Track timestamps so incremental runs only touch changed records
_last_full_at: float        = 0.0
_last_incremental_at: float = 0.0


# ── Field extractors ────────────────────────────────────────────────────────

def _extract_project(fields: dict) -> dict:
    def _num(k):
        v = fields.get(k)
        try:
            return float(v) if v not in (None, "") else None
        except (TypeError, ValueError):
            return None

    return {
        "project_name":  str(fields.get("Project Name", "") or "")[:255] or None,
        "client":        str(fields.get("Client", "") or "")[:255] or None,
        "status":        str(fields.get("Project Status", "") or "")[:80] or None,
        "amount_billed": _num("Amount Billed So far"),
        "actual_profit": _num("Actual Profit"),
        "profit_pct":    _num("Profit percentage"),
        "created_time":  fields.get("createdTime"),
        "modified_time": fields.get("lastModifiedTime"),
    }


def _extract_invoice(fields: dict) -> dict:
    def _num(k):
        v = fields.get(k)
        try:
            return float(v) if v not in (None, "") else None
        except (TypeError, ValueError):
            return None

    def _date(k):
        v = fields.get(k)
        return str(v)[:10] if v else None

    return {
        "invoice_number":  str(fields.get("Invoice Number", "") or "")[:120] or None,
        "project":         str(fields.get("Project", "") or "")[:255] or None,
        "category":        str(fields.get("Category", "") or "")[:120] or None,
        "payment_status":  str(fields.get("Payment Status", "") or "")[:60] or None,
        "amount_raised":   _num("Amount Raised"),
        "amount_with_tax": _num("Amount with Tax"),
        "amount_received": _num("Amount Received"),
        "raised_date":     _date("Raised Date"),
        "cleared_date":    _date("Cleared Date"),
    }


# Map table_id → (source name, mirror table, extractor)
def _table_config(table_id: str) -> Optional[tuple]:
    if table_id == settings.teable_table_id:
        return ("projects", "projects_mirror", _extract_project)
    if table_id == settings.teable_invoice_table_id:
        return ("invoices", "invoices_mirror", _extract_invoice)
    return None


# ── Core upsert — shared by all three sync paths ────────────────────────────

def _changed_fields(old: dict, new: dict) -> list[str]:
    keys = set(old) | set(new)
    return sorted(k for k in keys if old.get(k) != new.get(k))


async def upsert_record(
    pool,
    source: str,        # "projects" | "invoices"
    mirror_table: str,  # "projects_mirror" | "invoices_mirror"
    teable_id: str,
    fields: dict,
    extractor,
) -> str:
    """
    Insert or update one record in the mirror.
    Returns "created" | "updated" | "unchanged".
    Writes to record_history on create/update.
    """
    typed = extractor(fields)

    async with pool.acquire() as conn:
        existing_row = await conn.fetchrow(
            f"SELECT fields::text AS fields FROM {mirror_table} WHERE teable_id = $1",
            teable_id,
        )

        if existing_row is None:
            # ── INSERT ──
            # Build column list; use ::jsonb cast for the fields column
            cols  = ["teable_id", "fields"] + list(typed.keys())
            vals  = [teable_id, json.dumps(fields, default=str)] + list(typed.values())
            phs   = []
            for i, col in enumerate(cols):
                phs.append(f"${i+1}::jsonb" if col == "fields" else f"${i+1}")
            await conn.execute(
                f"INSERT INTO {mirror_table} ({', '.join(cols)}) VALUES ({', '.join(phs)})",
                *vals,
            )
            # new_fields JSONB → must use ::jsonb cast
            await conn.execute(
                """
                INSERT INTO record_history
                    (source_table, teable_id, change_type, old_fields, new_fields, changed_fields)
                VALUES ($1, $2, 'create', NULL, $3::jsonb, $4)
                """,
                source, teable_id,
                json.dumps(fields, default=str),
                list(fields.keys()),
            )
            return "created"

        old_fields = json.loads(existing_row["fields"])
        diff = _changed_fields(old_fields, fields)
        if not diff:
            return "unchanged"

        # ── UPDATE ──
        set_parts: list[str] = ["synced_at = NOW()"]
        set_vals:  list      = []
        idx = 1

        # fields JSONB column — explicit ::jsonb cast
        set_parts.append(f"fields = ${idx}::jsonb")
        set_vals.append(json.dumps(fields, default=str))
        idx += 1

        # typed columns (plain scalar values)
        for k, v in typed.items():
            set_parts.append(f"{k} = ${idx}")
            set_vals.append(v)
            idx += 1

        set_vals.append(teable_id)
        await conn.execute(
            f"UPDATE {mirror_table} SET {', '.join(set_parts)} WHERE teable_id = ${idx}",
            *set_vals,
        )
        # old_fields and new_fields are JSONB — must use ::jsonb cast
        await conn.execute(
            """
            INSERT INTO record_history
                (source_table, teable_id, change_type, old_fields, new_fields, changed_fields)
            VALUES ($1, $2, 'update', $3::jsonb, $4::jsonb, $5)
            """,
            source, teable_id,
            json.dumps(old_fields, default=str),
            json.dumps(fields, default=str),
            diff,
        )
        return "updated"


async def mark_deleted(pool, source: str, mirror_table: str, teable_id: str) -> None:
    """
    Record a deletion event in record_history and update the mirror row's
    synced_at so we know when it was last seen.  We keep the row so that
    history queries still work.
    """
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT fields::text AS fields FROM {mirror_table} WHERE teable_id = $1",
            teable_id,
        )
        if not row:
            return
        await conn.execute(
            """
            INSERT INTO record_history
                (source_table, teable_id, change_type, old_fields, new_fields, changed_fields)
            VALUES ($1, $2, 'delete', $3::jsonb, NULL, '{}')
            """,
            source, teable_id, row["fields"],
        )
        # Tag the mirror row so it's visibly "deleted" without losing history
        await conn.execute(
            f"UPDATE {mirror_table} SET synced_at = NOW() WHERE teable_id = $1",
            teable_id,
        )


# ── Teable HTTP helpers ──────────────────────────────────────────────────────

async def _fetch_page(
    http: httpx.AsyncClient,
    url: str,
    headers: dict,
    params: dict,
) -> list[dict]:
    try:
        r = await http.get(url, headers=headers, params=params)
        r.raise_for_status()
        return r.json().get("records", [])
    except Exception as exc:
        logger.error("Teable fetch error (%s): %s", url, exc)
        return []


async def _fetch_all(table_id: str, token: str) -> list[dict]:
    """Paginate through every record."""
    url     = f"{settings.teable_base_url.rstrip('/')}/api/table/{table_id}/record"
    headers = {"Authorization": f"Bearer {token}"}
    records: list[dict] = []
    offset = 0
    async with httpx.AsyncClient(timeout=_TEABLE_TIMEOUT) as http:
        while True:
            page = await _fetch_page(http, url, headers, {"take": _PAGE_SIZE, "skip": offset})
            records.extend(page)
            if len(page) < _PAGE_SIZE:
                break
            offset += _PAGE_SIZE
    return records


async def _fetch_recent(table_id: str, token: str, take: int = _INCREMENTAL_TAKE) -> list[dict]:
    """
    Fetch the `take` most-recently-modified records, ordered by
    lastModifiedTime descending.  Used for incremental syncs.
    """
    import json as _json
    url     = f"{settings.teable_base_url.rstrip('/')}/api/table/{table_id}/record"
    headers = {"Authorization": f"Bearer {token}"}
    # Teable orderBy is a JSON-encoded array
    order_by = _json.dumps([{"fieldName": "lastModifiedTime", "order": "desc"}])
    async with httpx.AsyncClient(timeout=_TEABLE_TIMEOUT) as http:
        return await _fetch_page(http, url, headers, {
            "take": take,
            "skip": 0,
            "orderBy": order_by,
        })


# ── Batch sync helpers ───────────────────────────────────────────────────────

async def _sync_records(
    pool,
    source: str,
    mirror_table: str,
    records: list[dict],
    extractor,
    since: float = 0.0,
) -> dict:
    """
    Upsert a list of Teable records.  When `since` > 0, skip records
    whose lastModifiedTime is not newer than that epoch timestamp.
    """
    created = updated = unchanged = skipped = 0
    t0 = time.time()

    for rec in records:
        tid    = rec.get("id", "")
        fields = rec.get("fields", {})

        if since > 0:
            lmt = rec.get("lastModifiedTime") or rec.get("fields", {}).get("lastModifiedTime")
            if lmt:
                try:
                    from datetime import datetime, timezone
                    ts = datetime.fromisoformat(lmt.replace("Z", "+00:00")).timestamp()
                    if ts <= since:
                        skipped += 1
                        continue
                except Exception:
                    pass  # can't parse timestamp → process anyway

        result = await upsert_record(pool, source, mirror_table, tid, fields, extractor)
        if result == "created":
            created += 1
        elif result == "updated":
            updated += 1
        else:
            unchanged += 1

    return {
        "total":     len(records),
        "created":   created,
        "updated":   updated,
        "unchanged": unchanged,
        "skipped":   skipped,
        "duration_ms": int((time.time() - t0) * 1000),
    }


# ── Sync entry points ────────────────────────────────────────────────────────

async def run_sync(incremental: bool = False) -> None:
    """
    Full or incremental sync of both tables.
    `incremental=True` fetches only the 200 most recently modified records
    and skips any that haven't changed since the last run.
    """
    global _last_full_at, _last_incremental_at

    pool = get_pool()
    if not pool:
        return

    token = settings.teable_api_token
    if not token:
        return

    label = "incremental" if incremental else "full"
    since = _last_incremental_at if incremental else 0.0
    fetch = _fetch_recent if incremental else _fetch_all

    projects_records, invoices_records = await asyncio.gather(
        fetch(settings.teable_table_id, token),
        fetch(settings.teable_invoice_table_id, token),
        return_exceptions=True,
    )

    now = time.time()

    for source, mirror_table, records, extractor in [
        ("projects", "projects_mirror", projects_records, _extract_project),
        ("invoices", "invoices_mirror", invoices_records, _extract_invoice),
    ]:
        if isinstance(records, Exception):
            logger.error("[%s] Fetch failed for %s: %s", label, source, records)
            await _write_sync_log(pool, source, 0, 0, 0, 0, 0, str(records))
            continue

        try:
            stats = await _sync_records(pool, source, mirror_table, records, extractor, since=since)
            if stats["created"] or stats["updated"]:
                logger.info(
                    "[%s] %s: total=%d created=%d updated=%d unchanged=%d skipped=%d (%dms)",
                    label, source,
                    stats["total"], stats["created"], stats["updated"],
                    stats["unchanged"], stats.get("skipped", 0), stats["duration_ms"],
                )
            await _write_sync_log(
                pool, source,
                stats["total"], stats["created"], stats["updated"],
                stats["unchanged"], stats["duration_ms"], None,
            )
        except Exception as exc:
            logger.error("[%s] Sync error for %s: %s", label, source, exc)
            await _write_sync_log(pool, source, 0, 0, 0, 0, 0, str(exc))

    if incremental:
        _last_incremental_at = now
    else:
        _last_full_at = now
        _last_incremental_at = now   # full sync resets incremental cursor too


async def _write_sync_log(
    pool, source: str,
    total: int, created: int, updated: int, unchanged: int,
    duration_ms: int, error: Optional[str],
) -> None:
    try:
        await pool.execute(
            """
            INSERT INTO sync_log (source, total, created, updated, unchanged, duration_ms, error)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            """,
            source, total, created, updated, unchanged, duration_ms, error,
        )
    except Exception as exc:
        logger.debug("sync_log write failed: %s", exc)


# ── Background loop ──────────────────────────────────────────────────────────

async def sync_loop() -> None:
    """
    Two-tier background loop:
      - Full sync every 5 min  (catches deletions + guarantees consistency)
      - Incremental sync every 30 s  (near-real-time fallback)

    The webhook receiver provides instant updates on top of this.
    """
    # Short startup delay so the process is ready before touching Teable
    await asyncio.sleep(5)

    # Initial full sync to populate mirror
    logger.info("Running initial full sync…")
    await run_sync(incremental=False)

    tick = 0
    while True:
        await asyncio.sleep(_INCREMENTAL_INTERVAL)
        tick += 1
        try:
            if tick % (_FULL_INTERVAL // _INCREMENTAL_INTERVAL) == 0:
                await run_sync(incremental=False)
            else:
                await run_sync(incremental=True)
        except Exception as exc:
            logger.error("sync_loop unhandled error: %s", exc)
