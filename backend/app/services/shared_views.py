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
import secrets
from datetime import datetime, timezone
from typing import Any, Optional

from ..db.audit import build_device_label, parse_client_hint, parse_ua
from ..db.geo import lookup as geo_lookup
from ..db.postgres import get_pool

logger = logging.getLogger("fintrack.shared_views")

_MAX_RECORD_IDS = 50
_ALLOWED_ACCESS_MODES = {"read", "edit"}
_ALLOWED_VIEW_TYPES = {"card", "list", "board"}
_ALLOWED_RESOURCE_TYPES = {"status", "projects", "invoices"}
_ALLOWED_THEMES = {"cobalt", "emerald", "amber", "rose", "slate"}
_ALLOWED_DENSITIES = {"comfortable", "compact"}
_COLUMN_ALIASES = {
    "Detailed Status": "Current Status (Detailed)",
    "Current Status (Detailed)": "Current Status (Detailed)",
}


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
    board_group_by = view_config.get("boardGroupBy")
    card_group_by = view_config.get("cardGroupBy")
    card_group_sort = view_config.get("cardGroupSort")
    card_record_sort = view_config.get("cardRecordSort")
    search = view_config.get("search")
    theme = view_config.get("theme")
    density = view_config.get("density")
    show_dashboard = view_config.get("showDashboard")
    show_client_accents = view_config.get("showClientAccents")

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

    if isinstance(filter_client, str) and filter_client.strip():
        clean["filterClient"] = filter_client.strip()[:255]

    if isinstance(filter_status, str) and filter_status.strip():
        clean["filterStatus"] = filter_status.strip()[:120]

    if isinstance(filter_project, str) and filter_project.strip():
        clean["filterProject"] = filter_project.strip()[:255]

    if isinstance(filter_category, str) and filter_category.strip():
        clean["filterCategory"] = filter_category.strip()[:255]

    if isinstance(board_group_by, str) and board_group_by.strip():
        clean["boardGroupBy"] = board_group_by.strip()[:120]

    if isinstance(card_group_by, str) and card_group_by.strip():
        clean["cardGroupBy"] = card_group_by.strip()[:120]

    if isinstance(card_group_sort, str) and card_group_sort.strip():
        clean["cardGroupSort"] = card_group_sort.strip()[:120]

    if isinstance(card_record_sort, str) and card_record_sort.strip():
        clean["cardRecordSort"] = card_record_sort.strip()[:120]

    if isinstance(search, str) and search.strip():
        clean["search"] = search.strip()[:255]

    if isinstance(theme, str) and theme in _ALLOWED_THEMES:
        clean["theme"] = theme

    if isinstance(density, str) and density in _ALLOWED_DENSITIES:
        clean["density"] = density

    if isinstance(show_dashboard, bool):
        clean["showDashboard"] = show_dashboard

    if isinstance(show_client_accents, bool):
        clean["showClientAccents"] = show_client_accents

    all_expanded = view_config.get("allExpanded")
    if isinstance(all_expanded, bool):
        clean["allExpanded"] = all_expanded

    return clean or None


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
        vc = view.get("view_config")
        if isinstance(vc, str):
            try:
                vc = json.loads(vc)
            except Exception:
                vc = None
        vc = _sanitize_view_config(vc)

        is_dynamic = record_ids == ["__dynamic__"]

        if is_dynamic:
            # Dynamic live view — always fetch directly from Teable so that
            # records added after the link was created appear automatically.
            records = await _fetch_dynamic_records(resource_type, vc)
        else:
            # Fixed snapshot — fetch exactly the stored record IDs.
            mirror_table = {
                "status": "status_mirror",
                "projects": "projects_mirror",
                "invoices": "invoices_mirror",
            }[resource_type]
            record_map: dict[str, dict[str, Any]] = {}
            found_ids: set[str] = set()
            if record_ids:
                async with pool.acquire() as conn:
                    rows = await conn.fetch(
                        """
                        SELECT teable_id, fields::text AS fields
                        FROM """ + mirror_table + """
                        WHERE teable_id = ANY($1::text[])
                        ORDER BY array_position($1::text[], teable_id)
                        """,
                        record_ids,
                    )
                for row in rows:
                    try:
                        fields = json.loads(row["fields"]) if isinstance(row["fields"], str) else (row["fields"] or {})
                    except Exception:
                        fields = {}
                    teable_id = row["teable_id"]
                    found_ids.add(teable_id)
                    record_map[teable_id] = {"id": teable_id, "fields": fields}

            # If the mirror is behind, try the live table for missing records.
            missing_ids = [rid for rid in record_ids if rid not in found_ids]
            if missing_ids:
                try:
                    svc = _live_service_for(resource_type)
                    for rid in missing_ids:
                        try:
                            live = await _live_get_record(resource_type, svc, rid)
                        except Exception:
                            logger.debug("shared view live %s fallback failed for %s", resource_type, rid)
                            continue
                        if live and live.get("id"):
                            record_map[live["id"]] = {"id": live["id"], "fields": live.get("fields") or {}}
                except Exception as exc:
                    logger.debug("shared view live %s fallback unavailable: %s", resource_type, exc)

            # Rebuild in original shared order
            records = [record_map[rid] for rid in record_ids if rid in record_map]

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
            "access_mode": view.get("access_mode") or "read",
            "resource_type": resource_type,
            "is_dynamic": is_dynamic,
            "records": records,
            "total": len(records),
            "view_config": vc,
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

        updated = await _live_update_record(resource_type, record_id, cleaned, request)

        try:
            pool = get_pool()
            if pool and isinstance(updated, dict) and updated.get("fields"):
                from ..db.sync import upsert_record, _extract_invoice, _extract_project, _extract_status
                source, mirror_table, extractor = {
                    "status": ("status", "status_mirror", _extract_status),
                    "projects": ("projects", "projects_mirror", _extract_project),
                    "invoices": ("invoices", "invoices_mirror", _extract_invoice),
                }[resource_type]
                await upsert_record(
                    pool=pool,
                    source=source,
                    mirror_table=mirror_table,
                    teable_id=record_id,
                    fields=updated.get("fields") or {},
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

        return updated

    # ── Internal ──────────────────────────────────────────────────────────────

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
                         user_agent, referer)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
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
    for h in ("cf-connecting-ip", "x-forwarded-for", "x-real-ip"):
        v = request.headers.get(h, "")
        if v:
            return v.split(",")[0].strip()
    return request.client.host if request.client else ""


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
    raise ValueError("Unsupported resource type")


