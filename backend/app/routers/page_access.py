"""
"Request the password" for published pages and artifacts.

The same flow as password-protected shared view links (services/
share_access.py), on the same requests table:

  public  POST /api/public/pages/{slug}/access-request   the visitor's form
  owner   GET  /api/pages/{page_id}/access                protection summary + pending count
          PUT  /api/pages/{page_id}/access                auto-approve email domains
          GET  /api/pages/{page_id}/password              "show password" (audited)
          GET  /api/pages/{page_id}/access-requests
          POST /api/pages/{page_id}/access-requests/{id}/approve | deny

The signed Approve / Deny email links go to /api/public/view-access/decide
(routers/shared_views.py), which handles both kinds of request.

Owner routes follow the pages rule: the page's creator, or a superadmin.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from ..db.postgres import get_pool
from ..services import page_tree
from ..services import share_access as SA
from ..utils.client_ip import client_ip
from .deps import require_auth
from .pages import PageId, _owns_page, check_public_access

router = APIRouter()


class PageAccessRequestBody(BaseModel):
    name: str = Field("", max_length=1000)
    email: str = Field("", max_length=1000)
    message: Optional[str] = Field(None, max_length=5000)
    # Honeypot: hidden from people, filled in by form-spamming bots.
    website: Optional[str] = Field(None, max_length=1000)


class PageAccessSettings(BaseModel):
    auto_approve_domains: list[str] = Field(default_factory=list, max_length=100)


class PageDecisionBody(BaseModel):
    note: Optional[str] = Field(None, max_length=5000)
    notify: bool = True
    # Approve without emailing: the owner shares the password themselves.
    manual: bool = False


def _pool():
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")
    return pool


async def _rate_or_429(*checks: tuple[str, tuple[int, int]], message: str) -> None:
    for key, (limit, window) in checks:
        if not await SA.rate_ok(key, limit, window):
            raise HTTPException(429, message)


async def _owned_page(conn, page_id: str, request: Request, role: str):
    row = await conn.fetchrow(SA.PAGE_SECRET_SQL, page_id)
    if not row:
        raise HTTPException(404, "Page not found")
    user_id = getattr(request.state, "auth_user_id", None)
    auth_role = getattr(request.state, "auth_role", role) or role
    if not _owns_page(row, user_id, auth_role):
        raise HTTPException(403, "Access denied")
    return row


def _summary(row, pending: int) -> dict:
    protected = bool(row["is_password_protected"] and row["password_hash"])
    return {
        "is_password_protected": protected,
        # False for a password set before encrypted copies were kept: it
        # cannot be shown or emailed until it is set again.
        "password_stored": bool(protected and row["password_enc"]),
        "auto_approve_domains": SA.load_json_list(row["auto_approve_domains"]),
        "pending": pending,
        "mailer_configured": SA.mailer_configured(),
    }


async def _pending(conn, page_id: str) -> int:
    return int(await conn.fetchval(
        "SELECT COUNT(*) FROM shared_view_access_requests WHERE page_id = $1::uuid AND status = 'pending'",
        page_id) or 0)


# ── Owner side ───────────────────────────────────────────────────────────────

@router.get("/api/pages/{page_id}/access")
async def page_access_summary(page_id: PageId, request: Request, role: str = Depends(require_auth)):
    async with _pool().acquire() as conn:
        row = await _owned_page(conn, page_id, request, role)
        return _summary(row, await _pending(conn, page_id))


@router.put("/api/pages/{page_id}/access")
async def update_page_access(page_id: PageId, body: PageAccessSettings, request: Request,
                             role: str = Depends(require_auth)):
    try:
        domains = SA.normalize_domains(body.auto_approve_domains)
    except ValueError as e:
        raise HTTPException(400, str(e))
    import json
    async with _pool().acquire() as conn:
        await _owned_page(conn, page_id, request, role)
        await conn.execute("UPDATE published_pages SET auto_approve_domains = $2::jsonb WHERE id = $1::uuid",
                           page_id, json.dumps(domains))
        await SA.audit(conn, "share_access.auto_domains_changed", request=request,
                       metadata={"page_id": page_id, "domains": domains})
        row = await conn.fetchrow(SA.PAGE_SECRET_SQL, page_id)
        return _summary(row, await _pending(conn, page_id))


@router.get("/api/pages/{page_id}/password")
async def reveal_page_password(page_id: PageId, request: Request, role: str = Depends(require_auth)):
    """The owner's "show password": the current page password, decrypted. Audited."""
    async with _pool().acquire() as conn:
        row = await _owned_page(conn, page_id, request, role)
        if not (row["is_password_protected"] and row["password_hash"]):
            return {"password": None, "is_password_protected": False}
        if not row["password_enc"]:
            raise HTTPException(409, {
                "code": "password_not_stored",
                "message": "This password was set before FinTrack kept a copy it can show. "
                           "Set it again to see it here and to email it to approved requests.",
            })
        password = SA.decrypt_password(row["password_enc"])
        await SA.audit(conn, "page_password.revealed", request=request, metadata={"page_id": page_id})
    if password is None:
        raise HTTPException(409, {"code": "password_unreadable",
                                  "message": "The stored password can't be read. Set a new one."})
    return {"password": password, "is_password_protected": True}


