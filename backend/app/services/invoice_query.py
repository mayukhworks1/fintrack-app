"""
Server-side invoice list: search, filters, sort, keyset paging and totals.

GET /api/invoices/query used to be the browser's job: the page downloaded
every invoice (limit=1000), then filtered, searched and added up in
JavaScript. That costs the whole table on every poll and stops working well
long before 50,000 invoices. Here the same rules run in Postgres against
invoices_mirror's typed columns (migration 0009), so a request reads one page
of records plus one aggregate pass, and never opens `fields` for rows it does
not return.

The filters are the page's filters, and their rules are the ones
shared_views._record_matches_view already ports from the browser for live
links. When the mirror cannot answer (no Postgres, an empty mirror, a
migration not yet run) the same request is answered from Teable through that
port and the Python totals below, so the page never loses its list.

Totals mirror InvoiceService._compute_summary (the KPI cards) and
invoiceAmountParts (the month and project widgets); each measure is written
once as SQL and once as Python, side by side, so the two paths cannot drift.
"""
from __future__ import annotations

import base64
import binascii
import json
import logging
import math
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Iterable, Optional

from .invoice_common import (
    _apply_runtime_invoice_derivatives,
    cell_text,
    invoice_search_text,
    search_tokens,
)

logger = logging.getLogger("fintrack.invoice_query")

DEFAULT_LIMIT = 50
MAX_LIMIT = 200
AGING_BANDS = ("0-14d", "15-30d", "31-60d", "60d+")
DATE_FIELDS = {"Raised Date": "raised", "Cleared Date": "cleared", "Next followup": "followup"}
BILLING = {"all", "project", "retainer"}
MAX_PROJECTS = 50
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
_TEXT_MAX = 255

# Sortable columns: field name -> (kind, mirror column). Anything else is refused.
SORTS: dict[str, tuple[str, Optional[str]]] = {
    "Raised Date":        ("ts", "raised_at"),
    "Cleared Date":       ("ts", "cleared_at"),
    "Next followup":      ("ts", "followup_at"),
    "Amount Raised":      ("num", "amount_raised"),
    "Amount with Tax":    ("num", "amount_with_tax"),
    "Amount Received":    ("num", "amount_received"),
    "Outstanding Amount": ("num", "outstanding_amount"),
    "Agening (Days)":     ("aging", None),
    "Invoice Number":     ("text", "invoice_number"),
    "Payment Status":     ("text", "payment_status"),
    "Project":            ("text", "project"),
    "Client Name":        ("text", "client_name"),
    "Category":           ("text", "category"),
    "Milestone":          ("text", "milestone"),
    "Raised By":          ("text", "raised_by"),
}

# FilterBuilder fields (invoices/utils.js INVOICE_FIELDS) the advanced rules may
# name, with how the server reads each one.
CONDITION_FIELDS: dict[str, tuple[str, str]] = {
    "Client Name":     ("text", "ft_inv_text(fields -> 'Client Name')"),
    "Project":         ("text", "ft_inv_text(fields -> 'Project')"),
    "Category":        ("text", "ft_inv_text(fields -> 'Category')"),
    "Milestone":       ("text", "milestone"),
    "Raised By":       ("text", "raised_by"),
    "Payment Status":  ("text", "ft_inv_text(fields -> 'Payment Status')"),
    "Invoice Number":  ("text", "ft_inv_text(fields -> 'Invoice Number')"),
    "Description":     ("text", "ft_inv_text(fields -> 'Description')"),
    "Remark":          ("text", "ft_inv_text(fields -> 'Remark')"),
    "Amount Raised":   ("number", "amount_raised"),
    "Amount with Tax": ("number", "amount_with_tax"),
    "Amount Received": ("number", "amount_received"),
    "Raised Date":     ("date", "raised_at"),
    "Next followup":   ("date", "followup_at"),
    "Cleared Date":    ("date", "cleared_at"),
}
TEXT_OPS = {"contains", "not_contains", "is", "is_not", "starts_with", "ends_with", "is_empty", "is_not_empty"}
NUMBER_OPS = {"eq", "neq", "gt", "gte", "lt", "lte"}
DATE_OPS = {"date_is", "date_is_not", "date_before", "date_after"}
MAX_CONDITIONS = 20

_TOP_CHAR = "\U0010ffff"   # sorts after any text, in Python and under COLLATE "C"


class QueryError(ValueError):
    """A request the endpoint refuses (400)."""


# ── Request ────────────────────────────────────────────────────────────────

@dataclass
class InvoiceQuery:
    q: str = ""
    status: Optional[str] = None
    project: Optional[str] = None
    client: Optional[str] = None
    category: Optional[str] = None
    raised_by: Optional[str] = None
    billing: str = "all"
    month: Optional[str] = None
    aging: Optional[str] = None
    date_field: str = "Raised Date"
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    overdue: bool = False
    has_docs: bool = False
    followup_due: bool = False
    conditions: list[dict[str, Any]] = field(default_factory=list)
    sort: str = "Raised Date"
    order: str = "desc"
    tz: int = 0

    @property
    def tokens(self) -> list[str]:
        return search_tokens(self.q)

    @property
    def filtered(self) -> bool:
        return bool(
            self.tokens or self.status or self.project or self.client or self.category or self.raised_by
            or self.billing != "all" or self.month or self.aging or self.date_from or self.date_to
            or self.overdue or self.has_docs or self.followup_due or self.conditions
        )

    def filter_key(self) -> str:
        """Everything that decides which rows are in scope (not their order)."""
        return json.dumps([
            self.tokens, self.status, self.project, self.client, self.category, self.raised_by,
            self.billing, self.month, self.aging, self.date_field if (self.date_from or self.date_to) else None,
            self.date_from, self.date_to, self.overdue, self.has_docs, self.followup_due, self.conditions, self.tz,
        ], separators=(",", ":"), sort_keys=True)

    def view_config(self) -> dict[str, Any]:
        """The same scope as a shared-view config, for the Python port of the page's filters."""
        return {
            "filterStatus": self.status or "", "filterProject": self.project or "",
            "filterClient": self.client or "", "filterCategory": self.category or "",
            "raisedByFilter": self.raised_by or "", "billingFilter": self.billing,
            "monthFilter": self.month or "", "dateFieldFilter": self.date_field,
            "dateFrom": self.date_from or "", "dateTo": self.date_to or "",
            "agingBandFilter": self.aging or "", "overdueOnly": self.overdue,
            "hasDocsOnly": self.has_docs, "followupDueOnly": self.followup_due,
            "search": self.q or "", "filterConditions": self.conditions,
            "utcOffsetMinutes": self.tz,
        }


