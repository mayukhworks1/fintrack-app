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
GET /api/admin/ai-generations       — AI generation/task runs
GET /api/admin/ai-generations/{id}  — single generation detail
GET /api/admin/insight-configs      — saved dashboard/report presets
GET /api/admin/insight-exports      — dashboard/report export audit
GET /api/admin/sync-log             — Teable sync run history
GET /api/admin/mirror/projects      — projects_mirror table
GET /api/admin/mirror/invoices      — invoices_mirror table
GET /api/admin/mirror/status        — status_mirror table
GET /api/admin/record-history       — field-level change log
"""

import asyncio
import json
import logging
import os
import subprocess
from datetime import datetime
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..config import settings
from ..db.postgres import get_pool
from ..services.shared_views import SharedViewService
from .deps import require_admin

logger = logging.getLogger("fintrack.admin")
router = APIRouter(prefix="/api/admin", tags=["admin"])


class AuthUserDecision(BaseModel):
    role_key: Optional[str] = Field(default=None, max_length=60)
    reason: Optional[str] = Field(default=None, max_length=500)
    full_name: Optional[str] = Field(default=None, max_length=255)


class AuthUserCreate(BaseModel):
    email: str = Field(..., max_length=320)
    full_name: Optional[str] = Field(default=None, max_length=255)
    role_key: str = Field(default="user", max_length=60)
    status: str = Field(default="active", max_length=30)
    send_invite: bool = True


class AuthUserRoleUpdate(BaseModel):
    role_key: str = Field(..., max_length=60)
    reason: Optional[str] = Field(default=None, max_length=500)
    revoke_sessions: bool = True


class AuthSmtpTest(BaseModel):
    to: Optional[str] = Field(default=None, max_length=320)


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


def _client_ip(request: Request) -> str:
    for header in ("cf-connecting-ip", "x-forwarded-for", "x-real-ip"):
        value = request.headers.get(header, "")
        if value:
            return value.split(",")[0].strip()
    return request.client.host if request.client else ""


def _git_commit_sha() -> str | None:
    """Best-effort deployment commit detection without making health depend on git."""
    for key in ("GIT_COMMIT_SHA", "COMMIT_SHA", "VERCEL_GIT_COMMIT_SHA"):
        value = (os.getenv(key) or "").strip()
        if value:
            return value[:12]
    configured = (settings.git_commit_sha or "").strip()
    if configured:
        return configured[:12]
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short=12", "HEAD"],
            cwd=os.getcwd(),
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=1,
        ).strip()
    except Exception:
        return None


def _health_item(ok: bool, detail: str, **extra) -> dict:
    return {"ok": bool(ok), "detail": detail, **extra}


async def _write_auth_admin_event(
    db,
    request: Request,
    *,
    event_type: str,
    actor_role: str,
    target_user_id: str | None,
    email: str | None,
    status: str | None,
    role: str | None = None,
    metadata: dict | None = None,
) -> None:
    actor_user_id = getattr(request.state, "auth_user_id", None)
    await db.execute(
        """
        INSERT INTO auth_events (
            event_type, actor_user_id, target_user_id, role, email, status, ip, user_agent,
            request_id, metadata
        )
        VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10::jsonb)
        """,
        event_type,
        actor_user_id,
        target_user_id,
        role or actor_role,
        email,
        status,
        _client_ip(request),
        request.headers.get("user-agent", ""),
        getattr(request.state, "request_id", None),
        json.dumps({"actor_role": actor_role, **(metadata or {})}),
    )


async def _enrich_history_rows(pool, records: list[dict]) -> list[dict]:
    ids_by_source: dict[str, list[str]] = {}
    for record in records:
        source = record.get("source_table")
        teable_id = record.get("teable_id")
        if source and teable_id:
            ids_by_source.setdefault(source, []).append(teable_id)

    lookup: dict[tuple[str, str], dict] = {}

    async def _fetch(source: str, query: str):
        ids = list(dict.fromkeys(ids_by_source.get(source, [])))
        if not ids:
            return
        rows = await pool.fetch(query, ids)
        for row in rows:
            data = _row_to_dict(row)
            lookup[(source, data["teable_id"])] = data

    await _fetch(
        "projects",
        """
        SELECT teable_id, project_name, client, status
        FROM projects_mirror
        WHERE teable_id = ANY($1::varchar[])
        """,
    )
    await _fetch(
        "invoices",
        """
        SELECT teable_id, invoice_number, project, payment_status
        FROM invoices_mirror
        WHERE teable_id = ANY($1::varchar[])
        """,
    )
    await _fetch(
        "web_invoices",
        """
        SELECT teable_id, invoice_number, project, payment_status
        FROM web_invoices_mirror
        WHERE teable_id = ANY($1::varchar[])
        """,
    )
    await _fetch(
        "status",
        """
        SELECT teable_id, project, client, short_status
        FROM status_mirror
        WHERE teable_id = ANY($1::varchar[])
        """,
    )

    for record in records:
        source = record.get("source_table")
        teable_id = record.get("teable_id")
        meta = lookup.get((source, teable_id), {})
        label = teable_id
        subtitle = None
        navigate_kind = None
        navigate_target = None
        if source == "projects":
            label = meta.get("project_name") or teable_id
            subtitle = " · ".join([p for p in [meta.get("client"), meta.get("status")] if p]) or None
            navigate_kind = "app"
            navigate_target = f"/projects/{teable_id}"
        elif source == "invoices":
            label = meta.get("invoice_number") or teable_id
            subtitle = " · ".join([p for p in [meta.get("project"), meta.get("payment_status")] if p]) or None
            navigate_kind = "admin-invoices"
            navigate_target = json.dumps({"source": "main", "teable_id": teable_id})
        elif source == "web_invoices":
            label = meta.get("invoice_number") or teable_id
            subtitle = " · ".join([p for p in [meta.get("project"), meta.get("payment_status")] if p]) or None
            navigate_kind = "admin-invoices"
            navigate_target = json.dumps({"source": "web", "teable_id": teable_id})
        elif source == "status":
            label = meta.get("project") or teable_id
            subtitle = " · ".join([p for p in [meta.get("client"), meta.get("short_status")] if p]) or None
            navigate_kind = "app"
            navigate_target = f"/status?record={teable_id}"

        record["record_label"] = label
        record["record_subtitle"] = subtitle
        record["navigate_kind"] = navigate_kind
        record["navigate_target"] = navigate_target

    return records


@router.get("/shared-links")
async def admin_shared_links(
    resource_type: Optional[str] = Query(None),
    _: str = Depends(require_admin),
):
    svc = SharedViewService()
    views = await svc.list_all(resource_type=resource_type)
    return {"views": views, "total": len(views)}


@router.get("/shared-links/{token}/accesses")
async def admin_shared_link_accesses(
    token: str,
    limit: int = Query(200, ge=1, le=500),
    _: str = Depends(require_admin),
):
    svc = SharedViewService()
    accesses = await svc.get_accesses(token, limit=limit)
    return {"accesses": accesses, "total": len(accesses)}


@router.get("/shared-links/{token}/stats")
async def admin_shared_link_stats(token: str, _: str = Depends(require_admin)):
    """Aggregated analytics for a single shared link."""
    svc = SharedViewService()
    return await svc.get_accesses_stats(token)


@router.get("/insight-configs")
async def admin_insight_configs(
    page_key: Optional[str] = Query(None),
    config_kind: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    _: str = Depends(require_admin),
):
    pool = get_pool()
    if not pool:
        return _no_db()
    where = ["1=1"]
    params: list = []
    idx = 1
    if page_key:
        where.append(f"page_key = ${idx}")
        params.append(page_key)
        idx += 1
    if config_kind:
        where.append(f"config_kind = ${idx}")
        params.append(config_kind)
        idx += 1
    params.append(limit)
    rows = await pool.fetch(
        f"""
        SELECT id, created_at, updated_at, page_key, config_kind, title, role, ip, is_active, config
        FROM insight_configs
        WHERE {' AND '.join(where)}
        ORDER BY updated_at DESC
        LIMIT ${idx}
        """,
        *params,
    )
    return {"configs": [_row_to_dict(row) for row in rows], "total": len(rows)}


@router.get("/insight-exports")
async def admin_insight_exports(
    page_key: Optional[str] = Query(None),
    export_format: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    _: str = Depends(require_admin),
):
    pool = get_pool()
    if not pool:
        return _no_db()
    where = ["1=1"]
    params: list = []
    idx = 1
    if page_key:
        where.append(f"page_key = ${idx}")
        params.append(page_key)
        idx += 1
    if export_format:
        where.append(f"export_format = ${idx}")
        params.append(export_format)
        idx += 1
    params.append(limit)
    rows = await pool.fetch(
        f"""
        SELECT id, created_at, page_key, source_key, export_format, title, role, ip, config_id, column_count, row_count, columns, filters, metadata
        FROM insight_exports
        WHERE {' AND '.join(where)}
        ORDER BY created_at DESC
        LIMIT ${idx}
        """,
        *params,
    )
    return {"exports": [_row_to_dict(row) for row in rows], "total": len(rows)}


# ── Auth master controls ──────────────────────────────────────────────────────

@router.get("/auth/roles")
async def admin_auth_roles(_: str = Depends(require_admin)):
    pool = get_pool()
    if not pool:
        return _no_db()
    rows = await pool.fetch(
        """
        SELECT r.id::text AS id, r.role_key, r.label, r.description, r.rank, r.is_system,
               COUNT(rp.permission_id)::int AS permission_count
        FROM auth_roles r
        LEFT JOIN auth_role_permissions rp ON rp.role_id = r.id
        GROUP BY r.id
        ORDER BY r.rank ASC, r.role_key ASC
        """
    )
    return {"roles": [_row_to_dict(row) for row in rows], "total": len(rows)}


@router.get("/auth/users")
async def admin_auth_users(
    user_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    role_key: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _: str = Depends(require_admin),
):
    pool = get_pool()
    if not pool:
        return _no_db()

    where = ["1=1"]
    params: list = []
    idx = 1
    if user_id:
        where.append(f"u.id = ${idx}::uuid")
        params.append(user_id)
        idx += 1
    if status:
        where.append(f"u.status = ${idx}")
        params.append(status)
        idx += 1
    if role_key:
        where.append(
            f"""
            EXISTS (
                SELECT 1
                FROM auth_user_roles urx
                JOIN auth_roles rx ON rx.id = urx.role_id
                WHERE urx.user_id = u.id AND rx.role_key = ${idx}
            )
            """
        )
        params.append(role_key)
        idx += 1
    if search:
        where.append(f"(u.email ILIKE ${idx} OR COALESCE(u.full_name, '') ILIKE ${idx} OR COALESCE(u.teable_email, '') ILIKE ${idx})")
        params.append(f"%{search.strip()}%")
        idx += 1
    where_sql = " AND ".join(where)

    total = await pool.fetchval(f"SELECT COUNT(*) FROM auth_users u WHERE {where_sql}", *params)
    rows = await pool.fetch(
        f"""
        WITH role_agg AS (
            SELECT ur.user_id, ARRAY_AGG(r.role_key ORDER BY r.rank ASC, r.role_key ASC) AS roles
            FROM auth_user_roles ur
            JOIN auth_roles r ON r.id = ur.role_id
            GROUP BY ur.user_id
        ),
        session_agg AS (
            SELECT user_id,
                   COUNT(*)::int AS session_count,
                   COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at > NOW())::int AS active_session_count,
                   MAX(last_seen_at) AS last_seen_at
            FROM auth_sessions
            GROUP BY user_id
        ),
        event_agg AS (
            SELECT target_user_id AS user_id,
                   MAX(created_at) AS last_event_at,
                   COUNT(*)::int AS auth_event_count
            FROM auth_events
            WHERE target_user_id IS NOT NULL
            GROUP BY target_user_id
        ),
        audit_agg AS (
            SELECT (extra->>'auth_user_id')::uuid AS user_id,
                   COUNT(*)::int AS audit_request_count,
                   MAX(ts) AS last_request_at
            FROM audit_log
            WHERE extra ? 'auth_user_id'
            GROUP BY (extra->>'auth_user_id')::uuid
        )
        SELECT u.id::text AS id, u.email, u.full_name, u.status, u.created_at, u.updated_at,
               u.approved_at, u.disabled_at, u.email_verified_at, u.teable_email,
               u.phone, u.job_title, u.department, u.company, u.location, u.timezone,
               (
                 SELECT COALESCE(
                   NULLIF(ai.raw_profile->>'picture', ''),
                   NULLIF(ai.raw_profile->>'avatar_url', '')
                 )
                 FROM auth_identities ai
                 WHERE ai.user_id = u.id
                 ORDER BY
                   CASE WHEN ai.provider = 'google' THEN 0 ELSE 1 END,
                   ai.last_seen_at DESC NULLS LAST
                 LIMIT 1
               ) AS avatar_url,
               COALESCE(role_agg.roles, ARRAY[]::text[]) AS roles,
               COALESCE(session_agg.session_count, 0) AS session_count,
               COALESCE(session_agg.active_session_count, 0) AS active_session_count,
               session_agg.last_seen_at,
               event_agg.last_event_at,
               COALESCE(event_agg.auth_event_count, 0) AS auth_event_count,
               COALESCE(audit_agg.audit_request_count, 0) AS audit_request_count,
               audit_agg.last_request_at
        FROM auth_users u
        LEFT JOIN role_agg ON role_agg.user_id = u.id
        LEFT JOIN session_agg ON session_agg.user_id = u.id
        LEFT JOIN event_agg ON event_agg.user_id = u.id
        LEFT JOIN audit_agg ON audit_agg.user_id = u.id
        WHERE {where_sql}
        ORDER BY
          CASE u.status
            WHEN 'pending_approval' THEN 0
            WHEN 'active' THEN 1
            WHEN 'disabled' THEN 2
            WHEN 'rejected' THEN 3
            ELSE 4
          END,
          u.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
        limit,
        offset,
    )
    return {"rows": [_row_to_dict(row) for row in rows], "total": int(total or 0), "limit": limit, "offset": offset}


