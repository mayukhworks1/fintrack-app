"""
GET /api/web-invoices/query, the tax ledger on /api/invoices/query and
GET /api/projects/query against a real Postgres (tests/pg_harness.py).

These pages downloaded whole tables into the browser — web invoices 500 rows
every 10 s, the tax ledger 1,000 every 15 s, projects every 5 s plus a
Teable search capped at 20 — and worked out their figures there. The server
now answers one page and the totals from the mirrors (migration 0010). Pinned
here, against the real database:

  * every filter, search and sort picks what the Python port of the page's
    rules picks (the Teable fallback), and keyset paging walks the whole
    scope with nothing repeated or skipped;
  * the totals equal brute-force sums, the summaries the cards used to show
    (WebInvoiceService.get_summary, TeableService._compute_summary) and, for
    the tax ledger, what the old browser code computed on the same invoices
    (tests/fixtures/tax_ledger_cases.json, made by taxLedgerLegacy.js);
  * ETag / 304, owner scoping, hostile input, the fallbacks (no Postgres,
    an empty mirror, migration 0010 not yet run), the CSV exports, the
    project write-through and migration 0010 both ways.

Skipped without PostgreSQL.
"""

from __future__ import annotations

import asyncio
import csv
import io
import json
import math
import random
from pathlib import Path

import pytest
from fastapi import HTTPException

import app.routers.invoices as RI
import app.routers.projects as RP
import app.routers.web_invoices as RW
from app.db.sync import _extract_invoice, _extract_project, _extract_web_invoice, upsert_record
from app.services import invoice_query as iq
from app.services import project_query as pq
from app.services import teable as T
from app.services.invoice_common import project_search_text
from app.services.teable import TeableService
from app.services.web_invoice import WebInvoiceService
from app.utils.cache import cache
from tests import pg_harness
from tests.test_invoice_query_pg import (  # noqa: F401  (frozen is a fixture)
    FILTER_CASES, NOW, body, close, frozen, ids, make_invoices, request,
)

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "tax_ledger_cases.json").read_text())


@pytest.fixture(autouse=True)
def _fresh_caches():
    for prefix in ("invoice:", "webinv:", "project:"):
        cache.bust(prefix=prefix)
    yield
    for prefix in ("invoice:", "webinv:", "project:"):
        cache.bust(prefix=prefix)


@pytest.fixture(autouse=True)
def _no_teable(monkeypatch):
    async def unreachable(self, *a, **k):
        raise RuntimeError("Teable is not reachable in tests")
    monkeypatch.setattr(WebInvoiceService, "get_all_invoices", unreachable)
    monkeypatch.setattr(TeableService, "get_all_records", unreachable)
    from app.services.invoice import InvoiceService
    monkeypatch.setattr(InvoiceService, "get_all_invoices", unreachable)


# ── Loading the mirrors the way the sync does ──────────────────────────────

async def _upsert(pool, source, table, extractor, records):
    for r in records:
        await upsert_record(pool, source, table, r["id"], r["fields"], extractor)


def load_web(env, records):
    env.run(lambda pool: _upsert(pool, "web_invoices", "web_invoices_mirror", _extract_web_invoice, records))


def load_invoices(env, records):
    env.run(lambda pool: _upsert(pool, "invoices", "invoices_mirror", _extract_invoice, records))


def load_projects(env, records):
    env.run(lambda pool: _upsert(pool, "projects", "projects_mirror", _extract_project, records))


def make_web_invoices(n, seed=17):
    """make_invoices, in several currencies, without Client Name (web invoices have none)."""
    rnd = random.Random(seed)
    out = []
    for r in make_invoices(n, seed=seed):
        f = dict(r["fields"])
        f.pop("Client Name", None)
        f.pop("Client", None)
        cur = rnd.choice([None, None, "RS", "USD", "EUR", " inr "])
        if cur is not None:
            f["Currency"] = cur
        out.append({"id": "w" + r["id"], "fields": f})
    return out


def web_query(env, *, headers=None, limit=200, cursor=None, offset=0, aggregates=True, state=None, **params):
    qry = iq.build_query(**params)

    async def go(pool):
        return await RW.query_web_invoices(request(headers, **(state or {})), qry=qry, limit=limit, cursor=cursor,
                                           offset=offset, aggregates=aggregates, _role="all", _perm="x")
    return env.run(go)