def _clean_text(value: Optional[str], name: str) -> Optional[str]:
    if value is None:
        return None
    value = str(value)
    if len(value) > _TEXT_MAX:
        raise QueryError(f"{name} is too long")
    return value or None


def _clean_date(value: Optional[str], name: str) -> Optional[str]:
    if not value:
        return None
    if not _DATE_RE.match(value):
        raise QueryError(f"{name} must be YYYY-MM-DD")
    try:
        date.fromisoformat(value)
    except ValueError:
        raise QueryError(f"{name} is not a date") from None
    return value


def _parse_conditions(raw: Any) -> list[dict[str, Any]]:
    if raw in (None, "", []):
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raise QueryError("conditions must be a JSON list") from None
    if not isinstance(raw, list):
        raise QueryError("conditions must be a JSON list")
    out: list[dict[str, Any]] = []
    for cond in raw:
        if not isinstance(cond, dict):
            raise QueryError("each condition must be an object")
        fld, op, value = cond.get("field"), cond.get("op"), cond.get("value")
        # Incomplete rows are skipped, exactly as FilterBuilder.applyConditions does.
        if not fld or not op:
            continue
        if op not in ("is_empty", "is_not_empty") and (value is None or value == ""):
            continue
        if fld not in CONDITION_FIELDS:
            raise QueryError(f"unknown condition field: {str(fld)[:60]}")
        kind = CONDITION_FIELDS[fld][0]
        allowed = {"text": TEXT_OPS, "number": NUMBER_OPS, "date": DATE_OPS}[kind]
        if op not in allowed:
            raise QueryError(f"operator {str(op)[:30]} does not apply to {fld}")
        if op in ("is_empty", "is_not_empty"):
            value = ""
        elif not isinstance(value, (str, int, float)) or isinstance(value, bool) \
                or (isinstance(value, str) and len(value) > _TEXT_MAX) \
                or (isinstance(value, float) and not math.isfinite(value)):
            raise QueryError("condition values must be short text or numbers")
        out.append({"field": fld, "op": op, "value": value})
    if len(out) > MAX_CONDITIONS:
        raise QueryError(f"at most {MAX_CONDITIONS} conditions")
    return out


def build_query(
    *, q: Optional[str] = None, status: Optional[str] = None, project: Optional[str] = None,
    client: Optional[str] = None, category: Optional[str] = None, raised_by: Optional[str] = None,
    billing: Optional[str] = None, month: Optional[str] = None, aging: Optional[str] = None,
    date_field: Optional[str] = None, date_from: Optional[str] = None, date_to: Optional[str] = None,
    overdue: bool = False, has_docs: bool = False, followup_due: bool = False,
    conditions: Any = None, sort: Optional[str] = None, order: Optional[str] = None, tz: int = 0,
) -> InvoiceQuery:
    """Validate request parameters into an InvoiceQuery; QueryError on anything unknown."""
    if q is not None and len(q) > 200:
        raise QueryError("q is too long")
    billing = billing or "all"
    if billing not in BILLING:
        raise QueryError("billing must be all, project or retainer")
    if month and not _MONTH_RE.match(month):
        raise QueryError("month must be YYYY-MM")
    if aging and aging not in AGING_BANDS:
        raise QueryError(f"aging must be one of {', '.join(AGING_BANDS)}")
    date_field = date_field or "Raised Date"
    if date_field not in DATE_FIELDS:
        raise QueryError("date_field must be Raised Date, Cleared Date or Next followup")
    sort = sort or "Raised Date"
    if sort not in SORTS:
        raise QueryError(f"cannot sort by {sort[:60]}")
    order = (order or "desc").lower()
    if order not in ("asc", "desc"):
        raise QueryError("order must be asc or desc")
    if not -900 <= int(tz) <= 900:
        raise QueryError("tz must be a UTC offset in minutes")
    return InvoiceQuery(
        q=(q or "").strip(), status=_clean_text(status, "status"), project=_clean_text(project, "project"),
        client=_clean_text(client, "client"), category=_clean_text(category, "category"),
        raised_by=_clean_text(raised_by, "raised_by"), billing=billing, month=month or None,
        aging=aging or None, date_field=date_field,
        date_from=_clean_date(date_from, "date_from"), date_to=_clean_date(date_to, "date_to"),
        overdue=bool(overdue), has_docs=bool(has_docs), followup_due=bool(followup_due),
        conditions=_parse_conditions(conditions), sort=sort, order=order, tz=int(tz),
    )


# ── Cursor ─────────────────────────────────────────────────────────────────

