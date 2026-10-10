"""
Password gate for the FinTrack app.

Roles:
  editor — full project/invoice access (APP_PASSWORD)
  viewer — read-only                   (APP_VIEW_PASSWORD)
  web    — web invoice tracker only    (APP_WEB_PASSWORD)
  all    — web projects + invoices     (APP_ALL_PASSWORD)
  admin  — PostgreSQL dashboard        (APP_ADMIN_PASSWORD)

Token format:
  base64url(payload).base64url(hmac_sha256(payload, secret))
  payload = "{nonce}:{expiry_ts}:{role}" or "{nonce}:{expiry_ts}:{role}:s"
  Tokens issued before the nonce carry "{expiry_ts}:{role}" and still verify.
  The trailing "s" marks a token backed by an auth_sessions row (email/SSO
  login, impersonation); it is rejected when that row is gone.

On every successful login a row is inserted into login_sessions (async,
fire-and-forget) with IP, user-agent, OS, browser, geo, and expiry.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import secrets
import time
from ..utils.tasks import spawn
from urllib.parse import urlencode
from fastapi import APIRouter, Depends, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import RedirectResponse
import httpx
from ..utils.http import shared_client
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
    await _attach_auth_session(request, token[:16], session_bound=token_is_session_bound(token))
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
    first_name: str | None = None
    last_name: str | None = None
    full_name: str | None = None  # legacy fallback


class EmailBootstrapRequest(BaseModel):
    email: str
    password: str
    first_name: str | None = None
    last_name: str | None = None
    full_name: str | None = None  # legacy fallback
    bootstrap_password: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    password: str


class UpdateProfileRequest(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    full_name: str | None = None  # legacy fallback — prefer first_name/last_name
    phone: str | None = None
    job_title: str | None = None
    department: str | None = None
    company: str | None = None
    location: str | None = None
    timezone: str | None = None


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


def make_token(role: str = "editor", ttl: int | None = None, *, session_bound: bool = False) -> str:
    """
    Build a signed token that embeds a nonce, expiry and role.

    The nonce comes first so the 16-character hint every session table is
    keyed on (token[:16]) is random. It used to be the expiry second plus the
    role's first letter, so two same-role logins in one second got the same
    token and shared one identity.

    session_bound marks a token whose identity lives in an auth_sessions row;
    deps rejects it when that row is missing instead of downgrading it to a
    legacy role token.
    """
    expiry = int(time.time()) + (ttl if ttl is not None else settings.app_session_ttl)
    nonce = secrets.token_urlsafe(12)   # 16 chars of [A-Za-z0-9_-], never ':'
    payload = f"{nonce}:{expiry}:{role}{':s' if session_bound else ''}".encode()
    sig = _sign(payload)
    return f"{_b64url(payload)}.{_b64url(sig)}"


def _token_claims(token: str) -> dict | None:
    """Verify signature and expiry; return the payload's fields, or None."""
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

    session_bound = False
    try:
        parts = payload.decode().split(":")
        if len(parts) == 1:
            # Oldest tokens: "{expiry}" with no role
            expiry_str, role = parts[0], "editor"
        elif len(parts) == 2:
            # Pre-nonce tokens: "{expiry}:{role}"
            expiry_str, role = parts
        else:
            # "{nonce}:{expiry}:{role}" plus optional flags
            expiry_str, role = parts[1], parts[2]
            session_bound = "s" in parts[3:]
        expiry = int(expiry_str)
    except (ValueError, AttributeError):
        return None

    if time.time() >= expiry:
        return None

    return {"role": role, "expiry": expiry, "session_bound": session_bound}


def verify_token(token: str) -> str | None:
    """
    Verify token signature and expiry.
    Returns the role string on success, None on failure.
    Old tokens without a role field default to "editor".
    """
    claims = _token_claims(token)
    return claims["role"] if claims else None


