"""
Password protection for shared view links, and "request the password".

  * A link may carry a password. Only its hash is checked (the published
    pages scheme); an encrypted copy (the MultiFernet helper in services/ai_gateway.py) is
    kept so an approved request can be emailed the password.
  * The right password mints a short-lived unlock token, signed over the
    link's password_version: changing or removing the password ends every
    unlock already handed out. The public data endpoints accept nothing else.
  * A visitor without the password can ask for it. The owner (and every
    superadmin) is told in the app and by email, with signed Approve / Deny
    links that expire. Requests from the link's auto-approve domains are
    answered at once. Every request, decision and send is written to
    auth_events.

Signed email links open a confirmation page; only its POST acts. Mail
scanners that prefetch links therefore cannot approve anything.
"""

from __future__ import annotations

import hashlib
import hmac
import html
import json
import logging
import re
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlencode, urlparse

from ..config import settings
from ..utils.client_ip import client_ip

logger = logging.getLogger("fintrack.share_access")

PASSWORD_MIN = 8
PASSWORD_MAX = 128
UNLOCK_TTL_SECONDS = 6 * 60 * 60          # the same lifetime as a page unlock
ACTION_LINK_TTL_SECONDS = 7 * 24 * 60 * 60
MAX_AUTO_DOMAINS = 20

# Rate limits: (limit, window seconds).
UNLOCK_LIMIT_PER_IP = (10, 15 * 60)
UNLOCK_LIMIT_PER_LINK = (60, 15 * 60)
REQUEST_LIMIT_PER_IP = (5, 60 * 60)
REQUEST_LIMIT_PER_LINK = (20, 60 * 60)

NAME_MAX = 100
MESSAGE_MAX = 1000
NOTE_MAX = 1000


# ── Passwords ────────────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    """The published pages scheme (routers/pages.py _hash_password)."""
    return hashlib.sha256(password.encode()).hexdigest()


def password_matches(password: str, stored_hash: Optional[str]) -> bool:
    if not stored_hash or not isinstance(password, str):
        return False
    return hmac.compare_digest(hash_password(password), stored_hash)


def validate_password(password: Any) -> str:
    if not isinstance(password, str):
        raise ValueError("Password must be text")
    if len(password) < PASSWORD_MIN:
        raise ValueError(f"Password must be at least {PASSWORD_MIN} characters")
    if len(password) > PASSWORD_MAX:
        raise ValueError(f"Password must be at most {PASSWORD_MAX} characters")
    if any(ord(c) < 32 for c in password):
        raise ValueError("Password cannot contain control characters")
    return password


def encrypt_password(password: str) -> str:
    from .ai_gateway import encrypt_key
    return encrypt_key(password)


def decrypt_password(token: Optional[str]) -> Optional[str]:
    if not token:
        return None
    from .ai_gateway import decrypt_key
    return decrypt_key(token)


class PasswordRequired(Exception):
    """The link has a password and the request carried no valid unlock token."""


def require_unlocked(view: dict, unlock: Optional[str]) -> None:
    if view.get("is_password_protected") and not unlock_token_valid(
            view.get("token") or "", view.get("password_version") or 0, unlock):
        raise PasswordRequired()


# ── Unlock tokens (the pages token style, scoped to a link + version) ───────

def _sign(payload: str, length: int = 32) -> str:
    return hmac.new(settings.app_secret.encode(), payload.encode(), hashlib.sha256).hexdigest()[:length]


def unlock_token(view_token: str, version: int, ttl: int = UNLOCK_TTL_SECONDS) -> str:
    expiry = int(time.time()) + ttl
    return f"{expiry}.{_sign(f'shared-view:{expiry}:{view_token}:{int(version or 0)}')}"


def unlock_token_valid(view_token: str, version: int, token: Optional[str]) -> bool:
    if not token or "." not in token:
        return False
    expiry_raw, _, sig = token.partition(".")
    try:
        expiry = int(expiry_raw)
    except ValueError:
        return False
    if expiry < time.time():
        return False
    expected = _sign(f"shared-view:{expiry}:{view_token}:{int(version or 0)}")
    return hmac.compare_digest(sig, expected)


# ── Signed approve / deny links ──────────────────────────────────────────────