def encode_cursor(qry: InvoiceQuery, key: Any, record_id: str) -> str:
    if isinstance(key, float) and math.isinf(key):
        key = "+inf" if key > 0 else "-inf"
        kind = "inf"
    else:
        kind = "f" if isinstance(key, (int, float)) else "s"
    raw = json.dumps({"s": qry.sort, "o": qry.order, "t": kind, "k": key, "i": record_id}, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_cursor(qry: InvoiceQuery, cursor: str) -> tuple[Any, str]:
    try:
        if len(cursor) > 2000:
            raise ValueError
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError
    except (ValueError, binascii.Error, UnicodeDecodeError):
        raise QueryError("invalid cursor") from None
    if data.get("s") != qry.sort or data.get("o") != qry.order:
        raise QueryError("cursor belongs to a different sort")
    rid, kind, key = data.get("i"), data.get("t"), data.get("k")
    if not isinstance(rid, str) or not 0 < len(rid) <= 60:
        raise QueryError("invalid cursor")
    text_sort = SORTS[qry.sort][0] == "text"
    if kind == "s" and text_sort and isinstance(key, str) and len(key) <= 1000:
        return key, rid
    if kind == "f" and not text_sort and isinstance(key, (int, float)) and not isinstance(key, bool):
        return float(key), rid
    if kind == "inf" and not text_sort and key in ("+inf", "-inf"):
        return (math.inf if key == "+inf" else -math.inf), rid
    raise QueryError("invalid cursor")


# ── Measures: one definition, SQL and Python ───────────────────────────────
# A base row (SQL: the `base` CTE; Python: _row()) carries st, raised, wt, rec,
# outa, aging, doc_count and fday. Every measure is a per-row contribution,
# summed per group.

_NOT_CANCELLED = "st IS DISTINCT FROM 'Cancelled'"
_PAID_RECEIVED_SQL = "(CASE WHEN rec > 0 THEN rec ELSE raised END)"
_GROSS_SQL = "(CASE WHEN wt <> 0 THEN wt ELSE raised END)"


def _paid_received(r):
    return r["rec"] if r["rec"] > 0 else r["raised"]


def _gross(r):
    return r["wt"] if r["wt"] != 0 else r["raised"]


MEASURES: list[tuple[str, str, Callable[[dict], float]]] = [
    ("n", "1", lambda r: 1),
    ("paid", "CASE WHEN st = 'Paid' THEN 1 ELSE 0 END", lambda r: r["st"] == "Paid"),
    ("pending", "CASE WHEN st = 'Pending' THEN 1 ELSE 0 END", lambda r: r["st"] == "Pending"),
    ("cancelled", "CASE WHEN st = 'Cancelled' THEN 1 ELSE 0 END", lambda r: r["st"] == "Cancelled"),
    ("raised", f"CASE WHEN {_NOT_CANCELLED} THEN raised ELSE 0 END",
     lambda r: r["raised"] if r["st"] != "Cancelled" else 0),
    ("with_tax", f"CASE WHEN {_NOT_CANCELLED} THEN wt ELSE 0 END",
     lambda r: r["wt"] if r["st"] != "Cancelled" else 0),
    ("gst", f"CASE WHEN {_NOT_CANCELLED} THEN GREATEST(0, wt - raised) ELSE 0 END",
     lambda r: max(0.0, r["wt"] - r["raised"]) if r["st"] != "Cancelled" else 0),
    ("collected", f"CASE WHEN st = 'Paid' THEN {_PAID_RECEIVED_SQL} ELSE 0 END",
     lambda r: _paid_received(r) if r["st"] == "Paid" else 0),
    ("tds", f"CASE WHEN st = 'Paid' AND {_PAID_RECEIVED_SQL} > 0 AND wt > {_PAID_RECEIVED_SQL} "
            f"THEN wt - {_PAID_RECEIVED_SQL} ELSE 0 END",
     lambda r: (r["wt"] - _paid_received(r)) if r["st"] == "Paid" and _paid_received(r) > 0
     and r["wt"] > _paid_received(r) else 0),
    ("outstanding", f"CASE WHEN {_NOT_CANCELLED} AND st IS DISTINCT FROM 'Paid' THEN raised ELSE 0 END",
     lambda r: r["raised"] if r["st"] not in ("Cancelled", "Paid") else 0),
    ("sum_raised", "raised", lambda r: r["raised"]),
    ("sum_wt", "wt", lambda r: r["wt"]),
    ("sum_rec", "rec", lambda r: r["rec"]),
    ("open_raw", "outa", lambda r: r["outa"]),
    ("open_pos", "GREATEST(outa, 0)", lambda r: max(r["outa"], 0.0)),
    ("overdue", "CASE WHEN st = 'Pending' AND aging > 30 THEN 1 ELSE 0 END",
     lambda r: r["st"] == "Pending" and r["aging"] > 30),
    ("followups", "CASE WHEN fday IS NOT NULL AND fday <= $2::date THEN 1 ELSE 0 END",
     lambda r: r["fday"] is not None and r["fday"] <= r["_today"]),
    ("missing_docs", "CASE WHEN doc_count = 0 THEN 1 ELSE 0 END", lambda r: r["doc_count"] == 0),
    ("gross", _GROSS_SQL, _gross),
    ("p_gst", f"GREATEST(0, {_GROSS_SQL} - raised)", lambda r: max(0.0, _gross(r) - r["raised"])),
    ("deduction", f"CASE WHEN st = 'Paid' THEN GREATEST(0, {_GROSS_SQL} - rec) ELSE 0 END",
     lambda r: max(0.0, _gross(r) - r["rec"]) if r["st"] == "Paid" else 0),
    ("p_open", f"CASE WHEN st IN ('Paid', 'Cancelled') THEN 0 ELSE GREATEST(0, {_GROSS_SQL} - rec) END",
     lambda r: 0 if r["st"] in ("Paid", "Cancelled") else max(0.0, _gross(r) - r["rec"])),
    ("cleared_amt", "CASE WHEN rec <> 0 THEN rec ELSE raised END", lambda r: r["rec"] if r["rec"] != 0 else r["raised"]),
]

# Groupings: name -> base-row column. "total" is the whole scope.
GROUPS_SCOPE = ("project", "status", "band", "rmonth", "cmonth")
GROUPS_FACETS = ("client", "category", "milestone", "raised_by")


def _band(days: float) -> str:
    if days <= 14:
        return "0-14d"
    if days <= 30:
        return "15-30d"
    if days <= 60:
        return "31-60d"
    return "60d+"


# ── SQL ────────────────────────────────────────────────────────────────────

class _Params:
    def __init__(self, now: datetime, tz: int):
        self.values: list[Any] = [now, now.astimezone(timezone.utc).date(), tz]

    def add(self, value: Any) -> str:
        self.values.append(value)
        return f"${len(self.values)}"


# $1 = now, $2 = today (UTC), $3 = tz offset minutes: every query starts with these.
_DAYS_SINCE_RAISED = "floor(extract(epoch FROM ($1::timestamptz - raised_at)) / 86400)"
AGING_SQL = (
    "(CASE WHEN payment_status IS NOT NULL AND payment_status <> 'Pending' THEN 0 "
    f"WHEN payment_status = 'Pending' AND raised_at IS NOT NULL THEN {_DAYS_SINCE_RAISED} "
    "WHEN agening > 0 THEN agening "
    f"WHEN raised_at IS NOT NULL THEN {_DAYS_SINCE_RAISED} ELSE 0 END)::float8"
)


def _local_month(col: str) -> str:
    return f"to_char(({col} AT TIME ZONE 'UTC') + make_interval(mins => $3::int), 'YYYY-MM')"


def _utc_day(col: str) -> str:
    return f"(({col}) AT TIME ZONE 'UTC')::date"


def _sort_key_sql(qry: InvoiceQuery) -> str:
    kind, col = SORTS[qry.sort]
    desc = qry.order == "desc"
    if kind == "ts":
        return f"COALESCE(ft_inv_epoch({col}), '{'-' if desc else ''}Infinity'::double precision)"
    if kind == "num":
        return f"COALESCE(({col})::double precision, '{'-' if desc else ''}Infinity'::double precision)"
    if kind == "aging":
        return AGING_SQL
    sentinel = "''" if desc else "U&'\\+10FFFF'"
    return f'(COALESCE(lower({col}), {sentinel}) COLLATE "C")'


def _condition_sql(cond: dict, p: _Params) -> str:
    kind, expr = CONDITION_FIELDS[cond["field"]]
    op, value = cond["op"], cond["value"]
    if kind == "number":
        right = _number_value(value)
        if right is None:
            return "FALSE"
        sym = {"eq": "=", "neq": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[op]
        return f"({expr} IS NOT NULL AND ({expr})::float8 {sym} {p.add(right)}::float8)"
    if kind == "date":
        right = _date_value(value)
        if right is None:
            return "FALSE"
        sym = {"date_is": "=", "date_is_not": "<>", "date_before": "<", "date_after": ">"}[op]
        return f"({expr} IS NOT NULL AND {_utc_day(expr)} {sym} {p.add(right)}::date)"
    text = f"btrim(COALESCE({expr}, ''))"
    if op == "is_empty":
        return f"{text} = ''"
    if op == "is_not_empty":
        return f"{text} <> ''"
    needle = p.add(str(value).strip().lower())
    low = f"lower({text})"
    return {
        "is": f"{low} = {needle}",
        "is_not": f"{low} <> {needle}",
        "contains": f"strpos({low}, {needle}) > 0",
        "not_contains": f"strpos({low}, {needle}) = 0",
        "starts_with": f"left({low}, char_length({needle})) = {needle}",
        "ends_with": f"right({low}, char_length({needle})) = {needle}",
    }[op]


def _number_value(value: Any) -> Optional[float]:
    """normalizeNumberValue() in FilterBuilder.jsx, for the rule's own value."""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value) if math.isfinite(value) else None
    text = re.sub(r"[^0-9.\-]", "", str(value).strip())
    try:
        number = float(text)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def _date_value(value: Any) -> Optional[date]:
    text = str(value).strip()[:10]
    if not _DATE_RE.match(text):
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def _like(token: str) -> str:
    return "%" + token.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def where_sql(qry: InvoiceQuery, owner: Optional[str], p: _Params) -> str:
    """WHERE clause (live rows, owner scope, filters) over invoices_mirror columns."""
    # $1-$3 are bound on every query, so each statement has to name them for
    # Postgres to know their types; this states them once as a constant test.
    w = ["($1::timestamptz, $2::date, $3::int) IS NOT NULL", "deleted_at IS NULL"]
    if owner:
        w.append(f"lower(raised_by) = lower({p.add(owner)})")
    for tok in qry.tokens:
        w.append(f"search_text LIKE {p.add(_like(tok))}")
    if qry.status:
        w.append(f"payment_status = {p.add(qry.status)}")
    if qry.project:
        w.append(f"project = {p.add(qry.project)}")
    if qry.client:
        w.append(f"client_name = {p.add(qry.client)}")
    if qry.category:
        w.append(f"category = {p.add(qry.category)}")
    if qry.raised_by:
        w.append(f"raised_by = {p.add(qry.raised_by)}")
    if qry.billing == "retainer":
        w.append("category ILIKE '%retainer%'")
    elif qry.billing == "project":
        w.append("(category IS NULL OR category NOT ILIKE '%retainer%')")
    if qry.month:
        w.append(f"{_local_month('raised_at')} = {p.add(qry.month)}")
    if qry.date_from or qry.date_to:
        day = {
            "raised": "raised_date", "cleared": "cleared_date", "followup": _utc_day("followup_at"),
        }[DATE_FIELDS[qry.date_field]]
        w.append(f"{day} IS NOT NULL")
        if qry.date_from:
            w.append(f"{day} >= {p.add(date.fromisoformat(qry.date_from))}::date")
        if qry.date_to:
            w.append(f"{day} <= {p.add(date.fromisoformat(qry.date_to))}::date")
    if qry.overdue:
        w.append("(payment_status = 'Pending' OR COALESCE(outstanding_amount, 0) > 0)")
    if qry.followup_due:
        w.append(f"followup_at IS NOT NULL AND {_utc_day('followup_at')} <= $2::date")
    if qry.has_docs:
        w.append("doc_count > 0")
    if qry.aging:
        lo, hi = {"0-14d": (None, 14), "15-30d": (14, 30), "31-60d": (30, 60), "60d+": (60, None)}[qry.aging]
        w.append("payment_status = 'Pending'")
        if lo is not None:
            w.append(f"{AGING_SQL} > {lo}")
        if hi is not None:
            w.append(f"{AGING_SQL} <= {hi}")
    for cond in qry.conditions:
        w.append(_condition_sql(cond, p))
    return " AND ".join(w)


def _base_cte(where: str) -> str:
    return f"""
        SELECT
          payment_status AS st,
          COALESCE(amount_raised, 0)::float8 AS raised,
          COALESCE(amount_with_tax, 0)::float8 AS wt,
          COALESCE(amount_received, 0)::float8 AS rec,
          COALESCE(outstanding_amount, 0)::float8 AS outa,
          COALESCE(project, 'Unassigned') AS project,
          COALESCE(payment_status, 'Unknown') AS status,
          client_name AS client, category, milestone, raised_by,
          doc_count,
          {_utc_day('followup_at')} AS fday,
          {AGING_SQL} AS aging,
          {_local_month('raised_at')} AS rmonth,
          {_local_month('cleared_at')} AS cmonth
        FROM invoices_mirror
        WHERE {where}
    """


_BAND_SQL = (
    "CASE WHEN st = 'Pending' THEN CASE WHEN aging <= 14 THEN '0-14d' WHEN aging <= 30 THEN '15-30d' "
    "WHEN aging <= 60 THEN '31-60d' ELSE '60d+' END END"
)


def aggregate_sql(where: str, groups: Iterable[str]) -> str:
    groups = list(groups)
    sums = ",\n          ".join(f"sum({expr})::float8 AS {name}" for name, expr, _ in MEASURES)
    sets = ", ".join(["()"] + [f"({g})" for g in groups])
    keys = ", ".join(groups)
    return f"""
        WITH src AS ({_base_cte(where)}),
        base AS (SELECT src.*, {_BAND_SQL} AS band FROM src)
        SELECT GROUPING({keys}) AS g, {keys},
          {sums}
        FROM base
        GROUP BY GROUPING SETS ({sets})
    """


def _group_rows_from_sql(rows, groups: list[str]) -> dict[str, dict[Any, dict]]:
    """{group name or "total": {key: {measure: value}}} from the GROUPING SETS rows."""
    out: dict[str, dict[Any, dict]] = {"total": {}}
    for g in groups:
        out[g] = {}
    width = len(groups)
    for row in rows:
        mask = row["g"]
        measures = {name: float(row[name] or 0) for name, _, _ in MEASURES}
        if mask == (1 << width) - 1:
            out["total"][None] = measures
            continue
        for i, g in enumerate(groups):
            if not mask & (1 << (width - 1 - i)):
                out[g][row[g]] = measures
                break
    return out


# ── Python path (Teable fallback, and the reference the tests compare with) ──

def parse_instant(value: Any) -> Optional[datetime]:
    """ft_inv_ts in Python."""
    if not isinstance(value, str):
        return None
    v = value.strip()
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            return datetime.fromisoformat(v + "T00:00:00+00:00")
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})", v):
            v = v.replace("Z", "+00:00")
            m = re.search(r"\.(\d{7,9})", v)
            if m:   # Python reads at most microseconds
                v = v.replace(m.group(0), "." + m.group(1)[:6])
            if re.search(r"[+-]\d{4}$", v):
                v = v[:-2] + ":" + v[-2:]
            return datetime.fromisoformat(v).astimezone(timezone.utc)
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?", v):
            m = re.search(r"\.(\d{7,9})", v)
            if m:
                v = v.replace(m.group(0), "." + m.group(1)[:6])
            return datetime.fromisoformat(v).replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    return None


