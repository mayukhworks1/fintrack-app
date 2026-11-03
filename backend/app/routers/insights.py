from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Optional

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..db import postgres as _pg
from ..db.postgres import get_pool
from ..services import insight_cards as ic
from ..services.insights import build_excel_xml, build_simple_pdf, default_export_meta
from ..utils.client_ip import client_ip
from .deps import get_effective_permissions, owner_scope_email, require_auth, require_editor

router = APIRouter(prefix="/api/insights", tags=["insights"])
logger = logging.getLogger("fintrack.insights")

# Export bounds. The rows come from the client, and rendering is CPU-bound:
# reportlab measured about 1.4 s per 1,000 rows. 50,000 rows is the most the
# admin exporters page in (100 pages of 500); a PDF that long is unreadable, so
# PDF stops far sooner and Excel carries the large sets.
MAX_EXPORT_ROWS = 50_000
MAX_PDF_EXPORT_ROWS = 5_000
MAX_EXPORT_COLUMNS = 200


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
    ip = client_ip(request) or None
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
    ip = client_ip(request) or None
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
    if len(body.columns) > MAX_EXPORT_COLUMNS:
        raise HTTPException(status_code=413, detail=f"Exports are limited to {MAX_EXPORT_COLUMNS} columns.")
    if len(body.rows) > MAX_EXPORT_ROWS:
        raise HTTPException(
            status_code=413,
            detail=f"Exports are limited to {MAX_EXPORT_ROWS:,} rows. Narrow the filters and try again.",
        )
    if fmt == "pdf" and len(body.rows) > MAX_PDF_EXPORT_ROWS:
        raise HTTPException(
            status_code=413,
            detail=f"PDF exports are limited to {MAX_PDF_EXPORT_ROWS:,} rows. Narrow the filters, or export to Excel.",
        )
    meta = default_export_meta(body.page_key, body.source_key, len(body.rows))
    meta.update(body.metadata or {})
    ip = client_ip(request) or None

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
    # Rendering runs in a worker thread: on the loop, a large export stalled
    # every other request until the file was built.
    if fmt in {"excel", "xls"}:
        content = await asyncio.to_thread(build_excel_xml, body.title, body.columns, body.rows, meta)
        return Response(
            content=content,
            media_type="application/vnd.ms-excel",
            headers={"Content-Disposition": f'attachment; filename="{filename_base}.xls"'},
        )
    if fmt == "pdf":
        content = await asyncio.to_thread(build_simple_pdf, body.title, body.columns, body.rows, meta)
        return Response(
            content=content,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename_base}.pdf"'},
        )
    raise HTTPException(status_code=400, detail="Unsupported export format")


# ── Insight cards (phone screens) ─────────────────────────────────────────────

async def _may(request: Request, permission_key: str) -> bool:
    """require_permission's test as a yes or no: legacy sessions and superadmin
    pass; an email session needs the key among its effective permissions."""
    if not getattr(request.state, "is_email_auth", False):
        return True
    if (getattr(request.state, "auth_role", "") or "") == "superadmin":
        return True
    return permission_key in await get_effective_permissions(getattr(request.state, "auth_user_id", None))


async def _invoice_records(owner: Optional[str]) -> list[dict]:
    from ..services.invoice import InvoiceService
    return list(await InvoiceService().get_all_invoices(raised_by=owner))


async def _project_records() -> list[dict]:
    from ..services.teable import TeableService
    return list(await TeableService().get_all_records())


@router.get("")
async def insight_cards(
    request: Request,
    scope: str = Query("dashboard", max_length=20),
    tz: int = Query(0, ge=-900, le=900),
    role: str = Depends(require_auth),
):
    """Up to five ranked findings for `scope` (dashboard | invoices | projects |
    tax), each with a one-tap link, plus the summary cards' series (cash in by
    month, pending invoices by age) for dashboard and invoices.

    Each source is read only with its module's view permission, and invoice
    figures keep the caller's owner scope. The GST card is the whole
    workspace's return, so owner-scoped sessions and viewers (who cannot open
    the Tax Ledger) do not get it."""
    if scope not in ic.SCOPES:
        raise HTTPException(status_code=400, detail=f"scope must be one of {', '.join(ic.SCOPES)}")
    rules = set(ic.SCOPE_RULES[scope])
    now = datetime.now(timezone.utc)
    pool = _pg.get_pool()
    owner = owner_scope_email(request)
    inv = prj = None
    if (rules & ic.INVOICE_RULES or scope in ic.CHART_SCOPES) and await _may(request, "module.invoices.view"):
        try:
            inv = await ic.cached_invoice_facts(pool, now, tz, owner, with_gst=not owner and role != "viewer",
                                                load_records=lambda: _invoice_records(owner))
        except Exception as exc:
            logger.warning("insight cards: invoice facts unavailable: %s", exc)
    if rules & ic.PROJECT_RULES and await _may(request, "module.projects.view"):
        try:
            prj = await ic.cached_project_facts(pool, now, load_records=_project_records)
        except Exception as exc:
            logger.warning("insight cards: project facts unavailable: %s", exc)
    return ic.respond(scope, inv, prj, tz=tz)