ACTIONS = ("approve", "deny")


def action_signature(request_id: str, action: str, expiry: int) -> str:
    return _sign(f"share-access:{action}:{request_id}:{int(expiry)}", 64)


def action_params(request_id: str, action: str, ttl: int = ACTION_LINK_TTL_SECONDS) -> dict:
    expiry = int(time.time()) + ttl
    return {"r": str(request_id), "a": action, "e": str(expiry), "s": action_signature(str(request_id), action, expiry)}


def verify_action(request_id: str, action: str, expiry: Any, sig: Any) -> str:
    """'ok', 'expired' or 'invalid'."""
    if action not in ACTIONS or not request_id or not isinstance(sig, str):
        return "invalid"
    try:
        exp = int(expiry)
    except (TypeError, ValueError):
        return "invalid"
    if not hmac.compare_digest(sig, action_signature(str(request_id), action, exp)):
        return "invalid"
    if exp < time.time():
        return "expired"
    return "ok"


# ── Input validation ─────────────────────────────────────────────────────────

_LOCAL_RE = re.compile(r"^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$")
_LABEL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
_TLD_RE = re.compile(r"^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$")


def normalize_domain(raw: Any) -> str:
    if not isinstance(raw, str):
        raise ValueError("Enter a domain like example.com")
    d = raw.strip().lower().lstrip("@").rstrip(".")
    if not d or len(d) > 253:
        raise ValueError("Enter a domain like example.com")
    labels = d.split(".")
    if len(labels) < 2 or not all(_LABEL_RE.match(lbl) for lbl in labels) or not _TLD_RE.match(labels[-1]):
        raise ValueError(f"{raw.strip()[:60]} is not a valid domain")
    return d


def validate_email(raw: Any) -> str:
    """A strict address check: one @, a dot-atom local part of at most 64
    characters, a DNS hostname with an alphabetic TLD, 254 characters in all.
    No quoted local parts, IP literals, whitespace or control characters.
    Returns the address with its domain lower-cased."""
    msg = "Enter a valid email address, like name@company.com"
    if not isinstance(raw, str):
        raise ValueError(msg)
    email = raw.strip()
    if not email or len(email) > 254 or any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in email):
        raise ValueError(msg)
    if email.count("@") != 1:
        raise ValueError(msg)
    local, domain = email.split("@")
    if not local or len(local) > 64 or not _LOCAL_RE.match(local):
        raise ValueError(msg)
    try:
        domain = normalize_domain(domain)
    except ValueError:
        raise ValueError(msg) from None
    return f"{local}@{domain}"


def clean_text(raw: Any, limit: int, *, single_line: bool) -> str:
    if raw is None:
        return ""
    s = str(raw)
    if single_line:
        s = " ".join(s.split())
    else:
        s = "".join(c for c in s if c in "\n\t" or ord(c) >= 32).strip()
    return s[:limit]