@router.get("/api/pages/{page_id}/access-requests")
async def list_page_access_requests(
    page_id: PageId, request: Request,
    status: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    role: str = Depends(require_auth),
):
    if status and status not in ("pending", "approved", "denied"):
        raise HTTPException(400, "Unknown status")
    async with _pool().acquire() as conn:
        page = await _owned_page(conn, page_id, request, role)
        rows = await conn.fetch(
            f"SELECT {SA.REQUEST_COLUMNS} FROM shared_view_access_requests r "
            "WHERE r.page_id = $1::uuid AND ($2::text IS NULL OR r.status = $2) "
            "ORDER BY (r.status = 'pending') DESC, r.created_at DESC LIMIT $3",
            page_id, status, limit,
        )
    items = []
    for r in rows:
        d = SA.request_dict(r)
        d["view_title"] = page["title"] or "Untitled page"
        items.append(d)
    return {"requests": items, "pending": sum(1 for r in items if r["status"] == "pending"),
            "mailer_configured": SA.mailer_configured(),
            "password_stored": bool(page["password_enc"]) or not page["password_hash"]}


async def _decide(request: Request, page_id: str, request_id: str, action: str, body: PageDecisionBody,
                  role: str) -> dict:
    pool = _pool()
    if not SA._uuid_or_none(request_id):
        raise HTTPException(404, "Request not found")
    async with pool.acquire() as conn:
        await _owned_page(conn, page_id, request, role)
        belongs = await conn.fetchval(
            "SELECT 1 FROM shared_view_access_requests WHERE id = $1::uuid AND page_id = $2::uuid",
            request_id, page_id)
    if not belongs:
        raise HTTPException(404, "Request not found")
    try:
        result = await SA.decide(
            pool, request_id, action, request=request, via="app",
            actor_user_id=getattr(request.state, "auth_user_id", None),
            note=body.note or "", notify=body.notify, manual=body.manual and action == "approve",
        )
    except SA.PasswordNotStored as e:
        raise HTTPException(409, {"code": "password_not_stored", "message": str(e)})
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(409, str(e))
    if result.get("already"):
        raise HTTPException(409, f"This request was already {result['status']}.")
    return result


@router.post("/api/pages/{page_id}/access-requests/{request_id}/approve")
async def approve_page_access_request(page_id: PageId, request_id: str, request: Request,
                                      body: Optional[PageDecisionBody] = None, role: str = Depends(require_auth)):
    """Approve and email the page's current password. Without a mailer (or
    when sending fails, or with `manual`) the password comes back for the
    owner to pass on."""
    return await _decide(request, page_id, request_id, "approve", body or PageDecisionBody(), role)


@router.post("/api/pages/{page_id}/access-requests/{request_id}/deny")
async def deny_page_access_request(page_id: PageId, request_id: str, request: Request,
                                   body: Optional[PageDecisionBody] = None, role: str = Depends(require_auth)):
    return await _decide(request, page_id, request_id, "deny", body or PageDecisionBody(), role)


# ── Public: the visitor's request ────────────────────────────────────────────

@router.post("/api/public/pages/{slug}/access-request", status_code=202)
async def request_page_access(slug: str, body: PageAccessRequestBody, request: Request):
    """Ask a protected page's owner for its password.

    Answers the same for a stored request, a duplicate, a honeypot hit and an
    auto-approved one, so the reply says nothing about the owner's settings.
    A missing, unpublished or trashed page is 404 and an expired one 410, as
    on every other public page route.
    """
    ip = client_ip(request) or "unknown"
    await _rate_or_429(
        (f"request-ip:{ip}", SA.REQUEST_LIMIT_PER_IP),
        (f"request-page:{slug}", SA.REQUEST_LIMIT_PER_LINK),
        message="Too many requests. Please try again later.",
    )
    if (body.website or "").strip():
        return SA.REQUEST_ACCEPTED

    fields, errors = SA.validate_request(body.name, body.email, body.message)
    if errors:
        raise HTTPException(422, {"code": "invalid", "message": next(iter(errors.values())), "fields": errors})

    pool = _pool()
    async with pool.acquire() as conn:
        tree = await page_tree.tree_ready(conn)
        row = await conn.fetchrow(
            "SELECT id, slug, title, is_published, expires_at, is_password_protected, password_hash, password_enc, "
            f"auto_approve_domains, created_by, {'deleted_at' if tree else 'NULL::timestamptz AS deleted_at'} "
            "FROM published_pages WHERE slug = $1", slug)
    check_public_access(row)
    if not (row["is_password_protected"] and row["password_hash"]):
        raise HTTPException(404, "This page does not need a password")
    await SA.submit_request(pool, SA.page_target(row), fields, request)
    return SA.REQUEST_ACCEPTED