def _num(value: Any) -> Optional[float]:
    """ft_inv_num in Python."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and re.fullmatch(r"[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?", value.strip()):
        return float(value.strip())
    return None


def _amount(value: Any) -> float:
    """The sync's typed amount (db.sync._num), NULL as 0."""
    try:
        return float(value) if value not in (None, "", []) else 0.0
    except (TypeError, ValueError):
        return 0.0


def _files(value: Any) -> int:
    if isinstance(value, list):
        return len(value)
    if isinstance(value, str):
        parts = re.split(r"\s+", value)
        return sum(1 for i in range(1, len(parts), 2) if parts[i])
    return 0


def _short(value: Any, maxlen: int) -> Optional[str]:
    """db.sync._coerce_str: what the typed text columns hold."""
    if value is None or value == "":
        return None
    if isinstance(value, list):
        titles = [item.get("title", "") for item in value if isinstance(item, dict)]
        joined = ", ".join(t for t in titles if t)
        value = joined or (str(value[0]) if value else "")
    return (str(value) or "")[:maxlen] or None


def _month(instant: Optional[datetime], tz: int) -> Optional[str]:
    if instant is None:
        return None
    return (instant.astimezone(timezone.utc) + timedelta(minutes=tz)).strftime("%Y-%m")


def py_aging(fields: dict, now: datetime) -> float:
    """AGING_SQL in Python (effectiveAging() over a record with its runtime aging applied)."""
    st = _short(fields.get("Payment Status"), 60)
    raised = parse_instant(fields.get("Raised Date"))
    days = math.floor((now - raised).total_seconds() / 86400) if raised else None
    if st is not None and st != "Pending":
        return 0.0
    if st == "Pending" and days is not None:
        return float(days)
    agening = _num(fields.get("Agening (Days)"))
    if agening is not None and agening > 0:
        return float(agening)
    return float(days) if days is not None else 0.0