def normalize_domains(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        raw = re.split(r"[\s,;]+", raw)
    if not isinstance(raw, list):
        raise ValueError("Auto-approve domains must be a list")
    out: list[str] = []
    for item in raw:
        if isinstance(item, str) and not item.strip():
            continue
        d = normalize_domain(item)
        if d not in out:
            out.append(d)
    if len(out) > MAX_AUTO_DOMAINS:
        raise ValueError(f"At most {MAX_AUTO_DOMAINS} auto-approve domains")
    return out


def email_domain(email: str) -> str:
    return email.rsplit("@", 1)[-1].lower()


def domain_auto_approved(email: str, domains: list[str]) -> bool:
    """Exact domain match only: theworks.in does not cover evil-theworks.in
    or mail.theworks.in."""
    return email_domain(email) in {d.lower() for d in (domains or [])}


# ── Rate limiting ────────────────────────────────────────────────────────────
# Valkey when it is connected; otherwise an in-process window, so a missing
# cache never means unlimited password guesses.

_local_hits: dict[str, deque] = {}


def _local_check(key: str, limit: int, window: int) -> bool:
    now = time.monotonic()
    q = _local_hits.setdefault(key, deque())
    while q and q[0] <= now - window:
        q.popleft()
    q.append(now)
    if len(_local_hits) > 50_000:
        for k in list(_local_hits)[:10_000]:
            _local_hits.pop(k, None)
    return len(q) <= limit


def reset_rate_limits() -> None:
    _local_hits.clear()


async def rate_ok(key: str, limit: int, window: int) -> bool:
    from ..db import valkey
    if getattr(valkey, "_client", None):
        allowed, _ = await valkey.rate_check(key, limit=limit, window_sec=window, bucket="share-access")
        return allowed
    return _local_check(key, limit, window)


# ── Secret columns ───────────────────────────────────────────────────────────

SECRET_SQL = (
    "SELECT token, title, resource_type, is_active, expires_at, password_hash, password_enc, "
    "password_version, auto_approve_domains, owner_user_id FROM shared_views WHERE token = $1"
)


def load_json_list(value: Any) -> list:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            return []
    return value if isinstance(value, list) else []


def link_expired(expires_at: Any) -> bool:
    if not expires_at:
        return False
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at < datetime.now(timezone.utc)


def password_columns(password: Optional[str]) -> dict:
    """The column values for setting (a string) or removing (None) a password."""
    if password is None:
        return {"password_hash": None, "password_enc": None}
    validate_password(password)
    return {"password_hash": hash_password(password), "password_enc": encrypt_password(password)}


# ── Audit (auth_events, the app's audit trail for security events) ──────────

async def audit(conn, event_type: str, *, request=None, actor_user_id: Optional[str] = None,
                email: Optional[str] = None, status: str = "ok", metadata: Optional[dict] = None) -> None:
    try:
        state = getattr(request, "state", None)
        actor = actor_user_id or (getattr(state, "auth_user_id", None) if state else None)
        role = (getattr(state, "auth_role", None) or getattr(state, "role", None)) if state else None
        await conn.execute(
            "INSERT INTO auth_events (event_type, actor_user_id, role, email, status, ip, user_agent, "
            "request_id, metadata) VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9::jsonb)",
            event_type,
            _uuid_or_none(actor),
            (str(role)[:60] if role else None),
            (email or None),
            status,
            (client_ip(request)[:45] if request is not None else None) or None,
            (request.headers.get("user-agent", "")[:500] if request is not None else None),
            (getattr(state, "request_id", None) if state else None),
            json.dumps(metadata or {}, default=str),
        )
    except Exception as exc:  # an audit failure never undoes the action
        logger.warning("share access audit %s not written: %s", event_type, exc)


def _uuid_or_none(value: Any) -> Optional[str]:
    if not value:
        return None
    import uuid
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError):
        return None


# ── Origins ──────────────────────────────────────────────────────────────────

def frontend_origin(request=None, stored: Optional[str] = None) -> str:
    raw = (settings.frontend_url or "").strip()
    if raw and raw != "*":
        return raw.split(",")[0].strip().rstrip("/")
    if stored:
        return stored
    if request is not None:
        return origin_from_headers(request)
    return ""


def origin_from_headers(request) -> str:
    raw = request.headers.get("origin") or request.headers.get("referer") or ""
    try:
        u = urlparse(raw)
    except ValueError:
        return ""
    if u.scheme in ("http", "https") and u.netloc and len(u.netloc) <= 180:
        return f"{u.scheme}://{u.netloc}"
    return ""


def api_origin(request=None) -> str:
    configured = (getattr(settings, "public_api_url", None) or "").strip()
    if configured:
        return configured.rstrip("/")
    if request is None:
        return ""
    base = str(request.base_url).rstrip("/")
    proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip()
    if proto == "https" and base.startswith("http://"):
        base = "https://" + base[len("http://"):]
    return base


def action_url(base: str, request_id: str, action: str) -> str:
    return f"{base}/api/public/view-access/decide?{urlencode(action_params(request_id, action))}"


# ── Emails ───────────────────────────────────────────────────────────────────

_e = html.escape


def _button(href: str, label: str, color: str) -> str:
    return (
        f'<a href="{_e(href)}" style="display:inline-block;background:{color};color:#ffffff;text-decoration:none;'
        f'font-weight:700;font-size:14px;padding:12px 22px;border-radius:10px;font-family:Inter,Arial,sans-serif;'
        f'margin:0 8px 8px 0">{_e(label)}</a>'
    )


