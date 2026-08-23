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

import logging
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import Depends, Header, HTTPException, Query, Request
from ..db.postgres import get_pool
from ..utils.tasks import spawn
from .auth import verify_token

logger = logging.getLogger("fintrack.deps")

# How long a resolved permission set is trusted before it is re-read. Short
# enough that revoking a permission takes effect while the admin is still
# looking at the screen, long enough that a page holding two 10-second pollers
# stops re-deriving the same set on every one of them.
_PERM_TTL_SECONDS = 20.0

# user_id -> (expires_at_monotonic, permissions)
_perm_cache: dict[str, tuple[float, set[str]]] = {}


def invalidate_permission_cache(user_id: str | None = None) -> None:
    """
    Drop cached permissions so the next request re-reads them.

    Called by the admin endpoints that change a grant, so an edit to the
    permission matrix does not wait out the TTL before it bites.
    """
    if user_id:
        _perm_cache.pop(str(user_id), None)
    else:
        _perm_cache.clear()


async def _touch_auth_session(session_id: str) -> None:
    """
    Bump last_seen_at / request_count out of band, at most once every 5 minutes
    per session — mirroring db.audit.touch_session, which does exactly this for
    login_sessions.
    """
    try:
        from ..db.valkey import set_nx
        if not await set_nx(f"auth_session_touch:{session_id}", "1", ttl=300):
            return
    except Exception:
        # Valkey unavailable — fall through and write. Losing the rate limit is
        # acceptable; losing last_seen_at entirely is not.
        pass

    pool = get_pool()
    if not pool:
        return
    try:
        await pool.execute(
            """
            UPDATE auth_sessions
               SET last_seen_at  = NOW(),
                   request_count = COALESCE(request_count, 0) + 1
             WHERE id = $1::uuid
            """,
            session_id,
        )
    except Exception as exc:
        logger.debug("auth session touch failed: %s", exc)


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
            u.first_name,
            u.last_name,
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
        # Callers pass token[:16]; auth_sessions.token_hint is stored as token[:16]
        # too. Match on the value as-is — the old token_hint[:20] slice was a no-op
        # that implied a 20-char hint and masked the real, shared 16-char length.
        token_hint,
    )
    if not row:
        return None
    if row["revoked_at"] is not None:
        raise HTTPException(status_code=401, detail="Session has been revoked")
    if row["expires_at"] is not None:
        # Compared in-process. This used to be `SELECT $1::timestamptz <= NOW()`
        # — a whole round trip to Aiven to compare two timestamps we already
        # held, paid on every authenticated request in the app. asyncpg returns
        # expires_at tz-aware, so the comparison here is the same comparison;
        # the drift it was guarding against is seconds, against an expiry
        # measured in days.
        expires_at = row["expires_at"]
        if isinstance(expires_at, str):
            # asyncpg hands back a datetime for timestamptz, so this is a
            # belt-and-braces path. It is here because the alternative to
            # parsing is an AttributeError inside the auth dependency, which
            # would sign every user out at once.
            try:
                expires_at = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            except ValueError:
                expires_at = None
        if expires_at is not None:
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at <= datetime.now(timezone.utc):
                raise HTTPException(status_code=401, detail="Session has expired")
    if row["status"] != "active":
        raise HTTPException(status_code=403, detail=f"User is {row['status']}")

    auth_role = row["auth_role"] or (row["metadata"] or {}).get("auth_role") or "viewer"
    request.state.auth_session_id  = str(row["session_id"])
    request.state.auth_user_id     = str(row["user_id"])
    request.state.auth_user_email  = row["email"]
    request.state.auth_user_name   = " ".join(filter(None, [row["first_name"], row["last_name"]])) or row["full_name"]
    # teable_email: admin-configured override for "Raised By" matching in Teable.
    # Falls back to the login email if not set.
    request.state.auth_teable_email = row["teable_email"] or row["email"]
    request.state.auth_role        = auth_role
    request.state.is_email_auth    = True

    # Attribute every model call made while serving this request. Bound here
    # rather than in middleware because that runs before auth resolves, so the
    # user is not known yet. Dependencies share the endpoint's task, so the
    # contextvar reaches _try_chat without being threaded through call sites.
    try:
        from ..services import ai_usage
        ai_usage.bind(
            user_id=str(row["user_id"]),
            endpoint=request.url.path[:60],
            request_id=getattr(request.state, "request_id", None),
        )
    except Exception:
        pass
    # Bookkeeping, not authorisation — so it no longer blocks the response.
    # This was an inline write on every single authenticated request: a WAL
    # write plus a round trip before the handler had run a line, and repeated
    # contention on one row per active session. login_sessions has had the
    # rate-limited fire-and-forget treatment for the same job all along; this
    # is the same pattern applied to auth_sessions.
    spawn(_touch_auth_session(str(row["session_id"])), name="touch-auth-session")
    return {
        "session_id": str(row["session_id"]),
        "user_id": str(row["user_id"]),
        "email": row["email"],
        "first_name": row["first_name"],
        "last_name": row["last_name"],
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


async def require_superadmin(request: Request, role: str = Depends(require_auth)) -> str:
    """Strictly superadmin-only gate — used for impersonation and password overrides."""
    if not getattr(request.state, "is_email_auth", False):
        raise HTTPException(status_code=403, detail="Superadmin access required")
    auth_role = getattr(request.state, "auth_role", "") or ""
    if auth_role != "superadmin":
        raise HTTPException(status_code=403, detail="Superadmin access required")
    return role


# ── Granular permission matrix enforcement ─────────────────────────────────────
#
# auth_permissions / auth_role_permissions / auth_user_permission_grants back the
# admin "Permission Matrix" UI. This resolves a user's *effective* permission set
# (role defaults, with per-user overrides applied on top) and gates routes on it.
#
# Only applies to email-auth sessions (request.state.is_email_auth == True) —
# legacy password-based tokens ("editor"/"web"/"all"/"admin"/"viewer") have no
# associated user_id/auth_roles row and keep their existing coarse role gating
# unchanged, so nothing here can lock out the legacy password logins.

async def get_effective_permissions(user_id: str | None, *, fresh: bool = False) -> set[str]:
    """
    Resolve a user's effective permission_keys: union of their role(s)
    permissions, with per-user overrides applied.

    Cached for _PERM_TTL_SECONDS. This query — a correlated subquery over every
    permission row, grouped — ran on every permission-gated request, which is
    nearly all of them, and its answer changes only when an admin edits the
    matrix. Pass fresh=True where the current value must be authoritative.
    """
    if not user_id:
        return set()

    key = str(user_id)
    if not fresh:
        hit = _perm_cache.get(key)
        if hit and hit[0] > time.monotonic():
            return hit[1]

    pool = get_pool()
    if not pool:
        return set()
    rows = await pool.fetch(
        """
        SELECT
            p.permission_key,
            bool_or(rp.permission_id IS NOT NULL) AS from_role,
            (
                SELECT g.granted FROM auth_user_permission_grants g
                WHERE g.user_id = $1::uuid AND g.permission_id = p.id
            ) AS override
        FROM auth_permissions p
        LEFT JOIN auth_user_roles ur ON ur.user_id = $1::uuid
        LEFT JOIN auth_role_permissions rp ON rp.role_id = ur.role_id AND rp.permission_id = p.id
        GROUP BY p.id, p.permission_key
        """,
        user_id,
    )
    effective: set[str] = set()
    for r in rows:
        granted = r["override"] if r["override"] is not None else bool(r["from_role"])
        if granted:
            effective.add(r["permission_key"])

    _perm_cache[key] = (time.monotonic() + _PERM_TTL_SECONDS, effective)
    # The map is keyed by user and this is a single-worker process, so it stays
    # small; the sweep only matters over a long uptime with many logins.
    if len(_perm_cache) > 512:
        now = time.monotonic()
        for k in [k for k, (exp, _) in _perm_cache.items() if exp <= now]:
            _perm_cache.pop(k, None)
    return effective


def require_permission(permission_key: str):
    """
    Dependency factory — additionally requires `permission_key` to be in the
    caller's effective permission set, but ONLY for email-auth sessions.

    Legacy password sessions and DB role 'superadmin' always pass through —
    superadmin is the role that manages the matrix itself and must never be
    lockable out of the app by its own overrides.

    Usage (compose alongside the existing role dependency, do not replace it):
        @router.post("")
        async def create_x(
            role: str = Depends(require_auth),
            _perm: str = Depends(require_permission("module.invoices.create")),
        ): ...
    """
    async def _check(request: Request, role: str = Depends(require_auth)) -> str:
        if not getattr(request.state, "is_email_auth", False):
            return role
        auth_role = getattr(request.state, "auth_role", "") or ""
        if auth_role == "superadmin":
            return role
        user_id = getattr(request.state, "auth_user_id", None)
        effective = await get_effective_permissions(user_id)
        if permission_key not in effective:
            raise HTTPException(status_code=403, detail=f"Missing permission: {permission_key}")
        return role
    return _check
