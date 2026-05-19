"""
StatusService — wraps the Current Status Teable table (tblgdbV6T4Ly9n6YNCU).

Fields
------
  Client                    — Single select (primary field)
  Project                   — Single select
  Current Status (Detailed) — Long text / Rich text
  Short Status              — Single line text
"""

from __future__ import annotations

import asyncio
from typing import Any, Optional

import httpx

from ..config import settings
from ..models import STATUS_TABLE_FIELD_IDS
from ..utils.cache import cache

_TTL_STATUS = 60  # 1-minute cache — status updates are frequent


def _bust_status_cache() -> None:
    cache.bust(prefix="status:")


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

    # ── internal GET with retry ─────────────────────────────────────────────

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

    # ── read operations ─────────────────────────────────────────────────────

    async def list_all(self, client: Optional[str] = None, project: Optional[str] = None) -> list[dict[str, Any]]:
        """Fetch all status records, optionally filtered by client or project."""
        cache_key = f"status:list:{client}:{project}"

        async def _load() -> list[dict]:
            all_records: list[dict] = []
            skip, take = 0, 100
            while True:
                params: dict[str, Any] = {"fieldKeyType": "name", "take": take, "skip": skip}
                # Optional client filter
                if client:
                    import json
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
            # Client-side project filter if needed (single-select, filtering by name)
            if project:
                all_records = [
                    r for r in all_records
                    if (r.get("fields", {}).get("Project") or "") == project
                ]
            return all_records

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

    # ── write operations ────────────────────────────────────────────────────

    async def create_record(self, fields: dict) -> dict[str, Any]:
        async with httpx.AsyncClient() as http:
            r = await http.post(
                self._record_url,
                headers=self._headers,
                json={"fieldKeyType": "name", "records": [{"fields": fields}]},
                timeout=30,
            )
            r.raise_for_status()
            records = r.json().get("records", [])
            _bust_status_cache()
            return records[0] if records else r.json()

    async def update_record(self, record_id: str, fields: dict) -> dict[str, Any]:
        async with httpx.AsyncClient() as http:
            r = await http.patch(
                f"{self._record_url}/{record_id}",
                headers=self._headers,
                json={"fieldKeyType": "name", "record": {"fields": fields}},
                timeout=30,
            )
            r.raise_for_status()
            _bust_status_cache()
            return r.json()

    async def delete_record(self, record_id: str) -> bool:
        async with httpx.AsyncClient() as http:
            r = await http.delete(
                f"{self._record_url}/{record_id}",
                headers=self._headers,
                timeout=30,
            )
            r.raise_for_status()
            _bust_status_cache()
            return True