def _row(record: dict, now: datetime, tz: int) -> dict:
    f = record.get("fields") or {}
    st = _short(f.get("Payment Status"), 60)
    aging = py_aging(f, now)
    followup = parse_instant(f.get("Next followup"))
    return {
        "id": record.get("id"), "fields": f,
        "st": st, "status": st or "Unknown",
        "raised": _amount(f.get("Amount Raised")), "wt": _amount(f.get("Amount with Tax")),
        "rec": _amount(f.get("Amount Received")), "outa": _num(f.get("Outstanding Amount")) or 0.0,
        "project": _short(f.get("Project"), 255) or "Unassigned",
        "client": cell_text(f.get("Client Name")) or cell_text(f.get("Client")),
        "category": _short(f.get("Category"), 120), "milestone": cell_text(f.get("Milestone")),
        "raised_by": cell_text(f.get("Raised By")),
        "doc_count": _files(f.get("Reference")) + _files(f.get("Invoice PDF")),
        "fday": followup.astimezone(timezone.utc).date() if followup else None,
        "aging": aging,
        "band": _band(aging) if st == "Pending" else None,
        "rmonth": _month(parse_instant(f.get("Raised Date")), tz),
        "cmonth": _month(parse_instant(f.get("Cleared Date")), tz),
        "_today": now.astimezone(timezone.utc).date(),
    }