def inv_query(env, *, headers=None, limit=200, cursor=None, offset=0, aggregates=True, **params):
    qry = iq.build_query(**params)

    async def go(pool):
        return await RI.query_invoices(request(headers), qry=qry, limit=limit, cursor=cursor, offset=offset,
                                       aggregates=aggregates, _role="editor", _perm="x")
    return env.run(go)


def web_python(recs, aggregates=True, owner=None, limit=10_000, **params):
    qry = iq.build_query(**params)
    return iq.query_records(recs, qry, owner, limit=limit, cursor=None, offset=0, aggregates=aggregates,
                            now=NOW, src=iq.WEB_INVOICES)


# ===========================================================================
# Web invoices
# ===========================================================================

@pytest.fixture
def web(pg, frozen):
    recs = make_web_invoices(240)
    load_web(pg, recs)
    return pg, recs


WEB_CASES = [c for c in FILTER_CASES if "client" not in c and "Client Name" not in json.dumps(c)] + [
    {"q": "crm"}, {"q": "advance", "status": "Paid"},
]


class TestWebInvoices:
    @pytest.mark.parametrize("params", WEB_CASES, ids=lambda p: json.dumps(p)[:70])
    def test_sql_picks_what_the_page_rules_pick(self, web, params):
        env, recs = web
        got = body(web_query(env, limit=1000, **params))
        want = web_python(recs, **params)
        assert sorted(ids(got)) == sorted(ids(want))
        assert got["total"] == want["total"]
        close(got["aggregates"], want["aggregates"])
        assert got["source"] == "mirror"

    def test_searched_fields(self, pg, frozen):
        recs = [
            {"id": "wNum", "fields": {"Invoice Number": "WEB/26-27/77"}},
            {"id": "wPrj", "fields": {"Project": "Website Revamp"}},
            {"id": "wDes", "fields": {"Description": "Landing page build"}},
            {"id": "wCat", "fields": {"Category": "Hosting"}},
            {"id": "wMil", "fields": {"Milestone": "Go-live"}},
            {"id": "wRem", "fields": {"Remark": "paid by cheque"}},
        ]
        load_web(pg, recs)
        for q, want in [("26-27/77", ["wNum"]), ("revamp", ["wPrj"]), ("landing build", ["wDes"]),
                        ("hosting", ["wCat"]), ("go-live", ["wMil"]), ("cheque", ["wRem"]),
                        ("landing revamp", [])]:
            assert sorted(ids(body(web_query(pg, q=q)))) == want, q

    @pytest.mark.parametrize("sort", ["Raised Date", "Amount Raised", "Project", "Agening (Days)", "Next followup"])
    @pytest.mark.parametrize("order", ["asc", "desc"])
    def test_cursor_walk_has_no_duplicates_or_gaps(self, web, sort, order):
        env, recs = web
        want = ids(web_python(recs, aggregates=False, sort=sort, order=order))
        walked, cursor = [], None
        while True:
            resp = body(web_query(env, limit=29, cursor=cursor, sort=sort, order=order, aggregates=False))
            walked += ids(resp)
            cursor = resp["next_cursor"]
            if not cursor:
                break
        assert walked == want and len(set(walked)) == len(recs)

    def test_totals_match_the_summary_the_cards_used_to_show(self, web, monkeypatch):
        env, recs = web
        ws = body(web_query(env, q="zoho"))["workspace"]

        async def everything(self, raised_by=None):
            return [json.loads(json.dumps(r)) for r in recs]
        monkeypatch.setattr(WebInvoiceService, "get_all_invoices", everything)
        old = asyncio.run(WebInvoiceService().get_summary())
        assert ws["count"] == old["total_invoices"] and ws["active_count"] == old["active_invoices"]
        assert set(ws["by_currency"]) == set(old["by_currency"])
        for cur, theirs in old["by_currency"].items():
            mine = ws["by_currency"][cur]
            for k in ("raised", "with_tax", "gst", "tds", "received", "outstanding", "collection_rate"):
                assert math.isclose(mine[k], theirs[k], abs_tol=0.011), (cur, k)
            assert mine["count"] == theirs["count"] and mine["pending_count"] == theirs["pending_count"]
        for entry in ws["by_project"]:
            theirs = old["by_project"].get(entry["project"])
            if theirs is None:      # the old summary filed a missing project under "Unknown"
                continue
            assert entry["count"] == theirs["count"] and entry["currencies"] == theirs["currencies"]
            for cur, amounts in theirs["by_currency"].items():
                for k, v in amounts.items():
                    assert math.isclose(entry["by_currency"][cur][k], v, abs_tol=0.011), (entry["project"], cur, k)

    def test_filtered_currency_totals_equal_a_brute_force_sum(self, web):
        env, recs = web
        agg = body(web_query(env, status="Pending"))["aggregates"]
        want: dict = {}
        for r in recs:
            f = r["fields"]
            if f.get("Payment Status") != "Pending":
                continue
            cur = (f.get("Currency") or "RS").strip() or "RS"
            t = want.setdefault(cur, [0, 0.0, 0.0, 0.0, 0.0])
            t[0] += 1
            t[1] += float(f.get("Amount Raised") or 0)
            t[2] += float(f.get("Amount with Tax") or 0)
            t[3] += float(f.get("Amount Received") or 0)
            t[4] += max(0.0, float(f.get("Outstanding Amount") or 0))
        assert set(agg["by_currency"]) == set(want)
        for cur, (n, raised, wt, rec, out) in want.items():
            t = agg["by_currency"][cur]
            assert t["count"] == n
            for k, v in (("amount_raised", raised), ("amount_with_tax", wt), ("amount_received", rec),
                         ("outstanding", out)):
                assert math.isclose(t["totals"][k], round(v, 2), abs_tol=0.011), (cur, k)

    def test_owner_scope_is_exclusive(self, web):
        env, recs = web

        async def go(pool):
            return await iq.query_mirror(pool, iq.build_query(), "AM@theworks.IN", limit=500, cursor=None,
                                         offset=0, aggregates=True, now=NOW, src=iq.WEB_INVOICES)
        got = env.run(go)
        want = sorted(r["id"] for r in recs if str(r["fields"].get("Raised By", "")).lower() == "am@theworks.in")
        assert sorted(r["id"] for r in got["records"]) == want and got["workspace"]["count"] == len(want)

    def test_etag_and_304(self, web):
        env, recs = web
        tag = web_query(env, q="retainer").headers["etag"]
        assert web_query(env, q="retainer", headers={"if-none-match": tag}).status_code == 304
        load_web(env, [{**recs[0], "fields": {**recs[0]["fields"], "Remark": "edited"}}])
        cache.bust(prefix="webinv:")
        assert web_query(env, q="retainer", headers={"if-none-match": tag}).status_code == 200

    @pytest.mark.parametrize("value", ["'; DROP TABLE web_invoices_mirror; --", "x' OR '1'='1", "%' OR 1=1 --", "$1"])
    def test_hostile_text_is_data(self, web, value):
        env, recs = web
        for params in ({"q": value}, {"status": value}, {"project": value}, {"category": value}):
            assert body(web_query(env, **params))["total"] == 0, params
        assert env.sql("SELECT count(*) FROM web_invoices_mirror")[0][0] == len(recs)

    def test_without_postgres_the_same_answer_comes_from_teable(self, web, monkeypatch):
        env, recs = web
        params = {"q": "retainer", "status": "Pending", "sort": "Amount Raised", "order": "asc"}
        from_mirror = body(web_query(env, **params))

        async def teable(self, raised_by=None):
            return [dict(r) for r in recs]
        monkeypatch.setattr(WebInvoiceService, "get_all_invoices", teable)
        monkeypatch.setattr(RI._pg, "get_pool", lambda: None)
        from_teable = body(asyncio.run(RW.query_web_invoices(
            request(), qry=iq.build_query(**params), limit=200, cursor=None, offset=0, aggregates=True,
            _role="all", _perm="x")))
        assert from_teable["source"] == "teable" and ids(from_teable) == ids(from_mirror)
        close(from_teable["aggregates"], from_mirror["aggregates"])
        close(from_teable["workspace"], from_mirror["workspace"])

    def test_before_migration_0010_it_falls_back(self, pg_upto, frozen, monkeypatch):
        env = pg_upto("0009_invoice_query")
        recs = make_web_invoices(6)
        load_web(env, recs)

        async def teable(self, raised_by=None):
            return recs
        monkeypatch.setattr(WebInvoiceService, "get_all_invoices", teable)
        got = body(web_query(env))
        assert got["source"] == "teable" and got["total"] == 6
        # The invoice list itself keeps answering from its mirror at 0009.
        load_invoices(env, make_invoices(3))
        assert body(inv_query(env))["source"] == "mirror"

    def test_export_is_the_whole_filtered_scope(self, web, monkeypatch):
        env, recs = web
        monkeypatch.setattr(iq, "EXPORT_BATCH", 9)
        params = {"status": "Paid", "sort": "Amount Raised", "order": "desc"}

        async def go(pool):
            resp = await RW.export_web_invoices(request(), qry=iq.build_query(**params), columns=None,
                                                _role="all", _perm="x")
            return "".join([c if isinstance(c, str) else c.decode() async for c in resp.body_iterator])
        rows = list(csv.reader(io.StringIO(env.run(go))))
        want = web_python(recs, aggregates=False, **params)["records"]
        assert rows[0][0] == "Invoice Number" and len(rows) - 1 == len(want) > 9
        assert [r[0] for r in rows[1:]] == [w["fields"]["Invoice Number"] for w in want]


