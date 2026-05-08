"""
Teable → PostgreSQL mirror sync.

Runs every 5 minutes (triggered from main.py lifespan).
Full-replace strategy:
  1. Fetch all records from Teable (projects + invoices).
  2. Compare against current mirror rows using the raw `fields` JSONB.
  3. INSERT new rows, UPDATE changed rows, write field-level diffs to
     `record_history`, log a summary row to `sync_log`.

Design choices:
- No deletions from the mirror (soft "gone" is tracked by changed_fields).
- Uses a single DB transaction per table for atomicity.
- All errors are logged; sync failure never crashes the process.
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

_SYNC_INTERVAL = 300        # seconds between full syncs
_TEABLE_TIMEOUT = 30        # seconds for each Teable HTTP call
_PAGE_SIZE = 1000           # max records per Teable page request

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


# ── Teable fetch ────────────────────────────────────────────────────────────

async def _fetch_all_teable(table_id: str, token: str) -> list[dict]:
    """Paginate through all records in a Teable table."""
    url     = f"{settings.teable_base_url.rstrip('/')}/api/table/{table_id}/record"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    records: list[dict] = []
    offset  = 0

    async with httpx.AsyncClient(timeout=_TEABLE_TIMEOUT) as http:
        while True:
            params = {"take": _PAGE_SIZE, "skip": offset}
            try:
                r = await http.get(url, headers=headers, params=params)
                r.raise_for_status()
            except Exception as exc:
                logger.error("Teable fetch failed (table=%s, offset=%d): %s", table_id, offset, exc)
                break
            data  = r.json()
            page  = data.get("records", [])
            records.extend(page)
            if len(page) < _PAGE_SIZE:
                break
            offset += _PAGE_SIZE

    return records


# ── Differ ──────────────────────────────────────────────────────────────────

def _changed_fields(old: dict, new: dict) -> list[str]:
    """Return field names where values differ."""
    keys = set(old) | set(new)
    return sorted(k for k in keys if old.get(k) != new.get(k))


# ── Sync one table ──────────────────────────────────────────────────────────

async def _sync_table(
    pool,
    source: str,               # "projects" | "invoices"
    mirror_table: str,         # "projects_mirror" | "invoices_mirror"
    teable_records: list[dict],
    extractor,                 # callable(fields) -> dict of typed columns
) -> dict:
    """
    Upsert records into mirror table and record changes.
    Returns stats dict.
    """
    created = updated = unchanged = 0
    t0 = time.time()

    async with pool.acquire() as conn:
        async with conn.transaction():
            # Load all existing mirror rows into memory (tiny table)
            existing = {
                row["teable_id"]: json.loads(row["fields"])
                for row in await conn.fetch(f"SELECT teable_id, fields::text AS fields FROM {mirror_table}")
            }

            for rec in teable_records:
                tid    = rec.get("id", "")
                fields = rec.get("fields", {})
                typed  = extractor(fields)

                if tid not in existing:
                    # ── INSERT ──
                    cols   = ["teable_id", "fields"] + list(typed.keys())
                    vals   = [tid, json.dumps(fields, default=str)] + list(typed.values())
                    ph     = ", ".join(f"${i+1}" for i in range(len(vals)))
                    col_s  = ", ".join(cols)
                    await conn.execute(
                        f"INSERT INTO {mirror_table} ({col_s}) VALUES ({ph})",
                        *vals,
                    )
                    await conn.execute(
                        """
                        INSERT INTO record_history
                            (source_table, teable_id, change_type, old_fields, new_fields, changed_fields)
                        VALUES ($1, $2, 'create', NULL, $3, $4)
                        """,
                        source, tid, json.dumps(fields, default=str), list(fields.keys()),
                    )
                    created += 1
                else:
                    old_fields = existing[tid]
                    diff       = _changed_fields(old_fields, fields)
                    if not diff:
                        unchanged += 1
                        continue

                    # ── UPDATE ──
                    typed["fields"]     = json.dumps(fields, default=str)
                    typed["synced_at"]  = "NOW()"   # sentinel — handled below
                    set_parts = []
                    set_vals  = []
                    idx       = 1
                    for k, v in typed.items():
                        if k == "synced_at":
                            set_parts.append(f"{k} = NOW()")
                        elif k == "fields":
                            set_parts.append(f"{k} = ${idx}::jsonb")
                            set_vals.append(v)
                            idx += 1
                        else:
                            set_parts.append(f"{k} = ${idx}")
                            set_vals.append(v)
                            idx += 1
                    set_vals.append(tid)
                    await conn.execute(
                        f"UPDATE {mirror_table} SET {', '.join(set_parts)} WHERE teable_id = ${idx}",
                        *set_vals,
                    )
                    await conn.execute(
                        """
                        INSERT INTO record_history
                            (source_table, teable_id, change_type, old_fields, new_fields, changed_fields)
                        VALUES ($1, $2, 'update', $3, $4, $5)
                        """,
                        source,
                        tid,
                        json.dumps(old_fields, default=str),
                        json.dumps(fields, default=str),
                        diff,
                    )
                    updated += 1

    return {
        "total":     len(teable_records),
        "created":   created,
        "updated":   updated,
        "unchanged": unchanged,
        "duration_ms": int((time.time() - t0) * 1000),
    }


# ── Main sync entry point ───────────────────────────────────────────────────

async def run_sync() -> None:
    """Full sync of both tables. Logs results to sync_log."""
    pool = get_pool()
    if not pool:
        return

    token   = settings.teable_api_token
    w_token = settings.teable_web_api_token or token

    if not token:
        logger.debug("No Teable token — sync skipped")
        return

    # Fetch both tables concurrently
    projects_records, invoices_records = await asyncio.gather(
        _fetch_all_teable(settings.teable_table_id, token),
        _fetch_all_teable(settings.teable_invoice_table_id, token),
        return_exceptions=True,
    )

    for source, mirror_table, records, extractor in [
        ("projects", "projects_mirror", projects_records, _extract_project),
        ("invoices", "invoices_mirror", invoices_records, _extract_invoice),
    ]:
        if isinstance(records, Exception):
            logger.error("Sync fetch failed for %s: %s", source, records)
            await _write_sync_log(pool, source, 0, 0, 0, 0, 0, str(records))
            continue

        try:
            stats = await _sync_table(pool, source, mirror_table, records, extractor)
            logger.info(
                "Sync %s: total=%d created=%d updated=%d unchanged=%d (%dms)",
                source, stats["total"], stats["created"],
                stats["updated"], stats["unchanged"], stats["duration_ms"],
            )
            await _write_sync_log(
                pool, source,
                stats["total"], stats["created"], stats["updated"],
                stats["unchanged"], stats["duration_ms"], None,
            )
        except Exception as exc:
            logger.error("Sync error for %s: %s", source, exc)
            await _write_sync_log(pool, source, 0, 0, 0, 0, 0, str(exc))


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


# ── Background loop ─────────────────────────────────────────────────────────

async def sync_loop() -> None:
    """Infinite loop: run_sync() every _SYNC_INTERVAL seconds."""
    # Small initial delay so startup completes before first sync
    await asyncio.sleep(10)
    while True:
        try:
            await run_sync()
        except Exception as exc:
            logger.error("sync_loop unhandled error: %s", exc)
        await asyncio.sleep(_SYNC_INTERVAL)
