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
        "expires_at": None, "metadata": json.dumps({}),
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
