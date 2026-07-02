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

from __future__ import annotations

import asyncio
import datetime
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
_PAGE_SIZE            = 500   # Teable enforces a per-page max; 500 is safe for all deployments
_INCREMENTAL_TAKE     = 200   # most-recently-modified records to check

# Valkey key for chat context cache — busted after every successful sync so the
# AI always uses fresh data without making live Teable calls on every chat request.
_CHAT_CONTEXT_CACHE_KEY = "chat:context"

# Track timestamps so incremental runs only touch changed records
_last_full_at: float        = 0.0
_last_incremental_at: float = 0.0


# ── Field extractor helpers ──────────────────────────────────────────────────

def _parse_date(v) -> Optional[datetime.date]:
    """
    Convert a Teable date value (ISO string or None) to a Python datetime.date.

    asyncpg is strict: passing a str to a DATE column raises
    "invalid input for query argument $N". We must pass a real
    datetime.date object (or None).

    Teable returns dates as "2024-01-15" or "2024-01-15T00:00:00.000Z".
    Slicing [:10] normalises both forms to "2024-01-15".
    """
    if not v:
        return None
    try:
        return datetime.date.fromisoformat(str(v)[:10])
    except (ValueError, TypeError):
        return None


def _coerce_str(v, maxlen: int) -> Optional[str]:
    """
    Safely coerce any Teable field value to a plain string.

    Teable linked-record fields return a list of dicts:
      [{"id": "recXXX", "title": "Project Name"}, ...]
    We want just the title(s), not the raw Python repr.
    All other values are str()-coerced and truncated normally.
    """
    if v is None or v == "":
        return None
    if isinstance(v, list):
        # Linked records — join titles; fall back to first element str repr.
        # Parenthesised explicitly: the old form parsed as
        #   (", ".join(...) or str(v[0])) if v else ""
        # which read the first element even when there were no titles.
        titles = [item.get("title", "") for item in v if isinstance(item, dict)]
        joined = ", ".join(t for t in titles if t)
        v = joined or (str(v[0]) if v else "")
    return (str(v) or "")[:maxlen] or None


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
            return float(v) if v not in (None, "", []) else None
        except (TypeError, ValueError):
            return None

    return {
        "invoice_number":  _coerce_str(fields.get("Invoice Number"),  120),
        "project":         _coerce_str(fields.get("Project"),         255),
        "category":        _coerce_str(fields.get("Category"),        120),
        "payment_status":  _coerce_str(fields.get("Payment Status"),   60),
        "amount_raised":   _num("Amount Raised"),
        "amount_with_tax": _num("Amount with Tax"),
        "amount_received": _num("Amount Received"),
        # _parse_date returns datetime.date (or None) — asyncpg requires this
        # for DATE columns; passing a string raises "invalid input for $N".
        "raised_date":     _parse_date(fields.get("Raised Date")),
        "cleared_date":    _parse_date(fields.get("Cleared Date")),
    }


def _extract_web_invoice(fields: dict) -> dict:
    """Extract typed columns from the web invoice Teable table."""
    def _num(k):
        v = fields.get(k)
        try:
            return float(v) if v not in (None, "", []) else None
        except (TypeError, ValueError):
            return None

    return {
        "invoice_number":  _coerce_str(fields.get("Invoice Number"), 120),
        "project":         _coerce_str(fields.get("Project"),        255),
        "category":        _coerce_str(fields.get("Category"),       120),
        "description":     _coerce_str(fields.get("Description"),   1000),
        "milestone":       _coerce_str(fields.get("Milestone"),      255),
        "raised_by":       _coerce_str(fields.get("Raised By"),      255),
        "payment_status":  _coerce_str(fields.get("Payment Status"),  60),
        "amount_raised":   _num("Amount Raised"),
        "amount_with_tax": _num("Amount with Tax"),
        "amount_received": _num("Amount Received"),
        # _parse_date returns datetime.date (or None) — asyncpg requires this
        # for DATE columns; passing a string raises "invalid input for $N".
        "raised_date":     _parse_date(fields.get("Raised Date")),
        "cleared_date":    _parse_date(fields.get("Cleared Date")),
        "currency":        _coerce_str(fields.get("Currency"),        20),
        "remark":          _coerce_str(fields.get("Remark"),         500),
    }


