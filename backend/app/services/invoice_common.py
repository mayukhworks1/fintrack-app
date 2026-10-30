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


# ── Search ─────────────────────────────────────────────────────────────────
# The invoice search looks through these fields (and the names of the files
# in Reference). Postgres keeps the same text in invoices_mirror.search_text
# (ft_inv_search, migration 0009); the two must stay identical, so a search
# answers the same whether the mirror or Teable served it.
INVOICE_SEARCH_FIELDS = (
    "Invoice Number", "Client Name", "Client", "Project", "Description", "Category", "Milestone", "Remark",
)
MAX_SEARCH_TOKENS = 8
MAX_SEARCH_TOKEN_LEN = 64


def cell_text(value: Any) -> str | None:
    """A cell as text, as ft_inv_text reads it: blanks are None."""
    if value is None or isinstance(value, dict):
        return None
    if isinstance(value, bool):
        text = "true" if value else "false"
    elif isinstance(value, (int, float)):
        text = str(value)
    elif isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, dict):
                part = item.get("title") if item.get("title") is not None else item.get("name")
            elif isinstance(item, (str, int, float)) and not isinstance(item, bool):
                part = cell_text(item)
            else:
                part = None
            if part is not None:
                parts.append(str(part))
        text = ", ".join(parts) if parts else ""
    else:
        text = str(value)
    return text or None


def invoice_search_text(fields: dict[str, Any]) -> str:
    """Lower-cased search text of an invoice, one field per line."""
    parts = [cell_text(fields.get(k)) for k in INVOICE_SEARCH_FIELDS]
    ref = fields.get("Reference")
    if isinstance(ref, list):
        names = [str(a.get("name") or a.get("filename")) for a in ref
                 if isinstance(a, dict) and (a.get("name") or a.get("filename"))]
        parts.append("\n".join(names) if names else None)
    elif isinstance(ref, str):
        parts.append(ref)
    return "\n".join(p for p in parts if p is not None).lower()


def search_tokens(q: str | None) -> list[str]:
    """The words of a search, lower-cased. Every word has to match."""
    words = str(q or "").lower().split()
    return [w[:MAX_SEARCH_TOKEN_LEN] for w in words[:MAX_SEARCH_TOKENS]]


def invoice_matches_search(fields: dict[str, Any], q: str | None) -> bool:
    tokens = search_tokens(q)
    if not tokens:
        return True
    text = invoice_search_text(fields)
    return all(t in text for t in tokens)