@router.post("/auth/users")
async def admin_create_auth_user(
    body: AuthUserCreate,
    request: Request,
    actor_role: str = Depends(require_admin),
):
    from ..services.auth_master import create_admin_invited_user

    result = await create_admin_invited_user(
        email=body.email,
        full_name=body.full_name,
        role_key=body.role_key,
        status=body.status,
        send_invite=body.send_invite,
        request=request,
        actor_role=actor_role,
    )
    return {
        **result,
        "message": "User created" + (" and invite email queued" if body.send_invite else ""),
    }


async def _get_role_id(conn, role_key: str):
    role_id = await conn.fetchval("SELECT id FROM auth_roles WHERE role_key = $1", role_key)
    if not role_id:
        raise HTTPException(status_code=422, detail=f"Unknown auth role: {role_key}")
    return role_id


@router.patch("/auth/users/{user_id}/approve")
async def admin_approve_auth_user(
    user_id: str,
    body: AuthUserDecision,
    request: Request,
    actor_role: str = Depends(require_admin),
):
    pool = get_pool()
    if not pool:
        return _no_db()
    role_key = body.role_key or "user"
    async with pool.acquire() as conn:
        async with conn.transaction():
            role_id = await _get_role_id(conn, role_key)
            user = await conn.fetchrow(
                """
                UPDATE auth_users
                SET status = 'active',
                    approved_at = COALESCE(approved_at, NOW()),
                    disabled_at = NULL,
                    full_name = COALESCE(NULLIF($2, ''), full_name),
                    updated_at = NOW()
                WHERE id = $1::uuid
                RETURNING id::text AS id, email, status
                """,
                user_id,
                (body.full_name or "").strip(),
            )
            if not user:
                raise HTTPException(status_code=404, detail="Auth user not found")
            await conn.execute("DELETE FROM auth_user_roles WHERE user_id = $1::uuid", user_id)
            await conn.execute(
                "INSERT INTO auth_user_roles (user_id, role_id) VALUES ($1::uuid, $2)",
                user_id,
                role_id,
            )
            await _write_auth_admin_event(
                conn,
                request,
                event_type="admin_user_approved",
                actor_role=actor_role,
                target_user_id=user_id,
                email=user["email"],
                status=user["status"],
                role=role_key,
                metadata={"reason": body.reason},
            )
    try:
        from ..services.auth_master import send_user_approved_email
        delivery = await send_user_approved_email(user["email"], request)
        if not delivery.get("sent"):
            logger.warning("Approval email was not sent for %s: %s", user["email"], delivery.get("reason"))
    except Exception as exc:
        logger.warning("Approval email failed for %s: %s", user["email"], exc)
    return {"status": "active", "role_key": role_key, "message": "User approved"}


@router.patch("/auth/users/{user_id}/reject")
async def admin_reject_auth_user(
    user_id: str,
    body: AuthUserDecision,
    request: Request,
    actor_role: str = Depends(require_admin),
):
    pool = get_pool()
    if not pool:
        return _no_db()
    async with pool.acquire() as conn:
        async with conn.transaction():
            user = await conn.fetchrow(
                """
                UPDATE auth_users
                SET status = 'rejected', disabled_at = NOW(), updated_at = NOW()
                WHERE id = $1::uuid
                RETURNING id::text AS id, email, status
                """,
                user_id,
            )
            if not user:
                raise HTTPException(status_code=404, detail="Auth user not found")
            await conn.execute(
                "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = $1::uuid",
                user_id,
            )
            await _write_auth_admin_event(
                conn,
                request,
                event_type="admin_user_rejected",
                actor_role=actor_role,
                target_user_id=user_id,
                email=user["email"],
                status=user["status"],
                metadata={"reason": body.reason},
            )
    return {"status": "rejected", "message": "User rejected and sessions revoked"}


@router.patch("/auth/users/{user_id}/disable")
async def admin_disable_auth_user(
    user_id: str,
    body: AuthUserDecision,
    request: Request,
    actor_role: str = Depends(require_admin),
):
    pool = get_pool()
    if not pool:
        return _no_db()
    async with pool.acquire() as conn:
        async with conn.transaction():
            user = await conn.fetchrow(
                """
                UPDATE auth_users
                SET status = 'disabled', disabled_at = NOW(), updated_at = NOW()
                WHERE id = $1::uuid
                RETURNING id::text AS id, email, status
                """,
                user_id,
            )
            if not user:
                raise HTTPException(status_code=404, detail="Auth user not found")
            await conn.execute(
                "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = $1::uuid",
                user_id,
            )
            await _write_auth_admin_event(
                conn,
                request,
                event_type="admin_user_disabled",
                actor_role=actor_role,
                target_user_id=user_id,
                email=user["email"],
                status=user["status"],
                metadata={"reason": body.reason},
            )
    return {"status": "disabled", "message": "User disabled and sessions revoked"}


@router.patch("/auth/users/{user_id}/reactivate")
async def admin_reactivate_auth_user(
    user_id: str,
    body: AuthUserDecision,
    request: Request,
    actor_role: str = Depends(require_admin),
):
    pool = get_pool()
    if not pool:
        return _no_db()
    role_key = body.role_key
    async with pool.acquire() as conn:
        async with conn.transaction():
            role_id = await _get_role_id(conn, role_key) if role_key else None
            user = await conn.fetchrow(
                """
                UPDATE auth_users
                SET status = 'active',
                    approved_at = COALESCE(approved_at, NOW()),
                    disabled_at = NULL,
                    full_name = COALESCE(NULLIF($2, ''), full_name),
                    updated_at = NOW()
                WHERE id = $1::uuid
                RETURNING id::text AS id, email, status
                """,
                user_id,
                (body.full_name or "").strip(),
            )
            if not user:
                raise HTTPException(status_code=404, detail="Auth user not found")
            if role_id:
                await conn.execute("DELETE FROM auth_user_roles WHERE user_id = $1::uuid", user_id)
                await conn.execute(
                    "INSERT INTO auth_user_roles (user_id, role_id) VALUES ($1::uuid, $2)",
                    user_id,
                    role_id,
                )
            await _write_auth_admin_event(
                conn,
                request,
                event_type="admin_user_reactivated",
                actor_role=actor_role,
                target_user_id=user_id,
                email=user["email"],
                status=user["status"],
                role=role_key,
                metadata={"reason": body.reason},
            )
    try:
        from ..services.auth_master import send_user_approved_email
        delivery = await send_user_approved_email(user["email"], request)
        if not delivery.get("sent"):
            logger.warning("Reactivation email was not sent for %s: %s", user["email"], delivery.get("reason"))
    except Exception as exc:
        logger.warning("Reactivation email failed for %s: %s", user["email"], exc)
    return {"status": "active", "role_key": role_key, "message": "User reactivated"}


@router.patch("/auth/users/{user_id}/role")
async def admin_update_auth_user_role(
    user_id: str,
    body: AuthUserRoleUpdate,
    request: Request,
    actor_role: str = Depends(require_admin),
):
    pool = get_pool()
    if not pool:
        return _no_db()
    role_key = (body.role_key or "").strip().lower()
    async with pool.acquire() as conn:
        async with conn.transaction():
            role_id = await _get_role_id(conn, role_key)
            user = await conn.fetchrow(
                "SELECT id::text AS id, email, status FROM auth_users WHERE id = $1::uuid",
                user_id,
            )
            if not user:
                raise HTTPException(status_code=404, detail="Auth user not found")
            await conn.execute("DELETE FROM auth_user_roles WHERE user_id = $1::uuid", user_id)
            await conn.execute(
                "INSERT INTO auth_user_roles (user_id, role_id) VALUES ($1::uuid, $2)",
                user_id,
                role_id,
            )
            revoked = 0
            if body.revoke_sessions:
                revoked = await conn.fetchval(
                    """
                    WITH changed AS (
                      UPDATE auth_sessions
                      SET revoked_at = NOW()
                      WHERE user_id = $1::uuid
                        AND revoked_at IS NULL
                        AND expires_at > NOW()
                      RETURNING id
                    )
                    SELECT COUNT(*) FROM changed
                    """,
                    user_id,
                )
            await _write_auth_admin_event(
                conn,
                request,
                event_type="admin_user_role_updated",
                actor_role=actor_role,
                target_user_id=user_id,
                email=user["email"],
                status=user["status"],
                role=role_key,
                metadata={
                    "reason": body.reason,
                    "revoked_sessions": int(revoked or 0),
                    "revoke_sessions": body.revoke_sessions,
                },
            )
    return {
        "status": user["status"],
        "role_key": role_key,
        "revoked_sessions": int(revoked or 0),
        "message": "User role updated; active sessions revoked" if body.revoke_sessions else "User role updated",
    }


