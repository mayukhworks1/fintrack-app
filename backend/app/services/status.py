"""
StatusService — wraps the Current Status Teable table (tblgdbV6T4Ly9n6YNCU).

Read path:  PostgreSQL mirror (status_mirror) → 1 ms, Valkey-cached
            Falls back to live Teable API when PG is unavailable.

Write path: Always hits Teable directly (source of truth),
            then busts status cache, chat context, and report cache.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Optional

import httpx

from ..config import settings
from ..models import STATUS_TABLE_FIELD_IDS
from ..utils.cache import cache
from ..db.postgres import get_pool

logger = logging.getLogger("fintrack.status")

_TTL_STATUS   = 60   # 1-minute in-process cache
_CHAT_CTX_KEY = "chat:context"
_REPORT_KEY   = "report:executive"


def _bust_all_status_caches() -> None:
    """Bust in-process cache. Also bust Valkey asynchronously."""
    cache.bust(prefix="status:")


async def _bust_valkey_status() -> None:
    """Bust Valkey keys related to status (fire-and-forget)."""
    try:
        from ..db.valkey import get_client as _vk, cache_bust as _cb
        vk = _vk()
        if vk:
            await vk.delete(_CHAT_CTX_KEY)
            await _cb("report:")
            await _cb("status:")
    except Exception:
        pass


class StatusService:
    def __init__(self):
        self.token    = settings.teable_api_token
        self.base_url = settings.teable_base_url.rstrip("/")
        self.table_id = settings.teable_status_table_id

    @property
    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type":  "application/json",
        }

    @property
    def _record_url(self) -> str:
        return f"{self.base_url}/api/table/{self.table_id}/record"

    @property
    def _field_url(self) -> str:
        return f"{self.base_url}/api/table/{self.table_id}/field"

    PICKLIST_FIELDS = ["Status"]

    # ── PG mirror read (fast path) ──────────────────────────────────────────

    async def list_all_from_pg(
        self,
        client: Optional[str] = None,
        project: Optional[str] = None,
    ) -> list[dict[str, Any]] | None:
        """
        Read from PostgreSQL status_mirror.
        Returns None if PG is unavailable or table doesn't exist yet.
        Records are returned in the same shape as Teable: {"id": ..., "fields": {...}}
        """
        pool = get_pool()
        if not pool:
            return None
        try:
            where: list[str] = []
            params: list = []
            idx = 1
            if client:
                where.append(f"client = ${idx}"); params.append(client); idx += 1
            if project:
                where.append(f"project = ${idx}"); params.append(project); idx += 1
            where_sql = ("WHERE " + " AND ".join(where)) if where else ""

            rows = await pool.fetch(
                f"SELECT teable_id, fields::text AS fields FROM status_mirror {where_sql} ORDER BY synced_at DESC",
                *params,
            )
            result = []
            for row in rows:
                try:
                    fields = json.loads(row["fields"]) if isinstance(row["fields"], str) else (row["fields"] or {})
                except Exception:
                    fields = {}
                result.append({"id": row["teable_id"], "fields": fields})
            return result
        except Exception as exc:
            logger.debug("status_mirror PG read failed: %s", exc)
            return None

    # ── Teable API read (fallback) ──────────────────────────────────────────

    async def _get(self, url: str, params: dict) -> dict:
        last_err: Exception | None = None
        for attempt in range(3):
            try:
                async with httpx.AsyncClient() as http:
                    r = await http.get(url, headers=self._headers, params=params, timeout=30)
                    r.raise_for_status()
                    return r.json()
            except (httpx.TimeoutException, httpx.ConnectError) as e:
                last_err = e
                if attempt < 2:
                    await asyncio.sleep(0.5 * (2 ** attempt))
            except httpx.HTTPStatusError:
                raise
        raise last_err or RuntimeError("Request failed after retries")

    async def _list_from_teable(
        self,
        client: Optional[str] = None,
        project: Optional[str] = None,
    ) -> list[dict]:
        all_records: list[dict] = []
        skip, take = 0, 100
        while True:
            params: dict[str, Any] = {"fieldKeyType": "name", "take": take, "skip": skip}
            if client:
                params["filter"] = json.dumps({
                    "conjunction": "and",
                    "filterSet": [
                        {"fieldId": STATUS_TABLE_FIELD_IDS["Client"], "operator": "is", "value": client}
                    ],
                })
            data = await self._get(self._record_url, params)
            batch = data.get("records", [])
            all_records.extend(batch)
            if len(batch) < take:
                break
            skip += take
        if project:
            all_records = [
                r for r in all_records
                if (r.get("fields", {}).get("Project") or "") == project
            ]
        return all_records

    # ── Public read API ─────────────────────────────────────────────────────

    async def list_all(
        self,
        client: Optional[str] = None,
        project: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """
        List status records. Prefers PG mirror, falls back to Teable.
        Result is in-process cached for 1 minute.
        """
        cache_key = f"status:list:{client}:{project}"

        async def _load() -> list[dict]:
            # 1. Try PG mirror (fast)
            pg_result = await self.list_all_from_pg(client=client, project=project)
            if pg_result is not None:
                return pg_result
            # 2. Fallback: live Teable
            logger.debug("status_mirror PG unavailable — falling back to Teable")
            return await self._list_from_teable(client=client, project=project)

        return await cache.get_or_set(cache_key, ttl=_TTL_STATUS, loader=_load)

    async def get_record(self, record_id: str) -> dict[str, Any]:
        async with httpx.AsyncClient() as http:
            r = await http.get(
                f"{self._record_url}/{record_id}",
                headers=self._headers,
                params={"fieldKeyType": "name"},
                timeout=30,
            )
            r.raise_for_status()
            return r.json()

    async def get_picklists(self) -> dict[str, Any]:
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
                        "_choices": choices,
                        "_field": field,
                    }
            return result

        return await cache.get_or_set("status:picklists", ttl=_TTL_STATUS, loader=_load)

    def _field_convert_payload(self, field: dict, updated_choices: list[dict]) -> dict:
        payload = {
            "type": field["type"],
            "name": field["name"],
            "options": {
                **(field.get("options") or {}),
                "choices": updated_choices,
            },
        }
        for key in ("description", "dbFieldName", "lookupOptions", "aiConfig"):
            if key in field:
                payload[key] = field.get(key)
        for key in ("unique", "notNull", "isLookup", "isConditionalLookup"):
            if key in field:
                payload[key] = bool(field.get(key))
        return payload

    async def add_picklist_option(self, field_name: str, new_option: str) -> dict[str, Any]:
        picklists = await self.get_picklists()
        if field_name not in picklists:
            raise ValueError(f"Unknown picklist field: {field_name}")

        meta = picklists[field_name]
        field_id = meta["field_id"]
        field = meta["_field"]
        existing = meta["_choices"]

        if new_option in [c["name"] for c in existing]:
            return {"options": [c["name"] for c in existing]}

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
                        "This Teable token can edit status records but cannot change dropdown schema. "
                        "Adding new status options requires a token with field/schema edit permission."
                    ) from e
                raise

        cache.bust(prefix="status:picklists")
        updated = await self.get_picklists()
        return {"options": updated.get(field_name, {}).get("options", [])}

    # ── Write operations ────────────────────────────────────────────────────

    async def create_record(
        self,
        fields: dict,
        request=None,
        role: Optional[str] = None,
    ) -> dict[str, Any]:
        # Wire attribution so record_history has actor data
        if request and role:
            try:
                from ..db.attribution import record_user_attribution
                # We don't know the teable_id yet — use a placeholder; sync will match by content
                await record_user_attribution(request, role, "__new_status__")
            except Exception:
                pass

        async with httpx.AsyncClient() as http:
            r = await http.post(
                self._record_url,
                headers=self._headers,
                json={"fieldKeyType": "name", "records": [{"fields": fields}]},
                timeout=30,
            )
            r.raise_for_status()
            records = r.json().get("records", [])
            new_record = records[0] if records else r.json()

        # Wire attribution to the actual record ID
        if request and role and new_record.get("id"):
            try:
                from ..db.attribution import record_user_attribution
                await record_user_attribution(request, role, new_record["id"])
            except Exception:
                pass

        _bust_all_status_caches()
        asyncio.create_task(_bust_valkey_status())
        cache.bust(prefix="status:picklists")
        return new_record

    async def update_record(
        self,
        record_id: str,
        fields: dict,
        request=None,
        role: Optional[str] = None,
    ) -> dict[str, Any]:
        if request and role:
            try:
                from ..db.attribution import record_user_attribution
                await record_user_attribution(request, role, record_id)
            except Exception:
                pass

        async with httpx.AsyncClient() as http:
            r = await http.patch(
                f"{self._record_url}/{record_id}",
                headers=self._headers,
                json={"fieldKeyType": "name", "record": {"fields": fields}},
                timeout=30,
            )
            r.raise_for_status()

        _bust_all_status_caches()
        asyncio.create_task(_bust_valkey_status())
        return r.json()

    async def delete_record(
        self,
        record_id: str,
        request=None,
        role: Optional[str] = None,
    ) -> bool:
        if request and role:
            try:
                from ..db.attribution import record_user_attribution
                await record_user_attribution(request, role, record_id)
            except Exception:
                pass

        async with httpx.AsyncClient() as http:
            r = await http.delete(
                f"{self._record_url}/{record_id}",
                headers=self._headers,
                timeout=30,
            )
            r.raise_for_status()

        _bust_all_status_caches()
        asyncio.create_task(_bust_valkey_status())
        return True
