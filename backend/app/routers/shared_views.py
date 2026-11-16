"""
Shared Views — /api/shared-views  (editor-auth)
             — /api/public/view/{token}  (public, no auth)

Editor endpoints: full CRUD + access log
Public endpoint: read-only, no auth, geo-tracked
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from ..db.postgres import get_pool
from ..services import share_access as SA
from ..services.shared_views import SharedViewService
from ..utils.client_ip import client_ip
from .deps import require_editor, require_permission, get_effective_permissions

router = APIRouter(tags=["shared-views"])


# ── Pydantic models ────────────────────────────────────────────────────────────

class SharedViewCreate(BaseModel):
    title: Optional[str] = None
    record_ids: list[str]
    expires_hours: Optional[int] = None   # None = never expires
    access_mode: Optional[str] = "read"   # read | edit
    resource_type: Optional[str] = "status"
    view_config: Optional[dict] = None    # view type, columns etc — stored in PG, sent to public viewer
    password: Optional[str] = None        # the link asks for it; only a hash (+ encrypted copy) is kept
    auto_approve_domains: Optional[list[str]] = None


class SharedViewUpdate(BaseModel):
    title: Optional[str] = None
    is_active: Optional[bool] = None
    expires_hours: Optional[int] = None   # -1 = remove expiry
    access_mode: Optional[str] = None
    record_ids: Optional[list[str]] = None
    view_config: Optional[dict] = None
    password: Optional[str] = None        # set or change the password
    remove_password: Optional[bool] = None
    auto_approve_domains: Optional[list[str]] = None


class UnlockBody(BaseModel):
    password: str = Field("", max_length=1000)


class AccessRequestBody(BaseModel):
    name: str = Field("", max_length=1000)
    email: str = Field("", max_length=1000)
    message: Optional[str] = Field(None, max_length=5000)
    # Honeypot: hidden from people, filled in by form-spamming bots.
    website: Optional[str] = Field(None, max_length=1000)


class DecisionBody(BaseModel):
    note: Optional[str] = Field(None, max_length=5000)
    notify: bool = True


class PublicSharedViewUpdate(BaseModel):
    # status
    status: Optional[str] = None
    short_status: Optional[str] = None
    current_status_detailed: Optional[str] = None
    # projects
    client: Optional[str] = None
    project_name: Optional[str] = None
    project_status: Optional[str] = None
    amount_billed: Optional[float] = None
    # invoices
    invoice_number: Optional[str] = None
    payment_status: Optional[str] = None
    amount_received: Optional[float] = None
    cleared_date: Optional[str] = None
    remark: Optional[str] = None
    next_followup: Optional[str] = None


class SharedViewAccessDelete(BaseModel):
    access_ids: list[str]


class PublicEventBody(BaseModel):
    event_type: str   # record_detail | attachment_open
    record_id: Optional[str] = None
    meta: Optional[dict] = None  # e.g. {"file_name": "...", "file_type": "pdf"}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _expiry(hours: Optional[int]) -> Optional[datetime]:
    if hours is None or hours == 0:
        return None
    if hours == -1:
        return None
    return datetime.now(timezone.utc) + timedelta(hours=hours)


# Tax ledger shares need module.tax.share; every other module uses module.shared.manage.
# Keys are SharedViewService's resource types — what the pages actually send.
_SHARE_PERMISSIONS = {"tax-ledger": "module.tax.share"}


async def _require_share_permission(request: Request, resource_type: Optional[str]) -> None:
    perm_key = _SHARE_PERMISSIONS.get(resource_type or "status", "module.shared.manage")
    if getattr(request.state, "is_email_auth", False):
        auth_role = getattr(request.state, "auth_role", "") or ""
        if auth_role != "superadmin":
            effective = await get_effective_permissions(getattr(request.state, "auth_user_id", None))
            if perm_key not in effective:
                raise HTTPException(status_code=403, detail=f"Missing permission: {perm_key}")


# ── Editor CRUD ────────────────────────────────────────────────────────────────

@router.post("/api/shared-views", status_code=201)
async def create_shared_view(
    request: Request,
    body: SharedViewCreate,
    role: str = Depends(require_editor),
):
    """Create a shared link for selected records."""
    await _require_share_permission(request, body.resource_type)
    if not body.record_ids:
        raise HTTPException(status_code=422, detail="At least one record must be selected")
    if len(body.record_ids) > 50:
        raise HTTPException(status_code=422, detail="Maximum 50 records per share link")

    svc = SharedViewService()
    try:
        view = await svc.create(
            title=body.title,
            record_ids=body.record_ids,
            role=role,
            ip=client_ip(request),
            expires_at=_expiry(body.expires_hours),
            access_mode=body.access_mode or "read",
            view_config=body.view_config,
            resource_type=body.resource_type or "status",
            password=body.password or None,
            auto_approve_domains=body.auto_approve_domains,
            owner_user_id=getattr(request.state, "auth_user_id", None),
        )
        return view
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/shared-views")
async def list_shared_views(
    resource_type: Optional[str] = Query(None),
    _: str = Depends(require_editor),
    _perm: str = Depends(require_permission("module.shared.manage")),
):
    """List shared links (newest first), optionally filtered by module."""
    svc = SharedViewService()
    views = await svc.list_all(resource_type=resource_type)
    return {"views": views, "total": len(views)}


# ── Access requests (owner side) ──────────────────────────────────────────────
# Declared before /api/shared-views/{token} so "access-requests" is not read
# as a link token.

def _pool_or_503():
    pool = get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database unavailable")
    return pool


@router.get("/api/shared-views/access-requests")
async def list_access_requests(
    resource_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    token: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    _: str = Depends(require_editor),
    _perm: str = Depends(require_permission("module.shared.manage")),
):
    """Requests for the password of protected links, pending first."""
    pool = _pool_or_503()
    if status and status not in ("pending", "approved", "denied"):
        raise HTTPException(status_code=400, detail="Unknown status")
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"SELECT {SA.REQUEST_COLUMNS}, v.title AS view_title, v.resource_type, "
            "(v.password_hash IS NOT NULL) AS view_protected "
            "FROM shared_view_access_requests r JOIN shared_views v ON v.token = r.view_token "
            "WHERE ($1::text IS NULL OR v.resource_type = $1) AND ($2::text IS NULL OR r.status = $2) "
            "AND ($3::text IS NULL OR r.view_token = $3) "
            "ORDER BY (r.status = 'pending') DESC, r.created_at DESC LIMIT $4",
            resource_type, status, token, limit,
        )
    items = [SA.request_dict(r) for r in rows]
    return {"requests": items, "pending": sum(1 for r in items if r["status"] == "pending"),
            "mailer_configured": SA.mailer_configured()}


async def _decide_in_app(request: Request, request_id: str, action: str, body: "DecisionBody") -> dict:
    pool = _pool_or_503()
    if not SA._uuid_or_none(request_id):
        raise HTTPException(status_code=404, detail="Request not found")
    try:
        result = await SA.decide(
            pool, request_id, action, request=request, via="app",
            actor_user_id=getattr(request.state, "auth_user_id", None),
            note=body.note or "", notify=body.notify,
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if result.get("already"):
        raise HTTPException(status_code=409, detail=f"This request was already {result['status']}.")
    return result


@router.post("/api/shared-views/access-requests/{request_id}/approve")
async def approve_access_request(
    request: Request, request_id: str, body: Optional[DecisionBody] = None,
    _: str = Depends(require_editor),
    _perm: str = Depends(require_permission("module.shared.manage")),
):
    """Approve and email the link's current password. Without a mailer (or
    when sending fails) the password comes back for the owner to pass on."""
    return await _decide_in_app(request, request_id, "approve", body or DecisionBody())


@router.post("/api/shared-views/access-requests/{request_id}/deny")
async def deny_access_request(
    request: Request, request_id: str, body: Optional[DecisionBody] = None,
    _: str = Depends(require_editor),
    _perm: str = Depends(require_permission("module.shared.manage")),
):
    return await _decide_in_app(request, request_id, "deny", body or DecisionBody())


@router.get("/api/shared-views/{token}/password")
async def reveal_shared_view_password(
    request: Request,
    token: str,
    _: str = Depends(require_editor),
    _perm: str = Depends(require_permission("module.shared.manage")),
):
    """The owner's "show": the current password, decrypted. Audited."""
    pool = _pool_or_503()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(SA.SECRET_SQL, token)
        if not row:
            raise HTTPException(status_code=404, detail="Shared view not found")
        if not row["password_hash"]:
            return {"password": None, "is_password_protected": False}
        if row["resource_type"] in _SHARE_PERMISSIONS:
            await _require_share_permission(request, row["resource_type"])
        password = SA.decrypt_password(row["password_enc"])
        await SA.audit(conn, "share_password.revealed", request=request, metadata={"view_token": token})
    if password is None:
        raise HTTPException(status_code=409, detail="The stored password can't be read. Set a new one.")
    return {"password": password, "is_password_protected": True}


