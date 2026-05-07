"""
Invoice Tracking router — /api/invoices
GET endpoints: require any valid token (editor or viewer).
POST / PATCH / DELETE: require editor token — viewers get 403.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from typing import Optional
from pydantic import BaseModel
from ..services.invoice import InvoiceService
from ..services.openrouter import parse_invoice_document
from .deps import require_auth, require_editor

router = APIRouter(prefix="/api/invoices", tags=["invoices"])


def _validate_paid_invoice(fields: dict) -> None:
    if fields.get("Payment Status") != "Paid":
        return
    if fields.get("Amount Received") in (None, "", 0, 0.0):
        raise HTTPException(status_code=400, detail="Amount Received is required when Payment Status is Paid")
    if not fields.get("Cleared Date"):
        raise HTTPException(status_code=400, detail="Cleared Date is required when Payment Status is Paid")


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
async def invoice_summary(_role: str = Depends(require_auth)):
    try:
        return await InvoiceService().get_summary()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("")
async def list_invoices(
    status:   Optional[str] = Query(None),
    project:  Optional[str] = Query(None),
    limit:    int           = Query(200, ge=1, le=1000),
    skip:     int           = Query(0,   ge=0),
    order_by: str           = Query("Raised Date"),
    order:    str           = Query("desc"),
    _role:    str           = Depends(require_auth),
):
    try:
        return await InvoiceService().list_invoices(
            status=status, project=project,
            limit=limit, skip=skip,
            order_by=order_by, order=order,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{record_id}")
async def get_invoice(record_id: str, _role: str = Depends(require_auth)):
    try:
        return await InvoiceService().get_invoice(record_id)
    except Exception as e:
        raise HTTPException(status_code=404 if "404" in str(e) else 500, detail=str(e))


@router.post("", status_code=201)
async def create_invoice(body: InvoiceFields, _role: str = Depends(require_editor)):
    try:
        fields = body.to_teable_fields()
        _validate_paid_invoice(fields)
        return await InvoiceService().create_invoice(fields)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/{record_id}")
async def update_invoice(
    record_id: str, body: InvoiceFields, _role: str = Depends(require_editor)
):
    try:
        fields = body.to_teable_fields()
        _validate_paid_invoice(fields)
        return await InvoiceService().update_invoice(record_id, fields)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{record_id}", status_code=204)
async def delete_invoice(record_id: str, _role: str = Depends(require_editor)):
    try:
        await InvoiceService().delete_invoice(record_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/parse")
async def parse_invoice(
    file: UploadFile = File(...),
    _role: str = Depends(require_editor),
):
    """
    Upload an invoice image (PNG/JPG) or PDF and get back extracted field values.
    Uses AI vision/text models to populate as many fields as possible.
    """
    MAX_BYTES = 10 * 1024 * 1024  # 10 MB guard
    content   = await file.read()
    if len(content) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 10 MB)")

    mime = file.content_type or "application/octet-stream"
    fname = file.filename or ""

    # Guess MIME from extension if browser sent a generic type
    if mime in ("application/octet-stream", "binary/octet-stream"):
        ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
        mime = {
            "pdf":  "application/pdf",
            "png":  "image/png",
            "jpg":  "image/jpeg",
            "jpeg": "image/jpeg",
            "webp": "image/webp",
        }.get(ext, mime)

    try:
        fields = await parse_invoice_document(content, fname, mime)
        return {"fields": fields}
    except ValueError as e:
        # 400 = bad request from caller (wrong file type, unreadable PDF, etc.)
        # NOTE: Do NOT use 422 here — FastAPI reserves 422 for its own request-validation
        # errors and that makes the frontend receive a [{loc,msg,type}] array as detail.
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Parse failed: {str(e)}")