@router.post("/auth/users/{user_id}/sessions/revoke")
async def admin_revoke_auth_user_sessions(
    user_id: str,
    request: Request,
    actor_role: str = Depends(require_admin),
):
    pool = get_pool()
    if not pool:
        return _no_db()
    async with pool.acquire() as conn:
        user = await conn.fetchrow("SELECT id::text AS id, email, status FROM auth_users WHERE id = $1::uuid", user_id)
        if not user:
            raise HTTPException(status_code=404, detail="Auth user not found")
        count = await conn.fetchval(
            """
            WITH changed AS (
              UPDATE auth_sessions
              SET revoked_at = NOW()
              WHERE user_id = $1::uuid
                AND revoked_at IS NULL
                AND expires_at > NOW()
              RETURNING id
            )
            SELECT COUNT(*) FROM changed
            """,
            user_id,
        )
        await _write_auth_admin_event(
            conn,
            request,
            event_type="admin_user_sessions_revoked",
            actor_role=actor_role,
            target_user_id=user_id,
            email=user["email"],
            status=user["status"],
            metadata={"revoked_count": int(count or 0)},
        )
    return {"revoked": int(count or 0), "message": f"Revoked {int(count or 0)} active auth session(s)"}


class AuthUserNameUpdate(BaseModel):
    full_name: Optional[str] = None


@router.patch("/auth/users/{user_id}/name")
async def admin_update_auth_user_name(
    user_id: str,
    body: AuthUserNameUpdate,
    request: Request,
    actor_role: str = Depends(require_admin),
):
    """Update a user's display name from the admin panel."""
    pool = get_pool()
    if not pool:
        return _no_db()
    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            "UPDATE auth_users SET full_name = $1, updated_at = NOW() WHERE id = $2::uuid RETURNING id::text AS id, email, full_name, status",
            (body.full_name or "").strip() or None,
            user_id,
        )
        if not user:
            raise HTTPException(status_code=404, detail="Auth user not found")
        await _write_auth_admin_event(
            conn, request,
            event_type="admin_user_name_updated",
            actor_role=actor_role,
            target_user_id=user_id,
            email=user["email"],
            status=user["status"],
            metadata={"full_name": user["full_name"]},
        )
    return {"ok": True, "full_name": user["full_name"]}


class AuthUserTeableEmail(BaseModel):
    teable_email: Optional[str] = None


@router.patch("/auth/users/{user_id}/teable-email")
async def admin_set_teable_email(
    user_id: str,
    body: AuthUserTeableEmail,
    request: Request,
    actor_role: str = Depends(require_admin),
):
    """
    Set the Teable 'Raised By' email for a user.
    This controls which records they see in the web invoice module.
    Leave blank to use their login email.
    """
    pool = get_pool()
    if not pool:
        return _no_db()
    teable_email = (body.teable_email or "").strip() or None
    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            "UPDATE auth_users SET teable_email = $1, updated_at = NOW() WHERE id = $2::uuid "
            "RETURNING id::text AS id, email, teable_email, status",
            teable_email,
            user_id,
        )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        await _write_auth_admin_event(
            conn, request,
            event_type="admin_user_teable_email_set",
            actor_role=actor_role,
            target_user_id=user_id,
            email=user["email"],
            status=user["status"],
            metadata={"teable_email": teable_email},
        )
    return {"ok": True, "teable_email": user["teable_email"]}


@router.delete("/auth/users/{user_id}")
async def admin_delete_auth_user(
    user_id: str,
    request: Request,
    force: bool = False,
    actor_role: str = Depends(require_admin),
):
    """
    Permanently delete a user and all related records.
    Use force=true to delete an active user (will revoke all their sessions first).
    """
    pool = get_pool()
    if not pool:
        return _no_db()
    async with pool.acquire() as conn:
        async with conn.transaction():
            user = await conn.fetchrow(
                "SELECT id::text AS id, email, status FROM auth_users WHERE id = $1::uuid",
                user_id,
            )
            if not user:
                raise HTTPException(status_code=404, detail="Auth user not found")
            if user["status"] == "active" and not force:
                raise HTTPException(
                    status_code=409,
                    detail="User is active. Disable them first, or pass force=true to delete immediately."
                )
            # Write deletion audit event — uses correct `role` column (not actor_role).
            # Must succeed: if audit write fails we abort the whole transaction so
            # deletes are never silent. A separate pool connection avoids FK conflicts.
            await conn.execute(
                """INSERT INTO auth_events
                   (event_type, role, target_user_id, email, status, ip, user_agent, metadata)
                   VALUES ($1, $2, $3::uuid, $4, $5, $6, $7, $8::jsonb)""",
                "admin_user_deleted",
                actor_role,
                user_id,
                user["email"],
                user["status"],
                request.client.host if request.client else None,
                request.headers.get("user-agent", ""),
                json.dumps({"deleted_by": actor_role, "forced": force}),
            )
            # Cascade delete in dependency order
            await conn.execute("DELETE FROM auth_sessions         WHERE user_id = $1::uuid", user_id)
            await conn.execute("DELETE FROM auth_user_roles       WHERE user_id = $1::uuid", user_id)
            await conn.execute("DELETE FROM auth_user_scopes      WHERE user_id = $1::uuid", user_id)
            await conn.execute("DELETE FROM auth_identities       WHERE user_id = $1::uuid", user_id)
            await conn.execute("DELETE FROM auth_password_resets  WHERE user_id = $1::uuid", user_id)
            await conn.execute("DELETE FROM auth_users            WHERE id = $1::uuid", user_id)
    return {"deleted": True, "email": user["email"]}


# ── User timeline ─────────────────────────────────────────────────────────────

@router.get("/auth/users/{user_id}/timeline")
async def admin_user_timeline(
    user_id: str,
    limit: int = Query(100, ge=1, le=500),
    _: str = Depends(require_admin),
):
    """Full chronological event timeline for a user: logins, invites, role changes, resets, etc."""
    pool = get_pool()
    if not pool:
        return _no_db()
    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            """
            SELECT
                u.id::text,
                u.email,
                u.full_name,
                u.status,
                u.teable_email,
                COALESCE(
                    u.avatar_url,
                    (
                        SELECT COALESCE(
                            NULLIF(ai.raw_profile->>'picture', ''),
                            NULLIF(ai.raw_profile->>'avatar_url', '')
                        )
                        FROM auth_identities ai
                        WHERE ai.user_id = u.id
                        ORDER BY
                            CASE WHEN ai.provider = 'google' THEN 0 ELSE 1 END,
                            ai.last_seen_at DESC NULLS LAST
                        LIMIT 1
                    )
                ) AS avatar_url
            FROM auth_users u
            WHERE u.id = $1::uuid
            """,
            user_id,
        )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        events = await conn.fetch(
            """
            SELECT
                ae.id, ae.created_at, ae.event_type, ae.role, ae.email,
                ae.status, ae.ip, ae.user_agent, ae.metadata::text AS metadata,
                actor.email AS actor_email, actor.full_name AS actor_name
            FROM auth_events ae
            LEFT JOIN auth_users actor ON actor.id = ae.actor_user_id
            WHERE ae.target_user_id = $1::uuid OR ae.email = $2
            ORDER BY ae.created_at DESC
            LIMIT $3
            """,
            user_id, user["email"], limit,
        )
        sessions = await conn.fetch(
            """
            SELECT id::text, created_at, last_seen_at, expires_at, revoked_at,
                   ip, os, browser, device, country, city, device_label, request_count
            FROM auth_sessions
            WHERE user_id = $1::uuid
            ORDER BY created_at DESC
            LIMIT 50
            """,
            user_id,
        )
        audit_count = await conn.fetchval(
            "SELECT COUNT(*) FROM audit_log WHERE user_id = $1::uuid",
            user_id,
        )

    timeline = []
    for e in events:
        d = _row_to_dict(e)
        try:
            d["metadata"] = json.loads(d.get("metadata") or "{}")
        except Exception:
            d["metadata"] = {}
        timeline.append(d)

    return {
        "user": _row_to_dict(user),
        "timeline": timeline,
        "sessions": [_row_to_dict(s) for s in sessions],
        "audit_request_count": int(audit_count or 0),
    }