# ===========================================================================
# Tax ledger
# ===========================================================================

def _case_params(case):
    if case["period"]:
        return {"period": case["period"]}
    return {"date_from": case["from"], "date_to": case["to"]}


def _check_against_browser(agg, expected):
    t, o = expected["totals"], expected["openSummary"]
    paid = agg["paid"]
    assert paid["count"] == t["count"]
    for mine, theirs in (("taxable", "taxable"), ("gst", "gstAmt"), ("tds", "tdsAmt"), ("gross", "gross"),
                         ("received", "received"), ("outstanding", "outstanding")):
        assert math.isclose(paid[mine], t[theirs], abs_tol=0.011), (mine, paid[mine], t[theirs])
    op = agg["open"]
    assert op["count"] == o["count"] and op["oldest"] == o["oldest"]
    for k in ("taxable", "gross", "received", "outstanding"):
        assert math.isclose(op[k], o[k], abs_tol=0.011), k
    assert [m["key"] for m in agg["months"]] == [m["key"] for m in expected["monthlyRows"]]
    for mine, theirs in zip(agg["months"], expected["monthlyRows"]):
        assert mine["count"] == theirs["count"]
        for a, b in (("taxable", "taxable"), ("gst", "gstAmt"), ("tds", "tdsAmt"), ("gross", "gross"),
                     ("received", "received")):
            assert math.isclose(mine[a], theirs[b], abs_tol=0.011), (mine["key"], a)
    clients = {c["client"]: c for c in agg["clients"]}
    assert set(clients) == {c["client"] for c in expected["clientRows"]}
    for theirs in expected["clientRows"]:
        mine = clients[theirs["client"]]
        assert mine["count"] == theirs["count"]
        for a, b in (("taxable", "taxable"), ("gst", "gstAmt"), ("tds", "tdsAmt"), ("gross", "gross")):
            assert math.isclose(mine[a], theirs[b], abs_tol=0.011), (theirs["client"], a)
    grosses = [c["gross"] for c in agg["clients"]]
    assert grosses == sorted(grosses, reverse=True)