def _fmt_expiry(expires_at: Any) -> str:
    if not expires_at:
        return "It does not expire."
    if isinstance(expires_at, str):
        try:
            expires_at = datetime.fromisoformat(expires_at)
        except ValueError:
            return f"It expires {expires_at}."
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return "It expires on " + expires_at.strftime("%d %b %Y, %H:%M UTC") + "."


def owner_email(*, link_title: str, name: str, email: str, message: str, approve_href: str,
                deny_href: str, review_href: str, to_email: str) -> tuple[str, str, str]:
    from .emailer import email_wrap_html
    subject = f"{name} asked for the password to “{link_title}”"
    msg_html = (
        f'<p style="margin:16px 0 0;padding:12px 14px;background:#f8fafc;border-left:3px solid #2563eb;'
        f'border-radius:6px;color:#334155;white-space:pre-wrap">{_e(message)}</p>' if message else ""
    )
    review = (f'<p style="margin:16px 0 0;font-size:13px;color:#64748b">Or review it in FinTrack: '
              f'<a href="{_e(review_href)}" style="color:#2563eb">Links → Access requests</a></p>') if review_href else ""
    body = f"""
      <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a">Password request for a shared link</h1>
      <p style="margin:0">Someone asked for the password to <strong>{_e(link_title)}</strong>.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0 0;font-size:14px;color:#334155">
        <tr><td style="padding:2px 12px 2px 0;color:#64748b">Name</td><td><strong>{_e(name)}</strong></td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#64748b">Email</td><td>{_e(email)}</td></tr>
      </table>
      {msg_html}
      <p style="margin:20px 0 8px">Approving emails them the link and its current password.</p>
      <div>{_button(approve_href, "Approve & send password", "#16a34a")}{_button(deny_href, "Deny", "#64748b")}</div>
      <p style="margin:8px 0 0;font-size:12px;color:#94a3b8">These buttons work for 7 days and ask you to confirm.
      If you don't recognise this person, deny the request or ignore this email.</p>
      {review}
    """
    text = (
        f"{name} <{email}> asked for the password to \"{link_title}\".\n"
        + (f"\nMessage:\n{message}\n" if message else "")
        + f"\nApprove & send password: {approve_href}\nDeny: {deny_href}\n"
        + (f"\nReview in FinTrack: {review_href}\n" if review_href else "")
    )
    return subject, text, email_wrap_html(_e(subject), f"{name} is asking for access", body, to_email)


def approved_email(*, link_title: str, name: str, url: str, password: Optional[str], expires_at: Any,
                   to_email: str) -> tuple[str, str, str]:
    from .emailer import email_wrap_html
    subject = f"Your access to “{link_title}”"
    pw_block = (
        f"""<p style="margin:20px 0 6px;font-size:13px;color:#64748b">Password</p>
      <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:18px;letter-spacing:0.5px;padding:14px 16px;
        background:#f1f5f9;border:1px solid #e2e8f0;border-radius:10px;color:#0f172a;word-break:break-all">{_e(password)}</div>"""
        if password else
        '<p style="margin:20px 0 0;color:#334155">This link no longer needs a password.</p>'
    )
    body = f"""
      <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a">You're in, {_e(name)}</h1>
      <p style="margin:0">Your request to view <strong>{_e(link_title)}</strong> was approved.</p>
      {pw_block}
      <div style="margin:22px 0 8px">{_button(url, "Open the shared view", "#2563eb")}</div>
      <p style="margin:0;font-size:13px;color:#64748b;word-break:break-all">{_e(url)}</p>
      <p style="margin:16px 0 0;font-size:13px;color:#64748b">{_e(_fmt_expiry(expires_at))}
      Please keep the password to yourself; it may be changed at any time.</p>
    """
    text = (
        f"Hi {name},\n\nYour request to view \"{link_title}\" was approved.\n\n"
        f"Link: {url}\n" + (f"Password: {password}\n" if password else "This link no longer needs a password.\n")
        + f"\n{_fmt_expiry(expires_at)}\n"
    )
    return subject, text, email_wrap_html(_e(subject), "Your request was approved", body, to_email)