@router.get("/auth/users/{user_id}/timeline/export")
async def admin_user_timeline_export(
    user_id: str,
    fmt: str = Query("csv", description="csv or json"),
    _: str = Depends(require_admin),
):
    """Export a user's full auth event timeline as CSV or JSON."""
    from fastapi.responses import Response
    pool = get_pool()
    if not pool:
        return _no_db()

    user = await pool.fetchrow(
        "SELECT id::text, email, full_name FROM auth_users WHERE id = $1::uuid",
        user_id,
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    events = await pool.fetch(
        """
        SELECT ae.created_at, ae.event_type, ae.role, ae.email, ae.status,
               ae.ip, ae.user_agent, ae.metadata::text AS metadata,
               actor.email AS actor_email
        FROM auth_events ae
        LEFT JOIN auth_users actor ON actor.id = ae.actor_user_id
        WHERE ae.target_user_id = $1::uuid OR ae.email = $2
        ORDER BY ae.created_at DESC
        LIMIT 5000
        """,
        user_id, user["email"],
    )

    safe_email = (user["email"] or "user").replace("@", "_at_").replace(".", "_")
    filename = f"timeline_{safe_email}.{fmt}"

    if fmt == "json":
        rows = []
        for e in events:
            d = _row_to_dict(e)
            try:
                d["metadata"] = json.loads(d.get("metadata") or "{}")
            except Exception:
                d["metadata"] = {}
            rows.append(d)
        return Response(
            content=json.dumps({"user": _row_to_dict(user), "events": rows}, default=str),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    # CSV
    import csv, io
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["timestamp", "event_type", "role", "email", "status", "ip", "actor_email", "metadata"])
    for e in events:
        writer.writerow([
            e["created_at"].isoformat() if e["created_at"] else "",
            e["event_type"] or "",
            e["role"] or "",
            e["email"] or "",
            e["status"] or "",
            e["ip"] or "",
            e["actor_email"] or "",
            e["metadata"] or "",
        ])
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Resend invite ─────────────────────────────────────────────────────────────

@router.post("/auth/users/{user_id}/resend-invite")
async def admin_resend_invite(
    user_id: str,
    request: Request,
    actor_role: str = Depends(require_admin),
):
    """Generate a fresh invite link and email it to the user."""
    pool = get_pool()
    if not pool:
        return _no_db()
    import secrets as _secrets
    from ..services.auth_master import _hash_reset_token
    from ..services.emailer import email_wrap_html, send_email, app_origin_from_request
    from urllib.parse import urlencode
    from datetime import datetime, timezone, timedelta

    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT id::text AS id, email, full_name, status FROM auth_users WHERE id = $1::uuid",
            user_id,
        )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        if user["status"] not in ("active", "pending_approval"):
            raise HTTPException(status_code=409, detail="Can only resend invite to active or pending users")

        # Revoke old reset tokens and create a fresh one
        await conn.execute(
            "UPDATE auth_password_resets SET used_at = NOW() WHERE user_id = $1::uuid AND used_at IS NULL",
            user_id,
        )
        token = _secrets.token_urlsafe(36)
        token_hash = _hash_reset_token(token)
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.password_reset_ttl_minutes)
        await conn.execute(
            """INSERT INTO auth_password_resets (user_id, token_hash, expires_at, ip, user_agent)
               VALUES ($1::uuid, $2, $3, $4, $5)""",
            user_id, token_hash, expires_at,
            request.client.host if request.client else None,
            request.headers.get("user-agent", ""),
        )
        await _write_auth_admin_event(
            conn, request,
            event_type="admin_invite_resent",
            actor_role=actor_role,
            target_user_id=user_id,
            email=user["email"],
            status=user["status"],
        )

    origin = app_origin_from_request(request)
    invite_params = urlencode({"reset_token": token, "invite": "1", "email": user["email"]})
    invite_url = f"{origin}/login?{invite_params}" if origin else f"/login?{invite_params}"

    hi_name = f"Hi {(user['full_name'] or '').strip()}" if user["full_name"] else "Hi"
    delivery = await send_email(
        user["email"],
        "Your updated FinTrack invite link",
        (
            f"{hi_name},\n\n"
            f"Here is your refreshed FinTrack invite link. It expires in {settings.password_reset_ttl_minutes} minutes:\n\n"
            f"{invite_url}\n\nIf you were not expecting this, ignore this email."
        ),
        html=email_wrap_html(
            title="Your updated FinTrack invite link",
            preheader=f"A fresh invite link — expires in {settings.password_reset_ttl_minutes} minutes.",
            to_email=user["email"],
            body_html=(
                f"<h2 style=\"margin:0 0 16px;font-size:18px;font-weight:700\">{hi_name},</h2>"
                f"<p style=\"margin:0 0 12px\">Here is your updated FinTrack invite link.</p>"
                f"<p style=\"margin:0 0 20px\">This link expires in <strong>{settings.password_reset_ttl_minutes} minutes</strong>.</p>"
                f"<a href=\"{invite_url}\" style=\"display:inline-block;padding:12px 22px;background:#2563eb;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px\">Set password &amp; sign in</a>"
                f"<p style=\"margin:20px 0 0;font-size:13px;color:#6b7280\">If you were not expecting this, you can safely ignore this email.</p>"
            ),
        ),
    )
    return {"ok": True, "delivery": delivery, "invite_url": invite_url if not delivery.get("sent") else None}


# ── Force password reset ──────────────────────────────────────────────────────

@router.post("/auth/users/{user_id}/force-password-reset")
async def admin_force_password_reset(
    user_id: str,
    request: Request,
    actor_role: str = Depends(require_admin),
):
    """Revoke all sessions and send a password-reset link to the user."""
    pool = get_pool()
    if not pool:
        return _no_db()
    import secrets as _secrets
    from ..services.auth_master import _hash_reset_token
    from ..services.emailer import email_wrap_html, send_email, app_origin_from_request
    from urllib.parse import urlencode
    from datetime import datetime, timezone, timedelta

    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT id::text AS id, email, full_name, status FROM auth_users WHERE id = $1::uuid",
            user_id,
        )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        if user["status"] != "active":
            raise HTTPException(status_code=409, detail="Can only force reset for active users")

        # Revoke all active sessions
        revoked = await conn.fetchval(
            "WITH changed AS (UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = $1::uuid AND revoked_at IS NULL RETURNING id) SELECT COUNT(*) FROM changed",
            user_id,
        )
        token = _secrets.token_urlsafe(36)
        token_hash = _hash_reset_token(token)
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.password_reset_ttl_minutes)
        await conn.execute(
            """INSERT INTO auth_password_resets (user_id, token_hash, expires_at, ip, user_agent)
               VALUES ($1::uuid, $2, $3, $4, $5)""",
            user_id, token_hash, expires_at,
            request.client.host if request.client else None,
            request.headers.get("user-agent", ""),
        )
        await _write_auth_admin_event(
            conn, request,
            event_type="admin_force_password_reset",
            actor_role=actor_role,
            target_user_id=user_id,
            email=user["email"],
            status=user["status"],
            metadata={"sessions_revoked": int(revoked or 0)},
        )

    origin = app_origin_from_request(request)
    reset_params = urlencode({"reset_token": token, "email": user["email"]})
    reset_url = f"{origin}/login?{reset_params}" if origin else f"/login?{reset_params}"

    delivery = await send_email(
        user["email"],
        "Your FinTrack password needs to be reset",
        (
            f"An admin has initiated a password reset for your FinTrack account.\n\n"
            f"All your active sessions have been revoked. Use this link to set a new password:\n\n"
            f"{reset_url}\n\nThis link expires in {settings.password_reset_ttl_minutes} minutes."
        ),
        html=email_wrap_html(
            title="Password reset required",
            preheader="An admin has reset your FinTrack account — use the link to set a new password.",
            to_email=user["email"],
            body_html=(
                f"<h2 style=\"margin:0 0 16px;font-size:18px;font-weight:700\">Password reset required</h2>"
                f"<p style=\"margin:0 0 12px\">An admin has initiated a password reset for your FinTrack account. All active sessions have been revoked.</p>"
                f"<p style=\"margin:0 0 20px\">Use the button below to set a new password. This link expires in <strong>{settings.password_reset_ttl_minutes} minutes</strong>.</p>"
                f"<a href=\"{reset_url}\" style=\"display:inline-block;padding:12px 22px;background:#dc2626;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px\">Set new password</a>"
                f"<p style=\"margin:20px 0 0;font-size:13px;color:#6b7280\">If you did not expect this, contact the workspace admin immediately.</p>"
            ),
        ),
    )
    return {"ok": True, "sessions_revoked": int(revoked or 0), "delivery": delivery}


# ── Deployment health ─────────────────────────────────────────────────────────

@router.get("/deployment-health")
async def deployment_health(_: str = Depends(require_admin)):
    """Full system readiness check for the deployment checklist."""
    from ..db.postgres import get_pool as _pg, get_init_error
    from ..db import valkey as _vk
    from ..services.emailer import is_email_configured
    from ..config import settings as s
    from ..db.sync import _BASE_PARAMS, _all_tokens

    results: dict = {}
    pool = _pg()

    # PostgreSQL
    if pool:
        try:
            await pool.fetchval("SELECT 1")
            results["postgres"] = _health_item(True, "Connected")
        except Exception as exc:
            results["postgres"] = _health_item(False, str(exc))
    else:
        results["postgres"] = _health_item(False, get_init_error() or "Not configured")

    # Valkey / Redis
    try:
        vk = _vk.get_client()
        if vk:
            await vk.ping()
            results["valkey"] = _health_item(True, "Connected")
        else:
            results["valkey"] = _health_item(False, "Not configured (VALKEY_URL missing)")
    except Exception as exc:
        results["valkey"] = _health_item(False, str(exc))

    # Teable — check every configured operational table with any configured token.
    teable_tables = {
        "projects": s.teable_table_id,
        "invoices": s.teable_invoice_table_id,
        "web_invoices": s.teable_web_invoice_table_id,
        "status": s.teable_status_table_id,
    }
    table_checks: dict[str, dict] = {}
    tokens = _all_tokens()
    async def _check_teable_table(name: str, table_id: str | None):
        if not table_id:
            table_checks[name] = _health_item(False, "Table ID not configured")
            return
        if not tokens:
            table_checks[name] = _health_item(False, "No Teable token configured")
            return
        best_error = "No successful token"
        async with httpx.AsyncClient(timeout=5) as client:
            for token in tokens:
                try:
                    r = await client.get(
                        f"{s.teable_base_url.rstrip('/')}/api/table/{table_id}/record",
                        headers={"Authorization": f"Bearer {token}"},
                        params={**_BASE_PARAMS, "take": 1},
                    )
                    if r.status_code < 400:
                        table_checks[name] = _health_item(True, f"HTTP {r.status_code}", table_id=table_id)
                        return
                    best_error = f"HTTP {r.status_code}"
                except Exception as exc:
                    best_error = str(exc)[:180]
        table_checks[name] = _health_item(False, best_error, table_id=table_id)

    try:
        await asyncio.gather(*[_check_teable_table(name, table_id) for name, table_id in teable_tables.items()])
        results["teable"] = _health_item(
            all(item.get("ok") for item in table_checks.values()),
            "All configured tables reachable" if all(item.get("ok") for item in table_checks.values()) else "One or more tables failed",
            tables=table_checks,
        )
    except Exception as exc:
        results["teable"] = _health_item(False, str(exc), tables=table_checks)

    # Email (Brevo)
    results["email"] = {
        "ok": is_email_configured(),
        "detail": "Brevo configured" if is_email_configured() else "BREVOAPIKEY not set",
    }

    results["openrouter"] = _health_item(
        bool(s.openrouter_api_key),
        f"Configured model: {s.openrouter_model}" if s.openrouter_api_key else "OPENROUTER_API_KEY not set",
        model=s.openrouter_model,
    )

    google_sso_ok = bool(s.google_client_id and s.google_client_secret and s.frontend_url and s.frontend_url != "*")
    results["google_sso"] = _health_item(
        google_sso_ok,
        "Google OAuth configured" if google_sso_ok else "Google OAuth is not fully configured",
        client_id_present=bool(s.google_client_id),
        client_secret_present=bool(s.google_client_secret),
        redirect_uri=s.google_redirect_uri or "auto",
        frontend_url=s.frontend_url,
    )

    if pool:
        try:
            auth_row = await pool.fetchrow(
                """
                SELECT
                  COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at > NOW())::int AS active,
                  COUNT(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked,
                  COUNT(*) FILTER (WHERE expires_at <= NOW() AND revoked_at IS NULL)::int AS expired,
                  MAX(last_seen_at) AS last_seen_at
                FROM auth_sessions
                """
            )
            results["auth_sessions"] = _health_item(
                True,
                f"{int(auth_row['active'] or 0)} active sessions",
                active=int(auth_row["active"] or 0),
                revoked=int(auth_row["revoked"] or 0),
                expired=int(auth_row["expired"] or 0),
                last_seen_at=auth_row["last_seen_at"].isoformat() if auth_row["last_seen_at"] else None,
            )
        except Exception as exc:
            results["auth_sessions"] = _health_item(False, str(exc))

        try:
            sync_rows = await pool.fetch(
                """
                SELECT DISTINCT ON (source)
                       source, synced_at, total, created, updated, unchanged, duration_ms, error
                FROM sync_log
                ORDER BY source, synced_at DESC NULLS LAST
                """
            )
            sync_by_source = {}
            stale_sources = []
            failed_sources = []
            for row in sync_rows:
                item = _row_to_dict(row)
                source = item.get("source") or "unknown"
                sync_by_source[source] = item
                if item.get("error"):
                    failed_sources.append(source)
                synced_at = row["synced_at"]
                if synced_at is None or (datetime.now(tz=synced_at.tzinfo) - synced_at).total_seconds() > 900:
                    stale_sources.append(source)
            required_sources = {"projects", "invoices", "web_invoices", "status"}
            seen_sources = set(sync_by_source)
            missing_sources = sorted(required_sources - seen_sources)
            stale_sources.extend(missing_sources)
            results["sync_freshness"] = _health_item(
                not stale_sources and not failed_sources,
                "Mirror sync is fresh" if not stale_sources and not failed_sources else "Stale/missing/error sync sources found",
                sources=sync_by_source,
                stale_sources=sorted(set(stale_sources)),
                failed_sources=sorted(set(failed_sources)),
            )
            results["cron_jobs"] = _health_item(
                not stale_sources,
                "Background sync/aging jobs have recent sync output" if not stale_sources else "One or more background jobs may be stale",
                expected_jobs=["teable-sync", "invoice-aging-refresh", "audit-worker"],
                sync_backed=True,
                stale_sources=sorted(set(stale_sources)),
            )
        except Exception as exc:
            results["sync_freshness"] = _health_item(False, str(exc))
            results["cron_jobs"] = _health_item(False, str(exc))

        try:
            failed_webhooks = await pool.fetchval(
                """
                SELECT COUNT(*)::int
                FROM audit_log
                WHERE path ILIKE '/api/webhooks/%'
                  AND status >= 400
                  AND ts > NOW() - INTERVAL '24 hours'
                """
            )
            results["failed_webhooks"] = _health_item(
                int(failed_webhooks or 0) == 0,
                f"{int(failed_webhooks or 0)} failed webhook requests in 24h",
                failed_24h=int(failed_webhooks or 0),
            )
        except Exception as exc:
            results["failed_webhooks"] = _health_item(False, str(exc))
    else:
        results["auth_sessions"] = _health_item(False, "PostgreSQL unavailable")
        results["sync_freshness"] = _health_item(False, "PostgreSQL unavailable")
        results["cron_jobs"] = _health_item(False, "PostgreSQL unavailable")
        results["failed_webhooks"] = _health_item(False, "PostgreSQL unavailable")

    # Env vars
    env_checks = {
        "POSTGRES_URL":  bool(s.postgres_url),
        "TEABLE_API_TOKEN": bool(s.teable_api_token),
        "APP_SECRET":    bool(s.app_secret and s.app_secret != "fintrack-dev-secret-change-me"),
        "BREVOAPIKEY":   bool(s.brevoapikey),
        "FRONTEND_URL":  bool(s.frontend_url and s.frontend_url != "*"),
        "OPENROUTER_API_KEY": bool(s.openrouter_api_key),
        "GOOGLE_CLIENT_ID": bool(s.google_client_id),
        "GOOGLE_CLIENT_SECRET": bool(s.google_client_secret),
    }
    env_guidance = {
        "POSTGRES_URL": "Required for PG mirror, audit logs, auth users, sessions, reports, and admin dashboards.",
        "TEABLE_API_TOKEN": "Required for Teable source-of-truth reads/writes.",
        "APP_SECRET": "Required for secure login/session token signing. Set a long random value in production.",
        "BREVOAPIKEY": "Required for invite, reset-password, and email test delivery.",
        "FRONTEND_URL": "Required for correct reset/invite links and OAuth redirects.",
        "OPENROUTER_API_KEY": "Required for AI assistant and report generation.",
        "GOOGLE_CLIENT_ID": "Required for Google SSO. Use a Google OAuth Web Client.",
        "GOOGLE_CLIENT_SECRET": "Required for Google SSO token exchange. Keep it secret.",
    }
    missing_env = [name for name, ok in env_checks.items() if not ok]
    results["env"] = {
        "ok": all(env_checks.values()),
        "checks": env_checks,
        "missing": missing_env,
        "guidance": env_guidance,
        "detail": "All required production env vars are present" if not missing_env else f"Missing or unsafe: {', '.join(missing_env)}",
    }

    results["deployment"] = {
        "ok": True,
        "version": s.app_version,
        "commit": _git_commit_sha(),
        "frontend_url": s.frontend_url,
        "hf_space_id": s.hf_space_id,
    }
    results["overall"] = all(v.get("ok") for v in results.values() if isinstance(v, dict) and "ok" in v)
    return results


