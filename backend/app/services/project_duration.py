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
from ..utils.http import shared_client

from ..config import settings
from ..db.postgres import get_pool
from ..models import FIELD_IDS

logger = logging.getLogger("fintrack.project_duration")

_REFRESH_INTERVAL = 3600          # 1 hour
_DAYS_PER_MONTH   = 30.4375       # average calendar month

# Field names are AUTO-DETECTED from the actual Teable records (case-insensitive)
# so the automation adapts to the real schema instead of hard-coding one name.
START_DATE_CANDIDATES = [
    "Project Start Date", "Start Date", "Project Start", "Started On",
    "Kickoff Date", "Kick-off Date", "Start", "Date Started", "Begin Date",
]
# Output fields measured in MONTHS (decimal)
DURATION_MONTH_CANDIDATES = [
    "Duration (Months)", "Project Duration (Months)", "Duration", "Duration Months",
    "Age (Months)", "Project Age (Months)", "Aging (Months)", "Project Aging (Months)",
]
# Output fields measured in DAYS (integer)
AGING_DAY_CANDIDATES = [
    "Project Aging (Days)", "Aging (Days)", "Agening (Days)", "Aging Days",
    "Project Age (Days)", "Age (Days)", "Project Aging", "Aging", "Age (Days)",
]
STATUS_CANDIDATES = ["Project Status", "Status", "Stage", "Project Stage"]

# Statuses where aging should NOT be updated (project is closed/frozen)
_FROZEN_STATUSES = {"✅ completed", "completed", "✅ complete", "complete", "done", "closed", "archived"}


def _detect_field(field_keys: list[str], candidates: list[str]) -> str | None:
    """Return the actual field name matching a candidate (case-insensitive)."""
    lower = {k.lower(): k for k in field_keys}
    for cand in candidates:
        if cand.lower() in lower:
            return lower[cand.lower()]
    return None


# ---------------------------------------------------------------------------
# Core math
# ---------------------------------------------------------------------------

def _compute_elapsed(start_raw: Any) -> tuple[int, float] | None:
    """Return (elapsed_days, elapsed_months) from start_raw to now UTC.

    Returns None if start_raw is missing/unparseable.
    """
    if not start_raw:
        return None
    try:
        s = str(start_raw)
        # Teable date fields may be ISO strings or epoch millis
        if s.isdigit():
            start_dt = datetime.fromtimestamp(int(s) / 1000, tz=timezone.utc)
        else:
            start_dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            if start_dt.tzinfo is None:
                start_dt = start_dt.replace(tzinfo=timezone.utc)
        elapsed_days = (datetime.now(timezone.utc) - start_dt).days
        if elapsed_days < 0:
            return (0, 0.0)   # future start date → 0
        return (elapsed_days, round(elapsed_days / _DAYS_PER_MONTH, 2))
    except Exception:
        return None


def _compute_duration_months(start_raw: Any) -> float | None:
    r = _compute_elapsed(start_raw)
    return None if r is None else r[1]


# ---------------------------------------------------------------------------
# Teable helpers
# ---------------------------------------------------------------------------

def _token() -> str:
    # Prefer the MAIN token — the projects table lives in the main Teable space,
    # same as the dashboard/sync. (The web token often can't read it → 403.)
    return (
        settings.teable_api_token
        or settings.teable_web_api_token
        or settings.teable_all_api_token
        or ""
    )

def _projects_table_id() -> str:
    # The projects-duration automation must target the SAME projects table the
    # rest of the app uses (teable_table_id), not the separate "Web Projects"
    # table. Overridable via TEABLE_PROJECTS_TABLE_ID if they ever diverge.
    return settings.teable_projects_table_id or settings.teable_table_id

def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {_token()}",
        "Content-Type": "application/json",
    }

def _record_url() -> str:
    base = settings.teable_base_url.rstrip("/")
    return f"{base}/api/table/{_projects_table_id()}/record"


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
    async with shared_client(timeout=30) as client:
        res = await client.get(url, params=params, headers=_headers())
        res.raise_for_status()
    return res.json().get("records", [])


