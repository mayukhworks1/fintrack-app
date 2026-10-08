"""
Cover for the scanner trap.

The audit log held 515 probe requests — /.env variants, path traversal,
/mcp, /api/predict — over 46 days, every one answered 404, none successful.
The trap answers them before routing and bans repeaters.

The assertion that matters most is the NEGATIVE one: a legitimate route must
never match. A false positive is a real user locked out for an hour, which is
a worse outcome than any amount of scanner noise. Every route prefix the app
serves is listed below and checked.
"""

import asyncio
import logging
import time

import pytest

import app.services.scanner_trap as T
from app.config import settings


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    logging.disable(logging.CRITICAL)
    T._mem_strikes.clear()
    T._mem_bans.clear()
    for k in T._stats:
        T._stats[k] = 0
    monkeypatch.setattr(T.vk, "get_client", lambda: None)   # memory path
    monkeypatch.setattr(settings, "scanner_trap_enabled", True)
    monkeypatch.setattr(settings, "scanner_strikes", 3)
    monkeypatch.setattr(settings, "scanner_window_seconds", 600)
    monkeypatch.setattr(settings, "scanner_ban_seconds", 3600)
    yield
    logging.disable(logging.NOTSET)


# Every probe path seen in the audit log, plus the usual CMS/admin suspects.
PROBES = [
    "/.env", "/.env.local", "/.env.production", "/root/.env",
    "/file=../.env", "/file=../../.env", "/file=../secrets.toml",
    "/file=../config/.env", "/file=../backup/.env",
    "/mcp", "/mcp/", "/mcp/sse",
    "/api/predict", "/api/config",
    "/wp-login.php", "/wp-admin/", "/xmlrpc.php",
    "/phpmyadmin/", "/actuator/health", "/.git/config",
    "/.aws/credentials", "/.ssh/id_rsa", "/cgi-bin/test", "/etc/passwd",
    "/index.php",
]

# Every route family the app serves. None of these may ever be trapped.
REAL_ROUTES = [
    "/", "/health", "/health/live", "/openapi.json", "/docs",
    "/api/auth/verify", "/api/auth/login", "/api/auth/google/callback", "/api/auth/logout",
    "/api/invoices", "/api/invoices/summary", "/api/invoices/aging-buckets",
    "/api/invoices/dashboard-activity", "/api/invoices/recXYZ123", "/api/invoices/export",
    "/api/web-invoices", "/api/web-invoices/summary", "/api/web-projects",
    "/api/projects", "/api/projects/summary", "/api/status",
    "/api/pages", "/api/pages/d25dcddc-eb6a-4f8b-8f07-bbef42b43959",
    "/api/public/pages/asset/pages/img.png",
    "/api/admin/deployment-health", "/api/admin/alerts/test", "/api/admin/watchdog",
    "/api/ai/chat", "/api/ai/report", "/api/studio/ask",
    "/api/shared-views/abc123", "/api/webhooks/teable", "/api/storage/file",
    "/api/insights", "/api/reports",
]


class TestPathClassification:
    @pytest.mark.parametrize("path", PROBES)
    def test_known_probe_paths_are_trapped(self, path):
        assert T.is_probe(path), path

    @pytest.mark.parametrize("path", REAL_ROUTES)
    def test_no_real_route_is_ever_trapped(self, path):
        assert not T.is_probe(path), f"FALSE POSITIVE: {path} would lock a user out"


class TestStrikesAndBans:
    def test_bans_at_the_threshold_not_before(self):
        ip = "203.0.113.9"
        assert asyncio.run(T.record_probe(ip)) is False
        assert asyncio.run(T.record_probe(ip)) is False
        assert T.is_banned(ip) is False
        assert asyncio.run(T.record_probe(ip)) is True       # third strike
        assert T.is_banned(ip) is True
        assert T.state()["bans"] == 1 and T.state()["probes"] == 3

    def test_a_ban_expires(self):
        ip = "203.0.113.10"
        T._mem_bans[ip] = time.time() - 1
        assert T.is_banned(ip) is False

    def test_strikes_outside_the_window_do_not_count(self, monkeypatch):
        ip = "203.0.113.11"
        monkeypatch.setattr(settings, "scanner_window_seconds", 1)
        T._mem_strikes[ip] = [time.time() - 5, time.time() - 4]   # stale
        assert asyncio.run(T.record_probe(ip)) is False           # only 1 live strike

    def test_unknown_ip_is_never_banned(self):
        assert asyncio.run(T.record_probe("")) is False
        assert T.is_banned("") is False

    def test_fails_open_with_no_valkey_and_no_memory_ban(self):
        assert T.is_banned("198.51.100.1") is False

    def test_the_per_request_check_never_awaits(self):
        # Valkey is ~210 ms away. The first version asked it on every request
        # — a flat tax on the whole app. The check must stay in-process.
        import inspect
        assert not inspect.iscoroutinefunction(T.is_banned)

    def test_bans_are_restored_from_valkey_at_startup(self, monkeypatch):
        class FakeClient:
            def __init__(self): self.ttls = {"scanner:ban:203.0.113.30": 1200, "scanner:ban:203.0.113.31": -2}
            async def scan_iter(self, pattern, count=100):
                for k in list(self.ttls): yield k.encode()
            async def ttl(self, name): return self.ttls[name]
        monkeypatch.setattr(T.vk, "get_client", lambda: FakeClient())
        assert asyncio.run(T.load_bans_from_valkey()) == 1
        assert T.is_banned("203.0.113.30") is True      # live ban came back
        assert T.is_banned("203.0.113.31") is False     # expired key ignored


class TestMiddlewareIntegration:
    @pytest.fixture
    def client(self, monkeypatch):
        monkeypatch.setenv("APP_SECRET", "x-local-test-secret-xxxxxxxxxxxx")
        from fastapi.testclient import TestClient
        import app.main as M
        return TestClient(M.app, raise_server_exceptions=False)

    def test_probe_is_answered_before_routing_and_still_audited(self, client):
        r = client.get("/.env.production", headers={"x-forwarded-for": "203.0.113.20"})
        assert r.status_code == 404
        assert r.headers.get("x-request-id")        # the rest of the middleware ran
        assert T.state()["probes"] == 1

    def test_banned_ip_gets_403_on_any_path(self, client):
        T._mem_bans["203.0.113.21"] = time.time() + 3600
        r = client.get("/health/live", headers={"x-forwarded-for": "203.0.113.21"})
        assert r.status_code == 403
        assert T.state()["blocked"] == 1

    def test_normal_traffic_is_untouched(self, client):
        r = client.get("/health/live", headers={"x-forwarded-for": "203.0.113.22"})
        assert r.status_code == 200
        assert T.state()["probes"] == 0 and T.state()["blocked"] == 0

    def test_disabled_trap_falls_through_to_routing(self, client, monkeypatch):
        monkeypatch.setattr(settings, "scanner_trap_enabled", False)
        r = client.get("/.env", headers={"x-forwarded-for": "203.0.113.23"})
        assert r.status_code == 404                  # FastAPI's own 404 now
        assert T.state()["probes"] == 0              # and nothing was counted
