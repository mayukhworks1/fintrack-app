"""
Cover for GET /api/admin/deployment-health.

The endpoint averaged ~10 s (max 11.5 s) in production. Cause: each of the
four Teable tables was probed with every configured token one after another,
each attempt a live request with a 5 s timeout — tables gathered, tokens not.
Three tokens against a slow Teable is 15 s per table, and the endpoint is as
slow as its slowest table. Two smaller sinks sat in front of it: a Valkey ping
with 5 s socket timeouts, and a blocking `git rev-parse` subprocess on every
call for a value that cannot change while the process runs.

What is pinned here is not just that it is fast now, but the shape of the
fix, so none of it can quietly regress:

  * tokens for a table run concurrently — a slow token costs max, not sum;
  * every probe and ping is bounded, and the Teable stage has a deadline that
    reports "timed out" per table rather than hanging;
  * failures carry every attempt, with an HTTP status preferred for the summary;
  * the commit SHA is computed once;
  * the response contract — fourteen keys the admin card reads — is intact,
    plus timing_ms and the probe metadata;
  * the route is still admin-gated.
"""

import asyncio
import time

import pytest

import app.routers.admin as admin
import app.db.postgres as postgres
import app.db.valkey as valkey
import app.db.sync as sync
import importlib


def _settings():
    """The settings object the handler will actually read.

    Resolved on demand, never bound at import: the handler imports settings at
    call time, so if another test module has reloaded app.config this is the
    live object. A module-level `from app.config import settings` would patch a
    stale one — exactly how this file failed only when run after
    test_app_secret_guard.
    """
    return importlib.import_module("app.config").settings


# ── fakes ────────────────────────────────────────────────────────────────────

class _Resp:
    def __init__(self, code): self.status_code = code


class _TeableClient:
    """Dispatches on the Bearer token to a per-token (delay, status|exception)."""
    def __init__(self, plan): self.plan = plan
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False
    async def get(self, url, headers=None, params=None, timeout=None):
        token = (headers or {}).get("Authorization", "").replace("Bearer ", "")
        delay, outcome = self.plan[token]
        # Honour the per-request timeout the way httpx would.
        if timeout is not None and delay > timeout:
            await asyncio.sleep(timeout)
            raise TimeoutError(f"probe exceeded {timeout}s")
        await asyncio.sleep(delay)
        if isinstance(outcome, Exception):
            raise outcome
        return _Resp(outcome)


class _Pool:
    def __init__(self, select1_delay=0.0):
        self.select1_delay = select1_delay
    async def fetchval(self, sql, *a):
        if "SELECT 1" in sql:
            await asyncio.sleep(self.select1_delay)
            return 1
        return 0                                   # failed-webhook count
    async def fetchrow(self, sql, *a):
        return {"active": 3, "revoked": 1, "expired": 2, "total": 6}
    async def fetch(self, sql, *a):
        return []


class _Valkey:
    def __init__(self, delay=0.0): self.delay = delay
    async def ping(self):
        await asyncio.sleep(self.delay)
        return True


@pytest.fixture(autouse=True)
def _wire(monkeypatch):
    # Resolved here, not at import. The handler imports settings at call time,
    # so if another test has reloaded app.config this is the object it reads;
    # a module-level `from app.config import settings` would patch a stale one.
    settings = _settings()
    for name in ("teable_table_id", "teable_invoice_table_id",
                 "teable_web_invoice_table_id", "teable_status_table_id"):
        monkeypatch.setattr(settings, name, "tbl_test")
    monkeypatch.setattr(settings, "teable_base_url", "https://teable.test")
    monkeypatch.setattr(sync, "_all_tokens", lambda: ["tokA", "tokB", "tokC"])
    monkeypatch.setattr(postgres, "get_pool", lambda: _Pool())
    monkeypatch.setattr(postgres, "get_init_error", lambda: None)
    monkeypatch.setattr(valkey, "get_client", lambda: _Valkey())
    monkeypatch.setattr(admin, "_TEABLE_PROBE_TIMEOUT_S", 0.5)
    monkeypatch.setattr(admin, "_TEABLE_STAGE_DEADLINE_S", 2.0)
    monkeypatch.setattr(admin, "_INFRA_PING_TIMEOUT_S", 0.2)
    admin._GIT_SHA_CACHE.clear()
    monkeypatch.setattr(admin, "_compute_git_commit_sha", lambda: "abc123def456")


def _run(plan):
    admin.shared_client = lambda **k: _TeableClient(plan)
    t0 = time.perf_counter()
    out = asyncio.run(admin.deployment_health(_="admin"))
    return out, time.perf_counter() - t0


# ── the fix ──────────────────────────────────────────────────────────────────

class TestTokensRunConcurrently:
    def test_a_slow_token_costs_max_not_sum(self):
        # Serial would be ~0.3 + 0.3 + fast; concurrent is ~0.3.
        out, elapsed = _run({"tokA": (0.3, 401), "tokB": (0.3, 403), "tokC": (0.01, 200)})
        assert out["teable"]["ok"] is True
        assert all(t["ok"] for t in out["teable"]["tables"].values())
        assert elapsed < 0.55, f"tokens appear to have run serially: {elapsed:.2f}s"

    def test_first_success_in_priority_order_wins(self):
        out, _ = _run({"tokA": (0.01, 200), "tokB": (0.01, 200), "tokC": (0.01, 200)})
        assert out["teable"]["tables"]["projects"]["detail"] == "HTTP 200"

    def test_a_never_responding_token_is_bounded_and_does_not_block_success(self):
        out, elapsed = _run({"tokA": (10.0, 200), "tokB": (0.01, 200), "tokC": (10.0, 200)})
        assert out["teable"]["ok"] is True
        assert elapsed < 1.0