def group_rows_py(rows: list[dict], groups: Iterable[str]) -> dict[str, dict[Any, dict]]:
    groups = list(groups)
    out: dict[str, dict[Any, dict]] = {"total": {None: {name: 0.0 for name, _, _ in MEASURES}}}
    for g in groups:
        out[g] = {}
    for r in rows:
        contrib = {name: float(fn(r)) for name, _, fn in MEASURES}
        targets = [out["total"][None]]
        for g in groups:
            targets.append(out[g].setdefault(r[g], {name: 0.0 for name, _, _ in MEASURES}))
        for t in targets:
            for k, v in contrib.items():
                t[k] += v
    return out


def py_sort_key(qry: InvoiceQuery, record: dict, now: datetime) -> Any:
    """_sort_key_sql in Python."""
    kind, _ = SORTS[qry.sort]
    desc = qry.order == "desc"
    f = record.get("fields") or {}
    if kind == "aging":
        return py_aging(f, now)
    if kind == "ts":
        inst = parse_instant(f.get(qry.sort))
        return inst.timestamp() if inst else (-math.inf if desc else math.inf)
    if kind == "num":
        val = _num(f.get(qry.sort)) if qry.sort == "Outstanding Amount" else (
            _amount(f.get(qry.sort)) if f.get(qry.sort) not in (None, "", []) else None)
        return val if val is not None else (-math.inf if desc else math.inf)
    if qry.sort == "Client Name":
        text = cell_text(f.get("Client Name")) or cell_text(f.get("Client"))
    elif qry.sort in ("Milestone", "Raised By"):
        text = cell_text(f.get(qry.sort))
    else:
        text = _short(f.get(qry.sort), {"Invoice Number": 120, "Category": 120, "Payment Status": 60}.get(qry.sort, 255))
    return text.lower() if text is not None else ("" if desc else _TOP_CHAR)


# ── Shaping ────────────────────────────────────────────────────────────────

def _r(x: float) -> float:
    return round(float(x or 0), 2)


def _summary(m: dict) -> dict:
    with_tax = m["with_tax"]
    return {
        "count": int(m["n"]),
        "paid_count": int(m["paid"]),
        "pending_count": int(m["pending"]),
        "cancelled_count": int(m["cancelled"]),
        "active_count": int(m["n"] - m["cancelled"]),
        "raised": _r(m["raised"]),
        "with_tax": _r(with_tax),
        "gst": _r(m["gst"]),
        "tds": _r(m["tds"]),
        "collected": _r(m["collected"]),
        "outstanding": _r(m["outstanding"]),
        "collection_rate": round(m["collected"] / with_tax * 100, 2) if with_tax > 0 else 0.0,
        "overdue_count": int(m["overdue"]),
        "followups_due": int(m["followups"]),
        "missing_docs": int(m["missing_docs"]),
        "open_amount": _r(m["open_raw"]),
        "totals": {
            "amount_raised": _r(m["sum_raised"]),
            "amount_with_tax": _r(m["sum_wt"]),
            "amount_received": _r(m["sum_rec"]),
            "outstanding": _r(m["open_pos"]),
            "outstanding_raw": _r(m["open_raw"]),
        },
    }


def _project_entry(name: str, m: dict) -> dict:
    gross = m["gross"]
    return {
        "project": name, "count": int(m["n"]),
        "raised": _r(m["raised"]), "with_tax": _r(m["with_tax"]), "gst": _r(m["gst"]), "tds": _r(m["tds"]),
        "received": _r(m["collected"]), "outstanding": _r(m["outstanding"]),
        # invoiceAmountParts totals, for the Recent Projects widget.
        "base": _r(m["sum_raised"]), "gross": _r(gross), "parts_gst": _r(m["p_gst"]),
        "parts_received": _r(m["sum_rec"]), "deduction": _r(m["deduction"]), "open": _r(m["p_open"]),
        "progress": max(0, min(100, round(m["sum_rec"] / gross * 100))) if gross > 0 else 0,
    }


