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
from .emailer import app_origin_from_request, email_wrap_html, send_email

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


def _hash_oauth_state(state: str) -> str:
    return hashlib.sha256(state.encode()).hexdigest()


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
    if role_key == "web_admin":
        return "all"
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


def _safe_redirect_path(value: str | None) -> str:
    path = (value or "/").strip()
    if not path.startswith("/") or path.startswith("//"):
        return "/"
    if "\n" in path or "\r" in path:
        return "/"
    return path[:300] or "/"


def _admin_user_review_links(user_id: str) -> dict[str, str]:
    # Always prefer the configured frontend URL — never derive from request
    # headers because during OAuth callbacks the referer is accounts.google.com.
    origin = ""
    if settings.frontend_url and settings.frontend_url not in ("*", ""):
        origin = settings.frontend_url.rstrip("/")
    base = f"{origin}/admin" if origin else "/admin"
    return {
        "review":  f"{base}?tab=users&subtab=auth-users&user={user_id}",
        "approve": f"{base}?tab=users&subtab=auth-users&user={user_id}&decision=approve",
        "reject":  f"{base}?tab=users&subtab=auth-users&user={user_id}&decision=reject",
    }


def _button_html(href: str, label: str, bg: str) -> str:
    return (
        f'<a href="{href}" style="display:inline-block;margin:4px 6px 4px 0;'
        f'padding:11px 18px;background:{bg};color:#ffffff;border-radius:10px;'
        f'text-decoration:none;font-weight:700">{label}</a>'
    )


async def create_oauth_state(provider: str, redirect_to: str | None, request: Request) -> str:
    """Create a short-lived, one-time OAuth state stored in PostgreSQL."""
    pool = get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="PostgreSQL is required for OAuth")
    state = secrets.token_urlsafe(36)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
    await pool.execute(
        """
        INSERT INTO auth_oauth_states (
            state_hash, provider, expires_at, ip, user_agent, redirect_to, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        """,
        _hash_oauth_state(state),
        provider,
        expires_at,
        _client_ip(request),
        request.headers.get("user-agent", "")[:500],
        _safe_redirect_path(redirect_to),
        json.dumps({}),
    )
    return state