class TestFailureReporting:
    def test_all_failed_reports_every_attempt_and_prefers_an_http_status(self):
        out, _ = _run({"tokA": (0.01, ConnectionError("dns")), "tokB": (0.01, 403), "tokC": (0.01, 401)})
        t = out["teable"]["tables"]["projects"]
        assert t["ok"] is False
        assert t["detail"].startswith("HTTP")            # not the transport error
        assert len(t["attempts"]) == 3
        assert out["teable"]["ok"] is False
        assert out["teable"]["detail"] == "One or more tables failed"

    def test_stage_deadline_reports_timed_out_instead_of_hanging(self, monkeypatch):
        monkeypatch.setattr(admin, "_TEABLE_PROBE_TIMEOUT_S", 10.0)   # per-attempt bound out of the way
        monkeypatch.setattr(admin, "_TEABLE_STAGE_DEADLINE_S", 0.3)
        out, elapsed = _run({"tokA": (10.0, 200), "tokB": (10.0, 200), "tokC": (10.0, 200)})
        assert elapsed < 1.0
        assert out["teable"]["ok"] is False
        for t in out["teable"]["tables"].values():
            assert "Timed out" in t["detail"]

    def test_no_tokens_and_no_table_id_are_reported_not_probed(self, monkeypatch):
        monkeypatch.setattr(sync, "_all_tokens", lambda: [])
        monkeypatch.setattr(_settings(), "teable_status_table_id", None)
        out, _ = _run({})
        assert out["teable"]["tables"]["status"]["detail"] == "Table ID not configured"
        assert out["teable"]["tables"]["projects"]["detail"] == "No Teable token configured"


class TestInfraPingsAreBounded:
    def test_hung_valkey_is_reported_within_the_bound(self, monkeypatch):
        monkeypatch.setattr(valkey, "get_client", lambda: _Valkey(delay=10.0))
        out, elapsed = _run({"tokA": (0.01, 200), "tokB": (0.01, 200), "tokC": (0.01, 200)})
        assert out["valkey"]["ok"] is False
        assert "No response within" in out["valkey"]["detail"]   # not the empty str(TimeoutError)
        assert elapsed < 1.0

    def test_hung_postgres_is_reported_within_the_bound(self, monkeypatch):
        monkeypatch.setattr(postgres, "get_pool", lambda: _Pool(select1_delay=10.0))
        out, elapsed = _run({"tokA": (0.01, 200), "tokB": (0.01, 200), "tokC": (0.01, 200)})
        assert out["postgres"]["ok"] is False
        assert "No response within" in out["postgres"]["detail"]
        assert elapsed < 1.0


class TestCommitShaIsComputedOnce:
    def test_subprocess_path_runs_once_across_calls(self, monkeypatch):
        calls = {"n": 0}
        def compute():
            calls["n"] += 1
            return "deadbeef0001"
        monkeypatch.setattr(admin, "_compute_git_commit_sha", compute)
        admin._GIT_SHA_CACHE.clear()
        plan = {"tokA": (0.01, 200), "tokB": (0.01, 200), "tokC": (0.01, 200)}
        for _ in range(3):
            out, _ = _run(plan)
            assert out["deployment"]["commit"] == "deadbeef0001"
        assert calls["n"] == 1


# ── contract ─────────────────────────────────────────────────────────────────

CARD_KEYS = {"postgres", "valkey", "teable", "email", "openrouter", "auth_sessions",
             "sync_freshness", "cron_jobs", "failed_webhooks", "env", "deployment"}
OTHER_KEYS = {"groq_fallback", "google_sso", "overall"}


class TestResponseContract:
    def test_every_key_the_admin_card_reads_is_present(self):
        out, _ = _run({"tokA": (0.01, 200), "tokB": (0.01, 200), "tokC": (0.01, 200)})
        assert CARD_KEYS <= set(out)
        assert OTHER_KEYS <= set(out)
        assert isinstance(out["timing_ms"], int) and out["timing_ms"] >= 0
        assert out["teable"]["probe"]["mode"] == "parallel"
        assert out["teable"]["probe"]["tokens"] == 3

    def test_overall_ignores_timing_and_reflects_checks(self):
        out, _ = _run({"tokA": (0.01, 200), "tokB": (0.01, 200), "tokC": (0.01, 200)})
        assert isinstance(out["overall"], bool)
        expected = all(v.get("ok") for v in out.values() if isinstance(v, dict) and "ok" in v)
        assert out["overall"] is expected

    def test_route_is_still_admin_gated(self, monkeypatch):
        monkeypatch.setenv("APP_SECRET", "x-local-test-secret-xxxxxxxxxxxx")
        from fastapi.testclient import TestClient
        import app.main as M
        r = TestClient(M.app).get("/api/admin/deployment-health")
        assert r.status_code == 401
