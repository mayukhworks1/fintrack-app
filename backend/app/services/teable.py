import json
from typing import Any, Optional
import httpx
from ..config import settings
from ..models import FIELD_IDS


class TeableService:
    def __init__(self):
        self.token = settings.teable_api_token
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

    async def list_records(
        self,
        status: Optional[str] = None,
        client: Optional[str] = None,
        order_by_field: Optional[str] = None,
        order_dir: str = "desc",
        take: int = 100,
        skip: int = 0,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"fieldKeyType": "name", "take": take, "skip": skip}
        f = self._build_filter(status=status, client=client)
        if f:
            params["filter"] = json.dumps(f)
        if order_by_field and order_by_field in FIELD_IDS:
            params["orderBy"] = json.dumps([{"fieldId": FIELD_IDS[order_by_field], "order": order_dir}])
        async with httpx.AsyncClient() as http:
            r = await http.get(self._record_url, headers=self._headers, params=params, timeout=30)
            r.raise_for_status()
            return r.json().get("records", [])

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
            return r.json()

    async def delete_record(self, record_id: str) -> bool:
        async with httpx.AsyncClient() as http:
            r = await http.delete(f"{self._record_url}/{record_id}", headers=self._headers, timeout=30)
            r.raise_for_status()
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
        records = await self.get_all_records()
        total = len(records)
        total_billed = total_profit = 0.0
        profit_pcts, status_counts, client_counts, health_counts = [], {}, {}, {}
        target_achieved = 0

        for r in records:
            f = r.get("fields", {})
            total_billed += float(f.get("Amount Billed So far") or 0)
            total_profit += float(f.get("Actual Profit") or 0)
            pct = f.get("Profit percentage")
            if pct is not None:
                try:
                    profit_pcts.append(float(pct))
                except (TypeError, ValueError):
                    pass
            st = f.get("Project Status") or "Unknown"
            status_counts[st] = status_counts.get(st, 0) + 1
            cl = f.get("Client") or "Unknown"
            client_counts[cl] = client_counts.get(cl, 0) + 1
            h = f.get("Health") or "Unknown"
            health_counts[h] = health_counts.get(h, 0) + 1
            if f.get("Target Achieved "):
                target_achieved += 1

        return {
            "total_projects": total,
            "total_billed": total_billed,
            "total_profit": total_profit,
            "avg_profit_pct": sum(profit_pcts) / len(profit_pcts) if profit_pcts else 0,
            "target_achieved_count": target_achieved,
            "by_status": status_counts,
            "by_client": client_counts,
            "by_health": health_counts,
        }