async def consume_oauth_state(state: str, provider: str, request: Request) -> str:
    """Validate and consume a one-time OAuth state. Returns safe redirect path."""
    pool = get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="PostgreSQL is required for OAuth")
    if not state or len(state) < 24:
        await _write_auth_event(f"{provider}_oauth_state_failed", request, status="invalid_state")
        raise HTTPException(status_code=400, detail="Invalid OAuth state")
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                SELECT redirect_to
                FROM auth_oauth_states
                WHERE state_hash = $1
                  AND provider = $2
                  AND used_at IS NULL
                  AND expires_at > NOW()
                FOR UPDATE
                """,
                _hash_oauth_state(state),
                provider,
            )
            if not row:
                await _write_auth_event(f"{provider}_oauth_state_failed", request, status="invalid_or_expired_state")
                raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")
            await conn.execute(
                "UPDATE auth_oauth_states SET used_at = NOW() WHERE state_hash = $1",
                _hash_oauth_state(state),
            )
    return _safe_redirect_path(row["redirect_to"])


async def _create_session_for_user(
    user: Any,
    request: Request,
    *,
    login_method: str,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create the compatibility token plus auth_sessions row for any auth method."""
    pool = get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="PostgreSQL is required for login")
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
    session_metadata = {"auth_role": auth_role, "login_method": login_method}
    session_metadata.update(metadata or {})

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
            json.dumps(session_metadata),
        )

    await log_login(
        role=legacy_role,
        token_hint=token_hint,
        ip=_client_ip(request),
        user_agent=ua,
        ttl_secs=settings.app_session_ttl,
        client_hint=request.headers.get("x-client-hint", ""),
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
            # Do NOT reveal that the account exists or its status — that is an
            # account-enumeration leak. Return the same generic shape as a fresh
            # registration so the response is indistinguishable to a caller.
            await _write_auth_event(
                "password_register_duplicate", request,
                target_user_id=str(existing["id"]), email=email_norm, status=existing["status"],
            )
            return {"created": False, "status": "pending_approval"}
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
        links = _admin_user_review_links(str(row["id"]))
        user_name = (full_name or "").strip() or "-"
        await send_email(
            settings.auth_admin_notify_email,
            f"Action needed: new FinTrack user waiting for approval",
            (
                f"A new FinTrack user is pending approval.\n\n"
                f"Email: {email_norm}\n"
                f"Name: {user_name}\n\n"
                f"Review: {links['review']}\n"
                f"Approve: {links['approve']}\n"
                f"Reject: {links['reject']}\n\n"
                f"You must be signed in as superadmin/admin to approve or reject."
            ),
            html=email_wrap_html(
                title="New user pending approval",
                preheader=f"{user_name} ({email_norm}) signed up and needs your review.",
                to_email=settings.auth_admin_notify_email,
                body_html=(
                    "<h2 style=\"margin:0 0 16px;font-size:18px;font-weight:700\">New user pending approval</h2>"
                    f"<p style=\"margin:0 0 12px\">A new account has been created and is waiting for your review.</p>"
                    f"<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:0 0 20px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:14px 16px\">"
                    f"<tr><td style=\"font-size:13px;color:#6b7280;padding-bottom:4px\">Email</td></tr>"
                    f"<tr><td style=\"font-size:15px;font-weight:600;color:#111827;padding-bottom:10px\">{email_norm}</td></tr>"
                    f"<tr><td style=\"font-size:13px;color:#6b7280;padding-bottom:4px\">Name</td></tr>"
                    f"<tr><td style=\"font-size:15px;font-weight:600;color:#111827\">{user_name}</td></tr>"
                    f"</table>"
                    f"<p style=\"margin:0 0 12px\">"
                    f"{_button_html(links['approve'], 'Approve', '#16a34a')}"
                    f"{_button_html(links['reject'], 'Reject', '#dc2626')}"
                    f"{_button_html(links['review'], 'Review details', '#2563eb')}"
                    f"</p>"
                    f"<p style=\"margin:16px 0 0;font-size:13px;color:#6b7280\">These links open the Admin Panel. An authenticated admin session is required to take action.</p>"
                ),
            ),
        )
    await send_email(
        email_orig,
        "Your FinTrack account is awaiting approval",
        "Your FinTrack account has been created and is waiting for superadmin approval. You will receive another email once approved.",
        html=email_wrap_html(
            title="Account received — awaiting approval",
            preheader="Your FinTrack account has been created and is in the approval queue.",
            to_email=email_orig,
            body_html=(
                "<h2 style=\"margin:0 0 16px;font-size:18px;font-weight:700\">Account received</h2>"
                "<p style=\"margin:0 0 12px\">Your FinTrack account has been created successfully.</p>"
                "<p style=\"margin:0 0 12px\">It is currently awaiting superadmin approval. You will receive another email at this address as soon as your account is approved and ready to use.</p>"
                "<p style=\"margin:0;color:#6b7280;font-size:13px\">If you did not create this account, you can safely ignore this email.</p>"
            ),
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
            hi_name = f"Hi {(full_name or '').strip()}" if full_name else "Hi"
            delivery = await send_email(
                email_orig,
                "You have been invited to FinTrack",
                (
                    f"{hi_name},\n\n"
                    f"You have been invited to FinTrack with role: {role_key}.\n\n"
                    f"Click the link below to set your password and sign in. This link expires in {settings.password_reset_ttl_minutes} minutes:\n\n"
                    f"{invite_url}\n\n"
                    f"If you were not expecting this invitation, you can safely ignore this email."
                ),
                html=email_wrap_html(
                    title="You have been invited to FinTrack",
                    preheader=f"Set your password to activate your FinTrack account ({role_key}).",
                    to_email=email_orig,
                    body_html=(
                        f"<h2 style=\"margin:0 0 16px;font-size:18px;font-weight:700\">{hi_name},</h2>"
                        f"<p style=\"margin:0 0 12px\">You have been invited to FinTrack with role: <strong>{role_key}</strong>.</p>"
                        f"<p style=\"margin:0 0 20px\">Click the button below to set your password and sign in. This link expires in <strong>{settings.password_reset_ttl_minutes} minutes</strong>.</p>"
                        f"{_button_html(invite_url, 'Set password &amp; sign in', '#2563eb')}"
                        f"<p style=\"margin:20px 0 0;font-size:13px;color:#6b7280\">If you were not expecting this invitation, you can safely ignore this email — no account will be activated.</p>"
                    ),
                ),
            )
        else:
            delivery = await send_email(
                email_norm,
                "Your FinTrack account is awaiting approval",
                "Your FinTrack account has been created and is pending superadmin approval. You will receive an email once approved.",
                html=email_wrap_html(
                    title="Account awaiting approval",
                    preheader="Your FinTrack account has been created and is in the approval queue.",
                    to_email=email_norm,
                    body_html=(
                        "<h2 style=\"margin:0 0 16px;font-size:18px;font-weight:700\">Account awaiting approval</h2>"
                        "<p style=\"margin:0 0 12px\">Your FinTrack account has been created and is currently pending superadmin approval.</p>"
                        "<p style=\"margin:0;color:#6b7280;font-size:13px\">You will receive another email once your account is approved and ready to use.</p>"
                    ),
                ),
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

    session = await _create_session_for_user(user, request, login_method="password")
    await _write_auth_event(
        "password_login_success",
        request,
        target_user_id=str(user["id"]),
        role=session["auth_role"],
        email=email_norm,
        status="active",
        metadata={"legacy_role": session["role"], "session_id": session["session_id"]},
    )
    return session


async def _login_with_oidc_profile(
    *,
    provider: str,
    provider_label: str,
    provider_user_id: str,
    email_orig: str,
    email_norm: str,
    email_verified: bool,
    full_name: str | None,
    picture: str | None,
    raw_profile: dict,
    request: Request,
) -> dict[str, Any]:
    """
    Shared OIDC login handler for any provider (Google, Zoho, …).
    Finds or creates the user, links the identity, then creates a session.
    New SSO users are always pending until a superadmin approves them.
    """
    pool = get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail=f"PostgreSQL is required for {provider_label} login")
    if not provider_user_id:
        await _write_auth_event(f"{provider}_login_failed", request, email=email_norm, status="missing_subject")
        raise HTTPException(status_code=400, detail=f"{provider_label} profile is missing subject")
    if not email_verified:
        await _write_auth_event(f"{provider}_login_failed", request, email=email_norm, status="email_not_verified")
        raise HTTPException(status_code=403, detail=f"{provider_label} email is not verified")

    created_pending = False
    async with pool.acquire() as conn:
        async with conn.transaction():
            user = await conn.fetchrow(
                """
                SELECT u.id, u.email, u.full_name, u.status
                FROM auth_identities i
                JOIN auth_users u ON u.id = i.user_id
                WHERE i.provider = $1 AND i.provider_user_id = $2
                """,
                provider,
                provider_user_id,
            )
            if not user:
                user = await conn.fetchrow(
                    "SELECT id, email, full_name, status FROM auth_users WHERE email_normalized = $1",
                    email_norm,
                )
                if not user:
                    user = await conn.fetchrow(
                        """
                        INSERT INTO auth_users (
                            email, email_normalized, full_name, status,
                            email_verified_at, teable_email, metadata, avatar_url, updated_at
                        )
                        VALUES ($1, $2, $3, 'pending_approval', NOW(), $1, $4::jsonb, $5, NOW())
                        RETURNING id, email, full_name, status
                        """,
                        email_orig,
                        email_norm,
                        full_name,
                        json.dumps({"signup_provider": provider, "picture": picture}),
                        picture,
                    )
                    created_pending = True
                else:
                    await conn.execute(
                        """
                        UPDATE auth_users
                           SET email_verified_at = COALESCE(email_verified_at, NOW()),
                               full_name = COALESCE(full_name, $2),
                               teable_email = COALESCE(teable_email, $4),
                               avatar_url = COALESCE(avatar_url, $5),
                               metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
                               updated_at = NOW()
                         WHERE id = $1
                        """,
                        user["id"],
                        full_name,
                        json.dumps({f"{provider}_picture": picture}),
                        email_orig,
                        picture,
                    )

                await conn.execute(
                    """
                    INSERT INTO auth_identities (
                        user_id, provider, provider_user_id, email, last_seen_at, raw_profile
                    )
                    VALUES ($1, $2, $3, $4, NOW(), $5::jsonb)
                    ON CONFLICT (provider, provider_user_id)
                    DO UPDATE SET last_seen_at = NOW(), email = EXCLUDED.email, raw_profile = EXCLUDED.raw_profile
                    """,
                    user["id"],
                    provider,
                    provider_user_id,
                    email_orig,
                    json.dumps(raw_profile),
                )
            else:
                await conn.execute(
                    """
                    UPDATE auth_identities
                       SET last_seen_at = NOW(), email = $3, raw_profile = $4::jsonb
                     WHERE provider = $5 AND provider_user_id = $2 AND user_id = $1
                    """,
                    user["id"],
                    provider_user_id,
                    email_orig,
                    json.dumps(raw_profile),
                    provider,
                )
                if picture:
                    await conn.execute(
                        "UPDATE auth_users SET avatar_url = $1 WHERE id = $2 AND avatar_url IS NULL",
                        picture,
                        user["id"],
                    )

    if user["status"] != "active":
        event_type = f"{provider}_register_pending" if created_pending else f"{provider}_login_blocked"
        await _write_auth_event(
            event_type,
            request,
            target_user_id=str(user["id"]),
            email=email_norm,
            status=user["status"],
            metadata={"provider_user_id": provider_user_id},
        )
        if created_pending and settings.auth_admin_notify_email:
            links = _admin_user_review_links(str(user["id"]))
            sso_name = full_name or "-"
            await send_email(
                settings.auth_admin_notify_email,
                f"Action needed: {provider_label} SSO user waiting for approval",
                (
                    f"A {provider_label} SSO user is pending approval.\n\n"
                    f"Email: {email_norm}\n"
                    f"Name: {sso_name}\n\n"
                    f"Review: {links['review']}\n"
                    f"Approve: {links['approve']}\n"
                    f"Reject: {links['reject']}\n\n"
                    f"You must be signed in as superadmin/admin to approve or reject."
                ),
                html=email_wrap_html(
                    title=f"{provider_label} SSO user pending approval",
                    preheader=f"{sso_name} ({email_norm}) signed in via {provider_label} and needs your review.",
                    to_email=settings.auth_admin_notify_email,
                    body_html=(
                        f"<h2 style=\"margin:0 0 16px;font-size:18px;font-weight:700\">{provider_label} SSO user pending approval</h2>"
                        f"<p style=\"margin:0 0 12px\">A user signed in via {provider_label} and their account is awaiting your review.</p>"
                        f"<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:0 0 20px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:14px 16px\">"
                        f"<tr><td style=\"font-size:13px;color:#6b7280;padding-bottom:4px\">Email</td></tr>"
                        f"<tr><td style=\"font-size:15px;font-weight:600;color:#111827;padding-bottom:10px\">{email_norm}</td></tr>"
                        f"<tr><td style=\"font-size:13px;color:#6b7280;padding-bottom:4px\">Name</td></tr>"
                        f"<tr><td style=\"font-size:15px;font-weight:600;color:#111827;padding-bottom:10px\">{sso_name}</td></tr>"
                        f"<tr><td style=\"font-size:13px;color:#6b7280;padding-bottom:4px\">Sign-in provider</td></tr>"
                        f"<tr><td style=\"font-size:15px;font-weight:600;color:#111827\">{provider_label}</td></tr>"
                        f"</table>"
                        f"<p style=\"margin:0 0 12px\">"
                        f"{_button_html(links['approve'], 'Approve', '#16a34a')}"
                        f"{_button_html(links['reject'], 'Reject', '#dc2626')}"
                        f"{_button_html(links['review'], 'Review details', '#2563eb')}"
                        f"</p>"
                        f"<p style=\"margin:16px 0 0;font-size:13px;color:#6b7280\">These links open the Admin Panel. An authenticated admin session is required to take action.</p>"
                    ),
                ),
            )
        if created_pending:
            await send_email(
                email_orig,
                f"Your FinTrack account is awaiting approval",
                f"Your {provider_label} sign-in was received and is waiting for superadmin approval. You will receive another email once approved.",
                html=email_wrap_html(
                    title="Account awaiting approval",
                    preheader=f"Your {provider_label} sign-in was received — approval pending.",
                    to_email=email_orig,
                    body_html=(
                        "<h2 style=\"margin:0 0 16px;font-size:18px;font-weight:700\">Account awaiting approval</h2>"
                        f"<p style=\"margin:0 0 12px\">Your {provider_label} sign-in was received. Your account is currently pending superadmin approval.</p>"
                        "<p style=\"margin:0 0 12px\">You will receive another email at this address once your account is approved.</p>"
                        "<p style=\"margin:0;color:#6b7280;font-size:13px\">If you did not attempt to sign in, you can safely ignore this email.</p>"
                    ),
                ),
            )
        raise HTTPException(status_code=403, detail=f"User is {user['status']}")

    session = await _create_session_for_user(
        user, request, login_method=provider, metadata={"provider_user_id": provider_user_id}
    )
    await _write_auth_event(
        f"{provider}_login_success",
        request,
        target_user_id=str(user["id"]),
        role=session["auth_role"],
        email=email_norm,
        status="active",
        metadata={"legacy_role": session["role"], "session_id": session["session_id"], "provider_user_id": provider_user_id},
    )
    return session


async def login_with_google_profile(profile: dict[str, Any], request: Request) -> dict[str, Any]:
    """Link or create a Google identity, then create a normal auth session."""
    provider_user_id = str(profile.get("sub") or "").strip()
    email_orig = str(profile.get("email") or "").strip()
    verified_raw = profile.get("email_verified")
    return await _login_with_oidc_profile(
        provider="google",
        provider_label="Google",
        provider_user_id=provider_user_id,
        email_orig=email_orig,
        email_norm=normalize_email(email_orig),
        email_verified=verified_raw is True or str(verified_raw).lower() == "true",
        full_name=str(profile.get("name") or "").strip() or None,
        picture=str(profile.get("picture") or "").strip() or None,
        raw_profile=profile,
        request=request,
    )


async def login_with_zoho_profile(profile: dict[str, Any], request: Request) -> dict[str, Any]:
    """Link or create a Zoho identity, then create a normal auth session."""
    provider_user_id = str(profile.get("sub") or "").strip()
    email_orig = str(profile.get("email") or "").strip()
    # Zoho always verifies emails; field may be absent — default True
    verified_raw = profile.get("email_verified")
    email_verified = verified_raw is True or str(verified_raw).lower() in {"true", "1"} if verified_raw is not None else True
    full_name = (
        str(profile.get("name") or "").strip()
        or " ".join(filter(None, [
            str(profile.get("given_name") or "").strip(),
            str(profile.get("family_name") or "").strip(),
        ]))
        or None
    )
    return await _login_with_oidc_profile(
        provider="zoho",
        provider_label="Zoho",
        provider_user_id=provider_user_id,
        email_orig=email_orig,
        email_norm=normalize_email(email_orig),
        email_verified=email_verified,
        full_name=full_name,
        picture=str(profile.get("picture") or "").strip() or None,
        raw_profile=profile,
        request=request,
    )


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
                f"Someone requested a password reset for this FinTrack account.\n\n"
                f"Use this link to set a new password — it expires in {settings.password_reset_ttl_minutes} minutes:\n\n"
                f"{reset_url}\n\n"
                f"If you did not request this, ignore this email. Your password has not been changed."
            ),
            html=email_wrap_html(
                title="Reset your FinTrack password",
                preheader="Use the button below to set a new password. Link expires soon.",
                to_email=reset_user["email"],
                body_html=(
                    "<h2 style=\"margin:0 0 16px;font-size:18px;font-weight:700\">Reset your password</h2>"
                    "<p style=\"margin:0 0 12px\">Someone requested a password reset for your FinTrack account.</p>"
                    f"<p style=\"margin:0 0 20px\">This link expires in <strong>{settings.password_reset_ttl_minutes} minutes</strong>.</p>"
                    f"{_button_html(reset_url, 'Set new password', '#2563eb')}"
                    "<p style=\"margin:20px 0 0;font-size:13px;color:#6b7280\">If you did not request this, ignore this email — your password has not been changed and this link will expire automatically.</p>"
                ),
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
        "Your FinTrack password was successfully changed. If you did not make this change, contact the workspace owner immediately.",
        html=email_wrap_html(
            title="Password changed",
            preheader="Your FinTrack password was just changed.",
            to_email=reset["email"],
            body_html=(
                "<h2 style=\"margin:0 0 16px;font-size:18px;font-weight:700\">Password changed</h2>"
                "<p style=\"margin:0 0 12px\">Your FinTrack account password was successfully changed.</p>"
                "<p style=\"margin:0;font-size:13px;color:#6b7280\">If you did not make this change, contact the workspace owner immediately — your account may have been compromised.</p>"
            ),
        ),
    )
    return {"ok": True, "message": "Password updated. Please sign in again."}


async def send_user_approved_email(email: str, request: Request) -> dict[str, Any]:
    origin = app_origin_from_request(request)
    login_url = f"{origin}/login" if origin else "/login"
    return await send_email(
        email,
        "Your FinTrack account is approved — you can sign in now",
        f"Your FinTrack account has been approved. Sign in here:\n\n{login_url}",
        html=email_wrap_html(
            title="Account approved — welcome to FinTrack",
            preheader="Your FinTrack account is approved. Click to sign in.",
            to_email=email,
            body_html=(
                "<h2 style=\"margin:0 0 16px;font-size:18px;font-weight:700\">Account approved</h2>"
                "<p style=\"margin:0 0 20px\">Your FinTrack account has been approved. You can now sign in and access the platform.</p>"
                f"{_button_html(login_url, 'Sign in to FinTrack', '#2563eb')}"
            ),
        ),
    )
