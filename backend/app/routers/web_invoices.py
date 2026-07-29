"""
Web Invoice Tracker router — /api/web-invoices
Routes accept 'web' OR 'all' role (require_web_access).
'web'  — invoice tracker only (Theworks@2026)
'all'  — invoice tracker + project tracker (All@2026)
"""
import csv as _csv
import io as _io
import httpx
from ..utils.http import shared_client
import re
from datetime import date as _date
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Request
from fastapi.responses import StreamingResponse as _StreamingResponse
from typing import Optional, List, Any
from pydantic import BaseModel, field_validator
from ..services.web_invoice import WebInvoiceService
from ..db.attribution import record_user_attribution
from ..db.postgres import get_pool
from ..config import settings
from ..utils.ownership import is_record_owner
from ..utils.teable_errors import translate_teable_error
from .deps import require_auth, require_web_access, owner_scope_email, require_permission, get_effective_permissions

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
    currency:        Optional[str]        = None  # e.g. "RS", "USD"

    @field_validator('raised_by')
    @classmethod
    def validate_raised_by(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == '':
            return v
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
        if v > 10_000_000:
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

    @field_validator('currency')
    @classmethod
    def validate_currency(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == '':
            return v
        # Validate against known currencies
        valid_currencies = {'RS', 'USD', 'EUR', 'GBP', 'INR'}
        if v.upper() not in valid_currencies:
            raise ValueError(f'Currency must be one of: {", ".join(valid_currencies)}')
        return v.upper()

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
            "Currency":        self.currency,
        }
        # Include lists even if empty (allows clearing attachments); exclude only None
        return {k: v for k, v in m.items() if v is not None}


@router.get("/debug-config")
async def debug_config(_role: str = Depends(require_web_access)):
    """Returns active table ID and masked token — for diagnosing connection issues."""
    svc = WebInvoiceService()
    token = svc.token or ""
    masked = (token[:6] + "…" + token[-4:]) if len(token) > 10 else ("(not set)" if not token else token)
    # Try a single lightweight read to see if Teable responds
    try:
        async with shared_client(timeout=10) as client:
            res = await client.get(
                f"{svc.base_url}/api/table/{svc.table_id}/record?take=1&fieldKeyType=name",
                headers=svc._headers,
            )
            teable_status = res.status_code
            teable_total  = res.json().get("total", "?") if res.status_code == 200 else None
    except Exception as exc:
        teable_status = f"error: {exc}"
        teable_total  = None
    return {
        "table_id":      svc.table_id,
        "base_url":      svc.base_url,
        "token_preview": masked,
        "teable_status": teable_status,
        "teable_total":  teable_total,
    }


@router.get("/client-names")
async def get_client_names(_role: str = Depends(require_web_access)):
    """Distinct project/client names from actual invoice records (for autocomplete)."""
    try:
        return await WebInvoiceService().get_distinct_client_names()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/avatar-map")
async def get_avatar_map(_role: str = Depends(require_auth)):
    """Return email → {avatar_url, name} for approved users. Used by dashboards to show profile pics next to Raised By."""
    pool = get_pool()
    if not pool:
        return {}
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT email, teable_email, avatar_url, first_name, last_name, full_name FROM auth_users "
                "WHERE status = 'active'"
            )
        result = {}
        for r in rows:
            fn, ln = (r["first_name"] or "").strip(), (r["last_name"] or "").strip()
            name = fn if fn and fn == ln else " ".join(filter(None, [fn, ln])) or r["full_name"] or r["email"]
            entry = {"avatar_url": r["avatar_url"], "name": name}
            result[r["email"].lower()] = entry
            if r["teable_email"]:
                result[r["teable_email"].lower()] = entry
        return result
    except Exception:
        return {}


@router.get("/picklists")
async def get_picklists(request: Request, _role: str = Depends(require_web_access)):
    """Return current single-select options for all editable picklist fields."""
    await _require_web_permission(request, "module.invoices.view")
    try:
        return await WebInvoiceService().get_picklists()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/picklists/{field_name}")
