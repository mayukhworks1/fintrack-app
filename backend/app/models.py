from typing import Optional
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Teable field constants
# ---------------------------------------------------------------------------

FIELD_IDS = {
    "Client": "fldHaatbCHKuUOZhral",
    "Project Name": "fldvhmWM7kL2INnG7lE",
    "Project Start Date": "fldkmCDsUilSkIZazwn",
    "Duration (Months)": "fldW0EPeg3nPMVfUVFb",
    "Resource Count": "fld0WmES7Wb8tgdUqux",
    "Combined monthly salary of all the resources": "fldaWrcek9d09y1lDrV",
    "Total Overhead Cost": "fldmYnJykw0nZNrp4TK",
    "Total Monthly Input Cost": "fldGRoONKCKRcQP7pGW",
    "Target Revenue": "fldYs3iKSBF0KNLdy8Q",
    "Amount Billed So far": "fldE20GyoJe52RrvxNK",
    "Input cost so far": "fldzzXaRmUQ71q7XMYw",
    "Actual Profit": "fld4PtwYRVQRrX3xMax",
    "Profit percentage": "fld1pBjsYLViu5p3dqB",
    "Target Achieved ": "fldHdm4XYZxHNQEIQKj",
    "Project Status": "fld2Dy7JgaCjfUiYI4N",
    "Health": "fld7Kq2WIe9vNodfyBI",
    "Revenue per Resource": "fld2NgknYysMpvNMTEb",
    "Resource contribution percentage": "fldXHkDyTiFmCExFpc4",
    "Revenue of resource based on given contribution percentage.": "flduGX7KvgEMpy27aNA",
}

STATUS_ALIAS = {
    "active": "🟢 Active",
    "completed": "✅ Completed",
    "on hold": "⏸️ On Hold",
    "cancelled": "🔴 Cancelled",
    "canceled": "🔴 Cancelled",
}


def resolve_status(status: str) -> str:
    return STATUS_ALIAS.get(status.lower(), status)


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class ProjectCreate(BaseModel):
    client: str
    project_name: str
    project_start_date: Optional[str] = None
    duration_months: Optional[str] = None
    resource_count: Optional[int] = None
    combined_monthly_salary: Optional[float] = None
    amount_billed: Optional[float] = None
    project_status: Optional[str] = None
    resource_contribution_pct: Optional[float] = None

    def to_teable_fields(self) -> dict:
        m: dict = {}
        if self.client:
            m["Client"] = self.client
        if self.project_name:
            m["Project Name"] = self.project_name
        if self.project_start_date:
            m["Project Start Date"] = self.project_start_date
        if self.duration_months:
            m["Duration (Months)"] = self.duration_months
        if self.resource_count is not None:
            m["Resource Count"] = self.resource_count
        if self.combined_monthly_salary is not None:
            m["Combined monthly salary of all the resources"] = self.combined_monthly_salary
        if self.amount_billed is not None:
            m["Amount Billed So far"] = self.amount_billed
        if self.project_status:
            m["Project Status"] = resolve_status(self.project_status)
        if self.resource_contribution_pct is not None:
            m["Resource contribution percentage"] = self.resource_contribution_pct
        return m


class ProjectUpdate(BaseModel):
    client: Optional[str] = None
    project_name: Optional[str] = None
    project_start_date: Optional[str] = None
    duration_months: Optional[str] = None
    resource_count: Optional[int] = None
    combined_monthly_salary: Optional[float] = None
    amount_billed: Optional[float] = None
    project_status: Optional[str] = None
    resource_contribution_pct: Optional[float] = None

    def to_teable_fields(self) -> dict:
        m: dict = {}
        if self.client is not None:
            m["Client"] = self.client
        if self.project_name is not None:
            m["Project Name"] = self.project_name
        if self.project_start_date is not None:
            m["Project Start Date"] = self.project_start_date
        if self.duration_months is not None:
            m["Duration (Months)"] = self.duration_months
        if self.resource_count is not None:
            m["Resource Count"] = self.resource_count
        if self.combined_monthly_salary is not None:
            m["Combined monthly salary of all the resources"] = self.combined_monthly_salary
        if self.amount_billed is not None:
            m["Amount Billed So far"] = self.amount_billed
        if self.project_status is not None:
            m["Project Status"] = resolve_status(self.project_status)
        if self.resource_contribution_pct is not None:
            m["Resource contribution percentage"] = self.resource_contribution_pct
        return m


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = []


class AutofillRequest(BaseModel):
    description: str


class AnalyzeRequest(BaseModel):
    record_id: str