def token_is_session_bound(token: str) -> bool:
    """True for a valid token that must resolve to a live auth_sessions row."""
    claims = _token_claims(token)
    return bool(claims and claims["session_bound"])


def _get_client_ip(request: Request) -> str:
    # The rate limit below keys on this, so it must not trust client-set headers.
    from ..utils.client_ip import client_ip
    return client_ip(request)


async def _auth_rate_limit(request: Request) -> None:
    """
    Throttle credential/email endpoints per client IP to blunt brute force,
    PBKDF2 CPU-DoS, and email-bombing. ~10 attempts/minute/IP. Fails open if
    Valkey is unavailable so a cache outage never locks people out.
    """
    from ..db.valkey import rate_check
    ip = _get_client_ip(request) or "unknown"
    allowed, _ = await rate_check(ip, limit=10, window_sec=60, bucket="authrl")
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many attempts. Please wait a minute and try again.",
            headers={"Retry-After": "60"},
        )


def _frontend_origin() -> str:
    origin = (settings.frontend_url or "").strip().rstrip("/")
    if not origin or origin == "*":
        return ""
    return origin


def _oauth_redirect_url(path: str = "/login", *, fragment: dict | None = None, query: dict | None = None) -> str:
    origin = _frontend_origin()
    base = f"{origin}{path}" if origin else path
    if query:
        base = f"{base}?{urlencode({k: v for k, v in query.items() if v is not None})}"
    if fragment:
        base = f"{base}#{urlencode({k: v for k, v in fragment.items() if v is not None})}"
    return base


def _google_redirect_uri(request: Request) -> str:
    configured = (settings.google_redirect_uri or "").strip()
    if configured:
        return configured
    return str(request.url_for("google_callback"))


def _zoho_redirect_uri(request: Request) -> str:
    configured = (settings.zoho_redirect_uri or "").strip()
    if configured:
        return configured
    return str(request.url_for("zoho_callback"))


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/providers")
async def auth_providers():
    """Public login capability flags for safe progressive auth rollout."""
    return {
        "email_password": True,
        "legacy_password": True,
        "google": bool(settings.google_client_id and settings.google_client_secret),
        "zoho":   bool(settings.zoho_client_id   and settings.zoho_client_secret),
    }


@router.post("/login")
async def login(body: LoginRequest, request: Request, _rl: None = Depends(_auth_rate_limit)):
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

    # Case-SENSITIVE constant-time comparisons. Lowercasing both sides (the old
    # behaviour) silently threw away password entropy — an all-caps guess would
    # match a mixed-case secret. Passwords must match exactly.
    p = provided
    is_editor = bool(editor_pw) and hmac.compare_digest(p, editor_pw)
    is_viewer = bool(viewer_pw) and hmac.compare_digest(p, viewer_pw)
    is_web    = bool(web_pw)    and hmac.compare_digest(p, web_pw)
    is_all    = bool(all_pw)    and hmac.compare_digest(p, all_pw)
    is_admin  = bool(admin_pw)  and hmac.compare_digest(p, admin_pw)

    # Dedicated admin password must win if secrets accidentally overlap.
    # Production previously had legacy passwords collide, causing the admin password
    # to log in as "editor" and then fail every /api/admin/* request.
    if is_admin:
        role = "admin"
    elif is_editor:
        role = "editor"
    elif is_viewer:
        role = "viewer"
    elif is_web:
        role = "web"
    elif is_all:
        role = "all"
    else:
        raise HTTPException(status_code=401, detail="Incorrect password")

    token = make_token(role=role)
    token_hint = token[:16]

    # ── Fire-and-forget session log ──────────────────────────────────────
    try:
        from ..db.audit import log_login
        spawn(log_login(
            role=role,
            token_hint=token_hint,
            ip=_get_client_ip(request),
            user_agent=request.headers.get("user-agent", ""),
            ttl_secs=settings.app_session_ttl,
            client_hint=request.headers.get("x-client-hint", ""),
        ), name="log-login")
    except Exception:
        pass   # never let logging break login

    return {"token": token, "role": role, "expires_in": settings.app_session_ttl}


