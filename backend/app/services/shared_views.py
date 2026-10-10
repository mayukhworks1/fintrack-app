"""
SharedViewService — manager share links for status updates.

Create a share → get a short token URL → share with anyone.
Public readers need no auth. Full access tracking (IP/geo/device).
Editor controls: expiry, disable, delete.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from ..db.audit import build_device_label, parse_client_hint, parse_ua
from ..db.geo import lookup as geo_lookup
from ..db.postgres import get_pool

logger = logging.getLogger("fintrack.shared_views")

_MAX_RECORD_IDS = 50
_ALLOWED_ACCESS_MODES = {"read", "edit"}
_ALLOWED_VIEW_TYPES = {"card", "list", "board"}
_ALLOWED_RESOURCE_TYPES = {"status", "projects", "invoices", "tax-ledger"}
_ALLOWED_THEMES = {"cobalt", "emerald", "amber", "rose", "slate"}
_ALLOWED_DENSITIES = {"comfortable", "compact"}
_COLUMN_ALIASES = {
    "Detailed Status": "Current Status (Detailed)",
    "Current Status (Detailed)": "Current Status (Detailed)",
}

# FilterBuilder (frontend/src/components/FilterBuilder.jsx) operators. A live
# link re-applies the owner's advanced rules on every open, so an operator the
# server does not know is refused rather than skipped, which would widen it.
_FILTER_CONDITION_OPS = {
    "contains", "not_contains", "is", "is_not", "starts_with", "ends_with",
    "is_empty", "is_not_empty",
    "eq", "neq", "gt", "gte", "lt", "lte",
    "date_is", "date_is_not", "date_before", "date_after",
}
_FILTER_NO_VALUE_OPS = {"is_empty", "is_not_empty"}
_MAX_FILTER_CONDITIONS = 20
_LIVE_UNSUPPORTED_MESSAGE = (
    "This view uses a filter a live link cannot re-apply on the server. "
    "Share a snapshot of the visible records instead."
)
# view_config keys the public page never needs: the owner's advanced rules can
# name internal fields and values (e.g. "Actual Profit > 100000").
_PRIVATE_VIEW_CONFIG_KEYS = {"filterConditions", "liveUnsupported"}

# Fields the public page renders for every link of a type: card, board,
# grouping, sorting, the tax dashboard and the status filters.
_PUBLIC_BASE_FIELDS = {
    "status": ("Client", "Project", "Status", "Short Status", "Current Status (Detailed)", "lastModifiedTime"),
    "projects": ("Client", "Project Name", "Project Status", "Health", "lastModifiedTime"),
    "invoices": (
        "Invoice Number", "Client Name", "Client", "Project", "Category", "Payment Status",
        "Amount Raised", "Amount Received", "Outstanding Amount", "Agening (Days)", "Raised Date",
        "lastModifiedTime",
    ),
    "tax-ledger": (
        "Invoice Number", "Client Name", "Client", "Project", "Category", "Payment Status",
        "Amount Raised", "Amount with Tax", "Amount Received", "Raised Date", "lastModifiedTime",
    ),
}
# Columns the owner can choose to show (SharedView.jsx RESOURCE_META.columns).
# Anything else — costs, profit, salaries, internal notes — never leaves.
_PUBLIC_COLUMN_FIELDS = {
    "status": ("Client", "Project", "Status", "Short Status", "Current Status (Detailed)", "Attachments", "Last Modified"),
    "projects": (
        "Client", "Project Name", "Project Status", "Health", "Amount Billed So far",
        "Actual Profit", "Profit percentage", "Last Modified",
    ),
    "invoices": (
        "Invoice Number", "Client Name", "Project", "Category", "Payment Status", "Milestone", "Raised By",
        "Amount Raised", "Amount with Tax", "Amount Received", "Outstanding Amount", "Agening (Days)",
        "Raised Date", "Cleared Date", "Next followup", "Description", "Remark", "Reference", "Invoice PDF",
        "Last Modified",
    ),
    "tax-ledger": (
        "Invoice Number", "Client Name", "Project", "Payment Status", "Amount Raised", "Amount with Tax",
        "GST Amount", "TDS Amount", "TDS %", "Amount Received", "Outstanding Amount", "Raised Date",
        "Cleared Date",
    ),
}
# What the page shows when the link carries no columns (RESOURCE_META.defaultColumns).
_PUBLIC_DEFAULT_COLUMNS = {
    "status": ("Client", "Project", "Status", "Short Status", "Current Status (Detailed)", "Last Modified"),
    "projects": ("Client", "Project Name", "Project Status", "Health", "Amount Billed So far"),
    "invoices": (
        "Invoice Number", "Client Name", "Project", "Category", "Payment Status", "Amount Raised",
        "Amount Received", "Outstanding Amount", "Agening (Days)", "Raised Date", "Cleared Date",
        "Next followup",
    ),
    "tax-ledger": (
        "Invoice Number", "Client Name", "Project", "Payment Status", "Amount Raised", "Amount with Tax",
        "GST Amount", "TDS Amount", "TDS %", "Amount Received", "Outstanding Amount", "Raised Date",
    ),
}
# An edit link shows the current value of every field it lets the holder change
# (mirrors _public_edit_fields), so a save never blanks a field it could not see.
_PUBLIC_EDIT_FIELDS = {
    "status": ("Status", "Short Status", "Current Status (Detailed)"),
    "projects": ("Client", "Project Name", "Project Status", "Amount Billed So far"),
    "invoices": ("Invoice Number", "Payment Status", "Amount Received", "Cleared Date", "Remark", "Next followup"),
}
# Search fields of the page each live link is made from.
_STATUS_SEARCH_FIELDS = ("Client", "Project", "Short Status", "Current Status (Detailed)", "Status")  # StatusBoard.jsx
_PROJECT_SEARCH_FIELDS = ("Client", "Project Name", "Project Status", "Health")
_INVOICE_SEARCH_FIELDS = ("Invoice Number", "Client Name", "Client", "Project", "Description", "Category", "Milestone")  # Invoices.jsx
_TAX_SEARCH_FIELDS = ("Invoice Number", "Project", "Client Name", "Client", "Payment Status")  # TaxLedger.jsx


def _new_token() -> str:
    """12-char URL-safe token — e.g. 'aB3kPqRt8Xyz'."""
    return secrets.token_urlsafe(9)


def _row(row) -> dict:
    """asyncpg Record → plain dict with ISO datetimes."""
    out: dict[str, Any] = {}
    for k, v in dict(row).items():
        if hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        else:
            out[k] = v
    record_ids = out.get("record_ids")
    if isinstance(record_ids, str):
        try:
            record_ids = json.loads(record_ids)
        except Exception:
            record_ids = []
    out["is_dynamic"] = record_ids == ["__dynamic__"]
    return out


def _sanitize_view_config(view_config: Optional[dict]) -> Optional[dict]:
    """Persist only the public-view fields we explicitly support."""
    if not isinstance(view_config, dict):
        return None

    view_type = view_config.get("type")
    columns = view_config.get("columns")
    filter_client = view_config.get("filterClient")
    filter_status = view_config.get("filterStatus")
    filter_project = view_config.get("filterProject")
    filter_category = view_config.get("filterCategory")
    raised_by_filter = view_config.get("raisedByFilter")
    month_filter = view_config.get("monthFilter")
    date_field_filter = view_config.get("dateFieldFilter")
    date_from = view_config.get("dateFrom")
    date_to = view_config.get("dateTo")
    aging_band_filter = view_config.get("agingBandFilter")
    billing_filter = view_config.get("billingFilter")
    board_group_by = view_config.get("boardGroupBy")
    card_group_by = view_config.get("cardGroupBy")
    card_group_sort = view_config.get("cardGroupSort")
    card_record_sort = view_config.get("cardRecordSort")
    search = view_config.get("search")
    theme = view_config.get("theme")
    density = view_config.get("density")
    show_dashboard = view_config.get("showDashboard")
    show_client_accents = view_config.get("showClientAccents")
    overdue_only = view_config.get("overdueOnly")
    has_docs_only = view_config.get("hasDocsOnly")
    followup_due_only = view_config.get("followupDueOnly")
    invoice_scope = view_config.get("invoiceScope")
    period_label = view_config.get("periodLabel")
    period_from = view_config.get("periodFrom")
    period_to = view_config.get("periodTo")
    highlight_columns = view_config.get("highlightColumns")

    clean: dict[str, Any] = {}

    if isinstance(view_type, str) and view_type in _ALLOWED_VIEW_TYPES:
        clean["type"] = view_type

    if isinstance(columns, list):
        safe_columns = []
        for c in columns:
            if not isinstance(c, str):
                continue
            normalized = _COLUMN_ALIASES.get(c, c.strip())
            if normalized and len(normalized) <= 120 and normalized not in safe_columns:
                safe_columns.append(normalized)
        if safe_columns:
            clean["columns"] = safe_columns

    if isinstance(highlight_columns, list):
        safe_highlights = []
        for c in highlight_columns:
            if not isinstance(c, str):
                continue
            normalized = _COLUMN_ALIASES.get(c, c.strip())
            if normalized and len(normalized) <= 120 and normalized not in safe_highlights:
                safe_highlights.append(normalized)
        if safe_highlights:
            clean["highlightColumns"] = safe_highlights[:12]

    if isinstance(filter_client, str) and filter_client.strip():
        clean["filterClient"] = filter_client.strip()[:255]

    if isinstance(filter_status, str) and filter_status.strip():
        clean["filterStatus"] = filter_status.strip()[:120]

    if isinstance(filter_project, str) and filter_project.strip():
        clean["filterProject"] = filter_project.strip()[:255]

    if isinstance(filter_category, str) and filter_category.strip():
        clean["filterCategory"] = filter_category.strip()[:255]

    if isinstance(raised_by_filter, str) and raised_by_filter.strip():
        clean["raisedByFilter"] = raised_by_filter.strip()[:255]

    if isinstance(month_filter, str) and month_filter.strip():
        clean["monthFilter"] = month_filter.strip()[:20]

    if isinstance(date_field_filter, str) and date_field_filter.strip():
        clean["dateFieldFilter"] = date_field_filter.strip()[:80]

    if isinstance(date_from, str) and date_from.strip():
        clean["dateFrom"] = date_from.strip()[:20]

    if isinstance(date_to, str) and date_to.strip():
        clean["dateTo"] = date_to.strip()[:20]

    if isinstance(aging_band_filter, str) and aging_band_filter.strip():
        clean["agingBandFilter"] = aging_band_filter.strip()[:40]

    if isinstance(billing_filter, str) and billing_filter.strip():
        clean["billingFilter"] = billing_filter.strip()[:40]

    if isinstance(board_group_by, str) and board_group_by.strip():
        clean["boardGroupBy"] = board_group_by.strip()[:120]

    if isinstance(card_group_by, str) and card_group_by.strip():
        clean["cardGroupBy"] = card_group_by.strip()[:120]

    if isinstance(card_group_sort, str) and card_group_sort.strip():
        clean["cardGroupSort"] = card_group_sort.strip()[:120]

    if isinstance(card_record_sort, str) and card_record_sort.strip():
        clean["cardRecordSort"] = card_record_sort.strip()[:120]

    if isinstance(search, str) and search:
        # Kept verbatim: the status board matches the untrimmed term, and a
        # cut-down term is a prefix that matches more than the owner saw.
        if len(search) > 255:
            clean["liveUnsupported"] = True
        clean["search"] = search[:255]

    raw_conditions = view_config.get("filterConditions")
    advanced = view_config.get("advancedConditions")   # the status board's name for them
    if isinstance(raw_conditions, list) and isinstance(advanced, list):
        raw_conditions = raw_conditions + advanced
    elif raw_conditions is None:
        raw_conditions = advanced
    conditions, faithful = _sanitize_filter_conditions(raw_conditions)
    if conditions:
        clean["filterConditions"] = conditions
    if not faithful or view_config.get("liveUnsupported") is True:
        clean["liveUnsupported"] = True

    utc_offset = view_config.get("utcOffsetMinutes")
    if isinstance(utc_offset, int) and not isinstance(utc_offset, bool) and -840 <= utc_offset <= 840:
        clean["utcOffsetMinutes"] = utc_offset

    if isinstance(theme, str) and theme in _ALLOWED_THEMES:
        clean["theme"] = theme

    if isinstance(density, str) and density in _ALLOWED_DENSITIES:
        clean["density"] = density

    if isinstance(show_dashboard, bool):
        clean["showDashboard"] = show_dashboard

    if isinstance(show_client_accents, bool):
        clean["showClientAccents"] = show_client_accents

    if isinstance(overdue_only, bool):
        clean["overdueOnly"] = overdue_only

    if isinstance(has_docs_only, bool):
        clean["hasDocsOnly"] = has_docs_only

    if isinstance(followup_due_only, bool):
        clean["followupDueOnly"] = followup_due_only

    if isinstance(invoice_scope, str) and invoice_scope in {"tax", "open", "all"}:
        clean["invoiceScope"] = invoice_scope

    if isinstance(period_label, str) and period_label.strip():
        clean["periodLabel"] = period_label.strip()[:120]

    if isinstance(period_from, str) and period_from.strip():
        clean["periodFrom"] = period_from.strip()[:20]

    if isinstance(period_to, str) and period_to.strip():
        clean["periodTo"] = period_to.strip()[:20]

    all_expanded = view_config.get("allExpanded")
    if isinstance(all_expanded, bool):
        clean["allExpanded"] = all_expanded

    return clean or None


def _sanitize_filter_conditions(raw: Any) -> tuple[list[dict[str, Any]], bool]:
    """
    Keep the FilterBuilder rules a live link has to re-apply.

    Returns (conditions, faithful). Incomplete rows are dropped exactly as
    applyConditions skips them. A row the server cannot evaluate the way the
    browser did (unknown operator, non-scalar or overlong value) makes the set
    unfaithful: a live link built on it is refused instead of silently widened.
    """
    if raw is None:
        return [], True
    if not isinstance(raw, list):
        return [], False
    clean: list[dict[str, Any]] = []
    faithful = True
    for cond in raw:
        if not isinstance(cond, dict):
            faithful = False
            continue
        field, op, value = cond.get("field"), cond.get("op"), cond.get("value")
        if _js_falsy(field) or _js_falsy(op):
            continue
        if op not in _FILTER_NO_VALUE_OPS and (value is None or value == ""):
            continue
        if not isinstance(field, str) or len(field) > 120 or op not in _FILTER_CONDITION_OPS:
            faithful = False
            continue
        if op in _FILTER_NO_VALUE_OPS:
            value = ""
        elif not isinstance(value, (str, int, float)) or (isinstance(value, str) and len(value) > 255) \
                or (isinstance(value, float) and not math.isfinite(value)):
            faithful = False
            continue
        clean.append({"field": field, "op": op, "value": value})
    if len(clean) > _MAX_FILTER_CONDITIONS:
        return clean[:_MAX_FILTER_CONDITIONS], False
    return clean, faithful


def _live_unsupported(resource_type: str, cfg: Optional[dict]) -> bool:
    """Whether a live link with this config would show more than the owner's page did."""
    cfg = cfg or {}
    if cfg.get("liveUnsupported"):
        return True
    # The Projects page searches with Teable's full-text search, capped at 20
    # results and ignoring its client/status filters: the server cannot replay it.
    return resource_type == "projects" and bool(str(cfg.get("search") or "").strip())