@router.post("/auth/email/test")
@router.post("/auth/smtp/test")   # keep old path for backwards compat
async def admin_test_email(
    body: AuthSmtpTest,
    request: Request,
    actor_role: str = Depends(require_admin),
):
    """Send a test email via the configured provider (Brevo) to verify delivery works."""
    from ..services.emailer import email_wrap_html, is_email_configured, send_email

    to_email = (body.to or getattr(request.state, "auth_user_email", None) or settings.auth_admin_notify_email or settings.smtp_from_email or "").strip()
    configured = is_email_configured()
    delivery = {"sent": False, "reason": "email_not_configured"}
    if configured and to_email:
        delivery = await send_email(
            to_email,
            "FinTrack email delivery test",
            "This is a FinTrack email delivery test. If you received it in your inbox, transactional emails (invites, password resets, approvals) are configured correctly.",
            html=email_wrap_html(
                title="FinTrack email delivery test",
                preheader="Delivery test — if you received this, email is working correctly.",
                to_email=to_email,
                body_html=(
                    "<h2 style=\"margin:0 0 16px;font-size:18px;font-weight:700\">Email delivery test</h2>"
                    "<p style=\"margin:0 0 12px\">This is a transactional email delivery test from FinTrack.</p>"
                    "<p style=\"margin:0;color:#6b7280;font-size:13px\">If this arrived in your inbox (not spam), invite, approval, and password reset emails are configured correctly.</p>"
                ),
            ),
        )
    pool = get_pool()
    if pool:
        async with pool.acquire() as conn:
            await _write_auth_admin_event(
                conn,
                request,
                event_type="admin_email_test",
                actor_role=actor_role,
                target_user_id=getattr(request.state, "auth_user_id", None),
                email=to_email or None,
                status="sent" if delivery.get("sent") else "failed",
                metadata={"configured": configured, "reason": delivery.get("reason")},
            )
    reason  = delivery.get("reason", "unknown")
    detail  = delivery.get("detail", "")
    if delivery.get("sent"):
        msg = "Email sent successfully"
    elif reason == "email_not_configured":
        msg = "Email not configured — set BREVOAPIKEY and SMTP_FROM_EMAIL in HF Space secrets"
    elif reason == "no_recipient":
        msg = "No recipient address — set AUTH_ADMIN_NOTIFY_EMAIL or pass 'to' in the request body"
    else:
        msg = f"Email delivery failed: {detail or reason}"
    return {
        "configured": configured,
        "delivery": delivery,
        "to": to_email or None,
        "message": msg,
    }


# ── Manual sync trigger ───────────────────────────────────────────────────────

@router.post("/sync/trigger")
async def admin_trigger_sync(_: str = Depends(require_admin)):
    """
    Kick off a full Teable → PostgreSQL sync immediately (fire-and-forget).
    The sync result will appear in the Sync Log within a few seconds.
    """
    from ..db.sync import run_sync, _all_tokens
    from ..config import settings

    pool = get_pool()
    if not pool:
        return _no_db()

    if not _all_tokens():
        return JSONResponse(
            status_code=503,
            content={"error": "No Teable API token configured — set TEABLE_API_TOKEN or TEABLE_WEB_API_TOKEN"},
        )

    asyncio.create_task(run_sync(incremental=False))
    return {"status": "sync_started", "message": "Full sync triggered — check Sync Log in a few seconds"}


@router.post("/sync/aging-refresh")
async def admin_trigger_aging_refresh(_: str = Depends(require_admin)):
    """
    Run invoice aging refresh immediately for both invoice tables.
    This writes numeric Agening (Days) values when those Teable fields are numeric.
    """
    from ..services.invoice_aging import run_invoice_aging_refresh_cycle

    pool = get_pool()
    if not pool:
        return _no_db()

    asyncio.create_task(run_invoice_aging_refresh_cycle())
    return {
        "status": "aging_refresh_started",
        "message": "Invoice aging refresh started — check Sync Log for invoices-aging-refresh and web-invoices-aging-refresh",
    }


