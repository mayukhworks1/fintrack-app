"""
Regression cover for the security-surface fixes landed together.

  * GET /api/smtp-test, an unauthenticated admin-password oracle, is gone
  * CORS preflight allows PUT (Pages save, permission toggles)
  * gzip never buffers Server-Sent Events, but still compresses JSON
  * uvicorn's access log no longer carries ?token= and friends
  * one helper decides the client IP, and it ignores client-set headers
  * client-controlled values cannot drop audit_log batches or history rows
"""

import asyncio
import base64
import json
import logging
import uuid

import pytest
from starlette.requests import Request


def _main():
    import app.main as M
    return M


def _client():
    from fastapi.testclient import TestClient
    return TestClient(_main().app, raise_server_exceptions=False)


# ── 1. /api/smtp-test is gone ────────────────────────────────────────────────

class TestSmtpTestRemoved:
    def test_route_is_not_registered(self):
        paths = {getattr(r, "path", None) for r in _main().app.routes}
        assert "/api/smtp-test" not in paths

    def test_request_is_a_plain_404(self):
        r = _client().get("/api/smtp-test", params={"pw": "guess", "to": "a@example.com"})
        assert r.status_code == 404


# ── 2. CORS preflight allows every method the routes use ─────────────────────

def _allowed_origin() -> str:
    from starlette.middleware.cors import CORSMiddleware
    mw = next(m for m in _main().app.user_middleware if m.cls is CORSMiddleware)
    origins = mw.kwargs["allow_origins"]
    return "https://frontend.example" if "*" in origins else origins[0]


def _preflight(method: str, path: str = "/api/pages/abc"):
    return _client().options(path, headers={
        "Origin": _allowed_origin(),
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": "authorization,content-type",
    })


class TestCorsPreflight:
    def test_put_preflight_from_an_allowed_origin_succeeds(self):
        r = _preflight("PUT")
        assert r.status_code == 200, r.text
        assert "PUT" in r.headers["access-control-allow-methods"]
        assert r.headers["access-control-allow-origin"] in (_allowed_origin(), "*")

    def test_every_method_a_route_uses_passes_preflight(self):
        methods = set()
        for route in _main().app.routes:
            methods |= set(getattr(route, "methods", None) or ())
        methods -= {"HEAD"}   # a CORS-safelisted method; browsers never preflight it
        assert "PUT" in methods   # PUT /api/pages/{id}, PUT /permissions/users/...
        for method in sorted(methods):
            assert _preflight(method).status_code == 200, method


# ── 3. gzip skips event streams ──────────────────────────────────────────────

async def _first_body_chunk(asgi_app, path, *, headers, query=b"", method="GET"):
    """Drive an ASGI app until the first non-empty body chunk, then disconnect.

    Returns (response-start message, first body bytes). With the old
    GZipMiddleware the first chunk of an SSE stream was only the gzip header,
    because nothing was flushed until the generator ended.
    """
    sent = []
    got_body = asyncio.Event()
    state = {"requested": False}

    async def receive():
        if not state["requested"]:
            state["requested"] = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await got_body.wait()
        return {"type": "http.disconnect"}

    async def send(message):
        sent.append(message)
        if message["type"] == "http.response.body" and message.get("body"):
            got_body.set()

    scope = {
        "type": "http", "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1", "method": method, "scheme": "http",
        "path": path, "raw_path": path.encode(), "query_string": query, "root_path": "",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "client": ("203.0.113.5", 50000), "server": ("testserver", 80),
    }
    task = asyncio.create_task(asgi_app(scope, receive, send))
    try:
        await asyncio.wait_for(got_body.wait(), timeout=5)
    finally:
        try:
            await asyncio.wait_for(task, timeout=5)
        except (asyncio.TimeoutError, Exception):
            task.cancel()
    start = next(m for m in sent if m["type"] == "http.response.start")
    body = next(m["body"] for m in sent if m["type"] == "http.response.body" and m.get("body"))
    return start, body


def _header(start, name: str):
    for k, v in start["headers"]:
        if k.decode().lower() == name:
            return v.decode()
    return None


