"""
Helpers shared by the Invoice and Web Invoice Teable services.
"""
from datetime import datetime, timezone
from typing import Any

import httpx

AGING_REFRESH_HELPER_FIELD = "Aging Refresh Tick"
AGING_FORMULA_FIELD = "Agening (Days)"
AGING_FIELD_META_TTL = 60


def _teable_error(res: httpx.Response) -> str:
    try:
        payload = res.json()
    except Exception:
        payload = res.text
    return f"Teable {res.status_code}: {payload}"


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
