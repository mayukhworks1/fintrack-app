"""
Shared Views — /api/shared-views  (editor-auth)
             — /api/public/view/{token}  (public, no auth)

Editor endpoints: full CRUD + access log
Public endpoint: read-only, no auth, geo-tracked
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from ..services.shared_views import SharedViewService
from .deps import require_editor

router = APIRouter(tags=["shared-views"])


# ── Pydantic models ────────────────────────────────────────────────────────────

class SharedViewCreate(BaseModel):
    title: Optional[str] = None
    record_ids: list[str]
    expires_hours: Optional[int] = None   # None = never expires
    view_config: Optional[dict] = None    # view type, columns etc — stored in PG, sent to public viewer


class SharedViewUpdate(BaseModel):
    title: Optional[str] = None
    is_active: Optional[bool] = None
    expires_hours: Optional[int] = None   # -1 = remove expiry


# ── Helpers ────────────────────────────────────────────────────────────────────

def _ip(request: Request) -> str:
    for h in ("cf-connecting-ip", "x-forwarded-for", "x-real-ip"):
        v = request.headers.get(h, "")
        if v:
            return v.split(",")[0].strip()
    return request.client.host if request.client else ""


def _expiry(hours: Optional[int]) -> Optional[datetime]:
    if hours is None or hours == 0:
        return None
    if hours == -1:
        return None
    return datetime.now(timezone.utc) + timedelta(hours=hours)


# ── Editor CRUD ────────────────────────────────────────────────────────────────

@router.post("/api/shared-views", status_code=201)
async def create_shared_view(
    request: Request,
    body: SharedViewCreate,
    role: str = Depends(require_editor),
):
    """Create a shared view link for selected status records."""
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
            ip=_ip(request),
            expires_at=_expiry(body.expires_hours),
            view_config=body.view_config,
        )
        return view
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/shared-views")
async def list_shared_views(_: str = Depends(require_editor)):
    """List all shared view links (newest first)."""
    svc = SharedViewService()
    views = await svc.list_all()
    return {"views": views, "total": len(views)}


@router.get("/api/shared-views/{token}")
async def get_shared_view(token: str, _: str = Depends(require_editor)):
    svc = SharedViewService()
    view = await svc.get(token)
    if not view:
        raise HTTPException(status_code=404, detail="Shared view not found")
    return view


@router.patch("/api/shared-views/{token}")
async def update_shared_view(
    token: str,
    body: SharedViewUpdate,
    _: str = Depends(require_editor),
):
    """Update title, active state, or expiry of a shared view."""
    svc = SharedViewService()

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

    view = await svc.update(token, data)
    if not view:
        raise HTTPException(status_code=404, detail="Shared view not found")
    return view


@router.delete("/api/shared-views/{token}", status_code=204)
async def delete_shared_view(token: str, _: str = Depends(require_editor)):
    svc = SharedViewService()
    ok = await svc.delete(token)
    if not ok:
        raise HTTPException(status_code=404, detail="Shared view not found")


@router.get("/api/shared-views/{token}/accesses")
async def get_shared_view_accesses(
    token: str,
    limit: int = Query(200, ge=1, le=500),
    _: str = Depends(require_editor),
):
    """Full access log for a shared view (IP, geo, device, browser)."""
    svc = SharedViewService()
    accesses = await svc.get_accesses(token, limit=limit)
    return {"accesses": accesses, "total": len(accesses)}


# ── Public endpoint (NO auth) ──────────────────────────────────────────────────

@router.get("/api/public/view/{token}")
async def get_public_view(token: str, request: Request):
    """
    Public — no authentication required.
    Returns the status records for the token.
    Logs IP, geo, device, browser automatically.
    """
    svc = SharedViewService()
    try:
        return await svc.get_public_data(token, request)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
