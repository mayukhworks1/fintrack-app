"""
Current Status endpoints — /api/status

Read  (viewer + editor)  : GET /api/status, GET /api/status/{id}
Write (editor only)      : POST, PATCH, DELETE
Stream (viewer + editor) : GET /api/status/stream  — SSE push on any change

Security:
- Rate limited: 30 mutations / min / IP (shared with AI endpoints)
- Input length validated at Pydantic layer
- Attribution wired: every mutation captured in record_history
"""

import asyncio
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi import File, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..services.status import StatusService, subscribe_sse, unsubscribe_sse
from ..models import StatusCreate, StatusUpdate
from .deps import require_auth, require_editor, require_permission
from .auth import verify_token
from ..db.valkey import rate_check, cache_bust

# Valkey is NOT used for status list reads — we go straight to PG mirror
# (1-3 ms) so there's no stale-cache window to worry about.
# cache_bust is still imported to clean up any legacy keys on writes.

async def _bust_status_cache() -> None:
    """Invalidate any legacy status list cache entries after a mutation."""
    await cache_bust("status:list:")

router = APIRouter(prefix="/api/status", tags=["status"])


def _svc() -> StatusService:
    return StatusService()


def _ip(request: Request) -> str:
    for h in ("cf-connecting-ip", "x-forwarded-for", "x-real-ip"):  # cf-connecting-ip is Cloudflare trusted real-IP
        v = request.headers.get(h, "")
        if v:
            return v.split(",")[0].strip()
    return request.client.host if request.client else ""


def _http_error_detail(exc: httpx.HTTPStatusError) -> str:
    try:
        payload = exc.response.json()
        if isinstance(payload, dict):
            return (
                payload.get("message")
                or payload.get("detail")
                or payload.get("error")
                or exc.response.text
                or str(exc)
            )
    except Exception:
        pass
    return exc.response.text or str(exc)


async def _check_write_rate(request: Request) -> None:
    """30 status mutations / min per IP."""
    allowed, _ = await rate_check(_ip(request), limit=30, window_sec=60)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many status updates — limited to 30/min. Try again shortly.",
            headers={"Retry-After": "60"},
        )


# ── SSE stream ─────────────────────────────────────────────────────────────

@router.get("/stream")
async def stream_status_changes(
    request: Request,
    token: str = Query(..., description="Bearer token passed as query param (EventSource limitation)"),
):
    """
    Server-Sent Events endpoint.  The frontend connects once on mount and
    receives a `data: changed` event whenever any status record is mutated —
    whether the mutation came from the app itself OR from a direct Teable edit
    (via webhook).  The frontend then does a silent background reload.

    Auth is via ?token= because the browser EventSource API cannot send
    custom headers.
    """
    role = verify_token(token)
    if role is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    queue = subscribe_sse()

    async def event_generator():
        try:
            # Send an initial "connected" ping so the client knows the stream is live
            yield "event: connected\ndata: ok\n\n"
            while True:
                # Wait for next event or send a keepalive every 25 s
                # (proxies / Cloudflare drop idle SSE after ~30 s)
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=25)
                    yield f"event: {event}\ndata: {event}\n\n"
                except asyncio.TimeoutError:
                    # Keepalive comment — keeps the connection alive through proxies
                    yield ": keepalive\n\n"
                # Check if client disconnected
                if await request.is_disconnected():
                    break
        except asyncio.CancelledError:
            pass
        finally:
            unsubscribe_sse(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # disable Nginx buffering
            "Connection": "keep-alive",
        },
    )


# ── LIST ───────────────────────────────────────────────────────────────────

