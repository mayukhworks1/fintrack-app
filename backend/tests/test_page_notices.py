"""
Errors shown inside an iframe are pages, not JSON.

The editor's preview and an artifact embed are framed documents: an expired
link used to put a raw {"detail": ...} into the frame. They now answer with a
small HTML page saying what happened and offering a reload. Also pins the
preview's size message, which used to read like an expiry.
"""

import asyncio

import pytest
from fastapi import HTTPException

import app.routers.pages as P


def test_an_expired_preview_is_a_small_page():
    resp = asyncio.run(P.public_render_preview("no-such-token"))
    assert resp.status_code == 404 and resp.media_type == "text/html"
    body = resp.body.decode()
    assert "<!doctype html>" in body and "expired" in body and "location.reload()" in body
    assert resp.headers["cache-control"] == "no-store"
    assert "default-src 'none'" in resp.headers["content-security-policy"]


def test_notice_text_is_escaped():
    body = P.notice_page("<b>x</b>", "<script>alert(1)</script>").body.decode()
    assert "<script>alert(1)" not in body and "&lt;script&gt;" in body


def test_a_too_large_preview_says_so():
    with pytest.raises(HTTPException) as e:
        asyncio.run(P.create_page_preview(P.PreviewBody(content="x" * (P.MAX_PREVIEW_CHARS + 1))))
    assert e.value.status_code == 413
    assert "too large" in e.value.detail and "expired" not in e.value.detail