@router.get("/sync/diagnose")
async def admin_sync_diagnose(_: str = Depends(require_admin)):
    """
    Test each configured Teable token against each table.
    Returns reachability matrix so you can see exactly which token/table
    combinations work and which return 401/403.

    Also shows mirror table row counts for quick sanity check.
    """
    import httpx as _httpx
    from ..config import settings
    from ..db.sync import _BASE_PARAMS, _all_tokens

    base = settings.teable_base_url.rstrip("/")
    tables = {
        "projects":    settings.teable_table_id,
        "invoices":    settings.teable_invoice_table_id,
        "web_invoices": settings.teable_web_invoice_table_id,
        "status":      settings.teable_status_table_id,
    }
    mirrors = {
        "projects":    "projects_mirror",
        "invoices":    "invoices_mirror",
        "web_invoices": "web_invoices_mirror",
        "status":      "status_mirror",
    }
    token_names = {
        settings.teable_api_token:     "TEABLE_API_TOKEN",
        settings.teable_web_api_token: "TEABLE_WEB_API_TOKEN",
        settings.teable_all_api_token: "TEABLE_ALL_API_TOKEN",
    }

    results: dict = {}
    pool = get_pool()

    async with _httpx.AsyncClient(timeout=10) as http:
        for name, table_id in tables.items():
            results[name] = {
                "table_id": table_id,
                "token_results": {},
                "mirror_rows": None,
            }
            if not table_id:
                results[name]["note"] = "not configured"
                continue

            # Test every configured token against this table
            for token in _all_tokens():
                tok_name = token_names.get(token, f"token-{token[:8]}…")
                try:
                    url = f"{base}/api/table/{table_id}/record"
                    r = await http.get(
                        url,
                        headers={"Authorization": f"Bearer {token}"},
                        params={**_BASE_PARAMS, "take": 1},
                    )
                    if r.is_success:
                        body_json = r.json()
                        # Teable paginates via offset; total may live under
                        # different keys depending on version:
                        #   { total: N, records: [...] }
                        #   { count: N, records: [...] }
                        #   { records: [...] }  (count only via separate call)
                        count = (
                            body_json.get("total")
                            or body_json.get("count")
                            or body_json.get("totalRowCount")
                            or len(body_json.get("records", []))
                        )
                        results[name]["token_results"][tok_name] = {
                            "status": "ok", "http": r.status_code,
                            "total_records": count,
                        }
                    else:
                        try:
                            body = r.json().get("message") or r.text[:150]
                        except Exception:
                            body = r.text[:150]
                        results[name]["token_results"][tok_name] = {
                            "status": "error", "http": r.status_code, "detail": body,
                        }
                except Exception as exc:
                    results[name]["token_results"][tok_name] = {
                        "status": "exception", "detail": str(exc)[:150],
                    }

            # Mirror row count
            if pool:
                mirror = mirrors.get(name)
                try:
                    cnt = await pool.fetchval(f"SELECT COUNT(*) FROM {mirror}")
                    results[name]["mirror_rows"] = cnt
                except Exception:
                    results[name]["mirror_rows"] = "error"

    return {
        "configured_tokens": len(_all_tokens()),
        "tables": results,
    }


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
            (SELECT COUNT(*) FROM projects_mirror WHERE deleted_at IS NOT NULL)       AS projects_deleted,
            (SELECT COUNT(*) FROM projects_mirror WHERE deleted_at IS NULL AND synced_at < NOW() - INTERVAL '10 minutes') AS projects_stale,
            (SELECT COUNT(*) FROM invoices_mirror)                                    AS invoices_total,
            (SELECT MAX(synced_at) FROM invoices_mirror)                              AS invoices_last_sync,
            (SELECT COUNT(*) FROM invoices_mirror WHERE deleted_at IS NOT NULL)       AS invoices_deleted,
            (SELECT COUNT(*) FROM invoices_mirror WHERE deleted_at IS NULL AND synced_at < NOW() - INTERVAL '10 minutes') AS invoices_stale,
            (SELECT COUNT(*) FROM web_invoices_mirror)                                AS web_invoices_total,
            (SELECT MAX(synced_at) FROM web_invoices_mirror)                          AS web_invoices_last_sync,
            (SELECT COUNT(*) FROM web_invoices_mirror WHERE deleted_at IS NOT NULL)   AS web_invoices_deleted,
            (SELECT COUNT(*) FROM web_invoices_mirror WHERE deleted_at IS NULL AND synced_at < NOW() - INTERVAL '10 minutes') AS web_invoices_stale,
            (SELECT COUNT(*) FROM status_mirror)                                  AS status_total,
            (SELECT MAX(synced_at) FROM status_mirror)                            AS status_last_sync,
            (SELECT COUNT(*) FROM status_mirror WHERE deleted_at IS NOT NULL)      AS status_deleted,
            (SELECT COUNT(*) FROM status_mirror WHERE deleted_at IS NULL AND synced_at < NOW() - INTERVAL '10 minutes') AS status_stale,

            -- Combined invoice totals (for overview)
            (SELECT COUNT(*) FROM invoices_mirror    WHERE payment_status ILIKE '%paid%')     AS invoices_paid,
            (SELECT COUNT(*) FROM web_invoices_mirror WHERE payment_status ILIKE '%paid%')    AS web_invoices_paid,

            -- Change history
            (SELECT COUNT(*) FROM record_history)                                                                  AS history_total,
            (SELECT COUNT(*) FROM record_history WHERE recorded_at > NOW() - INTERVAL '24h')                       AS history_24h,

            -- Shared links
            (SELECT COUNT(*) FROM shared_views)                                                                     AS shared_links_total,
            (SELECT COUNT(*) FROM shared_views WHERE is_active = TRUE)                                              AS shared_links_active,
            (SELECT COUNT(*) FROM shared_views WHERE access_mode = 'edit')                                          AS shared_links_edit,
            (SELECT COUNT(*) FROM shared_view_accesses WHERE accessed_at > NOW() - INTERVAL '24h')                 AS shared_link_accesses_24h,
            (SELECT COUNT(*) FROM shared_view_accesses WHERE event_type = 'edit' AND accessed_at > NOW() - INTERVAL '24h') AS shared_link_edits_24h,

            -- Last sync run
            (SELECT synced_at FROM sync_log ORDER BY id DESC LIMIT 1)                           AS last_sync_at,
            (SELECT source    FROM sync_log ORDER BY id DESC LIMIT 1)                           AS last_sync_source,
            (SELECT error     FROM sync_log WHERE error IS NOT NULL ORDER BY id DESC LIMIT 1)   AS last_sync_error
    """)

    # Top error paths (24h) — helps diagnose what's causing the error rate
    top_error_rows = await pool.fetch("""
        SELECT
            path,
            COUNT(*)                                                         AS total,
            COUNT(*) FILTER (WHERE status >= 400 AND status < 500)          AS client_errors,
            COUNT(*) FILTER (WHERE status >= 500)                            AS server_errors,
            ROUND(AVG(duration_ms))::int                                     AS avg_ms
        FROM audit_log
        WHERE ts > NOW() - INTERVAL '24h' AND status >= 400
        GROUP BY path
        ORDER BY total DESC
        LIMIT 6
    """)

    # Top slow paths (24h) — p95-ish by avg; only include paths with >2 requests
    top_slow_rows = await pool.fetch("""
        SELECT
            path,
            ROUND(AVG(duration_ms))::int    AS avg_ms,
            MAX(duration_ms)::int           AS max_ms,
            COUNT(*)                        AS count
        FROM audit_log
        WHERE ts > NOW() - INTERVAL '24h'
          AND duration_ms IS NOT NULL
          AND duration_ms > 800
        GROUP BY path
        HAVING COUNT(*) > 1
        ORDER BY avg_ms DESC
        LIMIT 6
    """)

    result = _row_to_dict(row)
    result["top_error_paths"] = [dict(r) for r in top_error_rows]
    result["top_slow_paths"]  = [dict(r) for r in top_slow_rows]
    return result


# ── Audit log ─────────────────────────────────────────────────────────────────

@router.get("/audit-log")
async def admin_audit_log(
    limit:       int           = Query(100, ge=1, le=1000),
    offset:      int           = Query(0,   ge=0),
    role:        Optional[str] = Query(None),
    method:      Optional[str] = Query(None),
    roles:       Optional[str] = Query(None, description="Comma-separated roles: editor,admin"),
    methods:     Optional[str] = Query(None, description="Comma-separated methods: GET,POST"),
    devices:     Optional[str] = Query(None, description="Comma-separated devices: desktop,mobile"),
    status:      Optional[int] = Query(None),
    status_min:  Optional[int] = Query(None, description="Min HTTP status (e.g. 400)"),
    status_max:  Optional[int] = Query(None, description="Max HTTP status (e.g. 499)"),
    status_class:Optional[str] = Query(None, description="Status class: 2xx, 3xx, 4xx, 5xx"),
    ip:          Optional[str] = Query(None, description="IP prefix or exact match"),
    path:        Optional[str] = Query(None, description="Path substring (case-insensitive)"),
    country:     Optional[str] = Query(None, description="Country code or name substring"),
    city:        Optional[str] = Query(None, description="City substring"),
    isp:         Optional[str] = Query(None, description="ISP / org substring"),
    device:      Optional[str] = Query(None, description="desktop | mobile | tablet"),
    browser:     Optional[str] = Query(None, description="Browser substring"),
    os_name:     Optional[str] = Query(None, alias="os", description="OS substring"),
    user_email:  Optional[str] = Query(None, description="Email of the authenticated user (case-insensitive)"),
    from_ts:     Optional[str] = Query(None, description="ISO datetime range start"),
    to_ts:       Optional[str] = Query(None, description="ISO datetime range end"),
    errors_only: bool          = Query(False, description="Only 4xx/5xx responses"),
    _:           str           = Depends(require_admin),
):
    """
    Paginated audit log with rich filters.
    All text filters are case-insensitive substring / prefix matches.
    Status filters: exact `status` OR range `status_min`+`status_max`.
    """
    pool = get_pool()
    if not pool:
        return _no_db()

    where: list[str] = []
    params: list     = []
    idx = 1

    def _add(clause, value):
        nonlocal idx
        where.append(clause.replace("?", f"${idx}"))
        params.append(value)
        idx += 1

    # Validate conflicting status params
    if status and (status_min or status_max):
        raise HTTPException(status_code=422, detail="Use either 'status' (exact) or 'status_min'/'status_max' (range), not both")

    if roles:
        rl = [r.strip() for r in roles.split(',') if r.strip()]
        if rl:
            phs = ','.join(f'${idx+i}' for i in range(len(rl))); params.extend(rl); where.append(f"al.role IN ({phs})"); idx += len(rl)
    elif role:
        _add("al.role = ?", role)
    if methods:
        ml = [m.strip().upper() for m in methods.split(',') if m.strip()]
        if ml:
            phs = ','.join(f'${idx+i}' for i in range(len(ml))); params.extend(ml); where.append(f"al.method IN ({phs})"); idx += len(ml)
    elif method:
        _add("al.method = ?", method.upper())
    # Status filtering: exact takes priority, then class, then range
    if status:
        _add("al.status = ?", status)
    elif status_class:
        cls = status_class.lower().replace("xx", "").strip()
        if cls in ("2", "3", "4", "5"):
            base = int(cls) * 100
            where.append(f"al.status >= ${idx} AND al.status < ${idx+1}")
            params += [base, base + 100]; idx += 2
    else:
        if status_min: _add("al.status >= ?", status_min)
        if status_max: _add("al.status <= ?", status_max)
    if errors_only:
        where.append("al.status >= 400")
    if ip:          _add("al.ip LIKE ?",          ip + "%")
    if path:        _add("al.path ILIKE ?",        f"%{path}%")
    if country:
        where.append(f"(al.country_code ILIKE ${idx} OR al.country ILIKE ${idx+1})")
        params += [country, f"%{country}%"]; idx += 2
    if city:        _add("al.city ILIKE ?",        f"%{city}%")
    if isp:
        where.append(f"(al.isp ILIKE ${idx} OR al.org ILIKE ${idx+1})")
        params += [f"%{isp}%", f"%{isp}%"]; idx += 2
    if devices:
        dl = [d.strip().lower() for d in devices.split(',') if d.strip()]
        if dl:
            phs = ','.join(f'${idx+i}' for i in range(len(dl))); params.extend(dl); where.append(f"al.device IN ({phs})"); idx += len(dl)
    elif device:    _add("al.device = ?",          device.lower())
    if browser:     _add("al.browser ILIKE ?",     f"%{browser}%")
    if os_name:     _add("al.os ILIKE ?",          f"%{os_name}%")
    if user_email:  _add("al.user_email ILIKE ?",  f"%{user_email.strip()}%")
    if from_ts:
        try:    _add("al.ts >= ?", datetime.fromisoformat(from_ts.replace("Z", "+00:00")))
        except ValueError: raise HTTPException(status_code=422, detail=f"Invalid from_ts: {from_ts}")
    if to_ts:
        try:    _add("al.ts <= ?", datetime.fromisoformat(to_ts.replace("Z", "+00:00")))
        except ValueError: raise HTTPException(status_code=422, detail=f"Invalid to_ts: {to_ts}")

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    total = await pool.fetchval(f"SELECT COUNT(*) FROM audit_log al {where_sql}", *params)
    rows  = await pool.fetch(
        f"""
        SELECT al.id, al.ts, al.role, al.token_hint,
               al.method, al.path, al.status, al.duration_ms, al.request_id,
               al.ip, al.user_agent, al.os, al.browser, al.device,
               al.country, al.country_code, al.region, al.city, al.isp,
               al.lat, al.lon, al.timezone, al.org,
               al.referer, al.body_size, al.query_params, al.resp_size,
               al.user_id::text AS user_id,
               al.user_email,
               al.user_name,
               al.extra::text AS extra
        FROM audit_log al
        {where_sql}
        ORDER BY al.ts DESC
        LIMIT ${idx} OFFSET ${idx+1}
        """,
        *params, limit, offset,
    )

    records = []
    for row in rows:
        d = _row_to_dict(row)
        try:
            d["extra"] = json.loads(d.get("extra") or "{}")
        except Exception:
            d["extra"] = {}
        records.append(d)

    return {"total": total, "limit": limit, "offset": offset, "rows": records}


@router.delete("/audit-log/purge")
async def admin_purge_audit_log(
    older_than_days:  Optional[int]   = Query(None, ge=1,  le=3650, description="Delete rows older than N days"),
    older_than_hours: Optional[float] = Query(None, ge=0.5, le=8760, description="Delete rows older than N hours (overrides days)"),
    _: str = Depends(require_admin),
):
    """
    Bulk-delete audit log rows older than the specified age.
    Use older_than_hours for sub-day precision (e.g. 1, 6, 12, 24 hours).
    Use older_than_days for coarser ranges (e.g. 7, 30, 90 days).
    Safeguard: always keeps at least the 200 most-recent rows regardless of cutoff.
    Returns count of deleted rows.
    """
    pool = get_pool()
    if not pool:
        return _no_db()

    # Resolve threshold: hours take priority over days; default = 30 days
    if older_than_hours is not None:
        hours = float(older_than_hours)
        interval_expr = f"({hours} * INTERVAL '1 hour')"
        label = f"{hours:g} hour{'s' if hours != 1 else ''}"
    else:
        days = int(older_than_days or 30)
        interval_expr = f"({days} * INTERVAL '1 day')"
        label = f"{days} day{'s' if days != 1 else ''}"

    count = await pool.fetchval(
        f"""
        WITH ranked AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY ts DESC) AS rn FROM audit_log
        ),
        to_delete AS (
            SELECT id FROM ranked
            WHERE rn > 200
              AND id IN (
                  SELECT id FROM audit_log
                  WHERE ts < NOW() - {interval_expr}
              )
        ),
        deleted AS (
            DELETE FROM audit_log WHERE id IN (SELECT id FROM to_delete) RETURNING id
        )
        SELECT COUNT(*) FROM deleted
        """
    )

    return {
        "deleted": int(count or 0),
        "label": label,
        "message": f"Deleted {count or 0} audit log entries older than {label} (kept ≥200 most recent rows)",
    }


# ── Login sessions ────────────────────────────────────────────────────────────

@router.get("/sessions")
async def admin_sessions(
    active_only:    bool           = Query(True),
    role:           Optional[str]  = Query(None),
    session_status: Optional[str]  = Query(None, description="online | idle | logged_out | expired"),
    country:        Optional[str]  = Query(None, description="Country name or code substring"),
    device:         Optional[str]  = Query(None, description="desktop | mobile | tablet"),
    limit:          int            = Query(100, ge=1, le=500),
    offset:         int            = Query(0, ge=0),
    _:              str            = Depends(require_admin),
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
    if country:
        where.append(f"(country ILIKE ${idx} OR country_code ILIKE ${idx+1})")
        params += [f"%{country}%", country]; idx += 2
    if device:
        where.append(f"device = ${idx}"); params.append(device.lower()); idx += 1

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    # session_status is a computed CASE column — filter via subquery when requested
    status_filter = ""
    if session_status:
        status_filter = f"WHERE session_status = ${idx}"
        params.append(session_status)
        idx += 1

    base_query = f"""
        SELECT id, token_hint, role, created_at, last_seen_at, expires_at,
               ip, os, browser, device, country, country_code, city, region, isp,
               lat, lon, timezone, device_label, device_model, platform_version,
               is_active, request_count,
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
    """

    if status_filter:
        count_sql = f"SELECT COUNT(*) FROM ({base_query}) sub {status_filter}"
        rows_sql  = f"""
            SELECT * FROM ({base_query}) sub {status_filter}
            ORDER BY last_seen_at DESC
            LIMIT ${idx} OFFSET ${idx+1}
        """
    else:
        count_sql = f"SELECT COUNT(*) FROM login_sessions {where_sql}"
        rows_sql  = f"{base_query} ORDER BY last_seen_at DESC LIMIT ${idx} OFFSET ${idx+1}"

    total = await pool.fetchval(count_sql, *params)
    rows  = await pool.fetch(rows_sql, *params, limit, offset)

    return {
        "total":  total,
        "limit":  limit,
        "offset": offset,
        "rows":   [_row_to_dict(r) for r in rows],
    }


@router.delete("/sessions/purge")
async def admin_purge_sessions(
    older_than_days: Optional[int] = Query(30, ge=1, le=3650, description="Delete inactive/expired sessions older than N days"),
    _: str = Depends(require_admin),
):
    """
    Bulk-delete old login sessions.
    Safeguards:
    - only removes inactive or expired sessions;
    - always keeps the 100 most-recent sessions for traceability.
    """
    pool = get_pool()
    if not pool:
        return _no_db()

    days = int(older_than_days or 30)
    count = await pool.fetchval(
        """
        WITH ranked AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY last_seen_at DESC NULLS LAST, created_at DESC) AS rn
            FROM login_sessions
        ),
        to_delete AS (
            SELECT s.id
            FROM login_sessions s
            JOIN ranked r ON r.id = s.id
            WHERE r.rn > 100
              AND (s.is_active = false OR s.expires_at <= NOW())
              AND COALESCE(s.last_seen_at, s.created_at) < NOW() - ($1::int * INTERVAL '1 day')
        ),
        deleted AS (
            DELETE FROM login_sessions WHERE id IN (SELECT id FROM to_delete) RETURNING id
        )
        SELECT COUNT(*) FROM deleted
        """,
        days,
    )
    return {
        "deleted": int(count or 0),
        "label": f"{days} day{'s' if days != 1 else ''}",
        "message": f"Deleted {count or 0} inactive/expired sessions older than {days} day{'s' if days != 1 else ''} (kept >=100 most recent rows)",
    }


# ── AI chat sessions ──────────────────────────────────────────────────────────

@router.get("/chat-sessions")
async def admin_chat_sessions(
    limit:   int           = Query(50, ge=1, le=200),
    offset:  int           = Query(0, ge=0),
    role:    Optional[str] = Query(None),
    country: Optional[str] = Query(None, description="Country name or code substring"),
    _:       str           = Depends(require_admin),
):
    """List all AI chat sessions, newest first."""
    pool = get_pool()
    if not pool:
        return _no_db()

    where: list[str] = []
    params: list     = []
    idx = 1

    if role:
        where.append(f"role = ${idx}"); params.append(role); idx += 1
    if country:
        where.append(f"country ILIKE ${idx}"); params.append(f"%{country}%"); idx += 1

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    total = await pool.fetchval(f"SELECT COUNT(*) FROM chat_sessions {where_sql}", *params)
    rows  = await pool.fetch(
        f"""
        SELECT id, started_at, last_at, role, ip, country, city,
               os, browser, msg_count, title
        FROM chat_sessions {where_sql}
        ORDER BY started_at DESC
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


