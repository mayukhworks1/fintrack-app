"""
Invoice Tracking router — /api/invoices
All endpoints require a valid Bearer token (auth middleware applied globally).
"""
from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from pydantic import BaseModel
from ..services.invoice import InvoiceService

router = APIRouter(prefix="/api/invoices", tags=["invoices"])


# ── Pydantic models ──────────────────────────────────────────────────────────

class InvoiceFields(BaseModel):
    """Fields that callers can set. Read-only computed fields are ignored."""
    invoice_number:   Optional[str]   = None
    project:          Optional[str]   = None
    category:         Optional[str]   = None
    description:      Optional[str]   = None
    milestone:        Optional[str]   = None
    raised_by:        Optional[str]   = None
    raised_date:      Optional[str]   = None   # ISO 8601
    cleared_date:     Optional[str]   = None   # ISO 8601
    amount_raised:    Optional[float] = None
    amount_with_tax:  Optional[float] = None
    amount_received:  Optional[float] = None
    payment_status:   Optional[str]   = None
    remark:           Optional[str]   = None
    next_followup:    Optional[str]   = None   # ISO 8601

    def to_teable_fields(self) -> dict:
        """Map camelCase → exact Teable field names."""
        m = {
            "Invoice Number":  self.invoice_number,
            "Project":         self.project,
            "Category":        self.category,
            "Description":     self.description,
            "Milestone":       self.milestone,
            "Raised By":       self.raised_by,
            "Raised Date":     self.raised_date,
            "Cleared Date":    self.cleared_date,
            "Amount Raised":   self.amount_raised,
            "Amount with Tax": self.amount_with_tax,
            "Amount Received": self.amount_received,
            "Payment Status":  self.payment_status,
            "Remark":          self.remark,
            "Next followup":   self.next_followup,
        }
        return {k: v for k, v in m.items() if v is not None}


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/summary")
async def invoice_summary():
    """Aggregated financial summary across all invoices."""
    try:
        svc = InvoiceService()
        return await svc.get_summary()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("")
async def list_invoices(
    status:   Optional[str] = Query(None, description="Filter by Payment Status: Paid|Pending|Cancelled"),
    project:  Optional[str] = Query(None, description="Filter by Project name"),
    limit:    int           = Query(200, ge=1, le=1000),
    skip:     int           = Query(0,   ge=0),
    order_by: str           = Query("Raised Date"),
    order:    str           = Query("desc"),
):
    """List invoices with optional status/project filters."""
    try:
        svc = InvoiceService()
        return await svc.list_invoices(
            status=status, project=project,
            limit=limit, skip=skip,
            order_by=order_by, order=order,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{record_id}")
async def get_invoice(record_id: str):
    """Fetch a single invoice record by its Teable record ID."""
    try:
        svc = InvoiceService()
        return await svc.get_invoice(record_id)
    except Exception as e:
        raise HTTPException(status_code=404 if "404" in str(e) else 500, detail=str(e))


@router.post("", status_code=201)
async def create_invoice(body: InvoiceFields):
    """Create a new invoice in Teable."""
    try:
        svc = InvoiceService()
        return await svc.create_invoice(body.to_teable_fields())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/{record_id}")
async def update_invoice(record_id: str, body: InvoiceFields):
    """Update an existing invoice record."""
    try:
        svc = InvoiceService()
        return await svc.update_invoice(record_id, body.to_teable_fields())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{record_id}", status_code=204)
async def delete_invoice(record_id: str):
    """Delete an invoice record."""
    try:
        svc = InvoiceService()
        await svc.delete_invoice(record_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
