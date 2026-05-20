import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from .deps import require_auth, require_editor, require_admin
from ..services.associations import AssociationService

router = APIRouter(prefix="/api/associations", tags=["associations"])
logger = logging.getLogger("fintrack.routers.associations")


def _svc() -> AssociationService:
    return AssociationService()


def _client_ip(request: Request) -> str:
    for header in ("cf-connecting-ip", "x-forwarded-for", "x-real-ip"):
        value = request.headers.get(header, "")
        if value:
            return value.split(",")[0].strip()
    return request.client.host if request.client else ""


class AssociationLinkRequest(BaseModel):
    source_table: str
    teable_id: str
    client_entity_id: Optional[str] = None
    project_entity_id: Optional[str] = None
    client_name: Optional[str] = None
    project_name: Optional[str] = None


class BulkLinkRequest(BaseModel):
    client_name: str = ""
    project_name: str = ""


@router.get("/search")
async def search_associations(
    q: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=50),
    _role: str = Depends(require_auth),
):
    try:
        return await _svc().search_entities(q, limit=limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/record/{source_table}/{teable_id}")
async def get_record_association(
    source_table: str,
    teable_id: str,
    _role: str = Depends(require_auth),
):
    try:
        return await _svc().get_record_association(source_table, teable_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/link")
async def upsert_record_association(
    body: AssociationLinkRequest,
    request: Request,
    role: str = Depends(require_editor),
):
    try:
        return await _svc().upsert_manual_link(
            body.source_table,
            body.teable_id,
            client_entity_id=body.client_entity_id,
            project_entity_id=body.project_entity_id,
            client_name=body.client_name or "",
            project_name=body.project_name or "",
            actor_role=role,
            actor_ip=_client_ip(request),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/record/{source_table}/{teable_id}")
async def delete_record_association(
    source_table: str,
    teable_id: str,
    _role: str = Depends(require_editor),
):
    try:
        return await _svc().unlink_record(source_table, teable_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Stats ─────────────────────────────────────────────────────────────────────

@router.get("/stats")
async def get_association_stats(_role: str = Depends(require_auth)):
    """Row counts for all association tables."""
    try:
        return await _svc().get_stats()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Bulk link — link ALL matching records by client + project name ─────────────

@router.post("/bulk-link")
async def bulk_link_by_name(
    body: BulkLinkRequest,
    request: Request,
    role: str = Depends(require_editor),
):
    """
    Given canonical client + project names, find and link ALL matching records
    across status_mirror, projects_mirror, invoices_mirror, web_invoices_mirror.
    Returns a summary of counts linked per table.
    """
    if not body.client_name.strip() and not body.project_name.strip():
        raise HTTPException(status_code=400, detail="client_name or project_name required")
    try:
        result = await _svc().bulk_link_by_name(
            body.client_name,
            body.project_name,
            actor_role=role,
            actor_ip=_client_ip(request),
        )
        logger.info(
            "bulk_link: client=%r project=%r actor=%s total=%s",
            body.client_name, body.project_name, role, result.get("total"),
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Admin reset — DELETE all association data ─────────────────────────────────

@router.delete("/reset")
async def reset_all_associations(
    request: Request,
    role: str = Depends(require_admin),
):
    """
    DELETE all rows from record_links, project_entities, client_entities.
    Requires admin role. Irreversible — use only to start fresh.
    """
    try:
        result = await _svc().reset_all()
        logger.warning(
            "ASSOCIATION RESET by role=%s ip=%s: %s",
            role, _client_ip(request), result.get("deleted"),
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
