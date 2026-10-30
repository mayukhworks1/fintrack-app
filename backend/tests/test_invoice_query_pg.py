"""
GET /api/invoices/query and /export against a real Postgres (tests/pg_harness.py).

The invoice list used to be filtered, searched and totalled in the browser
over every record. The server now does it, from invoices_mirror, and the
things only a database can show are pinned here:

  * search finds a word in every searched field, every word has to match,
    and LIKE wildcards in a search are text;
  * each filter, sort and advanced rule picks the same rows, in the same
    order, as the Python port of the page's own rules (the Teable fallback);
  * keyset paging walks the whole scope with nothing repeated or skipped,
    in every sort order;
  * the totals equal a brute-force sum, and InvoiceService._compute_summary
    (what the KPI cards showed before) for the unfiltered workspace;
  * ETag / 304, owner scoping, the fallbacks, the CSV export, migration 0009
    both ways, and hostile input that must stay data.

Skipped without PostgreSQL.
"""

from __future__ import annotations

import asyncio
import csv
import io
import json
import math
import random
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import app.routers.invoices as RI
from app.db.sync import _extract_invoice, upsert_record
from app.services import invoice_query as iq
from app.services.invoice import InvoiceService
from app.utils.fast_json import body_of
from tests import pg_harness

NOW = datetime(2026, 10, 30, 9, 30, tzinfo=timezone.utc)
PROJECTS = ["Innovine", "PMS", "Innovine-ZOHO", "Maitrimetal Workspace migration", None]
CLIENTS = ["Innovine", "Birla Open Minds", "Maitrimetal"]
CATEGORIES = ["Development- Retainer", "Phase 1.3", "ZOHO", "Change Request", "BUG Fixing", None]
MILESTONES = ["Advance", "Post go Live", "Final", None]
OWNERS = ["am@theworks.in", "AM@theworks.in", "bo@theworks.in", None]
STATUSES = ["Paid", "Pending", "Cancelled", None]


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def make_invoices(n: int, seed: int = 7) -> list[dict]:
    rnd = random.Random(seed)
    out = []
    for i in range(n):
        st = rnd.choice(STATUSES)
        raised = NOW - timedelta(days=rnd.randint(-5, 420), hours=rnd.choice([0, 0, 18.5, 3]))
        amount = rnd.choice([None, 20000, 120000, 345600, 15000.5, 30000])
        f: dict = {
            "Invoice Number": f"WM/26-27/{1000 + i}",
            "Payment Status": st,
            "Raised Date": rnd.choice([_iso(raised), _iso(raised), raised.strftime("%Y-%m-%d"), None]),
            "Raised By": rnd.choice(OWNERS),
            "Milestone": rnd.choice(MILESTONES),
            "Description": rnd.choice(["Retainer advance", "ZOHO CRM implementation", "Bug fixing sprint", None]),
            "Remark": rnd.choice([None, None, "Follow up with accounts", "=HYPERLINK(\"x\")", "100% advance_paid"]),
        }
        if rnd.random() < 0.85:
            f["Client Name"] = rnd.choice(CLIENTS)
        else:
            f["Client"] = rnd.choice(CLIENTS)
        project = rnd.choice(PROJECTS)
        if project:
            f["Project"] = project
        category = rnd.choice(CATEGORIES)
        if category:
            f["Category"] = category
        if amount is not None:
            f["Amount Raised"] = amount
            if rnd.random() < 0.9:
                f["Amount with Tax"] = round(amount * 1.18, 2)
        if st == "Paid":
            if rnd.random() < 0.8 and amount:
                f["Amount Received"] = round(amount * rnd.choice([1.18, 1.08, 1.0]), 2)
            f["Cleared Date"] = _iso(raised + timedelta(days=rnd.randint(1, 90)))
            f["Outstanding Amount"] = rnd.choice([0, -250])
        elif st == "Pending":
            f["Outstanding Amount"] = round((amount or 0) * 1.08, 2)
            f["Agening (Days)"] = rnd.choice([None, 3, 400])   # Teable's stored (stale) value
            if rnd.random() < 0.6:
                f["Next followup"] = _iso(NOW + timedelta(days=rnd.randint(-20, 20)))
        if rnd.random() < 0.6:
            f["Reference"] = [{"name": f"utr-{i}.png", "token": f"t{i}"}]
        if rnd.random() < 0.5:
            f["Invoice PDF"] = [{"name": f"WM{i}.pdf"}]
        out.append({"id": f"rec{seed:02d}{i:05d}" + rnd.choice(["a", "B", "c"]), "fields": {k: v for k, v in f.items() if v is not None}})
    return out


