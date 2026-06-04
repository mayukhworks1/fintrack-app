"""
Web Project Tracker service — tables:
  Web Projects  : tbl4qgQkatguBwrzxtf
  Web Resources : tblMjssDx55GOfLtgqo

Handles CRUD + summary for the Web Project Tracker module.
Accessible only to the "all" role.
"""
import asyncio
import json
from typing import Any, Optional
import httpx
from ..config import settings
from ..utils.cache import cache

# ── Field IDs ────────────────────────────────────────────────────────────────
# Filter/sort must use field IDs, not field names.

WEB_PROJECT_FIELD_IDS: dict[str, str] = {
    # Identity
    "Project Name":                    "fldXjISIe8lGTPmdK00",
    "Client":                          "fldOkFQCueCMFryxLDm",
    "Status":                          "fldWtacIjw4AUoXiicx",
    "Priority":                        "fldM9D8QOfhWZuqqWWp",
    "Project Lead":                    "fldlb1f10F5tM7s2kfO",
    "Tags":                            "fld2SooiQMdsOOjZhzc",
    "Progress (%)":                     "fldecShINcwfe4DhJ8n",
    # Context
    "Description":                     "fld11GeONsRbsPuWiAn",
    "Context & Notes":                 "fldvYsmSkyysZ5hogcl",
    "Risks & Blockers":                "fldANT9it3OTJgELC3U",
    # Dates — actual Teable field names include "Date" suffix
    "Est. Start Date":                 "fldLWvp2Wuc4Mf3F8bx",
    "Est. End Date":                   "fldcTExw2Q8UoIrKrnV",
    "Actual Start Date":               "fldW7BEFe1rK1qpQbXX",
    "Actual End Date":                 "fldPIE1uuWn2Pmx0MPt",
    # Financial (editable)
    "Estimated Budget":                "fldF8zoFCwa96N5Ze1S",
    "Client Charge":                   "fldB6348zP63PPcQhFW",
    # Docs
    "Documents":                       "fldESghFoe2dLfrW8yE",
    # Link (managed from resource side)
    "Resources":                       "fldZ6LyxQXZRIsN3d7K",
    # READ-ONLY — original computed fields
    "Total Input Cost":                "fld0EyLEkVxbXcYDV9M",
    "Actual Profit":                   "fld2bN4AgRiTszoM90a",
    "Profit Margin %":                 "fld958CNUGlr8wJN4eN",
    "Budget Variance":                 "fldqA9lxP0up2bS7yQE",
    "Budget Variance %":               "fldKean3sTfB3hc7a6B",
    "Schedule Variance (Days)":        "fldOOS4lb8SkdBoEowc",
    "Resource Names":                  "flddomupp7AkgH9l0KH",
    # READ-ONLY — new rollup / formula fields
    "Total Man Hours":                 "fldnzvyZRobz913Y6AQ",
    "Total Planned Hours":             "fldkx1iZwCkF7268R12",
    "Total Revenue Generated":         "flda18bqQDTKHxefubV",
    "Resource Count":                  "fldtkpF68cLMh9sxO8X",
    "Hours Variance":                  "fldSX2iZvVHNxaZKGjl",
    "Effective Cost Per Hour":         "fldrvHLZf8u9H9z8VAv",
    "Effective Billing Rate Per Hour": "fldTJYY0aWhokZnlTrB",
}

WEB_RESOURCE_FIELD_IDS: dict[str, str] = {
    # Editable fields
    "Resource Name":         "fldGziN024fBytTHbxc",
    "Role":                  "fldkrQDHgMrfD9DjZG0",
    "Type":                  "fldaRgLjZWkR3iV2e5A",
    "Rate (₹)":              "fldkqwQErwSdDESQa6q",
    "Rate Unit":             "fldBdHq5RaaGmkZ3vmk",
    "Units":                 "fld2EOpGBDHojqJfKAL",
    "From Date":             "fldelZHMgbnp8f4UE1V",
    "To Date":               "fldIBkYG6Lk9h1ZLb9p",
    "Notes":                 "fldWDh80n8lzJl4il7R",
    # Man hours (editable)
    "Man Hours":             "fldLKI9wq9yt9NqemOp",
    "Planned Hours":         "fldHFIJ2l3usxqEWVqY",
    # Revenue / billing (editable)
    "Billing Rate (₹)":     "fldfDG5Pa1nTahQ6NPf",
    "Billable Units":        "fldUW5O8dGJulRMmNNf",
    # Link to Web Projects
    "Project":               "fldmmbZ14tbD5414oXs",
    # READ-ONLY — formula fields
    "Total Cost":            "fldirC8RZ2Gwlqb6mwE",
    "Revenue Generated":     "fldJT2vTpNWIiaLhFty",
    "Resource Gross Margin": "fldC8Ya1AdH7CWAV12s",
    "Resource Margin %":     "fldteMOveUXYRLWTAS1",
    # READ-ONLY — lookup field
    "Project Client Charge": "fldUevKHq4aKd3PioV8",
    # READ-ONLY — formula field
    "Revenue Contribution %":"fldoQooZ3SQvRO8E4eW",
}

