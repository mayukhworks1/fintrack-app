"""
Invoice Tracking router — /api/invoices
GET endpoints: require any valid token (editor or viewer).
POST / PATCH / DELETE: require editor token — viewers get 403.
"""
from fastapi import APIRouter, Body, Depends, HTTPException, Query, UploadFile, File, Request
from typing import Optional, Iterable, List, Any
from pydantic import BaseModel, field_validator
import httpx
import logging
import re
from datetime import date as _date
from ..services.invoice import InvoiceService
from ..services.openrouter import parse_invoice_document
from ..db.attribution import record_user_attribution
from ..db.valkey import rate_check
from ..utils.ownership import is_record_owner
from .deps import require_auth, owner_scope_email, require_permission, get_effective_permissions

logger = logging.getLogger("fintrack.invoices")

router = APIRouter(prefix="/api/invoices", tags=["invoices"])


def _ip(request: Request) -> str:
    for h in ("cf-connecting-ip", "x-forwarded-for", "x-real-ip"):
        v = request.headers.get(h, "")
        if v:
            return v.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def _check_mutation_rate(request: Request) -> None:
    """60 invoice mutations / min / IP — prevents bulk-scripted abuse."""
    allowed, _ = await rate_check(_ip(request), limit=60, window_sec=60, bucket="invoice_mutate")
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many invoice mutations — limited to 60/min. Try again shortly.",
            headers={"Retry-After": "60"},
        )


def _validate_amounts(fields: dict) -> None:
    """Reject negative or zero amounts — a real invoice always has a positive value."""
    for key in ("Amount Raised", "Amount with Tax", "Amount Received"):
        val = fields.get(key)
        if val is None:
            continue
        try:
            n = float(val)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"{key} must be a number")
        if key in ("Amount Raised", "Amount with Tax") and n <= 0:
            raise HTTPException(status_code=400, detail=f"{key} must be greater than zero")
        if key == "Amount Received" and n < 0:
            raise HTTPException(status_code=400, detail="Amount Received cannot be negative")

    # Cleared Date must not be before Raised Date
    rd = fields.get("Raised Date")
    cd = fields.get("Cleared Date")
    if rd and cd:
        from datetime import date as _date
        try:
            if _date.fromisoformat(cd[:10]) < _date.fromisoformat(rd[:10]):
                raise HTTPException(status_code=400, detail="Cleared Date cannot be before Raised Date")
        except (ValueError, TypeError):
            pass


