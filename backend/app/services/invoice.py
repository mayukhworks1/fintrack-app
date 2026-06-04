"""
Invoice Teable service — table tblyWvNkprE1HnaVZIH
Handles CRUD + summary for Invoice Tracking.
"""
import json
import logging
from typing import Any, Optional
from datetime import datetime, timezone
import httpx
from ..config import settings
from ..db.attribution import empty_actor
from ..db import valkey as vk
from ..utils.cache import cache
from ..db.postgres import get_pool

# ── Field IDs for filter/sort params (must use IDs, not names) ─────────────
INVOICE_FIELD_IDS = {
    "Invoice Number":   "fldKSNWW3OwqTtsWLqD",
    "Project":          "fldavbndGaQVJZ4spJs",
    "Client Name":      "fldVnXFCaHHxqsp6AHq",   # single-select: Birla Open Minds, Maitrimetal, Innovine
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
    "Agening (Days)":   "fld0m8lwVX4wyQeJrOG",
    "Next followup":    "fldr11YNIf7EPSPObUF",
    "Outstanding Amount": "fldn4mfpKXNQxSnDfc6", # READ-ONLY
}

# Single-select fields whose options we expose as picklists
INVOICE_PICKLIST_FIELDS = {"Project", "Client Name", "Category", "Milestone", "Raised By", "Payment Status"}

# ── Cache config ───────────────────────────────────────────────────────────
# All entries live in the shared ../utils/cache singleton, namespaced by
# the "invoice:" prefix so writes can bust just our slice.
_TTL_LIST    = 15   # invoice list/sort/filter results
_TTL_ALL     = 30   # full record dump (used by summary + AI)
_TTL_SUMMARY = 30   # computed summary

logger = logging.getLogger("fintrack.invoices")
AGING_REFRESH_HELPER_FIELD = "Aging Refresh Tick"
AGING_FORMULA_FIELD = "Agening (Days)"
AGING_FIELD_META_TTL = 60

def _teable_error(res: httpx.Response) -> str:
    try:
        payload = res.json()
    except Exception:
        payload = res.text
    return f"Teable {res.status_code}: {payload}"

def _bust_invoice_cache() -> None:
    """Invalidate every cached invoice entry after a write."""
    cache.bust(prefix="invoice:")


def _runtime_aging(fields: dict[str, Any]) -> int | None:
    status = str(fields.get("Payment Status") or "").strip()
    if status != "Pending":
        return None
    raised_raw = fields.get("Raised Date")
    if not raised_raw:
        return None
    try:
        raised_dt = datetime.fromisoformat(str(raised_raw).replace("Z", "+00:00"))
        return max(0, (datetime.now(timezone.utc) - raised_dt).days)
    except Exception:
        return None