def _extract_status(fields: dict) -> dict:
    return {
        "client":        _coerce_str(fields.get("Client"),                    255),
        "project":       _coerce_str(fields.get("Project"),                   255),
        "short_status":  _coerce_str(fields.get("Short Status"),              500),
        "detail_status": (str(fields.get("Current Status (Detailed)") or "")[:10000] or None),
        "status":        _coerce_str(fields.get("Status"),                    100),
        "modified_time": fields.get("lastModifiedTime"),
    }


# Map table_id → (source name, mirror table, extractor)
def _table_config(table_id: str) -> Optional[tuple]:
    if table_id == settings.teable_table_id:
        return ("projects", "projects_mirror", _extract_project)
    if table_id == settings.teable_invoice_table_id:
        return ("invoices", "invoices_mirror", _extract_invoice)
    if table_id == settings.teable_web_invoice_table_id:
        return ("web_invoices", "web_invoices_mirror", _extract_web_invoice)
    if table_id == settings.teable_status_table_id:
        return ("status", "status_mirror", _extract_status)
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

        # ── Actor attribution (popped from Valkey if a user mutation triggered this) ──
        from . import attribution as attrib
        actor = await attrib.pop_attribution(teable_id)

        if existing_row is None:
            # ── INSERT ──
            cols  = ["teable_id", "fields", "deleted_at"] + list(typed.keys())
            vals  = [teable_id, json.dumps(fields, default=str), None] + list(typed.values())
            phs   = []
            for i, col in enumerate(cols):
                phs.append(f"${i+1}::jsonb" if col == "fields" else f"${i+1}")
            await conn.execute(
                f"INSERT INTO {mirror_table} ({', '.join(cols)}) VALUES ({', '.join(phs)})",
                *vals,
            )
            await _insert_history(conn, source, teable_id, "create",
                                  old_json=None,
                                  new_json=json.dumps(fields, default=str),
                                  changed=list(fields.keys()),
                                  actor=actor)
            return "created"

        old_fields = json.loads(existing_row["fields"])
        diff = _changed_fields(old_fields, fields)
        if not diff:
            return "unchanged"

        # ── UPDATE ──
        set_parts: list[str] = ["synced_at = NOW()", "deleted_at = NULL"]
        set_vals:  list      = []
        idx = 1
        set_parts.append(f"fields = ${idx}::jsonb")
        set_vals.append(json.dumps(fields, default=str))
        idx += 1
        for k, v in typed.items():
            set_parts.append(f"{k} = ${idx}")
            set_vals.append(v)
            idx += 1
        set_vals.append(teable_id)
        await conn.execute(
            f"UPDATE {mirror_table} SET {', '.join(set_parts)} WHERE teable_id = ${idx}",
            *set_vals,
        )
        await _insert_history(conn, source, teable_id, "update",
                              old_json=json.dumps(old_fields, default=str),
                              new_json=json.dumps(fields, default=str),
                              changed=diff,
                              actor=actor)
        return "updated"


async def _insert_history(
    conn,
    source: str,
    teable_id: str,
    change_type: str,
    old_json: str | None,
    new_json: str | None,
    changed: list[str],
    actor: dict,
) -> None:
    """
    Insert one fully-attributed row into record_history.
    `actor` must have all keys from attribution.empty_actor() so the bind
    list is uniform regardless of whether attribution was found.
    """
    await conn.execute(
        """
        INSERT INTO record_history (
            source_table, teable_id, change_type,
            old_fields, new_fields, changed_fields,
            change_source, actor_role, actor_ip,
            actor_country, actor_city, actor_region, actor_isp,
            actor_lat, actor_lon,
            actor_os, actor_browser, actor_device,
            actor_user_agent, actor_session_id,
            actor_path, actor_method,
            actor_device_label, actor_device_model, actor_platform_version,
            actor_arch, actor_cpu_cores, actor_memory_gb,
            actor_gpu, actor_screen, actor_timezone,
            actor_language, actor_network
        )
        VALUES (
            $1, $2, $3,
            $4::jsonb, $5::jsonb, $6,
            $7, $8, $9,
            $10, $11, $12, $13,
            $14, $15,
            $16, $17, $18,
            $19, $20,
            $21, $22,
            $23, $24, $25,
            $26, $27, $28,
            $29, $30, $31,
            $32, $33
        )
        """,
        source, teable_id, change_type,
        old_json, new_json, changed,
        actor["change_source"], actor["actor_role"], actor["actor_ip"],
        actor["actor_country"], actor["actor_city"], actor["actor_region"], actor["actor_isp"],
        actor["actor_lat"], actor["actor_lon"],
        actor["actor_os"], actor["actor_browser"], actor["actor_device"],
        actor["actor_user_agent"], actor["actor_session_id"],
        actor["actor_path"], actor["actor_method"],
        actor.get("actor_device_label"), actor.get("actor_device_model"), actor.get("actor_platform_version"),
        actor.get("actor_arch"), actor.get("actor_cpu_cores"), actor.get("actor_memory_gb"),
        actor.get("actor_gpu"), actor.get("actor_screen"), actor.get("actor_timezone"),
        actor.get("actor_language"), actor.get("actor_network"),
    )


