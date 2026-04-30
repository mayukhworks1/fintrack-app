"""
Password gate for the Fintrack app.

Two access levels:
  editor  — full access (create / edit / delete).  Password: settings.app_password
  viewer  — read-only (no mutations).              Password: settings.app_view_password

Token format:
  base64url("{expiry_ts}:{role}").base64url(hmac_sha256("{expiry_ts}:{role}", secret))

The role is embedded in the signed payload so the client can't forge it.
Old tokens (no colon / no role field) are treated as "editor" for backward compat.
"""

import base64
import hashlib
import hmac
import secrets
import time
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from ..config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    password: str


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
    Returns the role string ("editor" or "viewer") on success, None on failure.
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
            # Backward compat: old tokens have only the expiry timestamp
            expiry_str, role = decoded, "editor"
        expiry = int(expiry_str)
    except (ValueError, AttributeError):
        return None

    if time.time() >= expiry:
        return None

    return role


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/login")
async def login(body: LoginRequest):
    """
    Accept either the editor or viewer password (case-insensitive).
    Returns a signed token plus the role so the frontend can adjust its UI.
    """
    provided = (body.password or "").strip().lower()
    editor_pw = (settings.app_password or "").strip().lower()
    viewer_pw = (settings.app_view_password or "").strip().lower()
    web_pw    = (settings.app_web_password or "").strip().lower()

    # Constant-time comparisons to resist timing attacks
    is_editor = hmac.compare_digest(provided, editor_pw)
    is_viewer = hmac.compare_digest(provided, viewer_pw)
    is_web    = hmac.compare_digest(provided, web_pw)

    if is_editor:
        role = "editor"
    elif is_viewer:
        role = "viewer"
    elif is_web:
        role = "web"
    else:
        raise HTTPException(status_code=401, detail="Incorrect password")

    token = make_token(role=role)
    return {"token": token, "role": role, "expires_in": settings.app_session_ttl}


@router.get("/verify")
async def verify(authorization: str | None = Header(default=None)):
    """Validate a token and return its role. Used by the frontend on app start."""
    token = ""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()

    role = verify_token(token)
    if role is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return {"valid": True, "role": role}