async def _live_get_record(resource_type: str, service, record_id: str) -> dict[str, Any]:
    if resource_type == "status":
        return await service.get_record(record_id)
    if resource_type == "projects":
        return await service.get_record(record_id)
    if resource_type == "invoices":
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
    else:
        raise ValueError("Unsupported resource type")
    return {k: v for k, v in allowed.items() if v is not None}


async def _fetch_dynamic_records(resource_type: str, vc: Optional[dict]) -> list[dict[str, Any]]:
    """
    Fetch ALL live records from Teable for a dynamic shared view, then apply
    the view_config filters (filterClient, filterStatus, filterProject) so the
    link only shows the same subset the owner intended, while automatically
    including any new records that match those filters.
    """
    cfg = vc or {}
    filter_client = cfg.get("filterClient")
    filter_status = cfg.get("filterStatus")
    filter_project = cfg.get("filterProject")
    filter_category = cfg.get("filterCategory")
    search = (cfg.get("search") or "").strip().lower()

    if resource_type == "status":
        from ..services.status import StatusService
        records = await StatusService()._list_from_teable(
            client=filter_client or None,
            project=filter_project or None,
        )
        if filter_status:
            records = [r for r in records if (r.get("fields") or {}).get("Status") == filter_status]
        if search:
            records = [
                r for r in records
                if search in " ".join([
                    str((r.get("fields") or {}).get("Client", "")),
                    str((r.get("fields") or {}).get("Project", "")),
                    str((r.get("fields") or {}).get("Short Status", "")),
                    str((r.get("fields") or {}).get("Current Status (Detailed)", "")),
                    str((r.get("fields") or {}).get("Status", "")),
                ]).lower()
            ]
        return records

    if resource_type == "projects":
        from ..services.teable import TeableService
        records = await TeableService().get_all_records()
        if filter_client:
            records = [r for r in records if (r.get("fields") or {}).get("Client") == filter_client]
        if filter_project:
            records = [r for r in records if (r.get("fields") or {}).get("Project Name") == filter_project]
        if filter_status:
            records = [r for r in records if (r.get("fields") or {}).get("Project Status") == filter_status]
        if search:
            records = [
                r for r in records
                if search in " ".join([
                    str((r.get("fields") or {}).get("Client", "")),
                    str((r.get("fields") or {}).get("Project Name", "")),
                    str((r.get("fields") or {}).get("Project Status", "")),
                    str((r.get("fields") or {}).get("Health", "")),
                ]).lower()
            ]
        return records

    if resource_type == "invoices":
        from ..services.invoice import InvoiceService
        records = await InvoiceService().get_all_invoices()
        if filter_client:
            records = [r for r in records if (r.get("fields") or {}).get("Client") == filter_client]
        if filter_project:
            records = [r for r in records if (r.get("fields") or {}).get("Project") == filter_project]
        if filter_status:
            records = [r for r in records if (r.get("fields") or {}).get("Payment Status") == filter_status]
        if filter_category:
            records = [r for r in records if (r.get("fields") or {}).get("Category") == filter_category]
        if search:
            records = [
                r for r in records
                if search in " ".join([
                    str((r.get("fields") or {}).get("Invoice Number", "")),
                    str((r.get("fields") or {}).get("Project", "")),
                    str((r.get("fields") or {}).get("Category", "")),
                    str((r.get("fields") or {}).get("Remark", "")),
                    str((r.get("fields") or {}).get("Payment Status", "")),
                ]).lower()
            ]
        return records

    raise ValueError(f"Unsupported resource type for dynamic view: {resource_type}")


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
    raise ValueError("Unsupported resource type")