def _parse_view_config(view: dict) -> Optional[dict]:
    """A stored view's view_config (asyncpg may hand JSONB back as str), sanitised."""
    vc = view.get("view_config")
    if isinstance(vc, str):
        try:
            vc = json.loads(vc)
        except Exception:
            vc = None
    return _sanitize_view_config(vc)


def _public_fields(resource_type: str, vc: Optional[dict], access_mode: str) -> set[str]:
    """Fields a public link may carry: the type's base set, the owner's columns, and its edit fields."""
    allowed = set(_PUBLIC_BASE_FIELDS[resource_type])
    columns = (vc or {}).get("columns") or _PUBLIC_DEFAULT_COLUMNS[resource_type]
    selectable = _PUBLIC_COLUMN_FIELDS[resource_type]
    allowed.update(c for c in columns if c in selectable)
    if access_mode == "edit":
        allowed.update(_PUBLIC_EDIT_FIELDS.get(resource_type, ()))
    return allowed


def _project_public_record(record: dict, allowed: set[str]) -> dict[str, Any]:
    """Only {id, fields}, and only the allowed fields — never the raw Teable record."""
    fields = record.get("fields") or {}
    out = {k: v for k, v in fields.items() if k in allowed}
    if "lastModifiedTime" in allowed and "lastModifiedTime" not in out and record.get("lastModifiedTime"):
        out["lastModifiedTime"] = record["lastModifiedTime"]
    return {"id": record.get("id"), "fields": out}