@router.get("/api/shared-views/{token}")
async def get_shared_view(
    token: str,
    _: str = Depends(require_editor),
    _perm: str = Depends(require_permission("module.shared.manage")),
):
    svc = SharedViewService()
    view = await svc.get(token)
    if not view:
        raise HTTPException(status_code=404, detail="Shared view not found")
    return view


@router.patch("/api/shared-views/{token}")
async def update_shared_view(
    request: Request,
    token: str,
    body: SharedViewUpdate,
    _: str = Depends(require_editor),
    _perm: str = Depends(require_permission("module.shared.manage")),
):
    """Update title, active state, or expiry of a shared view."""
    svc = SharedViewService()
    # Re-scoping or re-enabling a tax ledger link is as sensitive as creating one.
    existing = await svc.get(token)
    if existing and existing.get("resource_type") in _SHARE_PERMISSIONS:
        await _require_share_permission(request, existing.get("resource_type"))

    data: dict = {}
    if body.title is not None:
        data["title"] = body.title
    if body.is_active is not None:
        data["is_active"] = body.is_active
    if body.expires_hours is not None:
        if body.expires_hours == -1:
            data["expires_at"] = None
        else:
            data["expires_at"] = _expiry(body.expires_hours)
    if body.access_mode is not None:
        data["access_mode"] = body.access_mode
    if body.record_ids is not None:
        data["record_ids"] = body.record_ids
    if body.view_config is not None:
        data["view_config"] = body.view_config
    if body.remove_password:
        data["password"] = None
    elif body.password is not None:
        data["password"] = body.password
    if body.auto_approve_domains is not None:
        data["auto_approve_domains"] = body.auto_approve_domains

    try:
        view = await svc.update(token, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not view:
        raise HTTPException(status_code=404, detail="Shared view not found")
    if "password" in data or "auto_approve_domains" in data:
        pool = get_pool()
        if pool:
            async with pool.acquire() as conn:
                if "password" in data:
                    event = "share_password.removed" if data["password"] is None else "share_password.changed"
                    await SA.audit(conn, event, request=request, metadata={"view_token": token})
                if "auto_approve_domains" in data:
                    await SA.audit(conn, "share_access.auto_domains_changed", request=request,
                                   metadata={"view_token": token, "domains": view.get("auto_approve_domains")})
    return view


@router.delete("/api/shared-views/{token}", status_code=204)
async def delete_shared_view(
    token: str,
    _: str = Depends(require_editor),
    _perm: str = Depends(require_permission("module.shared.manage")),
):
    svc = SharedViewService()
    ok = await svc.delete(token)
    if not ok:
        raise HTTPException(status_code=404, detail="Shared view not found")


@router.get("/api/shared-views/{token}/accesses")
async def get_shared_view_accesses(
    token: str,
    limit: int = Query(200, ge=1, le=500),
    _: str = Depends(require_editor),
    _perm: str = Depends(require_permission("module.shared.manage")),
):
    """Full access log for a shared view (IP, geo, device, browser)."""
    svc = SharedViewService()
    accesses = await svc.get_accesses(token, limit=limit)
    return {"accesses": accesses, "total": len(accesses)}


@router.delete("/api/shared-views/{token}/accesses")
async def delete_shared_view_accesses(
    token: str,
    body: SharedViewAccessDelete,
    _: str = Depends(require_editor),
    _perm: str = Depends(require_permission("module.shared.manage")),
):
    svc = SharedViewService()
    if not body.access_ids:
        raise HTTPException(status_code=400, detail="No access rows selected")
    deleted = await svc.delete_accesses(token, body.access_ids)
    return {"deleted": deleted}


# ── Public endpoint (NO auth) ──────────────────────────────────────────────────

def _password_required() -> HTTPException:
    # 403, not 401: the app's client reads a 401 as "your session ended".
    return HTTPException(status_code=403, detail={
        "code": "password_required", "message": "This link is password protected.",
    })


@router.get("/api/public/view/{token}")
async def get_public_view(
    token: str, request: Request,
    x_view_token: Optional[str] = Header(None),
):
    """
    Public — no authentication required.
    Returns the status records for the token.
    Logs IP, geo, device, browser automatically.
    A password-protected link also needs the unlock token from /unlock, in
    the X-View-Token header.
    """
    svc = SharedViewService()
    try:
        return await svc.get_public_data(token, request, unlock=x_view_token)
    except SA.PasswordRequired:
        raise _password_required()
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/api/public/view/{token}/records/{record_id}")
async def update_public_view_record(
    token: str,
    record_id: str,
    request: Request,
    body: PublicSharedViewUpdate,
    x_view_token: Optional[str] = Header(None),
):
    from ..db.valkey import rate_check

    ip = client_ip(request)
    allowed, _ = await rate_check(f"public-share:{token}:{ip}", limit=30, window_sec=60)
    if not allowed:
        raise HTTPException(status_code=429, detail="Too many updates from this link. Try again shortly.")

    fields = {}
    if body.client is not None:
        fields["Client"] = body.client
    if body.project_name is not None:
        fields["Project Name"] = body.project_name
    if body.project_status is not None:
        fields["Project Status"] = body.project_status
    if body.amount_billed is not None:
        fields["Amount Billed So far"] = body.amount_billed
    if body.status is not None:
        fields["Status"] = body.status
    if body.short_status is not None:
        fields["Short Status"] = body.short_status
    if body.current_status_detailed is not None:
        fields["Current Status (Detailed)"] = body.current_status_detailed
    if body.invoice_number is not None:
        fields["Invoice Number"] = body.invoice_number
    if body.payment_status is not None:
        fields["Payment Status"] = body.payment_status
    if body.amount_received is not None:
        fields["Amount Received"] = body.amount_received
    if body.cleared_date is not None:
        fields["Cleared Date"] = body.cleared_date
    if body.remark is not None:
        fields["Remark"] = body.remark
    if body.next_followup is not None:
        fields["Next followup"] = body.next_followup

    try:
        return await SharedViewService().update_public_record(token, record_id, fields, request=request,
                                                              unlock=x_view_token)
    except SA.PasswordRequired:
        raise _password_required()
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/public/view/{token}/event", status_code=204)
async def record_public_event(
    token: str, body: PublicEventBody, request: Request,
    x_view_token: Optional[str] = Header(None),
    u: Optional[str] = Query(None, max_length=200),
):
    """
    Fire-and-forget event tracking for public link viewers.
    Allowed event types: record_detail, attachment_open.
    Called via navigator.sendBeacon or fetch from the shared view frontend.
    """
    allowed_types = {"record_detail", "attachment_open"}
    if body.event_type not in allowed_types:
        raise HTTPException(status_code=400, detail=f"event_type must be one of {sorted(allowed_types)}")

    # Sanitise meta — only string/number values allowed, max 10 keys
    clean_meta: dict | None = None
    if body.meta:
        clean_meta = {
            str(k)[:64]: (str(v)[:256] if v is not None else None)
            for k, v in list(body.meta.items())[:10]
        }

    svc = SharedViewService()
    try:
        view = await svc.get_public_view(token)
        # sendBeacon cannot set headers, so the unlock token may come as ?u=.
        SA.require_unlocked(view, x_view_token or u)
    except SA.PasswordRequired:
        raise _password_required()
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    ip = client_ip(request)
    ua = request.headers.get("user-agent", "")
    referer = request.headers.get("referer") or request.headers.get("origin") or ""
    ch = request.headers.get("x-client-hint", "")
    from ..utils.tasks import spawn
    spawn(
        svc._log_access(
            token=token,
            ip=ip,
            user_agent=ua,
            referer=referer,
            client_hint=ch,
            resource_type=view.get("resource_type") or "status",
            event_type=body.event_type,
            record_id=body.record_id,
            meta=clean_meta,
        ),
        name="log-public-view-event",
    )


# ── Password unlock (public) ───────────────────────────────────────────────────

async def _rate_or_429(*checks: tuple[str, tuple[int, int]], message: str) -> None:
    for key, (limit, window) in checks:
        if not await SA.rate_ok(key, limit, window):
            raise HTTPException(status_code=429, detail=message)


async def _protected_view_or_404(token: str) -> dict:
    """The link as the public page sees it: missing, disabled and expired
    links answer exactly what GET /api/public/view/{token} answers."""
    try:
        return await SharedViewService().get_public_view(token)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/api/public/view/{token}/unlock")
async def unlock_public_view(token: str, body: UnlockBody, request: Request):
    """Check a link's password. The right one returns a short-lived unlock
    token for the X-View-Token header; it stops working when the password
    changes. Limited per IP and per link."""
    ip = client_ip(request) or "unknown"
    await _rate_or_429(
        (f"unlock-ip:{token}:{ip}", SA.UNLOCK_LIMIT_PER_IP),
        (f"unlock-link:{token}", SA.UNLOCK_LIMIT_PER_LINK),
        message="Too many attempts. Wait a few minutes and try again.",
    )
    view = await _protected_view_or_404(token)
    if not view.get("is_password_protected"):
        return {"unlock_token": None, "is_password_protected": False}
    pool = _pool_or_503()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(SA.SECRET_SQL, token)
    if not row or not SA.password_matches(body.password, row["password_hash"]):
        raise HTTPException(status_code=403, detail={
            "code": "incorrect_password", "message": "That password isn't right. Check it and try again.",
        })
    return {
        "unlock_token": SA.unlock_token(token, row["password_version"]),
        "expires_in": SA.UNLOCK_TTL_SECONDS,
        "is_password_protected": True,
    }


# ── Request the password (public) ──────────────────────────────────────────────

_REQUEST_ACCEPTED = {
    "ok": True,
    "message": "Request sent. If it's approved, the password will be emailed to you.",
}


@router.post("/api/public/view/{token}/access-request", status_code=202)
async def request_public_view_access(token: str, body: AccessRequestBody, request: Request):
    """Ask the owner of a protected link for its password.

    Answers the same for a stored request, a duplicate, a honeypot hit and an
    auto-approved one, so the reply says nothing about the owner's settings.
    """
    ip = client_ip(request) or "unknown"
    await _rate_or_429(
        (f"request-ip:{ip}", SA.REQUEST_LIMIT_PER_IP),
        (f"request-link:{token}", SA.REQUEST_LIMIT_PER_LINK),
        message="Too many requests. Please try again later.",
    )
    if (body.website or "").strip():
        return _REQUEST_ACCEPTED

    errors: dict[str, str] = {}
    name = SA.clean_text(body.name, SA.NAME_MAX + 1, single_line=True)
    if not name:
        errors["name"] = "Enter your name"
    elif len(name) > SA.NAME_MAX:
        errors["name"] = f"Use at most {SA.NAME_MAX} characters"
    try:
        email = SA.validate_email(body.email)
    except ValueError as e:
        errors["email"] = str(e)
        email = ""
    message = SA.clean_text(body.message, SA.MESSAGE_MAX + 1, single_line=False)
    if len(message) > SA.MESSAGE_MAX:
        errors["message"] = f"Use at most {SA.MESSAGE_MAX} characters"
    if errors:
        raise HTTPException(status_code=422, detail={
            "code": "invalid", "message": next(iter(errors.values())), "fields": errors,
        })

    view = await _protected_view_or_404(token)
    if not view.get("is_password_protected"):
        raise HTTPException(status_code=404, detail="This link does not need a password")
    if not await SA.rate_ok(f"request-email:{token}:{email.lower()}", 3, 24 * 60 * 60):
        return _REQUEST_ACCEPTED

    pool = _pool_or_503()
    async with pool.acquire() as conn:
        dup = await conn.fetchval(
            "SELECT 1 FROM shared_view_access_requests WHERE view_token = $1 AND lower(email) = lower($2) "
            "AND status = 'pending' LIMIT 1", token, email)
        if dup:
            return _REQUEST_ACCEPTED
        row = await conn.fetchrow(
            "INSERT INTO shared_view_access_requests (view_token, name, email, message, ip, user_agent, link_origin) "
            "VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, NULLIF($7, '')) RETURNING id",
            token, name, email, message, ip[:45], request.headers.get("user-agent", "")[:500],
            SA.origin_from_headers(request),
        )
        secret = await conn.fetchrow(SA.SECRET_SQL, token)
        await SA.audit(conn, "share_access.requested", request=request, email=email,
                       metadata={"view_token": token, "request_id": str(row["id"]), "name": name})

    req = {"id": str(row["id"]), "name": name, "email": email, "message": message}
    domains = SA.load_json_list(secret["auto_approve_domains"])
    if SA.domain_auto_approved(email, domains) and SA.mailer_configured():
        try:
            await SA.decide(pool, req["id"], "approve", request=request, via="auto")
            return _REQUEST_ACCEPTED
        except (ValueError, LookupError) as exc:
            # Fall back to asking the owner (e.g. the stored password cannot be read).
            SA.logger.warning("auto-approve failed for %s: %s", token, exc)
    owner_view = {"token": token, "title": secret["title"], "resource_type": secret["resource_type"],
                  "owner_user_id": secret["owner_user_id"]}
    await SA.notify_owners(pool, owner_view, req, request)
    return _REQUEST_ACCEPTED


# ── Signed approve / deny links from the owner's email ─────────────────────────

_DECIDE_HEADERS = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
}


