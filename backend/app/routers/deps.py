"""
Shared FastAPI dependencies for auth + role checks.

KEY FIX: require_auth now writes role AND token_hint to request.state
so the audit middleware (which runs after the response) can pick them
up correctly.  Previously role was always None in audit_log.

Usage:
    from .deps import require_auth, require_editor

    @router.get("/something")
    async def read_something(role: str = Depends(require_auth)):
        ...

    @router.post("/something")
    async def create_something(role: str = Depends(require_editor)):
        ...
"""
from __future__ import annotations

from typing import Any

from fastapi import Depends, Header, HTTPException, Query, Request
from ..db.postgres import get_pool
from .auth import verify_token


def _get_token(
    authorization: str | None = Header(default=None),
    auth_token: str | None = Query(default=None, alias="token"),
) -> str:
    # Accept Bearer header first; fall back to ?token= query param (for download links)
    if authorization and authorization.lower().startswith("bearer "):
        return authorization.split(" ", 1)[1].strip()
    if auth_token:
        return auth_token
    raise HTTPException(status_code=401, detail="Missing authorization token")


PRIVILEGED_AUTH_ROLES = {"superadmin", "admin", "manager", "finance", "web_admin"}


async def _attach_auth_session(request: Request, token_hint: str) -> dict[str, Any] | None:
    """
    Attach database-backed identity for email/password sessions.

    Legacy password tokens do not have an auth_sessions row and remain supported.
    Email-auth tokens must have a live, non-revoked session and an active user.
    """
    pool = get_pool()
    if not pool:
        return None
    row = await pool.fetchrow(
        """
        SELECT
            s.id AS session_id,
            s.user_id,
            s.expires_at,
            s.revoked_at,
            s.metadata,
            u.email,
            u.full_name,
            u.status,
            u.teable_email,
            r.role_key AS auth_role
        FROM auth_sessions s
        JOIN auth_users u ON u.id = s.user_id
        LEFT JOIN auth_user_roles ur ON ur.user_id = u.id
        LEFT JOIN auth_roles r ON r.id = ur.role_id
        WHERE s.token_hint = $1
        ORDER BY r.rank ASC NULLS LAST, ur.assigned_at ASC NULLS LAST
        LIMIT 1
        """,
        token_hint[:20],
    )
    if not row:
        return None
    if row["revoked_at"] is not None:
        raise HTTPException(status_code=401, detail="Session has been revoked")
    if row["expires_at"] is not None:
        # DB-side NOW() comparison avoids timezone/local clock drift.
        expired = await pool.fetchval("SELECT $1::timestamptz <= NOW()", row["expires_at"])
        if expired:
            raise HTTPException(status_code=401, detail="Session has expired")
    if row["status"] != "active":
        raise HTTPException(status_code=403, detail=f"User is {row['status']}")

    auth_role = row["auth_role"] or (row["metadata"] or {}).get("auth_role") or "viewer"
    request.state.auth_session_id  = str(row["session_id"])
    request.state.auth_user_id     = str(row["user_id"])
    request.state.auth_user_email  = row["email"]
    request.state.auth_user_name   = row["full_name"]
    # teable_email: admin-configured override for "Raised By" matching in Teable.
    # Falls back to the login email if not set.
    request.state.auth_teable_email = row["teable_email"] or row["email"]
    request.state.auth_role        = auth_role
    request.state.is_email_auth    = True
    try:
        await pool.execute(
            """
            UPDATE auth_sessions
               SET last_seen_at = NOW(),
                   request_count = COALESCE(request_count, 0) + 1
             WHERE id = $1
            """,
            row["session_id"],
        )
    except Exception:
        pass
    return {
        "session_id": str(row["session_id"]),
        "user_id": str(row["user_id"]),
        "email": row["email"],
        "full_name": row["full_name"],
        "auth_role": auth_role,
    }


def get_auth_email(request: Request) -> str | None:
    # Return original-case email — Teable field matching is case-sensitive
    value = getattr(request.state, "auth_user_email", None)
    return str(value).strip() if value else None


def get_auth_role(request: Request) -> str | None:
    value = getattr(request.state, "auth_role", None)
    return str(value).strip().lower() if value else None


def owner_scope_email(request: Request) -> str | None:
    """
    Returns the email to use for filtering Teable "Raised By" records.

    Priority:
      1. teable_email (admin-configured override — allows login email to differ from Teable email)
      2. login email (auth_user_email)
    Returns None for:
      - Legacy password-only sessions (backwards compatibility — they see all records)
      - Privileged roles (superadmin, admin, manager, finance — full access)
    """
    if not getattr(request.state, "is_email_auth", False):
        return None  # legacy password — see all records
    auth_role = get_auth_role(request) or ""
    if auth_role in PRIVILEGED_AUTH_ROLES:
        return None  # privileged — full access
    # Use the Teable-specific email override if set, otherwise fall back to login email
    teable_email = getattr(request.state, "auth_teable_email", None)
    if teable_email:
        return str(teable_email).strip()
    email = get_auth_email(request)
    return email if email else None


async def require_auth(request: Request, token: str = Depends(_get_token)) -> str:
    """
    Accepts any valid token (editor / viewer / web / all / admin).
    Stores role + token_hint on request.state for the audit middleware.
    Returns the role string.
    """
    role = verify_token(token)
    if role is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    # Store on state so audit middleware can read them after the response
    request.state.role       = role
    request.state.token_hint = token[:16]
    request.state.is_email_auth = False
    await _attach_auth_session(request, token[:16])
    return role


def require_editor(role: str = Depends(require_auth)) -> str:
    """Requires editor role. Raises 403 for all other roles."""
    if role != "editor":
        raise HTTPException(status_code=403, detail="This action requires editor access")
    return role


def require_web(role: str = Depends(require_auth)) -> str:
    """Requires web role (web invoice module)."""
    if role != "web":
        raise HTTPException(status_code=403, detail="Access restricted to web invoice module")
    return role


def require_web_access(role: str = Depends(require_auth)) -> str:
    """Accepts 'web' OR 'all' — both can access the web invoice module."""
    if role not in ("web", "all"):
        raise HTTPException(status_code=403, detail="Access restricted to web module")
    return role


def require_all(role: str = Depends(require_auth)) -> str:
    """Requires 'all' role (web project tracker)."""
    if role != "all":
        raise HTTPException(status_code=403, detail="Access restricted to web project tracker module")
    return role


async def require_admin(request: Request, role: str = Depends(require_auth)) -> str:
    """
    Admin access gate — hardened to check DB auth_role for email-auth sessions.

    Allowed:
      • Legacy 'admin' password (Master@2026) — HMAC role == 'admin'
      • Email-auth users with auth_role 'superadmin' or 'admin' in the DB

    Blocked:
      • Legacy 'editor' password — editors must use email auth + admin role to
        access admin endpoints (legacy editor bypass removed per hardening).
    """
    is_email = getattr(request.state, "is_email_auth", False)
    if is_email:
        auth_role = getattr(request.state, "auth_role", "") or ""
        if auth_role in ("superadmin", "admin"):
            return role
        raise HTTPException(status_code=403, detail="Admin access requires superadmin or admin role")
    # Legacy token path — only the dedicated admin password is accepted
    if role == "admin":
        return role
    raise HTTPException(status_code=403, detail="Admin access required")