class SharedViewService:

    # ── Write ─────────────────────────────────────────────────────────────────

    async def create(
        self,
        title: Optional[str],
        record_ids: list[str],
        role: str,
        ip: Optional[str] = None,
        expires_at: Optional[datetime] = None,
        access_mode: str = "read",
        view_config: Optional[dict] = None,
        resource_type: str = "status",
    ) -> dict:
        pool = get_pool()
        if not pool:
            raise RuntimeError("PostgreSQL unavailable — cannot create shared view")
        is_dynamic = record_ids == ["__dynamic__"]
        if not is_dynamic and not record_ids:
            raise ValueError("At least one record_id required")
        if not is_dynamic and len(record_ids) > _MAX_RECORD_IDS:
            raise ValueError(f"Maximum {_MAX_RECORD_IDS} records per share")
        if access_mode not in _ALLOWED_ACCESS_MODES:
            raise ValueError("Invalid access mode")
        if resource_type not in _ALLOWED_RESOURCE_TYPES:
            raise ValueError("Invalid resource type")

        token = _new_token()
        safe_view_config = _sanitize_view_config(view_config)
        if is_dynamic and _live_unsupported(resource_type, safe_view_config):
            raise ValueError(_LIVE_UNSUPPORTED_MESSAGE)
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO shared_views
                    (token, title, record_ids, created_by, created_from_ip, expires_at, access_mode, view_config, resource_type)
                VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8::jsonb, $9)
                RETURNING *
                """,
                token,
                title,
                json.dumps(record_ids),
                role,
                ip,
                expires_at,
                access_mode,
                json.dumps(safe_view_config) if safe_view_config is not None else None,
                resource_type,
            )
        return _row(row)

    async def update(self, token: str, data: dict) -> Optional[dict]:
        pool = get_pool()
        if not pool:
            raise RuntimeError("PostgreSQL unavailable")

        parts: list[str] = []
        params: list = []
        idx = 1

        if "record_ids" in data or "view_config" in data:
            # The link ends up live with these filters: refuse any it cannot re-apply.
            existing = await self.get(token)
            if not existing:
                return None
            if "record_ids" in data:
                ends_dynamic = (data["record_ids"] or []) == ["__dynamic__"]
            else:
                ends_dynamic = bool(existing.get("is_dynamic"))
            if "view_config" in data:
                ends_view_config = _sanitize_view_config(data["view_config"])
            else:
                ends_view_config = _parse_view_config(existing)
            if ends_dynamic and _live_unsupported(existing.get("resource_type") or "status", ends_view_config):
                raise ValueError(_LIVE_UNSUPPORTED_MESSAGE)

        if "record_ids" in data:
            record_ids = data["record_ids"] or []
            is_dynamic = record_ids == ["__dynamic__"]
            if not is_dynamic and not record_ids:
                raise ValueError("At least one record_id required")
            if not is_dynamic and len(record_ids) > _MAX_RECORD_IDS:
                raise ValueError(f"Maximum {_MAX_RECORD_IDS} records per share")
            parts.append(f"record_ids = ${idx}::jsonb")
            params.append(json.dumps(record_ids))
            idx += 1

        if "view_config" in data:
            safe_view_config = _sanitize_view_config(data["view_config"])
            parts.append(f"view_config = ${idx}::jsonb")
            params.append(json.dumps(safe_view_config) if safe_view_config is not None else None)
            idx += 1

        for field in ("title", "is_active", "expires_at", "access_mode"):
            if field in data:
                if field == "access_mode" and data[field] not in _ALLOWED_ACCESS_MODES:
                    raise ValueError("Invalid access mode")
                parts.append(f"{field} = ${idx}")
                params.append(data[field])
                idx += 1

        if not parts:
            return await self.get(token)

        params.append(token)
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                f"UPDATE shared_views SET {', '.join(parts)} WHERE token = ${idx} RETURNING *",
                *params,
            )
        return _row(row) if row else None

    async def delete(self, token: str) -> bool:
        pool = get_pool()
        if not pool:
            raise RuntimeError("PostgreSQL unavailable")
        async with pool.acquire() as conn:
            result = await conn.execute(
                "DELETE FROM shared_views WHERE token = $1", token
            )
        return result != "DELETE 0"

    # ── Read ──────────────────────────────────────────────────────────────────

    async def list_all(self, resource_type: Optional[str] = None) -> list[dict]:
        pool = get_pool()
        if not pool:
            return []
        async with pool.acquire() as conn:
            if resource_type:
                rows = await conn.fetch(
                    "SELECT * FROM shared_views WHERE resource_type = $1 ORDER BY created_at DESC",
                    resource_type,
                )
            else:
                rows = await conn.fetch(
                    "SELECT * FROM shared_views ORDER BY created_at DESC"
                )
        return [_row(r) for r in rows]

    async def get_public_view(self, token: str) -> dict:
        pool = get_pool()
        if not pool:
            raise RuntimeError("Database unavailable")

        async with pool.acquire() as conn:
            view = await conn.fetchrow(
                "SELECT * FROM shared_views WHERE token = $1", token
            )
        if not view:
            raise ValueError("View not found")
        view = _row(view)

        if not view["is_active"]:
            raise ValueError("This link has been disabled by the owner")

        if view["expires_at"]:
            exp = view["expires_at"]
            if isinstance(exp, str):
                exp = datetime.fromisoformat(exp)
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp < datetime.now(timezone.utc):
                raise ValueError("This link has expired")
        return view

    async def get(self, token: str) -> Optional[dict]:
        pool = get_pool()
        if not pool:
            return None
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM shared_views WHERE token = $1", token
            )
        return _row(row) if row else None

    async def get_accesses(self, token: str, limit: int = 200) -> list[dict]:
        pool = get_pool()
        if not pool:
            return []
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT * FROM shared_view_accesses
                WHERE view_token = $1
                ORDER BY accessed_at DESC
                LIMIT $2
                """,
                token, limit,
            )
        return [_row(r) for r in rows]

    async def delete_accesses(self, token: str, access_ids: list[str]) -> int:
        pool = get_pool()
        if not pool or not access_ids:
            return 0
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                DELETE FROM shared_view_accesses
                WHERE view_token = $1
                  AND id = ANY($2::uuid[])
                RETURNING id
                """,
                token,
                access_ids,
            )
        return len(rows)

    # ── Public access ─────────────────────────────────────────────────────────

    async def get_public_data(self, token: str, request) -> dict:
        """
        Public endpoint — no auth required.
        Validates token, checks expiry + active state, fetches records,
        and fires an async access-log task.
        """
        pool = get_pool()
        if not pool:
            raise RuntimeError("Database unavailable")

        view = await self.get_public_view(token)

        resource_type = view.get("resource_type") or "status"
        if resource_type not in _ALLOWED_RESOURCE_TYPES:
            raise ValueError("This link type is no longer supported")

        # Parse record_ids — ["__dynamic__"] means "all records, live from Teable"
        record_ids: list[str] = view.get("record_ids") or []
        if isinstance(record_ids, str):
            record_ids = json.loads(record_ids)

        # Parse view_config early so we can use filters for dynamic fetch
        vc = _parse_view_config(view)

        is_dynamic = record_ids == ["__dynamic__"]
        access_mode = view.get("access_mode") or "read"

        if is_dynamic:
            # Dynamic live view — always fetch directly from Teable so that
            # records added after the link was created appear automatically.
            records = await _fetch_dynamic_records(resource_type, vc)
        else:
            # Fixed snapshot — Teable remains the source of truth.
            records = await _fetch_snapshot_records(resource_type, record_ids)

        # Column choice is not only visual: send just the fields this link shows.
        shared_fields = _public_fields(resource_type, vc, access_mode)
        records = [_project_public_record(r, shared_fields) for r in records]
        public_vc = {k: v for k, v in (vc or {}).items() if k not in _PRIVATE_VIEW_CONFIG_KEYS} or None

        # Log access asynchronously
        ip = _extract_ip(request)
        ua = request.headers.get("user-agent", "")
        referer = (request.headers.get("referer") or request.headers.get("origin") or "")[:500]
        asyncio.create_task(self._log_access(
            token,
            ip,
            ua,
            referer,
            request.headers.get("x-client-hint", ""),
            resource_type=resource_type,
        ))

        return {
            "token": token,
            "title": view.get("title"),
            "created_at": view.get("created_at"),
            "expires_at": view.get("expires_at"),
            "access_mode": access_mode,
            "resource_type": resource_type,
            "is_dynamic": is_dynamic,
            "records": records,
            "total": len(records),
            "view_config": public_vc,
            "shared_fields": sorted(shared_fields),
        }

    async def update_public_record(self, token: str, record_id: str, fields: dict, request=None) -> dict[str, Any]:
        view = await self.get_public_view(token)
        if (view.get("access_mode") or "read") != "edit":
            raise PermissionError("This link is view-only")
        resource_type = view.get("resource_type") or "status"

        record_ids = view.get("record_ids") or []
        if isinstance(record_ids, str):
            record_ids = json.loads(record_ids)
        is_dynamic = record_ids == ["__dynamic__"]
        if not is_dynamic and record_id not in record_ids:
            raise ValueError("Record is not part of this shared view")

        cleaned = _public_edit_fields(resource_type, fields)
        if not cleaned:
            raise ValueError("No editable fields provided")
        vc = _parse_view_config(view)
        # A live link covers only the records its filters match right now.
        if is_dynamic and not await _dynamic_view_contains(resource_type, vc, record_id):
            raise ValueError("Record is not part of this shared view")

        updated = await _live_update_record(resource_type, record_id, cleaned, request)

        try:
            pool = get_pool()
            if pool and isinstance(updated, dict) and updated.get("fields"):
                from ..db.sync import (
                    upsert_record, fields_with_lmt, _extract_invoice, _extract_project, _extract_status,
                )
                source, mirror_table, extractor = {
                    "status": ("status", "status_mirror", _extract_status),
                    "projects": ("projects", "projects_mirror", _extract_project),
                    "invoices": ("invoices", "invoices_mirror", _extract_invoice),
                    "tax-ledger": ("invoices", "invoices_mirror", _extract_invoice),
                }[resource_type]
                await upsert_record(
                    pool=pool,
                    source=source,
                    mirror_table=mirror_table,
                    teable_id=record_id,
                    fields=fields_with_lmt(updated) or {},
                    extractor=extractor,
                )
        except Exception as exc:
            logger.debug("shared view immediate %s mirror upsert failed for %s: %s", resource_type, record_id, exc)

        if request is not None:
            asyncio.create_task(self._log_access(
                token,
                _extract_ip(request),
                request.headers.get("user-agent", ""),
                (request.headers.get("referer") or request.headers.get("origin") or "")[:500],
                request.headers.get("x-client-hint", ""),
                resource_type=resource_type,
                event_type="edit",
                record_id=record_id,
            ))

        # Teable answers a PATCH with the whole record: send back only what this link shows.
        if not isinstance(updated, dict):
            return {"id": record_id, "fields": {}}
        shown = _public_fields(resource_type, vc, "edit")
        return _project_public_record({**updated, "id": updated.get("id") or record_id}, shown)

    # ── Internal ──────────────────────────────────────────────────────────────

    async def get_accesses_stats(self, token: str) -> dict:
        """Aggregated analytics for a single shared link."""
        pool = get_pool()
        if not pool:
            return {}
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT
                    COUNT(*)                                                 AS total_events,
                    COUNT(*) FILTER (WHERE event_type = 'view')             AS page_views,
                    COUNT(*) FILTER (WHERE event_type = 'record_detail')    AS record_details,
                    COUNT(*) FILTER (WHERE event_type = 'attachment_open')  AS attachment_opens,
                    COUNT(*) FILTER (WHERE event_type = 'edit')             AS edits,
                    COUNT(DISTINCT viewer_key)                               AS unique_visitors,
                    MIN(accessed_at)                                         AS first_seen,
                    MAX(accessed_at)                                         AS last_seen
                FROM shared_view_accesses
                WHERE view_token = $1
                """,
                token,
            )
            stats = dict(rows[0]) if rows else {}

            # Location breakdown (top 10)
            loc_rows = await conn.fetch(
                """
                SELECT country, country_code, city, region,
                       COUNT(DISTINCT viewer_key) AS visitors,
                       COUNT(*) AS hits
                FROM shared_view_accesses
                WHERE view_token = $1 AND country IS NOT NULL
                GROUP BY country, country_code, city, region
                ORDER BY visitors DESC, hits DESC
                LIMIT 10
                """,
                token,
            )
            stats["locations"] = [dict(r) for r in loc_rows]

            # Device breakdown
            dev_rows = await conn.fetch(
                """
                SELECT device_type, browser, os,
                       COUNT(DISTINCT viewer_key) AS visitors
                FROM shared_view_accesses
                WHERE view_token = $1
                GROUP BY device_type, browser, os
                ORDER BY visitors DESC
                LIMIT 10
                """,
                token,
            )
            stats["devices"] = [dict(r) for r in dev_rows]

            # Daily timeline (last 14 days)
            day_rows = await conn.fetch(
                """
                SELECT DATE(accessed_at AT TIME ZONE 'UTC') AS day,
                       COUNT(*) FILTER (WHERE event_type = 'view')             AS views,
                       COUNT(*) FILTER (WHERE event_type = 'record_detail')    AS record_details,
                       COUNT(*) FILTER (WHERE event_type = 'attachment_open')  AS attachment_opens,
                       COUNT(*) FILTER (WHERE event_type = 'edit')             AS edits,
                       COUNT(DISTINCT viewer_key)                               AS unique_visitors
                FROM shared_view_accesses
                WHERE view_token = $1
                  AND accessed_at > NOW() - INTERVAL '14 days'
                GROUP BY day
                ORDER BY day
                """,
                token,
            )
            stats["timeline"] = [dict(r) for r in day_rows]

        return {k: (v.isoformat() if hasattr(v, 'isoformat') else v) for k, v in stats.items()
                if k not in ('locations', 'devices', 'timeline')} | {
            'locations': stats.get('locations', []),
            'devices':   stats.get('devices', []),
            'timeline':  [
                {kk: (vv.isoformat() if hasattr(vv, 'isoformat') else vv) for kk, vv in row.items()}
                for row in stats.get('timeline', [])
            ],
        }

    async def _log_access(
        self,
        token: str,
        ip: str,
        user_agent: str,
        referer: Optional[str],
        client_hint: str = "",
        resource_type: str = "status",
        event_type: str = "view",
        record_id: Optional[str] = None,
        meta: Optional[dict] = None,
    ) -> None:
        """Geo-enrich and insert access record; update counter. Fire-and-forget."""
        pool = get_pool()
        if not pool:
            return

        # Try Valkey geo cache
        geo: dict = {}
        try:
            from ..db.valkey import get_client as _vk
            vk = _vk()
            if vk and ip:
                cached = await vk.get(f"geo:{ip}")
                if cached:
                    geo = json.loads(cached)
        except Exception:
            pass

        if not geo:
            try:
                geo = await geo_lookup(ip)
            except Exception:
                geo = {}

        hint = parse_client_hint(client_hint or "")
        browser_geo = hint.get("browserGeo") or {}
        ch = hint.get("ch") or {}
        os_name, browser_name, device_type = parse_ua(user_agent)
        device_label = build_device_label(os_name, browser_name, device_type, hint)
        browser_lat = browser_geo.get("lat") if isinstance(browser_geo.get("lat"), (int, float)) else None
        browser_lon = browser_geo.get("lon") if isinstance(browser_geo.get("lon"), (int, float)) else None
        browser_accuracy = browser_geo.get("accuracyM") if isinstance(browser_geo.get("accuracyM"), (int, float)) else None
        geo_source = "browser" if browser_lat is not None and browser_lon is not None else "ip"
        viewer_key = hashlib.sha256(
            "|".join([
                token,
                ip or "",
                user_agent or "",
                str(device_label or ""),
                str(ch.get("model") or ""),
                resource_type,
            ]).encode("utf-8")
        ).hexdigest()[:96]

        try:
            async with pool.acquire() as conn:
                should_increment = False
                if event_type == "view":
                    seen = await conn.fetchval(
                        """
                        SELECT 1 FROM shared_view_accesses
                        WHERE view_token = $1 AND viewer_key = $2 AND event_type = 'view'
                        LIMIT 1
                        """,
                        token,
                        viewer_key,
                    )
                    should_increment = seen is None
                await conn.execute(
                    """
                    INSERT INTO shared_view_accesses
                        (view_token, event_type, viewer_key, record_id, ip, country, country_code, region, city, isp, lat, lon, timezone,
                         geo_source, accuracy_m, os, browser, device_type, device_label, device_model, platform_version,
                         user_agent, referer, meta)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
                    """,
                    token, event_type, viewer_key, record_id,
                    ip or None,
                    geo.get("country"), geo.get("country_code"), geo.get("region"), geo.get("city"), geo.get("isp"),
                    browser_lat if browser_lat is not None else geo.get("lat"),
                    browser_lon if browser_lon is not None else geo.get("lon"),
                    hint.get("timezone") or geo.get("timezone"),
                    geo_source,
                    int(browser_accuracy) if browser_accuracy is not None else None,
                    os_name or None, browser_name or None, device_type or None,
                    (device_label or "")[:255] or None,
                    ((ch.get("model") or "")[:120] or None),
                    ((ch.get("platformVersion") or "")[:40] or None),
                    (user_agent[:1000] if user_agent else None),
                    referer or None,
                    json.dumps(meta) if meta else None,
                )
                if should_increment:
                    await conn.execute(
                        """
                        UPDATE shared_views
                        SET access_count = access_count + 1, last_accessed_at = NOW()
                        WHERE token = $1
                        """,
                        token,
                    )
                elif event_type == "view":
                    await conn.execute(
                        "UPDATE shared_views SET last_accessed_at = NOW() WHERE token = $1",
                        token,
                    )
        except Exception as exc:
            logger.debug("shared_view_access insert failed: %s", exc)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _extract_ip(request) -> str:
    from ..utils.client_ip import client_ip
    return client_ip(request)