@pytest.fixture
def tax(pg, frozen):
    load_invoices(pg, FIXTURE["records"])
    return pg


class TestTaxLedger:
    @pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda c: c["period"] or "custom")
    @pytest.mark.parametrize("tz", [0, 330])
    def test_totals_equal_the_old_browser_maths(self, tax, case, tz):
        got = body(inv_query(tax, tax_scope="all", tz=tz, **_case_params(case)))
        _check_against_browser(got["aggregates"], case["expected"])
        # Without a search the "of all" figures are the same period.
        assert got["workspace"] == got["aggregates"]

    @pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda c: c["period"] or "custom")
    @pytest.mark.parametrize("scope", ["tax", "open", "all"])
    def test_scopes_list_the_old_pages_invoices(self, tax, case, scope):
        got = body(inv_query(tax, tax_scope=scope, aggregates=False, **_case_params(case)))
        assert sorted(ids(got)) == case["expected"]["scopes"][scope]
        assert got["total"] == len(case["expected"]["scopes"][scope])

    def test_the_teable_fallback_computes_the_same(self, tax):
        case = FIXTURE["cases"][0]
        sql = body(inv_query(tax, tax_scope="tax", tz=330, **_case_params(case)))
        py = iq.query_records(FIXTURE["records"], iq.build_query(tax_scope="tax", tz=330, **_case_params(case)),
                              None, limit=200, cursor=None, offset=0, aggregates=True, now=NOW)
        close(sql["aggregates"], py["aggregates"])
        close(sql["workspace"], py["workspace"])
        assert ids(sql) == ids(py)

    def test_a_search_narrows_the_totals_not_the_of_all_figures(self, tax):
        got = body(inv_query(tax, tax_scope="tax", period="fy-2025", q="maitrimetal"))
        assert 0 < got["aggregates"]["paid"]["count"] < got["workspace"]["paid"]["count"]
        assert got["workspace"]["paid"]["count"] == FIXTURE["cases"][0]["expected"]["totals"]["count"]
        assert all("maitrimetal" in iq.invoice_search_text(r["fields"]) for r in got["records"])

    def test_a_client_row_lists_its_invoices(self, tax):
        case = FIXTURE["cases"][0]
        for row in case["expected"]["clientRows"]:
            got = body(inv_query(tax, tax_scope="tax", tax_client=row["client"], aggregates=False,
                                 **_case_params(case)))
            assert got["total"] == row["count"], row["client"]

    def test_a_month_row_lists_its_invoices(self, tax):
        case = FIXTURE["cases"][0]
        for row in case["expected"]["monthlyRows"]:
            got = body(inv_query(tax, tax_scope="tax", month=row["key"], tz=330, aggregates=False,
                                 **_case_params(case)))
            assert got["total"] == row["count"], row["key"]

    def test_web_invoices_have_the_same_ledger(self, pg, frozen):
        load_web(pg, FIXTURE["records"])
        case = FIXTURE["cases"][0]
        got = body(web_query(pg, tax_scope="all", tz=330, **_case_params(case)))
        _check_against_browser(got["aggregates"], case["expected"])

    def test_export_covers_the_whole_filtered_register(self, tax, monkeypatch):
        monkeypatch.setattr(iq, "EXPORT_BATCH", 4)
        case = FIXTURE["cases"][0]
        qry = iq.build_query(tax_scope="tax", **_case_params(case))

        async def go(pool):
            resp = await RI.export_invoices(request(), qry=qry, columns="tax", _role="editor", _perm="x")
            text = "".join([c if isinstance(c, str) else c.decode() async for c in resp.body_iterator])
            return resp, text
        resp, text = tax.run(go)
        rows = list(csv.DictReader(io.StringIO(text)))
        assert "tax-ledger_filtered_" in resp.headers["content-disposition"]
        assert len(rows) == case["expected"]["totals"]["count"] > 4
        assert math.isclose(sum(float(r["GST Amount"]) for r in rows), case["expected"]["totals"]["gstAmt"], abs_tol=0.02)
        assert math.isclose(sum(float(r["TDS Amount"]) for r in rows), case["expected"]["totals"]["tdsAmt"], abs_tol=0.02)
        assert list(rows[0]) == list(RI.TAX_EXPORT_FIELDS)

    @pytest.mark.parametrize("bad", [
        {"period": "fy-20x5"}, {"period": "q5-2026"}, {"period": "m-2026-13"}, {"period": "'; DROP"},
        {"tax_scope": "everything"}, {"tax_client": "Acme"},
    ])
    def test_unknown_tax_input_is_refused(self, bad):
        with pytest.raises(HTTPException) as e:
            RI._scope_params(**{**{k: None for k in ("q", "status", "project", "client", "category", "raised_by",
                                                        "billing", "month", "aging", "date_field", "date_from",
                                                        "date_to", "conditions", "sort", "order")},
                                 "overdue": False, "has_docs": False, "followup_due": False, "tz": 0, **bad})
        assert e.value.status_code == 400

    def test_hostile_client_is_data(self, tax):
        got = body(inv_query(tax, tax_scope="tax", tax_client="x' OR '1'='1"))
        assert got["total"] == 0 and tax.sql("SELECT count(*) FROM invoices_mirror")[0][0] == len(FIXTURE["records"])


