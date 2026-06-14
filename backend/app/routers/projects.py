from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from ..services.teable import TeableService
from ..models import ProjectCreate, ProjectUpdate, resolve_status
from ..db.attribution import record_user_attribution
from ..db.valkey import cache_bust
from .deps import require_auth, require_editor

router = APIRouter(prefix="/api/projects", tags=["projects"])


async def _bust_projects_cache():
    try:
        await cache_bust("projects:")
    except Exception:
        pass


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
    # No cache — read directly from Teable so new projects and status changes
    # appear immediately without any stale-window.
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
    summary = await teable.get_summary_from_pg()
    if summary is not None:
        return summary
    return await teable.get_summary()


@router.get("/names")
async def list_project_names(_role: str = Depends(require_auth)):
    """
    Lightweight endpoint — returns just project names (and clients) for picklists.
    Reads from PG mirror so it's ~2 ms. Falls back to full Teable list.
    Used by the invoice form to populate the Project dropdown in real time.
    """
    from ..db.postgres import get_pool
    pool = get_pool()
    if pool:
        try:
            rows = await pool.fetch(
                """
                SELECT fields->>'Project Name' AS name, fields->>'Client' AS client
                FROM projects_mirror
                WHERE fields->>'Project Name' IS NOT NULL
                  AND fields->>'Project Name' != ''
                ORDER BY fields->>'Project Name'
                """
            )
            return [{"name": r["name"], "client": r["client"]} for r in rows]
        except Exception:
            pass
    # Fallback: live Teable
    teable = get_teable()
    records = await teable.list_records(take=500)
    return [
        {
            "name": r.get("fields", {}).get("Project Name", ""),
            "client": r.get("fields", {}).get("Client", ""),
        }
        for r in records
        if r.get("fields", {}).get("Project Name")
    ]


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
    await _bust_projects_cache()
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
        result = await teable.update_record(record_id, fields)
        await _bust_projects_cache()
        return result
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
        await _bust_projects_cache()
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))
