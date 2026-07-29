"""Shared pooled HTTP client.

Every outbound call used to construct its own ``httpx.AsyncClient``, which
forces a fresh TCP + TLS handshake per request — typically 100-300 ms against
a remote host like Teable, paid before any data moves. Since a page render can
fan out to a dozen such calls, that handshake cost dominated request latency.

A single process-wide client keeps connections alive between requests, so only
the first call to a host pays setup.

HTTP/2 is deliberately left off: it would multiplex concurrent requests over one
connection, but httpx needs the optional ``h2`` package for it and that is not a
declared dependency — enabling it without adding ``h2`` raises at startup.

Usage:
    from ..utils.http import get_http
    r = await get_http().get(url, headers=..., timeout=10)

Per-call ``timeout=`` still works and overrides the default below.
"""
from __future__ import annotations

import httpx

_client: httpx.AsyncClient | None = None

# Sized for a small API server fanning out to a handful of upstreams.
_LIMITS = httpx.Limits(
    max_connections=100,
    max_keepalive_connections=20,
    keepalive_expiry=30.0,
)

_DEFAULT_TIMEOUT = httpx.Timeout(30.0, connect=10.0)


def get_http() -> httpx.AsyncClient:
    """Return the shared client, creating it on first use.

    Lazily constructed so importers (and tests) don't depend on lifespan having
    run. ``init_http`` / ``close_http`` manage it in the normal server path.
    """
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            limits=_LIMITS,
            timeout=_DEFAULT_TIMEOUT,
            follow_redirects=False,
        )
    return _client


async def init_http() -> None:
    get_http()


async def close_http() -> None:
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None


class _SharedClientProxy:
    """Forwards requests to the shared client, applying per-site defaults.

    Call sites were written as ``httpx.AsyncClient(timeout=15)``, where the
    timeout is a *client* default applied to every request made through it. The
    shared client can't carry one site's timeout without imposing it on all the
    others, so this proxy re-applies the original value per request — a 60 s
    upload stays 60 s and a 10 s lookup stays 10 s.

    An explicit ``timeout=``/``follow_redirects=`` on the individual request
    still wins, matching httpx's own precedence.
    """

    __slots__ = ("_defaults",)

    def __init__(self, **defaults):
        self._defaults = {k: v for k, v in defaults.items() if v is not None}

    def _merge(self, kwargs: dict) -> dict:
        for key, value in self._defaults.items():
            kwargs.setdefault(key, value)
        return kwargs

    async def get(self, *a, **kw):     return await get_http().get(*a, **self._merge(kw))
    async def post(self, *a, **kw):    return await get_http().post(*a, **self._merge(kw))
    async def put(self, *a, **kw):     return await get_http().put(*a, **self._merge(kw))
    async def patch(self, *a, **kw):   return await get_http().patch(*a, **self._merge(kw))
    async def delete(self, *a, **kw):  return await get_http().delete(*a, **self._merge(kw))
    async def head(self, *a, **kw):    return await get_http().head(*a, **self._merge(kw))
    async def request(self, *a, **kw): return await get_http().request(*a, **self._merge(kw))

    def stream(self, *a, **kw):
        return get_http().stream(*a, **self._merge(kw))

    def build_request(self, *a, **kw):
        return get_http().build_request(*a, **self._merge(kw))

    async def send(self, *a, **kw):
        return await get_http().send(*a, **kw)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        # Deliberately does NOT close the shared client — that is the whole point.
        return False


def shared_client(*, timeout=None, follow_redirects=None, **_ignored) -> _SharedClientProxy:
    """Drop-in for ``httpx.AsyncClient(...)`` that reuses pooled connections.

    Usable as ``async with shared_client(timeout=15) as client:`` so existing
    call sites migrate by changing only the constructor line.
    """
    return _SharedClientProxy(timeout=timeout, follow_redirects=follow_redirects)