class TestGzipSkipsEventStreams:
    def test_app_uses_the_sse_aware_middleware(self):
        M = _main()
        assert any(m.cls is M.SSEAwareGZipMiddleware for m in M.app.user_middleware)

    @pytest.mark.parametrize("accept", ["*/*", "text/event-stream"])
    def test_status_stream_first_frame_arrives_uncompressed(self, accept):
        # The real /api/status/stream route through the full middleware stack.
        # "*/*" is how a fetch()-based stream asks; EventSource sends
        # text/event-stream. Both must get the frame immediately, in plain text.
        from app.routers.auth import make_token
        token = make_token(role="viewer", ttl=300)
        start, body = asyncio.run(_first_body_chunk(
            _main().app, "/api/status/stream",
            query=f"token={token}".encode(),
            headers={"Accept-Encoding": "gzip, deflate, br", "Accept": accept},
        ))
        assert start["status"] == 200
        assert _header(start, "content-type").startswith("text/event-stream")
        assert _header(start, "content-encoding") is None
        assert b"event: connected" in body

    def test_each_frame_is_sent_as_it_is_produced(self):
        # A standalone app: every SSE frame must leave as its own plain-text
        # message, not accumulate in a GzipFile until the stream ends.
        from fastapi import FastAPI
        from fastapi.responses import StreamingResponse
        M = _main()
        app = FastAPI()
        app.add_middleware(M.SSEAwareGZipMiddleware, minimum_size=10)

        @app.post("/stream")
        async def stream():
            async def gen():
                for i in range(3):
                    yield f"data: frame-{i} " + "x" * 2000 + "\n\n"
            return StreamingResponse(gen(), media_type="text/event-stream")

        sent = []

        async def run():
            requested = []
            never = asyncio.Event()

            async def receive():
                # First the (empty) request body; after that the client just
                # stays connected, so Starlette's disconnect listener waits.
                if not requested:
                    requested.append(1)
                    return {"type": "http.request", "body": b"", "more_body": False}
                await never.wait()

            async def send(message):
                sent.append(message)

            await app({
                "type": "http", "asgi": {"version": "3.0", "spec_version": "2.3"},
                "http_version": "1.1", "method": "POST", "scheme": "http",
                "path": "/stream", "raw_path": b"/stream", "query_string": b"", "root_path": "",
                "headers": [(b"accept-encoding", b"gzip"), (b"accept", b"*/*")],
                "client": ("203.0.113.5", 1), "server": ("testserver", 80),
            }, receive, send)

        asyncio.run(run())
        bodies = [m["body"] for m in sent if m["type"] == "http.response.body" and m.get("body")]
        assert [b.split(b" ")[1] for b in bodies] == [b"frame-0", b"frame-1", b"frame-2"]

    def test_large_json_is_still_gzipped(self):
        r = _client().get("/openapi.json", headers={"Accept-Encoding": "gzip"})
        assert r.status_code == 200
        assert r.headers.get("content-encoding") == "gzip"


# ── 4. uvicorn access-log redaction ──────────────────────────────────────────

def _access_record(path: str) -> logging.LogRecord:
    # Shaped exactly like uvicorn 0.32's access record (h11_impl/httptools_impl).
    return logging.LogRecord(
        name="uvicorn.access", level=logging.INFO, pathname=__file__, lineno=1,
        msg='%s - "%s %s HTTP/%s" %d',
        args=("203.0.113.5:50000", "GET", path, "1.1", 200),
        exc_info=None,
    )


