"""
'Pause month' on a retainer records that month as a Cancelled invoice.

The UI used to send amount_raised=0 and amount_with_tax=0 for that row. Both
invoice models refuse a non-positive amount (an invoice amount must be
positive), so every pause failed with a 422 and paused months stayed
"Missing". The amounts are optional and a paused month has none, so the UI now
leaves them out. These tests pin that contract from the API side: the payload
the UI sends for a pause is accepted by both create routes and reaches Teable
as a Cancelled row with no amounts, while a zero amount is still refused.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import invoices as INV
from app.routers import web_invoices as WEB

# What createRetainerMonth (Invoices.jsx / WebInvoices.jsx) sends for a pause.
# amount_raised / amount_with_tax are undefined there, so JSON drops them.
PAUSE = {
    "invoice_number": "",
    "project": "Acme Retainer",
    "category": "Development- Retainer",
    "description": "Retainer paused for October 2026",
    "milestone": None,
    "raised_by": "am@example.com",
    "raised_date": "2026-10-01T00:00:00.000Z",
    "amount_received": 0,
    "payment_status": "Cancelled",
    "remark": "Paused for October 2026. Reason: client on leave",
}


@pytest.fixture
def client(monkeypatch):
    created = []

    class FakeInvoiceService:
        async def create_invoice(self, fields):
            created.append(("invoices", fields))
            return {"id": "recPause"}

    class FakeWebInvoiceService:
        async def create_invoice(self, fields):
            created.append(("web-invoices", fields))
            return {"id": "recWebPause"}

    async def nothing(*args, **kwargs):
        return None

    monkeypatch.setattr(INV, "InvoiceService", FakeInvoiceService)
    monkeypatch.setattr(INV, "_check_mutation_rate", nothing)
    monkeypatch.setattr(INV, "record_user_attribution", nothing)
    monkeypatch.setattr(WEB, "WebInvoiceService", FakeWebInvoiceService)
    monkeypatch.setattr(WEB, "record_user_attribution", nothing)

    app = FastAPI()
    app.include_router(INV.router)
    app.include_router(WEB.router)
    app.dependency_overrides[INV.require_auth] = lambda: "editor"
    app.dependency_overrides[WEB.require_web_access] = lambda: "all"
    c = TestClient(app)
    c.created = created
    return c


@pytest.mark.parametrize("path", ["/api/invoices", "/api/web-invoices"])
def test_pause_payload_is_accepted_and_stored_as_cancelled_without_amounts(client, path):
    res = client.post(path, json=PAUSE)
    assert res.status_code == 201, res.text

    (_, fields), = client.created
    assert fields["Payment Status"] == "Cancelled"
    assert fields["Raised Date"].startswith("2026-10-01")
    assert "Amount Raised" not in fields
    assert "Amount with Tax" not in fields


@pytest.mark.parametrize("path", ["/api/invoices", "/api/web-invoices"])
def test_a_zero_amount_is_still_refused(client, path):
    # The old pause payload. The rule it broke is deliberate and stays.
    res = client.post(path, json={**PAUSE, "amount_raised": 0, "amount_with_tax": 0})
    assert res.status_code == 422
    assert client.created == []
