"""
Author controls on a published page: an expiry time (entered in IST), source
protection, and folders that stay private to the author.

The public routes are called directly against a one-page fake database.
"""

import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

import app.routers.pages as P

HTML = "<!doctype html><html><head><title>t</title></head><body><p>secret layout</p></body></html>"


class OnePagePool:
    def __init__(self, row):
        self.row = row

    def acquire(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def fetchrow(self, sql, *args):
        return self.row if args and args[0] == self.row["slug"] else None


def _row(**over):
    row = {
        "id": uuid.uuid4(), "slug": "proposal", "title": "Proposal", "content_type": "html",
        "content": HTML, "is_published": True, "is_password_protected": False,
        "password_hash": None, "published_at": datetime.now(timezone.utc),
        "expires_at": None, "metadata": json.dumps({}), "updated_at": None,
    }
    row.update(over)
    return row


@pytest.fixture
def page(monkeypatch):
    def install(**over):
        row = _row(**over)
        monkeypatch.setattr(P, "get_pool", lambda: OnePagePool(row))
        return row
    return install


def _get(slug="proposal"):
    resp = asyncio.run(P.public_get_page(slug, request=None))
    return json.loads(resp.body)


def _render(slug="proposal", t=None):
    return asyncio.run(P.public_render_page(slug, t))


class TestExpiry:
    def test_parse_reads_a_bare_time_as_ist(self):
        given, when = P._parse_expiry("2026-10-20T18:00")
        assert given and when == datetime(2026, 10, 20, 12, 30, tzinfo=timezone.utc)

    def test_parse_keeps_an_explicit_offset(self):
        _, when = P._parse_expiry("2026-10-20T18:00:00+05:30")
        assert when == datetime(2026, 10, 20, 12, 30, tzinfo=timezone.utc)

    def test_empty_string_clears_and_none_leaves_alone(self):
        assert P._parse_expiry("") == (True, None)
        assert P._parse_expiry(None) == (False, None)

    def test_garbage_is_refused_rather_than_ignored(self):
        with pytest.raises(HTTPException) as e:
            P._parse_expiry("next tuesday")
        assert e.value.status_code == 422

    def test_expired_page_is_gone_on_every_public_route(self, page):
        page(expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))
        for call in (_get, _render):
            with pytest.raises(HTTPException) as e:
                call()
            assert e.value.status_code == 410

    def test_page_before_its_expiry_is_served_but_not_cached(self, page):
        page(expires_at=datetime.now(timezone.utc) + timedelta(hours=1))
        resp = _render()
        assert resp.status_code == 200
        assert "no-store" in resp.headers["cache-control"]
        assert _get()["expires_at"]


class TestSourceProtection:
    def test_plain_page_is_unchanged(self, page):
        page()
        body = _get()
        assert body["content"] == HTML and "render_token" not in body
        assert "contextmenu" not in _render().body.decode()

    def test_protected_html_ships_no_source_in_json(self, page):
        page(metadata=json.dumps({"protect_source": True}))
        body = _get()
        assert body["content"] == ""
        assert body["render_token"]

    def test_protected_render_needs_the_token(self, page):
        page(metadata=json.dumps({"protect_source": True}))
        with pytest.raises(HTTPException) as e:
            _render()
        assert e.value.status_code == 401
        resp = _render(t=_get()["render_token"])
        html = resp.body.decode()
        assert "secret layout" in html and "contextmenu" in html
        assert "no-store" in resp.headers["cache-control"]

    def test_protected_token_is_short_lived(self, page):
        page(metadata=json.dumps({"protect_source": True}))
        expiry = int(_get()["render_token"].split(".")[0])
        assert expiry - datetime.now(timezone.utc).timestamp() <= P.PROTECTED_RENDER_TOKEN_TTL_SECONDS + 5

    def test_protected_markdown_still_ships_its_text(self, page):
        page(content_type="markdown", content="# hi", metadata=json.dumps({"protect_source": True}))
        assert _get()["content"] == "# hi"


def test_folder_is_not_shown_to_visitors(page):
    page(metadata=json.dumps({"folder": "Clients/Acme", "description": "d"}))
    meta = _get()["metadata"]
    assert "folder" not in meta and meta["description"] == "d"


class _Req:
    headers = {"host": "api.example"}


class TestLinkPreview:
    @pytest.fixture(autouse=True)
    def _origin(self, monkeypatch):
        monkeypatch.setattr(P.settings, "frontend_url", "https://app.example")

    def _card(self, slug="proposal"):
        return asyncio.run(P.public_share_card(slug, _Req())).body.decode()

    def test_card_carries_the_page_title_description_and_image(self, page):
        page(updated_at=datetime(2026, 10, 1, tzinfo=timezone.utc),
             metadata=json.dumps({"description": "Q4 plan for <Acme>"}))
        html = self._card()
        assert '<meta property="og:title" content="Proposal">' in html
        assert 'content="Q4 plan for &lt;Acme&gt;"' in html
        assert 'og:url" content="https://app.example/p/proposal"' in html
        assert 'og:image" content="https://app.example/p/proposal/preview.png?v=' in html
        assert "secret layout" not in html

    def test_protected_page_shows_no_description(self, page):
        page(is_password_protected=True, updated_at=None, metadata=json.dumps({"description": "confidential terms"}))
        html = self._card()
        assert "confidential terms" not in html
        assert "Enter the password" in html

    def test_expired_and_missing_pages_say_so(self, page):
        page(expires_at=datetime.now(timezone.utc) - timedelta(days=1), updated_at=None)
        assert "This link has expired" in self._card()
        assert "Page not found" in self._card("nope")

    def test_image_is_a_png(self, page):
        page(updated_at=None)
        resp = asyncio.run(P.public_share_image("proposal", _Req()))
        assert resp.media_type == "image/png" and resp.body[:8] == b"\x89PNG\r\n\x1a\n"


class _InsightsPool(OnePagePool):
    def __init__(self, owner):
        self.owner = owner

    async def fetchrow(self, sql, *args):
        return {"id": args[0], "created_by": self.owner}

    async def fetchval(self, sql, *args):
        assert "page_views" in sql
        return json.dumps({"total": 3, "unique": 2, "last7": 3, "prev7": 0,
                           "daily": [{"day": "2026-10-13", "views": 3}],
                           "devices": [{"name": "Mobile", "views": 3}], "countries": []})


class TestInsights:
    def _req(self, user, role="user"):
        from types import SimpleNamespace
        return SimpleNamespace(state=SimpleNamespace(auth_user_id=user, auth_role=role))

    def test_owner_gets_totals_and_daily_counts(self, monkeypatch):
        owner = str(uuid.uuid4())
        monkeypatch.setattr(P, "get_pool", lambda: _InsightsPool(owner))
        d = asyncio.run(P.page_insights("p1", self._req(owner), role="editor"))
        assert d["total"] == 3 and d["daily"][0] == {"day": "2026-10-13", "views": 3}

    def test_someone_else_is_refused(self, monkeypatch):
        monkeypatch.setattr(P, "get_pool", lambda: _InsightsPool(str(uuid.uuid4())))
        with pytest.raises(HTTPException) as e:
            asyncio.run(P.page_insights("p1", self._req(str(uuid.uuid4())), role="editor"))
        assert e.value.status_code == 403