class TestAccessLogRedaction:
    @pytest.mark.parametrize("path,secret", [
        ("/api/status/stream?token=abc.def-secret", "abc.def-secret"),
        ("/api/x?TOKEN=Upper-Secret&page=2", "Upper-Secret"),
        ("/api/x?%74oken=encoded-key-secret", "encoded-key-secret"),
        ("/api/x?pw=hunter2-value", "hunter2-value"),
        ("/api/auth/reset?reset_token=rt-secret&email=a%40b.c", "rt-secret"),
    ])
    def test_sensitive_values_are_masked(self, path, secret):
        record = _access_record(path)
        assert _main()._AccessLogQueryRedactor().filter(record) is True
        line = record.getMessage()
        assert secret not in line
        assert "REDACTED" in line
        assert line.startswith('203.0.113.5:50000 - "GET /api/')

    def test_other_query_values_survive(self):
        record = _access_record("/api/status/stream?token=t0k&page=2")
        _main()._AccessLogQueryRedactor().filter(record)
        assert "page=2" in record.getMessage()

    @pytest.mark.parametrize("path", ["/api/invoices", "/api/invoices?page=2&q=acme", "/api/x?"])
    def test_lines_without_secrets_are_untouched(self, path):
        record = _access_record(path)
        _main()._AccessLogQueryRedactor().filter(record)
        assert record.args[2] == path

    def test_other_record_shapes_are_ignored(self):
        record = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1, "plain ?token=x", None, None)
        assert _main()._AccessLogQueryRedactor().filter(record) is True
        assert record.getMessage() == "plain ?token=x"

    def test_installed_on_the_uvicorn_access_logger(self):
        # End to end through the real logger and uvicorn's own formatter.
        from uvicorn.logging import AccessFormatter
        _main()
        lines = []

        class Capture(logging.Handler):
            def emit(self, record):
                lines.append(self.format(record))

        handler = Capture()
        handler.setFormatter(AccessFormatter('%(client_addr)s "%(request_line)s" %(status_code)s', use_colors=False))
        access = logging.getLogger("uvicorn.access")
        old_level, old_disabled = access.level, access.disabled
        access.addHandler(handler)
        access.setLevel(logging.INFO)
        # Another test's logging.config call (alembic's fileConfig) may have
        # disabled pre-existing loggers; uvicorn re-enables this one at boot.
        access.disabled = False
        try:
            access.info('%s - "%s %s HTTP/%s" %d', "203.0.113.5:1", "GET",
                        "/api/status/stream?token=live-session-token", "1.1", 200)
        finally:
            access.removeHandler(handler)
            access.setLevel(old_level)
            access.disabled = old_disabled
        assert len(lines) == 1
        assert "live-session-token" not in lines[0]
        assert "/api/status/stream?token=" in lines[0]

    def test_install_is_idempotent(self):
        M = _main()
        M._install_access_log_redaction()
        M._install_access_log_redaction()
        access = logging.getLogger("uvicorn.access")
        assert access.filters.count(M._ACCESS_LOG_REDACTOR) == 1


# ── 5. One client-IP helper that ignores client-set headers ─────────────────

def _req(headers=(), client=("10.16.0.7", 41234), path="/"):
    return Request({
        "type": "http", "method": "GET", "path": path, "query_string": b"",
        "headers": [(k.lower().encode("latin-1"), v.encode("latin-1")) for k, v in headers],
        "client": client,
    })


@pytest.fixture
def ip_settings(monkeypatch):
    import app.utils.client_ip as CI

    def apply(hops=1, trust_cf=False):
        monkeypatch.setattr(CI.settings, "trusted_proxy_hops", hops, raising=False)
        monkeypatch.setattr(CI.settings, "trust_cf_connecting_ip", trust_cf, raising=False)
    apply()
    return apply