async def add_picklist_option(
    field_name: str, body: AddOptionRequest, request: Request, _role: str = Depends(require_web_access)
):
    """Append a new option to a single-select field and return updated list."""
    await _require_web_permission(request, "module.invoices.edit")
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
    request: Request,
    file: UploadFile = File(...),
    _role: str = Depends(require_web_access),
):
    """Upload a file into a specific attachment field on an existing Teable record."""
    service = WebInvoiceService()
    try:
        await _require_web_permission(request, "module.invoices.edit")
        await _assert_web_invoice_owner(service, record_id, request)
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


@router.get("/summary")
async def web_invoice_summary(
    request: Request,
    _role: str = Depends(require_web_access),
    _perm: str = Depends(require_permission("module.invoices.view")),
):
    try:
        return await WebInvoiceService().get_summary(raised_by=owner_scope_email(request))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("")
async def list_web_invoices(
    request: Request,
    status:   Optional[str] = Query(None),
    project:  Optional[str] = Query(None),
    limit:    int           = Query(200, ge=1, le=1000),
    skip:     int           = Query(0,   ge=0),
    order_by: str           = Query("Raised Date"),
    order:    str           = Query("desc"),
    _role:    str           = Depends(require_web_access),
    _perm:    str           = Depends(require_permission("module.invoices.view")),
):
    try:
        result = await WebInvoiceService().list_invoices(
            status=status, project=project, raised_by=owner_scope_email(request),
            limit=limit, skip=skip,
            order_by=order_by, order=order,
        )
        return result
    except Exception as e:
        # Teable unreachable — attempt PG mirror fallback for web invoices
        # (no formal mirror table for web invoices, so surface the error with a stale flag hint)
        raise HTTPException(status_code=500, detail=str(e))


# ── CSV Export ────────────────────────────────────────────────────────────────

@router.get("/export")
async def export_web_invoices(
    request:   Request,
    status:    Optional[str] = Query(None),
    project:   Optional[str] = Query(None),
    date_from: Optional[str] = Query(None, alias="from"),
    date_to:   Optional[str] = Query(None, alias="to"),
    _role:     str           = Depends(require_web_access),
    _perm:     str           = Depends(require_permission("module.invoices.view")),
):
    """Download all matching web invoices as CSV."""
    svc = WebInvoiceService()
    scoped_email = owner_scope_email(request)
    result = await svc.list_invoices(
        status=status, project=project, raised_by=scoped_email,
        limit=2000, skip=0, order_by="Raised Date", order="desc",
    )
    records = (result or {}).get("records", [])

    if date_from or date_to:
        def _d(s):
            try: return _date.fromisoformat(s)
            except Exception: return None
        df, dt = _d(date_from), _d(date_to)
        def in_range(r):
            rd_str = r.get("fields", {}).get("Raised Date", "")
            if not rd_str: return True
            try: rd = _date.fromisoformat(rd_str[:10])
            except Exception: return True
            if df and rd < df: return False
            if dt and rd > dt: return False
            return True
        records = [r for r in records if in_range(r)]

    COLS = [
        ("Invoice Number",  "Invoice Number"),
        ("Raised Date",     "Raised Date"),
        ("Project",         "Project"),
        ("Category",        "Category"),
        ("Milestone",       "Milestone"),
        ("Raised By",       "Raised By"),
        ("Currency",        "Currency"),
        ("Payment Status",  "Payment Status"),
        ("Amount Raised",   "Amount Raised"),
        ("Amount with Tax", "Amount with Tax"),
        ("Amount Received", "Amount Received"),
        ("Outstanding Amount", "Outstanding Amount"),
        ("Cleared Date",    "Cleared Date"),
        ("Agening (Days)",  "Aging Days"),
        ("Next followup",   "Next Follow-up"),
        ("Remark",          "Remark"),
    ]

    buf = _io.StringIO()
    writer = _csv.writer(buf)
    writer.writerow([label for _, label in COLS])
    for r in records:
        f = r.get("fields", {})
        writer.writerow([f.get(key, "") for key, _ in COLS])

    filename = f"web_invoices_{_date.today().isoformat()}.csv"
    return _StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Aging Buckets ─────────────────────────────────────────────────────────────