async def mark_deleted(pool, source: str, mirror_table: str, teable_id: str) -> None:
    """
    Record a deletion event in record_history and update the mirror row's
    synced_at so we know when it was last seen.  We keep the row so that
    history queries still work.
    """
    from . import attribution as attrib

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT fields::text AS fields FROM {mirror_table} WHERE teable_id = $1",
            teable_id,
        )
        if not row:
            return
        actor = await attrib.pop_attribution(teable_id)
        await _insert_history(conn, source, teable_id, "delete",
                              old_json=row["fields"],
                              new_json=None,
                              changed=[],
                              actor=actor)
        # Tag the mirror row as deleted without losing history
        await conn.execute(
            f"UPDATE {mirror_table} SET synced_at = NOW(), deleted_at = NOW() WHERE teable_id = $1",
            teable_id,
        )


async def reconcile_missing_records(pool, source: str, mirror_table: str, seen_ids: list[str]) -> int:
    """Full sync healer: mark rows deleted when they no longer exist in Teable."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"SELECT teable_id FROM {mirror_table} WHERE deleted_at IS NULL"
        )
    live_ids = {row["teable_id"] for row in rows}
    seen = set(seen_ids)
    missing = sorted(live_ids - seen)
    for teable_id in missing:
        await mark_deleted(pool, source, mirror_table, teable_id)
    return len(missing)


# ── Teable HTTP helpers ──────────────────────────────────────────────────────

# CRITICAL: always include fieldKeyType=name so Teable returns human-readable
# field names as keys (e.g. "Invoice Number") not field IDs (e.g. "fldKSN…").
# Without this the extractors get all-None typed columns and mirrors look empty.
_BASE_PARAMS: dict = {"fieldKeyType": "name"}


def _is_auth_error(exc: RuntimeError) -> bool:
    msg = str(exc)
    return "HTTP 401" in msg or "HTTP 403" in msg


def _all_tokens() -> list[str]:
    """Return all configured Teable tokens, deduped, in priority order."""
    seen: set[str] = set()
    out: list[str] = []
    for t in (
        settings.teable_api_token,
        settings.teable_web_api_token,
        settings.teable_all_api_token,
    ):
        if t and t not in seen:
            out.append(t)
            seen.add(t)
    return out


async def _fetch_page(
    http: httpx.AsyncClient,
    url: str,
    headers: dict,
    params: dict,
) -> list[dict]:
    """
    Fetch one page from Teable.
    Always merges _BASE_PARAMS (fieldKeyType=name) so extractors can use
    human-readable field names instead of field IDs.
    Raises RuntimeError on HTTP errors — callers distinguish auth vs bad-request.
    """
    merged = {**_BASE_PARAMS, **params}   # fieldKeyType always present
    r = await http.get(url, headers=headers, params=merged)
    if not r.is_success:
        body = ""
        try:
            body = r.json().get("message") or r.text[:300]
        except Exception:
            body = r.text[:300]
        raise RuntimeError(f"Teable HTTP {r.status_code} for {url}: {body}")
    return r.json().get("records", [])


async def _fetch_all(table_id: str, token: str) -> list[dict]:
    """
    Paginate through every record for a table using the given token.
    Raises RuntimeError on Teable API errors so run_sync() can write a
    meaningful error to sync_log rather than silently recording 0 rows.
    """
    url     = f"{settings.teable_base_url.rstrip('/')}/api/table/{table_id}/record"
    headers = {"Authorization": f"Bearer {token}"}
    records: list[dict] = []
    offset  = 0
    try:
        async with httpx.AsyncClient(timeout=_TEABLE_TIMEOUT) as http:
            while True:
                page = await _fetch_page(http, url, headers, {"take": _PAGE_SIZE, "skip": offset})
                records.extend(page)
                if len(page) < _PAGE_SIZE:
                    break
                offset += _PAGE_SIZE
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError(f"Teable fetch failed for table {table_id}: {exc}") from exc
    return records


async def _fetch_all_with_token_fallback(table_id: str, primary_token: str) -> tuple[list[dict], str]:
    """
    Try `primary_token` first, then every other configured token on 401/403.

    Many setups have invoices in a different Teable space than projects.
    If the primary token returns an auth error, silently retry with the
    next available token.  Returns (records, winning_token).

    Raises RuntimeError only when ALL tokens fail.
    """
    tokens = [primary_token] + [t for t in _all_tokens() if t != primary_token]
    last_err: Optional[RuntimeError] = None

    for token in tokens:
        try:
            records = await _fetch_all(table_id, token)
            if token != primary_token:
                logger.info(
                    "table %s: primary token failed auth — succeeded with fallback token (hint: %s…)",
                    table_id, token[:8],
                )
            return records, token
        except RuntimeError as exc:
            if _is_auth_error(exc):
                last_err = exc
                logger.debug(
                    "table %s: token %s… rejected (%s) — trying next token",
                    table_id, token[:8], str(exc)[:80],
                )
                continue
            raise  # Non-auth error (400, 404, 5xx) → don't retry with different token

    raise last_err or RuntimeError(f"All tokens failed (auth) for table {table_id}")


async def _fetch_recent(table_id: str, token: str, take: int = _INCREMENTAL_TAKE) -> list[dict]:
    """
    Fetch the `take` most-recently-modified records (unordered).

    Teable's system-field orderBy requires a numeric fieldId which we don't
    have at runtime — the `fieldName` form is rejected with HTTP 400 on all
    current Teable deployments.  We skip the orderBy entirely: the 5-min full
    sync guarantees consistency regardless of record order.

    On 401/403, all configured tokens are tried in sequence.
    """
    url = f"{settings.teable_base_url.rstrip('/')}/api/table/{table_id}/record"

    async def _attempt(tok: str) -> list[dict]:
        headers = {"Authorization": f"Bearer {tok}"}
        try:
            async with httpx.AsyncClient(timeout=_TEABLE_TIMEOUT) as http:
                return await _fetch_page(http, url, headers, {"take": take, "skip": 0})
        except RuntimeError:
            raise
        except Exception as exc:
            raise RuntimeError(f"Teable recent-fetch failed for {table_id}: {exc}") from exc

    tokens = [token] + [t for t in _all_tokens() if t != token]
    last_err: Optional[RuntimeError] = None
    for tok in tokens:
        try:
            return await _attempt(tok)
        except RuntimeError as exc:
            if _is_auth_error(exc):
                last_err = exc
                continue
            raise
    raise last_err or RuntimeError(f"All tokens failed for incremental fetch of table {table_id}")


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
    Full or incremental sync of projects, main invoices, AND web invoices.

    Token strategy (per-table, with fallback):
    ─────────────────────────────────────────
    Each table first tries its "natural" token, then automatically falls back
    to every other configured token on 401/403.  This handles setups where
    invoices and projects live in different Teable spaces, or where only one
    token covers all tables.

    Priority per table:
      projects         → TEABLE_API_TOKEN → TEABLE_WEB_API_TOKEN → TEABLE_ALL_API_TOKEN
      invoices         → TEABLE_WEB_API_TOKEN → TEABLE_API_TOKEN → TEABLE_ALL_API_TOKEN
      web_invoices     → TEABLE_WEB_API_TOKEN → TEABLE_API_TOKEN → TEABLE_ALL_API_TOKEN
    """
    global _last_full_at, _last_incremental_at

    pool = get_pool()
    if not pool:
        return

    all_tokens = _all_tokens()
    if not all_tokens:
        return

    main_token = settings.teable_api_token
    web_token  = settings.teable_web_api_token
    # For invoices: prefer web token (often same space as web invoices), fallback to main
    inv_token  = web_token or main_token
    # Ensure we have at least one token
    any_token  = all_tokens[0]

    label = "incremental" if incremental else "full"
    since = _last_incremental_at if incremental else 0.0

    # Build task list: (source, mirror_table, table_id, preferred_token, extractor)
    # Every fetch uses _fetch_all_with_token_fallback / _fetch_recent which tries
    # the preferred token first, then falls back to others on auth failure.
    tasks: list[tuple] = []
    if settings.teable_table_id and (main_token or any_token):
        tasks.append(("projects", "projects_mirror",
                       settings.teable_table_id, main_token or any_token, _extract_project))
    if settings.teable_invoice_table_id and (inv_token or any_token):
        tasks.append(("invoices", "invoices_mirror",
                       settings.teable_invoice_table_id, inv_token or any_token, _extract_invoice))
    if settings.teable_web_invoice_table_id and (web_token or any_token):
        tasks.append(("web_invoices", "web_invoices_mirror",
                       settings.teable_web_invoice_table_id, web_token or any_token, _extract_web_invoice))
    if settings.teable_status_table_id and (main_token or any_token):
        tasks.append(("status", "status_mirror",
                       settings.teable_status_table_id, main_token or any_token, _extract_status))

    if not tasks:
        logger.warning("run_sync: no tables configured — check TEABLE_*_TABLE_ID settings")
        return

    logger.info("[%s] Syncing %d tables: %s",
                label, len(tasks), ", ".join(t[0] for t in tasks))

    # ── Full sync: use fallback-aware fetch; incremental uses _fetch_recent ──
    async def _do_fetch(source: str, table_id: str, token: str) -> tuple[list[dict], str]:
        """Returns (records, winning_token)."""
        if incremental:
            recs = await _fetch_recent(table_id, token, take=_INCREMENTAL_TAKE)
            return recs, token   # _fetch_recent handles its own token fallback
        return await _fetch_all_with_token_fallback(table_id, token)

    fetched = await asyncio.gather(
        *[_do_fetch(src, tid, tok) for src, _, tid, tok, _ in tasks],
        return_exceptions=True,
    )

    now = time.time()

    for (source, mirror_table, _tid, preferred_tok, extractor), result in zip(tasks, fetched):
        if isinstance(result, Exception):
            err_msg = str(result)
            logger.error("[%s] Fetch failed for %s: %s", label, source, err_msg)
            await _write_sync_log(pool, source, 0, 0, 0, 0, 0, err_msg[:500])
            continue

        records, winning_tok = result if isinstance(result, tuple) else (result, preferred_tok)

        try:
            stats = await _sync_records(pool, source, mirror_table, records, extractor, since=since)
            deleted = 0
            if not incremental:
                deleted = await reconcile_missing_records(
                    pool, source, mirror_table, [r.get("id", "") for r in records if r.get("id")]
                )
            logger.info(
                "[%s] %s: total=%d created=%d updated=%d unchanged=%d skipped=%d deleted=%d (%dms)",
                label, source,
                stats["total"], stats["created"], stats["updated"],
                stats["unchanged"], stats.get("skipped", 0), deleted, stats["duration_ms"],
            )
            await _write_sync_log(
                pool, source,
                stats["total"], stats["created"], stats["updated"],
                stats["unchanged"], stats["duration_ms"], None,
            )
        except Exception as exc:
            logger.error("[%s] Upsert error for %s: %s", label, source, exc)
            await _write_sync_log(pool, source, 0, 0, 0, 0, 0, str(exc)[:500])

    if incremental:
        _last_incremental_at = now
    else:
        _last_full_at = now
        _last_incremental_at = now


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

    # Bust the AI chat context cache on any successful sync so the assistant
    # always sees fresh mirror data without making live Teable API calls.
    if error is None:
        try:
            from .valkey import get_client as _vk, cache_bust as _cache_bust
            vk = _vk()
            if vk:
                # Bust chat context (single key) and report cache (prefix) so
                # the next request sees fresh mirror data without waiting for
                # the TTL to expire.
                await vk.delete(_CHAT_CONTEXT_CACHE_KEY)
                await _cache_bust("report:")
                await vk.delete("status:list:None:None")  # most common cache key
                await _cache_bust("status:")
        except Exception:
            pass  # Valkey unavailable — context will expire naturally


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
