import asyncio

import httpx
import pytest
from fastapi import HTTPException

from app.routers import storage as S


@pytest.mark.parametrize("url,ok", [
    ("https://app.teable.ai/api/attachments/read/x.pdf", True),
    ("https://files.teable.io/a/b.pdf?sig=1", True),
    ("https://teable.ai/x.pdf", True),
    ("http://app.teable.ai/x.pdf", False),
    ("https://evil.com/x.pdf", False),
    ("https://app.teable.ai.evil.com/x.pdf", False),
    ("https://user:pw@app.teable.ai/x.pdf", False),
    ("https://app.teable.ai:8443/x.pdf", False),
    ("https://169.254.169.254/latest", False),
    ("not a url", False),
])
def test_remote_host_allowlist(url, ok):
    assert S.remote_host_allowed(url) is ok


def test_relay_rejects_other_hosts():
    with pytest.raises(HTTPException) as e:
        asyncio.run(S.relay_remote_file("https://evil.com/a.pdf", "user"))
    assert e.value.status_code == 400


def test_relay_blocks_redirect_off_host(monkeypatch):
    def handler(request):
        if request.url.host == "app.teable.ai":
            return httpx.Response(302, headers={"location": "https://evil.com/steal"})
        return httpx.Response(200, content=b"nope")
    transport = httpx.MockTransport(handler)
    real = httpx.AsyncClient
    monkeypatch.setattr(S.httpx, "AsyncClient", lambda **kw: real(transport=transport, **kw))
    with pytest.raises(HTTPException) as e:
        asyncio.run(S.relay_remote_file("https://app.teable.ai/a.pdf", "user"))
    assert e.value.status_code == 502


def test_relay_returns_file(monkeypatch):
    transport = httpx.MockTransport(lambda r: httpx.Response(200, content=b"%PDF-1.4", headers={"content-type": "application/pdf"}))
    real = httpx.AsyncClient
    monkeypatch.setattr(S.httpx, "AsyncClient", lambda **kw: real(transport=transport, **kw))
    res = asyncio.run(S.relay_remote_file("https://app.teable.ai/a.pdf", "user"))
    assert res.body == b"%PDF-1.4" and res.media_type == "application/pdf"
