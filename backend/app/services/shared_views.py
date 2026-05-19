"""
SharedViewService — manager share links for status updates.

Create a share → get a short token URL → share with anyone.
Public readers need no auth. Full access tracking (IP/geo/device).
Editor controls: expiry, disable, delete.
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
from datetime import datetime, timezone
from typing import Any, Optional

from ..db.postgres import get_pool

logger = logging.getLogger("fintrack.shared_views")

_MAX_RECORD_IDS = 50


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
    return out


class SharedViewService:

    # ── Write ─────────────────────────────────────────────────────────────────

    async def create(
        self,
        title: Optional[str],
        record_ids: list[str],
        role: str,
        ip: Optional[str] = None,
        expires_at: Optional[datetime] = None,
    ) -> dict:
        pool = get_pool()
        if not pool:
            raise RuntimeError("PostgreSQL unavailable — cannot create shared view")
        if not record_ids:
            raise ValueError("At least one record_id required")
        if len(record_ids) > _MAX_RECORD_IDS:
            raise ValueError(f"Maximum {_MAX_RECORD_IDS} records per share")

        token = _new_token()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO shared_views
                    (token, title, record_ids, created_by, created_from_ip, expires_at)
                VALUES ($1, $2, $3::jsonb, $4, $5, $6)
                RETURNING *
                """,
                token,
                title,
                json.dumps(record_ids),
                role,
                ip,
                expires_at,
            )
        return _row(row)

    async def update(self, token: str, data: dict) -> Optional[dict]:
        pool = get_pool()
        if not pool:
            raise RuntimeError("PostgreSQL unavailable")

        parts: list[str] = []
        params: list = []
        idx = 1
        for field in ("title", "is_active", "expires_at"):
            if field in data:
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

    async def list_all(self) -> list[dict]:
        pool = get_pool()
        if not pool:
            return []
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM shared_views ORDER BY created_at DESC"
            )
        return [_row(r) for r in rows]

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

        # Fetch status records from PG mirror
        record_ids: list[str] = view.get("record_ids") or []
        if isinstance(record_ids, str):
            record_ids = json.loads(record_ids)

        records: list[dict] = []
        if record_ids:
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    """
                    SELECT teable_id, fields::text AS fields
                    FROM status_mirror
                    WHERE teable_id = ANY($1::text[])
                    ORDER BY client, project
                    """,
                    record_ids,
                )
            for row in rows:
                try:
                    fields = json.loads(row["fields"]) if isinstance(row["fields"], str) else (row["fields"] or {})
                except Exception:
                    fields = {}
                records.append({"id": row["teable_id"], "fields": fields})

        # Log access asynchronously
        ip = _extract_ip(request)
        ua = request.headers.get("user-agent", "")
        referer = (request.headers.get("referer") or request.headers.get("origin") or "")[:500]
        asyncio.create_task(self._log_access(token, ip, ua, referer))

        return {
            "token": token,
            "title": view.get("title"),
            "created_at": view.get("created_at"),
            "expires_at": view.get("expires_at"),
            "records": records,
            "total": len(records),
        }

    # ── Internal ──────────────────────────────────────────────────────────────

    async def _log_access(
        self,
        token: str,
        ip: str,
        user_agent: str,
        referer: Optional[str],
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

        os_name, browser_name, device_type = _parse_ua(user_agent)

        try:
            async with pool.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO shared_view_accesses
                        (view_token, ip, country, city, isp, lat, lon, timezone,
                         os, browser, device_type, user_agent, referer)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                    """,
                    token, ip or None,
                    geo.get("country"), geo.get("city"), geo.get("isp"),
                    geo.get("lat"), geo.get("lon"), geo.get("timezone"),
                    os_name or None, browser_name or None, device_type or None,
                    (user_agent[:1000] if user_agent else None),
                    referer or None,
                )
                await conn.execute(
                    """
                    UPDATE shared_views
                    SET access_count = access_count + 1, last_accessed_at = NOW()
                    WHERE token = $1
                    """,
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


def _parse_ua(ua: str) -> tuple[str, str, str]:
    """Lightweight UA parser → (os, browser, device_type)."""
    if not ua:
        return "", "", ""
    u = ua.lower()

    # OS
    if "android" in u:
        os_name, device = "Android", "mobile"
    elif "iphone" in u:
        os_name, device = "iOS", "mobile"
    elif "ipad" in u:
        os_name, device = "iPadOS", "tablet"
    elif "windows" in u:
        os_name, device = "Windows", "desktop"
    elif "mac os" in u or "macintosh" in u:
        os_name, device = "macOS", "desktop"
    elif "linux" in u:
        os_name, device = "Linux", "desktop"
    else:
        os_name, device = "", ""

    # Browser
    if "edg/" in u or "edge/" in u:
        browser = "Edge"
    elif "opr/" in u or "opera" in u:
        browser = "Opera"
    elif "chrome" in u and "safari" in u:
        browser = "Chrome"
    elif "firefox" in u:
        browser = "Firefox"
    elif "safari" in u:
        browser = "Safari"
    else:
        browser = ""

    return os_name, browser, device
