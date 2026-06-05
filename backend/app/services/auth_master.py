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

from fastapi import HTTPException, Request

from ..config import settings
from ..db.audit import log_login, parse_client_hint, parse_ua, build_device_label
from ..db.postgres import get_pool

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
            email_norm,
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
            email_norm,
        )
    await _write_auth_event("password_register_pending", request, target_user_id=str(row["id"]), email=email_norm, status=row["status"])
    return {"created": True, "status": row["status"]}


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
