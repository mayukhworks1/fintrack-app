"""
Current Status endpoints — /api/status

Read  (viewer + editor)  : GET /api/status, GET /api/status/{id}
Write (editor only)      : POST, PATCH, DELETE
"""

from fastapi import APIRouter, Depends, HTTPException

from ..services.status import StatusService
from ..models import StatusCreate, StatusUpdate
from .deps import require_auth, require_editor

router = APIRouter(prefix="/api/status", tags=["status"])


def _svc() -> StatusService:
    return StatusService()


# ── LIST ───────────────────────────────────────────────────────────────────

@router.get("")
async def list_statuses(
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
    records = await svc.list_all(
        client=client or None,
        project=project or None,
    )
    return {"records": records, "total": len(records)}


# ── GET ONE ────────────────────────────────────────────────────────────────

@router.get("/{record_id}")
async def get_status(
    record_id: str,
    _auth=Depends(require_auth),
):
    svc = _svc()
    try:
        return await svc.get_record(record_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── CREATE ─────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_status(
    body: StatusCreate,
    _auth=Depends(require_editor),
):
    """Create a new status record (editor role required)."""
    svc = _svc()
    fields = body.to_teable_fields()
    if not fields.get("Client") or not fields.get("Project"):
        raise HTTPException(status_code=422, detail="client and project are required")
    try:
        return await svc.create_record(fields)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── UPDATE ─────────────────────────────────────────────────────────────────

@router.patch("/{record_id}")
async def update_status(
    record_id: str,
    body: StatusUpdate,
    _auth=Depends(require_editor),
):
    """Update an existing status record (editor role required)."""
    svc = _svc()
    fields = body.to_teable_fields()
    if not fields:
        raise HTTPException(status_code=422, detail="No fields provided to update")
    try:
        return await svc.update_record(record_id, fields)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── DELETE ─────────────────────────────────────────────────────────────────

@router.delete("/{record_id}", status_code=204)
async def delete_status(
    record_id: str,
    _auth=Depends(require_editor),
):
    """Delete a status record (editor role required)."""
    svc = _svc()
    try:
        await svc.delete_record(record_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