def denied_email(*, link_title: str, name: str, note: str, to_email: str) -> tuple[str, str, str]:
    from .emailer import email_wrap_html
    subject = f"About your request for “{link_title}”"
    note_html = (f'<p style="margin:16px 0 0;padding:12px 14px;background:#f8fafc;border-radius:6px;'
                 f'color:#334155;white-space:pre-wrap">{_e(note)}</p>') if note else ""
    body = f"""
      <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a">Hi {_e(name)},</h1>
      <p style="margin:0">Thanks for your interest in <strong>{_e(link_title)}</strong>. The owner of this link
      isn't able to share the password right now.</p>
      {note_html}
      <p style="margin:16px 0 0;color:#334155">If you think this is a mistake, please contact the person who sent
      you the link.</p>
    """
    text = (f"Hi {name},\n\nThanks for your interest in \"{link_title}\". The owner of this link isn't able to "
            f"share the password right now.\n" + (f"\n{note}\n" if note else "")
            + "\nIf you think this is a mistake, please contact the person who sent you the link.\n")
    return subject, text, email_wrap_html(_e(subject), "An update on your request", body, to_email)


async def send_mail(to: str, subject: str, text: str, html_body: str) -> dict:
    from . import emailer
    return await emailer.send_email(to, subject, text, html_body)


def mailer_configured() -> bool:
    from . import emailer
    return emailer.is_email_configured()


# ── Requests ─────────────────────────────────────────────────────────────────

REQUEST_COLUMNS = (
    "r.id, r.view_token, r.name, r.email, r.message, r.ip, r.user_agent, r.status, r.decided_via, "
    "r.decision_note, r.sent_at, r.decided_at, r.created_at, r.updated_at, r.decided_by"
)


def request_dict(row) -> dict:
    out: dict[str, Any] = {}
    for k, v in dict(row).items():
        if hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        elif k in ("id", "decided_by") and v is not None:
            out[k] = str(v)
        else:
            out[k] = v
    return out


async def recipients(conn, owner_user_id: Optional[str]) -> list[dict]:
    """The link's owner and every active superadmin."""
    rows = await conn.fetch(
        """
        SELECT DISTINCT u.id, u.email, u.full_name FROM auth_users u
        WHERE u.status = 'active' AND (
              u.id = $1::uuid
           OR EXISTS (SELECT 1 FROM auth_user_roles ur JOIN auth_roles r ON r.id = ur.role_id
                      WHERE ur.user_id = u.id AND r.role_key = 'superadmin'))
        """,
        _uuid_or_none(owner_user_id),
    )
    return [{"id": str(r["id"]), "email": r["email"], "name": r["full_name"] or ""} for r in rows]


async def notify_owners(pool, view: dict, req: dict, request) -> None:
    """In-app notification and email for one new request. Runs after the
    request is stored; a failure is logged and never reaches the visitor."""
    title = view.get("title") or "Shared view"
    try:
        async with pool.acquire() as conn:
            people = await recipients(conn, view.get("owner_user_id"))
            payload = {
                "view_token": view["token"], "view_title": title, "resource_type": view.get("resource_type"),
                "request_id": req["id"], "requester_name": req["name"], "requester_email": req["email"],
                "excerpt": f"{req['name']} ({req['email']}) asked for the password",
            }
            if people:
                await conn.executemany(
                    "INSERT INTO notifications (user_id, kind, payload) VALUES ($1::uuid, 'access_request', $2::jsonb)",
                    [(p["id"], json.dumps(payload)) for p in people],
                )
    except Exception as exc:
        logger.warning("access request notification failed: %s", exc)
        people = []

    if not people or not mailer_configured():
        return
    base = api_origin(request)
    fe = frontend_origin()
    review = f"{fe}/{_PAGE_FOR.get(view.get('resource_type') or 'status', 'status')}?links=requests" if fe else ""
    for p in people:
        subject, text, body = owner_email(
            link_title=title, name=req["name"], email=req["email"], message=req.get("message") or "",
            approve_href=action_url(base, req["id"], "approve"), deny_href=action_url(base, req["id"], "deny"),
            review_href=review, to_email=p["email"],
        )
        try:
            await send_mail(p["email"], subject, text, body)
        except Exception as exc:
            logger.warning("owner email for access request failed: %s", exc)


_PAGE_FOR = {"status": "status", "projects": "projects", "invoices": "invoices", "tax-ledger": "tax"}


