from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..db.postgres import get_pool
from ..services.insights import build_excel_xml, build_simple_pdf, default_export_meta
from .deps import require_auth, require_editor

router = APIRouter(prefix="/api/insights", tags=["insights"])


def _row_to_dict(row) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in dict(row).items():
        if hasattr(value, "isoformat"):
            out[key] = value.isoformat()
        else:
            out[key] = value
    return out


class InsightConfigBody(BaseModel):
    page_key: str
    config_kind: str = "dashboard"
    title: str
    config: dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True


class ExportBody(BaseModel):
    page_key: str
    source_key: str
    title: str
    export_format: str
    columns: list[str]
    rows: list[list[Any]]
    filters: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    config_id: Optional[str] = None


@router.get("/configs")
async def list_configs(
    page_key: Optional[str] = None,
    config_kind: Optional[str] = None,
    _: str = Depends(require_auth),
):
    pool = get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="PostgreSQL unavailable")
    where = ["1=1"]
    params: list[Any] = []
    idx = 1
    if page_key:
        where.append(f"page_key = ${idx}")
        params.append(page_key)
        idx += 1
    if config_kind:
        where.append(f"config_kind = ${idx}")
        params.append(config_kind)
        idx += 1
    rows = await pool.fetch(
        f"""
        SELECT id, created_at, updated_at, page_key, config_kind, title, role, ip, is_active, config
        FROM insight_configs
        WHERE {' AND '.join(where)}
        ORDER BY updated_at DESC
        """,
        *params,
    )
    return {"configs": [_row_to_dict(row) for row in rows], "total": len(rows)}


@router.post("/configs")
async def create_config(body: InsightConfigBody, request: Request, role: str = Depends(require_editor)):
    pool = get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="PostgreSQL unavailable")
    ip = request.headers.get("cf-connecting-ip") or request.client.host if request.client else None
    row = await pool.fetchrow(
        """
        INSERT INTO insight_configs (page_key, config_kind, title, role, ip, is_active, config)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        RETURNING id, created_at, updated_at, page_key, config_kind, title, role, ip, is_active, config
        """,
        body.page_key,
        body.config_kind,
        body.title,
        role,
        ip,
        body.is_active,
        json.dumps(body.config),
    )
    return _row_to_dict(row)


@router.patch("/configs/{config_id}")
async def update_config(config_id: str, body: InsightConfigBody, request: Request, role: str = Depends(require_editor)):
    pool = get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="PostgreSQL unavailable")
    ip = request.headers.get("cf-connecting-ip") or request.client.host if request.client else None
    row = await pool.fetchrow(
        """
        UPDATE insight_configs
        SET page_key = $2,
            config_kind = $3,
            title = $4,
            role = $5,
            ip = $6,
            is_active = $7,
            config = $8::jsonb,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, created_at, updated_at, page_key, config_kind, title, role, ip, is_active, config
        """,
        config_id,
        body.page_key,
        body.config_kind,
        body.title,
        role,
        ip,
        body.is_active,
        json.dumps(body.config),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Config not found")
    return _row_to_dict(row)


@router.delete("/configs/{config_id}", status_code=204)
async def delete_config(config_id: str, _: str = Depends(require_editor)):
    pool = get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="PostgreSQL unavailable")
    await pool.execute("DELETE FROM insight_configs WHERE id = $1", config_id)


@router.post("/export")
async def export_insight(body: ExportBody, request: Request, role: str = Depends(require_auth)):
    pool = get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="PostgreSQL unavailable")
    fmt = body.export_format.lower()
    meta = default_export_meta(body.page_key, body.source_key, len(body.rows))
    meta.update(body.metadata or {})
    ip = request.headers.get("cf-connecting-ip") or request.client.host if request.client else None

    await pool.execute(
        """
        INSERT INTO insight_exports (page_key, source_key, export_format, title, role, ip, config_id, column_count, row_count, columns, filters, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7::uuid, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb)
        """,
        body.page_key,
        body.source_key,
        fmt,
        body.title,
        role,
        ip,
        body.config_id,
        len(body.columns),
        len(body.rows),
        json.dumps(body.columns),
        json.dumps(body.filters or {}),
        json.dumps(meta),
    )

    filename_base = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in (body.title or "report")).strip("_") or "report"
    if fmt in {"excel", "xls"}:
        content = build_excel_xml(body.title, body.columns, body.rows, meta)
        return Response(
            content=content,
            media_type="application/vnd.ms-excel",
            headers={"Content-Disposition": f'attachment; filename="{filename_base}.xls"'},
        )
    if fmt == "pdf":
        content = build_simple_pdf(body.title, body.columns, body.rows, meta)
        return Response(
            content=content,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename_base}.pdf"'},
        )
    raise HTTPException(status_code=400, detail="Unsupported export format")
