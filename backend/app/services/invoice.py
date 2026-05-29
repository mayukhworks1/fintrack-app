"""
Invoice Teable service — table tblyWvNkprE1HnaVZIH
Handles CRUD + summary for Invoice Tracking.
"""
import json
import logging
from typing import Any, Optional
import httpx
from ..config import settings
from ..utils.cache import cache
from ..db.postgres import get_pool

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

# ── Cache config ───────────────────────────────────────────────────────────
# All entries live in the shared ../utils/cache singleton, namespaced by
# the "invoice:" prefix so writes can bust just our slice.
_TTL_LIST    = 15   # invoice list/sort/filter results
_TTL_ALL     = 30   # full record dump (used by summary + AI)
_TTL_SUMMARY = 30   # computed summary

logger = logging.getLogger("fintrack.invoices")

def _bust_invoice_cache() -> None:
    """Invalidate every cached invoice entry after a write."""
    cache.bust(prefix="invoice:")


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

    async def list_invoices_from_pg(
        self,
        status: Optional[str] = None,
        project: Optional[str] = None,
        limit: int = 200,
        skip: int = 0,
        order_by: str = "Raised Date",
        order: str = "desc",
    ) -> dict | None:
        pool = get_pool()
        if not pool:
            return None
        try:
            where: list[str] = []
            params: list[Any] = []
            idx = 1
            if status:
                where.append(f"payment_status = ${idx}")
                params.append(status)
                idx += 1
            if project:
                where.append(f"project = ${idx}")
                params.append(project)
                idx += 1
            where_sql = "WHERE deleted_at IS NULL"
            if where:
                where_sql += " AND " + " AND ".join(where)
            sort_map = {
                "Raised Date": "raised_date",
                "Invoice Number": "invoice_number",
                "Payment Status": "payment_status",
                "Project": "project",
                "Amount Raised": "amount_raised",
                "Amount with Tax": "amount_with_tax",
                "Amount Received": "amount_received",
                "Cleared Date": "cleared_date",
            }
            sort_col = sort_map.get(order_by, "raised_date")
            order_sql = f"ORDER BY {sort_col} {order.upper()} NULLS LAST, synced_at DESC"

            total = await pool.fetchval(f"SELECT COUNT(*) FROM invoices_mirror {where_sql}", *params)
            rows = await pool.fetch(
                f"""
                SELECT teable_id, fields
                FROM invoices_mirror
                {where_sql}
                {order_sql}
                LIMIT ${idx} OFFSET ${idx+1}
                """,
                *params, limit, skip,
            )
            records: list[dict[str, Any]] = []
            for row in rows:
                fields = row["fields"] if isinstance(row["fields"], dict) else json.loads(row["fields"] or "{}")
                records.append({"id": row["teable_id"], "fields": fields or {}})
            return {"records": records, "total": total or len(records)}
        except Exception as exc:
            logger.debug("invoices_mirror PG list failed: %s", exc)
            return None

    async def get_invoice_from_pg(self, record_id: str) -> dict | None:
        pool = get_pool()
        if not pool:
            return None
        try:
            row = await pool.fetchrow(
                "SELECT teable_id, fields FROM invoices_mirror WHERE teable_id = $1 AND deleted_at IS NULL",
                record_id,
            )
            if not row:
                return None
            fields = row["fields"] if isinstance(row["fields"], dict) else json.loads(row["fields"] or "{}")
            return {"id": row["teable_id"], "fields": fields or {}}
        except Exception as exc:
            logger.debug("invoices_mirror PG get failed: %s", exc)
            return None

    def _compute_summary(self, records: list[dict]) -> dict:
        total_raised = total_with_tax = total_received = total_outstanding = 0.0
        by_status: dict[str, int] = {}
        by_status_amounts: dict[str, float] = {}
        by_project: dict[str, dict] = {}
        pending_invoices: list[dict] = []
        overdue_invoices: list[dict] = []

        for r in records:
            f = r.get("fields", {})
            raised      = float(f.get("Amount Raised") or 0)
            with_tax    = float(f.get("Amount with Tax") or 0)
            status      = f.get("Payment Status", "Unknown")
            project     = f.get("Project", "Unknown")
            aging       = float(f.get("Agening (Days)") or 0)
            if not aging and f.get("Raised Date"):
                from datetime import datetime, timezone
                try:
                    rd = datetime.fromisoformat(f["Raised Date"].replace("Z", "+00:00"))
                    aging = (datetime.now(timezone.utc) - rd).days
                except Exception:
                    pass
            cancelled = status == "Cancelled"

            if not cancelled:
                total_raised += raised
                total_with_tax += with_tax
                if status == "Paid":
                    total_received += raised
                else:
                    total_outstanding += raised

            by_status[status] = by_status.get(status, 0) + 1
            if not cancelled:
                by_status_amounts[status] = round(by_status_amounts.get(status, 0.0) + raised, 2)

            if project not in by_project:
                by_project[project] = {"raised": 0.0, "received": 0.0, "outstanding": 0.0, "count": 0}
            if not cancelled:
                by_project[project]["raised"] += raised
                if status == "Paid":
                    by_project[project]["received"] += raised
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
                overdue_invoices.append({
                    "id":         r.get("id"),
                    "invoice_no": f.get("Invoice Number", ""),
                    "project":    project,
                    "aging":      aging,
                    "amount":     with_tax,
                    "currency":   "",
                })

        pending_invoices.sort(key=lambda x: x["aging"], reverse=True)
        overdue_invoices.sort(key=lambda x: x["aging"], reverse=True)

        return {
            "total_raised":       round(total_raised, 2),
            "total_with_tax":     round(total_with_tax, 2),
            "total_received":     round(total_received, 2),
            "total_outstanding":  round(total_outstanding, 2),
            "total_invoices":     len(records),
            "active_invoices":    len(records) - by_status.get("Cancelled", 0),
            "by_status":          by_status,
            "by_status_amounts":  by_status_amounts,
            "by_project":         by_project,
            "pending_invoices":   pending_invoices[:10],
            "overdue_invoices":   overdue_invoices[:5],
            "collection_rate":    round((total_received / total_raised * 100), 2) if total_raised > 0 else 0.0,
        }

    async def get_summary_from_pg(self) -> dict | None:
        pool = get_pool()
        if not pool:
            return None
        try:
            rows = await pool.fetch("SELECT fields FROM invoices_mirror WHERE deleted_at IS NULL")
            records = []
            for row in rows:
                fields = row["fields"] if isinstance(row["fields"], dict) else json.loads(row["fields"] or "{}")
                records.append({"fields": fields or {}})
            return self._compute_summary(records)
        except Exception as exc:
            logger.debug("invoices_mirror PG summary failed: %s", exc)
            return None

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

        async def _load():
            params: dict[str, Any] = {
                "fieldKeyType": "name",
                "take": limit,
                "skip": skip,
            }
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
            field_id = INVOICE_FIELD_IDS.get(order_by, INVOICE_FIELD_IDS["Raised Date"])
            params["orderBy"] = json.dumps([{"fieldId": field_id, "order": order}])

            async with httpx.AsyncClient(timeout=20) as client:
                res = await client.get(self._record_url, params=params, headers=self._headers)
                res.raise_for_status()
                data = res.json()
            return {"records": data.get("records", []), "total": data.get("total", 0)}

        return await cache.get_or_set(cache_key, ttl=_TTL_LIST, loader=_load)

    # ── Fetch all records (for summary / AI) ──────────────────────────────
    async def get_all_invoices(self) -> list[dict]:
        async def _load():
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
            return records
        return await cache.get_or_set("invoice:all", ttl=_TTL_ALL, loader=_load)

    # ── Get single invoice ────────────────────────────────────────────────
    async def get_invoice(self, record_id: str) -> dict:
        pg = await self.get_invoice_from_pg(record_id)
        if pg is not None:
            return pg
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
            _bust_invoice_cache()
            data = res.json()
            return data.get("records", [{}])[0]

    # ── Update invoice ────────────────────────────────────────────────────
    async def update_invoice(self, record_id: str, fields: dict) -> dict:
        url = f"{self._record_url}/{record_id}"
        body = {
            "fieldKeyType": "name",
            "record": {"fields": _clean_fields(fields, allow_null_fields={"Raised Date", "Cleared Date", "Next followup"})},
        }
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.patch(url, json=body, headers=self._headers)
            res.raise_for_status()
            _bust_invoice_cache()
            return res.json()

    # ── Delete invoice ────────────────────────────────────────────────────
    async def delete_invoice(self, record_id: str) -> None:
        url = f"{self._record_url}/{record_id}"
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.delete(url, headers=self._headers)
            res.raise_for_status()
            _bust_invoice_cache()

    # ── Compute summary ───────────────────────────────────────────────────
    async def get_summary(self) -> dict:
        cached = cache.get("invoice:summary")
        if cached is not None:
            return cached

        records = await self.get_all_invoices()
        summary = self._compute_summary(records)
        cache.set("invoice:summary", summary, ttl=_TTL_SUMMARY)
        return summary


# ── Strip read-only / None fields before write ─────────────────────────────
_READ_ONLY = {"Days To Clear", "Speed", "Agening (Days)", "Outstanding Amount"}

def _clean_fields(fields: dict, allow_null_fields: set[str] | None = None) -> dict:
    allow_null = allow_null_fields or set()
    return {
        k: v for k, v in fields.items()
        if k not in _READ_ONLY and ((v is not None and v != "") or (k in allow_null and v is None))
    }
