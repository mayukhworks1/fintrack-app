"""
Web Invoice Teable service — table tbllkYiaS68BlcOc1Jy
Handles CRUD + summary for the Web Invoice Tracker module.
Accessible only to the "web" role.
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

# ── Field IDs (filter/sort must use IDs, not names) ───────────────────────
WEB_INVOICE_FIELD_IDS = {
    "Invoice Number":     "fldXpxJBRJxdGPCRziL",
    "Project":            "fld6wyPMcUFOkzH6dtr",
    "Category":           "fld9w6Z9t9u40H8mnEY",
    "Description":        "fldbBRRtK1cC0E5E6Jx",
    "Milestone":          "fldaQ4b2ZYp8JDOfiEu",
    "Raised By":          "fldPYX6jPmQlIQvo1Ey",
    "Raised Date":        "fldjeBEOG3XuLpMzhiD",
    "Cleared Date":       "fldmBQ2yrTu4YnDeox7",
    "Amount Raised":      "fldw9TLKQFNf6Ae4PtN",
    "Amount with Tax":    "fld432vdrYYdypf2vX9",
    "Amount Received":    "fldpKfiq7ZjEqCSc9IW",
    "Payment Status":     "fldmOgiRUeth1pVylov",
    "Remark":             "fldMtqIMiTbrQaIyOEd",
    "Reference":          "fldLzPglDqQTFEheizk",
    "Invoice PDF":        "fldLu7PC8dc38glTE6Z",
    "Days To Clear":      "fldIRk9nE5kgqhdr8Vq",   # READ-ONLY
    "Speed":              "fldjnJipl6TpyuIGAbm",    # READ-ONLY
    "Agening (Days)":     "fldF9K89V9PsqV9iwjG",   # formula today; writable number is preferred
    "Next followup":      "fldrACt52G4Zga9SZzD",
    "Outstanding Amount": "fld4CDalvu2blFUVH4W",   # READ-ONLY
    "Currency":           "fldc7dtnrwczd5TyFVV",
}

_TTL_LIST    = 15
_TTL_ALL     = 30
_TTL_SUMMARY = 30
logger = logging.getLogger("fintrack.web_invoices")

def _bust_web_cache() -> None:
    cache.bust(prefix="webinv:")

def _teable_error(res: httpx.Response) -> str:
    try:
        payload = res.json()
    except Exception:
        payload = res.text
    return f"Teable {res.status_code}: {payload}"

AGING_REFRESH_HELPER_FIELD = "Aging Refresh Tick"
AGING_FORMULA_FIELD = "Agening (Days)"
AGING_FIELD_META_TTL = 60


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


class WebInvoiceService:
    def __init__(self):
        # Use dedicated web token if set, otherwise fall back to the main token
        self.token    = settings.teable_web_api_token or settings.teable_api_token
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

    @property
    def _field_url(self):
        return f"{self.base_url}/api/table/{self.table_id}/field"

    def _system_actor(self, path: str) -> dict[str, Any]:
        actor = empty_actor()
        actor.update({
            "change_source": "system",
            "actor_role": "system",
            "actor_path": path[:200],
            "actor_method": "AUTO",
            "actor_device_label": "FinTrack automation",
            "actor_device_model": "Web invoice aging refresh worker",
        })
        return actor

    # ── Picklist (single-select field options) ────────────────────────────
    # Which fields are user-editable select fields (not Payment Status which is fixed)
    PICKLIST_FIELDS = ["Project", "Category", "Milestone", "Raised By", "Currency"]

    async def get_picklists(self) -> dict:
        """Fetch current options for all single-select fields from Teable."""
        async def _load():
            async with httpx.AsyncClient(timeout=10) as client:
                res = await client.get(self._field_url, headers=self._headers)
                res.raise_for_status()
                fields = res.json()

            result = {}
            for field in fields:
                name = field.get("name", "")
                if name in self.PICKLIST_FIELDS and field.get("type") == "singleSelect":
                    choices = field.get("options", {}).get("choices", [])
                    result[name] = {
                        "field_id": field.get("id"),
                        "options": [c["name"] for c in choices],
                        # Preserve full choice objects (id+name) needed for PATCH
                        "_choices": choices,
                        "_field": field,
                    }
            return result

        return await cache.get_or_set("webinv:picklists", ttl=60, loader=_load)

    def _field_convert_payload(self, field: dict, updated_choices: list[dict]) -> dict:
        payload = {
            "type": field["type"],
            "name": field["name"],
            "options": {
                **(field.get("options") or {}),
                "choices": updated_choices,
            },
        }

        # Teable's convert endpoint expects the full mutable config where present.
        for key in ("description", "dbFieldName", "lookupOptions", "aiConfig"):
            if key in field:
                payload[key] = field.get(key)
        for key in ("unique", "notNull", "isLookup", "isConditionalLookup"):
            if key in field:
                payload[key] = bool(field.get(key))
        return payload

    def _generic_field_convert_payload(self, field: dict, options_override: dict | None = None) -> dict:
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

        return await cache.get_or_set(f"webinv:fields:{self.table_id}", ttl=AGING_FIELD_META_TTL, loader=_load)

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
            logger.debug("web invoice aging field metadata failed: %s", exc)
            return "unknown"

    async def add_picklist_option(self, field_name: str, new_option: str) -> dict:
        """Append a new choice to a single-select field in Teable."""
        picklists = await self.get_picklists()
        if field_name not in picklists:
            raise ValueError(f"Unknown picklist field: {field_name}")

        meta = picklists[field_name]
        field_id = meta["field_id"]
        field = meta["_field"]

        # Preserve existing choices (with their Teable IDs/colors) and append the new one
        existing = meta["_choices"]
        if new_option in [c["name"] for c in existing]:
            return {"options": [c["name"] for c in existing]}  # already exists

        updated_choices = existing + [{"name": new_option}]
        url = f"{self._field_url}/{field_id}/convert"
        body = self._field_convert_payload(field, updated_choices)

        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.put(url, json=body, headers=self._headers)
            try:
                res.raise_for_status()
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 403:
                    raise ValueError(
                        "This Teable token can edit invoice records but cannot change dropdown schema. "
                        "Adding new picklist options requires a token with field/schema edit permission "
                        "(for example via TEABLE_WEB_API_TOKEN)."
                    ) from e
                raise

        # Bust picklist cache so next fetch gets fresh data
        cache.bust(prefix="webinv:picklists")
        updated = await self.get_picklists()
        return {"options": updated.get(field_name, {}).get("options", [])}

    async def upload_attachment_to_field(
        self,
        record_id: str,
        field_name: str,
        filename: str,
        content: bytes,
        content_type: str,
    ) -> dict:
        field_id = WEB_INVOICE_FIELD_IDS.get(field_name)
        if not field_id:
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

        _bust_web_cache()
        fields = data.get("fields", {})
        attachments = fields.get(field_id) or fields.get(field_name) or []
        return {"record": data, "attachments": attachments}

    async def get_distinct_client_names(self) -> list[str]:
        """
        Return sorted distinct Project values from actual invoice records.
        Much more accurate than the picklist schema, which can contain
        stale / test entries that were never actually used on a real invoice.
        """
        async def _load():
            params: dict[str, Any] = {
                "fieldKeyType": "name",
                "take": 1000,
                "skip": 0,
            }
            async with httpx.AsyncClient(timeout=20) as client_:
                res = await client_.get(self._record_url, params=params, headers=self._headers)
                res.raise_for_status()
                records = res.json().get("records", [])
            names = sorted({
                r["fields"]["Project"]
                for r in records
                if r.get("fields", {}).get("Project") and isinstance(r["fields"]["Project"], str)
            })
            return names

        return await cache.get_or_set("webinv:client_names", ttl=60, loader=_load)

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
            records = [_apply_runtime_invoice_derivatives(r) for r in data.get("records", [])]
            return {"records": records, "total": data.get("total", 0)}

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
            return [_apply_runtime_invoice_derivatives(r) for r in records]
        return await cache.get_or_set("webinv:all", ttl=_TTL_ALL, loader=_load)

    async def get_invoice(self, record_id: str) -> dict:
        url = f"{self._record_url}/{record_id}?fieldKeyType=name"
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(url, headers=self._headers)
            res.raise_for_status()
            return _apply_runtime_invoice_derivatives(res.json())

    async def create_invoice(self, fields: dict) -> dict:
        body = {"fieldKeyType": "name", "records": [{"fields": _clean_fields(fields)}]}
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(self._record_url, json=body, headers=self._headers)
            try:
                res.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise RuntimeError(_teable_error(res)) from exc
            _bust_web_cache()
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
            _bust_web_cache()
            updated = _apply_runtime_invoice_derivatives(res.json())
            await self.touch_aging_for_record(
                record_id,
                record_fields=updated.get("fields") or {},
                attribute_system=False,
                allow_formula_touch=False,
            )
            return updated

    async def delete_invoice(self, record_id: str) -> None:
        url = f"{self._record_url}/{record_id}"
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.delete(url, headers=self._headers)
            res.raise_for_status()
            _bust_web_cache()

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
            cache.bust(prefix=f"webinv:fields:{self.table_id}")
            return True
        except Exception as exc:
            logger.warning("web invoice aging helper field create failed: %s", exc)
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
                await vk.attribution_set(record_id, self._system_actor("/automation/web-invoice-aging-refresh"), ttl=360)
            async with httpx.AsyncClient(timeout=12) as client:
                res = await client.patch(url, json=body, headers=self._headers)
                res.raise_for_status()
            _bust_web_cache()
            return {"ok": True, "mode": mode, "aging": fields.get(AGING_FORMULA_FIELD)}
        except Exception as exc:
            logger.warning("web invoice aging refresh failed for %s: %s", record_id, exc)
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
                    "fieldId": WEB_INVOICE_FIELD_IDS["Payment Status"],
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

    async def get_summary(self) -> dict:
        cached = cache.get("webinv:summary")
        if cached is not None:
            return cached

        records = await self.get_all_invoices()

        # ── Per-currency accumulators ──────────────────────────────────────
        # by_currency[cur] = {raised, with_tax, received, outstanding, count, pending_count}
        def _empty_cur():
            return {"raised": 0.0, "with_tax": 0.0, "received": 0.0,
                    "outstanding": 0.0, "count": 0, "pending_count": 0}

        by_currency: dict[str, dict] = {}
        by_status: dict[str, int] = {}
        by_project: dict[str, dict] = {}
        pending_invoices: list[dict] = []
        overdue_invoices: list[dict] = []

        for r in records:
            f = r.get("fields", {})
            raised    = float(f.get("Amount Raised")   or 0)
            with_tax  = float(f.get("Amount with Tax") or 0)
            received  = float(f.get("Amount Received") or 0)
            status    = f.get("Payment Status", "Unknown")
            project   = f.get("Project", "Unknown")
            aging     = float(f.get("Agening (Days)")  or 0)
            currency  = (f.get("Currency") or "RS").strip() or "RS"
            cancelled = status == "Cancelled"

            # ── Per-currency totals ──
            if currency not in by_currency:
                by_currency[currency] = _empty_cur()
            cur = by_currency[currency]
            cur["count"] += 1
            if not cancelled:
                cur["raised"]    += raised
                cur["with_tax"]  += with_tax
                if status == "Paid":
                    cur["received"]    += raised
                else:
                    cur["outstanding"] += raised
                    if status == "Pending":
                        cur["pending_count"] += 1

            by_status[status] = by_status.get(status, 0) + 1

            # ── Per-project totals ──
            if project not in by_project:
                by_project[project] = {"raised": 0.0, "received": 0.0,
                                       "outstanding": 0.0, "count": 0,
                                       "currencies": set(),
                                       "by_currency": {}}   # per-currency breakdown
            if not cancelled:
                by_project[project]["currencies"].add(currency)
                # Per-currency sub-totals (for multi-currency project cards)
                pc = by_project[project]["by_currency"]
                if currency not in pc:
                    pc[currency] = {"raised": 0.0, "received": 0.0, "outstanding": 0.0}
                pc[currency]["raised"] += raised
                if status == "Paid":
                    pc[currency]["received"]    += raised
                else:
                    pc[currency]["outstanding"] += raised
                # RS totals kept at top level for backward compat
                if currency == "RS":
                    by_project[project]["raised"] += raised
                    if status == "Paid":
                        by_project[project]["received"]    += raised
                    else:
                        by_project[project]["outstanding"] += raised
            by_project[project]["count"] += 1

            if status == "Pending":
                # Compute aging fallback if Teable field is 0/null
                if not aging and f.get("Raised Date"):
                    from datetime import datetime, timezone
                    try:
                        rd = datetime.fromisoformat(
                            f["Raised Date"].replace("Z", "+00:00"))
                        aging = (datetime.now(timezone.utc) - rd).days
                    except Exception:
                        pass
                pending_invoices.append({
                    "id":          r.get("id"),
                    "invoice_no":  f.get("Invoice Number", ""),
                    "project":     project,
                    "amount":      with_tax,
                    "currency":    currency,
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
                    "currency":   currency,
                })

        pending_invoices.sort(key=lambda x: x["aging"], reverse=True)
        overdue_invoices.sort(key=lambda x: x["aging"], reverse=True)

        # ── Finalise per-currency stats ──
        for cur_data in by_currency.values():
            r_ = cur_data["raised"]
            rec_ = cur_data["received"]
            cur_data["collection_rate"] = round((rec_ / r_ * 100), 2) if r_ > 0 else 0.0
            cur_data["raised"]       = round(cur_data["raised"],       2)
            cur_data["with_tax"]     = round(cur_data["with_tax"],     2)
            cur_data["received"]     = round(cur_data["received"],     2)
            cur_data["outstanding"]  = round(cur_data["outstanding"],  2)

        # ── Serialise set → list for JSON; round project sub-totals ──
        for proj_data in by_project.values():
            proj_data["currencies"] = sorted(proj_data["currencies"])
            proj_data["raised"]      = round(proj_data["raised"],      2)
            proj_data["received"]    = round(proj_data["received"],    2)
            proj_data["outstanding"] = round(proj_data["outstanding"], 2)
            for cur_amounts in proj_data["by_currency"].values():
                cur_amounts["raised"]      = round(cur_amounts["raised"],      2)
                cur_amounts["received"]    = round(cur_amounts["received"],    2)
                cur_amounts["outstanding"] = round(cur_amounts["outstanding"], 2)

        # ── Derive RS-primary totals (backward-compat) ──
        rs = by_currency.get("RS", _empty_cur())
        total_raised      = rs["raised"]
        total_with_tax    = rs["with_tax"]
        total_received    = rs["received"]
        total_outstanding = rs["outstanding"]
        collection_rate   = rs["collection_rate"] if "RS" in by_currency else 0.0

        summary = {
            # RS-primary totals (labelled as such in the frontend)
            "total_raised":      total_raised,
            "total_with_tax":    total_with_tax,
            "total_received":    total_received,
            "total_outstanding": total_outstanding,
            "collection_rate":   collection_rate,
            # Counts
            "total_invoices":  len(records),
            "active_invoices": len(records) - by_status.get("Cancelled", 0),
            # Breakdowns
            "by_status":       by_status,
            "by_project":      by_project,
            "by_currency":     by_currency,          # full per-currency breakdown
            "pending_invoices": pending_invoices[:10],
            "overdue_invoices": overdue_invoices[:5],
        }
        cache.set("webinv:summary", summary, ttl=_TTL_SUMMARY)
        return summary


_READ_ONLY = {"Days To Clear", "Speed", "Agening (Days)", "Outstanding Amount"}

def _clean_fields(fields: dict, allow_null_fields: set[str] | None = None) -> dict:
    allow_null = allow_null_fields or set()
    return {
        k: v for k, v in fields.items()
        if k not in _READ_ONLY and (
            (v is not None and v != "" and v != []) or
            (k in allow_null and v is None)
        )
    }