@router.get("/ai-generations")
async def admin_ai_generations(
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    task_prefix: Optional[str] = Query(None),
    role: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    _: str = Depends(require_admin),
):
    pool = get_pool()
    if not pool:
        return _no_db()

    where: list[str] = []
    params: list = []
    idx = 1

    if task_prefix:
        where.append(f"task_type ILIKE ${idx}")
        params.append(f"{task_prefix}%")
        idx += 1
    if role:
        where.append(f"role = ${idx}")
        params.append(role)
        idx += 1
    if source:
        where.append(f"verification->>'source' = ${idx}")
        params.append(source)
        idx += 1

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    total = await pool.fetchval(f"SELECT COUNT(*) FROM ai_generations {where_sql}", *params)
    rows = await pool.fetch(
        f"""
        SELECT id, created_at, session_id, task_type, response_mode, model, role, ip,
               LEFT(prompt, 240) AS prompt_preview,
               LEFT(output_text, 320) AS output_preview,
               verification, metadata, duration_ms
        FROM ai_generations
        {where_sql}
        ORDER BY created_at DESC
        LIMIT ${idx} OFFSET ${idx+1}
        """,
        *params, limit, offset,
    )
    return {"total": total, "limit": limit, "offset": offset, "rows": [_row_to_dict(r) for r in rows]}


@router.get("/ai-generations/{generation_id}")
async def admin_ai_generation_detail(
    generation_id: str,
    _: str = Depends(require_admin),
):
    pool = get_pool()
    if not pool:
        return _no_db()

    row = await pool.fetchrow("SELECT * FROM ai_generations WHERE id = $1", generation_id)
    if not row:
        return JSONResponse(status_code=404, content={"error": "AI generation not found"})
    return {"generation": _row_to_dict(row)}


# ── Sync log ──────────────────────────────────────────────────────────────────

