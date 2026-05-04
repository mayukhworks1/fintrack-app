"""
Web Project Tracker service — tables:
  Web Projects  : tbl4qgQkatguBwrzxtf
  Web Resources : tblMjssDx55GOfLtgqo

Handles CRUD + summary for the Web Project Tracker module.
Accessible only to the "all" role.
"""
import json
from typing import Any, Optional
import httpx
from ..config import settings
from ..utils.cache import cache

# ── Field IDs ────────────────────────────────────────────────────────────────
# Filter/sort must use field IDs, not field names.

WEB_PROJECT_FIELD_IDS: dict[str, str] = {
    # Identity
    "Project Name":           "fldXjISIe8lGTPmdK00",
    "Client":                 "fldOkFQCueCMFryxLDm",
    "Status":                 "fldWtacIjw4AUoXiicx",
    "Priority":               "fldM9D8QOfhWZuqqWWp",
    "Project Lead":           "fldlb1f10F5tM7s2kfO",
    "Tags":                   "fld2SooiQMdsOOjZhzc",
    "Progress %":             "fldecShINcwfe4DhJ8n",
    # Context
    "Description":            "fld11GeONsRbsPuWiAn",
    "Context & Notes":        "fldvYsmSkyysZ5hogcl",
    "Risks & Blockers":       "fldANT9it3OTJgELC3U",
    # Dates
    "Est. Start":             "fldLWvp2Wuc4Mf3F8bx",
    "Est. End":               "fldcTExw2Q8UoIrKrnV",
    "Actual Start":           "fldW7BEFe1rK1qpQbXX",
    "Actual End":             "fldPIE1uuWn2Pmx0MPt",
    # Financial (editable)
    "Estimated Budget":       "fldF8zoFCwa96N5Ze1S",
    "Client Charge":          "fldB6348zP63PPcQhFW",
    # Docs
    "Documents":              "fldESghFoe2dLfrW8yE",
    # Link (managed from resource side)
    "Resources":              "fldZ6LyxQXZRIsN3d7K",
    # READ-ONLY — computed by Teable (rollup / formula / lookup)
    "Total Input Cost":       "fld0EyLEkVxbXcYDV9M",
    "Actual Profit":          "fld2bN4AgRiTszoM90a",
    "Profit Margin %":        "fld958CNUGlr8wJN4eN",
    "Budget Variance":        "fldqA9lxP0up2bS7yQE",
    "Budget Variance %":      "fldKean3sTfB3hc7a6B",
    "Schedule Variance Days": "fldOOS4lb8SkdBoEowc",
    "Resource Names":         "flddomupp7AkgH9l0KH",
}

WEB_RESOURCE_FIELD_IDS: dict[str, str] = {
    "Resource Name":    "fldGziN024fBytTHbxc",
    "Role":             "fldkrQDHgMrfD9DjZG0",
    "Type":             "fldaRgLjZWkR3iV2e5A",
    "Rate ₹":           "fldkqwQErwSdDESQa6q",
    "Rate Unit":        "fldBdHq5RaaGmkZ3vmk",
    "Units":            "fld2EOpGBDHojqJfKAL",
    "Total Cost":       "fldirC8RZ2Gwlqb6mwE",   # READ-ONLY formula
    "Project":          "fldmmbZ14tbD5414oXs",   # link to Web Projects
    "From Date":        "fldelZHMgbnp8f4UE1V",
    "To Date":          "fldIBkYG6Lk9h1ZLb9p",
    "Notes":            "fldWDh80n8lzJl4il7R",
    # ── Fields to be added in Teable (update IDs once created) ─────────
    # Man hours tracking
    "Man Hours":        "",   # Number — actual hours worked; TODO: add field ID after creating in Teable
    "Planned Hours":    "",   # Number — originally estimated hours
    # Revenue / billing
    "Billing Rate (₹)": "",  # Number — rate charged to client per unit
    "Billable Units":   "",   # Number — units billed (may differ from Units)
    "Revenue Generated":"",  # Formula: Billing Rate × Billable Units — READ-ONLY after Teable adds it
    "Resource Margin %":"",  # Formula — READ-ONLY
    "Resource Gross Margin": "",  # Formula — READ-ONLY
    "Project Client Charge": "",  # Lookup — READ-ONLY
    "Revenue Contribution %":"",  # Formula — READ-ONLY
}

