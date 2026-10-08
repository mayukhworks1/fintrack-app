"""
Cover for GET /api/invoices/dashboard-activity.

The Dashboard fetched its 400 most recent invoices in full — every description,
remark and attachment array — to feed two widgets that use a handful of
fields: the activity chart (one slim row per invoice) and the retainer-health
card (an aggregate plus at most six overdue rows). This endpoint returns
exactly that. A full record measures ~1.7 KB; a slim row ~220 B.

Two invariants here are the kind that fail silently if they regress:

  * the activity rows must carry every field InvoiceActivityChart reads —
    drop one and a bar quietly renders with aging 0 or an empty tooltip line;
  * the route must be declared before /{record_id}, or FastAPI captures
    "dashboard-activity" as a record id and the endpoint vanishes.
"""

import asyncio
import re
from pathlib import Path

import pytest

import app.routers.invoices as inv


def _rec(i, cat="Project", outstanding=0, raised="2026-09-15", heavy=True):
    f = {
        "Invoice Number": f"INV-{i}", "Category": cat, "Outstanding Amount": outstanding,
        "Raised Date": f"{raised}T00:00:00.000Z", "Amount Raised": 1000, "Payment Status": "Pending",
        "Raised By": "a@b.c", "Project": "P", "Client": "C", "Agening (Days)": 12,
    }
    if heavy:
        f.update({
            "Description": "x" * 600, "Remark": "y" * 300,
            "Reference": [{"url": "https://s/" + "z" * 200, "name": "r.pdf"}],
            "Invoice PDF": [{"url": "https://s/" + "z" * 200, "name": "i.pdf"}],
        })
    return {"id": f"rec{i}", "fields": f}


# 8 overdue retainers (more than the row cap), 2 healthy retainers,
# 3 non-retainers, 1 retainer with a non-numeric outstanding amount.
RECORDS = (
    [_rec(i, "Development- Retainer", 500, "2026-09-01") for i in range(8)]
    + [_rec(10, "Retainer", 0, "2026-09-01"), _rec(11, "retainer svc", 0, "2026-11-01")]
    + [_rec(20), _rec(21), _rec(22)]
    + [_rec(30, "Retainer", "not-a-number", "2026-09-01")]
)


class _Req:
    pass


def _call(monkeypatch, svc, month="2026-10"):
    monkeypatch.setattr(inv, "InvoiceService", lambda: svc)
    monkeypatch.setattr(inv, "owner_scope_email", lambda req: "owner@x.com")
    return asyncio.run(inv.dashboard_activity(_Req(), limit=400, month=month, _role="viewer", _perm="x"))


class _Svc:
    def __init__(self):
        self.calls = {}
    async def list_invoices(self, **kw):
        self.calls["live"] = kw
        return {"records": RECORDS}
    async def list_invoices_from_pg(self, **kw):
        self.calls["pg"] = kw
        return {"records": RECORDS}


class TestChartContract:
    def test_activity_rows_carry_every_field_the_chart_reads(self):
        chart = (Path(__file__).resolve().parents[2] / "frontend/src/components/InvoiceActivityChart.jsx").read_text()
        reads = set(re.findall(r"f\['([^']+)'\]", chart))
        # Checked against the imported tuple, not a regex over the source: a
        # regex stops at the ')' inside "Agening (Days)" and reports it missing.
        assert reads <= set(inv._ACTIVITY_FIELDS), sorted(reads - set(inv._ACTIVITY_FIELDS))

    def test_activity_rows_carry_only_slim_fields(self, monkeypatch):
        out = _call(monkeypatch, _Svc())
        keys = set().union(*[set(r["fields"]) for r in out["activity"]])
        assert keys <= set(inv._ACTIVITY_FIELDS)
        assert "Description" not in keys and "Reference" not in keys


class TestRetainerAggregate:
    def test_filter_is_case_insensitive_substring(self, monkeypatch):
        assert _call(monkeypatch, _Svc())["retainer"]["total"] == 11

    def test_overdue_count_is_true_count_while_rows_are_capped_at_six(self, monkeypatch):
        r = _call(monkeypatch, _Svc())["retainer"]
        assert r["overdue_count"] == 8
        assert len(r["overdue"]) == 6
        assert r["healthy"] == 3

    def test_overdue_rule_requires_positive_outstanding_and_raised_month_not_after_this_month(self, monkeypatch):
        # rec11 is a retainer raised 2026-11 with 0 outstanding -> not overdue
        # on either leg; rec10 has 0 outstanding -> not overdue.
        r = _call(monkeypatch, _Svc(), month="2026-10")["retainer"]
        ids = {row["id"] for row in r["overdue"]}
        assert "rec10" not in ids and "rec11" not in ids

    def test_non_numeric_outstanding_does_not_raise(self, monkeypatch):
        _call(monkeypatch, _Svc())   # rec30 carries "not-a-number"

    def test_overdue_rows_carry_only_the_widget_fields(self, monkeypatch):
        r = _call(monkeypatch, _Svc())["retainer"]
        keys = set().union(*[set(row["fields"]) for row in r["overdue"]])
        assert keys <= set(inv._RETAINER_ROW_FIELDS)


class TestPlumbing:
    def test_month_passes_through_and_defaults(self, monkeypatch):
        assert _call(monkeypatch, _Svc(), month="2026-10")["month"] == "2026-10"
        assert re.fullmatch(r"\d{4}-\d{2}", _call(monkeypatch, _Svc(), month=None)["month"])

    def test_owner_scoping_is_forwarded(self, monkeypatch):
        svc = _Svc()
        _call(monkeypatch, svc)
        assert svc.calls["live"]["raised_by"] == "owner@x.com"
        assert svc.calls["live"]["order_by"] == "Raised Date" and svc.calls["live"]["order"] == "desc"

    def test_falls_back_to_the_pg_mirror_when_live_returns_none(self, monkeypatch):
        class Down(_Svc):
            async def list_invoices(self, **kw):
                return None
        svc = Down()
        out = _call(monkeypatch, svc)
        assert "pg" in svc.calls and out["retainer"]["total"] == 11

    def test_route_is_declared_before_record_id(self, monkeypatch):
        monkeypatch.setenv("APP_SECRET", "x-local-test-secret-xxxxxxxxxxxx")
        import app.main as M
        paths = [getattr(r, "path", "") for r in M.app.routes]
        assert paths.index("/api/invoices/dashboard-activity") < paths.index("/api/invoices/{record_id}")


class TestPayload:
    def test_slim_row_is_several_times_smaller_than_a_full_record(self):
        import json
        full = len(json.dumps(_rec(1, "Development- Retainer", 500)))
        slim = len(json.dumps(inv._slim(_rec(1, "Development- Retainer", 500), inv._ACTIVITY_FIELDS)))
        assert full / slim > 5