def _decide_page(title: str, message: str, *, form: str = "", tone: str = "info", status: int = 200) -> HTMLResponse:
    """A small branded page. `message` and `form` are HTML the caller escaped."""
    e = SA.html.escape
    accent = {"ok": "#16a34a", "warn": "#d97706", "info": "#2563eb"}.get(tone, "#2563eb")
    doc = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{e(title)} · FinTrack</title>
<style>
:root{{--bg:#f8fafc;--card:#fff;--ink:#0f172a;--mute:#64748b;--line:#e2e8f0;color-scheme:light}}
@media (prefers-color-scheme:dark){{:root{{--bg:#0b0e14;--card:#131822;--ink:#f1f5f9;--mute:#8b95a7;--line:#252c39;color-scheme:dark}}}}
body{{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);box-sizing:border-box;
font-family:Inter,-apple-system,Segoe UI,Arial,sans-serif;padding:max(24px,env(safe-area-inset-top)) 16px max(24px,env(safe-area-inset-bottom))}}
.card{{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:20px;overflow:hidden;box-shadow:0 20px 60px rgba(15,23,42,.12)}}
.bar{{height:4px;background:linear-gradient(90deg,#2563eb,#7c3aed)}}.in{{padding:32px 28px;text-align:center}}
h1{{margin:0 0 8px;font-size:21px;color:var(--ink)}}p{{margin:0;color:var(--mute);font-size:14.5px;line-height:1.6}}
.dot{{width:12px;height:12px;border-radius:6px;background:{accent};margin:0 auto 16px}}
button{{margin-top:20px;width:100%;padding:12px 0;border:none;border-radius:10px;font-size:15px;font-weight:700;color:#fff;cursor:pointer}}
</style></head><body><main class="card"><div class="bar"></div><div class="in">
<div class="dot" aria-hidden="true"></div><h1>{e(title)}</h1><p>{message}</p>{form}</div></main></body></html>"""
    return HTMLResponse(doc, status_code=status, headers=_DECIDE_HEADERS)


async def _signed_request(r: str, a: str, e: str, s: str):
    check = SA.verify_action(r, a, e, s)
    if check == "invalid" or not SA._uuid_or_none(r):
        return None, _decide_page("This link isn't valid", "It may have been copied incompletely. Open FinTrack and "
                                  "use Links → Access requests instead.", tone="warn", status=400)
    if check == "expired":
        return None, _decide_page("This link has expired", "Approve and deny links work for 7 days. Open FinTrack and "
                                  "use Links → Access requests instead.", tone="warn", status=410)
    pool = _pool_or_503()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT r.id, r.name, r.email, r.status, v.title FROM shared_view_access_requests r "
            "JOIN shared_views v ON v.token = r.view_token WHERE r.id = $1::uuid", r)
    if not row:
        return None, _decide_page("Request not found", "The link or the request has been deleted.", tone="warn",
                                  status=404)
    return row, None


@router.get("/api/public/view-access/decide", response_class=HTMLResponse)
async def decide_from_email_confirm(r: str = "", a: str = "", e: str = "", s: str = ""):
    """The page an Approve / Deny email button opens. It acts only when its
    button is pressed (a POST), so a mail scanner that follows links cannot
    approve anything."""
    row, err = await _signed_request(r, a, e, s)
    if err:
        return err
    esc = SA.html.escape
    who = f"<strong>{esc(row['name'])}</strong> ({esc(row['email'])})"
    link = f"<strong>{esc(row['title'] or 'Shared view')}</strong>"
    if row["status"] != "pending":
        return _decide_page(f"Already {row['status']}", f"The request from {who} for {link} was already {row['status']}.")
    qs = esc(urlencode({"r": r, "a": a, "e": e, "s": s}))
    if a == "approve":
        form = (f'<form method="post" action="decide?{qs}"><button type="submit" style="background:#16a34a">'
                'Approve &amp; send password</button></form>')
        return _decide_page("Send the password?", f"{who} will be emailed the link {link} and its current password.",
                            form=form)
    form = (f'<form method="post" action="decide?{qs}"><button type="submit" style="background:#475569">'
            'Deny request</button></form>')
    return _decide_page("Deny this request?",
                        f"{who} asked for the password to {link}. They'll get a short, polite note.", form=form)


@router.post("/api/public/view-access/decide", response_class=HTMLResponse)
async def decide_from_email(request: Request, r: str = "", a: str = "", e: str = "", s: str = ""):
    ip = client_ip(request) or "unknown"
    await _rate_or_429((f"decide-ip:{ip}", (30, 60)), message="Too many attempts. Try again in a minute.")
    row, err = await _signed_request(r, a, e, s)
    if err:
        return err
    esc = SA.html.escape
    try:
        result = await SA.decide(_pool_or_503(), r, a, request=request, via="email")
    except (ValueError, LookupError) as exc:
        return _decide_page("Couldn't complete this", esc(str(exc)), tone="warn", status=409)
    who = f"<strong>{esc(row['name'])}</strong>"
    if result.get("already"):
        return _decide_page(f"Already {result['status']}", f"This request was already {result['status']}.")
    if a == "deny":
        said = "was sent a polite note" if result.get("sent") else "was not emailed"
        return _decide_page("Request denied", f"{who} {said}.", tone="ok")
    if result.get("sent"):
        return _decide_page("Password sent", f"{who} was emailed the link and its password.", tone="ok")
    return _decide_page("Approved, but not emailed",
                        "The email couldn't be sent. Open FinTrack → Links → Access requests to see the password "
                        "and share it yourself.", tone="warn")
