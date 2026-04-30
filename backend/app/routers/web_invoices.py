"""
Web Invoice Tracker router — /api/web-invoices
All routes require the "web" role. Editor/viewer tokens get 403.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from typing import Optional, List, Any
from pydantic import BaseModel
from ..services.web_invoice import WebInvoiceService
from .deps import require_web

router = APIRouter(prefix="/api/web-invoices", tags=["web-invoices"])


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


@router.get("/picklists")
async def get_picklists(_role: str = Depends(require_web)):
    """Return current single-select options for all editable picklist fields."""
    try:
        return await WebInvoiceService().get_picklists()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/picklists/{field_name}")
async def add_picklist_option(
    field_name: str, body: AddOptionRequest, _role: str = Depends(require_web)
):
    """Append a new option to a single-select field and return updated list."""
    try:
        return await WebInvoiceService().add_picklist_option(field_name, body.option.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload")
async def upload_attachment(
    file: UploadFile = File(...),
    _role: str = Depends(require_web),
):
    """Proxy a file upload to Teable and return the attachment token object."""
    import httpx
    service = WebInvoiceService()
    try:
        content = await file.read()
        async with httpx.AsyncClient(timeout=60) as client:
            res = await client.post(
                f"{service.base_url}/api/attachments/upload",
                headers={"Authorization": f"Bearer {service.token}"},
                files={"file": (file.filename, content, file.content_type or "application/octet-stream")},
            )
            res.raise_for_status()
            return res.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
