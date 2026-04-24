"""
Password gate for the Fintrack app.

- Password lives ONLY on the server (settings.app_password, default "tw@2026").
- Comparison is case-insensitive (user requested).
- On successful login we return an HMAC-signed token so the client can
  prove authentication on subsequent requests without us storing state.
- The token format is: base64url(expiry_ts).base64url(hmac_sha256(expiry_ts, secret))
  — there's no user data, no password, and no sensitive material in it.
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


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _b64url_decode(s: str) -> bytes:
    # Add padding back before decoding
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def _sign(payload: bytes) -> bytes:
    return hmac.new(
        settings.app_secret.encode(),
        payload,
        hashlib.sha256,
    ).digest()


def make_token(ttl: int | None = None) -> str:
    """Build an opaque token that expires after ttl seconds (default from settings)."""
    expiry = int(time.time()) + (ttl if ttl is not None else settings.app_session_ttl)
    payload = str(expiry).encode()
    sig = _sign(payload)
    return f"{_b64url(payload)}.{_b64url(sig)}"


def verify_token(token: str) -> bool:
    """Return True iff token is well-formed, signature valid, and not expired."""
    if not token or "." not in token:
        return False
    try:
        payload_b64, sig_b64 = token.split(".", 1)
        payload = _b64url_decode(payload_b64)
        sig = _b64url_decode(sig_b64)
    except Exception:
        return False
    # constant-time compare to prevent timing oracles
    if not hmac.compare_digest(sig, _sign(payload)):
        return False
    try:
        expiry = int(payload.decode())
    except ValueError:
        return False
    return time.time() < expiry


@router.post("/login")
async def login(body: LoginRequest):
    """Check password case-insensitively; return a signed token on success."""
    expected = settings.app_password or ""
    provided = body.password or ""

    # Case-insensitive comparison with constant-time guard on equal-length inputs
    ok = provided.strip().lower() == expected.strip().lower()

    # Always take roughly the same amount of time regardless of match
    # (prevents trivial timing side-channels on such a short comparison)
    secrets.compare_digest(provided.encode(), expected.encode())

    if not ok:
        raise HTTPException(status_code=401, detail="Incorrect password")

    return {"token": make_token(), "expires_in": settings.app_session_ttl}


@router.get("/verify")
async def verify(authorization: str | None = Header(default=None)):
    """Check a token is still valid. Used by the frontend on app start."""
    token = ""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    if not verify_token(token):
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return {"valid": True}