@router.post("/email/login")
async def email_login(body: EmailLoginRequest, request: Request, _rl: None = Depends(_auth_rate_limit)):
    """
    Normal email/password login backed by auth_users/auth_sessions.
    Additive path: existing password-only login remains available during rollout.
    """
    from ..services.auth_master import login_with_email
    return await login_with_email(body.email, body.password, request)


@router.post("/email/register")
async def email_register(body: EmailRegisterRequest, request: Request, _rl: None = Depends(_auth_rate_limit)):
    """
    Create a pending user. Superadmin approval is required before login works.
    """
    from ..services.auth_master import create_pending_user
    result = await create_pending_user(body.email, body.password, body.full_name, request, first_name=body.first_name, last_name=body.last_name)
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


@router.get("/google/start")
async def google_start(request: Request, next: str = "/"):
    """Start Google OAuth. Existing password and legacy login paths remain available."""
    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(status_code=503, detail="Google SSO is not configured")
    from ..services.auth_master import create_oauth_state
    state = await create_oauth_state("google", next, request)
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": _google_redirect_uri(request),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "prompt": "select_account",
    }
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}", status_code=302)


@router.get("/google/callback", name="google_callback")
async def google_callback(request: Request, code: str | None = None, state: str | None = None, error: str | None = None):
    """Handle Google OAuth callback, then send the frontend a verified FinTrack token."""
    redirect_to = "/"
    try:
        from ..services.auth_master import consume_oauth_state, login_with_google_profile
        if error:
            raise HTTPException(status_code=400, detail=error)
        redirect_to = await consume_oauth_state(state or "", "google", request)
        if not code:
            raise HTTPException(status_code=400, detail="Google authorization code is missing")
        async with shared_client(timeout=15) as client:
            token_res = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "code": code,
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "redirect_uri": _google_redirect_uri(request),
                    "grant_type": "authorization_code",
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            token_res.raise_for_status()
            token_payload = token_res.json()
            id_token = token_payload.get("id_token")
            if not id_token:
                raise HTTPException(status_code=400, detail="Google did not return an ID token")
            profile_res = await client.get(
                "https://oauth2.googleapis.com/tokeninfo",
                params={"id_token": id_token},
            )
            profile_res.raise_for_status()
            profile = profile_res.json()
        if profile.get("aud") != settings.google_client_id:
            raise HTTPException(status_code=403, detail="Google token audience mismatch")
        if profile.get("iss") not in {"accounts.google.com", "https://accounts.google.com"}:
            raise HTTPException(status_code=403, detail="Google token issuer mismatch")
        login_payload = await login_with_google_profile(profile, request)
        return RedirectResponse(
            _oauth_redirect_url(
                "/login",
                fragment={
                    "oauth_token": login_payload["token"],
                    "oauth_next": redirect_to,
                    "oauth": "google",
                },
            ),
            status_code=302,
        )
    except HTTPException as exc:
        detail = str(exc.detail or "Google sign-in failed")
        code_value = "pending_approval" if "pending_approval" in detail else "google_error"
        if "disabled" in detail:
            code_value = "disabled"
        elif "rejected" in detail:
            code_value = "rejected"
        return RedirectResponse(
            _oauth_redirect_url("/login", query={"oauth_error": code_value, "message": detail}),
            status_code=302,
        )
    except Exception:
        return RedirectResponse(
            _oauth_redirect_url("/login", query={"oauth_error": "google_error", "message": "Google sign-in failed"}),
            status_code=302,
        )


