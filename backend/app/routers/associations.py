from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from .deps import require_auth, require_editor
from ..services.associations import AssociationService

router = APIRouter(prefix="/api/associations", tags=["associations"])


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
