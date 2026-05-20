"""
Current Status endpoints — /api/status

Read  (viewer + editor)  : GET /api/status, GET /api/status/{id}
Write (editor only)      : POST, PATCH, DELETE

Security:
- Rate limited: 30 mutations / min / IP (shared with AI endpoints)
- Input length validated at Pydantic layer
- Attribution wired: every mutation captured in record_history
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from ..services.associations import AssociationService
from ..services.status import StatusService
from ..models import StatusCreate, StatusUpdate
from .deps import require_auth, require_editor
from ..db.valkey import rate_check, cache_get, cache_set, cache_bust

_STATUS_LIST_TTL = 60   # seconds — cache the full status list for 60 s


async def _bust_status_cache() -> None:
    """Invalidate all status list cache entries after any mutation."""
    await cache_bust("status:list:")

router = APIRouter(prefix="/api/status", tags=["status"])


def _svc() -> StatusService:
    return StatusService()


def _assoc() -> AssociationService:
    return AssociationService()


def _ip(request: Request) -> str:
    for h in ("cf-connecting-ip", "x-forwarded-for", "x-real-ip"):  # cf-connecting-ip is Cloudflare trusted real-IP
        v = request.headers.get(h, "")
        if v:
            return v.split(",")[0].strip()
    return request.client.host if request.client else ""


async def _check_write_rate(request: Request) -> None:
    """30 status mutations / min per IP."""
    allowed, _ = await rate_check(_ip(request), limit=30, window_sec=60)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many status updates — limited to 30/min. Try again shortly.",
            headers={"Retry-After": "60"},
        )


# ── LIST ───────────────────────────────────────────────────────────────────

@router.get("")
async def list_statuses(
    request: Request,
    client: str = "",
    project: str = "",
    _auth=Depends(require_auth),
):
    """
    List all current-status records.

    Query params (optional):
      ?client=Birla Open Minds
      ?project=PMS – Phase 1.1
    """
    svc = _svc()
    cache_key = f"status:list:{client}:{project}"
    cached = await cache_get(cache_key)
    if cached is not None:
        return cached
    try:
        records = await svc.list_all(
            client=client or None,
            project=project or None,
        )
        records = await _assoc().hydrate_records("status", records)
        result = {"records": records, "total": len(records)}
        await cache_set(cache_key, result, _STATUS_LIST_TTL)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch status updates: {e}")


class AIUpdateRequest(BaseModel):
    record_ids: list[str]
    extra_context: Optional[str] = None


class AddOptionRequest(BaseModel):
    option: str


@router.post("/ai-update")
async def generate_ai_status_update(
    request: Request,
    body: AIUpdateRequest,
    role: str = Depends(require_editor),
):
    """
    Generate an AI-written status update narrative for selected records.
    Rate-limited: shared with status mutation pool (30/min/IP).
    """
    await _check_write_rate(request)

    if not body.record_ids:
        raise HTTPException(status_code=422, detail="At least one record_id required")
    if len(body.record_ids) > 30:
        raise HTTPException(status_code=422, detail="Maximum 30 records per AI update")

    # Fetch records from PG mirror (fast path)
    svc = _svc()
    all_records = await svc.list_all()
    id_set = set(body.record_ids)
    selected = [r for r in all_records if r.get("id") in id_set]

    if not selected:
        raise HTTPException(status_code=404, detail="None of the selected records were found")

    try:
        from ..services.openrouter import ai_status_update
        result = await ai_status_update(
            records=selected,
            extra_context=body.extra_context or "",
        )
        return {
            "text": result.get("content", ""),
            "model": result.get("model", ""),
            "record_count": len(selected),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI update failed: {e}")


@router.get("/picklists")
async def get_status_picklists(_auth=Depends(require_auth)):
    try:
        return await StatusService().get_picklists()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/picklists/{field_name}")
async def add_status_picklist_option(
    field_name: str,
    body: AddOptionRequest,
    _role: str = Depends(require_editor),
):
    try:
        option = body.option.strip()
        if not option:
            raise ValueError("Option is required")
        return await StatusService().add_picklist_option(field_name, option)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── GET ONE ────────────────────────────────────────────────────────────────

@router.get("/{record_id}")
async def get_status(
    record_id: str,
    _auth=Depends(require_auth),
):
    svc = _svc()
    try:
        record = await svc.get_record(record_id)
        hydrated = await _assoc().hydrate_records("status", [record])
        return hydrated[0] if hydrated else record
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── CREATE ─────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_status(
    request: Request,
    body: StatusCreate,
    role: str = Depends(require_editor),
):
    """Create a new status record (editor role required)."""
    await _check_write_rate(request)

    svc = _svc()
    fields = body.to_teable_fields()
    if not fields.get("Client") or not fields.get("Project"):
        raise HTTPException(status_code=422, detail="client and project are required")
    try:
        result = await svc.create_record(fields, request=request, role=role)
        await _bust_status_cache()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── UPDATE ─────────────────────────────────────────────────────────────────

@router.patch("/{record_id}")
async def update_status(
    record_id: str,
    request: Request,
    body: StatusUpdate,
    role: str = Depends(require_editor),
):
    """Update an existing status record (editor role required)."""
    await _check_write_rate(request)

    svc = _svc()
    fields = body.to_teable_fields()
    if not fields:
        raise HTTPException(status_code=422, detail="No fields provided to update")
    try:
        result = await svc.update_record(record_id, fields, request=request, role=role)
        await _bust_status_cache()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── DELETE ─────────────────────────────────────────────────────────────────

@router.delete("/{record_id}", status_code=204)
async def delete_status(
    record_id: str,
    request: Request,
    role: str = Depends(require_editor),
):
    """Delete a status record (editor role required)."""
    await _check_write_rate(request)

    svc = _svc()
    try:
        await svc.delete_record(record_id, request=request, role=role)
        await _bust_status_cache()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