@router.get("/sync-log")
async def admin_sync_log(
    limit:     int            = Query(50, ge=1, le=200),
    offset:    int            = Query(0, ge=0),
    source:    Optional[str]  = Query(None),
    has_error: Optional[bool] = Query(None, description="true=errors only, false=successes only"),
    _:         str            = Depends(require_admin),
):
    """Teable → PostgreSQL sync history."""
    pool = get_pool()
    if not pool:
        return _no_db()

    where_parts: list[str] = []
    params: list = []
    idx = 1

    if source:
        where_parts.append(f"source = ${idx}"); params.append(source); idx += 1
    if has_error is True:
        where_parts.append("error IS NOT NULL")
    elif has_error is False:
        where_parts.append("error IS NULL")

    where = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    total = await pool.fetchval(f"SELECT COUNT(*) FROM sync_log {where}", *params)
    rows  = await pool.fetch(
        f"""
        SELECT id, synced_at, source, total, created, updated, unchanged, duration_ms, error, details
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
    limit:        int           = Query(100, ge=1, le=500),
    offset:       int           = Query(0, ge=0),
    status:       Optional[str] = Query(None),
    client:       Optional[str] = Query(None),
    project_name: Optional[str] = Query(None, description="Project name substring"),
    _:            str           = Depends(require_admin),
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
    if project_name:
        where.append(f"project_name ILIKE ${idx}"); params.append(f"%{project_name}%"); idx += 1

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
    invoice_number: Optional[str] = Query(None, description="Invoice number substring"),
    teable_id:      Optional[str] = Query(None, description="Exact Teable record id"),
    from_ts:        Optional[str] = Query(None, description="Raised date range start (YYYY-MM-DD)"),
    to_ts:          Optional[str] = Query(None, description="Raised date range end (YYYY-MM-DD)"),
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
    if invoice_number:
        where.append(f"invoice_number ILIKE ${idx}"); params.append(f"%{invoice_number}%"); idx += 1
    if teable_id:
        where.append(f"teable_id = ${idx}"); params.append(teable_id); idx += 1
    if from_ts:
        where.append(f"raised_date >= ${idx}"); params.append(from_ts); idx += 1
    if to_ts:
        where.append(f"raised_date <= ${idx}"); params.append(to_ts); idx += 1

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
    invoice_number: Optional[str] = Query(None, description="Invoice number substring"),
    teable_id:      Optional[str] = Query(None, description="Exact Teable record id"),
    from_ts:        Optional[str] = Query(None, description="Raised date range start (YYYY-MM-DD)"),
    to_ts:          Optional[str] = Query(None, description="Raised date range end (YYYY-MM-DD)"),
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
    if invoice_number:
        where.append(f"invoice_number ILIKE ${idx}"); params.append(f"%{invoice_number}%"); idx += 1
    if teable_id:
        where.append(f"teable_id = ${idx}"); params.append(teable_id); idx += 1
    if from_ts:
        where.append(f"raised_date >= ${idx}"); params.append(from_ts); idx += 1
    if to_ts:
        where.append(f"raised_date <= ${idx}"); params.append(to_ts); idx += 1

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


@router.get("/mirror/status")
async def admin_mirror_status(
    limit:   int           = Query(100, ge=1, le=500),
    offset:  int           = Query(0, ge=0),
    client:  Optional[str] = Query(None),
    project: Optional[str] = Query(None),
    _:       str           = Depends(require_admin),
):
    """Status mirror — typed columns from the Current Status Teable table."""
    pool = get_pool()
    if not pool:
        return _no_db()

    where: list[str] = []
    params: list     = []
    idx = 1

    if client:
        where.append(f"client ILIKE ${idx}"); params.append(f"%{client}%"); idx += 1
    if project:
        where.append(f"project ILIKE ${idx}"); params.append(f"%{project}%"); idx += 1

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    total = await pool.fetchval(f"SELECT COUNT(*) FROM status_mirror {where_sql}", *params)
    rows  = await pool.fetch(
        f"""
        SELECT teable_id, synced_at,
               client, project, short_status, detail_status, modified_time,
               fields::text AS fields
        FROM status_mirror {where_sql}
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


# ── Record change history ─────────────────────────────────────────────────────

@router.get("/record-history")
async def admin_record_history(
    limit:        int           = Query(100, ge=1, le=500),
    offset:       int           = Query(0, ge=0),
    source_table: Optional[str] = Query(None),
    teable_id:    Optional[str] = Query(None),
    change_type:  Optional[str] = Query(None),
    actor_role:   Optional[str] = Query(None),
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
    if actor_role:
        where.append(f"actor_role = ${idx}");   params.append(actor_role);   idx += 1

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    total = await pool.fetchval(f"SELECT COUNT(*) FROM record_history {where_sql}", *params)
    rows  = await pool.fetch(
        f"""
        SELECT id, recorded_at, source_table, teable_id, change_type,
               changed_fields,
               old_fields::text AS old_fields,
               new_fields::text AS new_fields,
               change_source, actor_role, actor_ip, actor_country, actor_city,
               actor_region, actor_isp, actor_lat, actor_lon, actor_os,
               actor_browser, actor_device, actor_user_agent, actor_session_id,
               actor_path, actor_method,
               actor_device_label, actor_device_model, actor_platform_version,
               actor_arch, actor_cpu_cores, actor_memory_gb,
               actor_gpu, actor_screen, actor_timezone,
               actor_language, actor_network
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

    records = await _enrich_history_rows(pool, records)

    return {"total": total, "limit": limit, "offset": offset, "rows": records}

# ── HF Space log streaming ────────────────────────────────────────────────────

@router.get("/logs/{log_type}")
async def get_hf_logs(
    log_type: str,
    limit: int = 300,
    _: str = Depends(require_admin),
):
    """
    Fetch recent lines from the HF Space log stream (run or build).
    Connects to the SSE endpoint, collects up to `limit` lines or 8 s,
    then closes and returns the collected lines as a JSON array.
    """
    if log_type not in ("run", "build"):
        raise HTTPException(status_code=400, detail="log_type must be 'run' or 'build'")
    if not settings.hf_token:
        return JSONResponse(
            status_code=503,
            content={"error": "HF_TOKEN not configured — set it in HF Space secrets"},
        )

    url = f"https://huggingface.co/api/spaces/{settings.hf_space_id}/logs/{log_type}"
    collected: list[dict] = []

    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0)
        ) as client:
            async with client.stream(
                "GET", url,
                headers={"Authorization": f"Bearer {settings.hf_token}"},
            ) as resp:
                if resp.status_code == 401:
                    return JSONResponse(status_code=401, content={"error": "HF_TOKEN is invalid or expired"})
                if resp.status_code == 404:
                    return JSONResponse(status_code=404, content={"error": "HF Space not found — check hf_space_id"})
                resp.raise_for_status()

                async for raw_line in resp.aiter_lines():
                    if not raw_line.startswith("data:"):
                        continue
                    payload = raw_line[5:].strip()
                    if not payload or payload == "[DONE]":
                        continue
                    try:
                        entry = json.loads(payload)
                        # Normalise: always have timestamp + data keys
                        collected.append({
                            "ts":   entry.get("timestamp", ""),
                            "text": entry.get("data", payload),
                        })
                    except Exception:
                        collected.append({"ts": "", "text": payload})

                    if len(collected) >= limit:
                        break

    except httpx.ReadTimeout:
        pass   # return what we collected within the timeout
    except httpx.ConnectTimeout:
        return JSONResponse(status_code=504, content={"error": "Timed out connecting to HF API"})
    except Exception as exc:
        logger.warning("HF log fetch failed (%s): %s", log_type, exc)
        return JSONResponse(status_code=502, content={"error": str(exc)})

    return {"log_type": log_type, "count": len(collected), "lines": collected}


# ── Permission Matrix ─────────────────────────────────────────────────────────

class PermissionGrantBody(BaseModel):
    granted: Optional[bool] = None  # None = clear override (use role default)


@router.get("/permissions/matrix")
async def permission_matrix(_role: str = Depends(require_admin)):
    """
    Return all permissions, all roles with their permission sets,
    all active users with their roles and per-user overrides.
    """
    pool = get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database unavailable")
    async with pool.acquire() as conn:
        # All defined permissions
        perms = await conn.fetch(
            "SELECT id, permission_key, label, module_key, action_key FROM auth_permissions ORDER BY module_key, action_key"
        )

        # All roles
        roles = await conn.fetch("SELECT id, role_key, label FROM auth_roles ORDER BY label")

        # Role → permission mapping
        role_perms = await conn.fetch(
            "SELECT role_id, permission_id FROM auth_role_permissions"
        )
        role_perm_map: dict[str, set] = {}
        for rp in role_perms:
            role_perm_map.setdefault(str(rp["role_id"]), set()).add(str(rp["permission_id"]))

        # Active users with their roles
        users = await conn.fetch(
            """
            SELECT u.id, u.email, u.full_name, u.avatar_url, u.teable_email,
                   COALESCE(
                     json_agg(json_build_object('role_key', r.role_key, 'role_id', r.id::text))
                     FILTER (WHERE r.id IS NOT NULL), '[]'::json
                   ) AS roles
            FROM auth_users u
            LEFT JOIN auth_user_roles ur ON ur.user_id = u.id
            LEFT JOIN auth_roles r ON r.id = ur.role_id
            WHERE u.approved = true AND u.disabled = false
            GROUP BY u.id ORDER BY u.email
            """
        )

        # Per-user permission overrides
        user_grants = await conn.fetch(
            "SELECT user_id, permission_id, granted FROM auth_user_permission_grants"
        )
        user_grant_map: dict[str, dict] = {}
        for ug in user_grants:
            uid = str(ug["user_id"])
            pid = str(ug["permission_id"])
            user_grant_map.setdefault(uid, {})[pid] = ug["granted"]

    perm_list = [dict(p) for p in perms]
    for p in perm_list:
        p["id"] = str(p["id"])

    role_list = [{"id": str(r["id"]), "role_key": r["role_key"], "label": r["label"]} for r in roles]

    user_list = []
    for u in users:
        uid = str(u["id"])
        user_roles = json.loads(u["roles"]) if isinstance(u["roles"], str) else list(u["roles"])
        user_role_ids = {r["role_id"] for r in user_roles if r.get("role_id")}

        # Effective permissions = union of role permissions, then apply overrides
        effective: dict[str, bool] = {}
        for rid in user_role_ids:
            for pid in role_perm_map.get(rid, set()):
                effective[pid] = True

        overrides = user_grant_map.get(uid, {})
        for pid, granted in overrides.items():
            effective[pid] = granted

        user_list.append({
            "id": uid,
            "email": u["email"],
            "teable_email": u["teable_email"],
            "name": u["full_name"] or u["email"],
            "avatar_url": u["avatar_url"],
            "roles": user_roles,
            "effective_permission_ids": [pid for pid, g in effective.items() if g],
            "overrides": {pid: g for pid, g in overrides.items()},
        })

    return {
        "permissions": perm_list,
        "roles": role_list,
        "role_permissions": {k: list(v) for k, v in role_perm_map.items()},
        "users": user_list,
    }


@router.get("/users/avatar-map")
async def user_avatar_map(_role: str = Depends(require_admin)):
    """Return email → avatar_url mapping for all approved users (used by dashboards)."""
    pool = get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database unavailable")
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT email, teable_email, avatar_url, full_name
            FROM auth_users
            WHERE approved = true AND disabled = false AND avatar_url IS NOT NULL
            """
        )
    result = {}
    for r in rows:
        url = r["avatar_url"]
        entry = {"avatar_url": url, "name": r["full_name"] or r["email"]}
        result[r["email"].lower()] = entry
        if r["teable_email"]:
            result[r["teable_email"].lower()] = entry
    return result


@router.put("/permissions/users/{user_id}/{permission_key}")
async def set_user_permission(
    user_id: str,
    permission_key: str,
    body: PermissionGrantBody,
    _role: str = Depends(require_admin),
):
    """Grant, deny, or clear a per-user permission override."""
    pool = get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database unavailable")
    async with pool.acquire() as conn:
        perm = await conn.fetchrow(
            "SELECT id FROM auth_permissions WHERE permission_key = $1", permission_key
        )
        if not perm:
            raise HTTPException(status_code=404, detail=f"Permission not found: {permission_key}")

        if body.granted is None:
            # Clear override — revert to role default
            await conn.execute(
                "DELETE FROM auth_user_permission_grants WHERE user_id = $1::uuid AND permission_id = $2",
                user_id, perm["id"],
            )
            return {"status": "cleared", "user_id": user_id, "permission_key": permission_key}

        await conn.execute(
            """
            INSERT INTO auth_user_permission_grants (user_id, permission_id, granted)
            VALUES ($1::uuid, $2, $3)
            ON CONFLICT (user_id, permission_id) DO UPDATE SET granted = EXCLUDED.granted, granted_at = NOW()
            """,
            user_id, perm["id"], body.granted,
        )
        return {"status": "granted" if body.granted else "denied", "user_id": user_id, "permission_key": permission_key}