@router.get("/aging-buckets")
async def web_aging_buckets(
    request: Request,
    _role:   str = Depends(require_web_access),
    _perm:   str = Depends(require_permission("module.invoices.view")),
):
    """Return pending invoice counts/amounts in 0-30, 30-60, 60-90, 90+ day buckets."""
    svc = WebInvoiceService()
    scoped_email = owner_scope_email(request)
    result = await svc.list_invoices(
        status="Pending", raised_by=scoped_email, limit=2000, skip=0,
    )
    records = (result or {}).get("records", [])

    buckets: dict[str, dict] = {
        "0_30":  {"label": "0–30 days",  "days_min": 0,  "days_max": 30,  "count": 0, "amount": 0},
        "30_60": {"label": "30–60 days", "days_min": 30, "days_max": 60,  "count": 0, "amount": 0},
        "60_90": {"label": "60–90 days", "days_min": 60, "days_max": 90,  "count": 0, "amount": 0},
        "90+":   {"label": "90+ days",   "days_min": 90, "days_max": None,"count": 0, "amount": 0},
    }
    total_outstanding = 0.0

    for r in records:
        f = r.get("fields", {})
        aging = int(f.get("Agening (Days)") or 0)
        amt = float(f.get("Outstanding Amount") or f.get("Amount Raised") or 0)
        total_outstanding += amt
        if aging <= 30:   b = "0_30"
        elif aging <= 60: b = "30_60"
        elif aging <= 90: b = "60_90"
        else:             b = "90+"
        buckets[b]["count"] += 1
        buckets[b]["amount"] += amt

    return {
        "buckets": list(buckets.values()),
        "total_outstanding": total_outstanding,
        "total_pending": len(records),
    }


@router.get("/{record_id}")
async def get_web_invoice(
    record_id: str, request: Request,
    _role: str = Depends(require_web_access),
    _perm: str = Depends(require_permission("module.invoices.view")),
):
    try:
        svc = WebInvoiceService()
        record = await svc.get_invoice(record_id)
        _assert_record_owner(record, request)
        return record
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=404 if "404" in str(e) else 500, detail=str(e))


async def _require_web_permission(request: Request, permission_key: str) -> None:
    """Enforce the granular permission matrix for email-auth sessions (no-op for legacy password tokens)."""
    if not getattr(request.state, "is_email_auth", False):
        return
    auth_role = getattr(request.state, "auth_role", "") or ""
    if auth_role == "superadmin":
        return
    user_id = getattr(request.state, "auth_user_id", None)
    effective = await get_effective_permissions(user_id)
    if permission_key not in effective:
        raise HTTPException(status_code=403, detail=f"Missing permission: {permission_key}")


async def _check_web_permission(request: Request, *permission_keys: str) -> None:
    """Like _require_web_permission but accepts multiple keys (OR logic) — any one is sufficient."""
    if not getattr(request.state, "is_email_auth", False):
        return
    auth_role = getattr(request.state, "auth_role", "") or ""
    if auth_role == "superadmin":
        return
    user_id = getattr(request.state, "auth_user_id", None)
    effective = await get_effective_permissions(user_id)
    if not any(k in effective for k in permission_keys):
        raise HTTPException(status_code=403, detail=f"Missing permission: {permission_keys[0]}")