class TestClientIp:
    def _ip(self, *a, **k):
        from app.utils.client_ip import client_ip
        return client_ip(_req(*a, **k))

    def test_defaults(self):
        from app.config import Settings
        s = Settings()
        assert s.trusted_proxy_hops == 1
        assert s.trust_cf_connecting_ip is False

    def test_spoofed_cf_connecting_ip_is_ignored_by_default(self, ip_settings):
        assert self._ip([("CF-Connecting-IP", "6.6.6.6")]) == "10.16.0.7"
        assert self._ip([("X-Real-IP", "6.6.6.6")]) == "10.16.0.7"
        assert self._ip([("CF-Connecting-IP", "6.6.6.6"), ("X-Forwarded-For", "198.51.100.4")]) == "198.51.100.4"

    def test_cf_connecting_ip_is_used_only_when_trusted(self, ip_settings):
        ip_settings(trust_cf=True)
        assert self._ip([("CF-Connecting-IP", "198.51.100.9"), ("X-Forwarded-For", "6.6.6.6")]) == "198.51.100.9"
        assert self._ip([("X-Real-IP", "198.51.100.10")]) == "198.51.100.10"

    def test_invalid_cf_value_falls_through_even_when_trusted(self, ip_settings):
        ip_settings(trust_cf=True)
        assert self._ip([("CF-Connecting-IP", "not-an-ip"), ("X-Forwarded-For", "198.51.100.4")]) == "198.51.100.4"

    def test_spoofed_leftmost_xff_entries_are_ignored(self, ip_settings):
        # The client sent "6.6.6.6, 7.7.7.7"; the platform proxy appended the real peer.
        assert self._ip([("X-Forwarded-For", "6.6.6.6, 7.7.7.7, 198.51.100.4")]) == "198.51.100.4"

    def test_repeated_xff_headers_are_read_in_order(self, ip_settings):
        assert self._ip([("X-Forwarded-For", "6.6.6.6"), ("X-Forwarded-For", "198.51.100.4")]) == "198.51.100.4"

    def test_hops_zero_ignores_xff(self, ip_settings):
        ip_settings(hops=0)
        assert self._ip([("X-Forwarded-For", "198.51.100.4")]) == "10.16.0.7"

    def test_hops_two_takes_the_second_from_the_right(self, ip_settings):
        ip_settings(hops=2)
        assert self._ip([("X-Forwarded-For", "6.6.6.6, 198.51.100.4, 10.0.0.2")]) == "198.51.100.4"

    def test_too_few_entries_for_the_hop_count_falls_back(self, ip_settings):
        ip_settings(hops=2)
        assert self._ip([("X-Forwarded-For", "6.6.6.6")]) == "10.16.0.7"

    @pytest.mark.parametrize("value", ["not-an-ip", "1.2.3.4.5", "999.1.1.1", "<script>", "x" * 300, "", " , "])
    def test_invalid_values_fall_back_to_the_peer(self, ip_settings, value):
        assert self._ip([("X-Forwarded-For", value)]) == "10.16.0.7"

    @pytest.mark.parametrize("value,expected", [
        ("198.51.100.4:8443", "198.51.100.4"),
        ("2001:db8::1", "2001:db8::1"),
        ("[2001:db8::1]:443", "2001:db8::1"),
        ("  198.51.100.4  ", "198.51.100.4"),
    ])
    def test_ports_and_ipv6_are_normalised(self, ip_settings, value, expected):
        assert self._ip([("X-Forwarded-For", value)]) == expected

    def test_no_client_and_no_headers_gives_empty(self, ip_settings):
        assert self._ip([], client=None) == ""

    @pytest.mark.parametrize("module,fn,empty", [
        ("app.main", "_get_client_ip", ""),
        ("app.routers.auth", "_get_client_ip", ""),
        ("app.services.auth_master", "_client_ip", ""),
        ("app.routers.admin", "_client_ip", ""),
        ("app.routers.ai", "_get_client_ip", ""),
        ("app.routers.ai", "_client_ip", "unknown"),
        ("app.routers.invoices", "_ip", "unknown"),
        ("app.routers.projects", "_ip", "unknown"),
        ("app.routers.status", "_ip", ""),
        ("app.routers.shared_views", "_ip", ""),
        ("app.services.shared_views", "_extract_ip", ""),
        ("app.routers.pages", "_get_client_ip", ""),
        ("app.db.attribution", "_get_client_ip", ""),
    ])
    def test_every_call_site_uses_the_helper(self, ip_settings, module, fn, empty):
        import importlib
        get_ip = getattr(importlib.import_module(module), fn)
        spoofed = _req([("CF-Connecting-IP", "6.6.6.6"), ("X-Real-IP", "6.6.6.7"),
                        ("X-Forwarded-For", "6.6.6.8, 198.51.100.4")])
        assert get_ip(spoofed) == "198.51.100.4"
        assert get_ip(_req([], client=None)) == empty

    def test_login_rate_limit_bucket_cannot_be_rotated(self, ip_settings, monkeypatch):
        # Rotating CF-Connecting-IP / leftmost XFF used to give every attempt a
        # fresh "authrl:<ip>" bucket, so the 10/min limit never triggered.
        import app.db.valkey as V
        from app.routers.auth import _auth_rate_limit
        keys = []

        async def fake_rate_check(ip, limit=60, window_sec=60, bucket="ratelimit"):
            keys.append(f"{bucket}:{ip}")
            return True, limit

        monkeypatch.setattr(V, "rate_check", fake_rate_check)
        for i in range(5):
            asyncio.run(_auth_rate_limit(_req([
                ("CF-Connecting-IP", f"6.6.6.{i}"),
                ("X-Forwarded-For", f"7.7.7.{i}, 198.51.100.4"),
            ])))
        assert set(keys) == {"authrl:198.51.100.4"}

    def test_scanner_trap_bans_the_real_peer_not_a_forged_ip(self, ip_settings, monkeypatch):
        # Forging CF-Connecting-IP used to let anyone get a victim's IP banned.
        import app.services.scanner_trap as T
        from app.config import settings
        recorded = []

        async def fake_record_probe(ip):
            recorded.append(ip)
            return False

        monkeypatch.setattr(settings, "scanner_trap_enabled", True, raising=False)
        monkeypatch.setattr(T, "record_probe", fake_record_probe)
        monkeypatch.setattr(T, "is_banned", lambda ip: False)
        c = _client()
        c.get("/.env", headers={"CF-Connecting-IP": "192.0.2.77", "X-Forwarded-For": "192.0.2.78, 198.51.100.4"})
        assert recorded == ["198.51.100.4"]


