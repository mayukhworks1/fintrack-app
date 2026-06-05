"""Database-backed auth master for email/password and future SSO.

This module is intentionally additive. Legacy password-role login continues to
work while new users, roles, approvals, and sessions move into PostgreSQL.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

from fastapi import HTTPException, Request

from ..config import settings
from ..db.audit import log_login, parse_client_hint, parse_ua, build_device_label
from ..db.postgres import get_pool
from .emailer import app_origin_from_request, send_email

_HASH_ALG = "pbkdf2_sha256"


def normalize_email(email: str) -> str:
    value = (email or "").strip().lower()
    if "@" not in value or len(value) > 320:
        raise HTTPException(status_code=422, detail="Valid email is required")
    return value


def validate_password(password: str) -> str:
    value = password or ""
    if len(value) < 10:
        raise HTTPException(status_code=422, detail="Password must be at least 10 characters")
    if len(value) > 256:
        raise HTTPException(status_code=422, detail="Password is too long")
    return value


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def hash_password(password: str, *, iterations: int = 390_000) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return f"{_HASH_ALG}${iterations}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored_hash: str | None) -> bool:
    if not password or not stored_hash:
        return False
    try:
        alg, iterations_raw, salt_raw, digest_raw = stored_hash.split("$", 3)
        if alg != _HASH_ALG:
            return False
        iterations = int(iterations_raw)
        salt = _unb64(salt_raw)
        expected = _unb64(digest_raw)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def _hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _client_ip(request: Request) -> str:
    for header in ("cf-connecting-ip", "x-forwarded-for", "x-real-ip"):
        value = request.headers.get(header, "")
        if value:
            return value.split(",")[0].strip()
    return request.client.host if request.client else ""


def _legacy_role_for(role_key: str) -> str:
    # Compatibility bridge for current route guards and frontend routing.
    if role_key in {"superadmin", "admin"}:
        return "editor"
    if role_key == "web":
        return "web"
    if role_key in {"manager", "finance"}:
        return "editor"
    if role_key == "viewer":
        return "viewer"
    return "viewer"


async def _write_auth_event(
    event_type: str,
    request: Request,
    *,
    target_user_id: str | None = None,
    role: str | None = None,
    email: str | None = None,
    status: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    pool = get_pool()
    if not pool:
        return
    await pool.execute(
        """
        INSERT INTO auth_events (
            event_type, target_user_id, role, email, status, ip, user_agent,
            request_id, metadata
        )
        VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9::jsonb)
        """,
        event_type,
        target_user_id,
        role,
        email,
        status,
        _client_ip(request),
        request.headers.get("user-agent", ""),
        getattr(request.state, "request_id", None),
        json.dumps(metadata or {}),
    )


async def _primary_role(user_id: str) -> str:
    pool = get_pool()
    if not pool:
        return "viewer"
    row = await pool.fetchrow(
        """
        SELECT r.role_key
        FROM auth_user_roles ur
        JOIN auth_roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1::uuid
        ORDER BY r.rank ASC, ur.assigned_at ASC
        LIMIT 1
        """,
        user_id,
    )
    return row["role_key"] if row else "viewer"


async def create_pending_user(email: str, password: str, full_name: str | None, request: Request) -> dict[str, Any]:
    pool = get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="PostgreSQL is required for email login")
    email_orig = (email or "").strip()  # preserve original case for Teable matching
    email_norm = normalize_email(email)
    password = validate_password(password)
    password_hash = hash_password(password)
    async with pool.acquire() as conn:
        existing = await conn.fetchrow("SELECT id, status FROM auth_users WHERE email_normalized = $1", email_norm)
        if existing:
            return {"created": False, "status": existing["status"]}
        row = await conn.fetchrow(
            """
            INSERT INTO auth_users (email, email_normalized, full_name, status, password_hash, password_changed_at)
            VALUES ($1, $2, $3, 'pending_approval', $4, NOW())
            RETURNING id, status
            """,
            email_orig,
            email_norm,
            (full_name or "").strip() or None,
            password_hash,
        )
        await conn.execute(
            """
            INSERT INTO auth_identities (user_id, provider, provider_user_id, email)
            VALUES ($1, 'password', $2, $3)
            ON CONFLICT (provider, provider_user_id) DO NOTHING
            """,
            row["id"],
            email_norm,
            email_orig,
        )
    await _write_auth_event("password_register_pending", request, target_user_id=str(row["id"]), email=email_norm, status=row["status"])
    if settings.auth_admin_notify_email:
        await send_email(
            settings.auth_admin_notify_email,
            "FinTrack user pending approval",
            (
                f"A new FinTrack user is pending approval.\n\n"
                f"Email: {email_norm}\n"
                f"Name: {(full_name or '').strip() or '-'}\n\n"
                f"Open Admin Panel -> Auth Users to approve or reject."
            ),
        )
    return {"created": True, "status": row["status"]}


async def create_admin_invited_user(
    *,
    email: str,
    full_name: str | None,
    role_key: str,
    status: str,
    send_invite: bool,
    request: Request,
    actor_role: str,
) -> dict[str, Any]:
    """Create a user from Admin Panel and optionally email a set-password invite."""
    pool = get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="PostgreSQL is required for auth users")
    email_orig = (email or "").strip()  # original case for Teable matching
    email_norm = normalize_email(email)
    role_key = (role_key or "user").strip().lower()
    status = (status or "active").strip().lower()
    if status not in {"active", "pending_approval"}:
        raise HTTPException(status_code=422, detail="Status must be active or pending_approval")

    token = secrets.token_urlsafe(36)
    token_hash = _hash_reset_token(token)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.password_reset_ttl_minutes)

    async with pool.acquire() as conn:
        async with conn.transaction():
            existing = await conn.fetchrow("SELECT id, status FROM auth_users WHERE email_normalized = $1", email_norm)
            if existing:
                raise HTTPException(status_code=409, detail="User already exists")
            role_id = await conn.fetchval("SELECT id FROM auth_roles WHERE role_key = $1", role_key)
            if not role_id:
                raise HTTPException(status_code=422, detail=f"Unknown auth role: {role_key}")
            row = await conn.fetchrow(
                """
                INSERT INTO auth_users (
                    email, email_normalized, full_name, status, approved_at,
                    email_verified_at, metadata, updated_at
                )
                VALUES ($1, $2, $3, $4::text, CASE WHEN $4::text = 'active' THEN NOW() ELSE NULL END,
                        CASE WHEN $4::text = 'active' THEN NOW() ELSE NULL END,
                        $5::jsonb, NOW())
                RETURNING id::text AS id, email, status
                """,
                email_orig,
                email_norm,
                (full_name or "").strip() or None,
                status,
                json.dumps({"created_by": actor_role, "created_from": "admin_panel"}),
            )
            await conn.execute(
                """
                INSERT INTO auth_identities (user_id, provider, provider_user_id, email)
                VALUES ($1::uuid, 'password', $2, $3)
                ON CONFLICT (provider, provider_user_id) DO NOTHING
                """,
                row["id"],
                email_norm,
                email_orig,
            )
            await conn.execute(
                "INSERT INTO auth_user_roles (user_id, role_id) VALUES ($1::uuid, $2)",
                row["id"],
                role_id,
            )
            if status == "active" and send_invite:
                await conn.execute(
                    """
                    INSERT INTO auth_password_resets (user_id, token_hash, expires_at, ip, user_agent)
                    VALUES ($1::uuid, $2, $3, $4, $5)
                    """,
                    row["id"],
                    token_hash,
                    expires_at,
                    _client_ip(request),
                    request.headers.get("user-agent", ""),
                )

    delivery = {"sent": False, "reason": "invite_not_requested"}
    if send_invite:
        origin = app_origin_from_request(request)
        if status == "active":
            invite_path = "/login"
            invite_params = urlencode({'reset_token': token, 'invite': '1', 'email': email_orig})
            invite_url = f"{origin}{invite_path}?{invite_params}" if origin else f"{invite_path}?{invite_params}"
            delivery = await send_email(
                email_orig,
                "You are invited to FinTrack",
                (
                    f"Hi{' ' + (full_name or '').strip() if full_name else ''},\n\n"
                    f"You have been invited to FinTrack with role: {role_key}.\n\n"
                    f"Click below to set your password and sign in. This link expires in {settings.password_reset_ttl_minutes} minutes:\n\n"
                    f"{invite_url}\n\n"
                    f"If you were not expecting this, you can safely ignore this email."
                ),
                html=(
                    f"<p>Hi{' <b>' + (full_name or '').strip() + '</b>' if full_name else ''},</p>"
                    f"<p>You have been invited to <b>FinTrack</b> with role: <b>{role_key}</b>.</p>"
                    f"<p><a href=\"{invite_url}\" style=\"display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;font-weight:600\">Set password &amp; sign in</a></p>"
                    f"<p style=\"color:#888;font-size:12px\">This link expires in {settings.password_reset_ttl_minutes} minutes. If you were not expecting this, you can safely ignore this email.</p>"
                ),
            )
        else:
            delivery = await send_email(
                email_norm,
                "FinTrack account created",
                "Your FinTrack account has been created and is pending superadmin approval.",
                html="<p>Your FinTrack account has been created and is pending superadmin approval.</p>",
            )

    await _write_auth_event(
        "admin_user_created",
        request,
        target_user_id=row["id"],
        role=role_key,
        email=email_norm,
        status=status,
        metadata={"actor_role": actor_role, "invite_sent": delivery.get("sent"), "invite_reason": delivery.get("reason")},
    )
    return {"created": True, "id": row["id"], "email": email_norm, "status": status, "role_key": role_key, "invite": delivery}


async def bootstrap_superadmin(email: str, password: str, full_name: str | None, bootstrap_password: str, request: Request) -> dict[str, Any]:
    pool = get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="PostgreSQL is required for email login")
    if not settings.app_admin_password or not hmac.compare_digest((bootstrap_password or "").strip(), settings.app_admin_password.strip()):
        raise HTTPException(status_code=403, detail="Bootstrap password is invalid")
    email_norm = normalize_email(email)
    password = validate_password(password)
    password_hash = hash_password(password)
    async with pool.acquire() as conn:
        count = await conn.fetchval("SELECT COUNT(*) FROM auth_users")
        if count:
            raise HTTPException(status_code=409, detail="Auth bootstrap is already complete")
        role_id = await conn.fetchval("SELECT id FROM auth_roles WHERE role_key = 'superadmin'")
        if not role_id:
            raise HTTPException(status_code=503, detail="Auth roles are not initialised")
        row = await conn.fetchrow(
            """
            INSERT INTO auth_users (
                email, email_normalized, full_name, status, approved_at,
                email_verified_at, password_hash, password_changed_at
            )
            VALUES ($1, $2, $3, 'active', NOW(), NOW(), $4, NOW())
            RETURNING id, status
            """,
            email_norm,
            email_norm,
            (full_name or "").strip() or None,
            password_hash,
        )
        await conn.execute(
            "INSERT INTO auth_user_roles (user_id, role_id) VALUES ($1, $2)",
            row["id"],
            role_id,
        )
        await conn.execute(
            """
            INSERT INTO auth_identities (user_id, provider, provider_user_id, email)
            VALUES ($1, 'password', $2, $3)
            """,
            row["id"],
            email_norm,
            email_norm,
        )
    await _write_auth_event("bootstrap_superadmin", request, target_user_id=str(row["id"]), role="superadmin", email=email_norm, status="active")
    return {"created": True, "status": "active"}


async def login_with_email(email: str, password: str, request: Request) -> dict[str, Any]:
    pool = get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="PostgreSQL is required for email login")
    email_norm = normalize_email(email)
    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            """
            SELECT id, email, full_name, status, password_hash
            FROM auth_users
            WHERE email_normalized = $1
            """,
            email_norm,
        )
    if not user or not verify_password(password, user["password_hash"]):
        await _write_auth_event("password_login_failed", request, email=email_norm, status="invalid_credentials")
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user["status"] != "active":
        await _write_auth_event("password_login_blocked", request, target_user_id=str(user["id"]), email=email_norm, status=user["status"])
        raise HTTPException(status_code=403, detail=f"User is {user['status']}")

    auth_role = await _primary_role(str(user["id"]))
    legacy_role = _legacy_role_for(auth_role)
    from ..routers.auth import make_token
    token = make_token(role=legacy_role)
    token_hint = token[:16]
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=settings.app_session_ttl)

    ua = request.headers.get("user-agent", "")
    os_str, browser, device = parse_ua(ua)
    hint = parse_client_hint(request.headers.get("x-client-hint", ""))
    device_label = build_device_label(os_str, browser, device, hint)

    async with pool.acquire() as conn:
        session_id = await conn.fetchval(
            """
            INSERT INTO auth_sessions (
                user_id, token_hint, expires_at, ip, user_agent, os, browser,
                device, device_label, metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
            RETURNING id
            """,
            user["id"],
            token_hint,
            expires_at,
            _client_ip(request),
            ua[:500],
            os_str,
            browser,
            device,
            device_label,
            json.dumps({"auth_role": auth_role, "login_method": "password"}),
        )

    await log_login(
        role=legacy_role,
        token_hint=token_hint,
        ip=_client_ip(request),
        user_agent=ua,
        ttl_secs=settings.app_session_ttl,
        client_hint=request.headers.get("x-client-hint", ""),
    )
    await _write_auth_event(
        "password_login_success",
        request,
        target_user_id=str(user["id"]),
        role=auth_role,
        email=email_norm,
        status="active",
        metadata={"legacy_role": legacy_role, "session_id": str(session_id)},
    )
    return {
        "token": token,
        "role": legacy_role,
        "auth_role": auth_role,
        "user": {
            "id": str(user["id"]),
            "email": user["email"],
            "full_name": user["full_name"],
            "status": user["status"],
        },
        "session_id": str(session_id),
        "expires_in": settings.app_session_ttl,
    }


async def create_password_reset(email: str, request: Request) -> dict[str, Any]:
    """Create a reset token and email it, without revealing account existence."""
    pool = get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="PostgreSQL is required for password reset")
    email_norm = normalize_email(email)
    token = secrets.token_urlsafe(36)
    token_hash = _hash_reset_token(token)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.password_reset_ttl_minutes)
    reset_user: dict[str, Any] | None = None

    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            """
            SELECT id, email, full_name, status
            FROM auth_users
            WHERE email_normalized = $1
            """,
            email_norm,
        )
        if user and user["status"] == "active":
            await conn.execute(
                """
                INSERT INTO auth_password_resets (user_id, token_hash, expires_at, ip, user_agent)
                VALUES ($1, $2, $3, $4, $5)
                """,
                user["id"],
                token_hash,
                expires_at,
                _client_ip(request),
                request.headers.get("user-agent", ""),
            )
            reset_user = {"id": str(user["id"]), "email": user["email"], "status": user["status"]}
        else:
            await _write_auth_event("password_reset_requested_unknown", request, email=email_norm, status=user["status"] if user else "not_found")

    if reset_user:
        origin = app_origin_from_request(request)
        reset_path = "/login"
        reset_url = f"{origin}{reset_path}?{urlencode({'reset_token': token})}" if origin else f"{reset_path}?{urlencode({'reset_token': token})}"
        delivery = await send_email(
            reset_user["email"],
            "Reset your FinTrack password",
            (
                f"Use this link to reset your FinTrack password. It expires in "
                f"{settings.password_reset_ttl_minutes} minutes.\n\n{reset_url}\n\n"
                f"If you did not request this, ignore this email."
            ),
            html=(
                f"<p>Use this link to reset your FinTrack password. It expires in "
                f"{settings.password_reset_ttl_minutes} minutes.</p>"
                f"<p><a href=\"{reset_url}\">Reset password</a></p>"
                f"<p>If you did not request this, ignore this email.</p>"
            ),
        )
        await _write_auth_event(
            "password_reset_requested",
            request,
            target_user_id=reset_user["id"],
            email=email_norm,
            status=reset_user["status"],
            metadata={"email_sent": delivery.get("sent"), "email_reason": delivery.get("reason")},
        )

    return {
        "ok": True,
        "message": "If the account is active, a password reset email has been sent.",
    }


async def reset_password_with_token(token: str, password: str, request: Request) -> dict[str, Any]:
    pool = get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="PostgreSQL is required for password reset")
    if not token or len(token) < 24:
        raise HTTPException(status_code=422, detail="Valid reset token is required")
    password = validate_password(password)
    token_hash = _hash_reset_token(token)
    password_hash = hash_password(password)

    async with pool.acquire() as conn:
        async with conn.transaction():
            reset = await conn.fetchrow(
                """
                SELECT pr.id, pr.user_id, u.email, u.status
                FROM auth_password_resets pr
                JOIN auth_users u ON u.id = pr.user_id
                WHERE pr.token_hash = $1
                  AND pr.used_at IS NULL
                  AND pr.expires_at > NOW()
                ORDER BY pr.created_at DESC
                LIMIT 1
                """,
                token_hash,
            )
            if not reset:
                await _write_auth_event("password_reset_failed", request, metadata={"reason": "invalid_or_expired_token"})
                raise HTTPException(status_code=400, detail="Reset link is invalid or expired")
            if reset["status"] != "active":
                await _write_auth_event(
                    "password_reset_failed",
                    request,
                    target_user_id=str(reset["user_id"]),
                    email=reset["email"],
                    status=reset["status"],
                    metadata={"reason": "inactive_user"},
                )
                raise HTTPException(status_code=403, detail="User is not active")
            await conn.execute(
                """
                UPDATE auth_users
                SET password_hash = $2,
                    password_changed_at = NOW(),
                    updated_at = NOW()
                WHERE id = $1
                """,
                reset["user_id"],
                password_hash,
            )
            await conn.execute("UPDATE auth_password_resets SET used_at = NOW() WHERE id = $1", reset["id"])
            await conn.execute(
                "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = $1",
                reset["user_id"],
            )
            await _write_auth_event(
                "password_reset_completed",
                request,
                target_user_id=str(reset["user_id"]),
                email=reset["email"],
                status="active",
            )
    await send_email(
        reset["email"],
        "Your FinTrack password was changed",
        "Your FinTrack password was changed. If this was not you, contact the workspace owner immediately.",
    )
    return {"ok": True, "message": "Password updated. Please sign in again."}


async def send_user_approved_email(email: str, request: Request) -> dict[str, Any]:
    origin = app_origin_from_request(request)
    login_url = f"{origin}/login" if origin else "/login"
    return await send_email(
        email,
        "Your FinTrack access is approved",
        f"Your FinTrack account has been approved. Sign in here:\n\n{login_url}",
        html=f"<p>Your FinTrack account has been approved.</p><p><a href=\"{login_url}\">Sign in to FinTrack</a></p>",
    )
