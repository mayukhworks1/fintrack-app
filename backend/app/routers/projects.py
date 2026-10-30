import logging
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from ..services.teable import TeableService
from ..models import ProjectCreate, ProjectUpdate, resolve_status
from ..db.attribution import record_user_attribution
from ..db.valkey import cache_bust, rate_check
from ..utils.client_ip import client_ip
from .deps import require_auth, require_editor, require_permission
from ..db import postgres as _pg
from ..services import project_query as pq
from ..services.list_query import QueryError
from ..utils.fast_json import json_response

logger = logging.getLogger("fintrack.projects")


async def _check_project_rate(request: Request) -> None:
    allowed, _ = await rate_check(client_ip(request) or "unknown", limit=30, window_sec=60, bucket="project_mutate")
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many project mutations — limited to 30/min.",
            headers={"Retry-After": "60"},
        )

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
    _perm: str = Depends(require_permission("module.projects.view")),
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
async def get_summary(
    _role: str = Depends(require_auth),
    _perm: str = Depends(require_permission("module.projects.view")),
):
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
    pool = _pg.get_pool()
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


def _project_scope(
    q:      Optional[str] = Query(None, max_length=200),
    status: Optional[str] = Query(None, max_length=255),
    client: Optional[str] = Query(None, max_length=255),
    sort:   Optional[str] = Query(None, max_length=60),
    order:  Optional[str] = Query(None, max_length=4),
) -> pq.ProjectQuery:
    try:
        return pq.build_project_query(q=q, status=status, client=client, sort=sort, order=order)
    except QueryError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/query")
async def query_projects(
    request:    Request,
    qry:        pq.ProjectQuery = Depends(_project_scope),
    limit:      int             = Query(pq.DEFAULT_LIMIT, ge=1, le=pq.MAX_LIMIT),
    cursor:     Optional[str]   = Query(None, max_length=2000),
    offset:     int             = Query(0, ge=0, le=1_000_000),
    aggregates: bool            = Query(True),
    _role:      str             = Depends(require_auth),
    _perm:      str             = Depends(require_permission("module.projects.view")),
):
    """One page of projects for the search and filters, plus totals.

    `q` matches every word in Project Name, Client, Project Status or Health;
    `status` and `client` filter; `sort` / `order` are whitelisted; pass
    `next_cursor` back as `cursor` for the next page. `aggregates` holds the
    filtered scope's totals (billed, profit, margin, needs-action, blind
    spots, the action queue…) and `workspace` the whole portfolio's, with the
    filter options. Answered from projects_mirror, from Teable through the
    same rules when the mirror cannot answer; carries an ETag."""
    try:
        cur = pq.decode_cursor(qry, cursor) if cursor else None
    except QueryError as e:
        raise HTTPException(status_code=400, detail=str(e))
    now = datetime.now(timezone.utc)
    result, source = None, "mirror"
    pool = _pg.get_pool()
    if pool is not None:
        try:
            result = await pq.query_mirror(pool, qry, limit=limit, cursor=cur, offset=offset,
                                           aggregates=aggregates, now=now)
        except Exception as exc:
            logger.warning("project query via PG mirror failed, falling back to Teable: %s", exc)
    if result is None:
        source = "teable"
        try:
            records = await get_teable().get_all_records()
        except Exception as exc:
            logger.warning("project query: Teable fallback failed: %s", exc)
            raise HTTPException(status_code=503, detail="Projects are temporarily unavailable")
        result = pq.query_records(records, qry, limit=limit, cursor=cur, offset=offset, aggregates=aggregates)
    payload: dict = {
        "records": [{"id": r["id"], "fields": r["fields"]} for r in result["records"]],
        "total": result["total"],
        "next_cursor": pq.encode_cursor(qry, *result["next"]) if result["next"] else None,
        "limit": limit,
        "sort": qry.sort,
        "order": qry.order,
        "filtered": qry.filtered,
        "source": source,
    }
    if aggregates:
        payload["aggregates"] = result["aggregates"]
        payload["workspace"] = result["workspace"]
    return json_response(request, payload)


@router.get("/search")
async def search_projects(
    q: str = Query(..., min_length=1),
    limit: int = Query(20, le=100),
    _role: str = Depends(require_auth),
    _perm: str = Depends(require_permission("module.projects.view")),
):
    teable = get_teable()
    records = await teable.search_records(q, take=limit)
    return {"records": records, "count": len(records)}


@router.get("/{record_id}")
async def get_project(
    record_id: str,
    _role: str = Depends(require_auth),
    _perm: str = Depends(require_permission("module.projects.view")),
):
    teable = get_teable()
    try:
        return await teable.get_record(record_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("", status_code=201)
async def create_project(
    body: ProjectCreate, request: Request,
    role: str = Depends(require_editor),
    _perm: str = Depends(require_permission("module.projects.create")),
):
    await _check_project_rate(request)
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
    _perm: str = Depends(require_permission("module.projects.edit")),
):
    await _check_project_rate(request)
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
async def delete_project(
    record_id: str, request: Request,
    role: str = Depends(require_editor),
    _perm: str = Depends(require_permission("module.projects.delete")),
):
    await _check_project_rate(request)
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
