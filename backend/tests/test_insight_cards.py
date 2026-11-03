"""
GET /api/insights: the phone screens' insight cards and summary series.

Pinned here:
  * every rule fires on the figures it describes and stays quiet otherwise;
  * the ranking (most urgent first, at most five) and the per-scope rule sets;
  * ₹ amounts in en-IN grouping, DD MMM dates, and the GSTR-3B calendar
    (last month's return on the 20th; after the 20th, this month's);
  * the facts from invoices_mirror / projects_mirror equal the Python
    reference over the same records (real Postgres, skipped without it);
  * the cache is busted by the invoice and project busting, and the
    endpoint keeps module permissions, owner scope and the viewer role.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import app.routers.insights as RIns
from app.services import insight_cards as ic
from app.utils.cache import cache

NOW = datetime(2026, 11, 3, 9, 30, tzinfo=timezone.utc)


def inv(rid, **f):
    return {"id": rid, "fields": {k.replace("_", " "): v for k, v in f.items()}}


def invoices():
    return [
        # Pending 63 and 49 days: both over 45 (₹4,65,600).
        inv("i01", **{"Invoice Number": "WM/1", "Payment Status": "Pending", "Raised Date": "2026-09-01T00:00:00.000Z",
                      "Amount Raised": 300000, "Client Name": "Maitrimetal", "Raised By": "am@theworks.in"}),
        inv("i02", **{"Invoice Number": "WM/2", "Payment Status": "Pending", "Raised Date": "2026-09-15T00:00:00.000Z",
                      "Amount Raised": 165600, "Client Name": "Maitrimetal", "Raised By": "bo@theworks.in"}),
        # Pending 14 days, follow-up today, GST 9,000 in October.
        inv("i03", **{"Invoice Number": "WM/3", "Payment Status": "Pending", "Raised Date": "2026-10-20T00:00:00.000Z",
                      "Amount Raised": 50000, "Amount with Tax": 59000, "Client Name": "Birla Open Minds",
                      "Next followup": "2026-11-03T00:00:00.000Z", "Raised By": "am@theworks.in"}),
        # Innovine: three paid invoices, 42 days each (12 past the 30-day mark).
        *[inv(f"i1{k}", **{"Invoice Number": f"WM/1{k}", "Payment Status": "Paid", "Raised Date": r,
                           "Cleared Date": c, "Amount Raised": 100000, "Amount with Tax": 118000,
                           "Amount Received": 100000, "Client Name": "Innovine", "Raised By": "am@theworks.in"})
          for k, (r, c) in enumerate([("2026-05-01T00:00:00.000Z", "2026-06-12T00:00:00.000Z"),
                                      ("2026-06-01T00:00:00.000Z", "2026-07-13T00:00:00.000Z"),
                                      ("2026-07-01T00:00:00.000Z", "2026-08-12T00:00:00.000Z")])],
        # Birla: September 1,00,000 in, October 1,06,000 in (up 6%); October GST 19,080.
        inv("i20", **{"Invoice Number": "WM/20", "Payment Status": "Paid", "Raised Date": "2026-09-01T00:00:00.000Z",
                      "Cleared Date": "2026-09-10T00:00:00.000Z", "Amount Raised": 100000, "Amount Received": 100000,
                      "Client Name": "Birla Open Minds", "Raised By": "bo@theworks.in"}),
        inv("i21", **{"Invoice Number": "WM/21", "Payment Status": "Paid", "Raised Date": "2026-10-05T00:00:00.000Z",
                      "Cleared Date": "2026-10-15T00:00:00.000Z", "Amount Raised": 106000, "Amount with Tax": 125080,
                      "Amount Received": 106000, "Client Name": "Birla Open Minds", "Raised By": "bo@theworks.in"}),
        # Cancelled in October: never GST.
        inv("i30", **{"Invoice Number": "WM/30", "Payment Status": "Cancelled", "Raised Date": "2026-10-07T00:00:00.000Z",
                      "Amount Raised": 40000, "Amount with Tax": 47200, "Client Name": "Innovine"}),
    ]


def projects():
    return [
        {"id": "p1", "fields": {"Project Name": "PMS", "Client": "Innovine", "Profit percentage": -5.5,
                                "Actual Profit": -12000, "Health": "Healthy", "Project Status": "🟢 Active"}},
        {"id": "p2", "fields": {"Project Name": "CRM", "Client": "Birla", "Profit percentage": 12,
                                "Health": "At Risk", "Project Status": "🟢 Active"}},
        {"id": "p3", "fields": {"Project Name": "Site", "Client": "Maitrimetal", "Profit percentage": 30,
                                "Health": "Healthy", "Project Status": "✅ Completed"}},
    ]


def facts(records=None, **kw):
    return ic.invoice_facts_py(invoices() if records is None else records, NOW, **kw)


# ── Formats and calendar ──────────────────────────────────────────────────

class TestFormats:
    @pytest.mark.parametrize("amount,text", [
        (0, "₹0"), (999, "₹999"), (1000, "₹1,000"), (82800, "₹82,800"), (465600, "₹4,65,600"),
        (1234567.8, "₹12,34,568"), (123456789, "₹12,34,56,789"), (-2500, "-₹2,500"), (None, "₹0"),
    ])
    def test_inr(self, amount, text):
        assert ic.format_inr(amount) == text

    def test_day_and_month(self):
        assert ic.format_day(date(2026, 11, 20)) == "20 Nov"
        assert ic.format_day(date(2026, 12, 5)) == "05 Dec"
        assert ic.month_label("2026-01") == "Jan"


class TestGstCalendar:
    def test_before_the_20th_is_last_months_return(self):
        assert ic.gst_return(date(2026, 11, 3)) == {"period": "2026-10", "due": date(2026, 11, 20), "days_left": 17}

    def test_on_the_20th_it_is_due_today(self):
        assert ic.gst_return(date(2026, 11, 20))["days_left"] == 0

    def test_after_the_20th_is_this_months_return(self):
        assert ic.gst_return(date(2026, 11, 21)) == {"period": "2026-11", "due": date(2026, 12, 20), "days_left": 29}

    def test_year_end(self):
        assert ic.gst_return(date(2027, 1, 10))["period"] == "2026-12"
        assert ic.gst_return(date(2026, 12, 25))["due"] == date(2027, 1, 20)

    def test_local_day_follows_the_offset(self):
        late = datetime(2026, 11, 20, 19, 0, tzinfo=timezone.utc)
        assert ic.local_today(late, 0) == date(2026, 11, 20)
        assert ic.local_today(late, 330) == date(2026, 11, 21)   # IST is already the 21st


# ── Facts ─────────────────────────────────────────────────────────────────

class TestFacts:
    def test_reference(self):
        f = facts()
        assert f["today"] == "2026-11-03"
        assert f["overdue45"] == {"count": 2, "amount": 465600.0}
        assert f["aging"] == {"0-30": {"count": 1, "amount": 50000.0}, "31-60": {"count": 1, "amount": 165600.0},
                              "61-90": {"count": 1, "amount": 300000.0}, "90+": {"count": 0, "amount": 0.0}}
        assert f["followups"] == 1
        assert f["cash"] == {"2026-05": 0.0, "2026-06": 100000.0, "2026-07": 100000.0, "2026-08": 100000.0,
                             "2026-09": 100000.0, "2026-10": 106000.0}
        assert f["payers"] == [{"client": "Innovine", "count": 3, "avg_days": 42.0}]
        assert f["gst"] == {"period": "2026-10", "due": "2026-11-20", "days_left": 17, "gst": 28080.0, "count": 2}

    def test_owner_scope(self):
        f = facts(owner="AM@theworks.in")
        assert f["overdue45"] == {"count": 1, "amount": 300000.0}
        assert f["cash"]["2026-10"] == 0.0

    def test_without_gst(self):
        assert facts(with_gst=False)["gst"] is None

    def test_projects(self):
        p = ic.project_facts_py(projects())
        assert [e["id"] for e in p["loss"]] == ["p1"]
        assert [(e["id"], e["health"]) for e in p["risk"]] == [("p2", "At Risk")]


# ── Rules ─────────────────────────────────────────────────────────────────

class TestRules:
    def test_overdue_45_fires(self):
        c = ic.rule_overdue_45(facts())
        assert c["title"] == "2 invoices overdue over 45 days"
        assert c["value"] == "₹4,65,600"
        assert c["action"] == {"label": "Review", "href": "/invoices?status=Pending&to=2026-09-18"}
        assert c["tone"] == "negative"

    def test_overdue_45_quiet(self):
        recs = [r for r in invoices() if r["id"] not in ("i01", "i02")]
        assert ic.rule_overdue_45(facts(recs)) is None

    def test_overdue_45_counts_only_past_45_days(self):
        recs = [r for r in invoices() if r["id"] != "i01"]
        recs[0]["fields"]["Raised Date"] = "2026-09-20T00:00:00.000Z"   # 44 days
        assert ic.rule_overdue_45(facts(recs)) is None

    def test_gst_fires(self):
        c = ic.rule_gst_due(facts())
        assert c["title"] == "GST due 20 Nov"
        assert c["value"] == "₹28,080"
        assert "GSTR-3B for Oct 2026" in c["detail"] and "in 17 days" in c["detail"]
        assert c["action"]["href"] == "/tax?period=m-2026-10&scope=all"

    def test_gst_quiet_without_gst(self):
        recs = [r for r in invoices() if r["id"] not in ("i03", "i21")]
        assert ic.rule_gst_due(facts(recs)) is None
        assert ic.rule_gst_due(facts(with_gst=False)) is None

    def test_gst_urgency(self):
        f = facts()
        f["gst"] = {**f["gst"], "days_left": 2}
        near = ic.rule_gst_due(f)
        f["gst"] = {**f["gst"], "days_left": 0}
        assert "today" in ic.rule_gst_due(f)["detail"]
        assert near["score"] > ic.rule_gst_due(facts())["score"]
        assert near["tone"] == "warning"

    def test_followups(self):
        c = ic.rule_followups_due(facts())
        assert c["title"] == "1 follow-up due"
        assert c["action"]["href"] == "/invoices?followup=1"
        recs = invoices()
        recs[2]["fields"]["Next followup"] = "2026-11-04T00:00:00.000Z"
        assert ic.rule_followups_due(facts(recs)) is None

    def test_slow_payer(self):
        c = ic.rule_slow_payer(facts())
        assert c["title"] == "Innovine pays 12 days late on average"
        assert c["action"]["href"] == "/invoices?client=Innovine"
        assert c["id"] == "slow_payer:Innovine"

    def test_slow_payer_needs_three_invoices_and_a_week(self):
        recs = [r for r in invoices() if r["id"] != "i10"]
        assert ic.rule_slow_payer(facts(recs)) is None
        recs = [r for r in invoices() if r["id"] in ("i10", "i11", "i12")]
        for r in recs:
            raised = r["fields"]["Raised Date"][:10]
            y, m, _ = raised.split("-")
            r["fields"]["Cleared Date"] = f"{y}-{int(m) + 1:02d}-05T00:00:00.000Z"   # 34–35 days
        assert ic.rule_slow_payer(facts(recs)) is None

    def test_slow_payer_window_is_a_year(self):
        recs = invoices()
        for r in recs:
            if r["id"] in ("i10", "i11", "i12"):
                r["fields"]["Raised Date"] = r["fields"]["Raised Date"].replace("2026", "2024")
                r["fields"]["Cleared Date"] = r["fields"]["Cleared Date"].replace("2026", "2024")
        assert ic.rule_slow_payer(facts(recs)) is None

    def test_collections_up(self):
        c = ic.rule_collections_trend(facts())
        assert c["title"] == "Collections up 6% vs last month"
        assert c["tone"] == "positive"
        assert c["detail"] == "Oct: ₹1,06,000 in · Sep: ₹1,00,000"
        assert c["action"]["href"] == ("/invoices?status=Paid&date_field=Cleared+Date&from=2026-10-01&to=2026-10-31")

    def test_collections_down_and_flat(self):
        f = facts()
        f["cash"]["2026-10"] = 80000.0
        assert ic.rule_collections_trend(f)["title"] == "Collections down 20% vs last month"
        f["cash"]["2026-10"] = 103000.0
        assert ic.rule_collections_trend(f) is None          # under 5%
        f["cash"]["2026-09"] = 0.0
        assert ic.rule_collections_trend(f) is None          # nothing to compare with

    def test_project_loss(self):
        c = ic.rule_project_loss(ic.project_facts_py(projects()))
        assert c["title"] == "1 project running at a loss"
        assert c["action"]["href"] == "/projects?q=PMS"
        many = projects() + [{"id": "p9", "fields": {"Project Name": "ERP", "Profit percentage": -20}}]
        c = ic.rule_project_loss(ic.project_facts_py(many))
        assert c["title"] == "2 projects running at a loss"
        assert c["detail"] == "Worst: ERP at -20% margin"
        assert c["action"]["href"] == "/projects?sort=Profit+percentage&order=asc"
        assert ic.rule_project_loss(ic.project_facts_py(projects()[1:])) is None

    def test_projects_at_risk(self):
        c = ic.rule_projects_at_risk(ic.project_facts_py(projects()))
        assert c["title"] == "1 project is at risk"
        assert c["action"]["href"] == "/projects?q=CRM"
        assert ic.rule_projects_at_risk(ic.project_facts_py([projects()[2]])) is None


class TestRanking:
    def test_dashboard_order_and_cap(self):
        cards = ic.build_cards("dashboard", facts(), ic.project_facts_py(projects()))
        assert [c["rule"] for c in cards] == ["overdue_45", "followups_due", "project_loss", "gst_due", "slow_payer"]

    def test_urgent_gst_rises_to_the_top(self):
        f = facts()
        f["gst"]["days_left"] = 1
        assert ic.build_cards("dashboard", f, None)[0]["rule"] == "gst_due"

    def test_scopes(self):
        f, p = facts(), ic.project_facts_py(projects())
        assert {c["rule"] for c in ic.build_cards("invoices", f, p)} == {
            "overdue_45", "followups_due", "slow_payer", "collections_trend"}
        assert [c["rule"] for c in ic.build_cards("projects", f, p)] == ["project_loss", "projects_at_risk"]
        assert [c["rule"] for c in ic.build_cards("tax", f, p)] == ["gst_due"]

    def test_larger_amount_ranks_first_within_a_rule(self):
        assert ic._weight(465600) > ic._weight(50000)

    def test_charts(self):
        ch = ic.build_charts(facts())
        assert [p["label"] for p in ch["cash_in"]] == ["May", "Jun", "Jul", "Aug", "Sep", "Oct"]
        assert [(b["key"], b["count"]) for b in ch["aging"]] == [("0-30", 1), ("31-60", 1), ("61-90", 1), ("90+", 0)]
        assert [b["href"] for b in ch["aging"]] == [
            "/invoices?status=Pending&from=2026-10-04",
            "/invoices?status=Pending&from=2026-09-04&to=2026-10-03",
            "/invoices?status=Pending&from=2026-08-05&to=2026-09-03",
            "/invoices?status=Pending&to=2026-08-04",
        ]


# ── Endpoint ──────────────────────────────────────────────────────────────

def req(**state):
    return SimpleNamespace(state=SimpleNamespace(**state), headers={})


@pytest.fixture
def endpoint(monkeypatch):
    """The endpoint with a pinned clock, no Postgres and counted Teable loads."""
    class _DT(datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW if tz else NOW.replace(tzinfo=None)
    monkeypatch.setattr(RIns, "datetime", _DT)
    monkeypatch.setattr(RIns._pg, "get_pool", lambda: None)
    data = {"invoices": invoices(), "projects": projects(), "loads": 0, "owners": []}

    async def inv_records(owner):
        data["loads"] += 1
        data["owners"].append(owner)
        recs = data["invoices"]
        return [r for r in recs if not owner or str(r["fields"].get("Raised By", "")).lower() == owner.lower()]

    async def prj_records():
        data["loads"] += 1
        return data["projects"]
    monkeypatch.setattr(RIns, "_invoice_records", inv_records)
    monkeypatch.setattr(RIns, "_project_records", prj_records)
    for prefix in ("invoice:", "project:"):
        cache.bust(prefix=prefix)
    yield data
    for prefix in ("invoice:", "project:"):
        cache.bust(prefix=prefix)


def call(scope="dashboard", role="editor", tz=0, **state):
    import asyncio
    return asyncio.run(RIns.insight_cards(req(**state), scope=scope, tz=tz, role=role))


class TestEndpoint:
    def test_dashboard(self, endpoint):
        out = call()
        assert out["scope"] == "dashboard" and out["today"] == "2026-11-03"
        assert out["cards"][0]["title"] == "2 invoices overdue over 45 days"
        assert len(out["cards"]) == 5
        assert out["charts"]["cash_in"][-1] == {"key": "2026-10", "label": "Oct", "amount": 106000.0}
        json.dumps(out)

    def test_projects_scope_has_no_charts_and_reads_no_invoices(self, endpoint):
        out = call("projects")
        assert "charts" not in out
        assert endpoint["owners"] == []

    def test_unknown_scope(self, endpoint):
        with pytest.raises(HTTPException) as e:
            call("everything")
        assert e.value.status_code == 400

    def test_cached_then_busted(self, endpoint):
        call("invoices")
        loads = endpoint["loads"]
        call("invoices")
        assert endpoint["loads"] == loads                      # served from the cache
        endpoint["invoices"] = [r for r in endpoint["invoices"] if r["id"] not in ("i01", "i02")]
        from app.services.invoice import _bust_invoice_cache
        _bust_invoice_cache()
        out = call("invoices")
        assert endpoint["loads"] == loads + 1
        assert "overdue_45" not in {c["rule"] for c in out["cards"]}

    def test_project_busting(self, endpoint):
        call("projects")
        endpoint["projects"] = projects()[2:]
        assert call("projects")["cards"]                       # still cached
        from app.services.teable import _bust_project_cache
        _bust_project_cache()
        assert call("projects")["cards"] == []

    def test_viewer_gets_no_gst(self, endpoint):
        assert "gst_due" not in {c["rule"] for c in call("dashboard", role="viewer")["cards"]}
        assert call("tax", role="viewer")["cards"] == []
        assert call("tax")["cards"][0]["rule"] == "gst_due"

    def test_owner_scope(self, endpoint, monkeypatch):
        async def perms(user_id, **kw):
            return {"module.invoices.view", "module.projects.view"}
        monkeypatch.setattr(RIns, "get_effective_permissions", perms)
        out = call("invoices", is_email_auth=True, auth_role="member", auth_user_id="u1",
                   auth_user_email="am@theworks.in")
        assert endpoint["owners"] == ["am@theworks.in"]
        over = next(c for c in out["cards"] if c["rule"] == "overdue_45")
        assert over["title"] == "1 invoice overdue over 45 days" and over["value"] == "₹3,00,000"
        dash = call("dashboard", is_email_auth=True, auth_role="member", auth_user_id="u1",
                    auth_user_email="am@theworks.in")
        assert "gst_due" not in {c["rule"] for c in dash["cards"]}

    def test_module_permissions(self, endpoint, monkeypatch):
        async def projects_only(user_id, **kw):
            return {"module.projects.view"}
        monkeypatch.setattr(RIns, "get_effective_permissions", projects_only)
        out = call("dashboard", is_email_auth=True, auth_role="admin", auth_user_id="u1")
        assert {c["rule"] for c in out["cards"]} == {"project_loss", "projects_at_risk"}
        assert out["charts"] is None
        assert endpoint["owners"] == []

        async def invoices_only(user_id, **kw):
            return {"module.invoices.view"}
        monkeypatch.setattr(RIns, "get_effective_permissions", invoices_only)
        out = call("projects", is_email_auth=True, auth_role="admin", auth_user_id="u1")
        assert out["cards"] == []

    def test_superadmin_passes(self, endpoint, monkeypatch):
        async def nothing(user_id, **kw):
            return set()
        monkeypatch.setattr(RIns, "get_effective_permissions", nothing)
        assert call("projects", is_email_auth=True, auth_role="superadmin", auth_user_id="u1")["cards"]

    def test_unavailable_source_is_no_cards(self, endpoint, monkeypatch):
        async def down(owner):
            raise RuntimeError("Teable is down")
        monkeypatch.setattr(RIns, "_invoice_records", down)
        out = call("invoices")
        assert out["cards"] == [] and out["charts"] is None


# ── The mirrors (real Postgres) ───────────────────────────────────────────

class TestMirror:
    def _seed(self, pg):
        from app.db.sync import _extract_invoice, _extract_project, upsert_record
        from tests.test_invoice_query_pg import make_invoices

        recs = invoices() + make_invoices(160, seed=11)

        async def go(pool):
            for r in recs:
                await upsert_record(pool, "invoices", "invoices_mirror", r["id"], r["fields"], _extract_invoice)
            for r in projects():
                await upsert_record(pool, "projects", "projects_mirror", r["id"], r["fields"], _extract_project)
        pg.run(go)
        return recs

    def test_sql_equals_python(self, pg):
        recs = self._seed(pg)
        for tz, owner in ((0, None), (330, None), (0, "am@theworks.in"), (-300, "bo@theworks.in")):
            sql = pg.run(lambda pool: ic.invoice_facts_sql(pool, NOW, tz, owner))
            assert sql == ic.invoice_facts_py(recs, NOW, tz, owner), (tz, owner)
        assert pg.run(ic.project_facts_sql) == ic.project_facts_py(projects())

    def test_empty_mirror_is_none(self, pg):
        assert pg.run(lambda pool: ic.invoice_facts_sql(pool, NOW)) is None
        assert pg.run(ic.project_facts_sql) is None

    def test_endpoint_reads_the_mirror(self, pg, monkeypatch):
        self._seed(pg)

        class _DT(datetime):
            @classmethod
            def now(cls, tz=None):
                return NOW if tz else NOW.replace(tzinfo=None)
        monkeypatch.setattr(RIns, "datetime", _DT)

        async def never(*a, **k):
            raise AssertionError("the mirror answers")
        monkeypatch.setattr(RIns, "_invoice_records", never)
        monkeypatch.setattr(RIns, "_project_records", never)
        cache.bust(prefix="invoice:")
        cache.bust(prefix="project:")
        try:
            out = pg.run(lambda pool: RIns.insight_cards(req(), scope="dashboard", tz=0, role="editor"))
        finally:
            cache.bust(prefix="invoice:")
            cache.bust(prefix="project:")
        assert {c["rule"] for c in out["cards"]} >= {"overdue_45", "project_loss"}
        assert out["charts"]["aging"][0]["key"] == "0-30"