def _validate_paid_invoice(fields: dict) -> None:
    has_payment_fields = (
        fields.get("Payment Status") == "Paid"
        or fields.get("Amount Received") not in (None, "", 0, 0.0)
        or bool(fields.get("Cleared Date"))
    )
    if not has_payment_fields:
        return
    if fields.get("Payment Status") != "Paid":
        raise HTTPException(status_code=400, detail="Payment Status must be Paid when recording received amount or cleared date")
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
    client_name:      Optional[str]   = None   # single-select: Birla Open Minds / Maitrimetal / Innovine
    reference:        Optional[List[Any]] = None
    invoice_pdf:      Optional[List[Any]] = None

    @field_validator('raised_by')
    @classmethod
    def validate_raised_by(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == '':
            return v
        # Email-like format check
        if not re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', v.strip()):
            raise ValueError('Raised By must be a valid email format')
        return v.strip()

    @field_validator('invoice_number')
    @classmethod
    def validate_invoice_number(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == '':
            return v
        if len(v) > 50:
            raise ValueError('Invoice Number cannot exceed 50 characters')
        return v.strip()

    @field_validator('amount_raised', 'amount_with_tax')
    @classmethod
    def validate_positive_amounts(cls, v: Optional[float]) -> Optional[float]:
        if v is None:
            return v
        if v <= 0:
            raise ValueError('Amount must be greater than zero')
        if v > 10_000_000:  # 1 crore max
            raise ValueError('Amount cannot exceed 1 crore')
        return v

    @field_validator('amount_received')
    @classmethod
    def validate_non_negative_received(cls, v: Optional[float]) -> Optional[float]:
        if v is None:
            return v
        if v < 0:
            raise ValueError('Amount Received cannot be negative')
        if v > 10_000_000:
            raise ValueError('Amount cannot exceed 1 crore')
        return v

    @field_validator('raised_date', 'cleared_date', 'next_followup', mode='before')
    @classmethod
    def validate_iso_dates(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == '':
            return v
        try:
            # Try parsing as ISO date (YYYY-MM-DD or with time)
            _date.fromisoformat(v[:10])
            return v
        except (ValueError, TypeError):
            raise ValueError('Dates must be in ISO 8601 format (YYYY-MM-DD)')

    @field_validator('description', 'remark')
    @classmethod
    def validate_text_fields(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == '':
            return v
        if len(v) > 1000:
            raise ValueError('Text fields cannot exceed 1000 characters')
        return v.strip()

    def to_teable_fields(self, include_null_fields: Iterable[str] | None = None) -> dict:
        m = {
            "Invoice Number":  self.invoice_number,
            "Project":         self.project,
            "Client Name":     self.client_name,
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
        allow_null = set(include_null_fields or [])
        return {
            k: v for k, v in m.items()
            # Exclude None, empty strings, and empty arrays — Teable linked-record
            # fields (Reference, Invoice PDF) reject [] with a validation error.
            if (v is not None and v != "" and v != []) or k in allow_null
        }


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/summary")
async def invoice_summary(
    request: Request,
    _role: str = Depends(require_auth),
    _perm: str = Depends(require_permission("module.invoices.view")),
):
    try:
        svc = InvoiceService()
        scoped_email = owner_scope_email(request)
        summary = await svc.get_summary(raised_by=scoped_email)
        if summary is not None:
            return summary
        if scoped_email:
            return summary
        return await svc.get_summary_from_pg()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/picklists")
async def get_invoice_picklists(_role: str = Depends(require_auth)):
    """Return single-select options (Project, Client Name, Category, etc.) from Teable schema."""
    try:
        return await InvoiceService().get_picklists()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("")
async def list_invoices(
    request: Request,
    status:   Optional[str] = Query(None),
    project:  Optional[str] = Query(None),
    limit:    int           = Query(200, ge=1, le=1000),
    skip:     int           = Query(0,   ge=0),
    order_by: str           = Query("Raised Date"),
    order:    str           = Query("desc"),
    _role:    str           = Depends(require_auth),
    _perm:    str           = Depends(require_permission("module.invoices.view")),
):
    try:
        svc = InvoiceService()
        scoped_email = owner_scope_email(request)
        result = await svc.list_invoices(
            status=status, project=project, raised_by=scoped_email,
            limit=limit, skip=skip,
            order_by=order_by, order=order,
        )
        if result is None:
            result = await svc.list_invoices_from_pg(
                status=status, project=project, raised_by=scoped_email,
                limit=limit, skip=skip,
                order_by=order_by, order=order,
            )
            if result is not None:
                result["_stale"] = True  # flag: served from PG mirror, Teable unreachable
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{record_id}")
async def get_invoice(
    record_id: str, request: Request,
    _role: str = Depends(require_auth),
    _perm: str = Depends(require_permission("module.invoices.view")),
):
    try:
        svc = InvoiceService()
        record = await svc.get_invoice(record_id)
        if record is None:
            record = await svc.get_invoice_from_pg(record_id)
        scoped_email = owner_scope_email(request)
        if not is_record_owner(record, scoped_email):
            raise HTTPException(status_code=404, detail="Invoice not found")
        return record
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=404 if "404" in str(e) else 500, detail=str(e))


async def _require_invoice_write(request: Request, role: str, permission_key: str) -> None:
    if role != "editor" and not owner_scope_email(request):
        raise HTTPException(status_code=403, detail="This action requires invoice write access")
    # Additionally enforce the granular permission matrix for email-auth sessions
    if getattr(request.state, "is_email_auth", False):
        auth_role = getattr(request.state, "auth_role", "") or ""
        if auth_role != "superadmin":
            user_id = getattr(request.state, "auth_user_id", None)
            effective = await get_effective_permissions(user_id)
            if permission_key not in effective:
                raise HTTPException(status_code=403, detail=f"Missing permission: {permission_key}")


@router.post("", status_code=201)
async def create_invoice(body: InvoiceFields, request: Request, role: str = Depends(require_auth)):
    try:
        await _check_mutation_rate(request)
        await _require_invoice_write(request, role, "module.invoices.create")
        fields = body.to_teable_fields()
        scoped_email = owner_scope_email(request)
        if scoped_email:
            fields["Raised By"] = await InvoiceService().resolve_raised_by(scoped_email)
        _validate_amounts(fields)
        _validate_paid_invoice(fields)
        result = await InvoiceService().create_invoice(fields)
        new_id = result.get("id") if isinstance(result, dict) else None
        if new_id:
            try:
                await record_user_attribution(request, role, new_id)
            except Exception:
                pass
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/{record_id}")
async def update_invoice(
    record_id: str, body: InvoiceFields, request: Request,
    role: str = Depends(require_auth),
):
    try:
        await _check_mutation_rate(request)
        perm_key = "module.invoices.payment" if body.payment_status == "Paid" else "module.invoices.edit"
        await _require_invoice_write(request, role, perm_key)
        fields = body.to_teable_fields(include_null_fields={"Raised Date", "Cleared Date", "Next followup"})
        scoped_email = owner_scope_email(request)
        if scoped_email:
            svc = InvoiceService()
            existing = await svc.get_invoice(record_id)
            if not is_record_owner(existing, scoped_email):
                raise HTTPException(status_code=404, detail="Invoice not found")
            fields["Raised By"] = await svc.resolve_raised_by(scoped_email)
        _validate_amounts(fields)
        _validate_paid_invoice(fields)
        try:
            await record_user_attribution(request, role, record_id)
        except Exception:
            pass
        return await InvoiceService().update_invoice(record_id, fields)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{record_id}", status_code=204)
async def delete_invoice(record_id: str, request: Request, role: str = Depends(require_auth)):
    try:
        await _check_mutation_rate(request)
        await _require_invoice_write(request, role, "module.invoices.delete")
        scoped_email = owner_scope_email(request)
        if scoped_email:
            existing = await InvoiceService().get_invoice(record_id)
            if not is_record_owner(existing, scoped_email):
                raise HTTPException(status_code=404, detail="Invoice not found")
        try:
            await record_user_attribution(request, role, record_id)
        except Exception:
            pass
        await InvoiceService().delete_invoice(record_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/parse")
async def parse_invoice(
    file: UploadFile = File(...),
    _role: str = Depends(require_auth),
    _perm: str = Depends(require_permission("module.invoices.create")),
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


@router.post("/upload/{record_id}/{field_name}")
async def upload_attachment(
    record_id: str,
    field_name: str,
    request: Request,
    file: UploadFile = File(...),
    role: str = Depends(require_auth),
):
    """Upload a file into a specific attachment field on an existing invoice record."""
    service = InvoiceService()
    try:
        await _require_invoice_write(request, role, "module.invoices.edit")
        scoped_email = owner_scope_email(request)
        if scoped_email:
            existing = await service.get_invoice(record_id)
            if not is_record_owner(existing, scoped_email):
                raise HTTPException(status_code=404, detail="Invoice not found")
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
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── CSV / Excel Export ────────────────────────────────────────────────────────

import csv
import io
from datetime import date
from fastapi.responses import StreamingResponse as _StreamingResponse

@router.get("/export")
async def export_invoices(
    request:    Request,
    fmt:        str           = Query("csv", pattern="^(csv)$"),
    status:     Optional[str] = Query(None),
    project:    Optional[str] = Query(None),
    date_from:  Optional[str] = Query(None, alias="from"),
    date_to:    Optional[str] = Query(None, alias="to"),
    _role:      str           = Depends(require_auth),
    _perm:      str           = Depends(require_permission("module.invoices.view")),
):
    """Download all matching invoices as CSV."""
    svc = InvoiceService()
    scoped_email = owner_scope_email(request)
    result = await svc.list_invoices(
        status=status, project=project, raised_by=scoped_email,
        limit=2000, skip=0, order_by="Raised Date", order="desc",
    )
    if result is None:
        result = await svc.list_invoices_from_pg(
            status=status, project=project, raised_by=scoped_email,
            limit=2000, skip=0,
        )
    records = (result or {}).get("records", [])

    # Optional date filter
    if date_from or date_to:
        def _d(s):
            try: return date.fromisoformat(s)
            except Exception: return None
        df, dt = _d(date_from), _d(date_to)
        def in_range(r):
            rd_str = r.get("fields", {}).get("Raised Date", "")
            if not rd_str: return True
            try: rd = date.fromisoformat(rd_str[:10])
            except Exception: return True
            if df and rd < df: return False
            if dt and rd > dt: return False
            return True
        records = [r for r in records if in_range(r)]

    COLS = [
        ("Invoice Number",  "Invoice Number"),
        ("Raised Date",     "Raised Date"),
        ("Project",         "Project"),
        ("Client Name",     "Client Name"),
        ("Category",        "Category"),
        ("Milestone",       "Milestone"),
        ("Raised By",       "Raised By"),
        ("Payment Status",  "Payment Status"),
        ("Amount Raised",   "Amount Raised"),
        ("Amount with Tax", "Amount with Tax"),
        ("Amount Received", "Amount Received"),
        ("Outstanding Amount", "Outstanding Amount"),
        ("Cleared Date",    "Cleared Date"),
        ("Agening (Days)",  "Aging Days"),
        ("Next Follow-up",  "Next Follow-up"),
        ("Remark",          "Remark"),
    ]

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([label for _, label in COLS])
    for r in records:
        f = r.get("fields", {})
        writer.writerow([f.get(key, "") for key, _ in COLS])

    filename = f"invoices_{date.today().isoformat()}.csv"
    return _StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Aging Buckets ─────────────────────────────────────────────────────────────

@router.get("/aging-buckets")
async def aging_buckets(
    request: Request,
    _role:   str = Depends(require_auth),
    _perm:   str = Depends(require_permission("module.invoices.view")),
):
    """Return invoice counts/amounts grouped into 0-30, 30-60, 60-90, 90+ day aging buckets."""
    svc = InvoiceService()
    scoped_email = owner_scope_email(request)
    result = await svc.list_invoices(
        status="Pending", raised_by=scoped_email, limit=2000, skip=0,
    )
    if result is None:
        result = await svc.list_invoices_from_pg(
            status="Pending", raised_by=scoped_email, limit=2000, skip=0,
        )
    records = (result or {}).get("records", [])

    buckets = {
        "0_30":  {"label": "0–30 days",  "count": 0, "amount": 0.0},
        "30_60": {"label": "30–60 days", "count": 0, "amount": 0.0},
        "60_90": {"label": "60–90 days", "count": 0, "amount": 0.0},
        "90_plus":{"label": "90+ days",  "count": 0, "amount": 0.0},
    }
    total_outstanding = 0.0

    for r in records:
        f = r.get("fields", {})
        aging = int(f.get("Agening (Days)") or 0)
        amt   = float(f.get("Outstanding Amount") or f.get("Amount Raised") or 0)
        total_outstanding += amt
        if aging <= 30:   b = "0_30"
        elif aging <= 60: b = "30_60"
        elif aging <= 90: b = "60_90"
        else:             b = "90_plus"
        buckets[b]["count"]  += 1
        buckets[b]["amount"] += amt

    return {
        "buckets": list(buckets.values()),
        "total_outstanding": total_outstanding,
        "total_pending": len(records),
    }


# ── Send Payment Reminder ─────────────────────────────────────────────────────

class ReminderBody(BaseModel):
    to_email: str | None = None


@router.post("/{record_id}/send-reminder")
async def send_invoice_reminder(
    record_id: str,
    request:   Request,
    body:      ReminderBody = Body(ReminderBody()),
    role:      str = Depends(require_auth),
):
    """Send a payment reminder email for a specific invoice."""
    await _require_invoice_write(request, role, "module.invoices.edit")
    svc = InvoiceService()
    record = await svc.get_invoice(record_id)
    if record is None:
        record = await svc.get_invoice_from_pg(record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Invoice not found")

    f = record.get("fields", {})
    inv_no  = f.get("Invoice Number", record_id)
    project = f.get("Project", "")
    client  = f.get("Client Name", "")
    amount  = f.get("Amount Raised", 0)
    aging   = f.get("Agening (Days)", 0)
    status  = f.get("Payment Status", "Pending")

    if status == "Paid":
        raise HTTPException(status_code=400, detail="This invoice is already marked as paid.")

    try:
        from ..services.emailer import send_email, is_email_configured
        from ..config import settings

        if not is_email_configured():
            raise HTTPException(status_code=503, detail="Email is not configured on this server. Set BREVOAPIKEY and SMTP_FROM_EMAIL.")

        # Use caller-supplied address; fall back to configured admin/notify address.
        recipient = (body.to_email or "").strip() or settings.auth_admin_notify_email or settings.smtp_from_email or settings.smtp_username
        if not recipient:
            raise HTTPException(status_code=503, detail="No recipient address configured. Set AUTH_ADMIN_NOTIFY_EMAIL.")

        import re as _re
        if not _re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", recipient):
            raise HTTPException(status_code=422, detail=f"Invalid email address: {recipient}")

        amount_str = f"₹{float(amount):,.0f}"
        subject = f"Payment Reminder — {inv_no}"
        text_body = (
            f"Payment reminder: invoice {inv_no} for project {project} ({client}), "
            f"amount {amount_str}, status {status}, aging {aging} days."
        )
        html_body = (
            f"<p>Hi,</p>"
            f"<p>This is a payment follow-up for:</p>"
            f"<table style='border-collapse:collapse;font-size:14px'>"
            f"<tr><td style='padding:4px 12px 4px 0;color:#6b7280'>Invoice</td><td><strong>{inv_no}</strong></td></tr>"
            f"<tr><td style='padding:4px 12px 4px 0;color:#6b7280'>Project</td><td>{project}</td></tr>"
            f"<tr><td style='padding:4px 12px 4px 0;color:#6b7280'>Client</td><td>{client}</td></tr>"
            f"<tr><td style='padding:4px 12px 4px 0;color:#6b7280'>Amount</td><td><strong>{amount_str}</strong></td></tr>"
            f"<tr><td style='padding:4px 12px 4px 0;color:#6b7280'>Status</td><td>{status}</td></tr>"
            f"<tr><td style='padding:4px 12px 4px 0;color:#6b7280'>Aging</td><td>{aging} days</td></tr>"
            f"</table>"
            f"<p>Please follow up with the client or update the payment status in FinTrack.</p>"
        )
        await send_email(to=recipient, subject=subject, text=text_body, html=html_body)
        return {"message": "Reminder sent", "invoice": inv_no, "sent_to": recipient}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send reminder: {e}")