# Whitelist: ONLY these fields will be sent to Teable in POST/PATCH
_PROJECT_EDITABLE = {
    "Project Name", "Client", "Status", "Priority", "Project Lead",
    "Tags", "Progress (%)", "Description", "Context & Notes",
    "Risks & Blockers", "Est. Start Date", "Est. End Date",
    "Actual Start Date", "Actual End Date", "Estimated Budget", "Client Charge",
}
_RESOURCE_EDITABLE = {
    "Resource Name", "Role", "Type", "Rate (₹)", "Rate Unit", "Units",
    "Man Hours", "Planned Hours", "Billing Rate (₹)", "Billable Units",
    "From Date", "To Date", "Notes", "Project",
}

_TTL_LIST    = 15
_TTL_ALL     = 30
_TTL_SUMMARY = 30


def _bust_project_cache() -> None:
    cache.bust(prefix="webproj:")


def _bust_resource_cache() -> None:
    cache.bust(prefix="webres:")


def _clean_project_fields(fields: dict) -> dict:
    """Only send whitelisted editable fields to Teable."""
    return {
        k: v for k, v in fields.items()
        if k in _PROJECT_EDITABLE and v is not None and v != ""
    }


def _clean_resource_fields(fields: dict) -> dict:
    """Only send whitelisted editable fields to Teable."""
    return {
        k: v for k, v in fields.items()
        if k in _RESOURCE_EDITABLE and v is not None and v != ""
    }


