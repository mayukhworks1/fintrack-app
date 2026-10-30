"""
Timings for the Projects, Tax Ledger and Web Invoices lists, at today's size
and at 50,000 rows per table.

Opt-in (it seeds 150,000 rows): FINTRACK_PERF=1 python -m pytest
tests/test_list_queries_perf_pg.py -s. Invoice rows carry attachment URLs the
size Teable's presigned links are, so `fields` is stored out of line as in
production, as in test_invoice_query_perf_pg.py.

For each page it prints the median of five runs of: the first page with its
totals, a common search, a rare search, a filter, another sort, and a deep
"Show more" page through the cursor. "cold" has no cached totals; "typical"
has the workspace totals cached, as within 15 s of the page's last read.
"""

from __future__ import annotations

import json
import os
import statistics
import time

import pytest

from app.db.sync import _extract_invoice, _extract_project, _extract_web_invoice
from app.utils.cache import cache
from tests.test_invoice_query_perf_pg import _heavy
from tests.test_invoice_query_pg import body, frozen, make_invoices  # noqa: F401
from tests.test_list_queries_pg import inv_query, make_projects, make_web_invoices, proj_query, web_query

pytestmark = pytest.mark.skipif(os.environ.get("FINTRACK_PERF") != "1", reason="set FINTRACK_PERF=1 to run")

# Today's tables are small; these stand in for them.
REAL = {"projects": 30, "web_invoices": 150, "invoices": 28}


async def _bulk(pool, table, extractor, records):
    cols = list(extractor({}))
    rows = [(r["id"], json.dumps(r["fields"]), *extractor(r["fields"]).values()) for r in records]
    phs = ", ".join(f"${i + 3}" for i in range(len(cols)))
    await pool.executemany(
        f"INSERT INTO {table} (teable_id, fields, {', '.join(cols)}) VALUES ($1, $2::jsonb, {phs})", rows)


def _seed(env, table, extractor, records):
    for i in range(0, len(records), 5000):
        chunk = records[i:i + 5000]
        env.run(lambda pool: _bulk(pool, table, extractor, chunk))
    env.execute(f"ANALYZE {table}")


PAGES = {
    "projects": (proj_query, "project:", [
        ("first page + totals", {}),
        ("search q=atlas (common)", {"q": "atlas"}),
        ("search q=portal 41999 (rare)", {"q": "portal 41999"}),
        ("filter status=active, client=BG", {"status": "active", "client": "BG"}),
        ("sort Profit percentage asc", {"sort": "Profit percentage", "order": "asc"}),
    ]),
    "tax_ledger": (inv_query, "invoice:", [
        ("first page + totals (FY 2025)", {"tax_scope": "tax", "period": "fy-2025", "tz": 330}),
        ("search q=innovine (common)", {"tax_scope": "tax", "period": "fy-2025", "q": "innovine", "tz": 330}),
        ("search q=wm/26-27/14999 (rare)", {"tax_scope": "all", "period": "fy-2025", "q": "wm/26-27/14999", "tz": 330}),
        ("filter open, Q3 2026", {"tax_scope": "open", "period": "q3-2026", "tz": 330}),
        ("sort Amount Raised asc", {"tax_scope": "all", "period": "cy-2026", "sort": "Amount Raised", "order": "asc"}),
    ]),
    "web_invoices": (web_query, "webinv:", [
        ("first page + totals", {}),
        ("search q=innovine (common)", {"q": "innovine"}),
        ("search q=wm/26-27/14999 (rare)", {"q": "wm/26-27/14999"}),
        ("filter status=Pending & project=PMS", {"status": "Pending", "project": "PMS"}),
        ("sort Amount Raised asc", {"sort": "Amount Raised", "order": "asc"}),
    ]),
}


def _report(env, page, n):
    fn, prefix, shapes = PAGES[page]
    print(f"\n=== {page}: {n} rows ===  (median of 5)")
    for name, params in shapes:
        cold, warm, resp = [], [], None
        for _ in range(5):
            cache.bust(prefix=prefix)
            t = time.perf_counter()
            resp = fn(env, limit=50, **params)
            cold.append((time.perf_counter() - t) * 1000)
            for key in ("q:scope:", "q:tax:"):
                cache.bust(prefix=prefix + key)
            t = time.perf_counter()
            fn(env, limit=50, **params)
            warm.append((time.perf_counter() - t) * 1000)
        b = body(resp)
        print(f"{name:40s} cold {statistics.median(cold):7.1f} ms   typical {statistics.median(warm):7.1f} ms"
              f"   total={b['total']:>6}  bytes={len(resp.body):>7}")
    base = dict(shapes[0][1])
    b = body(fn(env, limit=200, aggregates=False, **base))
    cursor = b["next_cursor"]
    for _ in range(20):
        if not cursor:
            break
        b = body(fn(env, limit=200, aggregates=False, cursor=cursor, **base))
        cursor = b["next_cursor"] or cursor
    times = []
    for _ in range(5):
        t = time.perf_counter()
        fn(env, limit=50, aggregates=False, cursor=cursor, **base)
        times.append((time.perf_counter() - t) * 1000)
    print(f"{'show more, deep page (cursor)':40s} {statistics.median(times):8.1f} ms")


def test_timings_at_real_size_and_50k(pg, frozen):
    for size in (None, 50_000):
        for table in ("projects_mirror", "web_invoices_mirror", "invoices_mirror"):
            pg.execute(f"TRUNCATE {table}")
        n_p = size or REAL["projects"]
        n_w = size or REAL["web_invoices"]
        n_i = size or REAL["invoices"]
        t = time.perf_counter()
        _seed(pg, "projects_mirror", _extract_project, make_projects(n_p, seed=9))
        _seed(pg, "web_invoices_mirror", _extract_web_invoice, _heavy(make_web_invoices(n_w, seed=4)))
        _seed(pg, "invoices_mirror", _extract_invoice, _heavy(make_invoices(n_i, seed=5)))
        if size:
            print(f"\nseeded 3 x {size:,} in {time.perf_counter() - t:.1f} s")
        _report(pg, "projects", n_p)
        _report(pg, "tax_ledger", n_i)
        _report(pg, "web_invoices", n_w)

    for fn, prefix, shapes in PAGES.values():
        cache.bust(prefix=prefix)
        t = time.perf_counter()
        fn(pg, limit=50, **shapes[0][1])
        assert (time.perf_counter() - t) < 3.0
