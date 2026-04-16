import json
from typing import Any, Optional
import httpx
from ..config import settings
from ..models import FIELD_IDS


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

        total_billed = total_profit = total_input_cost = total_overhead = 0.0
        profit_pcts, status_counts, client_counts, health_counts = [], {}, {}, {}
        target_achieved = 0

        # Per-client financials
        client_billed: dict[str, float]  = {}
        client_profit: dict[str, float]  = {}

        best_rec  = {"name": None, "pct": None}
        worst_rec = {"name": None, "pct": None}

        for r in records:
            f = r.get("fields", {})

            billed   = float(f.get("Amount Billed So far") or 0)
            profit   = float(f.get("Actual Profit") or 0)
            inp_cost = float(f.get("Input cost so far") or 0)
            overhead = float(f.get("Total Overhead Cost") or 0)

            total_billed      += billed
            total_profit      += profit
            total_input_cost  += inp_cost
            total_overhead    += overhead

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
            client_counts[cl]  = client_counts.get(cl, 0) + 1
            client_billed[cl]  = client_billed.get(cl, 0.0)  + billed
            client_profit[cl]  = client_profit.get(cl, 0.0)  + profit

            h = f.get("Health") or "Unknown"
            health_counts[h] = health_counts.get(h, 0) + 1

            if f.get("Target Achieved "):
                target_achieved += 1

        avg_profit_pct = sum(profit_pcts) / len(profit_pcts) if profit_pcts else 0

        # Projects at risk: negative profit OR health contains 🔴
        at_risk = []
        for r in records:
            f = r.get("fields", {})
            pct = float(f.get("Profit percentage") or 0)
            health = f.get("Health") or ""
            if pct < 0 or "🔴" in health:
                at_risk.append({
                    "name":   f"{f.get('Client', '?')} / {f.get('Project Name', '?')}",
                    "pct":    round(pct, 2),
                    "health": health,
                    "status": f.get("Project Status", ""),
                })

        return {
            "total_projects":       total,
            "total_billed":         round(total_billed, 2),
            "total_profit":         round(total_profit, 2),
            "total_input_cost":     round(total_input_cost, 2),
            "total_overhead":       round(total_overhead, 2),
            "total_cost":           round(total_input_cost + total_overhead, 2),
            "avg_profit_pct":       round(avg_profit_pct, 2),
            "target_achieved_count": target_achieved,
            "by_status":            status_counts,
            "by_client":            client_counts,
            "by_health":            health_counts,
            "client_billed":        {k: round(v, 2) for k, v in client_billed.items()},
            "client_profit":        {k: round(v, 2) for k, v in client_profit.items()},
            "best_project":         best_rec,
            "worst_project":        worst_rec,
            "at_risk":              at_risk,
        }
