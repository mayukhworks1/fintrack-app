"""
Invoice Teable service — table tblyWvNkprE1HnaVZIH
Handles CRUD + summary for Invoice Tracking.
"""
import json
import time
from typing import Any, Optional
import httpx
from ..config import settings

# ── Field IDs for filter/sort params (must use IDs, not names) ─────────────
INVOICE_FIELD_IDS = {
    "Invoice Number":   "fldKSNWW3OwqTtsWLqD",
    "Project":          "fldavbndGaQVJZ4spJs",
    "Category":         "flduUcIbAvyk4LeYmDB",
    "Description":      "fldzeYOWTfJpQMIcF54",
    "Milestone":        "fldInxvxnEH7VNkkBsN",
    "Raised By":        "fldRWvhrcUCTRcIlhvk",
    "Raised Date":      "fldpRoCEg6pv4Vgysgg",
    "Cleared Date":     "fldRrKnhPcWFd1sk60n",
    "Amount Raised":    "fldZhhhwRAeoQPwgshy",
    "Amount with Tax":  "fldDlo5FZia8wwmwfK7",
    "Amount Received":  "fldQRpzwsMK9U7bBQ1v",
    "Payment Status":   "fldXpx2jzUyRrznjw7M",
    "Remark":           "fld0HwxUQQ46t9uzvBv",
    "Reference":        "fldsShRxunYRQZ03iYi",
    "Invoice PDF":      "fldErRKNwXVAsnUzWCH",
    "Days To Clear":    "fldZcfdmoKjHRLDWY6o",   # READ-ONLY
    "Speed":            "fldY8J44ZaQi6DC1oW8",   # READ-ONLY
    "Agening (Days)":   "fld0m8lwVX4wyQeJrOG",   # READ-ONLY
    "Next followup":    "fldr11YNIf7EPSPObUF",
    "Outstanding Amount": "fldn4mfpKXNQxSnDfc6", # READ-ONLY
}

# ── Simple per-process cache ───────────────────────────────────────────────
_cache: dict[str, tuple[float, Any]] = {}
INVOICE_RECORDS_TTL = 15   # seconds


def _cache_get(key: str) -> Any | None:
    if key in _cache:
        ts, val = _cache[key]
        if time.time() - ts < INVOICE_RECORDS_TTL:
            return val
        del _cache[key]
    return None


def _cache_set(key: str, val: Any) -> None:
    _cache[key] = (time.time(), val)


def _cache_bust() -> None:
    """Invalidate all invoice cache entries after a write."""
    keys = [k for k in list(_cache.keys()) if k.startswith("invoice")]
    for k in keys:
        del _cache[k]