# Fields that Teable computes — never send in POST/PATCH
_PROJECT_READ_ONLY = {
    "Total Input Cost", "Actual Profit", "Profit Margin %",
    "Budget Variance", "Budget Variance %", "Schedule Variance Days",
    "Resource Names",
    # New rollups/formulas (once added to Teable):
    "Total Man Hours", "Total Planned Hours", "Total Revenue Generated",
    "Resource Count", "Hours Variance", "Effective Cost Per Hour",
    "Effective Billing Rate Per Hour",
}
_RESOURCE_READ_ONLY = {
    "Total Cost",
    # New formula/lookup fields (once added to Teable):
    "Revenue Generated", "Resource Gross Margin", "Resource Margin %",
    "Project Client Charge", "Revenue Contribution %",
}

_TTL_LIST    = 15
_TTL_ALL     = 30
_TTL_SUMMARY = 30


def _bust_project_cache() -> None:
    cache.bust(prefix="webproj:")


def _bust_resource_cache() -> None:
    cache.bust(prefix="webres:")


def _clean_project_fields(fields: dict) -> dict:
    """Strip read-only and empty fields before sending to Teable."""
    return {
        k: v for k, v in fields.items()
        if k not in _PROJECT_READ_ONLY and v is not None and v != ""
    }


def _clean_resource_fields(fields: dict) -> dict:
    """Strip read-only, empty, and fields whose Teable IDs are not yet configured."""
    # Fields whose IDs are empty strings haven't been created in Teable yet — skip them.
    _no_id_yet = {name for name, fid in WEB_RESOURCE_FIELD_IDS.items() if fid == ""}
    return {
        k: v for k, v in fields.items()
        if k not in _RESOURCE_READ_ONLY
        and k not in _no_id_yet
        and v is not None
        and v != ""
    }