# ── 6. Client-controlled values cannot drop audit or history rows ────────────

def _hint(payload) -> str:
    raw = payload if isinstance(payload, str) else json.dumps(payload)
    return base64.b64encode(raw.encode("utf-8")).decode()


_SMALLINT = (-32768, 32767)
_INT4 = (-2**31, 2**31 - 1)


def _pg_check_audit(record):
    """What PostgreSQL / asyncpg would reject in one audit_log bind tuple."""
    for v in record:
        if isinstance(v, str) and "\x00" in v:
            raise ValueError('invalid byte sequence for encoding "UTF8": 0x00')
    for idx, (lo, hi) in ((4, _SMALLINT), (5, _INT4), (22, _INT4), (24, _INT4)):
        v = record[idx]
        if v is not None and (not isinstance(v, int) or not lo <= v <= hi):
            raise OverflowError(f"value out of range for ${idx + 1}")
    for idx in (17, 18):
        v = record[idx]
        if v is not None and not isinstance(v, (int, float)):
            raise TypeError(f"${idx + 1}: a float is required")
    if record[25] is not None:
        uuid.UUID(record[25])
    extra = record[28]

    def reject_constant(c):
        raise ValueError(f"invalid input syntax for type json: {c}")
    json.loads(extra, parse_constant=reject_constant)
    if "\\u0000" in extra:
        raise ValueError("unsupported Unicode escape sequence")


class FakeAuditPool:
    """Stands in for the asyncpg pool. executemany is atomic, like asyncpg's."""

    def __init__(self, reject=None):
        self.reject = reject or (lambda record: None)
        self.batches, self.rows = [], []

    def _check(self, record):
        _pg_check_audit(record)
        self.reject(record)

    async def executemany(self, sql, records):
        for r in records:
            self._check(r)
        self.batches.append(list(records))

    async def execute(self, sql, *record):
        self._check(record)
        self.rows.append(record)


def _queued(i, **over):
    item = {
        "role": "editor", "token_hint": f"tok{i}", "method": "GET", "path": f"/api/invoices/{i}",
        "status": 200, "duration_ms": 12, "request_id": f"req{i}", "ip": "198.51.100.4",
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0",
        "referer": None, "body_size": None, "query_params": None, "resp_size": 512,
        "client_hint": "", "extra": {"auth_role": "admin"},
    }
    item.update(over)
    return item


@pytest.fixture
def no_geo(monkeypatch):
    import app.db.audit as AU
    import app.db.attribution as AT

    async def fake_geo(ip):
        return {}
    monkeypatch.setattr(AU, "geo_lookup", fake_geo)
    monkeypatch.setattr(AT, "geo_lookup", fake_geo)


_HOSTILE = [
    {"path": "/api/\x00"},                                       # uvicorn decodes /api/%00
    {"user_agent": "Mozilla/5.0\x00evil"},
    {"client_hint": _hint({"browserGeo": "x"})},                 # used to raise in the batch
    {"client_hint": _hint({"ch": "x"})},                         # used to raise in enrichment
    {"client_hint": _hint([1])},
    {"client_hint": _hint('"just a string"')},
    {"client_hint": _hint({"gpu": 5, "timezone": {"a": 1}, "platform": ["Mac"],
                           "ch": {"platformVersion": [14], "arch": 1, "bitness": {}}})},
    {"client_hint": _hint('{"cores": 99999, "memoryGb": NaN, "language": "en\\u0000IN"}')},
    {"client_hint": _hint('{"browserGeo": {"lat": Infinity, "lon": 1e400}, "screen": "1x1\\u0000"}')},
    {"body_size": 10**12},                                       # forged Content-Length
]