# ===========================================================================
# Projects
# ===========================================================================

STATUSES = ["🟢 Active", "✅ Completed", "⏸️ On Hold", "🔴 Cancelled", None]
HEALTH = ["Healthy", "At Risk", "Critical", "🔴 Off track", None, ""]
PCLIENTS = ["Birla Open Minds", "Maitrimetal", "BG", None]


def make_projects(n, seed=5):
    rnd = random.Random(seed)
    out = []
    for i in range(n):
        f = {"Project Name": f"Project {rnd.choice(['Atlas', 'Zoho', 'Portal', 'CRM'])} {i}"}
        for key, choices in (("Client", PCLIENTS), ("Project Status", STATUSES), ("Health", HEALTH)):
            v = rnd.choice(choices)
            if v is not None:
                f[key] = v
        billed = rnd.choice([None, 0, 150000, 1200000.5, 99000, "45000"])
        if billed is not None:
            f["Amount Billed So far"] = billed
        f["Actual Profit"] = rnd.choice([None, -20000, 35000, 125000.25])
        f["Profit percentage"] = rnd.choice([None, -12.5, 0, 18.75, 33.3333, 40 + i / 1000])
        f["Input cost so far"] = rnd.choice([None, 50000, 81000])
        f["Total Overhead Cost"] = rnd.choice([None, 7000, 12000])
        f["Target Revenue"] = rnd.choice([None, 500000, 2500000])
        f["Target Achieved "] = rnd.choice([None, True, False, 1, 0])
        out.append({"id": f"recP{seed:02d}{i:04d}" + rnd.choice(["a", "Z"]),
                    "fields": {k: v for k, v in f.items() if v is not None}})
    return out