class WebProjectService:
    """CRUD service for the Web Projects Teable table."""

    def __init__(self):
        self.token    = (
            settings.teable_all_api_token
            or settings.teable_web_api_token
            or settings.teable_api_token
        )
        self.base_url = settings.teable_base_url.rstrip("/")
        self.table_id = settings.teable_web_projects_table_id

    @property
    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    @property
    def _record_url(self) -> str:
        return f"{self.base_url}/api/table/{self.table_id}/record"

    # ── List ──────────────────────────────────────────────────────────────

    async def list_projects(
        self,
        status:   Optional[str] = None,
        client:   Optional[str] = None,
        priority: Optional[str] = None,
        limit:    int = 200,
        skip:     int = 0,
        order_by: str = "Project Name",
        order:    str = "asc",
    ) -> dict:
        cache_key = f"webproj:list:{status}:{client}:{priority}:{limit}:{skip}:{order_by}:{order}"

        async def _load():
            params: dict[str, Any] = {
                "fieldKeyType": "name",
                "take": limit,
                "skip": skip,
            }
            filter_set = []
            if status:
                filter_set.append({
                    "fieldId": WEB_PROJECT_FIELD_IDS["Status"],
                    "operator": "is",
                    "value": status,
                })
            if client:
                filter_set.append({
                    "fieldId": WEB_PROJECT_FIELD_IDS["Client"],
                    "operator": "is",
                    "value": client,
                })
            if priority:
                filter_set.append({
                    "fieldId": WEB_PROJECT_FIELD_IDS["Priority"],
                    "operator": "is",
                    "value": priority,
                })
            if filter_set:
                params["filter"] = json.dumps({
                    "conjunction": "and",
                    "filterSet": filter_set,
                })
            field_id = WEB_PROJECT_FIELD_IDS.get(order_by, WEB_PROJECT_FIELD_IDS["Project Name"])
            params["orderBy"] = json.dumps([{"fieldId": field_id, "order": order}])

            async with httpx.AsyncClient(timeout=20) as client_:
                res = await client_.get(self._record_url, params=params, headers=self._headers)
                res.raise_for_status()
                data = res.json()
            return {"records": data.get("records", []), "total": data.get("total", 0)}

        return await cache.get_or_set(cache_key, ttl=_TTL_LIST, loader=_load)

    # ── Get one ───────────────────────────────────────────────────────────

    async def get_project(self, record_id: str) -> dict:
        url = f"{self._record_url}/{record_id}?fieldKeyType=name"
        async with httpx.AsyncClient(timeout=10) as client_:
            res = await client_.get(url, headers=self._headers)
            res.raise_for_status()
            return res.json()

    # ── Create ────────────────────────────────────────────────────────────

    async def create_project(self, fields: dict) -> dict:
        body = {
            "fieldKeyType": "name",
            "records": [{"fields": _clean_project_fields(fields)}],
        }
        async with httpx.AsyncClient(timeout=15) as client_:
            res = await client_.post(self._record_url, json=body, headers=self._headers)
            res.raise_for_status()
        _bust_project_cache()
        data = res.json()
        return data.get("records", [{}])[0]

    # ── Update ────────────────────────────────────────────────────────────

    async def update_project(self, record_id: str, fields: dict) -> dict:
        url  = f"{self._record_url}/{record_id}"
        body = {
            "fieldKeyType": "name",
            "record": {"fields": _clean_project_fields(fields)},
        }
        async with httpx.AsyncClient(timeout=15) as client_:
            res = await client_.patch(url, json=body, headers=self._headers)
            res.raise_for_status()
        _bust_project_cache()
        return res.json()

    # ── Delete ────────────────────────────────────────────────────────────

    async def delete_project(self, record_id: str) -> None:
        url = f"{self._record_url}/{record_id}"
        async with httpx.AsyncClient(timeout=10) as client_:
            res = await client_.delete(url, headers=self._headers)
            res.raise_for_status()
        _bust_project_cache()
        _bust_resource_cache()   # resources for this project are now orphaned

    # ── Summary ───────────────────────────────────────────────────────────

    async def get_summary(self) -> dict:
        async def _load():
            # Fetch all projects (no pagination needed for summary)
            params = {
                "fieldKeyType": "name",
                "take": 1000,
                "skip": 0,
            }
            async with httpx.AsyncClient(timeout=20) as client_:
                res = await client_.get(self._record_url, params=params, headers=self._headers)
                res.raise_for_status()
                records = res.json().get("records", [])

            total         = len(records)
            by_status: dict[str, int] = {}
            by_priority: dict[str, int] = {}
            total_client_charge = 0.0
            total_input_cost    = 0.0
            total_actual_profit = 0.0
            active_count = 0

            for r in records:
                f = r.get("fields", {})
                status   = f.get("Status", "Unknown")
                priority = f.get("Priority", "Unknown")
                by_status[status]     = by_status.get(status, 0) + 1
                by_priority[priority] = by_priority.get(priority, 0) + 1

                charge = float(f.get("Client Charge") or 0)
                cost   = float(f.get("Total Input Cost") or 0)
                profit = float(f.get("Actual Profit") or 0)
                total_client_charge += charge
                total_input_cost    += cost
                total_actual_profit += profit

                if status in ("Active", "🟢 Active"):
                    active_count += 1

            overall_margin = (
                round(total_actual_profit / total_client_charge * 100, 1)
                if total_client_charge > 0 else 0.0
            )

            return {
                "total_projects":        total,
                "active_projects":       active_count,
                "by_status":             by_status,
                "by_priority":           by_priority,
                "total_client_charge":   round(total_client_charge, 2),
                "total_input_cost":      round(total_input_cost, 2),
                "total_actual_profit":   round(total_actual_profit, 2),
                "overall_margin_pct":    overall_margin,
            }

        return await cache.get_or_set("webproj:summary", ttl=_TTL_SUMMARY, loader=_load)