async def _patch_fields(record_id: str, fields: dict[str, Any]) -> bool:
    """PATCH arbitrary field(s) for a single project record."""
    url = f"{_record_url()}/{record_id}"
    body = {"fieldKeyType": "name", "record": {"fields": fields}}
    async with shared_client(timeout=12) as client:
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
    detected: dict[str, Any] = {}

    try:
        logger.info("project_duration: fetching from table_id=%s", _projects_table_id())
        records = await _fetch_active_projects()
        total = len(records)
        logger.info("project_duration: fetched %s records", total)

        # Auto-detect field names from the union of all record field keys, so the
        # automation works regardless of exact naming (months- or days-based).
        all_keys: list[str] = []
        for rec in records:
            for k in (rec.get("fields") or {}).keys():
                if k not in all_keys:
                    all_keys.append(k)
        start_field  = _detect_field(all_keys, START_DATE_CANDIDATES)
        month_field  = _detect_field(all_keys, DURATION_MONTH_CANDIDATES)
        day_field    = _detect_field(all_keys, AGING_DAY_CANDIDATES)
        status_field = _detect_field(all_keys, STATUS_CANDIDATES)
        name_field   = _detect_field(all_keys, ["Project Name", "Name", "Title"]) or "Project Name"
        detected = {
            "start_field": start_field, "month_field": month_field,
            "day_field": day_field, "status_field": status_field,
            "available_fields": all_keys[:60],
        }
        logger.info("project_duration: detected fields %s", detected)

        if total and not start_field:
            error_msg = ("No start-date field found. Available fields: "
                         + ", ".join(all_keys[:40]))
        if total and not (month_field or day_field):
            msg = ("No duration/aging output field found. Available fields: "
                   + ", ".join(all_keys[:40]))
            error_msg = (error_msg + " | " + msg) if error_msg else msg

        if start_field and (month_field or day_field):
            for rec in records:
                fields = rec.get("fields") or {}
                record_id = rec.get("id")
                name = fields.get(name_field) or record_id
                if not record_id:
                    continue

                status = str((fields.get(status_field) if status_field else "") or "").strip()
                if status.lower() in _FROZEN_STATUSES:
                    skipped += 1
                    skip_reasons.append({"project": name, "reason": f"frozen status: {status!r}"})
                    continue

                start_raw = fields.get(start_field)
                if not start_raw:
                    skipped += 1
                    skip_reasons.append({"project": name, "reason": f"no value in {start_field!r}"})
                    continue

                elapsed = _compute_elapsed(start_raw)
                if elapsed is None:
                    skipped += 1
                    skip_reasons.append({"project": name, "reason": f"unparseable start date: {start_raw!r}"})
                    continue
                days, months = elapsed

                # Build the patch only for output fields that actually changed
                patch: dict[str, Any] = {}
                if month_field:
                    try: cur = round(float(fields.get(month_field)), 2) if fields.get(month_field) not in (None, "") else None
                    except (TypeError, ValueError): cur = None
                    if cur != months: patch[month_field] = str(months)
                if day_field:
                    try: curd = int(float(fields.get(day_field))) if fields.get(day_field) not in (None, "") else None
                    except (TypeError, ValueError): curd = None
                    if curd != days: patch[day_field] = str(days)

                if not patch:
                    skipped += 1
                    skip_reasons.append({"project": name, "reason": f"unchanged ({months} mo / {days} d)"})
                    continue

                try:
                    await _patch_fields(record_id, patch)
                    updated += 1
                    updated_records.append({
                        "teable_id":    record_id,
                        "project_name": name,
                        "client":       fields.get("Client") or "",
                        "status":       status,
                        "start_date":   str(start_raw)[:10],
                        "new_months":   months,
                        "new_days":     days,
                        "fields_written": list(patch.keys()),
                    })
                except httpx.HTTPStatusError as exc:
                    errors += 1
                    err_body = exc.response.text[:300]
                    logger.error("project duration patch HTTP %s for %s (%s): %s",
                                 exc.response.status_code, record_id, name, err_body)
                    if not error_msg:
                        error_msg = f"PATCH HTTP {exc.response.status_code} on {list(patch.keys())}: {err_body}"
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
        "detected_fields": detected,
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
        "detected_fields": detected,
        "skip_reasons": skip_reasons[:25],
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