# ── Owner-page filter semantics ───────────────────────────────────────────────
# A live link re-runs the owner's filters on every open, so these mirror the
# browser code that drew the owner's view (each page's filters and search, and
# FilterBuilder.applyConditions) value for value, JavaScript coercions included.
# Where the browser's answer cannot be reproduced, they answer "no match".

_ISO_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
_ISO_INSTANT_RE = re.compile(
    r"\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?"
)
_JS_NUMBER_RE = re.compile(r"[+-]?(?:Infinity|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)")


def _js_falsy(value: Any) -> bool:
    """`!value` in JavaScript, for JSON values ([] and {} are truthy there)."""
    if value is None or value is False or value == "":
        return True
    return isinstance(value, (int, float)) and not isinstance(value, bool) and (value == 0 or value != value)


def _js_string(value: Any) -> str:
    """String(value) for a JSON value, with null as '' (Array.join's rule)."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value != value:
            return "NaN"
        if math.isinf(value):
            return "Infinity" if value > 0 else "-Infinity"
        return str(int(value)) if value.is_integer() and abs(value) < 1e21 else repr(value)
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return ",".join(_js_string(v) for v in value)
    return "[object Object]"


def _js_to_number(value: Any) -> float:
    """Number(value) for a JSON value; NaN where JavaScript gives NaN."""
    if value is None:
        return 0.0
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, list):
        return _js_to_number(_js_string(value))
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return 0.0
        if _JS_NUMBER_RE.fullmatch(text):
            return float(text.replace("Infinity", "inf"))
        if re.fullmatch(r"0[xX][0-9a-fA-F]+", text):
            return float(int(text, 16))
    return math.nan


def _js_instant(value: Any, utc_offset_minutes: Optional[int] = None) -> Optional[datetime]:
    """
    new Date(value) as an aware UTC datetime, for the ISO shapes Teable and
    <input type="date"> produce. Date-only strings are UTC, as in JavaScript; a
    date-time without an offset is the owner's local time, so it needs the
    offset their browser sent. Anything else is None (treated as unparseable).
    """
    if _js_falsy(value):
        return None
    text = _js_string(value).strip()
    if not _ISO_INSTANT_RE.fullmatch(text):
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        return parsed.astimezone(timezone.utc)
    if _ISO_DATE_RE.fullmatch(text):
        return parsed.replace(tzinfo=timezone.utc)
    if utc_offset_minutes is None:
        return None
    return parsed.replace(tzinfo=timezone(timedelta(minutes=utc_offset_minutes))).astimezone(timezone.utc)


def _date_only_value(value: Any) -> str:
    """dateOnlyValue() in invoices/utils.js: the first ten characters, as text."""
    return "" if _js_falsy(value) else _js_string(value)[:10]


def _month_key(value: Any, utc_offset_minutes: Optional[int] = None) -> str:
    """
    monthKey() in invoices/utils.js reads the month in the owner's local time;
    links saved before the offset was sent fall back to the stored text.
    """
    if utc_offset_minutes is None:
        date_only = _date_only_value(value)
        return date_only[:7] if len(date_only) >= 7 else ""
    instant = _js_instant(value, utc_offset_minutes)
    if instant is None:
        return ""
    return (instant + timedelta(minutes=utc_offset_minutes)).strftime("%Y-%m")


def _attachment_count(value: Any) -> int:
    """parseAttachments(cell).length in invoices/utils.js."""
    if _js_falsy(value):
        return 0
    if isinstance(value, list):
        return len(value)
    parts = re.split(r"\s+", _js_string(value))
    return sum(1 for i in range(0, len(parts), 2) if i + 1 < len(parts) and parts[i + 1])


def _effective_aging(fields: dict[str, Any], now: datetime, utc_offset_minutes: Optional[int] = None) -> float:
    """effectiveAging() in invoices/utils.js."""
    status = fields.get("Payment Status")
    if not _js_falsy(status) and status != "Pending":
        return 0
    teable_val = fields.get("Agening (Days)")
    if teable_val is not None and teable_val != "" and _js_to_number(teable_val) > 0:
        return _js_to_number(teable_val)
    raised = _js_instant(fields.get("Raised Date"), utc_offset_minutes)
    if raised is None:
        return 0
    return math.floor((now - raised).total_seconds() / 86400)


def _classify_aging_band(days: float) -> str:
    if days <= 14:
        return "0-14d"
    if days <= 30:
        return "15-30d"
    if days <= 60:
        return "31-60d"
    return "60d+"


def _filter_text(value: Any) -> str:
    """normalizeTextValue() in FilterBuilder.jsx."""
    if value is None:
        return ""
    if isinstance(value, list):
        return " · ".join(t for t in (_filter_text(v) for v in value) if t)
    if isinstance(value, dict):
        return " · ".join(t for t in (_filter_text(v) for v in value.values()) if t)
    return _js_string(value).strip()


def _filter_number(value: Any) -> Optional[float]:
    """normalizeNumberValue() in FilterBuilder.jsx."""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(value) else None
    text = re.sub(r"[^0-9.\-]", "", _filter_text(value))
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def _filter_date(value: Any, utc_offset_minutes: Optional[int]) -> str:
    """normalizeDateValue() in FilterBuilder.jsx: the UTC calendar date."""
    if value is None or value == "":
        return ""
    text = _filter_text(value)
    if not text:
        return ""
    instant = _js_instant(text, utc_offset_minutes)
    if instant is not None:
        return instant.date().isoformat()
    if _ISO_INSTANT_RE.fullmatch(text):
        return ""   # a local date-time with no known offset: refuse to guess
    direct = text[:10]
    return direct if _ISO_DATE_RE.fullmatch(direct) else ""


def _match_condition(raw: Any, op: str, cond_value: Any, utc_offset_minutes: Optional[int]) -> bool:
    """matchCondition() in FilterBuilder.jsx."""
    if op in ("eq", "neq", "gt", "gte", "lt", "lte"):
        left, right = _filter_number(raw), _filter_number(cond_value)
        if left is None or right is None:
            return False
        return {
            "eq": left == right, "neq": left != right, "gt": left > right,
            "gte": left >= right, "lt": left < right, "lte": left <= right,
        }[op]
    if op in ("date_is", "date_is_not", "date_before", "date_after"):
        left, right = _filter_date(raw, utc_offset_minutes), _filter_date(cond_value, utc_offset_minutes)
        if not left or not right:
            return False
        return {
            "date_is": left == right, "date_is_not": left != right,
            "date_before": left < right, "date_after": left > right,
        }[op]
    fv = _filter_text(raw)
    if op == "is_empty":
        return fv == ""
    if op == "is_not_empty":
        return fv != ""
    fv, cv = fv.lower(), _filter_text(cond_value).lower()
    return {
        "is": fv == cv, "is_not": fv != cv, "contains": cv in fv, "not_contains": cv not in fv,
        "starts_with": fv.startswith(cv), "ends_with": fv.endswith(cv),
    }.get(op, False)   # unknown operators are refused at save time; never match one here


def _view_fields(record: dict) -> dict[str, Any]:
    """A record's fields, with Teable's record-level timestamps folded in as the app's mirror does."""
    fields = dict(record.get("fields") or {})
    for key in ("lastModifiedTime", "createdTime"):
        if key not in fields and record.get(key):
            fields[key] = record[key]
    return fields