@router.post("", status_code=201)
async def create_web_invoice(body: WebInvoiceFields, request: Request, role: str = Depends(require_web_access)):
    try:
        await _require_web_permission(request, "module.invoices.create")
        svc = WebInvoiceService()
        fields = body.to_teable_fields()
        scoped_email = owner_scope_email(request)
        if scoped_email:
            fields["Raised By"] = await svc.resolve_raised_by(scoped_email)
        _validate_paid_invoice(fields)
        result = await svc.create_invoice(fields)
        new_id = result.get("id") if isinstance(result, dict) else None
        if new_id:
            try:
                await record_user_attribution(request, role, new_id)
            except Exception:
                pass
        return result
    except HTTPException:
        raise
    except httpx.HTTPError as e:
        # Teable API error — translate to user-friendly message
        try:
            error_data = e.response.json() if hasattr(e, 'response') and e.response else str(e)
            user_msg = translate_teable_error(error_data, "creating web invoice")
            status_code = e.response.status_code if hasattr(e, 'response') and e.response else 400
            raise HTTPException(status_code=status_code, detail=user_msg)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=500, detail="Failed to create web invoice")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/{record_id}")
async def update_web_invoice(
    record_id: str, body: WebInvoiceFields, request: Request,
    role: str = Depends(require_web_access),
):
    try:
        svc = WebInvoiceService()
        # Permission check first (DB-only, fast) — before any slow Teable fetch.
        # When payment_status is Paid, accept EITHER edit OR payment permission:
        # edit covers general users; payment covers payment-specialist-only roles.
        if body.payment_status == "Paid":
            await _check_web_permission(request, "module.invoices.edit", "module.invoices.payment")
        else:
            await _require_web_permission(request, "module.invoices.edit")
        await _assert_web_invoice_owner(svc, record_id, request)
        fields = body.to_teable_fields()
        scoped_email = owner_scope_email(request)
        if scoped_email:
            fields["Raised By"] = await svc.resolve_raised_by(scoped_email)
        _validate_paid_invoice(fields)
        try:
            await record_user_attribution(request, role, record_id)
        except Exception:
            pass
        return await svc.update_invoice(record_id, fields)
    except HTTPException:
        raise
    except httpx.HTTPError as e:
        # Teable API error — translate to user-friendly message
        try:
            error_data = e.response.json() if hasattr(e, 'response') and e.response else str(e)
            user_msg = translate_teable_error(error_data, "updating web invoice")
            status_code = e.response.status_code if hasattr(e, 'response') and e.response else 400
            raise HTTPException(status_code=status_code, detail=user_msg)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=500, detail="Failed to update web invoice")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{record_id}", status_code=204)
async def delete_web_invoice(record_id: str, request: Request, role: str = Depends(require_web_access)):
    try:
        svc = WebInvoiceService()
        await _require_web_permission(request, "module.invoices.delete")
        await _assert_web_invoice_owner(svc, record_id, request)
        try:
            await record_user_attribution(request, role, record_id)
        except Exception:
            pass
        await svc.delete_invoice(record_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Parse (AI PDF / image → fields) ─────────────────────────────────────────

@router.post("/parse")
async def parse_web_invoice(
    file: UploadFile = File(...),
    _role: str = Depends(require_web_access),
    _perm: str = Depends(require_permission("module.invoices.create")),
):
    """Upload an invoice PDF or image; returns AI-extracted field values."""
    from ..services.openrouter import parse_invoice_document

    MAX_BYTES = 10 * 1024 * 1024
    content = await file.read()
    if len(content) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 10 MB)")
    mime = file.content_type or "application/octet-stream"
    fname = file.filename or ""
    if mime in ("application/octet-stream", "binary/octet-stream"):
        ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
        mime = {"pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg",
                "jpeg": "image/jpeg", "webp": "image/webp"}.get(ext, mime)
    try:
        fields = await parse_invoice_document(content, fname, mime)
        return {"fields": fields}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Parse failed: {str(e)}")


def _assert_record_owner(record: dict | None, request: Request) -> None:
    """Assert that the requesting user owns this record, or raise 404."""
    scoped_email = owner_scope_email(request)
    if not is_record_owner(record, scoped_email):
        raise HTTPException(status_code=404, detail="Invoice not found")


async def _assert_web_invoice_owner(service: WebInvoiceService, record_id: str, request: Request) -> None:
    scoped_email = owner_scope_email(request)
    if not scoped_email:
        return
    record = await service.get_invoice(record_id)
    _assert_record_owner(record, request)
