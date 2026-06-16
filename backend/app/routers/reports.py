"""
Reports router — /api/reports
GST summary, period-wise receivables breakdown.
"""
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from .deps import require_auth, require_web_access, owner_scope_email, require_permission
from ..services.invoice import InvoiceService
from ..services.web_invoice import WebInvoiceService

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/gst-summary")
async def gst_summary(
    request:    Request,
    date_from:  Optional[str] = Query(None, alias="from"),
    date_to:    Optional[str] = Query(None, alias="to"),
    _role:      str = Depends(require_auth),
    _perm:      str = Depends(require_permission("module.tax.view")),
):
    """
    GST-aware summary for a date range. Groups invoices by month and returns:
    base amount, GST amount, total (gross), received, outstanding, TDS.
    """
    svc = InvoiceService()
    scoped_email = owner_scope_email(request)

    result = await svc.list_invoices(
        raised_by=scoped_email, limit=5000, skip=0, order_by="Raised Date", order="asc",
    )
    if result is None:
        result = await svc.list_invoices_from_pg(
            raised_by=scoped_email, limit=5000, skip=0, order_by="Raised Date", order="asc",
        )
    records = (result or {}).get("records", [])

    def _d(s: Optional[str]) -> Optional[date]:
        if not s: return None
        try: return date.fromisoformat(s[:10])
        except Exception: return None

    df, dt = _d(date_from), _d(date_to)

    months: dict[str, dict] = {}
    totals = {"base": 0.0, "gst": 0.0, "gross": 0.0, "received": 0.0, "outstanding": 0.0, "deduction": 0.0, "count": 0}

    for r in records:
        f = r.get("fields", {})
        rd = _d(f.get("Raised Date"))
        if not rd:
            continue
        if df and rd < df:
            continue
        if dt and rd > dt:
            continue

        gross       = float(f.get("Amount with Tax") or f.get("Amount Raised") or 0)
        base        = float(f.get("Amount Raised") or 0)
        received    = float(f.get("Amount Received") or 0)
        outstanding = float(f.get("Outstanding Amount") or max(0, gross - received))
        gst         = max(0.0, gross - base)
        deduction   = max(0.0, received - (gross - outstanding) if outstanding > 0 else 0)

        mk = f"{rd.year}-{rd.month:02d}"
        if mk not in months:
            months[mk] = {
                "month": mk,
                "label": datetime(rd.year, rd.month, 1).strftime("%b %Y"),
                "base": 0.0, "gst": 0.0, "gross": 0.0,
                "received": 0.0, "outstanding": 0.0, "deduction": 0.0,
                "count": 0, "paid_count": 0, "pending_count": 0,
            }
        m = months[mk]
        m["base"]        += base
        m["gst"]         += gst
        m["gross"]       += gross
        m["received"]    += received
        m["outstanding"] += outstanding
        m["deduction"]   += deduction
        m["count"]       += 1
        if f.get("Payment Status") == "Paid":
            m["paid_count"] += 1
        else:
            m["pending_count"] += 1

        totals["base"]        += base
        totals["gst"]         += gst
        totals["gross"]       += gross
        totals["received"]    += received
        totals["outstanding"] += outstanding
        totals["deduction"]   += deduction
        totals["count"]       += 1

    sorted_months = sorted(months.values(), key=lambda x: x["month"])

    return {
        "from": date_from,
        "to":   date_to,
        "months": sorted_months,
        "totals": totals,
    }


@router.get("/web-gst-summary")
async def web_gst_summary(
    request:    Request,
    date_from:  Optional[str] = Query(None, alias="from"),
    date_to:    Optional[str] = Query(None, alias="to"),
    _role:      str = Depends(require_web_access),
    _perm:      str = Depends(require_permission("module.tax.view")),
):
    """GST-aware summary for web invoices, grouped by month."""
    svc = WebInvoiceService()
    scoped_email = owner_scope_email(request)
    result = await svc.list_invoices(
        raised_by=scoped_email, limit=5000, skip=0, order_by="Raised Date", order="asc",
    )
    records = (result or {}).get("records", [])

    def _d(s: Optional[str]) -> Optional[date]:
        if not s: return None
        try: return date.fromisoformat(s[:10])
        except Exception: return None

    df, dt = _d(date_from), _d(date_to)
    months: dict[str, dict] = {}
    totals = {"base": 0.0, "gst": 0.0, "gross": 0.0, "received": 0.0, "outstanding": 0.0, "count": 0}

    for r in records:
        f = r.get("fields", {})
        rd = _d(f.get("Raised Date"))
        if not rd: continue
        if df and rd < df: continue
        if dt and rd > dt: continue

        gross       = float(f.get("Amount with Tax") or f.get("Amount Raised") or 0)
        base        = float(f.get("Amount Raised") or 0)
        received    = float(f.get("Amount Received") or 0)
        outstanding = float(f.get("Outstanding Amount") or max(0, gross - received))
        gst         = max(0.0, gross - base)

        mk = f"{rd.year}-{rd.month:02d}"
        if mk not in months:
            months[mk] = {
                "month": mk,
                "label": datetime(rd.year, rd.month, 1).strftime("%b %Y"),
                "base": 0.0, "gst": 0.0, "gross": 0.0,
                "received": 0.0, "outstanding": 0.0,
                "count": 0, "paid_count": 0, "pending_count": 0,
            }
        m = months[mk]
        m["base"]        += base
        m["gst"]         += gst
        m["gross"]       += gross
        m["received"]    += received
        m["outstanding"] += outstanding
        m["count"]       += 1
        if f.get("Payment Status") == "Paid":
            m["paid_count"] += 1
        else:
            m["pending_count"] += 1

        totals["base"]        += base
        totals["gst"]         += gst
        totals["gross"]       += gross
        totals["received"]    += received
        totals["outstanding"] += outstanding
        totals["count"]       += 1

    return {
        "from": date_from,
        "to":   date_to,
        "months": sorted(months.values(), key=lambda x: x["month"]),
        "totals": totals,
    }