def _record_matches_view(resource_type: str, cfg: dict, record: dict, now: Optional[datetime] = None) -> bool:
    """
    True when `record` is in the live view `cfg` describes: the filters of the
    page the link was made from (StatusBoard, Projects, Invoices, TaxLedger),
    then the owner's advanced FilterBuilder rules.
    """
    f = _view_fields(record)
    now = now or datetime.now(timezone.utc)
    offset = cfg.get("utcOffsetMinutes")
    filter_client = cfg.get("filterClient")
    filter_status = cfg.get("filterStatus")
    filter_project = cfg.get("filterProject")
    search = cfg.get("search") or ""

    if resource_type == "status":
        if filter_client and f.get("Client") != filter_client:
            return False
        if filter_project and (f.get("Project") or "") != filter_project:
            return False
        if filter_status and (f.get("Status") or "Not started") != filter_status:
            return False
        if search:
            haystack = " ".join(_js_string(f.get(k)) for k in _STATUS_SEARCH_FIELDS).lower()
            if search.lower() not in haystack:
                return False

    elif resource_type == "projects":
        if filter_client and f.get("Client") != filter_client:
            return False
        if filter_project and f.get("Project Name") != filter_project:
            return False
        if filter_status and f.get("Project Status") != filter_status:
            return False
        q = search.strip().lower()
        if q and q not in " ".join(_js_string(f.get(k)) for k in _PROJECT_SEARCH_FIELDS).lower():
            return False

    elif resource_type in ("invoices", "tax-ledger"):
        if filter_status and f.get("Payment Status") != filter_status:
            return False
        if filter_project and f.get("Project") != filter_project:
            return False
        if filter_client and (f.get("Client Name") or f.get("Client")) != filter_client:
            return False
        billing = cfg.get("billingFilter") or "all"
        is_retainer = "retainer" in ("" if _js_falsy(f.get("Category")) else _js_string(f.get("Category"))).lower()
        if (billing == "retainer" and not is_retainer) or (billing == "project" and is_retainer):
            return False
        if cfg.get("filterCategory") and f.get("Category") != cfg["filterCategory"]:
            return False
        if cfg.get("raisedByFilter") and f.get("Raised By") != cfg["raisedByFilter"]:
            return False
        if cfg.get("monthFilter") and _month_key(f.get("Raised Date"), offset) != cfg["monthFilter"]:
            return False
        date_from, date_to = cfg.get("dateFrom"), cfg.get("dateTo")
        if date_from or date_to:
            candidate = _date_only_value(f.get(cfg.get("dateFieldFilter") or "Raised Date"))
            if not candidate or (date_from and candidate < date_from) or (date_to and candidate > date_to):
                return False
        if cfg.get("overdueOnly") is True and not (
            f.get("Payment Status") == "Pending" or _js_to_number(f.get("Outstanding Amount") or 0) > 0
        ):
            return False
        if cfg.get("followupDueOnly") is True:
            followup = _date_only_value(f.get("Next followup"))
            if not followup or followup > now.date().isoformat():
                return False
        if cfg.get("hasDocsOnly") is True and _attachment_count(f.get("Reference")) + _attachment_count(f.get("Invoice PDF")) == 0:
            return False
        if cfg.get("agingBandFilter") and (
            f.get("Payment Status") != "Pending"
            or _classify_aging_band(_effective_aging(f, now, offset)) != cfg["agingBandFilter"]
        ):
            return False

        if resource_type == "tax-ledger":
            # TaxLedger.jsx: the period's INR invoices, minus cancelled ones, in the chosen scope.
            if f.get("Payment Status") == "Cancelled":
                return False
            currency = ("RS" if _js_falsy(f.get("Currency")) else _js_string(f.get("Currency"))).strip().upper()
            if currency not in ("RS", "INR"):
                return False
            period_from, period_to = cfg.get("periodFrom"), cfg.get("periodTo")
            if period_from or period_to:
                raised = _date_only_value(f.get("Raised Date"))
                if not raised or (period_from and raised < period_from) or (period_to and raised > period_to):
                    return False
            status = ("" if _js_falsy(f.get("Payment Status")) else _js_string(f.get("Payment Status"))).strip()
            scope = cfg.get("invoiceScope") or "tax"
            if scope == "tax" and status != "Paid":
                return False
            if scope == "open" and status in ("Paid", "Cancelled"):
                return False
            q = search.strip().lower()
            if q and not any(
                q in ("" if _js_falsy(f.get(k)) else _js_string(f.get(k))).lower() for k in _TAX_SEARCH_FIELDS
            ):
                return False
        else:
            q = search.strip().lower()
            if q and not any(
                q in ("" if _js_falsy(f.get(k)) else _js_string(f.get(k))).lower() for k in _INVOICE_SEARCH_FIELDS
            ):
                return False

    else:
        raise ValueError(f"Unsupported resource type for dynamic view: {resource_type}")

    return all(
        _match_condition(f.get(c["field"]), c["op"], c["value"], offset)
        for c in cfg.get("filterConditions") or []
    )


