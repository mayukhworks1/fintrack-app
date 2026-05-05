"""
Web Project Tracker router — /api/web-projects + /api/web-resources
All routes require the "all" role. Other tokens get 403.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from pydantic import BaseModel
from ..services.web_project import WebProjectService, WebResourceService
from .deps import require_all, require_web_access

# ── Routers ───────────────────────────────────────────────────────────────────

projects_router  = APIRouter(prefix="/api/web-projects",  tags=["web-projects"])
resources_router = APIRouter(prefix="/api/web-resources", tags=["web-resources"])


# ── Pydantic models ───────────────────────────────────────────────────────────

class ProjectFields(BaseModel):
    project_name:     Optional[str]   = None
    client:           Optional[str]   = None
    status:           Optional[str]   = None
    priority:         Optional[str]   = None
    project_lead:     Optional[str]   = None
    tags:             Optional[str]   = None
    progress_pct:     Optional[float] = None
    description:      Optional[str]   = None
    context_notes:    Optional[str]   = None
    risks_blockers:   Optional[str]   = None
    est_start:        Optional[str]   = None   # ISO date string
    est_end:          Optional[str]   = None
    actual_start:     Optional[str]   = None
    actual_end:       Optional[str]   = None
    estimated_budget: Optional[float] = None
    client_charge:    Optional[float] = None

    def to_teable_fields(self) -> dict:
        # IMPORTANT: key strings must exactly match Teable field names
        m = {
            "Project Name":      self.project_name,
            "Client":            self.client,
            "Status":            self.status,
            "Priority":          self.priority,
            "Project Lead":      self.project_lead,
            "Tags":              self.tags,
            "Progress (%)":      self.progress_pct,   # was "Progress %"
            "Description":       self.description,
            "Context & Notes":   self.context_notes,
            "Risks & Blockers":  self.risks_blockers,
            "Est. Start Date":   self.est_start,      # was "Est. Start"
            "Est. End Date":     self.est_end,         # was "Est. End"
            "Actual Start Date": self.actual_start,    # was "Actual Start"
            "Actual End Date":   self.actual_end,      # was "Actual End"
            "Estimated Budget":  self.estimated_budget,
            "Client Charge":     self.client_charge,
        }
        return {k: v for k, v in m.items() if v is not None}


class ResourceFields(BaseModel):
    resource_name:  Optional[str]   = None
    role:           Optional[str]   = None
    type_:          Optional[str]   = None   # "Type" — aliased to avoid Python keyword clash
    rate:           Optional[float] = None
    rate_unit:      Optional[str]   = None
    units:          Optional[float] = None
    # Man hours — requires "Man Hours" and "Planned Hours" fields in Teable
    man_hours:      Optional[float] = None
    planned_hours:  Optional[float] = None
    # Revenue / billing — requires corresponding Teable fields
    billing_rate:   Optional[float] = None   # "Billing Rate (₹)"
    billable_units: Optional[float] = None   # "Billable Units"
    from_date:      Optional[str]   = None
    to_date:        Optional[str]   = None
    notes:          Optional[str]   = None
    project_id:     Optional[str]   = None   # Teable record ID of the linked project

    class Config:
        populate_by_name = True

    def to_teable_fields(self) -> dict:
        # IMPORTANT: key strings must exactly match Teable field names
        m = {
            "Resource Name":    self.resource_name,
            "Role":             self.role,
            "Type":             self.type_,
            "Rate (₹)":         self.rate,           # was "Rate ₹"
            "Rate Unit":        self.rate_unit,
            "Units":            self.units,
            "Man Hours":        self.man_hours,
            "Planned Hours":    self.planned_hours,
            "Billing Rate (₹)": self.billing_rate,
            "Billable Units":   self.billable_units,
            "From Date":        self.from_date,
            "To Date":          self.to_date,
            "Notes":            self.notes,
            "project_id":       self.project_id,   # handled specially in service
        }
        return {k: v for k, v in m.items() if v is not None}


# ── Projects routes ───────────────────────────────────────────────────────────

@projects_router.get("/names")
async def list_web_project_names(_role: str = Depends(require_web_access)):
    """Shared project name list — used by invoice dropdown (web + all roles)."""
    try:
        return await WebProjectService().list_project_names()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@projects_router.get("/summary")
async def web_project_summary(_role: str = Depends(require_all)):
    try:
        return await WebProjectService().get_summary()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@projects_router.get("")
async def list_web_projects(
    status:   Optional[str] = Query(None),
    client:   Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    limit:    int           = Query(200, ge=1, le=1000),
    skip:     int           = Query(0,   ge=0),
    order_by: str           = Query("Project Name"),
    order:    str           = Query("asc"),
    _role:    str           = Depends(require_all),
):
    try:
        return await WebProjectService().list_projects(
            status=status, client=client, priority=priority,
            limit=limit, skip=skip, order_by=order_by, order=order,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@projects_router.get("/{project_id}/resources")
async def list_project_resources(
    project_id: str,
    bust: bool = Query(False, description="Set true to bypass cache"),
    _role: str = Depends(require_all),
):
    """List all resources linked to a specific project."""
    from ..utils.cache import cache as _cache
    if bust:
        _cache.bust(prefix=f"webres:proj:{project_id}")
    try:
        return await WebResourceService().list_resources(project_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@projects_router.get("/{project_id}")
async def get_web_project(project_id: str, _role: str = Depends(require_all)):
    try:
        return await WebProjectService().get_project(project_id)
    except Exception as e:
        raise HTTPException(
            status_code=404 if "404" in str(e) else 500,
            detail=str(e),
        )


@projects_router.post("", status_code=201)
async def create_web_project(body: ProjectFields, _role: str = Depends(require_all)):
    if not body.project_name:
        raise HTTPException(status_code=400, detail="Project Name is required")
    try:
        return await WebProjectService().create_project(body.to_teable_fields())
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@projects_router.patch("/{project_id}")
async def update_web_project(
    project_id: str, body: ProjectFields, _role: str = Depends(require_all)
):
    try:
        return await WebProjectService().update_project(project_id, body.to_teable_fields())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@projects_router.delete("/{project_id}", status_code=204)
async def delete_web_project(project_id: str, _role: str = Depends(require_all)):
    try:
        await WebProjectService().delete_project(project_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Resources routes ──────────────────────────────────────────────────────────

@resources_router.get("")
async def list_all_web_resources(
    limit: int = Query(500, ge=1, le=1000),
    skip:  int = Query(0,   ge=0),
    _role: str = Depends(require_all),
):
    """List all resources across all projects."""
    try:
        return await WebResourceService().list_all_resources(limit=limit, skip=skip)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@resources_router.get("/{resource_id}")
async def get_web_resource(resource_id: str, _role: str = Depends(require_all)):
    try:
        return await WebResourceService().get_resource(resource_id)
    except Exception as e:
        raise HTTPException(
            status_code=404 if "404" in str(e) else 500,
            detail=str(e),
        )


@resources_router.post("", status_code=201)
async def create_web_resource(body: ResourceFields, _role: str = Depends(require_all)):
    if not body.resource_name:
        raise HTTPException(status_code=400, detail="Resource Name is required")
    try:
        return await WebResourceService().create_resource(body.to_teable_fields())
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@resources_router.patch("/{resource_id}")
async def update_web_resource(
    resource_id: str, body: ResourceFields, _role: str = Depends(require_all)
):
    try:
        return await WebResourceService().update_resource(resource_id, body.to_teable_fields())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@resources_router.delete("/{resource_id}", status_code=204)
async def delete_web_resource(resource_id: str, _role: str = Depends(require_all)):
    try:
        await WebResourceService().delete_resource(resource_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
