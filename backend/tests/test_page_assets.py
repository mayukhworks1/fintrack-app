"""
Page assets belong to the pages that use them.

DELETE /api/pages/asset used to check only that a path sat under pages/.
Asset URLs are printed in the public HTML of every published page, so any
token — the shared viewer password included — could strip the images from
anybody's page. Deleting a page did the same thing indirectly: paste someone
else's asset URLs into your own page, delete it, and their files went with it.

These pin who may delete what, against a fake database that holds pages and
their saved versions and answers the reference lookup the router makes.
"""

import asyncio
import uuid
from types import SimpleNamespace
from urllib.parse import quote

import pytest
from fastapi import HTTPException

import app.routers.pages as P
import app.services.storage as S

ALICE = str(uuid.uuid4())
BOB = str(uuid.uuid4())
PREFIX = "/api/public/pages/asset/"


class FakePool:
    """Pages and versions in memory; answers the asset-reference query by
    substring, which is what strpos does."""

    def __init__(self, pages, versions=(), fail=False):
        self.pages = {p["id"]: dict(p) for p in pages}
        self.versions = [dict(v) for v in versions]
        self.fail = fail
        self.lookups = 0

    async def fetch(self, sql, *args):
        assert "unnest" in sql and "page_versions" in sql, "unexpected query"
        self.lookups += 1
        if self.fail:
            raise RuntimeError("database went away")
        (needles,) = args
        rows = set()
        for n in needles:
            for page in self.pages.values():
                if n in (page["content"] or ""):
                    rows.add((n, page["created_by"]))
            for v in self.versions:
                if n in v["content"]:
                    rows.add((n, self.pages[v["page_id"]]["created_by"]))
        return [{"needle": n, "created_by": o} for n, o in rows]

    # delete_page reads and deletes through a connection
    def acquire(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def fetchrow(self, sql, page_id):
        p = self.pages.get(page_id)
        return dict(p) if p else None

    async def execute(self, sql, page_id):
        assert sql.startswith("DELETE FROM published_pages")
        self.pages.pop(page_id, None)
        # ON DELETE CASCADE
        self.versions = [v for v in self.versions if v["page_id"] != page_id]


def _req(user_id=None, auth_role=None):
    state = SimpleNamespace(auth_user_id=user_id)
    if auth_role:
        state.auth_role = auth_role
    return SimpleNamespace(state=state)


def _page(pid, owner, *paths):
    body = "".join(f'<img src="{PREFIX}{p}">' for p in paths)
    return {"id": pid, "created_by": owner, "content": f"<p>hello</p>{body}"}


@pytest.fixture
def deleted(monkeypatch):
    calls = []

    async def delete_path(path):
        calls.append(path)

    monkeypatch.setattr(S, "delete_path", delete_path)
    return calls


def _delete(monkeypatch, pool, path, request, role="editor"):
    monkeypatch.setattr(P, "get_pool", lambda: pool)
    return asyncio.run(P.delete_page_asset(path, request, role=role))


ASSET = "pages/2026/10/0123456789abcdef-hero.png"


class TestDeleteAsset:
    def test_another_users_published_asset_is_refused(self, monkeypatch, deleted):
        pool = FakePool([_page("p1", ALICE, ASSET)])
        with pytest.raises(HTTPException) as e:
            _delete(monkeypatch, pool, ASSET, _req(BOB, "user"))
        assert e.value.status_code == 403
        assert deleted == []

    def test_the_full_public_url_is_checked_the_same_way(self, monkeypatch, deleted):
        pool = FakePool([_page("p1", ALICE, ASSET)])
        url = f"https://api.example{PREFIX}{ASSET}?v=2"
        with pytest.raises(HTTPException) as e:
            _delete(monkeypatch, pool, url, _req(BOB, "user"))
        assert e.value.status_code == 403 and deleted == []

    def test_the_owner_can_delete_an_asset_only_their_pages_use(self, monkeypatch, deleted):
        pool = FakePool([_page("p1", ALICE, ASSET), _page("p2", ALICE, ASSET)])
        out = _delete(monkeypatch, pool, ASSET, _req(ALICE, "user"))
        assert out == {"ok": True, "deleted": ASSET}
        assert deleted == [ASSET]

    def test_an_asset_shared_with_someone_elses_page_is_refused_even_to_an_owner(self, monkeypatch, deleted):
        pool = FakePool([_page("p1", ALICE, ASSET), _page("p2", BOB, ASSET)])
        with pytest.raises(HTTPException) as e:
            _delete(monkeypatch, pool, ASSET, _req(ALICE, "user"))
        assert e.value.status_code == 403 and deleted == []

    def test_a_reference_in_a_saved_version_counts(self, monkeypatch, deleted):
        """Restoring that version would otherwise bring back a broken image."""
        pool = FakePool(
            [_page("p1", ALICE)],
            versions=[{"page_id": "p1", "content": f'<img src="{PREFIX}{ASSET}">'}],
        )
        with pytest.raises(HTTPException) as e:
            _delete(monkeypatch, pool, ASSET, _req(BOB, "user"))
        assert e.value.status_code == 403 and deleted == []

    @pytest.mark.parametrize("legacy_role", ["viewer", "editor", "web", "admin"])
    def test_a_legacy_session_cannot_strip_an_ownerless_page(self, monkeypatch, deleted, legacy_role):
        """Legacy tokens carry no user id and legacy pages no owner; None must
        not be taken to match None."""
        pool = FakePool([_page("p1", None, ASSET)])
        with pytest.raises(HTTPException) as e:
            _delete(monkeypatch, pool, ASSET, _req(None), role=legacy_role)
        assert e.value.status_code == 403 and deleted == []

    def test_a_percent_encoded_reference_is_still_a_reference(self, monkeypatch, deleted):
        path = "pages/2026/10/0123456789abcdef-कर.png"
        pool = FakePool([{"id": "p1", "created_by": ALICE,
                          "content": f'<img src="{PREFIX}{quote(path)}">'}])
        with pytest.raises(HTTPException) as e:
            _delete(monkeypatch, pool, path, _req(BOB, "user"))
        assert e.value.status_code == 403 and deleted == []

    def test_a_file_no_page_uses_yet_is_the_uploaders_to_discard(self, monkeypatch, deleted):
        """Uploaded into an editor, then removed before the page was saved."""
        pool = FakePool([_page("p1", ALICE, ASSET)])
        fresh = "pages/2026/10/fedcba9876543210-draft.png"
        assert _delete(monkeypatch, pool, fresh, _req(BOB, "user"))["ok"] is True
        assert deleted == [fresh]

    def test_superadmin_may_delete_any_asset(self, monkeypatch, deleted):
        pool = FakePool([_page("p1", ALICE, ASSET), _page("p2", BOB, ASSET)])
        _delete(monkeypatch, pool, ASSET, _req(str(uuid.uuid4()), "superadmin"))
        assert deleted == [ASSET] and pool.lookups == 0

    def test_no_database_refuses_rather_than_deleting_blind(self, monkeypatch, deleted):
        with pytest.raises(HTTPException) as e:
            _delete(monkeypatch, None, ASSET, _req(BOB, "user"))
        assert e.value.status_code == 503 and deleted == []

    @pytest.mark.parametrize("bad", ["../secrets.json", "/pages/x.png", "studio/x.pdf", "pages/../x"])
    def test_paths_outside_pages_are_still_rejected(self, monkeypatch, deleted, bad):
        with pytest.raises(HTTPException) as e:
            _delete(monkeypatch, FakePool([]), bad, _req(ALICE, "user"))
        assert e.value.status_code == 400 and deleted == []


class TestDeletePageKeepsSharedAssets:
    def test_deleting_your_page_does_not_take_another_pages_files(self, monkeypatch, deleted):
        """The indirect route: copy a victim's asset URL into your own page,
        then delete your page."""
        own = "pages/2026/10/aaaaaaaaaaaaaaaa-mine.png"
        pool = FakePool([_page("victim", ALICE, ASSET), _page("bait", BOB, ASSET, own)])
        monkeypatch.setattr(P, "get_pool", lambda: pool)
        out = asyncio.run(P.delete_page("bait", _req(BOB, "user"), role="editor"))
        assert out == {"ok": True}
        assert "bait" not in pool.pages
        assert deleted == [own]                 # the victim's file survived

    def test_the_pages_own_versions_do_not_keep_its_files_alive(self, monkeypatch, deleted):
        pool = FakePool([_page("p1", ALICE, ASSET)],
                        versions=[{"page_id": "p1", "content": f'<img src="{PREFIX}{ASSET}">'}])
        monkeypatch.setattr(P, "get_pool", lambda: pool)
        asyncio.run(P.delete_page("p1", _req(ALICE, "user"), role="editor"))
        assert deleted == [ASSET]

    def test_a_failed_reference_check_keeps_every_file(self, monkeypatch, deleted):
        pool = FakePool([_page("p1", ALICE, ASSET)])
        monkeypatch.setattr(P, "get_pool", lambda: pool)
        pool.fail = True
        asyncio.run(P._delete_page_assets(f'<img src="{PREFIX}{ASSET}">'))
        assert deleted == []
