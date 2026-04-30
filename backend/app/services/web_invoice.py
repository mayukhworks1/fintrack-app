"""
Web Invoice Teable service — table tblT6iQNKe8CfAUN2iR
Handles CRUD + summary for the Web Invoice Tracker module.
Accessible only to the "web" role.
"""
import json
from typing import Any, Optional
import httpx
from ..config import settings
from ..utils.cache import cache

# ── Field IDs (filter/sort must use IDs, not names) ───────────────────────
WEB_INVOICE_FIELD_IDS = {
    "Invoice Number":     "fld9NKldSx0rFGnFdAs",
    "Project":            "fldbU5l9SOZ6VgtmdsR",
    "Category":           "fldtxnhxAECH3dLZbhO",
    "Description":        "fldKPY6Mm1tFDYj9FbK",
    "Milestone":          "fldbvfo2TUOpYc1ZfBs",
    "Raised By":          "fldXRtzmmLZopr8YI4G",
    "Raised Date":        "fldgkMfEb0qlDb9Xgrb",
    "Cleared Date":       "fldPH7jhl96qhg6B2NO",
    "Amount Raised":      "fldAKunNMMpKEC29alB",
    "Amount with Tax":    "fldC71Slo4jYZL3fOMs",
    "Amount Received":    "fldKZIKFmlnkVkgRMet",
    "Payment Status":     "fldvxAgRvd3kvxcSwX8",
    "Remark":             "fldyqcD1uUb8DB8Kql6",
    "Reference":          "fldWrG9UBgQEu2ygAjz",
    "Invoice PDF":        "fldsx1YOgmSiBK4kyU1",
    "Days To Clear":      "fldTTWIpOOJEM5F34Dq",   # READ-ONLY
    "Speed":              "fldIQ1wsdDtmEF6p9v0",   # READ-ONLY
    "Agening (Days)":     "fld5HN0SZChZc4ZQmRw",   # READ-ONLY
    "Next followup":      "fldhO3z53mtKJB1aUjl",
    "Outstanding Amount": "fld5vFCd0NIAPpVQ393",   # READ-ONLY
}

_TTL_LIST    = 15
_TTL_ALL     = 30
_TTL_SUMMARY = 30

def _bust_web_cache() -> None:
    cache.bust(prefix="webinv:")