def _apply_runtime_invoice_derivatives(record: dict[str, Any]) -> dict[str, Any]:
    fields = dict(record.get("fields") or {})
    aging = _runtime_aging(fields)
    if aging is not None:
        fields["Agening (Days)"] = aging
    record["fields"] = fields
    return record


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

    @property
    def _field_url(self):
        return f"{self.base_url}/api/table/{self.table_id}/field"

    async def get_picklists(self) -> dict[str, Any]:
        """Return single-select options for Project, Client Name, Category, etc. directly from Teable schema."""
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(self._field_url, headers=self._headers)
            res.raise_for_status()
            fields = res.json()
        result = {}
        for field in fields:
            name = field.get("name", "")
            if name in INVOICE_PICKLIST_FIELDS and field.get("type") == "singleSelect":
                choices = field.get("options", {}).get("choices", [])
                result[name] = [c["name"] for c in choices if c.get("name")]
        return result

    def _system_actor(self, path: str) -> dict[str, Any]:
        actor = empty_actor()
        actor.update({
            "change_source": "system",
            "actor_role": "system",
            "actor_path": path[:200],
            "actor_method": "AUTO",
            "actor_device_label": "FinTrack automation",
            "actor_device_model": "Aging refresh worker",
        })
        return actor

    def _field_convert_payload(self, field: dict, options_override: dict | None = None) -> dict:
        payload = {
            "type": field["type"],
            "name": field["name"],
            "options": options_override if options_override is not None else (field.get("options") or {}),
        }
        for key in ("description", "dbFieldName", "lookupOptions", "aiConfig"):
            if key in field:
                payload[key] = field.get(key)
        for key in ("unique", "notNull", "isLookup", "isConditionalLookup"):
            if key in field:
                payload[key] = bool(field.get(key))
        return payload

    async def _get_fields_meta(self) -> list[dict[str, Any]]:
        async def _load():
            async with httpx.AsyncClient(timeout=12) as client:
                res = await client.get(self._field_url, headers=self._headers)
                res.raise_for_status()
                return res.json()

        return await cache.get_or_set(f"invoice:fields:{self.table_id}", ttl=AGING_FIELD_META_TTL, loader=_load)

    async def _get_aging_field_mode(self) -> str:
        try:
            fields = await self._get_fields_meta()
            field = next((f for f in fields if (f.get("name") or "").strip() == AGING_FORMULA_FIELD), None)
            field_type = str((field or {}).get("type") or "").lower()
            if field_type == "number":
                return "numeric"
            if field_type == "formula":
                return "formula"
            return field_type or "missing"
        except Exception as exc:
            logger.debug("invoice aging field metadata failed: %s", exc)
            return "unknown"

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
                records.append(_apply_runtime_invoice_derivatives({"id": row["teable_id"], "fields": fields or {}}))
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
            return _apply_runtime_invoice_derivatives({"id": row["teable_id"], "fields": fields or {}})
        except Exception as exc:
            logger.debug("invoices_mirror PG get failed: %s", exc)
            return None

    def _compute_summary(self, records: list[dict]) -> dict:
        total_raised = total_with_tax = total_received = total_outstanding = 0.0
        total_gst = total_tds = 0.0
        by_status: dict[str, int] = {}
        by_status_amounts: dict[str, float] = {}
        by_project: dict[str, dict] = {}
        pending_invoices: list[dict] = []
        overdue_invoices: list[dict] = []

        for r in records:
            f = r.get("fields", {})
            raised      = float(f.get("Amount Raised") or 0)
            with_tax    = float(f.get("Amount with Tax") or 0)
            received    = float(f.get("Amount Received") or 0)
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
                total_gst += max(0.0, with_tax - raised)
                if status == "Paid":
                    paid_received = received if received > 0 else raised
                    total_received += paid_received
                    if paid_received > 0 and with_tax > paid_received:
                        total_tds += with_tax - paid_received
                else:
                    total_outstanding += raised

            by_status[status] = by_status.get(status, 0) + 1
            if not cancelled:
                by_status_amounts[status] = round(by_status_amounts.get(status, 0.0) + raised, 2)

            if project not in by_project:
                by_project[project] = {
                    "raised": 0.0,
                    "with_tax": 0.0,
                    "gst": 0.0,
                    "tds": 0.0,
                    "received": 0.0,
                    "outstanding": 0.0,
                    "count": 0,
                }
            if not cancelled:
                by_project[project]["raised"] += raised
                by_project[project]["with_tax"] += with_tax
                by_project[project]["gst"] += max(0.0, with_tax - raised)
                if status == "Paid":
                    paid_received = received if received > 0 else raised
                    by_project[project]["received"] += paid_received
                    if paid_received > 0 and with_tax > paid_received:
                        by_project[project]["tds"] += with_tax - paid_received
                else:
                    by_project[project]["outstanding"] += raised
            by_project[project]["count"] += 1

            if status == "Pending":
                pending_invoices.append({
                    "id":          r.get("id"),
                    "invoice_no":  f.get("Invoice Number", ""),
                    "project":     project,
                    "amount":      raised,
                    "raised_date": f.get("Raised Date"),
                    "followup":    f.get("Next followup"),
                    "aging":       aging,
                })
                overdue_invoices.append({
                    "id":         r.get("id"),
                    "invoice_no": f.get("Invoice Number", ""),
                    "project":    project,
                    "aging":      aging,
                    "amount":     raised,
                    "currency":   "",
                })

        pending_invoices.sort(key=lambda x: x["aging"], reverse=True)
        overdue_invoices.sort(key=lambda x: x["aging"], reverse=True)

        return {
            "total_raised":       round(total_raised, 2),
            "total_with_tax":     round(total_with_tax, 2),
            "total_gst":          round(total_gst, 2),
            "total_tds":          round(total_tds, 2),
            "total_received":     round(total_received, 2),
            "total_outstanding":  round(total_outstanding, 2),
            "total_invoices":     len(records),
            "active_invoices":    len(records) - by_status.get("Cancelled", 0),
            "by_status":          by_status,
            "by_status_amounts":  by_status_amounts,
            "by_project":         by_project,
            "pending_invoices":   pending_invoices[:10],
            "overdue_invoices":   overdue_invoices[:5],
            "collection_rate":    round((total_received / total_with_tax * 100), 2) if total_with_tax > 0 else 0.0,
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
                records.append(_apply_runtime_invoice_derivatives({"fields": fields or {}}))
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
        # No in-process cache — always read live from Teable so the UI
        # reflects edits (payment, dates, follow-ups) instantly.
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
        records = [_apply_runtime_invoice_derivatives(r) for r in data.get("records", [])]
        return {"records": records, "total": data.get("total", 0)}

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
            return [_apply_runtime_invoice_derivatives(r) for r in records]
        return await cache.get_or_set("invoice:all", ttl=_TTL_ALL, loader=_load)

    # ── Get single invoice ────────────────────────────────────────────────
    async def get_invoice(self, record_id: str) -> dict:
        url = f"{self._record_url}/{record_id}?fieldKeyType=name"
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(url, headers=self._headers)
            res.raise_for_status()
            return _apply_runtime_invoice_derivatives(res.json())

    # ── Create invoice ────────────────────────────────────────────────────
    async def create_invoice(self, fields: dict) -> dict:
        body = {"fieldKeyType": "name", "records": [{"fields": _clean_fields(fields)}]}
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(self._record_url, json=body, headers=self._headers)
            try:
                res.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise RuntimeError(_teable_error(res)) from exc
            _bust_invoice_cache()
            data = res.json()
            created = data.get("records", [{}])[0]
            if created.get("id"):
                await self.touch_aging_for_record(
                    created["id"],
                    record_fields=created.get("fields") or {},
                    attribute_system=False,
                    allow_formula_touch=False,
                )
            return _apply_runtime_invoice_derivatives(created)

    # ── Update invoice ────────────────────────────────────────────────────
    async def update_invoice(self, record_id: str, fields: dict) -> dict:
        url = f"{self._record_url}/{record_id}"
        body = {
            "fieldKeyType": "name",
            "record": {"fields": _clean_fields(fields, allow_null_fields={"Raised Date", "Cleared Date", "Next followup"})},
        }
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.patch(url, json=body, headers=self._headers)
            try:
                res.raise_for_status()
            except httpx.HTTPStatusError as exc:
                safe_fields = sorted((body.get("record") or {}).get("fields", {}).keys())
                raise RuntimeError(f"{_teable_error(res)}; fields={safe_fields}") from exc
            _bust_invoice_cache()
            updated = _apply_runtime_invoice_derivatives(res.json())
            await self.touch_aging_for_record(
                record_id,
                record_fields=updated.get("fields") or {},
                attribute_system=False,
                allow_formula_touch=False,
            )
            return updated

    # ── Delete invoice ────────────────────────────────────────────────────
    async def delete_invoice(self, record_id: str) -> None:
        url = f"{self._record_url}/{record_id}"
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.delete(url, headers=self._headers)
            res.raise_for_status()
            _bust_invoice_cache()

    async def upload_attachment_to_field(
        self,
        record_id: str,
        field_name: str,
        filename: str,
        content: bytes,
        content_type: str,
    ) -> dict:
        field_id = INVOICE_FIELD_IDS.get(field_name)
        if field_name not in {"Reference", "Invoice PDF"} or not field_id:
            raise ValueError(f"Unknown attachment field: {field_name}")

        url = f"{self._record_url}/{record_id}/{field_id}/uploadAttachment"
        async with httpx.AsyncClient(timeout=60) as client:
            res = await client.post(
                url,
                headers={"Authorization": f"Bearer {self.token}"},
                files={"file": (filename, content, content_type or "application/octet-stream")},
            )
            res.raise_for_status()
            data = res.json()

        _bust_invoice_cache()
        fields = data.get("fields", {})
        attachments = fields.get(field_id) or fields.get(field_name) or []
        return {"record": data, "attachments": attachments}

    async def _ensure_aging_refresh_field(self) -> bool:
        try:
            fields = await self._get_fields_meta()
            if any((f.get("name") or "").strip() == AGING_REFRESH_HELPER_FIELD for f in fields):
                return True
            async with httpx.AsyncClient(timeout=12) as client:
                create = await client.post(
                    self._field_url,
                    json={"name": AGING_REFRESH_HELPER_FIELD, "type": "singleLineText"},
                    headers=self._headers,
                )
                create.raise_for_status()
            cache.bust(prefix=f"invoice:fields:{self.table_id}")
            return True
        except Exception as exc:
            logger.warning("invoice aging helper field create failed: %s", exc)
            return False

    async def touch_aging_for_record(
        self,
        record_id: str,
        *,
        record_fields: dict[str, Any] | None = None,
        attribute_system: bool = True,
        allow_formula_touch: bool = True,
    ) -> dict[str, Any]:
        mode = await self._get_aging_field_mode()
        try:
            url = f"{self._record_url}/{record_id}"
            now = datetime.now(timezone.utc).replace(microsecond=0)
            stamp = now.isoformat().replace("+00:00", "Z")
            fields: dict[str, Any]
            if mode == "numeric":
                aging = _runtime_aging(record_fields or {})
                fields = {AGING_FORMULA_FIELD: aging}
            else:
                if not allow_formula_touch:
                    return {"ok": False, "mode": mode, "aging": None, "skipped": "formula-touch-disabled"}
                if not await self._ensure_aging_refresh_field():
                    return {"ok": False, "mode": mode, "aging": None}
                fields = {AGING_REFRESH_HELPER_FIELD: stamp}
            body = {"fieldKeyType": "name", "record": {"fields": fields}}
            if attribute_system:
                await vk.attribution_set(record_id, self._system_actor("/automation/aging-refresh"), ttl=360)
            async with httpx.AsyncClient(timeout=12) as client:
                res = await client.patch(url, json=body, headers=self._headers)
                res.raise_for_status()
            _bust_invoice_cache()
            return {"ok": True, "mode": mode, "aging": fields.get(AGING_FORMULA_FIELD)}
        except Exception as exc:
            logger.warning("invoice aging refresh failed for %s: %s", record_id, exc)
            return {"ok": False, "mode": mode, "aging": None}

    async def touch_pending_aging_records(self) -> dict[str, Any]:
        mode = await self._get_aging_field_mode()
        helper_ready = True if mode == "numeric" else await self._ensure_aging_refresh_field()
        if not helper_ready:
            return {"total": 0, "updated": 0, "updated_records": [], "aging_mode": mode, "error": "aging helper field unavailable"}
        params: dict[str, Any] = {
            "fieldKeyType": "name",
            "take": 1000,
            "skip": 0,
            "filter": json.dumps({
                "conjunction": "and",
                "filterSet": [{
                    "fieldId": INVOICE_FIELD_IDS["Payment Status"],
                    "operator": "is",
                    "value": "Pending",
                }],
            }),
        }
        async with httpx.AsyncClient(timeout=30) as client:
            res = await client.get(self._record_url, params=params, headers=self._headers)
            res.raise_for_status()
            records = res.json().get("records", [])
        touched = 0
        touched_records: list[dict[str, Any]] = []
        for record in records:
            record_id = record.get("id")
            if not record_id:
                continue
            result = await self.touch_aging_for_record(
                record_id,
                record_fields=record.get("fields") or {},
                attribute_system=True,
            )
            if result.get("ok"):
                touched += 1
                touched_records.append({
                    "teable_id": record_id,
                    "invoice_number": record.get("fields", {}).get("Invoice Number") or record_id,
                    "project": record.get("fields", {}).get("Project") or "",
                    "aging": result.get("aging"),
                })
        return {
            "total": len(records),
            "updated": touched,
            "updated_records": touched_records[:25],
            "aging_mode": mode,
            "formula_dependency_ready": mode == "numeric",
        }

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
        if k not in _READ_ONLY and (
            # Send the value if it is truthy, or a legitimate 0 / False
            (v is not None and v != "" and v != []) or
            # Explicitly allow null for date-clearable fields
            (k in allow_null and v is None)
        )
    }