def _live_service_for(resource_type: str):
    if resource_type == "status":
        from ..services.status import StatusService
        return StatusService()
    if resource_type == "projects":
        from ..services.teable import TeableService
        return TeableService()
    if resource_type == "invoices":
        from ..services.invoice import InvoiceService
        return InvoiceService()
    if resource_type == "tax-ledger":
        from ..services.invoice import InvoiceService
        return InvoiceService()
    raise ValueError("Unsupported resource type")


async def _live_get_record(resource_type: str, service, record_id: str) -> dict[str, Any]:
    if resource_type == "status":
        return await service.get_record(record_id)
    if resource_type == "projects":
        return await service.get_record(record_id)
    if resource_type == "invoices":
        return await service.get_invoice(record_id)
    if resource_type == "tax-ledger":
        return await service.get_invoice(record_id)
    raise ValueError("Unsupported resource type")


def _public_edit_fields(resource_type: str, fields: dict) -> dict[str, Any]:
    if resource_type == "status":
        allowed = {
            "Status": fields.get("Status"),
            "Short Status": fields.get("Short Status"),
            "Current Status (Detailed)": fields.get("Current Status (Detailed)"),
        }
    elif resource_type == "projects":
        allowed = {
            "Client": fields.get("Client"),
            "Project Name": fields.get("Project Name"),
            "Project Status": fields.get("Project Status"),
            "Amount Billed So far": fields.get("Amount Billed So far"),
        }
    elif resource_type == "invoices":
        allowed = {
            "Invoice Number": fields.get("Invoice Number"),
            "Payment Status": fields.get("Payment Status"),
            "Amount Received": fields.get("Amount Received"),
            "Cleared Date": fields.get("Cleared Date"),
            "Remark": fields.get("Remark"),
            "Next followup": fields.get("Next followup"),
        }
        if allowed.get("Payment Status") == "Paid":
            if allowed.get("Amount Received") in (None, "", 0, 0.0):
                raise ValueError("Amount Received is required when Payment Status is Paid")
            if not allowed.get("Cleared Date"):
                raise ValueError("Cleared Date is required when Payment Status is Paid")
    elif resource_type == "tax-ledger":
        allowed = {}
    else:
        raise ValueError("Unsupported resource type")
    return {k: v for k, v in allowed.items() if v is not None}