def _teable_error(res) -> str:
    """Extract a useful error message from a Teable error response."""
    try:
        body = res.json()
        return body.get("message") or body.get("error") or res.text
    except Exception:
        return res.text


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

    # ── Names (shared dropdown — accessible to web + all roles) ──────────

    async def list_project_names(self) -> list:
        """Returns minimal [{id, name, client, status}] for dropdown use."""
        async def _load():
            params = {
                "fieldKeyType": "name",
                "take": 500,
                "skip": 0,
            }
            async with httpx.AsyncClient(timeout=15) as client_:
                res = await client_.get(self._record_url, params=params, headers=self._headers)
                res.raise_for_status()
                records = res.json().get("records", [])
            return [
                {
                    "id":     r["id"],
                    "name":   r["fields"].get("Project Name", ""),
                    "client": r["fields"].get("Client", ""),
                    "status": r["fields"].get("Status", ""),
                }
                for r in records
                if r["fields"].get("Project Name")
            ]
        # No cache — always fetch live from Teable so new projects appear instantly
        return await _load()

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
            total_client_charge  = 0.0
            total_input_cost     = 0.0
            total_actual_profit  = 0.0
            total_man_hours      = 0.0
            total_planned_hours  = 0.0
            total_revenue_gen    = 0.0
            active_count = 0

            for r in records:
                f = r.get("fields", {})
                status   = f.get("Status", "Unknown")
                priority = f.get("Priority", "Unknown")
                by_status[status]     = by_status.get(status, 0) + 1
                by_priority[priority] = by_priority.get(priority, 0) + 1

                charge   = float(f.get("Client Charge") or 0)
                cost     = float(f.get("Total Input Cost") or 0)
                profit   = float(f.get("Actual Profit") or 0)
                mh       = float(f.get("Total Man Hours") or 0)
                ph       = float(f.get("Total Planned Hours") or 0)
                rev      = float(f.get("Total Revenue Generated") or 0)

                total_client_charge += charge
                total_input_cost    += cost
                total_actual_profit += profit
                total_man_hours     += mh
                total_planned_hours += ph
                total_revenue_gen   += rev

                if status in ("In Progress", "Active", "🟢 Active"):
                    active_count += 1

            overall_margin = (
                round(total_actual_profit / total_client_charge * 100, 1)
                if total_client_charge > 0 else 0.0
            )
            hours_variance = round(total_planned_hours - total_man_hours, 1)

            return {
                "total_projects":          total,
                "active_projects":         active_count,
                "by_status":               by_status,
                "by_priority":             by_priority,
                "total_client_charge":     round(total_client_charge, 2),
                "total_input_cost":        round(total_input_cost, 2),
                "total_actual_profit":     round(total_actual_profit, 2),
                "overall_margin_pct":      overall_margin,
                "total_man_hours":         round(total_man_hours, 1),
                "total_planned_hours":     round(total_planned_hours, 1),
                "hours_variance":          hours_variance,
                "total_revenue_generated": round(total_revenue_gen, 2),
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
        """
        Fetch resources linked to a specific project.

        Strategy: fetch ALL resources from the table (no server-side filter —
        Teable link-field filtering is unreliable) and filter client-side by
        checking whether each resource's Project link array contains project_id.
        Guaranteed to work regardless of Teable back-link behaviour.
        """
        cache_key = f"webres:proj:{project_id}"

        async def _load():
            params: dict[str, Any] = {
                "fieldKeyType": "name",
                "take": 500,
                "skip": 0,
            }
            async with httpx.AsyncClient(timeout=20) as client_:
                res = await client_.get(self._record_url, params=params, headers=self._headers)
                res.raise_for_status()
                data = res.json()

            all_records = data.get("records", [])

            # Filter: keep records whose Project link field contains project_id
            filtered = []
            for r in all_records:
                proj_field = r.get("fields", {}).get("Project", [])
                # Teable returns link fields as [{id, title}, ...] or []
                if isinstance(proj_field, list):
                    if any(
                        isinstance(p, dict) and p.get("id") == project_id
                        for p in proj_field
                    ):
                        filtered.append(r)
                elif isinstance(proj_field, dict) and proj_field.get("id") == project_id:
                    filtered.append(r)

            return {"records": filtered, "total": len(filtered)}

        return await cache.get_or_set(cache_key, ttl=_TTL_LIST, loader=_load)

    # ── List all resources (global view) ─────────────────────────────────

    async def list_all_resources(
        self,
        limit: int = 500,
        skip: int = 0,
    ) -> dict:
        cache_key = f"webres:all:{limit}:{skip}"

        async def _load():
            params: dict[str, Any] = {
                "fieldKeyType": "name",
                "take": limit,
                "skip": skip,
                "orderBy": json.dumps([{
                    "fieldId": WEB_RESOURCE_FIELD_IDS["Resource Name"],
                    "order": "asc",
                }]),
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
            if not res.is_success:
                raise ValueError(f"Teable {res.status_code}: {_teable_error(res)}")
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
            if not res.is_success:
                raise ValueError(f"Teable {res.status_code}: {_teable_error(res)}")
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

    # ── Assign / unassign a resource to/from a project ────────────────────

    async def assign_resource_to_project(self, resource_id: str, project_id: str) -> dict:
        """Add project_id to the resource's Project link array (multi-link safe)."""
        # Read current links
        resource = await self.get_resource(resource_id)
        existing = resource.get("fields", {}).get("Project", [])
        existing_ids = [p["id"] for p in existing if isinstance(p, dict) and p.get("id")]
        if project_id not in existing_ids:
            existing_ids.append(project_id)
        # Patch with updated array
        url  = f"{self._record_url}/{resource_id}"
        body = {
            "fieldKeyType": "name",
            "record": {"fields": {"Project": [{"id": pid} for pid in existing_ids]}},
        }
        async with httpx.AsyncClient(timeout=15) as client_:
            res = await client_.patch(url, json=body, headers=self._headers)
            if not res.is_success:
                raise ValueError(f"Teable {res.status_code}: {_teable_error(res)}")
        _bust_resource_cache()
        _bust_project_cache()
        return res.json()

    async def unassign_resource_from_project(self, resource_id: str, project_id: str) -> dict:
        """Remove project_id from the resource's Project link array."""
        resource = await self.get_resource(resource_id)
        existing = resource.get("fields", {}).get("Project", [])
        remaining_ids = [
            p["id"] for p in existing
            if isinstance(p, dict) and p.get("id") and p["id"] != project_id
        ]
        url  = f"{self._record_url}/{resource_id}"
        body = {
            "fieldKeyType": "name",
            "record": {"fields": {"Project": [{"id": pid} for pid in remaining_ids]}},
        }
        async with httpx.AsyncClient(timeout=15) as client_:
            res = await client_.patch(url, json=body, headers=self._headers)
            if not res.is_success:
                raise ValueError(f"Teable {res.status_code}: {_teable_error(res)}")
        _bust_resource_cache()
        _bust_project_cache()
        return res.json()