class TestAuditBatch:
    def test_hostile_values_are_sanitised_and_the_batch_lands_whole(self, no_geo):
        from app.db.audit import _enrich_one, _batch_insert_audit

        async def run():
            items = [_queued(0)] + [_queued(i + 1, **over) for i, over in enumerate(_HOSTILE)] + [_queued(99)]
            enriched = await asyncio.gather(*[_enrich_one(it) for it in items], return_exceptions=True)
            assert all(isinstance(e, dict) for e in enriched), [e for e in enriched if not isinstance(e, dict)]
            pool = FakeAuditPool()
            await _batch_insert_audit(pool, enriched)
            return items, pool

        items, pool = asyncio.run(run())
        assert len(pool.batches) == 1 and not pool.rows
        assert len(pool.batches[0]) == len(items)
        paths = [r[3] for r in pool.batches[0]]
        assert "/api/" in paths   # the NUL is gone, the row is kept

    def test_one_rejected_row_does_not_drop_the_rest(self, no_geo):
        from app.db.audit import _enrich_one, _batch_insert_audit

        def reject(record):
            if record[6] == "req3":   # a row the database refuses for any reason
                raise ValueError("simulated constraint violation")

        async def run():
            enriched = [await _enrich_one(_queued(i)) for i in range(6)]
            pool = FakeAuditPool(reject=reject)
            await _batch_insert_audit(pool, enriched)
            return pool

        pool = asyncio.run(run())
        assert pool.batches == []   # the atomic batch failed...
        assert sorted(r[6] for r in pool.rows) == ["req0", "req1", "req2", "req4", "req5"]

    def test_a_row_that_cannot_be_built_is_skipped_alone(self):
        from app.db.audit import _batch_insert_audit
        good = {**_queued(1), "os_str": "Windows 10", "browser": "Chrome 131", "device": "desktop", "geo": {}}
        bad = {**_queued(2), "extra": ["not", "a", "dict"]}
        pool = FakeAuditPool()
        asyncio.run(_batch_insert_audit(pool, [good, bad]))
        assert [r[6] for r in pool.batches[0]] == ["req1"]

    @pytest.mark.parametrize("payload", [
        {"ch": "x"}, [1], "s", 7, {"browserGeo": "x"}, {"gpu": 5}, {"timezone": {"a": 1}},
    ])
    def test_parse_client_hint_always_returns_the_expected_shape(self, payload):
        from app.db.audit import parse_client_hint, build_device_label
        hint = parse_client_hint(_hint(payload))
        assert isinstance(hint, dict)
        assert hint.get("ch") is None or isinstance(hint["ch"], dict)
        assert hint.get("browserGeo") is None or isinstance(hint["browserGeo"], dict)
        build_device_label("Windows 10", "Chrome 131", "desktop", hint)   # must not raise

    def test_parse_client_hint_keeps_a_real_browser_payload(self):
        from app.db.audit import parse_client_hint
        real = {
            "ch": {"platform": "macOS", "platformVersion": "14.5.0", "model": "", "arch": "arm",
                   "bitness": "64", "fullVersion": "131.0.1", "mobile": False},
            "platform": "MacIntel", "language": "en-IN", "locale": "en-IN", "timezone": "Asia/Kolkata",
            "cores": 8, "memoryGb": 0.5, "touchPoints": 0, "screen": "1512x982@2x", "viewport": "1512x823",
            "gpu": "Apple M2 Pro", "network": "4g", "downlinkMbps": 10,
            "browserGeo": {"lat": 12.9716, "lon": 77.5946, "accuracyM": 20},
        }
        assert parse_client_hint(_hint(real)) == real

    def test_parse_client_hint_strips_nul_and_non_finite(self):
        from app.db.audit import parse_client_hint
        hint = parse_client_hint(_hint('{"language": "en\\u0000IN", "memoryGb": NaN, "browserGeo": {"lat": 1e400}}'))
        assert hint["language"] == "enIN"
        assert hint["memoryGb"] is None
        assert hint["browserGeo"]["lat"] is None