def proj_query(env, *, headers=None, limit=200, cursor=None, offset=0, aggregates=True, **params):
    qry = pq.build_project_query(**params)

    async def go(pool):
        return await RP.query_projects(request(headers), qry=qry, limit=limit, cursor=cursor, offset=offset,
                                       aggregates=aggregates, _role="editor", _perm="x")
    return env.run(go)


def proj_python(recs, aggregates=True, limit=10_000, **params):
    return pq.query_records(recs, pq.build_project_query(**params), limit=limit, cursor=None, offset=0,
                            aggregates=aggregates)


@pytest.fixture
def projects(pg, frozen):
    recs = make_projects(180)
    load_projects(pg, recs)
    return pg, recs


PROJECT_CASES = [
    {}, {"q": "atlas"}, {"q": "zoho critical"}, {"q": "birla"}, {"q": "at risk"}, {"q": "🟢"},
    {"status": "🟢 Active"}, {"status": "active"}, {"status": "on hold"}, {"client": "Maitrimetal"},
    {"q": "portal", "client": "BG", "status": "✅ Completed"}, {"q": "nothing-matches-this"},
    {"sort": "Profit percentage", "order": "asc"}, {"sort": "Project Name"},
]


class TestProjects:
    @pytest.mark.parametrize("params", PROJECT_CASES, ids=lambda p: json.dumps(p, ensure_ascii=False)[:60])
    def test_sql_picks_and_totals_what_the_page_rules_do(self, projects, params):
        env, recs = projects
        got = body(proj_query(env, limit=200, **params))
        want = proj_python(recs, limit=200, **params)
        assert ids(got) == ids(want)
        assert got["total"] == want["total"]
        close(got["aggregates"], want["aggregates"])
        close(got["workspace"], want["workspace"])

    def test_search_is_not_capped_and_follows_the_filters(self, projects):
        env, recs = projects
        got = body(proj_query(env, q="project", limit=200))
        assert got["total"] == len(recs) > 20
        narrowed = body(proj_query(env, q="project", client="BG"))
        assert narrowed["total"] == sum(r["fields"].get("Client") == "BG" for r in recs)

    @pytest.mark.parametrize("sort", list(pq.SORTS))
    @pytest.mark.parametrize("order", ["asc", "desc"])
    def test_cursor_walk_has_no_duplicates_or_gaps(self, projects, sort, order):
        env, recs = projects
        want = ids(proj_python(recs, aggregates=False, sort=sort, order=order))
        walked, cursor = [], None
        while True:
            resp = body(proj_query(env, limit=23, cursor=cursor, sort=sort, order=order, aggregates=False))
            walked += ids(resp)
            cursor = resp["next_cursor"]
            if not cursor:
                break
        assert walked == want and len(set(walked)) == len(recs)

    def test_workspace_matches_the_old_summary_and_the_page_rules(self, projects):
        env, recs = projects
        got = body(proj_query(env, q="zoho"))
        ws = got["workspace"]
        old = TeableService()._compute_summary([dict(r) for r in recs])
        for k in ("total_projects", "total_billed", "total_profit", "total_input_cost", "total_overhead",
                  "total_cost", "avg_profit_pct", "target_achieved_count"):
            mine = ws["count"] if k == "total_projects" else ws[k]
            assert math.isclose(mine, old[k], abs_tol=0.011), k
        assert ws["by_status"] == old["by_status"] and ws["by_client"] == old["by_client"]
        assert ws["by_health"] == {("Unknown" if k == "" else k): v for k, v in old["by_health"].items()}
        assert ws["best_project"]["pct"] == old["best_project"]["pct"]
        assert ws["worst_project"]["pct"] == old["worst_project"]["pct"]
        # The browser's rules over every project.
        needs = [r for r in recs if (float(r["fields"].get("Profit percentage") or 0) < 0
                                     or r["fields"].get("Health") in ("Critical", "At Risk"))]
        blind = [r for r in recs if not r["fields"].get("Health") and not r["fields"].get("Project Status")]
        assert ws["needs_action"] == len(needs) and ws["blind_spots"] == len(blind)
        assert len(ws["action_queue"]) == 4 and all(a["rank"] == 3 for a in ws["action_queue"])
        top = max(recs, key=lambda r: float(r["fields"].get("Amount Billed So far") or 0))
        assert ws["highest_exposure"]["billed"] == round(float(top["fields"]["Amount Billed So far"]), 2)
        assert got["aggregates"]["count"] < ws["count"]
        assert ws["facets"]["clients"] == sorted({c for c in PCLIENTS if c})

    def test_etag_and_304(self, projects):
        env, recs = projects
        tag = proj_query(env, q="atlas").headers["etag"]
        assert proj_query(env, q="atlas", headers={"if-none-match": tag}).status_code == 304
        load_projects(env, [{**recs[0], "fields": {**recs[0]["fields"], "Health": "Critical"}}])
        cache.bust(prefix="project:")
        assert proj_query(env, q="atlas", headers={"if-none-match": tag}).status_code == 200

    @pytest.mark.parametrize("value", ["'; DROP TABLE projects_mirror; --", "x' OR '1'='1", "%", "_", "$1"])
    def test_hostile_text_is_data(self, projects, value):
        env, recs = projects
        for params in ({"q": value}, {"status": value}, {"client": value}):
            assert body(proj_query(env, **params))["total"] == 0, params
        assert env.sql("SELECT count(*) FROM projects_mirror")[0][0] == len(recs)

    @pytest.mark.parametrize("bad", [{"sort": "fields"}, {"sort": "Amount Billed So far; DROP"}, {"order": "up"}])
    def test_unknown_input_is_refused(self, bad):
        with pytest.raises(HTTPException) as e:
            RP._project_scope(**{"q": None, "status": None, "client": None, "sort": None, "order": None, **bad})
        assert e.value.status_code == 400

    def test_a_forged_cursor_is_refused(self, projects):
        env, _ = projects
        with pytest.raises(HTTPException) as e:
            proj_query(env, cursor="eyJzIjoiUHJvamVjdCBOYW1lIiwibyI6ImRlc2MiLCJ0IjoicyIsImsiOiJ4IiwiaSI6InIifQ")
        assert e.value.status_code == 400

    def test_without_postgres_the_same_answer_comes_from_teable(self, projects, monkeypatch):
        env, recs = projects
        from_mirror = body(proj_query(env, q="portal", status="active"))

        async def teable(self):
            return [dict(r) for r in recs]
        monkeypatch.setattr(TeableService, "get_all_records", teable)
        monkeypatch.setattr(RP._pg, "get_pool", lambda: None)
        from_teable = body(asyncio.run(RP.query_projects(
            request(), qry=pq.build_project_query(q="portal", status="active"), limit=200, cursor=None, offset=0,
            aggregates=True, _role="editor", _perm="x")))
        assert from_teable["source"] == "teable" and ids(from_teable) == ids(from_mirror)
        close(from_teable["aggregates"], from_mirror["aggregates"])

    def test_an_empty_mirror_or_one_without_0010_falls_back(self, pg_upto, frozen, monkeypatch):
        recs = make_projects(7)

        async def teable(self):
            return recs
        monkeypatch.setattr(TeableService, "get_all_records", teable)
        env = pg_upto("0009_invoice_query")
        assert body(proj_query(env))["source"] == "teable"
        load_projects(env, recs)
        got = body(proj_query(env))
        assert got["source"] == "teable" and got["total"] == 7

    def test_writes_go_through_to_the_mirror(self, projects, monkeypatch):
        env, recs = projects
        monkeypatch.setattr(T, "_bust_project_cache", lambda: cache.bust(prefix="project:"))

        async def go(pool):
            await T._mirror_write_through("recNewProject", {
                "id": "recNewProject", "fields": {"Project Name": "Fresh Launch", "Client": "BG"},
                "lastModifiedTime": "2026-10-30T09:00:00.000Z"})
            cache.bust(prefix="project:")
            added = body(await RP.query_projects(request(), qry=pq.build_project_query(q="fresh launch"), limit=10,
                                                 cursor=None, offset=0, aggregates=True, _role="e", _perm="x"))
            await T._mirror_write_through("recNewProject", None, deleted=True)
            cache.bust(prefix="project:")
            gone = body(await RP.query_projects(request(), qry=pq.build_project_query(q="fresh launch"), limit=10,
                                                cursor=None, offset=0, aggregates=True, _role="e", _perm="x"))
            return added, gone
        added, gone = env.run(go)
        assert ids(added) == ["recNewProject"] and added["aggregates"]["count"] == 1
        assert gone["total"] == 0 and gone["workspace"]["count"] == len(recs)

    def test_generated_search_text_matches_the_python_rule(self, projects):
        env, recs = projects
        got = {r["teable_id"]: r["search_text"] for r in env.sql("SELECT teable_id, search_text FROM projects_mirror")}
        for r in recs:
            assert got[r["id"]] == project_search_text(r["fields"]), r["id"]