@router.get("")
async def list_statuses(
    request: Request,
    client: str = "",
    project: str = "",
    _auth=Depends(require_auth),
    _perm: str = Depends(require_permission("module.status.view")),
):
    """
    List all current-status records.

    Query params (optional):
      ?client=Birla Open Minds
      ?project=PMS – Phase 1.1
    """
    # No Valkey cache here — go straight to PG mirror (1-3 ms).
    # Removing this cache layer eliminates all stale-read windows and makes
    # SSE-triggered reloads always return the freshest data.
    svc = _svc()
    try:
        records = await svc.list_all(
            client=client or None,
            project=project or None,
        )
        return {"records": records, "total": len(records)}
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
    _perm: str = Depends(require_permission("module.status.edit")),
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


@router.get("/options")
async def get_status_options(_auth=Depends(require_auth)):
    try:
        return await StatusService().get_client_project_options()
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
    _perm: str = Depends(require_permission("module.status.view")),
):
    svc = _svc()
    try:
        return await svc.get_record(record_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── CREATE ─────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_status(
    request: Request,
    body: StatusCreate,
    role: str = Depends(require_editor),
    _perm: str = Depends(require_permission("module.status.edit")),
):
    """Create a new status record (editor role required)."""
    await _check_write_rate(request)

    svc = _svc()
    fields = body.to_teable_fields()
    if not fields.get("Client") or not fields.get("Project"):
        raise HTTPException(status_code=422, detail="client and project are required")
    try:
        options = await svc.get_client_project_options()
        known_clients = set(options.get("clients") or [])
        known_projects = set(options.get("projects") or [])
        if known_clients and fields["Client"] not in known_clients:
            raise HTTPException(status_code=422, detail="Select a valid existing client from the status list")
        if known_projects and fields["Project"] not in known_projects:
            raise HTTPException(status_code=422, detail="Select a valid existing project from the status list")
        result = await svc.create_record(fields, request=request, role=role)
        await _bust_status_cache()
        return result
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=_http_error_detail(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── UPDATE ─────────────────────────────────────────────────────────────────

@router.patch("/{record_id}")
async def update_status(
    record_id: str,
    request: Request,
    body: StatusUpdate,
    role: str = Depends(require_editor),
    _perm: str = Depends(require_permission("module.status.edit")),
):
    """Update an existing status record (editor role required)."""
    await _check_write_rate(request)

    svc = _svc()
    fields = body.to_teable_fields()
    if not fields:
        raise HTTPException(status_code=422, detail="No fields provided to update")
    try:
        options = await svc.get_client_project_options()
        known_clients = set(options.get("clients") or [])
        known_projects = set(options.get("projects") or [])
        if "Client" in fields and known_clients and fields["Client"] not in known_clients:
            raise HTTPException(status_code=422, detail="Select a valid existing client from the status list")
        if "Project" in fields and known_projects and fields["Project"] not in known_projects:
            raise HTTPException(status_code=422, detail="Select a valid existing project from the status list")
        result = await svc.update_record(record_id, fields, request=request, role=role)
        await _bust_status_cache()
        return result
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=_http_error_detail(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── DELETE ─────────────────────────────────────────────────────────────────

@router.delete("/{record_id}", status_code=204)
async def delete_status(
    record_id: str,
    request: Request,
    role: str = Depends(require_editor),
    _perm: str = Depends(require_permission("module.status.edit")),
):
    """Delete a status record (editor role required)."""
    await _check_write_rate(request)

    svc = _svc()
    try:
        await svc.delete_record(record_id, request=request, role=role)
        await _bust_status_cache()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=_http_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload/{record_id}/{field_name}")
async def upload_status_attachment(
    record_id: str,
    field_name: str,
    request: Request,
    file: UploadFile = File(...),
    role: str = Depends(require_editor),
    _perm: str = Depends(require_permission("module.status.edit")),
):
    await _check_write_rate(request)
    svc = _svc()
    try:
        content = await file.read()
        result = await svc.upload_attachment_to_field(
            record_id=record_id,
            field_name=field_name,
            filename=file.filename or "upload.bin",
            content=content,
            content_type=file.content_type or "application/octet-stream",
        )
        await _bust_status_cache()
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=_http_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
