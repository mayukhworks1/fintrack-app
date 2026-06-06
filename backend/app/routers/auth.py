"""
Password gate for the FinTrack app.

Roles:
  editor — full project/invoice access (APP_PASSWORD)
  viewer — read-only                   (APP_VIEW_PASSWORD)
  web    — web invoice tracker only    (APP_WEB_PASSWORD)
  all    — web projects + invoices     (APP_ALL_PASSWORD)
  admin  — PostgreSQL dashboard        (APP_ADMIN_PASSWORD, default Master@2026)

Token format:
  base64url("{expiry_ts}:{role}").base64url(hmac_sha256("{expiry_ts}:{role}", secret))

On every successful login a row is inserted into login_sessions (async,
fire-and-forget) with IP, user-agent, OS, browser, geo, and expiry.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import time
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from ..config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


async def _require_email_auth(
    request: Request,
    authorization: str | None = Header(default=None),
) -> str:
    """
    Dependency for profile/change-password endpoints.
    Validates the token, attaches session state, then enforces email-auth.
    Uses a local import to avoid the auth↔deps circular import.
    """
    token = ""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    role = verify_token(token)
    if role is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    request.state.role = role
    request.state.token_hint = token[:16]
    request.state.is_email_auth = False
    # Local import — deps imports verify_token from this module so we cannot
    # import deps at module level without creating a circular dependency.
    from .deps import _attach_auth_session
    await _attach_auth_session(request, token[:16])
    if not getattr(request.state, "is_email_auth", False):
        raise HTTPException(status_code=403, detail="This endpoint requires email authentication")
    return role


class LoginRequest(BaseModel):
    password: str


class EmailLoginRequest(BaseModel):
    email: str
    password: str


class EmailRegisterRequest(BaseModel):
    email: str
    password: str
    full_name: str | None = None


class EmailBootstrapRequest(BaseModel):
    email: str
    password: str
    full_name: str | None = None
    bootstrap_password: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    password: str


class UpdateProfileRequest(BaseModel):
    full_name: str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


# ── Token helpers ─────────────────────────────────────────────────────────────

def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def _sign(payload: bytes) -> bytes:
    return hmac.new(
        settings.app_secret.encode(),
        payload,
        hashlib.sha256,
    ).digest()


def make_token(role: str = "editor", ttl: int | None = None) -> str:
    """Build a signed token that embeds expiry + role."""
    expiry = int(time.time()) + (ttl if ttl is not None else settings.app_session_ttl)
    payload = f"{expiry}:{role}".encode()
    sig = _sign(payload)
    return f"{_b64url(payload)}.{_b64url(sig)}"


def verify_token(token: str) -> str | None:
    """
    Verify token signature and expiry.
    Returns the role string on success, None on failure.
    Old tokens without a role field default to "editor".
    """
    if not token or "." not in token:
        return None
    try:
        payload_b64, sig_b64 = token.split(".", 1)
        payload = _b64url_decode(payload_b64)
        sig     = _b64url_decode(sig_b64)
    except Exception:
        return None

    if not hmac.compare_digest(sig, _sign(payload)):
        return None

    try:
        decoded = payload.decode()
        if ":" in decoded:
            expiry_str, role = decoded.split(":", 1)
        else:
            expiry_str, role = decoded, "editor"
        expiry = int(expiry_str)
    except (ValueError, AttributeError):
        return None

    if time.time() >= expiry:
        return None

    return role


def _get_client_ip(request: Request) -> str:
    for header in ("x-forwarded-for", "x-real-ip", "cf-connecting-ip"):
        val = request.headers.get(header, "")
        if val:
            return val.split(",")[0].strip()
    return request.client.host if request.client else ""


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/login")
async def login(body: LoginRequest, request: Request):
    """
    Accept any role password. Returns signed token + role.
    Fires audit log_login as a background task.
    """
    provided  = (body.password or "").strip()
    editor_pw = (settings.app_password      or "").strip()
    viewer_pw = (settings.app_view_password or "").strip()
    web_pw    = (settings.app_web_password  or "").strip()
    all_pw    = (settings.app_all_password  or "").strip()
    admin_pw  = (settings.app_admin_password or "").strip()

    # Lowercase constant-time comparisons
    p = provided.lower()
    is_editor = bool(editor_pw) and hmac.compare_digest(p, editor_pw.lower())
    is_viewer = bool(viewer_pw) and hmac.compare_digest(p, viewer_pw.lower())
    is_web    = bool(web_pw)    and hmac.compare_digest(p, web_pw.lower())
    is_all    = bool(all_pw)    and hmac.compare_digest(p, all_pw.lower())
    is_admin  = bool(admin_pw)  and hmac.compare_digest(p, admin_pw.lower())

    if is_editor:
        role = "editor"
    elif is_viewer:
        role = "viewer"
    elif is_web:
        role = "web"
    elif is_all:
        role = "all"
    elif is_admin:
        role = "admin"
    else:
        raise HTTPException(status_code=401, detail="Incorrect password")

    token = make_token(role=role)
    token_hint = token[:16]

    # ── Fire-and-forget session log ──────────────────────────────────────
    try:
        from ..db.audit import log_login
        asyncio.create_task(log_login(
            role=role,
            token_hint=token_hint,
            ip=_get_client_ip(request),
            user_agent=request.headers.get("user-agent", ""),
            ttl_secs=settings.app_session_ttl,
            client_hint=request.headers.get("x-client-hint", ""),
        ))
    except Exception:
        pass   # never let logging break login

    return {"token": token, "role": role, "expires_in": settings.app_session_ttl}


@router.post("/email/login")
async def email_login(body: EmailLoginRequest, request: Request):
    """
    Normal email/password login backed by auth_users/auth_sessions.
    Additive path: existing password-only login remains available during rollout.
    """
    from ..services.auth_master import login_with_email
    return await login_with_email(body.email, body.password, request)


@router.post("/email/register")
async def email_register(body: EmailRegisterRequest, request: Request):
    """
    Create a pending user. Superadmin approval is required before login works.
    """
    from ..services.auth_master import create_pending_user
    result = await create_pending_user(body.email, body.password, body.full_name, request)
    return {
        **result,
        "approval_required": True,
        "message": "User is pending superadmin approval",
    }


@router.post("/email/bootstrap")
async def email_bootstrap(body: EmailBootstrapRequest, request: Request):
    """
    One-time creation of the first superadmin email/password user.
    Requires APP_ADMIN_PASSWORD and only works while auth_users is empty.
    """
    from ..services.auth_master import bootstrap_superadmin
    return await bootstrap_superadmin(
        body.email,
        body.password,
        body.full_name,
        body.bootstrap_password,
        request,
    )


@router.post("/email/forgot-password")
async def email_forgot_password(body: ForgotPasswordRequest, request: Request):
    """
    Send a password reset link if the account exists and is active.
    Response is intentionally generic to prevent account enumeration.
    """
    from ..services.auth_master import create_password_reset
    return await create_password_reset(body.email, request)


@router.post("/email/reset-password")
async def email_reset_password(body: ResetPasswordRequest, request: Request):
    """
    Consume a password reset token, update password, and revoke active sessions.
    """
    from ..services.auth_master import reset_password_with_token
    return await reset_password_with_token(body.token, body.password, request)


@router.get("/verify")
async def verify(authorization: str | None = Header(default=None)):
    """Validate a token and return its role. Used by the frontend on app start."""
    token = ""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()

    role = verify_token(token)
    if role is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    payload: dict = {"valid": True, "role": role}
    try:
        from ..db.postgres import get_pool
        pool = get_pool()
        if pool:
            row = await pool.fetchrow(
                """
                SELECT
                    s.id AS session_id,
                    s.user_id,
                    s.revoked_at,
                    s.expires_at,
                    s.metadata,
                    u.email,
                    u.full_name,
                    u.status,
                    r.role_key AS auth_role
                FROM auth_sessions s
                JOIN auth_users u ON u.id = s.user_id
                LEFT JOIN auth_user_roles ur ON ur.user_id = u.id
                LEFT JOIN auth_roles r ON r.id = ur.role_id
                WHERE s.token_hint = $1
                ORDER BY r.rank ASC NULLS LAST, ur.assigned_at ASC NULLS LAST
                LIMIT 1
                """,
                token[:16],
            )
            if row:
                if row["revoked_at"] is not None:
                    raise HTTPException(status_code=401, detail="Session has been revoked")
                expired = await pool.fetchval("SELECT $1::timestamptz <= NOW()", row["expires_at"])
                if expired:
                    raise HTTPException(status_code=401, detail="Session has expired")
                if row["status"] != "active":
                    raise HTTPException(status_code=403, detail=f"User is {row['status']}")
                await pool.execute("UPDATE auth_sessions SET last_seen_at = NOW() WHERE id = $1", row["session_id"])
                auth_role = row["auth_role"] or (row["metadata"] or {}).get("auth_role") or "viewer"
                payload.update({
                    "auth_role": auth_role,
                    "session_id": str(row["session_id"]),
                    "user": {
                        "id": str(row["user_id"]),
                        "email": row["email"],
                        "full_name": row["full_name"],
                        "status": row["status"],
                    },
                })
    except HTTPException:
        raise
    except Exception:
        pass

    return payload


@router.post("/logout")
async def logout(authorization: str | None = Header(default=None)):
    """
    Server-side session termination.
    Marks the login_session row as inactive (is_active=false) and
    sets expires_at=NOW() so the admin panel shows it as 'Logged out'
    instead of 'Valid/Idle' for the rest of the 7-day token TTL.

    The HMAC token itself is still technically valid (we don't blacklist
    it) but the client discards it after calling this endpoint.  For a
    personal-use app this is the right trade-off: zero extra latency on
    authenticated requests while still showing honest session history.
    """
    token = ""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()

    if not token:
        return {"logged_out": False, "reason": "no_token"}

    token_hint = token[:16]

    try:
        from ..db.postgres import get_pool
        pool = get_pool()
        if pool:
            await pool.execute(
                """
                UPDATE login_sessions
                   SET is_active  = false,
                       expires_at = NOW()
                 WHERE token_hint = $1
                   AND is_active  = true
                """,
                token_hint,
            )
            await pool.execute(
                """
                UPDATE auth_sessions
                   SET revoked_at = NOW()
                 WHERE token_hint = $1
                   AND revoked_at IS NULL
                """,
                token_hint,
            )
    except Exception:
        pass   # never let DB errors break logout — client still discards token

    return {"logged_out": True}


@router.get("/profile")
async def get_profile(request: Request, _role: str = Depends(_require_email_auth)):
    """Return the current user's profile. Requires an active email-auth session."""
    token_hint = getattr(request.state, "token_hint", None)
    if not token_hint:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        from ..db.postgres import get_pool
        pool = get_pool()
        if not pool:
            raise HTTPException(status_code=503, detail="Database unavailable")
        row = await pool.fetchrow(
            """
            SELECT
                u.id::text,
                u.email,
                u.full_name,
                u.status,
                u.created_at,
                u.approved_at,
                u.password_changed_at,
                ARRAY_AGG(DISTINCT r.role_key ORDER BY r.role_key) FILTER (WHERE r.role_key IS NOT NULL) AS roles,
                COUNT(DISTINCT s.id) FILTER (WHERE s.revoked_at IS NULL AND s.expires_at > NOW()) AS active_sessions,
                COUNT(DISTINCT s.id) AS total_sessions,
                MAX(s.last_seen_at) AS last_seen_at
            FROM auth_sessions s
            JOIN auth_users u ON u.id = s.user_id
            LEFT JOIN auth_user_roles ur ON ur.user_id = u.id
            LEFT JOIN auth_roles r ON r.id = ur.role_id
            WHERE s.token_hint = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW()
            GROUP BY u.id, u.email, u.full_name, u.status, u.created_at, u.approved_at, u.password_changed_at
            """,
            token_hint,
        )
        if not row:
            raise HTTPException(status_code=401, detail="Session not found or expired")
        roles = list(row["roles"] or [])
        return {
            "id":                   row["id"],
            "email":                row["email"],
            "full_name":            row["full_name"],
            "status":               row["status"],
            "role":                 roles[0] if roles else None,
            "roles":                roles,
            "created_at":           row["created_at"].isoformat() if row["created_at"] else None,
            "approved_at":          row["approved_at"].isoformat() if row["approved_at"] else None,
            "last_seen_at":         row["last_seen_at"].isoformat() if row["last_seen_at"] else None,
            "password_changed_at":  row["password_changed_at"].isoformat() if row["password_changed_at"] else None,
            "active_sessions":      int(row["active_sessions"] or 0),
            "total_sessions":       int(row["total_sessions"] or 0),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.patch("/profile")
async def update_profile(body: UpdateProfileRequest, request: Request, _role: str = Depends(_require_email_auth)):
    """Update the current user's display name."""
    user_id = getattr(request.state, "auth_user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        from ..db.postgres import get_pool
        pool = get_pool()
        if not pool:
            raise HTTPException(status_code=503, detail="Database unavailable")
        full_name = (body.full_name or "").strip() or None
        row = await pool.fetchrow(
            "UPDATE auth_users SET full_name = $1, updated_at = NOW() WHERE id = $2::uuid RETURNING full_name, email",
            full_name, user_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        return {"ok": True, "full_name": row["full_name"], "email": row["email"]}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/change-password")
async def change_password(body: ChangePasswordRequest, request: Request, _role: str = Depends(_require_email_auth)):
    """Change the current user's password. Requires current password verification."""
    user_id   = getattr(request.state, "auth_user_id",  None)
    token_hint = getattr(request.state, "token_hint",   None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        from ..db.postgres import get_pool
        from ..services.auth_master import verify_password, hash_password, validate_password
        pool = get_pool()
        if not pool:
            raise HTTPException(status_code=503, detail="Database unavailable")
        row = await pool.fetchrow(
            "SELECT id, password_hash FROM auth_users WHERE id = $1::uuid",
            user_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        if not row["password_hash"] or not verify_password(body.current_password, row["password_hash"]):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        new_hash = hash_password(validate_password(body.new_password))
        await pool.execute(
            "UPDATE auth_users SET password_hash = $1, password_changed_at = NOW(), updated_at = NOW() WHERE id = $2::uuid",
            new_hash, user_id,
        )
        # Revoke all OTHER active sessions — keep the current one alive
        if token_hint:
            await pool.execute(
                "UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = $1::uuid AND token_hint != $2 AND revoked_at IS NULL",
                user_id, token_hint,
            )
        return {"ok": True, "message": "Password changed. Other sessions have been revoked."}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