# ===========================================================================
# Migration 0010
# ===========================================================================

class TestMigration0010:
    PATH = pg_harness.BACKEND / "migrations/versions/0010_list_queries.py"

    def test_upgrade_backfills_downgrade_removes_upgrade_again(self, pg_upto):
        env = pg_upto("0009_invoice_query")
        load_web(env, [{"id": "recW1", "fields": {
            "Invoice Number": "W-1", "Project": "Site", "Currency": "USD", "Raised Date": "2026-03-01T18:30:00.000Z",
            "Reference": [{"name": "proof.png"}], "Outstanding Amount": "1200.50"}}])
        load_invoices(env, [{"id": "recI1", "fields": {"Project": "PMS", "Raised Date": "2026-03-01"}}])
        load_projects(env, [{"id": "recP1", "fields": {
            "Project Name": "Atlas", "Client": "BG", "Health": "At Risk", "Amount Billed So far": "45000",
            "Target Achieved ": True}}])
        up = pg_harness.migration_statements(self.PATH)
        down = pg_harness.migration_statements(self.PATH, "downgrade")
        for s in up:
            env.execute(s)
        w = env.sql("SELECT search_text, currency_code, tax_client, doc_count, outstanding_amount "
                    "FROM web_invoices_mirror")[0]
        assert w["search_text"] == "w-1\nsite\nproof.png" and w["currency_code"] == "USD"
        assert w["tax_client"] == "Site" and w["doc_count"] == 1 and float(w["outstanding_amount"]) == 1200.5
        i = env.sql("SELECT currency_code, tax_client FROM invoices_mirror")[0]
        assert i["currency_code"] == "RS" and i["tax_client"] == "PMS"
        p = env.sql("SELECT search_text, health, billed_amount, target_achieved FROM projects_mirror")[0]
        assert p["search_text"] == "atlas\nbg\nat risk" and p["health"] == "At Risk"
        assert float(p["billed_amount"]) == 45000 and p["target_achieved"] is True
        idx = {r[0] for r in env.sql("SELECT indexname FROM pg_indexes WHERE tablename IN "
                                      "('web_invoices_mirror', 'projects_mirror', 'invoices_mirror')")}
        assert {"wim_live_raised_key_idx", "wim_search_trgm_idx", "pm_live_billed_key_idx",
                "pm_search_trgm_idx", "im_live_raised_day_idx"} <= idx
        for s in down:
            env.execute(s)
        cols = {r[0] for r in env.sql("SELECT column_name FROM information_schema.columns WHERE table_name IN "
                                      "('web_invoices_mirror', 'projects_mirror', 'invoices_mirror')")}
        assert not {"currency_code", "tax_client", "health", "billed_amount", "target_achieved"} & cols
        assert "search_text" in cols          # invoices_mirror's, from 0009, stays
        for s in up:
            env.execute(s)
        assert env.sql("SELECT search_text FROM projects_mirror")[0][0] == "atlas\nbg\nat risk"