def shape(groups: dict[str, dict[Any, dict]], *, workspace: bool = False) -> dict:
    out = _summary(groups["total"][None])
    out["by_status"] = {
        k: {"count": int(m["n"]), "amount": None if k == "Cancelled" else _r(m["raised"])}
        for k, m in sorted(groups["status"].items(), key=lambda kv: (-kv[1]["n"], str(kv[0])))
    }
    projects = sorted(groups["project"].items(), key=lambda kv: (-kv[1]["n"], -kv[1]["raised"], str(kv[0])))
    out["by_project"] = [_project_entry(k, m) for k, m in projects[:MAX_PROJECTS]]
    out["project_count"] = len(projects)
    out["aging"] = {
        b: {"count": int(groups["band"].get(b, {}).get("n", 0)), "amount": _r(groups["band"].get(b, {}).get("raised", 0))}
        for b in AGING_BANDS
    }
    out["raised_months"] = [
        {"key": k, "count": int(m["n"]), "amount": _r(m["sum_raised"]), "base": _r(m["sum_raised"]),
         "gross": _r(m["gross"]), "gst": _r(m["p_gst"]), "received": _r(m["sum_rec"]),
         "deduction": _r(m["deduction"]), "outstanding": _r(m["p_open"])}
        for k, m in sorted(((k, m) for k, m in groups["rmonth"].items() if k), reverse=True)
    ]
    out["cleared_months"] = [
        {"key": k, "count": int(m["n"]), "amount": _r(m["cleared_amt"])}
        for k, m in sorted(((k, m) for k, m in groups["cmonth"].items() if k), reverse=True)
    ]
    if workspace:
        out["recent_projects"] = [
            _project_entry(k, m) for k, m in sorted(
                projects, key=lambda kv: (-kv[1]["p_open"], -kv[1]["gross"], str(kv[0])))[:4]
        ]
        out["facets"] = {
            "projects": sorted(k for k in groups["project"] if k and k != "Unassigned"),
            "clients": sorted(k for k in groups["client"] if k),
            "categories": sorted(k for k in groups["category"] if k),
            "milestones": sorted(k for k in groups["milestone"] if k),
            "raised_by": sorted(k for k in groups["raised_by"] if k),
            "months": [m["key"] for m in out["raised_months"]],
            "statuses": sorted(k for k in groups["status"] if k),
        }
    return out


def overdue_entry(record_id: str, f: dict, aging: float) -> dict:
    return {
        "id": record_id,
        "invoice_no": f.get("Invoice Number", ""),
        "project": f.get("Project", "Unknown"),
        "client": f.get("Client Name") or f.get("Client") or "",
        "category": f.get("Category") or "",
        "milestone": f.get("Milestone") or "",
        "aging": aging,
        "amount": _amount(f.get("Amount Raised")),
        "outstanding": _num(f.get("Outstanding Amount")),
        "raised_date": f.get("Raised Date"),
        "followup": f.get("Next followup"),
    }


# ── Python execution ───────────────────────────────────────────────────────

def with_runtime_aging(record: dict, now: datetime) -> dict:
    """_apply_runtime_invoice_derivatives, against a given clock."""
    f = dict(record.get("fields") or {})
    if str(f.get("Payment Status") or "").strip() == "Pending":
        raised = parse_instant(f.get("Raised Date"))
        if raised is not None:
            f["Agening (Days)"] = max(0, (now - raised).days)
    return {**record, "fields": f}


def py_filter(records: list[dict], qry: InvoiceQuery, owner: Optional[str], now: datetime) -> list[dict]:
    from .shared_views import _record_matches_view

    cfg = qry.view_config()
    owner_lc = owner.lower() if owner else None
    out = []
    for r in records:
        f = r.get("fields") or {}
        if owner_lc and str(f.get("Raised By", "")).lower() != owner_lc:
            continue
        if _record_matches_view("invoices", cfg, r, now):
            out.append(r)
    return out


def py_page(records: list[dict], qry: InvoiceQuery, now: datetime, *, limit: int,
            cursor: Optional[tuple[Any, str]] = None, offset: int = 0) -> tuple[list[dict], Optional[tuple[Any, str]]]:
    desc = qry.order == "desc"
    keyed = sorted(((py_sort_key(qry, r, now), str(r.get("id") or ""), r) for r in records),
                   key=lambda t: (t[0], t[1]), reverse=desc)
    if cursor is not None:
        ck = (cursor[0], cursor[1])
        keyed = [t for t in keyed if ((t[0], t[1]) < ck if desc else (t[0], t[1]) > ck)]
    else:
        keyed = keyed[offset:]
    page = keyed[:limit]
    more = len(keyed) > limit
    nxt = (page[-1][0], page[-1][1]) if more and page else None
    return [t[2] for t in page], nxt


def py_aggregates(records: list[dict], qry: InvoiceQuery, now: datetime, *, workspace: bool = False) -> dict:
    rows = [_row(r, now, qry.tz) for r in records]
    groups = GROUPS_SCOPE + (GROUPS_FACETS if workspace else ())
    out = shape(group_rows_py(rows, groups), workspace=workspace)
    if workspace:
        pending = sorted((r for r in rows if r["st"] == "Pending"), key=lambda r: (-r["aging"], str(r["id"])))
        out["overdue_top"] = [overdue_entry(r["id"], r["fields"], r["aging"]) for r in pending[:5]]
    return out


def public_record(record: dict) -> dict:
    """A record as GET /api/invoices returns it (runtime aging applied)."""
    return _apply_runtime_invoice_derivatives({"id": record.get("id"), "fields": dict(record.get("fields") or {})})


# ── Execution ──────────────────────────────────────────────────────────────

_TTL_WORKSPACE = 15   # unfiltered totals, per owner scope and time zone
_TTL_SCOPE = 10       # filtered totals, per filter set
EXPORT_BATCH = 500


def _order_sql(qry: InvoiceQuery) -> str:
    direction = "DESC" if qry.order == "desc" else "ASC"
    return f'{_sort_key_sql(qry)} {direction}, teable_id COLLATE "C" {direction}'


def _page_sql(qry: InvoiceQuery, where: str, p: _Params, cursor: Optional[tuple[Any, str]],
              limit: int, offset: int) -> str:
    key = _sort_key_sql(qry)
    if cursor is not None:
        cast = "::text" if SORTS[qry.sort][0] == "text" else "::double precision"
        cmp = "<" if qry.order == "desc" else ">"
        where += f' AND ({key}, teable_id COLLATE "C") {cmp} ({p.add(cursor[0])}{cast}, {p.add(cursor[1])}::text)'
        offset = 0
    return (
        f"SELECT teable_id, fields, {key} AS sort_key FROM invoices_mirror WHERE {where} "
        f"ORDER BY {_order_sql(qry)} LIMIT {int(limit) + 1} OFFSET {int(offset)}"
    )