async def _fetch_dynamic_records(resource_type: str, vc: Optional[dict]) -> list[dict[str, Any]]:
    """
    Fetch ALL live records from Teable for a dynamic shared view, then keep the
    ones the owner's view matches (_record_matches_view) — the same subset the
    owner saw, plus any new records that match the same filters.
    """
    cfg = vc or {}
    if cfg.get("liveUnsupported"):
        # Saved before such filters were refused: show nothing rather than more.
        return []

    if resource_type == "status":
        from ..services.status import StatusService
        records = await StatusService()._list_from_teable(
            client=cfg.get("filterClient") or None,
            project=cfg.get("filterProject") or None,
        )
    elif resource_type == "projects":
        from ..services.teable import TeableService
        records = await TeableService().get_all_records()
    elif resource_type in {"invoices", "tax-ledger"}:
        from ..services.invoice import InvoiceService
        records = await InvoiceService().get_all_invoices()
    else:
        raise ValueError(f"Unsupported resource type for dynamic view: {resource_type}")

    now = datetime.now(timezone.utc)
    return [r for r in records if _record_matches_view(resource_type, cfg, r, now)]


async def _dynamic_view_contains(resource_type: str, vc: Optional[dict], record_id: str) -> bool:
    """Whether a live link's filters match `record_id` right now (fetched fresh, never trusted from the caller)."""
    cfg = vc or {}
    if cfg.get("liveUnsupported"):
        return False
    try:
        record = await _live_get_record(resource_type, _live_service_for(resource_type), record_id)
    except Exception as exc:
        logger.debug("shared view live %s membership fetch failed for %s: %s", resource_type, record_id, exc)
        return False
    if not record or record.get("id") != record_id:
        return False
    return _record_matches_view(resource_type, cfg, record)