class WebResourceService:
    """CRUD service for the Web Resources Teable table."""

    def __init__(self):
        self.token    = (
            settings.teable_all_api_token
            or settings.teable_web_api_token
            or settings.teable_api_token
        )
        self.base_url = settings.teable_base_url.rstrip("/")
        self.table_id = settings.teable_web_resources_table_id

    @property
    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    @property
    def _record_url(self) -> str:
        return f"{self.base_url}/api/table/{self.table_id}/record"

    # ── List resources for a project ─────────────────────────────────────

    async def list_resources(self, project_id: str) -> dict:
        cache_key = f"webres:proj:{project_id}"

        async def _load():
            params: dict[str, Any] = {
                "fieldKeyType": "name",
                "take": 500,
                "skip": 0,
                "filter": json.dumps({
                    "conjunction": "and",
                    "filterSet": [{
                        "fieldId": WEB_RESOURCE_FIELD_IDS["Project"],
                        "operator": "contains",
                        "value": project_id,
                    }],
                }),
            }
            async with httpx.AsyncClient(timeout=20) as client_:
                res = await client_.get(self._record_url, params=params, headers=self._headers)
                res.raise_for_status()
                data = res.json()
            return {"records": data.get("records", []), "total": data.get("total", 0)}

        return await cache.get_or_set(cache_key, ttl=_TTL_LIST, loader=_load)

    # ── Get one ───────────────────────────────────────────────────────────

    async def get_resource(self, record_id: str) -> dict:
        url = f"{self._record_url}/{record_id}?fieldKeyType=name"
        async with httpx.AsyncClient(timeout=10) as client_:
            res = await client_.get(url, headers=self._headers)
            res.raise_for_status()
            return res.json()

    # ── Create ────────────────────────────────────────────────────────────

    async def create_resource(self, fields: dict) -> dict:
        """
        `fields` should include a "project_id" key at the top level —
        the service converts it to the Teable link field format before sending.
        """
        project_id = fields.pop("project_id", None)
        teable_fields = _clean_resource_fields(fields)
        if project_id:
            teable_fields["Project"] = [{"id": project_id}]

        body = {
            "fieldKeyType": "name",
            "records": [{"fields": teable_fields}],
        }
        async with httpx.AsyncClient(timeout=15) as client_:
            res = await client_.post(self._record_url, json=body, headers=self._headers)
            res.raise_for_status()
        _bust_resource_cache()
        _bust_project_cache()   # resource count / rollups changed
        data = res.json()
        return data.get("records", [{}])[0]

    # ── Update ────────────────────────────────────────────────────────────

    async def update_resource(self, record_id: str, fields: dict) -> dict:
        project_id = fields.pop("project_id", None)
        teable_fields = _clean_resource_fields(fields)
        if project_id:
            teable_fields["Project"] = [{"id": project_id}]

        url  = f"{self._record_url}/{record_id}"
        body = {
            "fieldKeyType": "name",
            "record": {"fields": teable_fields},
        }
        async with httpx.AsyncClient(timeout=15) as client_:
            res = await client_.patch(url, json=body, headers=self._headers)
            res.raise_for_status()
        _bust_resource_cache()
        _bust_project_cache()
        return res.json()

    # ── Delete ────────────────────────────────────────────────────────────

    async def delete_resource(self, record_id: str) -> None:
        url = f"{self._record_url}/{record_id}"
        async with httpx.AsyncClient(timeout=10) as client_:
            res = await client_.delete(url, headers=self._headers)
            res.raise_for_status()
        _bust_resource_cache()
        _bust_project_cache()