async def _load(pool, records):
    """Through the sync's own upsert (typed columns, history), as the mirror is filled."""
    for r in records:
        await upsert_record(pool, "invoices", "invoices_mirror", r["id"], r["fields"], _extract_invoice)


async def _bulk(pool, records):
    """The same rows the sync writes, in one statement (for the bigger datasets)."""
    cols = list(_extract_invoice({}))
    rows = [(r["id"], json.dumps(r["fields"]), *_extract_invoice(r["fields"]).values()) for r in records]
    phs = ", ".join(f"${i + 3}" for i in range(len(cols)))
    await pool.executemany(
        f"INSERT INTO invoices_mirror (teable_id, fields, {', '.join(cols)}) VALUES ($1, $2::jsonb, {phs})", rows)


def request(headers=None, **state):
    return SimpleNamespace(state=SimpleNamespace(**state), headers=headers or {})


def query(env, *, headers=None, limit=200, cursor=None, offset=0, aggregates=True, **params):
    qry = iq.build_query(**params)

    async def go(pool):
        return await RI.query_invoices(request(headers), qry=qry, limit=limit, cursor=cursor, offset=offset,
                                       aggregates=aggregates, _role="editor", _perm="x")
    return env.run(go)


def body(resp):
    return body_of(resp)


@pytest.fixture(autouse=True)
def _no_teable(monkeypatch):
    """Teable is never reached from these tests; a test that wants the
    fallback installs its own records."""
    async def unreachable(self, raised_by=None):
        raise RuntimeError("Teable is not reachable in tests")
    monkeypatch.setattr(InvoiceService, "get_all_invoices", unreachable)