class TestRecordHistoryAttribution:
    def _hostile_request(self, **state):
        req = _req([
            ("User-Agent", "Mozilla/5.0 (Macintosh) Chrome/131.0"),
            ("X-Session-Id", "not-a-uuid"),
            ("X-Client-Hint", _hint({"cores": 99999, "memoryGb": 0.5, "ch": "x", "gpu": "GPU\u0000X",
                                     "browserGeo": {"lat": "north", "lon": 77.5}})),
        ], path="/api/status/rec\x00ord")
        for k, v in state.items():
            setattr(req.state, k, v)
        return req

    def test_actor_from_hostile_headers_fits_record_history(self, no_geo, ip_settings):
        from app.db.attribution import build_actor_context
        actor = asyncio.run(build_actor_context(self._hostile_request(), "editor", "rec1"))
        assert actor["actor_session_id"] is None
        assert actor["actor_cpu_cores"] is None
        assert actor["actor_memory_gb"] == 0
        assert actor["actor_lat"] is None and actor["actor_lon"] == 77.5
        assert actor["actor_path"] == "/api/status/record"
        assert actor["actor_gpu"] == "GPUX"
        assert actor["actor_ip"] == "10.16.0.7"

    def test_auth_session_id_is_used_when_present(self, no_geo, ip_settings):
        from app.db.attribution import build_actor_context
        sid = str(uuid.uuid4())
        actor = asyncio.run(build_actor_context(self._hostile_request(auth_session_id=sid), "editor", "rec1"))
        assert actor["actor_session_id"] == sid

    def test_history_insert_accepts_the_sanitised_actor(self, no_geo, ip_settings):
        # The full path: actor built from hostile headers, parked, popped, and
        # bound into record_history by sync._insert_history.
        import app.db.attribution as A
        from app.db.sync import _insert_history
        parked = {}

        async def fake_set(tid, actor, ttl=None):
            parked[tid] = json.loads(json.dumps(actor))

        async def fake_pop(tid):
            return parked.pop(tid, None)

        inserted = []

        class Conn:
            async def execute(self, sql, *p):
                for v in p:
                    if isinstance(v, str) and "\x00" in v:
                        raise ValueError("0x00")
                if p[19] is not None:
                    uuid.UUID(p[19])                       # actor_session_id UUID
                for v in (p[26], p[27]):                    # SMALLINT columns
                    if v is not None and (not isinstance(v, int) or not -32768 <= v <= 32767):
                        raise OverflowError("smallint out of range")
                inserted.append(p)

        async def run():
            import app.db.valkey as V
            orig_set, orig_pop = V.attribution_set, V.attribution_pop
            V.attribution_set, V.attribution_pop = fake_set, fake_pop
            try:
                await A.record_user_attribution(self._hostile_request(), "shared_edit", "rec1")
                actor = await A.pop_attribution("rec1")
            finally:
                V.attribution_set, V.attribution_pop = orig_set, orig_pop
            await _insert_history(Conn(), "status", "rec1", "update", "{}", "{}", ["Short Status"], actor)
            return actor

        actor = asyncio.run(run())
        assert actor["change_source"] == "user"
        assert len(inserted) == 1

    def test_pop_resanitises_an_entry_cached_by_an_older_build(self, monkeypatch):
        import app.db.attribution as A

        async def stale_pop(tid):
            return {"change_source": "user", "actor_session_id": "x", "actor_cpu_cores": 99999,
                    "actor_memory_gb": 0.5, "actor_path": "/a\x00b", "actor_role": "r" * 50,
                    "actor_lat": float("nan")}

        monkeypatch.setattr(A.vk, "attribution_pop", stale_pop)
        actor = asyncio.run(A.pop_attribution("rec1"))
        assert actor["actor_session_id"] is None
        assert actor["actor_cpu_cores"] is None
        assert actor["actor_memory_gb"] == 0
        assert actor["actor_path"] == "/ab"
        assert len(actor["actor_role"]) == 20
        assert actor["actor_lat"] is None
        assert set(A.empty_actor()) <= set(actor)
