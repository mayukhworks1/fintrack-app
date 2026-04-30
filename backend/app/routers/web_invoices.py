"""
Web Invoice Tracker router — /api/web-invoices
All routes require the "web" role. Editor/viewer tokens get 403.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from pydantic import BaseModel
from ..services.web_invoice import WebInvoiceService
from .deps import require_web

router = APIRouter(prefix="/api/web-invoices", tags=["web-invoices"])


class WebInvoiceFields(BaseModel):
    invoice_number:  Optional[str]   = None
    project:         Optional[str]   = None
    category:        Optional[str]   = None
    description:     Optional[str]   = None
    milestone:       Optional[str]   = None
    raised_by:       Optional[str]   = None
    raised_date:     Optional[str]   = None
    cleared_date:    Optional[str]   = None
    amount_raised:   Optional[float] = None
    amount_with_tax: Optional[float] = None
    amount_received: Optional[float] = None
    payment_status:  Optional[str]   = None
    remark:          Optional[str]   = None
    next_followup:   Optional[str]   = None

    def to_teable_fields(self) -> dict:
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


@router.get("/summary")
async def web_invoice_summary(_role: str = Depends(require_web)):
    try:
        return await WebInvoiceService().get_summary()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("")
async def list_web_invoices(
    status:   Optional[str] = Query(None),
    project:  Optional[str] = Query(None),
    limit:    int           = Query(200, ge=1, le=1000),
    skip:     int           = Query(0,   ge=0),
    order_by: str           = Query("Raised Date"),
    order:    str           = Query("desc"),
    _role:    str           = Depends(require_web),
):
    try:
        return await WebInvoiceService().list_invoices(
            status=status, project=project,
            limit=limit, skip=skip,
            order_by=order_by, order=order,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{record_id}")
async def get_web_invoice(record_id: str, _role: str = Depends(require_web)):
    try:
        return await WebInvoiceService().get_invoice(record_id)
    except Exception as e:
        raise HTTPException(status_code=404 if "404" in str(e) else 500, detail=str(e))


@router.post("", status_code=201)
async def create_web_invoice(body: WebInvoiceFields, _role: str = Depends(require_web)):
    try:
        return await WebInvoiceService().create_invoice(body.to_teable_fields())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/{record_id}")
async def update_web_invoice(
    record_id: str, body: WebInvoiceFields, _role: str = Depends(require_web)
):
    try:
        return await WebInvoiceService().update_invoice(record_id, body.to_teable_fields())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{record_id}", status_code=204)
async def delete_web_invoice(record_id: str, _role: str = Depends(require_web)):
    try:
        await WebInvoiceService().delete_invoice(record_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