@router.get("/zoho/start")
async def zoho_start(request: Request, next: str = "/"):
    """Start Zoho OAuth 2.0 flow."""
    if not settings.zoho_client_id or not settings.zoho_client_secret:
        raise HTTPException(status_code=503, detail="Zoho SSO is not configured")
    from ..services.auth_master import create_oauth_state
    state = await create_oauth_state("zoho", next, request)
    params = {
        "client_id": settings.zoho_client_id,
        "redirect_uri": _zoho_redirect_uri(request),
        "response_type": "code",
        "scope": "openid profile email",
        "state": state,
        "prompt": "consent",
        "access_type": "online",
    }
    return RedirectResponse(f"https://accounts.zoho.com/oauth/v2/auth?{urlencode(params)}", status_code=302)


@router.get("/zoho/callback", name="zoho_callback")
async def zoho_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    """Handle Zoho OAuth callback, verify the token, and redirect to the frontend."""
    redirect_to = "/"
    try:
        from ..services.auth_master import consume_oauth_state, login_with_zoho_profile
        if error:
            raise HTTPException(status_code=400, detail=error)
        redirect_to = await consume_oauth_state(state or "", "zoho", request)
        if not code:
            raise HTTPException(status_code=400, detail="Zoho authorization code is missing")
        async with shared_client(timeout=15) as client:
            token_res = await client.post(
                "https://accounts.zoho.com/oauth/v2/token",
                data={
                    "code": code,
                    "client_id": settings.zoho_client_id,
                    "client_secret": settings.zoho_client_secret,
                    "redirect_uri": _zoho_redirect_uri(request),
                    "grant_type": "authorization_code",
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            token_res.raise_for_status()
            token_payload = token_res.json()
            access_token = token_payload.get("access_token")
            if not access_token:
                raise HTTPException(status_code=400, detail="Zoho did not return an access token")
            profile_res = await client.get(
                "https://accounts.zoho.com/oauth/v2/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            profile_res.raise_for_status()
            profile = profile_res.json()
        login_payload = await login_with_zoho_profile(profile, request)
        return RedirectResponse(
            _oauth_redirect_url(
                "/login",
                fragment={
                    "oauth_token": login_payload["token"],
                    "oauth_next": redirect_to,
                    "oauth": "zoho",
                },
            ),
            status_code=302,
        )
    except HTTPException as exc:
        detail = str(exc.detail or "Zoho sign-in failed")
        code_value = "pending_approval" if "pending_approval" in detail else "zoho_error"
        if "disabled" in detail:
            code_value = "disabled"
        elif "rejected" in detail:
            code_value = "rejected"
        return RedirectResponse(
            _oauth_redirect_url("/login", query={"oauth_error": code_value, "message": detail}),
            status_code=302,
        )
    except Exception:
        return RedirectResponse(
            _oauth_redirect_url("/login", query={"oauth_error": "zoho_error", "message": "Zoho sign-in failed"}),
            status_code=302,
        )


@router.post("/email/forgot-password")
async def email_forgot_password(body: ForgotPasswordRequest, request: Request, _rl: None = Depends(_auth_rate_limit)):
    """
    Send a password reset link if the account exists and is active.
    Response is intentionally generic to prevent account enumeration.
    """
    from ..services.auth_master import create_password_reset
    return await create_password_reset(body.email, request)


@router.post("/email/reset-password")
async def email_reset_password(body: ResetPasswordRequest, request: Request, _rl: None = Depends(_auth_rate_limit)):
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
    # A session-bound (email/SSO/impersonation) token is only as good as its
    # auth_sessions row; it must never come back as a bare legacy role.
    session_bound = token_is_session_bound(token)
    try:
        from ..db.postgres import get_pool
        pool = get_pool()
        if not pool and session_bound:
            raise HTTPException(status_code=503, detail="Sign-in service is temporarily unavailable")
        if pool:
            row = await pool.fetchrow(
                """
                SELECT
                    s.id AS session_id,
                    s.user_id,
                    s.revoked_at,
                    s.expires_at,
                    -- Decided here, in the same round trip, instead of a second
                    -- query that only existed to ask Postgres "is this timestamp
                    -- in the past?". That query ran serially before every login
                    -- could finish and was the single most pointless await on
                    -- the spinner.
                    (s.expires_at IS NOT NULL AND s.expires_at <= NOW()) AS expired,
                    s.metadata,
                    u.email,
                    u.first_name,
                    u.last_name,
                    u.full_name,
                    u.status,
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
                    ) AS avatar_url,
                    r.role_key AS auth_role,
                    -- Effective permissions, in the same round trip. This was
                    -- a second query (deps.get_effective_permissions) issued
                    -- only after the session row came back — one more trip
                    -- to a database ~210 ms away, on every app open. Same
                    -- rule: a per-user override wins, else any role grants.
                    (
                        SELECT COALESCE(array_agg(p.permission_key ORDER BY p.permission_key), '{}'::text[])
                        FROM auth_permissions p
                        WHERE COALESCE(
                            (
                                SELECT g.granted
                                FROM auth_user_permission_grants g
                                WHERE g.user_id = u.id AND g.permission_id = p.id
                            ),
                            EXISTS (
                                SELECT 1
                                FROM auth_user_roles ur2
                                JOIN auth_role_permissions rp
                                  ON rp.role_id = ur2.role_id AND rp.permission_id = p.id
                                WHERE ur2.user_id = u.id
                            )
                        )
                    ) AS permissions
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
            if not row and session_bound:
                raise HTTPException(status_code=401, detail="Session has been revoked")
            if row:
                if row["revoked_at"] is not None:
                    raise HTTPException(status_code=401, detail="Session has been revoked")
                if row["expired"]:
                    raise HTTPException(status_code=401, detail="Session has expired")
                if row["status"] != "active":
                    raise HTTPException(status_code=403, detail=f"User is {row['status']}")
                # Bump last_seen out of band. This was an inline UPDATE — a WAL
                # write and a full round trip — awaited before the response could
                # be built, on every app load. The rate-limited touch in deps.py
                # already does this job for ordinary requests; verify now uses the
                # same path instead of paying for it synchronously.
                #
                # Imported here, not at module level: deps.py imports verify_token
                # from this module, so a top-level import would be circular.
                from .deps import _touch_auth_session
                spawn(_touch_auth_session(str(row["session_id"])), name="touch-auth-session")
                from .deps import session_metadata
                auth_role = row["auth_role"] or session_metadata(row["metadata"]).get("auth_role") or "viewer"
                user_id_str = str(row["user_id"])
                # Fetch effective permissions for this user (union of role defaults + overrides)
                permissions: list[str] = []
                try:
                    from .deps import get_effective_permissions, seed_permission_cache
                    folded = row.get("permissions") if hasattr(row, "get") else None
                    if folded is not None:
                        permissions = sorted(str(k) for k in folded)
                        # The page requests that follow this call gate on the
                        # same set; seeding spares each of them the cold read.
                        seed_permission_cache(user_id_str, set(permissions))
                    else:
                        permissions = sorted(await get_effective_permissions(user_id_str))
                except Exception:
                    pass
                payload.update({
                    "auth_role": auth_role,
                    "session_id": str(row["session_id"]),
                    "permissions": permissions,
                    "user": {
                        "id": user_id_str,
                        "email": row["email"],
                        "first_name": row["first_name"],
                        "last_name": row["last_name"],
                        "full_name": row["full_name"],
                        "status": row["status"],
                        "avatar_url": row["avatar_url"],
                    },
                })
    except HTTPException:
        raise
    except Exception:
        # A database blip. Legacy tokens still verify on their signature; a
        # session-bound one cannot be checked, so say so rather than return it
        # as an unscoped legacy role. 503, not 401: the client keeps its token.
        if session_bound:
            raise HTTPException(status_code=503, detail="Sign-in service is temporarily unavailable")

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

    # The hint is just the token's first 16 characters — not a secret, and
    # for pre-nonce tokens it is guessable from the login second. Revoking by
    # hint is only safe once the signature proves the caller holds the token.
    # 200 rather than 401, as for a missing token: the client is discarding
    # its token either way, and a 401 would trip its session-expired redirect.
    if verify_token(token) is None:
        return {"logged_out": False, "reason": "invalid_token"}

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
                u.first_name,
                u.last_name,
                u.full_name,
                u.phone,
                u.job_title,
                u.department,
                u.company,
                u.location,
                u.timezone,
                u.teable_email,
                u.status,
                u.created_at,
                u.approved_at,
                u.password_changed_at,
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
                ) AS avatar_url,
                ARRAY_AGG(DISTINCT r.role_key ORDER BY r.role_key) FILTER (WHERE r.role_key IS NOT NULL) AS roles,
                COUNT(DISTINCT s.id) FILTER (WHERE s.revoked_at IS NULL AND s.expires_at > NOW()) AS active_sessions,
                COUNT(DISTINCT s.id) AS total_sessions,
                MAX(s.last_seen_at) AS last_seen_at
            FROM auth_sessions s
            JOIN auth_users u ON u.id = s.user_id
            LEFT JOIN auth_user_roles ur ON ur.user_id = u.id
            LEFT JOIN auth_roles r ON r.id = ur.role_id
            WHERE s.token_hint = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW()
            GROUP BY u.id, u.email, u.first_name, u.last_name, u.full_name, u.phone,
                     u.job_title, u.department, u.company, u.location, u.timezone,
                     u.teable_email, u.avatar_url, u.status, u.created_at, u.approved_at,
                     u.password_changed_at
            """,
            token_hint,
        )
        if not row:
            raise HTTPException(status_code=401, detail="Session not found or expired")
        user_id_str = row["id"]
        roles = list(row["roles"] or [])
        # Fetch linked identity providers
        identity_rows = await pool.fetch(
            "SELECT provider, provider_user_id, email, last_seen_at FROM auth_identities WHERE user_id = $1::uuid ORDER BY provider",
            user_id_str,
        )
        identities = [
            {
                "provider":         r["provider"],
                "provider_user_id": r["provider_user_id"],
                "email":            r["email"],
                "last_seen_at":     r["last_seen_at"].isoformat() if r["last_seen_at"] else None,
            }
            for r in identity_rows
        ]
        return {
            "id":                   user_id_str,
            "email":                row["email"],
            "first_name":           row["first_name"],
            "last_name":            row["last_name"],
            "full_name":            row["full_name"],
            "phone":                row["phone"],
            "job_title":            row["job_title"],
            "department":           row["department"],
            "company":              row["company"],
            "location":             row["location"],
            "timezone":             row["timezone"],
            "teable_email":         row["teable_email"],
            "avatar_url":           row["avatar_url"],
            "status":               row["status"],
            "role":                 roles[0] if roles else None,
            "roles":                roles,
            "identities":           identities,
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
    """Update the current user's profile details."""
    user_id = getattr(request.state, "auth_user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        from ..db.postgres import get_pool
        pool = get_pool()
        if not pool:
            raise HTTPException(status_code=503, detail="Database unavailable")
        def clean(value: str | None, limit: int) -> str | None:
            value = (value or "").strip()
            return value[:limit] if value else None

        # Resolve first_name / last_name — also accept legacy full_name split
        new_first = clean(body.first_name, 128)
        new_last  = clean(body.last_name,  128)
        if new_first is None and new_last is None and body.full_name:
            parts = (body.full_name or "").strip().split(" ", 1)
            new_first = parts[0] or None
            new_last  = parts[1].strip() if len(parts) > 1 else None
        computed_full = " ".join(filter(None, [new_first, new_last])) or None

        row = await pool.fetchrow(
            """
            UPDATE auth_users
               SET first_name = COALESCE($1, first_name),
                   last_name  = COALESCE($2, last_name),
                   full_name  = COALESCE($3, full_name),
                   phone      = $4,
                   job_title  = $5,
                   department = $6,
                   company    = $7,
                   location   = $8,
                   timezone   = $9,
                   updated_at = NOW()
             WHERE id = $10::uuid
             RETURNING first_name, last_name, full_name, email, phone, job_title, department, company, location, timezone
            """,
            new_first,
            new_last,
            computed_full,
            clean(body.phone, 40),
            clean(body.job_title, 120),
            clean(body.department, 120),
            clean(body.company, 160),
            clean(body.location, 160),
            clean(body.timezone, 80),
            user_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        return {
            "ok": True,
            "first_name": row["first_name"],
            "last_name":  row["last_name"],
            "full_name":  row["full_name"],
            "email": row["email"],
            "phone": row["phone"],
            "job_title": row["job_title"],
            "department": row["department"],
            "company": row["company"],
            "location": row["location"],
            "timezone": row["timezone"],
        }
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


# ── Profile picture (avatar) ─────────────────────────────────────────────────

_ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
_MAX_AVATAR_BYTES    = 4 * 1024 * 1024  # 4 MB
_EXT_FOR_MIME = {"image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp"}


@router.post("/profile/avatar")
async def upload_avatar(
    request: Request,
    file: UploadFile = File(...),
    _role: str = Depends(_require_email_auth),
):
    """Upload a profile picture. Returns {avatar_url} proxy path."""
    user_id = getattr(request.state, "auth_user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    content_type = (file.content_type or "").split(";")[0].strip().lower() or "image/jpeg"
    if content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, GIF, and WebP images are allowed")

    data = await file.read(_MAX_AVATAR_BYTES + 1)
    if len(data) > _MAX_AVATAR_BYTES:
        raise HTTPException(status_code=400, detail="Image too large (max 4 MB)")
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    if not settings.hf_token:
        raise HTTPException(status_code=503, detail="File storage not configured (HF_TOKEN missing)")

    ext = _EXT_FOR_MIME.get(content_type, "jpg")
    path_in_repo = f"profiles/{user_id}/avatar.{ext}"

    from ..services.storage import upload_bytes
    proxy_url = await upload_bytes(data, path_in_repo, content_type)
    # Cache-bust: every re-upload writes to the same path, but the file is served
    # with a 24h Cache-Control. Without a version suffix the browser would keep
    # showing the old cached bytes for this exact URL indefinitely.
    # Use milliseconds to handle multiple uploads in the same second.
    versioned_url = f"{proxy_url}?v={int(time.time() * 1000)}"

    from ..db.postgres import get_pool
    pool = get_pool()
    if pool:
        await pool.execute(
            "UPDATE auth_users SET avatar_url = $1, avatar_is_custom = TRUE, updated_at = NOW() WHERE id = $2::uuid",
            versioned_url, user_id,
        )

    return {"ok": True, "avatar_url": versioned_url}


@router.delete("/profile/avatar")
async def delete_avatar(
    request: Request,
    _role: str = Depends(_require_email_auth),
):
    """Remove the user's profile picture."""
    user_id = getattr(request.state, "auth_user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    from ..db.postgres import get_pool
    pool = get_pool()
    old_url: str | None = None
    if pool:
        row = await pool.fetchrow("SELECT avatar_url FROM auth_users WHERE id = $1::uuid", user_id)
        old_url = row["avatar_url"] if row else None

    if old_url:
        prefix = "/api/storage/file/"
        if old_url.startswith(prefix):
            from ..services.storage import delete_path
            file_path = old_url[len(prefix):].split("?", 1)[0]   # strip ?v= cache-bust suffix
            await delete_path(file_path)

    if pool:
        await pool.execute(
            "UPDATE auth_users SET avatar_url = NULL, avatar_is_custom = FALSE, updated_at = NOW() WHERE id = $1::uuid",
            user_id,
        )

    return {"ok": True}
