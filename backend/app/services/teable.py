from __future__ import annotations

import json
import logging
from typing import Any, Optional
import httpx
from ..config import settings
from ..models import FIELD_IDS
from ..utils.cache import cache
from ..db.postgres import get_pool

# ── TTL config (seconds) — keys are namespaced "project:" in the shared cache ──
_TTL_SUMMARY = 30   # summary recalculated at most every 30s
_TTL_RECORDS = 15   # record lists cached for 15s

logger = logging.getLogger("fintrack.projects")


def _bust_project_cache() -> None:
    """Invalidate every cached project entry after a write."""
    cache.bust(prefix="project:")


class TeableService:
    def __init__(self):
        self.token    = settings.teable_api_token
        self.base_url = settings.teable_base_url.rstrip("/")
        self.table_id = settings.teable_table_id

    @property
    def _headers(self):
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    @property
    def _record_url(self):
        return f"{self.base_url}/api/table/{self.table_id}/record"

    def _build_filter(self, status: Optional[str] = None, client: Optional[str] = None) -> Optional[dict]:
        filter_set = []
        if status:
            filter_set.append({"fieldId": FIELD_IDS["Project Status"], "operator": "is", "value": status})
        if client:
            filter_set.append({"fieldId": FIELD_IDS["Client"], "operator": "is", "value": client})
        if not filter_set:
            return None
        return {"conjunction": "and", "filterSet": filter_set}

    async def list_records_from_pg(
        self,
        status: Optional[str] = None,
        client: Optional[str] = None,
        order_by_field: Optional[str] = None,
        order_dir: str = "desc",
        take: int = 100,
        skip: int = 0,
    ) -> list[dict[str, Any]] | None:
        pool = get_pool()
        if not pool:
            return None
        try:
            where: list[str] = []
            params: list[Any] = []
            idx = 1
            if status:
                where.append(f"status = ${idx}")
                params.append(status)
                idx += 1
            if client:
                where.append(f"client = ${idx}")
                params.append(client)
                idx += 1

            where_sql = ("WHERE " + " AND ".join(where)) if where else ""
            sort_map = {
                "Amount Billed So far": "amount_billed",
                "Profit percentage": "profit_pct",
                "Project Name": "project_name",
                "Modified Time": "modified_time",
            }
            if order_by_field == "Target Revenue":
                order_sql = f"ORDER BY COALESCE(NULLIF(fields->>'Target Revenue', '')::numeric, 0) {order_dir.upper()}, synced_at DESC"
            else:
                sort_col = sort_map.get(order_by_field or "", "synced_at")
                order_sql = f"ORDER BY {sort_col} {order_dir.upper()} NULLS LAST, synced_at DESC"

            rows = await pool.fetch(
                f"""
                SELECT teable_id, fields
                FROM projects_mirror
                {where_sql}
                {order_sql}
                LIMIT ${idx} OFFSET ${idx+1}
                """,
                *params, take, skip,
            )
            out: list[dict[str, Any]] = []
            for row in rows:
                fields = row["fields"] if isinstance(row["fields"], dict) else json.loads(row["fields"] or "{}")
                out.append({"id": row["teable_id"], "fields": fields or {}})
            return out
        except Exception as exc:
            logger.debug("projects_mirror PG list failed: %s", exc)
            return None

    def _compute_summary(self, records: list[dict[str, Any]]) -> dict:
        total = len(records)
        total_billed = total_profit = total_input_cost = total_overhead = 0.0
        profit_pcts: list[float] = []
        status_counts: dict[str, int] = {}
        client_counts: dict[str, int] = {}
        health_counts: dict[str, int] = {}
        client_billed: dict[str, float] = {}
        client_profit: dict[str, float] = {}
        target_achieved = 0
        best_rec  = {"name": None, "pct": None}
        worst_rec = {"name": None, "pct": None}

        for r in records:
            f = r.get("fields", {})
            billed   = float(f.get("Amount Billed So far") or 0)
            profit   = float(f.get("Actual Profit") or 0)
            inp_cost = float(f.get("Input cost so far") or 0)
            overhead = float(f.get("Total Overhead Cost") or 0)

            total_billed     += billed
            total_profit     += profit
            total_input_cost += inp_cost
            total_overhead   += overhead

            pct = f.get("Profit percentage")
            if pct is not None:
                try:
                    pct_f = float(pct)
                    profit_pcts.append(pct_f)
                    label = f"{f.get('Client', '?')} / {f.get('Project Name', '?')}"
                    if best_rec["pct"] is None or pct_f > best_rec["pct"]:
                        best_rec = {"name": label, "pct": round(pct_f, 2)}
                    if worst_rec["pct"] is None or pct_f < worst_rec["pct"]:
                        worst_rec = {"name": label, "pct": round(pct_f, 2)}
                except (TypeError, ValueError):
                    pass

            st = f.get("Project Status") or "Unknown"
            status_counts[st] = status_counts.get(st, 0) + 1
            cl = f.get("Client") or "Unknown"
            client_counts[cl] = client_counts.get(cl, 0) + 1
            client_billed[cl] = client_billed.get(cl, 0.0) + billed
            client_profit[cl] = client_profit.get(cl, 0.0) + profit
            h = f.get("Health") or "Unknown"
            health_counts[h] = health_counts.get(h, 0) + 1
            if f.get("Target Achieved "):
                target_achieved += 1

        avg_profit_pct = sum(profit_pcts) / len(profit_pcts) if profit_pcts else 0
        at_risk = []
        for r in records:
            f = r.get("fields", {})
            pct_v = float(f.get("Profit percentage") or 0)
            health = f.get("Health") or ""
            if pct_v < 0 or "🔴" in health:
                at_risk.append({
                    "name":   f"{f.get('Client', '?')} / {f.get('Project Name', '?')}",
                    "pct":    round(pct_v, 2),
                    "health": health,
                    "status": f.get("Project Status", ""),
                })

        return {
            "total_projects":        total,
            "total_billed":          round(total_billed, 2),
            "total_profit":          round(total_profit, 2),
            "total_input_cost":      round(total_input_cost, 2),
            "total_overhead":        round(total_overhead, 2),
            "total_cost":            round(total_input_cost + total_overhead, 2),
            "avg_profit_pct":        round(avg_profit_pct, 2),
            "target_achieved_count": target_achieved,
            "by_status":             status_counts,
            "by_client":             client_counts,
            "by_health":             health_counts,
            "client_billed":         {k: round(v, 2) for k, v in client_billed.items()},
            "client_profit":         {k: round(v, 2) for k, v in client_profit.items()},
            "best_project":          best_rec,
            "worst_project":         worst_rec,
            "at_risk":               at_risk,
        }

    async def get_summary_from_pg(self) -> dict | None:
        pool = get_pool()
        if not pool:
            return None
        try:
            rows = await pool.fetch("SELECT fields FROM projects_mirror")
            records = []
            for row in rows:
                fields = row["fields"] if isinstance(row["fields"], dict) else json.loads(row["fields"] or "{}")
                records.append({"fields": fields or {}})
            return self._compute_summary(records)
        except Exception as exc:
            logger.debug("projects_mirror PG summary failed: %s", exc)
            return None

    async def _get(self, url: str, params: dict) -> dict:
        """GET with retry (up to 3 attempts, exponential back-off)."""
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
                    await _async_sleep(0.5 * (2 ** attempt))
            except httpx.HTTPStatusError as e:
                raise  # don't retry 4xx
        raise last_err or RuntimeError("Request failed after retries")

    async def list_records(
        self,
        status: Optional[str] = None,
        client: Optional[str] = None,
        order_by_field: Optional[str] = None,
        order_dir: str = "desc",
        take: int = 100,
        skip: int = 0,
    ) -> list[dict[str, Any]]:
        cache_key = f"project:list:{status}:{client}:{order_by_field}:{order_dir}:{take}:{skip}"

        async def _load():
            params: dict[str, Any] = {"fieldKeyType": "name", "take": take, "skip": skip}
            f = self._build_filter(status=status, client=client)
            if f:
                params["filter"] = json.dumps(f)
            if order_by_field and order_by_field in FIELD_IDS:
                params["orderBy"] = json.dumps([{"fieldId": FIELD_IDS[order_by_field], "order": order_dir}])
            data = await self._get(self._record_url, params)
            return data.get("records", [])

        return await cache.get_or_set(cache_key, ttl=_TTL_RECORDS, loader=_load)

    async def get_record(self, record_id: str) -> dict[str, Any]:
        pool = get_pool()
        if pool:
            try:
                row = await pool.fetchrow(
                    "SELECT teable_id, fields FROM projects_mirror WHERE teable_id = $1",
                    record_id,
                )
                if row:
                    fields = row["fields"] if isinstance(row["fields"], dict) else json.loads(row["fields"] or "{}")
                    return {"id": row["teable_id"], "fields": fields or {}}
            except Exception as exc:
                logger.debug("projects_mirror PG get failed: %s", exc)
        async with httpx.AsyncClient() as http:
            r = await http.get(
                f"{self._record_url}/{record_id}",
                headers=self._headers,
                params={"fieldKeyType": "name"},
                timeout=30,
            )
            r.raise_for_status()
            return r.json()

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
            _bust_project_cache()
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
            _bust_project_cache()
            return r.json()

    async def delete_record(self, record_id: str) -> bool:
        async with httpx.AsyncClient() as http:
            r = await http.delete(f"{self._record_url}/{record_id}", headers=self._headers, timeout=30)
            r.raise_for_status()
            _bust_project_cache()
            return True

    async def search_records(self, query: str, take: int = 20) -> list[dict[str, Any]]:
        async with httpx.AsyncClient() as http:
            r = await http.get(
                self._record_url,
                headers=self._headers,
                params={"fieldKeyType": "name", "search": query, "take": take},
                timeout=30,
            )
            r.raise_for_status()
            return r.json().get("records", [])

    async def get_all_records(self) -> list[dict[str, Any]]:
        all_records, skip, take = [], 0, 100
        while True:
            batch = await self.list_records(take=take, skip=skip)
            all_records.extend(batch)
            if len(batch) < take:
                break
            skip += take
        return all_records

    async def get_summary(self) -> dict:
        cached = cache.get("project:summary")
        if cached is not None:
            return cached

        records = await self.get_all_records()
        result = self._compute_summary(records)
        cache.set("project:summary", result, ttl=_TTL_SUMMARY)
        return result


# ── tiny async sleep helper ────────────────────────────────────────────────
import asyncio

async def _async_sleep(seconds: float) -> None:
    await asyncio.sleep(seconds)
