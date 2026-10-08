"""
Cover for the web_projects PG mirror.

web_project.py was the last Teable-backed service reading live on every request
— 15 remote calls, no replica — while projects, invoices, web invoices and
status all read a mirror. list_projects now reads web_projects_mirror and falls
back to Teable whenever the mirror cannot be trusted to answer.

The two failure modes worth guarding are silent ones:
  * an extractor key with no matching column — upsert_record builds its INSERT
    from those keys, so a typo fails on the first write, not at import;
  * an unpopulated mirror answering "no projects" instead of falling back,
    which looks like data loss on a fresh deploy.
"""

import asyncio
import itertools
import re

import pytest

import app.services.web_project as web_project
from app.config import settings
from app.db.sync import _extract_web_project, _table_config


def _table_columns(table: str) -> set[str]:
    schema = open("app/db/postgres.py", encoding="utf-8").read()
    body = re.search(r"CREATE TABLE IF NOT EXISTS %s \((.*?)\n\);" % table, schema, re.S).group(1)
    cols = set()
    for line in body.split("\n"):
        line = line.strip().rstrip(",")
        if line and not line.startswith("--"):
            cols.add(line.split()[0])
    return cols


class TestSchemaMatchesExtractor:
    def test_every_extractor_key_is_a_real_column(self):
        missing = set(_extract_web_project({})) - _table_columns("web_projects_mirror")
        assert not missing, f"extractor would INSERT non-existent columns: {missing}"

    def test_webhook_routing_resolves_the_table(self):
        assert _table_config(settings.teable_web_projects_table_id) == (
            "web_projects", "web_projects_mirror", _extract_web_project,
        )

    def test_cache_prefix_is_registered(self):
        # The source name and the service's cache namespace differ
        # ("web_projects" vs "webproj:"), so busting by source would clear
        # nothing — the same trap SOURCE_CACHE_PREFIXES exists to document.
        from app.db.sync import SOURCE_CACHE_PREFIXES
        assert SOURCE_CACHE_PREFIXES["web_projects"] == ("webproj:",)


class TestExtractor:
    def test_dates_become_date_objects(self):
        import datetime
        out = _extract_web_project({"Est. Start Date": "2026-04-01T00:00:00.000Z"})
        # asyncpg rejects strings for DATE columns with "invalid input for $N".
        assert isinstance(out["est_start_date"], datetime.date)

    def test_numeric_strings_coerce(self):
        assert _extract_web_project({"Client Charge": "650000"})["client_charge"] == 650000.0

    @pytest.mark.parametrize("record", [
        {}, {"Progress (%)": ""}, {"Estimated Budget": "not-a-number"}, {"Est. End Date": "garbage"},
    ])
    def test_junk_and_missing_values_do_not_raise(self, record):
        _extract_web_project(record)

    def test_long_strings_are_truncated_to_column_width(self):
        out = _extract_web_project({"Project Name": "x" * 400, "Status": "y" * 200})
        assert len(out["project_name"]) <= 255
        assert len(out["status"]) <= 60


def _list(svc, **kw):
    base = dict(status=None, client=None, priority=None, limit=50, skip=0,
                order_by="Project Name", order="asc")
    base.update(kw)
    return asyncio.run(svc._list_from_pg(**base))


class TestQueryShape:
    def test_placeholders_match_params_for_every_filter_combination(self, monkeypatch):
        captured = {}

        class Pool:
            async def fetch(self, sql, *params):
                captured["sql"], captured["params"] = sql, params
                return []
            async def fetchval(self, *a):
                return None

        monkeypatch.setattr(web_project, "get_pool", lambda: Pool())
        svc = web_project.WebProjectService()

        for status, client, priority, order_by in itertools.product(
            [None, "Active"], [None, "Acme"], [None, "High"], ["Project Name", "Unmapped Field"]
        ):
            _list(svc, status=status, client=client, priority=priority, order_by=order_by)
            nums = {int(n) for n in re.findall(r"\$(\d+)", captured["sql"])}
            assert nums == set(range(1, len(captured["params"]) + 1))

    def test_unmapped_sort_field_is_bound_not_interpolated(self, monkeypatch):
        captured = {}

        class Pool:
            async def fetch(self, sql, *params):
                captured["sql"], captured["params"] = sql, params
                return []
            async def fetchval(self, *a):
                return None

        monkeypatch.setattr(web_project, "get_pool", lambda: Pool())
        _list(web_project.WebProjectService(), order_by="'; DROP TABLE x; --")
        assert "DROP TABLE" not in captured["sql"]
        assert "'; DROP TABLE x; --" in captured["params"]