class InvoiceService:
    def __init__(self):
        self.token    = settings.teable_api_token
        self.base_url = settings.teable_base_url.rstrip("/")
        self.table_id = settings.teable_invoice_table_id

    @property
    def _headers(self):
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    @property
    def _record_url(self):
        return f"{self.base_url}/api/table/{self.table_id}/record"

    # ── List invoices with optional filters ───────────────────────────────
    async def list_invoices(
        self,
        status: Optional[str] = None,
        project: Optional[str] = None,
        limit: int = 200,
        skip: int = 0,
        order_by: str = "Raised Date",
        order: str = "desc",
    ) -> dict:
        cache_key = f"invoice:list:{status}:{project}:{limit}:{skip}:{order_by}:{order}"
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

        params: dict[str, Any] = {
            "fieldKeyType": "name",
            "take": limit,
            "skip": skip,
        }

        # Build filter
        filter_set = []
        if status:
            filter_set.append({
                "fieldId": INVOICE_FIELD_IDS["Payment Status"],
                "operator": "is",
                "value": status,
            })
        if project:
            filter_set.append({
                "fieldId": INVOICE_FIELD_IDS["Project"],
                "operator": "is",
                "value": project,
            })
        if filter_set:
            params["filter"] = json.dumps({"conjunction": "and", "filterSet": filter_set})

        # Sort by Raised Date desc
        field_id = INVOICE_FIELD_IDS.get(order_by, INVOICE_FIELD_IDS["Raised Date"])
        params["orderBy"] = json.dumps([{"fieldId": field_id, "order": order}])

        async with httpx.AsyncClient(timeout=20) as client:
            res = await client.get(self._record_url, params=params, headers=self._headers)
            res.raise_for_status()
            data = res.json()

        result = {"records": data.get("records", []), "total": data.get("total", 0)}
        _cache_set(cache_key, result)
        return result

    # ── Fetch all records (for summary / AI) ──────────────────────────────
    async def get_all_invoices(self) -> list[dict]:
        cache_key = "invoice:all"
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

        records, skip = [], 0
        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                params = {
                    "fieldKeyType": "name",
                    "take": 1000,
                    "skip": skip,
                    "orderBy": json.dumps([{"fieldId": INVOICE_FIELD_IDS["Raised Date"], "order": "desc"}]),
                }
                res = await client.get(self._record_url, params=params, headers=self._headers)
                res.raise_for_status()
                batch = res.json().get("records", [])
                records.extend(batch)
                if len(batch) < 1000:
                    break
                skip += 1000

        _cache_set(cache_key, records)
        return records

    # ── Get single invoice ────────────────────────────────────────────────
    async def get_invoice(self, record_id: str) -> dict:
        url = f"{self._record_url}/{record_id}?fieldKeyType=name"
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(url, headers=self._headers)
            res.raise_for_status()
            return res.json()

    # ── Create invoice ────────────────────────────────────────────────────
    async def create_invoice(self, fields: dict) -> dict:
        body = {"fieldKeyType": "name", "records": [{"fields": _clean_fields(fields)}]}
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(self._record_url, json=body, headers=self._headers)
            res.raise_for_status()
            _cache_bust()
            data = res.json()
            return data.get("records", [{}])[0]

    # ── Update invoice ────────────────────────────────────────────────────
    async def update_invoice(self, record_id: str, fields: dict) -> dict:
        url = f"{self._record_url}/{record_id}"
        body = {"fieldKeyType": "name", "record": {"fields": _clean_fields(fields)}}
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.patch(url, json=body, headers=self._headers)
            res.raise_for_status()
            _cache_bust()
            return res.json()

    # ── Delete invoice ────────────────────────────────────────────────────
    async def delete_invoice(self, record_id: str) -> None:
        url = f"{self._record_url}/{record_id}"
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.delete(url, headers=self._headers)
            res.raise_for_status()
            _cache_bust()

    # ── Compute summary ───────────────────────────────────────────────────
    async def get_summary(self) -> dict:
        cache_key = "invoice:summary"
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

        records = await self.get_all_invoices()

        total_raised    = 0.0
        total_with_tax  = 0.0
        total_received  = 0.0
        total_outstanding = 0.0
        by_status: dict[str, int]   = {}
        by_project: dict[str, dict] = {}
        pending_invoices: list[dict] = []
        overdue_invoices: list[dict] = []

        for r in records:
            f = r.get("fields", {})
            raised      = float(f.get("Amount Raised")       or 0)
            with_tax    = float(f.get("Amount with Tax")     or 0)
            received    = float(f.get("Amount Received")     or 0)
            outstanding = float(f.get("Outstanding Amount")  or 0)
            status      = f.get("Payment Status", "Unknown")
            project     = f.get("Project", "Unknown")
            aging       = float(f.get("Agening (Days)")      or 0)
            cancelled   = status == "Cancelled"

            # Cancelled invoices are completely voided — exclude from every
            # financial total (raised, tax, received, outstanding).
            # Only Paid + Pending invoices represent real business activity.
            if not cancelled:
                total_raised      += raised
                total_with_tax    += with_tax
                total_received    += received
                total_outstanding += outstanding

            by_status[status] = by_status.get(status, 0) + 1

            if project not in by_project:
                by_project[project] = {"raised": 0.0, "received": 0.0, "outstanding": 0.0, "count": 0}
            if not cancelled:
                by_project[project]["raised"]      += raised
                by_project[project]["received"]    += received
                by_project[project]["outstanding"] += outstanding
            by_project[project]["count"] += 1

            if status == "Pending":
                pending_invoices.append({
                    "id":          r.get("id"),
                    "invoice_no":  f.get("Invoice Number", ""),
                    "project":     project,
                    "amount":      with_tax,
                    "raised_date": f.get("Raised Date"),
                    "followup":    f.get("Next followup"),
                    "aging":       aging,
                })
            if status == "Pending" and aging > 30:
                overdue_invoices.append({
                    "id":         r.get("id"),
                    "invoice_no": f.get("Invoice Number", ""),
                    "project":    project,
                    "aging":      aging,
                    "amount":     with_tax,
                })

        # Sort pending by aging desc
        pending_invoices.sort(key=lambda x: x["aging"], reverse=True)
        overdue_invoices.sort(key=lambda x: x["aging"], reverse=True)

        summary = {
            "total_raised":       round(total_raised, 2),
            "total_with_tax":     round(total_with_tax, 2),
            "total_received":     round(total_received, 2),
            "total_outstanding":  round(total_outstanding, 2),
            "total_invoices":     len(records),
            "active_invoices":    len(records) - by_status.get("Cancelled", 0),
            "by_status":          by_status,
            "by_project":         by_project,
            "pending_invoices":   pending_invoices[:10],
            "overdue_invoices":   overdue_invoices[:5],
            "collection_rate":    round((total_received / total_with_tax * 100), 2) if total_with_tax > 0 else 0.0,
        }
        _cache_set(cache_key, summary)
        return summary


# ── Strip read-only / None fields before write ─────────────────────────────
_READ_ONLY = {"Days To Clear", "Speed", "Agening (Days)", "Outstanding Amount"}

def _clean_fields(fields: dict) -> dict:
    return {
        k: v for k, v in fields.items()
        if k not in _READ_ONLY and v is not None and v != ""
    }
