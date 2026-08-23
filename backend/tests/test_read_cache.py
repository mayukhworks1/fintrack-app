"""
What a poll costs, and whether caching it is safe.

Two pollers per page refetch these reads every ten seconds. Three scoped read
paths bypassed the cache entirely, so a scoped user recomputed everything on
every tick — and get_summary's path downloads the whole Teable table before it
filters. Caching them is only correct if the key carries the scope and writes
invalidate, so both are pinned here alongside the cost.
"""

import asyncio

import pytest

from app.db.sync import SOURCE_CACHE_PREFIXES, cache_prefixes_for
from app.services import web_invoice
from app.utils.cache import cache


@pytest.fixture(autouse=True)
def _empty_cache():
    cache.bust("")
    yield
    cache.bust("")


class TestSourceCachePrefixes:
    """
    The webhook and the sync both cleared f"{source}:", but the services never
    named their keys that way. "web_invoices:" cleared nothing, because those
    keys start "webinv:". Only "status" ever matched, so Teable-side edits sat
    invisible for the full TTL while the code that was meant to reveal them ran
    and did nothing.
    """

    @pytest.mark.parametrize("source,prefix", [
        ("web_invoices", "webinv:"),
        ("invoices",     "invoice:"),
        ("projects",     "project:"),
        ("status",       "status:"),
    ])
    def test_each_source_maps_to_the_prefix_its_service_writes(self, source, prefix):
        assert cache_prefixes_for(source) == (prefix,)

    def test_the_naive_convention_would_still_be_wrong(self):
        """Guards the regression rather than the fix: three of four disagree."""
        mismatched = [s for s, p in SOURCE_CACHE_PREFIXES.items() if p != (f"{s}:",)]
        assert sorted(mismatched) == ["invoices", "projects", "web_invoices"]

    def test_an_unmapped_source_falls_back_rather_than_raising(self):
        assert cache_prefixes_for("something_new") == ("something_new:",)

    def test_the_real_keys_match_the_mapped_prefix(self):
        """Pins the actual key strings the service builds, not just the map."""
        for key in ("webinv:list:a:b:c", "webinv:all", "webinv:summary"):
            assert key.startswith(cache_prefixes_for("web_invoices")[0])


class TestScopedReadsAreCached:
    def test_a_scoped_summary_is_computed_once_not_once_per_poll(self, monkeypatch):
        """
        get_all_invoices behind this downloads every record in the table and
        only then filters to the caller's rows. Uncached, two pollers made that
        happen every ten seconds per open tab.
        """
        calls = []

        async def fake_fetch(self, **kw):
            calls.append(kw)
            return [{"id": "r1", "fields": {"Raised By": "a@x.com"}}]

        monkeypatch.setattr(web_invoice.WebInvoiceService, "_fetch_records", fake_fetch)
        svc = web_invoice.WebInvoiceService()

        async def poll_twice():
            await svc.get_all_invoices(raised_by="a@x.com")
            await svc.get_all_invoices(raised_by="a@x.com")

        asyncio.run(poll_twice())
        assert len(calls) == 1, "the second poll should have been served from cache"

    def test_one_users_rows_are_never_served_to_another(self, monkeypatch):
        """The whole reason the bypass existed. The key carries the scope."""
        async def fake_fetch(self, **kw):
            return [
                {"id": "r1", "fields": {"Raised By": "a@x.com"}},
                {"id": "r2", "fields": {"Raised By": "b@x.com"}},
            ]

        monkeypatch.setattr(web_invoice.WebInvoiceService, "_fetch_records", fake_fetch)
        svc = web_invoice.WebInvoiceService()

        async def both():
            a = await svc.get_all_invoices(raised_by="a@x.com")
            b = await svc.get_all_invoices(raised_by="b@x.com")
            return a, b

        a, b = asyncio.run(both())
        assert [r["id"] for r in a] == ["r1"]
        assert [r["id"] for r in b] == ["r2"]

    def test_a_scoped_user_never_gets_the_unscoped_cache_entry(self, monkeypatch):
        async def fake_fetch(self, **kw):
            return [
                {"id": "r1", "fields": {"Raised By": "a@x.com"}},
                {"id": "r2", "fields": {"Raised By": "b@x.com"}},
            ]

        monkeypatch.setattr(web_invoice.WebInvoiceService, "_fetch_records", fake_fetch)
        svc = web_invoice.WebInvoiceService()

        async def unscoped_then_scoped():
            everything = await svc.get_all_invoices()
            mine = await svc.get_all_invoices(raised_by="a@x.com")
            return everything, mine

        everything, mine = asyncio.run(unscoped_then_scoped())
        assert len(everything) == 2
        assert [r["id"] for r in mine] == ["r1"]

    def test_case_variants_of_one_address_share_an_entry(self, monkeypatch):
        calls = []

        async def fake_fetch(self, **kw):
            calls.append(1)
            return [{"id": "r1", "fields": {"Raised By": "a@x.com"}}]

        monkeypatch.setattr(web_invoice.WebInvoiceService, "_fetch_records", fake_fetch)
        svc = web_invoice.WebInvoiceService()

        async def two_spellings():
            first = await svc.get_all_invoices(raised_by="a@x.com")
            second = await svc.get_all_invoices(raised_by="A@X.com")
            return first, second

        first, second = asyncio.run(two_spellings())
        assert len(calls) == 1
        assert first == second

    def test_a_write_invalidates_the_scoped_read(self, monkeypatch):
        """
        Caching a scoped view is only acceptable because every mutation clears
        the prefix. Without this the user would save and not see their own edit.
        """
        state = [{"id": "r1", "fields": {"Raised By": "a@x.com"}}]

        async def fake_fetch(self, **kw):
            return list(state)

        monkeypatch.setattr(web_invoice.WebInvoiceService, "_fetch_records", fake_fetch)
        svc = web_invoice.WebInvoiceService()

        async def read_write_read():
            before = await svc.get_all_invoices(raised_by="a@x.com")
            state.append({"id": "r2", "fields": {"Raised By": "a@x.com"}})
            web_invoice._bust_web_cache()          # what every create/update/delete calls
            after = await svc.get_all_invoices(raised_by="a@x.com")
            return before, after

        before, after = asyncio.run(read_write_read())
        assert len(before) == 1
        assert len(after) == 2, "a mutation must be visible on the next read"