async def decide(pool, request_id: str, action: str, *, request=None, via: str = "app",
                 actor_user_id: Optional[str] = None, note: str = "", notify: bool = True) -> dict:
    """Approve or deny one request.

    Approval emails the requester the link and the link's CURRENT password
    (decrypted now, so a request made before a password change gets the new
    one). Without a mailer, or when sending fails, the request is still
    approved and the password comes back for the owner to pass on.

    Returns {status, sent, reason?, password?, request}. `password` is only
    present when it could not be emailed; the email-link route never shows it.
    """
    if action not in ACTIONS:
        raise ValueError("Unknown action")
    note = clean_text(note, NOTE_MAX, single_line=False)
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                f"SELECT {REQUEST_COLUMNS}, r.link_origin FROM shared_view_access_requests r "
                "WHERE r.id = $1::uuid FOR UPDATE", request_id)
            if not row:
                raise LookupError("Request not found")
            if row["status"] != "pending":
                return {"status": row["status"], "already": True, "sent": False, "request": request_dict(row)}
            view = await conn.fetchrow(SECRET_SQL, row["view_token"])
            if not view:
                raise LookupError("Link not found")
            password = None
            if action == "approve":
                if not view["is_active"]:
                    raise ValueError("This link is disabled. Enable it before approving requests.")
                if link_expired(view["expires_at"]):
                    raise ValueError("This link has expired. Extend it before approving requests.")
                if view["password_hash"]:
                    password = decrypt_password(view["password_enc"])
                    if not password:
                        raise ValueError("The stored password can't be read (the encryption secret changed). "
                                         "Set a new password on this link, then approve.")
            updated = await conn.fetchrow(
                "UPDATE shared_view_access_requests SET status = $2, decided_by = $3::uuid, decided_via = $4, "
                "decision_note = NULLIF($5, ''), decided_at = NOW(), updated_at = NOW() WHERE id = $1::uuid "
                f"RETURNING {REQUEST_COLUMNS.replace('r.', '')}",
                request_id, "approved" if action == "approve" else "denied", _uuid_or_none(actor_user_id), via, note,
            )
            await audit(conn, f"share_access.{'approved' if action == 'approve' else 'denied'}", request=request,
                        actor_user_id=actor_user_id, email=row["email"],
                        metadata={"view_token": row["view_token"], "request_id": str(row["id"]), "via": via})

    title = view["title"] or "Shared view"
    result: dict[str, Any] = {"status": updated["status"], "sent": False, "request": request_dict(updated)}
    if action == "deny":
        if notify and mailer_configured():
            subject, text, body = denied_email(link_title=title, name=row["name"], note=note, to_email=row["email"])
            sent = await send_mail(row["email"], subject, text, body)
            result["sent"] = bool(sent.get("sent"))
        return result

    url = f"{frontend_origin(stored=row['link_origin'])}/view/{row['view_token']}"
    if not mailer_configured():
        result.update(reason="email_not_configured", password=password, url=url)
        async with pool.acquire() as conn:
            await audit(conn, "share_access.send_skipped", request=request, actor_user_id=actor_user_id,
                        email=row["email"], status="manual",
                        metadata={"view_token": row["view_token"], "request_id": str(row["id"]),
                                  "reason": "email_not_configured"})
        return result
    subject, text, body = approved_email(link_title=title, name=row["name"], url=url, password=password,
                                         expires_at=view["expires_at"], to_email=row["email"])
    sent = await send_mail(row["email"], subject, text, body)
    ok = bool(sent.get("sent"))
    async with pool.acquire() as conn:
        if ok:
            await conn.execute("UPDATE shared_view_access_requests SET sent_at = NOW(), updated_at = NOW() "
                               "WHERE id = $1::uuid", request_id)
        await audit(conn, "share_access.sent" if ok else "share_access.send_failed", request=request,
                    actor_user_id=actor_user_id, email=row["email"], status="ok" if ok else "error",
                    metadata={"view_token": row["view_token"], "request_id": str(row["id"]), "via": via,
                              **({} if ok else {"reason": sent.get("reason")})})
    result["sent"] = ok
    if not ok:
        result.update(reason=sent.get("reason") or "send_failed", password=password, url=url)
    return result
