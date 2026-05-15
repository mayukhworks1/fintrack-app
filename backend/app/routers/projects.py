from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from ..services.teable import TeableService
from ..models import ProjectCreate, ProjectUpdate, resolve_status
from ..db.attribution import record_user_attribution
from .deps import require_auth, require_editor

router = APIRouter(prefix="/api/projects", tags=["projects"])


def get_teable():
    return TeableService()


@router.get("")
async def list_projects(
    status: Optional[str] = Query(None),
    client: Optional[str] = Query(None),
    order_by: Optional[str] = Query(None),
    order_dir: str = Query("desc"),
    limit: int = Query(100, le=1000),
    skip: int = Query(0),
    _role: str = Depends(require_auth),
):
    teable = get_teable()
    resolved = resolve_status(status) if status else None
    records = await teable.list_records(
        status=resolved,
        client=client,
        order_by_field=order_by,
        order_dir=order_dir,
        take=limit,
        skip=skip,
    )
    return {"records": records, "count": len(records)}


@router.get("/summary")
async def get_summary(_role: str = Depends(require_auth)):
    teable = get_teable()
    return await teable.get_summary()


@router.get("/search")
async def search_projects(
    q: str = Query(..., min_length=1),
    limit: int = Query(20, le=100),
    _role: str = Depends(require_auth),
):
    teable = get_teable()
    records = await teable.search_records(q, take=limit)
    return {"records": records, "count": len(records)}


@router.get("/{record_id}")
async def get_project(record_id: str, _role: str = Depends(require_auth)):
    teable = get_teable()
    try:
        return await teable.get_record(record_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("", status_code=201)
async def create_project(body: ProjectCreate, request: Request, role: str = Depends(require_editor)):
    teable = get_teable()
    fields = body.to_teable_fields()
    result = await teable.create_record(fields)
    new_id = result.get("id") if isinstance(result, dict) else None
    if new_id:
        try:
            await record_user_attribution(request, role, new_id)
        except Exception:
            pass
    return result


@router.patch("/{record_id}")
async def update_project(
    record_id: str, body: ProjectUpdate, request: Request,
    role: str = Depends(require_editor),
):
    teable = get_teable()
    fields = body.to_teable_fields()
    if not fields:
        raise HTTPException(status_code=400, detail="No fields provided to update.")
    try:
        try:
            await record_user_attribution(request, role, record_id)
        except Exception:
            pass
        return await teable.update_record(record_id, fields)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/{record_id}", status_code=204)
async def delete_project(record_id: str, request: Request, role: str = Depends(require_editor)):
    teable = get_teable()
    try:
        try:
            await record_user_attribution(request, role, record_id)
        except Exception:
            pass
        await teable.delete_record(record_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))