def _fields_of(row) -> dict:
    raw = row["fields"]
    return raw if isinstance(raw, dict) else json.loads(raw or "{}")


def _cursor_of(row) -> tuple[Any, str]:
    k = row["sort_key"]
    return (k if isinstance(k, str) else float(k), row["teable_id"])


async def _groups_sql(pool, qry: InvoiceQuery, owner: Optional[str], now: datetime,
                      groups: tuple[str, ...], *, scoped: bool) -> dict:
    p = _Params(now, qry.tz)
    where = where_sql(qry if scoped else InvoiceQuery(tz=qry.tz), owner, p)
    rows = await pool.fetch(aggregate_sql(where, groups), *p.values)
    return _group_rows_from_sql(rows, list(groups))


def _today_key(now: datetime) -> str:
    return now.astimezone(timezone.utc).date().isoformat()


async def _workspace_sql(pool, qry: InvoiceQuery, owner: Optional[str], now: datetime) -> dict:
    from ..utils.cache import cache

    key = f"invoice:q:ws:{(owner or '*').lower()}:{qry.tz}:{_today_key(now)}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    ws = shape(await _groups_sql(pool, qry, owner, now, GROUPS_SCOPE + GROUPS_FACETS, scoped=False),
               workspace=True)
    p = _Params(now, qry.tz)
    where = where_sql(InvoiceQuery(tz=qry.tz), owner, p)
    rows = await pool.fetch(
        f"SELECT teable_id, fields, {AGING_SQL} AS aging FROM invoices_mirror "
        f"WHERE {where} AND payment_status = 'Pending' "
        f'ORDER BY aging DESC, teable_id COLLATE "C" ASC LIMIT 5',
        *p.values,
    )
    ws["overdue_top"] = [overdue_entry(r["teable_id"], _fields_of(r), float(r["aging"])) for r in rows]
    cache.set(key, ws, ttl=_TTL_WORKSPACE)
    return ws


async def _scope_sql(pool, qry: InvoiceQuery, owner: Optional[str], now: datetime) -> dict:
    from ..utils.cache import cache

    key = f"invoice:q:scope:{(owner or '*').lower()}:{_today_key(now)}:{qry.filter_key()}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    scope = shape(await _groups_sql(pool, qry, owner, now, GROUPS_SCOPE, scoped=True))
    cache.set(key, scope, ttl=_TTL_SCOPE)
    return scope


def scope_of(ws: dict) -> dict:
    """Workspace totals with exactly the keys of a filtered scope."""
    return {k: v for k, v in ws.items() if k not in ("facets", "recent_projects", "overdue_top")}


async def query_mirror(pool, qry: InvoiceQuery, owner: Optional[str], *, limit: int,
                       cursor: Optional[tuple[Any, str]], offset: int, aggregates: bool,
                       now: datetime) -> Optional[dict]:
    """The query against invoices_mirror, or None when the mirror holds no invoices yet."""
    p = _Params(now, qry.tz)
    where = where_sql(qry, owner, p)
    rows = await pool.fetch(_page_sql(qry, where, p, cursor, limit, offset), *p.values)
    more = len(rows) > limit
    rows = rows[:limit]
    out: dict[str, Any] = {
        "records": [{"id": r["teable_id"], "fields": _fields_of(r)} for r in rows],
        "next": _cursor_of(rows[-1]) if more and rows else None,
    }
    if aggregates:
        ws = await _workspace_sql(pool, qry, owner, now)
        scope = await _scope_sql(pool, qry, owner, now) if qry.filtered else scope_of(ws)
        out.update(aggregates=scope, workspace=ws, total=scope["count"])
    else:
        cp = _Params(now, qry.tz)
        out["total"] = int(await pool.fetchval(
            f"SELECT count(*) FROM invoices_mirror WHERE {where_sql(qry, owner, cp)}", *cp.values))

    if out["total"] == 0 and not out["records"]:
        # "Nothing matches" and "the mirror was never filled" look alike here;
        # only the first is an answer.
        if not await pool.fetchval("SELECT EXISTS (SELECT 1 FROM invoices_mirror WHERE deleted_at IS NULL)"):
            return None
    return out


def query_records(records: list[dict], qry: InvoiceQuery, owner: Optional[str], *, limit: int,
                  cursor: Optional[tuple[Any, str]], offset: int, aggregates: bool, now: datetime) -> dict:
    """The same query over records already in memory (the Teable fallback)."""
    records = [with_runtime_aging(r, now) for r in records]
    if owner:
        owner_lc = owner.lower()
        records = [r for r in records if str((r.get("fields") or {}).get("Raised By", "")).lower() == owner_lc]
    matched = py_filter(records, qry, None, now)
    page, nxt = py_page(matched, qry, now, limit=limit, cursor=cursor, offset=offset)
    out: dict[str, Any] = {"records": page, "next": nxt, "total": len(matched)}
    if aggregates:
        ws = py_aggregates(records, qry, now, workspace=True)
        scope = py_aggregates(matched, qry, now) if qry.filtered else scope_of(ws)
        out.update(aggregates=scope, workspace=ws)
    return out


async def iter_export(pool, qry: InvoiceQuery, owner: Optional[str], now: datetime):
    """Every record in scope, in order, a batch at a time (keyset over the mirror)."""
    cursor = None
    while True:
        p = _Params(now, qry.tz)
        where = where_sql(qry, owner, p)
        rows = await pool.fetch(_page_sql(qry, where, p, cursor, EXPORT_BATCH, 0), *p.values)
        batch = rows[:EXPORT_BATCH]
        if batch:
            yield [{"id": r["teable_id"], "fields": _fields_of(r)} for r in batch]
        if len(rows) <= EXPORT_BATCH:
            return
        cursor = _cursor_of(batch[-1])