async def _fetch_snapshot_records(resource_type: str, record_ids: list[str]) -> list[dict[str, Any]]:
    """Fetch the exact stored record IDs live from Teable, preserving order."""
    if not record_ids:
        return []

    service = _live_service_for(resource_type)
    records: list[dict[str, Any]] = []
    for record_id in record_ids:
        try:
            live = await _live_get_record(resource_type, service, record_id)
        except Exception as exc:
            logger.debug("shared view live %s snapshot fetch failed for %s: %s", resource_type, record_id, exc)
            continue
        if live and live.get("id"):
            records.append({"id": live["id"], "fields": live.get("fields") or {}})
    return records


async def _live_update_record(resource_type: str, record_id: str, cleaned: dict[str, Any], request) -> dict[str, Any]:
    if resource_type == "status":
        from ..services.status import StatusService
        return await StatusService().update_record(record_id, cleaned, request=request, role="shared_edit")
    if resource_type == "projects":
        from ..db.attribution import record_user_attribution
        from ..services.teable import TeableService
        try:
            await record_user_attribution(request, "shared_edit", record_id)
        except Exception:
            pass
        return await TeableService().update_record(record_id, cleaned)
    if resource_type == "invoices":
        from ..db.attribution import record_user_attribution
        from ..services.invoice import InvoiceService
        try:
            await record_user_attribution(request, "shared_edit", record_id)
        except Exception:
            pass
        return await InvoiceService().update_invoice(record_id, cleaned)
    if resource_type == "tax-ledger":
        raise PermissionError("Tax ledger shared views are read-only")
    raise ValueError("Unsupported resource type")
