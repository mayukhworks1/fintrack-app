"""
Admin dashboard — full PostgreSQL visibility.

Protected by the 'admin' role (password: APP_ADMIN_PASSWORD, default Master@2026).

Login:
  POST /api/auth/login  {"password": "Master@2026"}
  → { "token": "...", "role": "admin" }

Then use the token as a Bearer token for all /api/admin/* endpoints.

Endpoints
─────────
GET /api/admin/stats                — aggregate counts from all tables
GET /api/admin/audit-log            — paginated request audit log
GET /api/admin/sessions             — login sessions (active by default)
GET /api/admin/chat-sessions        — AI conversation sessions
GET /api/admin/chat-sessions/{id}   — messages in a single session
GET /api/admin/sync-log             — Teable sync run history
GET /api/admin/mirror/projects      — projects_mirror table
GET /api/admin/mirror/invoices      — invoices_mirror table
GET /api/admin/record-history       — field-level change log
"""

import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from ..db.postgres import get_pool
from .deps import require_admin

logger = logging.getLogger("fintrack.admin")
router = APIRouter(prefix="/api/admin", tags=["admin"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _row_to_dict(row) -> dict:
    """Convert an asyncpg Record to a plain dict, serialising special types."""
    d = {}
    for k, v in dict(row).items():
        if hasattr(v, "isoformat"):      # datetime / date
            d[k] = v.isoformat()
        elif hasattr(v, "__iter__") and not isinstance(v, (str, bytes, dict)):
            d[k] = list(v)              # arrays (TEXT[], etc.)
        else:
            d[k] = v
    return d


def _no_db():
    return JSONResponse(
        status_code=503,
        content={"error": "PostgreSQL unavailable"},
    )


# ── Manual sync trigger ───────────────────────────────────────────────────────

@router.post("/sync/trigger")
async def admin_trigger_sync(_: str = Depends(require_admin)):
    """
    Kick off a full Teable → PostgreSQL sync immediately (fire-and-forget).
    Useful when the auto-sync hasn't run yet or you just changed data in Teable.
    The sync result will appear in the Sync Log within a few seconds.
    Returns 503 if the sync loop is not configured (no Teable token set).
    """
    from ..db.sync import run_sync
    from ..db.postgres import get_pool
    from ..config import settings

    pool = get_pool()
    if not pool:
        return _no_db()

    if not (settings.teable_api_token or settings.teable_web_api_token):
        return JSONResponse(
            status_code=503,
            content={"error": "No Teable API token configured — set TEABLE_API_TOKEN or TEABLE_WEB_API_TOKEN"},
        )

    asyncio.create_task(run_sync(incremental=False))
    return {"status": "sync_started", "message": "Full sync triggered — check Sync Log in a few seconds"}


# ── Stats ─────────────────────────────────────────────────────────────────────

@router.get("/stats")
async def admin_stats(_: str = Depends(require_admin)):
    """Aggregate counts and last-seen timestamps across all tables."""
    pool = get_pool()
    if not pool:
        return _no_db()

    row = await pool.fetchrow("""
        SELECT
            -- Audit log totals
            (SELECT COUNT(*)           FROM audit_log)                                     AS audit_total,
            (SELECT COUNT(*)           FROM audit_log WHERE ts > NOW() - INTERVAL '24h')   AS audit_24h,
            (SELECT COUNT(*)           FROM audit_log WHERE ts > NOW() - INTERVAL '1h')    AS audit_1h,
            (SELECT COUNT(DISTINCT ip) FROM audit_log WHERE ts > NOW() - INTERVAL '24h')  AS unique_ips_24h,

            -- Audit log by role
            (SELECT COUNT(*) FROM audit_log WHERE role = 'editor')  AS audit_editor,
            (SELECT COUNT(*) FROM audit_log WHERE role = 'viewer')  AS audit_viewer,
            (SELECT COUNT(*) FROM audit_log WHERE role = 'web')     AS audit_web,
            (SELECT COUNT(*) FROM audit_log WHERE role = 'all')     AS audit_all,
            (SELECT COUNT(*) FROM audit_log WHERE role = 'admin')   AS audit_admin,
            (SELECT COUNT(*) FROM audit_log WHERE role IS NULL)     AS audit_anon,

            -- Error rates (last 24h)
            (SELECT COUNT(*) FROM audit_log WHERE ts > NOW() - INTERVAL '24h' AND status >= 400 AND status < 500) AS audit_4xx_24h,
            (SELECT COUNT(*) FROM audit_log WHERE ts > NOW() - INTERVAL '24h' AND status >= 500)                  AS audit_5xx_24h,

            -- Login sessions
            (SELECT COUNT(*) FROM login_sessions WHERE expires_at > NOW())            AS sessions_active,
            (SELECT COUNT(*) FROM login_sessions)                                     AS sessions_total,
            (SELECT MAX(last_seen_at) FROM login_sessions WHERE expires_at > NOW())   AS sessions_last_active,

            -- AI chats
            (SELECT COUNT(*) FROM chat_sessions)                                      AS chat_sessions_total,
            (SELECT COUNT(*) FROM chat_messages)                                      AS chat_messages_total,
            (SELECT MAX(last_at) FROM chat_sessions)                                  AS chat_last_at,

            -- Mirror tables
            (SELECT COUNT(*) FROM projects_mirror)                                    AS projects_total,
            (SELECT MAX(synced_at) FROM projects_mirror)                              AS projects_last_sync,
            (SELECT COUNT(*) FROM invoices_mirror)                                    AS invoices_total,
            (SELECT MAX(synced_at) FROM invoices_mirror)                              AS invoices_last_sync,
            (SELECT COUNT(*) FROM web_invoices_mirror)                                AS web_invoices_total,
            (SELECT MAX(synced_at) FROM web_invoices_mirror)                          AS web_invoices_last_sync,

            -- Combined invoice totals (for overview)
            (SELECT COUNT(*) FROM invoices_mirror    WHERE payment_status ILIKE '%paid%')     AS invoices_paid,
            (SELECT COUNT(*) FROM web_invoices_mirror WHERE payment_status ILIKE '%paid%')    AS web_invoices_paid,

            -- Change history
            (SELECT COUNT(*) FROM record_history)                                                                  AS history_total,
            (SELECT COUNT(*) FROM record_history WHERE recorded_at > NOW() - INTERVAL '24h')                       AS history_24h,

            -- Last sync run
            (SELECT synced_at FROM sync_log ORDER BY id DESC LIMIT 1)                           AS last_sync_at,
            (SELECT source    FROM sync_log ORDER BY id DESC LIMIT 1)                           AS last_sync_source,
            (SELECT error     FROM sync_log WHERE error IS NOT NULL ORDER BY id DESC LIMIT 1)   AS last_sync_error
    """)

    return _row_to_dict(row)


# ── Audit log ─────────────────────────────────────────────────────────────────

@router.get("/audit-log")
async def admin_audit_log(
    limit:  int           = Query(100, ge=1, le=500),
    offset: int           = Query(0,   ge=0),
    role:   Optional[str] = Query(None),
    method: Optional[str] = Query(None),
    status: Optional[int] = Query(None),
    ip:     Optional[str] = Query(None),
    _:      str           = Depends(require_admin),
):
    """
    Paginated audit log.
    Filters: role, method, status, ip (prefix match).
    Default: last 100 rows, newest first.
    """
    pool = get_pool()
    if not pool:
        return _no_db()

    where: list[str] = []
    params: list     = []
    idx = 1

    if role:
        where.append(f"role = ${idx}");   params.append(role);   idx += 1
    if method:
        where.append(f"method = ${idx}"); params.append(method.upper()); idx += 1
    if status:
        where.append(f"status = ${idx}"); params.append(status); idx += 1
    if ip:
        where.append(f"ip LIKE ${idx}");  params.append(ip + "%"); idx += 1

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    total = await pool.fetchval(f"SELECT COUNT(*) FROM audit_log {where_sql}", *params)
    rows  = await pool.fetch(
        f"""
        SELECT id, ts, role, token_hint, method, path, status, duration_ms,
               request_id, ip, os, browser, device,
               country, country_code, region, city, isp,
               extra::text AS extra
        FROM audit_log {where_sql}
        ORDER BY ts DESC
        LIMIT ${idx} OFFSET ${idx+1}
        """,
        *params, limit, offset,
    )

    records = []
    for row in rows:
        d = _row_to_dict(row)
        # Parse extra JSON string back to dict for cleaner output
        try:
            d["extra"] = json.loads(d.get("extra") or "{}")
        except Exception:
            d["extra"] = {}
        records.append(d)

    return {"total": total, "limit": limit, "offset": offset, "rows": records}


# ── Login sessions ────────────────────────────────────────────────────────────

@router.get("/sessions")
async def admin_sessions(
    active_only: bool         = Query(True),
    role:        Optional[str] = Query(None),
    limit:       int           = Query(100, ge=1, le=500),
    offset:      int           = Query(0, ge=0),
    _:           str           = Depends(require_admin),
):
    """
    Login sessions.  active_only=true (default) filters to non-expired sessions.
    """
    pool = get_pool()
    if not pool:
        return _no_db()

    where: list[str] = []
    params: list     = []
    idx = 1

    if active_only:
        # "active" = token not expired AND not explicitly logged out
        where.append("is_active = true AND expires_at > NOW()")
    if role:
        where.append(f"role = ${idx}"); params.append(role); idx += 1

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    total = await pool.fetchval(f"SELECT COUNT(*) FROM login_sessions {where_sql}", *params)
    rows  = await pool.fetch(
        f"""
        SELECT id, token_hint, role, created_at, last_seen_at, expires_at,
               ip, os, browser, device, country, country_code, city,
               is_active, request_count,
               -- Honest 4-state status
               CASE
                 WHEN NOT is_active OR expires_at <= NOW()
                   THEN 'logged_out'
                 WHEN last_seen_at > NOW() - INTERVAL '30 minutes'
                   THEN 'online'
                 WHEN expires_at > NOW()
                   THEN 'idle'
                 ELSE 'expired'
               END AS session_status
        FROM login_sessions {where_sql}
        ORDER BY last_seen_at DESC
        LIMIT ${idx} OFFSET ${idx+1}
        """,
        *params, limit, offset,
    )

    return {
        "total":  total,
        "limit":  limit,
        "offset": offset,
        "rows":   [_row_to_dict(r) for r in rows],
    }


# ── AI chat sessions ──────────────────────────────────────────────────────────

@router.get("/chat-sessions")
async def admin_chat_sessions(
    limit:  int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _:      str = Depends(require_admin),
):
    """List all AI chat sessions, newest first."""
    pool = get_pool()
    if not pool:
        return _no_db()

    total = await pool.fetchval("SELECT COUNT(*) FROM chat_sessions")
    rows  = await pool.fetch(
        """
        SELECT id, started_at, last_at, role, ip, country, city,
               os, browser, msg_count, title
        FROM chat_sessions
        ORDER BY started_at DESC
        LIMIT $1 OFFSET $2
        """,
        limit, offset,
    )
    return {
        "total":  total,
        "limit":  limit,
        "offset": offset,
        "rows":   [_row_to_dict(r) for r in rows],
    }


@router.get("/chat-sessions/{session_id}")
async def admin_chat_messages(
    session_id: str,
    _: str = Depends(require_admin),
):
    """All messages in one chat session."""
    pool = get_pool()
    if not pool:
        return _no_db()

    session = await pool.fetchrow(
        "SELECT id, started_at, last_at, role, ip, country, city, os, browser, msg_count, title"
        " FROM chat_sessions WHERE id = $1",
        session_id,
    )
    if not session:
        return JSONResponse(status_code=404, content={"error": "Session not found"})

    messages = await pool.fetch(
        "SELECT id, ts, role, content, model, tokens_used, duration_ms"
        " FROM chat_messages WHERE session_id = $1 ORDER BY ts",
        session_id,
    )
    return {
        "session":  _row_to_dict(session),
        "messages": [_row_to_dict(m) for m in messages],
    }


# ── Sync log ──────────────────────────────────────────────────────────────────

@router.get("/sync-log")
async def admin_sync_log(
    limit:  int           = Query(50, ge=1, le=200),
    offset: int           = Query(0, ge=0),
    source: Optional[str] = Query(None),
    _:      str           = Depends(require_admin),
):
    """Teable → PostgreSQL sync history."""
    pool = get_pool()
    if not pool:
        return _no_db()

    where  = f"WHERE source = $1" if source else ""
    params = [source] if source else []
    idx    = len(params) + 1

    total = await pool.fetchval(f"SELECT COUNT(*) FROM sync_log {where}", *params)
    rows  = await pool.fetch(
        f"""
        SELECT id, synced_at, source, total, created, updated, unchanged, duration_ms, error
        FROM sync_log {where}
        ORDER BY id DESC
        LIMIT ${idx} OFFSET ${idx+1}
        """,
        *params, limit, offset,
    )
    return {
        "total":  total,
        "limit":  limit,
        "offset": offset,
        "rows":   [_row_to_dict(r) for r in rows],
    }


# ── Mirror tables ─────────────────────────────────────────────────────────────

@router.get("/mirror/projects")
async def admin_mirror_projects(
    limit:  int           = Query(100, ge=1, le=500),
    offset: int           = Query(0, ge=0),
    status: Optional[str] = Query(None),
    client: Optional[str] = Query(None),
    _:      str           = Depends(require_admin),
):
    """Projects mirror — typed columns (fields JSONB excluded by default)."""
    pool = get_pool()
    if not pool:
        return _no_db()

    where: list[str] = []
    params: list     = []
    idx = 1

    if status:
        where.append(f"status ILIKE ${idx}"); params.append(f"%{status}%"); idx += 1
    if client:
        where.append(f"client ILIKE ${idx}"); params.append(f"%{client}%"); idx += 1

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    total = await pool.fetchval(f"SELECT COUNT(*) FROM projects_mirror {where_sql}", *params)
    rows  = await pool.fetch(
        f"""
        SELECT teable_id, synced_at,
               project_name, client, status,
               amount_billed, actual_profit, profit_pct,
               created_time, modified_time,
               fields::text AS fields
        FROM projects_mirror {where_sql}
        ORDER BY synced_at DESC
        LIMIT ${idx} OFFSET ${idx+1}
        """,
        *params, limit, offset,
    )

    records = []
    for row in rows:
        d = _row_to_dict(row)
        try:
            d["fields"] = json.loads(d.get("fields") or "{}")
        except Exception:
            d["fields"] = {}
        records.append(d)

    return {"total": total, "limit": limit, "offset": offset, "rows": records}


@router.get("/mirror/invoices")
async def admin_mirror_invoices(
    limit:          int           = Query(100, ge=1, le=500),
    offset:         int           = Query(0, ge=0),
    payment_status: Optional[str] = Query(None),
    project:        Optional[str] = Query(None),
    _:              str           = Depends(require_admin),
):
    """Invoices mirror — typed columns."""
    pool = get_pool()
    if not pool:
        return _no_db()

    where: list[str] = []
    params: list     = []
    idx = 1

    if payment_status:
        where.append(f"payment_status ILIKE ${idx}"); params.append(f"%{payment_status}%"); idx += 1
    if project:
        where.append(f"project ILIKE ${idx}"); params.append(f"%{project}%"); idx += 1

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    total = await pool.fetchval(f"SELECT COUNT(*) FROM invoices_mirror {where_sql}", *params)
    rows  = await pool.fetch(
        f"""
        SELECT teable_id, synced_at,
               invoice_number, project, category, payment_status,
               amount_raised, amount_with_tax, amount_received,
               raised_date, cleared_date,
               fields::text AS fields
        FROM invoices_mirror {where_sql}
        ORDER BY raised_date DESC NULLS LAST, synced_at DESC
        LIMIT ${idx} OFFSET ${idx+1}
        """,
        *params, limit, offset,
    )

    records = []
    for row in rows:
        d = _row_to_dict(row)
        try:
            d["fields"] = json.loads(d.get("fields") or "{}")
        except Exception:
            d["fields"] = {}
        records.append(d)

    return {"total": total, "limit": limit, "offset": offset, "rows": records}


@router.get("/mirror/web-invoices")
async def admin_mirror_web_invoices(
    limit:          int           = Query(100, ge=1, le=500),
    offset:         int           = Query(0, ge=0),
    payment_status: Optional[str] = Query(None),
    project:        Optional[str] = Query(None),
    _:              str           = Depends(require_admin),
):
    """Web invoices mirror — typed columns from web invoice Teable table."""
    pool = get_pool()
    if not pool:
        return _no_db()

    where: list[str] = []
    params: list     = []
    idx = 1

    if payment_status:
        where.append(f"payment_status ILIKE ${idx}"); params.append(f"%{payment_status}%"); idx += 1
    if project:
        where.append(f"project ILIKE ${idx}"); params.append(f"%{project}%"); idx += 1

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    total = await pool.fetchval(f"SELECT COUNT(*) FROM web_invoices_mirror {where_sql}", *params)
    rows  = await pool.fetch(
        f"""
        SELECT teable_id, synced_at,
               invoice_number, project, category, description,
               milestone, raised_by, payment_status, currency,
               amount_raised, amount_with_tax, amount_received,
               raised_date, cleared_date, remark,
               fields::text AS fields
        FROM web_invoices_mirror {where_sql}
        ORDER BY raised_date DESC NULLS LAST, synced_at DESC
        LIMIT ${idx} OFFSET ${idx+1}
        """,
        *params, limit, offset,
    )

    records = []
    for row in rows:
        d = _row_to_dict(row)
        try:
            d["fields"] = json.loads(d.get("fields") or "{}")
        except Exception:
            d["fields"] = {}
        records.append(d)

    return {"total": total, "limit": limit, "offset": offset, "rows": records}


# ── Record change history ─────────────────────────────────────────────────────

@router.get("/record-history")
async def admin_record_history(
    limit:        int           = Query(100, ge=1, le=500),
    offset:       int           = Query(0, ge=0),
    source_table: Optional[str] = Query(None),
    teable_id:    Optional[str] = Query(None),
    change_type:  Optional[str] = Query(None),
    _:            str           = Depends(require_admin),
):
    """Field-level change history for mirrored records."""
    pool = get_pool()
    if not pool:
        return _no_db()

    where: list[str] = []
    params: list     = []
    idx = 1

    if source_table:
        where.append(f"source_table = ${idx}"); params.append(source_table); idx += 1
    if teable_id:
        where.append(f"teable_id = ${idx}");    params.append(teable_id);    idx += 1
    if change_type:
        where.append(f"change_type = ${idx}");  params.append(change_type);  idx += 1

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    total = await pool.fetchval(f"SELECT COUNT(*) FROM record_history {where_sql}", *params)
    rows  = await pool.fetch(
        f"""
        SELECT id, recorded_at, source_table, teable_id, change_type,
               changed_fields,
               old_fields::text AS old_fields,
               new_fields::text AS new_fields
        FROM record_history {where_sql}
        ORDER BY recorded_at DESC
        LIMIT ${idx} OFFSET ${idx+1}
        """,
        *params, limit, offset,
    )

    records = []
    for row in rows:
        d = _row_to_dict(row)
        for fld in ("old_fields", "new_fields"):
            try:
                d[fld] = json.loads(d.get(fld) or "null")
            except Exception:
                d[fld] = None
        records.append(d)

    return {"total": total, "limit": limit, "offset": offset, "rows": records}