class TestFallsBackRatherThanLying:
    def test_no_pool_falls_back(self, monkeypatch):
        monkeypatch.setattr(web_project, "get_pool", lambda: None)
        assert _list(web_project.WebProjectService()) is None

    def test_unpopulated_mirror_falls_back_instead_of_reporting_zero(self, monkeypatch):
        class Empty:
            async def fetch(self, *a):
                return []
            async def fetchval(self, *a):
                return None

        monkeypatch.setattr(web_project, "get_pool", lambda: Empty())
        assert _list(web_project.WebProjectService()) is None

    def test_populated_mirror_with_no_matches_is_a_real_empty_result(self, monkeypatch):
        class NoMatch:
            async def fetch(self, *a):
                return []
            async def fetchval(self, *a):
                return 1

        monkeypatch.setattr(web_project, "get_pool", lambda: NoMatch())
        assert _list(web_project.WebProjectService()) == {"records": [], "total": 0}

    def test_query_error_falls_back(self, monkeypatch):
        class Boom:
            async def fetch(self, *a):
                raise RuntimeError("pg down")
            async def fetchval(self, *a):
                return 1

        monkeypatch.setattr(web_project, "get_pool", lambda: Boom())
        assert _list(web_project.WebProjectService()) is None

    def test_rows_carry_the_window_function_total(self, monkeypatch):
        class Rows:
            async def fetch(self, *a):
                return [{"teable_id": "recA", "fields": {"Project Name": "PMS"}, "total_count": 42}]
            async def fetchval(self, *a):
                return 1

        monkeypatch.setattr(web_project, "get_pool", lambda: Rows())
        out = _list(web_project.WebProjectService())
        assert out["total"] == 42
        assert out["records"][0]["id"] == "recA"


class TestWriteThrough:
    def test_delete_soft_deletes_rather_than_removing(self, monkeypatch):
        calls = []

        class Pool:
            async def execute(self, sql, *params):
                calls.append((sql, params))

        monkeypatch.setattr(web_project, "get_pool", lambda: Pool())
        asyncio.run(web_project._mirror_write_through("recX", None, deleted=True))
        sql, params = calls[0]
        assert "deleted_at = NOW()" in sql and params == ("recX",)

    def test_upsert_delegates_with_the_right_source_and_extractor(self, monkeypatch):
        import app.db.sync as sync
        seen = {}

        async def fake_upsert(pool, source, table, tid, fields, extractor):
            seen.update(source=source, table=table, tid=tid, extractor=extractor.__name__)

        monkeypatch.setattr(web_project, "get_pool", lambda: object())
        monkeypatch.setattr(sync, "upsert_record", fake_upsert)
        asyncio.run(web_project._mirror_write_through("recA", {"Project Name": "PMS"}))
        assert seen == {
            "source": "web_projects", "table": "web_projects_mirror",
            "tid": "recA", "extractor": "_extract_web_project",
        }

    def test_a_mirror_failure_never_fails_an_already_committed_write(self, monkeypatch):
        class Boom:
            async def execute(self, *a):
                raise RuntimeError("pg exploded")

        monkeypatch.setattr(web_project, "get_pool", lambda: Boom())
        # Must not raise: Teable already accepted the write.
        asyncio.run(web_project._mirror_write_through("recA", None, deleted=True))

    def test_missing_pool_is_a_no_op(self, monkeypatch):
        monkeypatch.setattr(web_project, "get_pool", lambda: None)
        asyncio.run(web_project._mirror_write_through("recA", {"Project Name": "x"}))
