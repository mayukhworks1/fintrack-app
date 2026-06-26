"""
Project duration refresh service.

Computes `Duration (Months)` as decimal months elapsed since `Project Start Date`
and PATCHes the value back to Teable for all active projects every hour.

Active = any status that is NOT "Completed" (On Hold, In progress, Not started,
Input Pending, etc.)  — completed projects keep their final duration frozen.

Formula:
    months = (today_UTC - start_date).days / 30.4375

Rounded to 2 decimal places (e.g. 14.53 months).

Field name in Teable : "Duration (Months)"
Field ID             : fldW0EPeg3nPMVfUVFb  (used in filter params)
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from ..config import settings
from ..db.postgres import get_pool
from ..models import FIELD_IDS

logger = logging.getLogger("fintrack.project_duration")

_REFRESH_INTERVAL = 3600          # 1 hour
_DAYS_PER_MONTH   = 30.4375       # average calendar month
DURATION_FIELD    = "Duration (Months)"
START_DATE_FIELD  = "Project Start Date"

# Statuses where duration should NOT be updated (project is closed/frozen)
_FROZEN_STATUSES = {"✅ Completed", "Completed", "completed"}


# ---------------------------------------------------------------------------
# Core math
# ---------------------------------------------------------------------------

def _compute_duration_months(start_raw: Any) -> float | None:
    """Return elapsed decimal months from start_raw (ISO string) to now UTC.

    Returns None if start_raw is missing/unparseable.
    """
    if not start_raw:
        return None
    try:
        start_dt = datetime.fromisoformat(str(start_raw).replace("Z", "+00:00"))
        elapsed_days = (datetime.now(timezone.utc) - start_dt).days
        if elapsed_days < 0:
            return 0.0   # future start date → show 0
        return round(elapsed_days / _DAYS_PER_MONTH, 2)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Teable helpers
# ---------------------------------------------------------------------------

def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.teable_api_token}",
        "Content-Type": "application/json",
    }

def _record_url() -> str:
    base = settings.teable_base_url.rstrip("/")
    return f"{base}/api/table/{settings.teable_table_id}/record"


async def _fetch_active_projects() -> list[dict[str, Any]]:
    """Fetch all non-completed projects from Teable (up to 1 000)."""
    url = _record_url()
    # We fetch ALL projects and skip frozen ones in Python — simpler than
    # building a "not-equal" filter which Teable may not support consistently.
    params = {
        "fieldKeyType": "name",
        "take": 1000,
        "skip": 0,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.get(url, params=params, headers=_headers())
        res.raise_for_status()
    return res.json().get("records", [])


async def _patch_duration(record_id: str, months: float) -> bool:
    """PATCH Duration (Months) for a single project record."""
    url = f"{_record_url()}/{record_id}"
    body = {
        "fieldKeyType": "name",
        "record": {"fields": {DURATION_FIELD: str(months)}},
    }
    async with httpx.AsyncClient(timeout=12) as client:
        res = await client.patch(url, json=body, headers=_headers())
        res.raise_for_status()
    return True


# ---------------------------------------------------------------------------
# Sync-log writer (mirrors invoice aging pattern)
# ---------------------------------------------------------------------------

async def _write_sync_log(
    source: str,
    total: int,
    updated: int,
    skipped: int,
    error: str | None,
    duration_ms: int,
    details: dict | None = None,
) -> None:
    pool = get_pool()
    if not pool:
        return
    try:
        await pool.execute(
            """
            INSERT INTO sync_log (source, total, created, updated, unchanged, duration_ms, error, details)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
            """,
            source,
            total,
            0,
            updated,
            skipped,
            duration_ms,
            error,
            json.dumps(details or {}),
        )
    except Exception as exc:
        logger.error("project_duration sync_log write failed: %s", exc, exc_info=True)


# ---------------------------------------------------------------------------
# Main refresh cycle
# ---------------------------------------------------------------------------

async def run_project_duration_refresh_cycle() -> dict[str, Any]:
    """
    Fetch all projects, compute decimal-month duration from Start Date,
    PATCH updated values back to Teable, write a sync_log row.

    Returns a summary dict (same shape as invoice aging result).
    """
    started = time.time()
    updated_records: list[dict] = []
    total = updated = skipped = errors = 0
    error_msg: str | None = None

    skip_reasons: list[dict] = []

    try:
        logger.info("project_duration: fetching from table_id=%s", settings.teable_table_id)
        records = await _fetch_active_projects()
        total = len(records)
        logger.info("project_duration: fetched %s records", total)

        for rec in records:
            fields = rec.get("fields") or {}
            record_id = rec.get("id")
            name = fields.get("Project Name") or record_id
            if not record_id:
                continue

            status = str(fields.get("Project Status") or "").strip()
            if status in _FROZEN_STATUSES:
                skipped += 1
                skip_reasons.append({"project": name, "reason": f"frozen status: {status!r}"})
                continue

            start_raw = fields.get(START_DATE_FIELD)
            if not start_raw:
                skipped += 1
                skip_reasons.append({"project": name, "reason": "no Start Date"})
                continue

            new_months = _compute_duration_months(start_raw)
            if new_months is None:
                skipped += 1
                skip_reasons.append({"project": name, "reason": f"unparseable start date: {start_raw!r}"})
                continue

            # Only PATCH if value actually changed (avoid noisy writes)
            existing = fields.get(DURATION_FIELD)
            try:
                existing_f = round(float(existing), 2) if existing is not None else None
            except (TypeError, ValueError):
                existing_f = None

            if existing_f == new_months:
                skipped += 1
                skip_reasons.append({"project": name, "reason": f"unchanged ({new_months} mo)"})
                continue

            try:
                await _patch_duration(record_id, new_months)
                updated += 1
                updated_records.append({
                    "teable_id":    record_id,
                    "project_name": fields.get("Project Name") or record_id,
                    "client":       fields.get("Client") or "",
                    "status":       status,
                    "start_date":   str(start_raw)[:10],
                    "old_duration": existing_f,
                    "new_duration": new_months,
                })
            except httpx.HTTPStatusError as exc:
                errors += 1
                err_body = exc.response.text[:300]
                logger.error(
                    "project duration patch HTTP %s for %s (%s): %s",
                    exc.response.status_code, record_id,
                    fields.get("Project Name") or record_id, err_body,
                )
                if not error_msg:
                    error_msg = f"PATCH HTTP {exc.response.status_code}: {err_body}"
            except Exception as exc:
                errors += 1
                logger.error("project duration patch failed for %s: %s", record_id, exc)

    except httpx.HTTPStatusError as exc:
        error_msg = f"HTTP {exc.response.status_code}: {exc.response.text[:400]}"
        logger.error("project_duration refresh cycle HTTP error: %s", error_msg)
    except Exception as exc:
        error_msg = str(exc)[:500]
        logger.error("project_duration refresh cycle failed: %s", exc)

    duration_ms = int((time.time() - started) * 1000)
    details = {
        "updated_records": updated_records[:25],
        "skip_reasons":    skip_reasons[:25],
        "errors":          errors,
    }
    await _write_sync_log(
        "projects-duration-refresh",
        total,
        updated,
        skipped,
        error_msg,
        duration_ms,
        details,
    )
    logger.info(
        "project_duration: total=%s updated=%s skipped=%s errors=%s (%sms)",
        total, updated, skipped, errors, duration_ms,
    )
    return {
        "total":   total,
        "updated": updated,
        "skipped": skipped,
        "errors":  errors,
        "updated_records": updated_records,
        "duration_ms": duration_ms,
        "error": error_msg,
    }


# ---------------------------------------------------------------------------
# Background loop (started from main.py lifespan)
# ---------------------------------------------------------------------------

async def project_duration_refresh_loop() -> None:
    """Long-running background task — runs once at startup then every hour."""
    await asyncio.sleep(20)   # short delay so server starts cleanly
    await run_project_duration_refresh_cycle()
    while True:
        await asyncio.sleep(_REFRESH_INTERVAL)
        await run_project_duration_refresh_cycle()
