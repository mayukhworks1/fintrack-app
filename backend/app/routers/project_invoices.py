"""
Project ↔ Invoice association endpoints — /api/project-invoices

GET    /api/project-invoices/picklist               invoice picklist for dropdowns
GET    /api/project-invoices/{project_id}           linked invoices
GET    /api/project-invoices/{project_id}/log       audit log
POST   /api/project-invoices/{project_id}           link an invoice
DELETE /api/project-invoices/{project_id}/{inv_id}  unlink

Auth:
  GET  — require_auth  (viewer + editor)
  POST / DELETE — require_editor (editor only)
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from .deps import require_auth, require_editor
from ..services.project_invoices import ProjectInvoiceService

router = APIRouter(prefix="/api/project-invoices", tags=["project-invoices"])


def _svc() -> ProjectInvoiceService:
    return ProjectInvoiceService()


def _ip(request: Request) -> str:
    for h in ("cf-connecting-ip", "x-forwarded-for", "x-real-ip"):
        v = request.headers.get(h, "")
        if v:
            return v.split(",")[0].strip()
    return request.client.host if request.client else ""


# ── Pydantic models ───────────────────────────────────────────────────────────

class LinkInvoiceBody(BaseModel):
    invoice_teable_id: str
    invoice_source: Optional[str] = "invoices"
    note: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/picklist")
async def get_invoice_picklist(
    source:  str = Query("invoices", description="'invoices' or 'web_invoices'"),
    q:       str = Query("",  description="Search term (invoice number or project name)"),
    exclude: str = Query("",  description="Comma-separated teable_ids to hide"),
    limit:   int = Query(100, ge=1, le=300),
    _auth: str = Depends(require_auth),
):
    """
    Lightweight invoice list for picklist / association dropdowns.
    Results cached in Valkey (60 s) when no filters are applied.
    """
    exclude_ids = [x.strip() for x in exclude.split(",") if x.strip()]
    try:
        rows = await _svc().get_invoice_picklist(
            source=source, q=q, exclude_ids=exclude_ids, limit=limit
        )
        return {"source": source, "invoices": rows, "total": len(rows)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{project_id}/log")
async def get_project_invoice_log(
    project_id: str,
    limit: int = Query(50, ge=1, le=200),
    _auth: str = Depends(require_auth),
):
    """
    Full append-only audit trail of all invoice link/unlink actions for a project.
    """
    try:
        log = await _svc().get_project_invoice_log(project_id, limit=limit)
        return {"project_teable_id": project_id, "log": log, "total": len(log)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{project_id}")
async def get_linked_invoices(
    project_id: str,
    _auth: str = Depends(require_auth),
):
    """
    List all invoices currently linked to a project.
    Results cached in Valkey (120 s); busted on any link/unlink.
    """
    try:
        invoices = await _svc().get_linked_invoices(project_id)
        return {
            "project_teable_id": project_id,
            "invoices": invoices,
            "total": len(invoices),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/{project_id}", status_code=201)
async def link_invoice(
    project_id: str,
    body: LinkInvoiceBody,
    request: Request,
    role: str = Depends(require_editor),
):
    """
    Link an invoice to a project.
    Idempotent — re-links if previously unlinked.
    Every call appends a row to project_invoice_log.
    """
    if not body.invoice_teable_id.strip():
        raise HTTPException(status_code=400, detail="invoice_teable_id is required")
    try:
        invoices = await _svc().link_invoice(
            project_id,
            body.invoice_teable_id.strip(),
            invoice_source=body.invoice_source or "invoices",
            actor_role=role,
            actor_ip=_ip(request),
            note=body.note,
        )
        return {"ok": True, "project_teable_id": project_id, "invoices": invoices}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/{project_id}/{invoice_id}", status_code=200)
async def unlink_invoice(
    project_id: str,
    invoice_id: str,
    request: Request,
    role: str = Depends(require_editor),
):
    """
    Soft-delete an invoice association.
    The row is kept in project_invoices (is_active=FALSE) and an 'unlinked'
    entry is appended to project_invoice_log for full traceability.
    """
    try:
        return await _svc().unlink_invoice(
            project_id, invoice_id, actor_role=role, actor_ip=_ip(request)
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