class WebInvoiceService:
    def __init__(self):
        self.token    = settings.teable_api_token
        self.base_url = settings.teable_base_url.rstrip("/")
        self.table_id = settings.teable_web_invoice_table_id

    @property
    def _headers(self):
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    @property
    def _record_url(self):
        return f"{self.base_url}/api/table/{self.table_id}/record"

    async def list_invoices(
        self,
        status: Optional[str] = None,
        project: Optional[str] = None,
        limit: int = 200,
        skip: int = 0,
        order_by: str = "Raised Date",
        order: str = "desc",
    ) -> dict:
        cache_key = f"webinv:list:{status}:{project}:{limit}:{skip}:{order_by}:{order}"

        async def _load():
            params: dict[str, Any] = {
                "fieldKeyType": "name",
                "take": limit,
                "skip": skip,
            }
            filter_set = []
            if status:
                filter_set.append({
                    "fieldId": WEB_INVOICE_FIELD_IDS["Payment Status"],
                    "operator": "is",
                    "value": status,
                })
            if project:
                filter_set.append({
                    "fieldId": WEB_INVOICE_FIELD_IDS["Project"],
                    "operator": "is",
                    "value": project,
                })
            if filter_set:
                params["filter"] = json.dumps({"conjunction": "and", "filterSet": filter_set})
            field_id = WEB_INVOICE_FIELD_IDS.get(order_by, WEB_INVOICE_FIELD_IDS["Raised Date"])
            params["orderBy"] = json.dumps([{"fieldId": field_id, "order": order}])

            async with httpx.AsyncClient(timeout=20) as client:
                res = await client.get(self._record_url, params=params, headers=self._headers)
                res.raise_for_status()
                data = res.json()
            return {"records": data.get("records", []), "total": data.get("total", 0)}

        return await cache.get_or_set(cache_key, ttl=_TTL_LIST, loader=_load)

    async def get_all_invoices(self) -> list[dict]:
        async def _load():
            records, skip = [], 0
            async with httpx.AsyncClient(timeout=30) as client:
                while True:
                    params = {
                        "fieldKeyType": "name",
                        "take": 1000,
                        "skip": skip,
                        "orderBy": json.dumps([{
                            "fieldId": WEB_INVOICE_FIELD_IDS["Raised Date"],
                            "order": "desc",
                        }]),
                    }
                    res = await client.get(self._record_url, params=params, headers=self._headers)
                    res.raise_for_status()
                    batch = res.json().get("records", [])
                    records.extend(batch)
                    if len(batch) < 1000:
                        break
                    skip += 1000
            return records
        return await cache.get_or_set("webinv:all", ttl=_TTL_ALL, loader=_load)

    async def get_invoice(self, record_id: str) -> dict:
        url = f"{self._record_url}/{record_id}?fieldKeyType=name"
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(url, headers=self._headers)
            res.raise_for_status()
            return res.json()

    async def create_invoice(self, fields: dict) -> dict:
        body = {"fieldKeyType": "name", "records": [{"fields": _clean_fields(fields)}]}
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(self._record_url, json=body, headers=self._headers)
            res.raise_for_status()
            _bust_web_cache()
            data = res.json()
            return data.get("records", [{}])[0]

    async def update_invoice(self, record_id: str, fields: dict) -> dict:
        url = f"{self._record_url}/{record_id}"
        body = {"fieldKeyType": "name", "record": {"fields": _clean_fields(fields)}}
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.patch(url, json=body, headers=self._headers)
            res.raise_for_status()
            _bust_web_cache()
            return res.json()

    async def delete_invoice(self, record_id: str) -> None:
        url = f"{self._record_url}/{record_id}"
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.delete(url, headers=self._headers)
            res.raise_for_status()
            _bust_web_cache()

    async def get_summary(self) -> dict:
        cached = cache.get("webinv:summary")
        if cached is not None:
            return cached

        records = await self.get_all_invoices()

        total_raised = total_with_tax = total_received = total_outstanding = 0.0
        by_status: dict[str, int] = {}
        by_project: dict[str, dict] = {}
        pending_invoices: list[dict] = []
        overdue_invoices: list[dict] = []

        for r in records:
            f = r.get("fields", {})
            raised      = float(f.get("Amount Raised")      or 0)
            with_tax    = float(f.get("Amount with Tax")    or 0)
            received    = float(f.get("Amount Received")    or 0)
            status      = f.get("Payment Status", "Unknown")
            project     = f.get("Project", "Unknown")
            aging       = float(f.get("Agening (Days)")     or 0)
            cancelled   = status == "Cancelled"

            if not cancelled:
                total_raised    += raised
                total_with_tax  += with_tax
                if status == "Paid":
                    total_received    += raised
                else:
                    total_outstanding += raised

            by_status[status] = by_status.get(status, 0) + 1

            if project not in by_project:
                by_project[project] = {"raised": 0.0, "received": 0.0, "outstanding": 0.0, "count": 0}
            if not cancelled:
                by_project[project]["raised"] += raised
                if status == "Paid":
                    by_project[project]["received"]    += raised
                else:
                    by_project[project]["outstanding"] += raised
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

        pending_invoices.sort(key=lambda x: x["aging"], reverse=True)
        overdue_invoices.sort(key=lambda x: x["aging"], reverse=True)

        summary = {
            "total_raised":      round(total_raised, 2),
            "total_with_tax":    round(total_with_tax, 2),
            "total_received":    round(total_received, 2),
            "total_outstanding": round(total_outstanding, 2),
            "total_invoices":    len(records),
            "active_invoices":   len(records) - by_status.get("Cancelled", 0),
            "by_status":         by_status,
            "by_project":        by_project,
            "pending_invoices":  pending_invoices[:10],
            "overdue_invoices":  overdue_invoices[:5],
            "collection_rate":   round((total_received / total_raised * 100), 2) if total_raised > 0 else 0.0,
        }
        cache.set("webinv:summary", summary, ttl=_TTL_SUMMARY)
        return summary


_READ_ONLY = {"Days To Clear", "Speed", "Agening (Days)", "Outstanding Amount"}

def _clean_fields(fields: dict) -> dict:
    return {
        k: v for k, v in fields.items()
        if k not in _READ_ONLY and v is not None and v != ""
    }