@pytest.fixture
def frozen(monkeypatch):
    """Pin the clock the endpoint reads, so aging and 'due today' are exact."""
    class _DT(datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW if tz else NOW.replace(tzinfo=None)
    monkeypatch.setattr(RI, "datetime", _DT)
    from app.utils.cache import cache
    cache.bust(prefix="invoice:")
    yield
    cache.bust(prefix="invoice:")


@pytest.fixture
def data(pg, frozen):
    recs = make_invoices(260)
    pg.run(lambda pool: _bulk(pool, recs))
    return pg, recs


def python_answer(recs, aggregates=True, owner=None, limit=10_000, **params):
    qry = iq.build_query(**params)
    return iq.query_records(recs, qry, owner, limit=limit, cursor=None, offset=0, aggregates=aggregates, now=NOW)


def ids(resp_or_result):
    recs = resp_or_result["records"]
    return [r["id"] for r in recs]


def close(a, b, path=""):
    """Deep equality with float tolerance."""
    if isinstance(a, float) or isinstance(b, float):
        assert a is not None and b is not None and math.isclose(float(a), float(b), rel_tol=1e-9, abs_tol=0.011), (path, a, b)
    elif isinstance(a, dict):
        assert set(a) == set(b), (path, set(a) ^ set(b))
        for k in a:
            close(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, list):
        assert len(a) == len(b), (path, len(a), len(b))
        for i, (x, y) in enumerate(zip(a, b)):
            close(x, y, f"{path}[{i}]")
    else:
        assert a == b, (path, a, b)


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

class TestSearch:
    def test_every_searched_field_is_found(self, pg, frozen):
        recs = [
            {"id": "recNum", "fields": {"Invoice Number": "WM/26-27/401", "Payment Status": "Paid"}},
            {"id": "recCli", "fields": {"Client Name": "Birla Open Minds"}},
            {"id": "recCl2", "fields": {"Client": "Legacy Clientco"}},
            {"id": "recPrj", "fields": {"Project": "Innovine-ZOHO"}},
            {"id": "recDes", "fields": {"Description": "ZOHO CRM implementation advance"}},
            {"id": "recCat", "fields": {"Category": "Development- Retainer"}},
            {"id": "recMil", "fields": {"Milestone": "Post go Live"}},
            {"id": "recRef", "fields": {"Reference": [{"name": "UTR-88123.png", "presignedUrl": "https://x/zzsecret"}]}},
            {"id": "recRem", "fields": {"Remark": "Cheque bounced twice"}},
        ]
        pg.run(lambda pool: _load(pool, recs))
        for q, want in [
            ("26-27/401", ["recNum"]), ("birla", ["recCli"]), ("clientco", ["recCl2"]),
            ("innovine-zoho", ["recPrj"]), ("crm", ["recDes"]), ("retainer", ["recCat"]),
            ("go live", ["recMil"]), ("utr-88123", ["recRef"]), ("bounced", ["recRem"]),
            ("ZOHO", ["recDes", "recPrj"]),
            ("zzsecret", []),               # file URLs are not searched, only names
        ]:
            got = sorted(ids(body(query(pg, q=q))))
            assert got == sorted(want), (q, got)

    def test_every_word_has_to_match_and_words_do_not_span_fields(self, pg, frozen):
        recs = [
            {"id": "recA", "fields": {"Project": "Innovine", "Category": "Development- Retainer"}},
            {"id": "recB", "fields": {"Project": "Innovine", "Category": "ZOHO"}},
        ]
        pg.run(lambda pool: _load(pool, recs))
        assert ids(body(query(pg, q="innovine retainer"))) == ["recA"]
        assert ids(body(query(pg, q="  INNOVINE  "))) != []
        # One field per line: "innovine development" is not a phrase of either field.
        assert ids(body(query(pg, q="innovine development"))) == ["recA"]   # two words, two fields: fine
        assert body(query(pg, q="innovinedevelopment"))["records"] == []

    def test_like_wildcards_are_text(self, pg, frozen):
        recs = [
            {"id": "recPct", "fields": {"Remark": "100% advance"}},
            {"id": "recUnd", "fields": {"Remark": "paid_in_full"}},
            {"id": "recOth", "fields": {"Remark": "1000 advance paidXinXfull"}},
        ]
        pg.run(lambda pool: _load(pool, recs))
        assert ids(body(query(pg, q="100%"))) == ["recPct"]
        assert ids(body(query(pg, q="paid_in"))) == ["recUnd"]
        assert body(query(pg, q="%"))["records"][0]["id"] == "recPct"
        assert body(query(pg, q="\\"))["records"] == []


# ---------------------------------------------------------------------------
# Filters and conditions: SQL against the Python port of the page's rules
# ---------------------------------------------------------------------------

FILTER_CASES = [
    {},
    {"status": "Pending"}, {"status": "Paid"}, {"status": "Cancelled"},
    {"project": "Innovine"}, {"project": "Unassigned"},
    {"client": "Birla Open Minds"}, {"client": "Maitrimetal"},
    {"category": "ZOHO"}, {"raised_by": "am@theworks.in"},
    {"billing": "retainer"}, {"billing": "project"},
    {"month": "2026-09"}, {"month": "2026-03", "tz": 330}, {"month": "2026-02", "tz": -300},
    {"aging": "0-14d"}, {"aging": "15-30d"}, {"aging": "31-60d"}, {"aging": "60d+"},
    {"date_from": "2026-01-01", "date_to": "2026-06-30"},
    {"date_field": "Cleared Date", "date_from": "2026-05-01"},
    {"date_field": "Next followup", "date_to": "2026-10-30"},
    {"overdue": True}, {"has_docs": True}, {"followup_due": True},
    {"q": "retainer"}, {"q": "wm/26-27/10"}, {"q": "utr"},
    {"q": "innovine", "status": "Pending", "billing": "retainer"},
    {"conditions": json.dumps([{"field": "Amount Raised", "op": "gte", "value": "100000"}])},
    {"conditions": json.dumps([{"field": "Amount Received", "op": "lt", "value": 25000}])},
    {"conditions": json.dumps([{"field": "Client Name", "op": "is_empty", "value": ""}])},
    {"conditions": json.dumps([{"field": "Project", "op": "starts_with", "value": "inno"},
                               {"field": "Milestone", "op": "is_not", "value": "advance"}])},
    {"conditions": json.dumps([{"field": "Description", "op": "contains", "value": "crm"}])},
    {"conditions": json.dumps([{"field": "Remark", "op": "not_contains", "value": "follow"}])},
    {"conditions": json.dumps([{"field": "Invoice Number", "op": "ends_with", "value": "7"}])},
    {"conditions": json.dumps([{"field": "Raised Date", "op": "date_before", "value": "2026-04-01"}])},
    {"conditions": json.dumps([{"field": "Next followup", "op": "date_after", "value": "2026-10-29"}])},
    {"conditions": json.dumps([{"field": "Cleared Date", "op": "date_is_not", "value": "2026-01-01"}])},
    {"conditions": json.dumps([{"field": "Raised By", "op": "is_not_empty", "value": ""},
                               {"field": "Payment Status", "op": "is", "value": "paid"}])},
    {"conditions": json.dumps([{"field": "Amount Raised", "op": "eq", "value": "not a number"}])},
    {"conditions": json.dumps([{"field": "Project", "op": "", "value": "x"}])},   # incomplete: ignored
]


class TestFilters:
    @pytest.mark.parametrize("params", FILTER_CASES, ids=lambda p: json.dumps(p)[:70])
    def test_sql_picks_what_the_page_rules_pick(self, data, params):
        env, recs = data
        got = body(query(env, limit=1000, **params))
        want = python_answer(recs, **params)
        assert sorted(ids(got)) == sorted(ids(want))
        assert got["total"] == want["total"]
        close(got["aggregates"], want["aggregates"])
        assert got["filtered"] == bool(iq.build_query(**params).filtered)

    def test_filters_actually_narrow(self, data):
        env, recs = data
        total = body(query(env))["total"]
        assert total == len(recs)
        for params in ({"status": "Pending"}, {"q": "retainer"}, {"aging": "60d+"}, {"has_docs": True}):
            n = body(query(env, **params))["total"]
            assert 0 < n < total, params

    def test_owner_scope_is_case_insensitive_and_exclusive(self, data):
        env, recs = data
        qry = iq.build_query()

        async def go(pool):
            return await iq.query_mirror(pool, qry, "AM@theworks.IN", limit=500, cursor=None, offset=0,
                                         aggregates=True, now=NOW)
        got = env.run(go)
        want = [r["id"] for r in recs if str(r["fields"].get("Raised By", "")).lower() == "am@theworks.in"]
        assert sorted(r["id"] for r in got["records"]) == sorted(want)
        assert got["workspace"]["count"] == len(want)

    @pytest.mark.parametrize("bad", [
        {"sort": "fields"}, {"sort": "Raised Date; DROP TABLE invoices_mirror"}, {"order": "sideways"},
        {"billing": "everything"}, {"aging": "90d"}, {"month": "2026-13"}, {"date_from": "yesterday"},
        {"date_field": "Created"}, {"conditions": "not json"}, {"conditions": json.dumps({"a": 1})},
        {"conditions": json.dumps([{"field": "fields->>'x'", "op": "is", "value": "1"}])},
        {"conditions": json.dumps([{"field": "Amount Raised", "op": "contains", "value": "1"}])},
        {"conditions": json.dumps([{"field": "Project", "op": "regex", "value": ".*"}])},
    ])
    def test_unknown_input_is_refused(self, bad):
        with pytest.raises(HTTPException) as e:
            RI._scope_params(**{**{k: None for k in ("q", "status", "project", "client", "category", "raised_by",
                                                        "billing", "month", "aging", "date_field", "date_from",
                                                        "date_to", "conditions", "sort", "order")},
                                 "overdue": False, "has_docs": False, "followup_due": False, "tz": 0, **bad})
        assert e.value.status_code == 400


# ---------------------------------------------------------------------------
# Sorting and paging
# ---------------------------------------------------------------------------

class TestSortingAndPaging:
    @pytest.mark.parametrize("sort", list(iq.SORTS))
    @pytest.mark.parametrize("order", ["asc", "desc"])
    def test_order_matches_and_cursor_pages_have_no_gaps(self, data, sort, order):
        env, recs = data
        full = ids(body(query(env, limit=200, sort=sort, order=order, aggregates=False)))
        # The whole list in Python, same rule.
        want = ids(python_answer(recs, aggregates=False, sort=sort, order=order))
        assert full == want[:200]
        walked, cursor, pages = [], None, 0
        while True:
            resp = body(query(env, limit=37, cursor=cursor, sort=sort, order=order, aggregates=False))
            walked += ids(resp)
            assert resp["total"] == len(recs)
            cursor = resp["next_cursor"]
            pages += 1
            if not cursor:
                break
        assert walked == want, "keyset walk differs from the full order"
        assert len(set(walked)) == len(recs) and pages == math.ceil(len(recs) / 37)

    def test_filtered_walk_and_offset_agree(self, data):
        env, recs = data
        params = {"status": "Paid", "sort": "Amount Raised", "order": "desc"}
        want = ids(python_answer(recs, aggregates=False, **params))
        walked, cursor = [], None
        while True:
            resp = body(query(env, limit=10, cursor=cursor, aggregates=False, **params))
            walked += ids(resp)
            cursor = resp["next_cursor"]
            if not cursor:
                break
        by_offset = []
        for off in range(0, len(want), 10):
            by_offset += ids(body(query(env, limit=10, offset=off, aggregates=False, **params)))
        assert walked == want == by_offset

    def test_rows_added_mid_walk_neither_repeat_nor_shift(self, data):
        env, recs = data
        first = body(query(env, limit=50, aggregates=False))
        newer = {"id": "recZZnewest", "fields": {"Invoice Number": "NEW-1", "Raised Date": _iso(NOW)}}
        env.run(lambda pool: _load(pool, [newer]))
        second = body(query(env, limit=50, cursor=first["next_cursor"], aggregates=False))
        assert not set(ids(first)) & set(ids(second))
        assert "recZZnewest" not in ids(second)

    @pytest.mark.parametrize("cursor", [
        "garbage!!", "e30", "eyJzIjoiUHJvamVjdCIsIm8iOiJkZXNjIiwidCI6InMiLCJrIjoieCIsImkiOiJyZWMxIn0",
        "eyJzIjoiUmFpc2VkIERhdGUiLCJvIjoiZGVzYyIsInQiOiJmIiwiayI6IjE7IERST1AgVEFCTEUgeCIsImkiOiJyZWMxIn0",
    ])
    def test_a_foreign_or_forged_cursor_is_refused(self, data, cursor):
        env, _ = data
        with pytest.raises(HTTPException) as e:
            query(env, cursor=cursor)
        assert e.value.status_code == 400

    def test_limit_is_bounded(self):
        import inspect
        sig = inspect.signature(RI.query_invoices)
        lim = sig.parameters["limit"].default
        assert lim.default == 50
        assert any(getattr(m, "le", None) == 200 for m in lim.metadata)


# ---------------------------------------------------------------------------
# Aggregates
# ---------------------------------------------------------------------------

def brute(recs, keep=lambda f: True):
    """Plain loops over the raw records: the numbers the cards should show."""
    out = {"count": 0, "raised": 0.0, "with_tax": 0.0, "collected": 0.0, "outstanding": 0.0,
           "paid": 0, "pending": 0, "missing_docs": 0, "followups": 0, "projects": {}}
    for r in recs:
        f = r["fields"]
        if not keep(f):
            continue
        st = f.get("Payment Status")
        raised = float(f.get("Amount Raised") or 0)
        wt = float(f.get("Amount with Tax") or 0)
        rec = float(f.get("Amount Received") or 0)
        out["count"] += 1
        out["paid"] += st == "Paid"
        out["pending"] += st == "Pending"
        refs = len(f.get("Reference") or []) + len(f.get("Invoice PDF") or [])
        out["missing_docs"] += refs == 0
        fu = f.get("Next followup")
        out["followups"] += bool(fu) and fu[:10] <= NOW.date().isoformat()
        p = out["projects"].setdefault(f.get("Project") or "Unassigned", {"raised": 0.0, "received": 0.0, "open": 0.0, "count": 0})
        p["count"] += 1
        if st == "Cancelled":
            continue
        out["raised"] += raised
        out["with_tax"] += wt
        p["raised"] += raised
        if st == "Paid":
            got = rec if rec > 0 else raised
            out["collected"] += got
            p["received"] += got
        else:
            out["outstanding"] += raised
            p["open"] += raised
    return out


class TestAggregates:
    @pytest.mark.parametrize("params,keep", [
        ({}, lambda f: True),
        ({"status": "Pending"}, lambda f: f.get("Payment Status") == "Pending"),
        ({"project": "PMS"}, lambda f: f.get("Project") == "PMS"),
        ({"billing": "retainer"}, lambda f: "retainer" in (f.get("Category") or "").lower()),
        ({"q": "zoho"}, lambda f: any("zoho" in str(f.get(k) or "").lower()
                                       for k in ("Project", "Category", "Description", "Client Name", "Client"))),
    ])
    def test_totals_equal_a_brute_force_sum(self, data, params, keep):
        env, recs = data
        agg = body(query(env, **params))["aggregates"]
        b = brute(recs, keep)
        assert agg["count"] == b["count"] and agg["paid_count"] == b["paid"] and agg["pending_count"] == b["pending"]
        for k in ("raised", "with_tax", "collected", "outstanding"):
            assert math.isclose(agg[k], round(b[k], 2), abs_tol=0.011), k
        rate = round(b["collected"] / b["with_tax"] * 100, 2) if b["with_tax"] else 0.0
        assert math.isclose(agg["collection_rate"], rate, abs_tol=0.011)
        assert agg["missing_docs"] == b["missing_docs"] and agg["followups_due"] == b["followups"]
        for p in agg["by_project"]:
            bp = b["projects"][p["project"]]
            assert p["count"] == bp["count"]
            assert math.isclose(p["raised"], round(bp["raised"], 2), abs_tol=0.011)
            assert math.isclose(p["received"], round(bp["received"], 2), abs_tol=0.011)
            assert math.isclose(p["outstanding"], round(bp["open"], 2), abs_tol=0.011)

    def test_workspace_matches_the_summary_the_cards_used_to_show(self, data):
        env, recs = data
        got = body(query(env, q="innovine"))
        ws = got["workspace"]
        summary = InvoiceService()._compute_summary([dict(r) for r in recs])
        assert ws["count"] == summary["total_invoices"] and ws["active_count"] == summary["active_invoices"]
        for mine, theirs in (("raised", "total_raised"), ("with_tax", "total_with_tax"), ("gst", "total_gst"),
                             ("tds", "total_tds"), ("collected", "total_received"),
                             ("outstanding", "total_outstanding"), ("collection_rate", "collection_rate")):
            assert math.isclose(ws[mine], summary[theirs], abs_tol=0.011), mine
        assert {k: v["count"] for k, v in ws["by_status"].items()} == \
            {("Unknown" if k is None else k): v for k, v in summary["by_status"].items()}
        # Filtered and unfiltered are different numbers, side by side.
        assert got["aggregates"]["count"] < ws["count"]
        assert set(got["aggregates"]) == set(ws) - {"facets", "recent_projects", "overdue_top"}

    def test_workspace_extras(self, data):
        env, recs = data
        ws = body(query(env))["workspace"]
        want = python_answer(recs)["workspace"]
        close(ws, want)
        assert ws["facets"]["clients"] == sorted(set(CLIENTS) & {r["fields"].get("Client Name") or r["fields"].get("Client") for r in recs})
        assert len(ws["overdue_top"]) == 5 and ws["overdue_top"][0]["aging"] >= ws["overdue_top"][-1]["aging"]
        assert len(ws["recent_projects"]) <= 4

    def test_aggregates_can_be_skipped(self, data):
        env, recs = data
        got = body(query(env, aggregates=False, status="Paid", limit=5))
        assert "aggregates" not in got and "workspace" not in got
        assert got["total"] == sum(r["fields"].get("Payment Status") == "Paid" for r in recs)


# ---------------------------------------------------------------------------
# HTTP behaviour, fallbacks, hostile input
# ---------------------------------------------------------------------------

class TestEtag:
    def test_unchanged_data_answers_304(self, data):
        env, _ = data
        first = query(env, q="innovine")
        tag = first.headers["etag"]
        assert first.status_code == 200 and tag
        again = query(env, q="innovine", headers={"if-none-match": tag})
        assert again.status_code == 304 and not again.body
        other = query(env, q="pms", headers={"if-none-match": tag})
        assert other.status_code == 200

    def test_a_change_changes_the_etag(self, data):
        env, recs = data
        tag = query(env).headers["etag"]
        changed = {**recs[0], "fields": {**recs[0]["fields"], "Remark": "edited"}}
        env.run(lambda pool: _load(pool, [changed]))
        from app.utils.cache import cache
        cache.bust(prefix="invoice:")
        assert query(env, headers={"if-none-match": tag}).status_code == 200


class TestInjection:
    HOSTILE = [
        "'; DROP TABLE invoices_mirror; --", "\" OR 1=1 --", "x' OR '1'='1", "%' OR 1=1 --",
        "$1", "\\'; SELECT pg_sleep(5); --", "Robert'); DELETE FROM invoices_mirror;--",
    ]

    @pytest.mark.parametrize("value", HOSTILE)
    def test_hostile_text_is_data(self, data, value):
        env, recs = data
        for params in ({"q": value}, {"status": value}, {"project": value}, {"client": value},
                       {"category": value}, {"raised_by": value},
                       {"conditions": json.dumps([{"field": "Project", "op": "contains", "value": value}])}):
            got = body(query(env, **params))
            assert got["total"] == 0 and got["records"] == [], params
        # A number rule keeps only the digits of its value, as the page's
        # FilterBuilder does; whatever is left is compared as a number.
        params = {"conditions": json.dumps([{"field": "Amount Raised", "op": "gt", "value": value}])}
        assert body(query(env, **params))["total"] == python_answer(recs, **params)["total"]
        assert body(query(env))["total"] == len(recs)
        assert env.sql("SELECT count(*) FROM invoices_mirror")[0][0] == len(recs)


class TestFallbacks:
    def test_without_postgres_the_same_answer_comes_from_teable(self, data, monkeypatch):
        env, recs = data
        params = {"q": "retainer", "status": "Pending", "sort": "Amount Raised", "order": "asc"}
        from_mirror = body(query(env, **params))

        async def teable(self, raised_by=None):
            return [dict(r) for r in recs]
        monkeypatch.setattr(InvoiceService, "get_all_invoices", teable)
        monkeypatch.setattr(RI._pg, "get_pool", lambda: None)
        qry = iq.build_query(**params)
        from_teable = body(asyncio.run(RI.query_invoices(request(), qry=qry, limit=200, cursor=None, offset=0,
                                                         aggregates=True, _role="editor", _perm="x")))
        assert from_teable["source"] == "teable" and from_mirror["source"] == "mirror"
        assert ids(from_teable) == ids(from_mirror)
        close(from_teable["aggregates"], from_mirror["aggregates"])
        close(from_teable["workspace"], from_mirror["workspace"])

    def test_an_empty_mirror_is_not_an_answer(self, pg, frozen, monkeypatch):
        recs = make_invoices(5)

        async def teable(self, raised_by=None):
            return recs
        monkeypatch.setattr(InvoiceService, "get_all_invoices", teable)
        got = body(query(pg))
        assert got["source"] == "teable" and got["total"] == 5

    def test_a_mirror_without_the_migration_falls_back(self, pg_upto, frozen, monkeypatch):
        env = pg_upto("0008_ai_gateway_v2")
        recs = make_invoices(4)
        env.run(lambda pool: _load(pool, recs))

        async def teable(self, raised_by=None):
            return recs
        monkeypatch.setattr(InvoiceService, "get_all_invoices", teable)
        got = body(query(env, q="wm"))
        assert got["source"] == "teable" and got["total"] == 4


class TestExport:
    def _csv(self, env, **params):
        qry = iq.build_query(**params)

        async def go(pool):
            resp = await RI.export_invoices(request(), qry=qry, _role="editor", _perm="x")
            chunks = [c async for c in resp.body_iterator]
            return resp, "".join(c if isinstance(c, str) else c.decode() for c in chunks)
        return env.run(go)

    def test_exports_the_whole_filtered_scope_in_order(self, data, monkeypatch):
        env, recs = data
        monkeypatch.setattr(iq, "EXPORT_BATCH", 7)   # several batches
        params = {"status": "Paid", "sort": "Amount Raised", "order": "desc"}
        resp, text = self._csv(env, **params)
        rows = list(csv.reader(io.StringIO(text)))
        want = python_answer(recs, aggregates=False, **params)["records"]
        assert rows[0][0] == "Invoice Number" and len(rows) - 1 == len(want) > 7
        assert [r[0] for r in rows[1:]] == [w["fields"]["Invoice Number"] for w in want]
        assert "filtered" in resp.headers["content-disposition"]

    def test_formula_text_is_neutralised_and_numbers_stay_numbers(self, pg, frozen):
        rec = {"id": "recF", "fields": {"Invoice Number": "F-1", "Remark": "=HYPERLINK(\"https://evil\")",
                                         "Outstanding Amount": -250, "Amount Raised": 1500.5, "Client Name": "Acme"}}
        pg.run(lambda pool: _load(pool, [rec]))
        _, text = self._csv(pg)
        header, row = list(csv.reader(io.StringIO(text)))
        cells = dict(zip(header, row))
        assert cells["Remark"].startswith("'=HYPERLINK")
        assert cells["Outstanding Amount"] == "-250" and cells["Amount Raised"] == "1500.5"
        assert cells["Client"] == "Acme"


# ---------------------------------------------------------------------------
# Migration 0009
# ---------------------------------------------------------------------------

class TestMigration:
    PATH = pg_harness.BACKEND / "migrations/versions/0009_invoice_query.py"

    def test_upgrade_backfills_downgrade_removes_upgrade_again(self, pg_upto):
        env = pg_upto("0008_ai_gateway_v2")
        recs = [{"id": "recM1", "fields": {
            "Client": "Old Client", "Raised Date": "2026-03-01T18:30:00.000Z", "Remark": "Hello",
            "Reference": [{"name": "proof.png"}], "Invoice PDF": "a.pdf https://x/a.pdf b.pdf https://x/b.pdf",
            "Outstanding Amount": "1200.50", "Next followup": "2026-10-19"}}]
        env.run(lambda pool: _load(pool, recs))
        up = pg_harness.migration_statements(self.PATH)
        down = pg_harness.migration_statements(self.PATH, "downgrade")
        for s in up:
            env.execute(s)
        row = env.sql("SELECT client_name, doc_count, outstanding_amount, raised_at, followup_at, search_text "
                      "FROM invoices_mirror WHERE teable_id = 'recM1'")[0]
        assert row["client_name"] == "Old Client" and row["doc_count"] == 3
        assert float(row["outstanding_amount"]) == 1200.5
        assert row["raised_at"] == datetime(2026, 3, 1, 18, 30, tzinfo=timezone.utc)
        assert row["followup_at"] == datetime(2026, 10, 19, tzinfo=timezone.utc)
        assert row["search_text"] == "old client\nhello\nproof.png"
        idx = {r[0] for r in env.sql("SELECT indexname FROM pg_indexes WHERE tablename = 'invoices_mirror'")}
        assert {"im_live_raised_key_idx", "im_live_owner_idx", "im_search_trgm_idx"} <= idx
        for s in down:
            env.execute(s)
        cols = {r[0] for r in env.sql("SELECT column_name FROM information_schema.columns "
                                      "WHERE table_name = 'invoices_mirror'")}
        assert "search_text" not in cols and "raised_at" not in cols
        for s in up:
            env.execute(s)
        assert env.sql("SELECT search_text FROM invoices_mirror")[0][0] == "old client\nhello\nproof.png"

    def test_generated_text_matches_the_python_rule(self, pg, frozen):
        recs = make_invoices(80, seed=11)
        pg.run(lambda pool: _load(pool, recs))
        from app.services.invoice_common import invoice_search_text
        got = {r["teable_id"]: r["search_text"] for r in pg.sql("SELECT teable_id, search_text FROM invoices_mirror")}
        for r in recs:
            assert got[r["id"]] == invoice_search_text(r["fields"]), r["id"]
