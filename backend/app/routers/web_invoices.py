"""
Web Invoice Tracker router — /api/web-invoices
Routes accept 'web' OR 'all' role (require_web_access).
'web'  — invoice tracker only (Theworks@2026)
'all'  — invoice tracker + project tracker (All@2026)
"""
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from typing import Optional, List, Any
from pydantic import BaseModel
from ..services.web_invoice import WebInvoiceService
from .deps import require_web_access

router = APIRouter(prefix="/api/web-invoices", tags=["web-invoices"])


def _validate_paid_invoice(fields: dict) -> None:
    if fields.get("Payment Status") != "Paid":
        return
    if fields.get("Amount Received") in (None, "", 0, 0.0):
        raise HTTPException(status_code=400, detail="Amount Received is required when Payment Status is Paid")
    if not fields.get("Cleared Date"):
        raise HTTPException(status_code=400, detail="Cleared Date is required when Payment Status is Paid")


class AddOptionRequest(BaseModel):
    option: str


class WebInvoiceFields(BaseModel):
    invoice_number:  Optional[str]        = None
    project:         Optional[str]        = None
    category:        Optional[str]        = None
    description:     Optional[str]        = None
    milestone:       Optional[str]        = None
    raised_by:       Optional[str]        = None
    raised_date:     Optional[str]        = None
    cleared_date:    Optional[str]        = None
    amount_raised:   Optional[float]      = None
    amount_with_tax: Optional[float]      = None
    amount_received: Optional[float]      = None
    payment_status:  Optional[str]        = None
    remark:          Optional[str]        = None
    next_followup:   Optional[str]        = None
    reference:       Optional[List[Any]]  = None  # attachment objects from Teable
    invoice_pdf:     Optional[List[Any]]  = None  # attachment objects from Teable

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
            "Reference":       self.reference,
            "Invoice PDF":     self.invoice_pdf,
        }
        # Include lists even if empty (allows clearing attachments); exclude only None
        return {k: v for k, v in m.items() if v is not None}


@router.get("/client-names")
async def get_client_names(_role: str = Depends(require_web_access)):
    """Distinct project/client names from actual invoice records (for autocomplete)."""
    try:
        return await WebInvoiceService().get_distinct_client_names()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/picklists")
async def get_picklists(_role: str = Depends(require_web_access)):
    """Return current single-select options for all editable picklist fields."""
    try:
        return await WebInvoiceService().get_picklists()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/picklists/{field_name}")
async def add_picklist_option(
    field_name: str, body: AddOptionRequest, _role: str = Depends(require_web_access)
):
    """Append a new option to a single-select field and return updated list."""
    try:
        return await WebInvoiceService().add_picklist_option(field_name, body.option.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload/{record_id}/{field_name}")
async def upload_attachment(
    record_id: str,
    field_name: str,
    file: UploadFile = File(...),
    _role: str = Depends(require_web_access),
):
    """Upload a file into a specific attachment field on an existing Teable record."""
    service = WebInvoiceService()
    try:
        content = await file.read()
        return await service.upload_attachment_to_field(
            record_id=record_id,
            field_name=field_name,
            filename=file.filename or "upload.bin",
            content=content,
            content_type=file.content_type or "application/octet-stream",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/summary")
async def web_invoice_summary(_role: str = Depends(require_web_access)):
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
    _role:    str           = Depends(require_web_access),
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
async def get_web_invoice(record_id: str, _role: str = Depends(require_web_access)):
    try:
        return await WebInvoiceService().get_invoice(record_id)
    except Exception as e:
        raise HTTPException(status_code=404 if "404" in str(e) else 500, detail=str(e))


@router.post("", status_code=201)
async def create_web_invoice(body: WebInvoiceFields, _role: str = Depends(require_web_access)):
    try:
        fields = body.to_teable_fields()
        _validate_paid_invoice(fields)
        return await WebInvoiceService().create_invoice(fields)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/{record_id}")
async def update_web_invoice(
    record_id: str, body: WebInvoiceFields, _role: str = Depends(require_web_access)
):
    try:
        fields = body.to_teable_fields()
        _validate_paid_invoice(fields)
        return await WebInvoiceService().update_invoice(record_id, fields)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{record_id}", status_code=204)
async def delete_web_invoice(record_id: str, _role: str = Depends(require_web_access)):
    try:
        await WebInvoiceService().delete_invoice(record_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
