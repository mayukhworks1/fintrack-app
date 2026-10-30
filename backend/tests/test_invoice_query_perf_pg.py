"""
Timings and plans for GET /api/invoices/query at 28 and 50,000 invoices.

Opt-in (it seeds 50,000 rows): FINTRACK_PERF=1 python -m pytest
tests/test_invoice_query_perf_pg.py -s. Each row carries attachment URLs the
size Teable's presigned links are, so `fields` is stored out of line as in
production and a query that opened it for every row would show.

Prints the median of several runs for each request shape and the plan of the
page and total queries; asserts only generous ceilings.
"""

from __future__ import annotations

import json
import os
import statistics
import time
from pathlib import Path

import pytest

from app.services import invoice_query as iq
from app.utils.cache import cache
from tests.test_invoice_query_pg import NOW, _bulk, body, frozen, make_invoices, query  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("FINTRACK_PERF") != "1", reason="set FINTRACK_PERF=1 to run")

RECORDED = Path(os.environ.get("FINTRACK_PERF_RECORDS", "")) if os.environ.get("FINTRACK_PERF_RECORDS") else None
URL = "https://s3.us-west-2.amazonaws.com/storage-private.teable.io/table/" + "x" * 1200


def _heavy(records):
    for r in records:
        for key in ("Reference", "Invoice PDF"):
            if key in r["fields"]:
                r["fields"][key] = [{**a, "presignedUrl": URL, "smThumbnailUrl": URL} for a in r["fields"][key]]
    return records


SHAPES = [
    ("first page + totals", dict()),
    ("search q=innovine (common)", dict(q="innovine")),
    ("search q=wm/26-27/14999 (rare)", dict(q="wm/26-27/14999")),
    ("search 3 words", dict(q="wm 26-27 retainer")),
    ("status=Pending & project=PMS", dict(status="Pending", project="PMS")),
    ("billing=retainer & month", dict(billing="retainer", month="2026-05", tz=330)),
    ("aging 60d+", dict(aging="60d+")),
    ("sort Amount Raised asc", dict(sort="Amount Raised", order="asc")),
    ("advanced rule amount >= 100000", dict(conditions=json.dumps([{"field": "Amount Raised", "op": "gte", "value": 100000}]))),
]


def _time(env, n, **kw):
    out = []
    for _ in range(n):
        t = time.perf_counter()
        resp = query(env, **kw)
        out.append((time.perf_counter() - t) * 1000)
    return statistics.median(out), resp


def _report(env, label_rows):
    print(f"\n=== {label_rows} invoices ===  (median of 5; 'cold' = no cached totals, "
          f"'typical' = workspace totals cached, as within 15 s of the page's last read)")
    for name, params in SHAPES:
        cold, warm = [], []
        resp = None
        for _ in range(5):
            cache.bust(prefix="invoice:")
            t = time.perf_counter()
            resp = query(env, limit=50, **params)
            cold.append((time.perf_counter() - t) * 1000)
            cache.bust(prefix="invoice:q:scope:")
            t = time.perf_counter()
            query(env, limit=50, **params)
            warm.append((time.perf_counter() - t) * 1000)
        b = body(resp)
        print(f"{name:34s} cold {statistics.median(cold):7.1f} ms   typical {statistics.median(warm):7.1f} ms"
              f"   total={b['total']:>6}  bytes={len(resp.body):>7}")
    # Deep keyset page, aggregates off (what "Show more" sends).
    b = body(query(env, limit=200, aggregates=False))
    cursor = b["next_cursor"]
    for _ in range(20):
        b = body(query(env, limit=200, aggregates=False, cursor=cursor))
        cursor = b["next_cursor"] or cursor
    ms, _ = _time(env, 5, limit=50, aggregates=False, cursor=cursor)
    print(f"{'show more, page ~4,000 (cursor)':42s} {ms:8.1f} ms")
    ms, _ = _time(env, 5, limit=50, aggregates=False, offset=4000)
    print(f"{'offset=4000 (for comparison)':42s} {ms:8.1f} ms")


def _plans(env):
    p = iq._Params(NOW, 0)
    qry = iq.build_query()
    where = iq.where_sql(qry, None, p)
    page = iq._page_sql(qry, where, p, None, 50, 0)
    p2 = iq._Params(NOW, 0)
    qs = iq.build_query(q="innovine retainer")
    where2 = iq.where_sql(qs, None, p2)
    agg = iq.aggregate_sql(where2, iq.GROUPS_SCOPE)
    p3 = iq._Params(NOW, 0)
    qr = iq.build_query(q="wm/26-27/14999")
    where3 = iq.where_sql(qr, None, p3)
    p4 = iq._Params(NOW, 0)
    ws = iq.aggregate_sql(iq.where_sql(iq.build_query(), None, p4), iq.GROUPS_SCOPE + iq.GROUPS_FACETS)
    for title, sql, vals in (("default page", page, p.values),
                             ("common search page", iq._page_sql(qs, where2, p2, None, 50, 0), p2.values),
                             ("common search totals (GROUPING SETS)", agg, p2.values),
                             ("rare search totals", iq.aggregate_sql(where3, iq.GROUPS_SCOPE), p3.values),
                             ("workspace totals + facets", ws, p4.values)):
        rows = env.sql("EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) " + sql, *vals)
        print(f"\n--- plan: {title} ---")
        for r in rows:
            print(r[0])


def test_timings_at_28_and_50k(pg, frozen):
    if RECORDED and RECORDED.exists():
        real = json.loads(RECORDED.read_text())["records"]
    else:
        real = _heavy(make_invoices(28, seed=3))
    pg.run(lambda pool: _bulk(pool, real))
    pg.execute("ANALYZE invoices_mirror")
    _report(pg, len(real))

    pg.execute("TRUNCATE invoices_mirror")
    big = _heavy(make_invoices(50_000, seed=5))
    t = time.perf_counter()
    for i in range(0, len(big), 5000):
        chunk = big[i:i + 5000]
        pg.run(lambda pool: _bulk(pool, chunk))
    pg.execute("ANALYZE invoices_mirror")
    print(f"\nseeded 50,000 in {time.perf_counter() - t:.1f} s; table size",
          pg.sql("SELECT pg_size_pretty(pg_total_relation_size('invoices_mirror'))")[0][0])
    _report(pg, 50_000)
    _plans(pg)

    cache.bust(prefix="invoice:")
    t = time.perf_counter()
    query(pg, limit=50)
    assert (time.perf_counter() - t) < 3.0
