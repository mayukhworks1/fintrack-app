"""
Cover for app.services.alerts and its two integration points.

The module exists to make failures visible, so the properties that matter
most are the ones that would make it go quiet or take the app down with it:

  * every signal fires on its condition and stays silent otherwise;
  * pool exhaustion needs a streak — one busy sample under load must not page;
  * dedup falls back to memory when Valkey is down, and a recovery releases
    the cooldown so a relapse pages again instead of being swallowed;
  * delivery never raises, whatever the webhook or Brevo does;
  * the monitor loop exits cleanly when unconfigured and survives a crashing
    check when configured;
  * the middleware counts a 5xx on both the normal and the exception path.

Two harness rules, learned the hard way while verifying this by hand: patch
`deliver` through monkeypatch so it is restored per test (a stub left in
place made a later test exercise the stub and report false failures), and
cap the crash-survival loop with near-zero sleeps and a short drive window
so it cannot flood the log.
"""

import asyncio
import logging
import time

import pytest

import app.services.alerts as A
import app.services.emailer as E
from app.config import settings


@pytest.fixture(autouse=True)
def _quiet_and_reset(monkeypatch):
    logging.disable(logging.CRITICAL)
    monkeypatch.setattr(A, "_active", {})
    monkeypatch.setattr(A, "_mem_cooldown", {})
    monkeypatch.setattr(A, "_pool_exhausted_streak", 0)
    A._server_errors.clear()
    monkeypatch.setattr(A.vk, "get_client", lambda: None)       # memory cooldown path
    monkeypatch.setattr(A.postgres, "get_pool", lambda: None)
    monkeypatch.setattr(settings, "postgres_url", None)
    monkeypatch.setattr(settings, "alert_webhook_url", None)
    monkeypatch.setattr(settings, "alert_email_to", None)
    A.register_tasks(lambda: {})
    yield
    logging.disable(logging.NOTSET)


def _keys():
    return {a.key for a in asyncio.run(A.evaluate())}


# ── signals ──────────────────────────────────────────────────────────────────

class TestTaskDead:
    def test_fires_only_for_a_task_that_died_with_an_exception(self):
        async def boom(): raise RuntimeError("loop crashed")
        async def forever(): await asyncio.sleep(3600)

        async def scenario():
            dead = asyncio.create_task(boom())
            running = asyncio.create_task(forever())
            cancelled = asyncio.create_task(forever())
            await asyncio.sleep(0)
            cancelled.cancel()
            for t in (dead, cancelled):
                try: await t
                except (RuntimeError, asyncio.CancelledError): pass
            A.register_tasks(lambda: {"dead": dead, "running": running, "cancelled": cancelled, "none": None})
            keys = {a.key for a in await A.evaluate()}
            running.cancel()
            return keys

        keys = asyncio.run(scenario())
        assert "task_dead:dead" in keys
        assert not {"task_dead:running", "task_dead:cancelled", "task_dead:none"} & keys


class TestSyncStale:
    @pytest.fixture(autouse=True)
    def _teable(self, monkeypatch):
        import app.db.sync as S
        monkeypatch.setattr(settings, "postgres_url", "postgres://x")
        monkeypatch.setattr(settings, "teable_api_token", "tok")
        monkeypatch.setattr(settings, "alert_sync_stale_seconds", 600)
        self.S = S

    def test_fires_when_last_success_is_old_and_not_when_recent(self, monkeypatch):
        monkeypatch.setattr(self.S, "_last_incremental_at", time.time() - 10_000)
        assert "sync_stale" in _keys()
        monkeypatch.setattr(self.S, "_last_incremental_at", time.time())
        assert "sync_stale" not in _keys()

    def test_never_synced_fires_only_past_the_grace_period(self, monkeypatch):
        monkeypatch.setattr(self.S, "_last_incremental_at", 0.0)
        monkeypatch.setattr(A, "_started_at", time.time())
        assert "sync_stale" not in _keys()
        monkeypatch.setattr(A, "_started_at", time.time() - 10_000)
        alerts = {a.key: a for a in asyncio.run(A.evaluate())}
        assert "sync_stale" in alerts and "never" in alerts["sync_stale"].title


class TestPostgresAndPool:
    class _Pool:
        def __init__(self, idle): self.idle = idle
        def get_size(self): return 10
        def get_idle_size(self): return self.idle
        def get_max_size(self): return 10

    def test_postgres_down_fires_when_url_is_set_and_pool_is_none(self, monkeypatch):
        monkeypatch.setattr(settings, "postgres_url", "postgres://x")
        assert "postgres_down" in _keys()

    def test_pool_exhausted_needs_a_streak_and_resets_on_an_idle_sample(self, monkeypatch):
        monkeypatch.setattr(settings, "alert_pool_exhausted_checks", 3)
        monkeypatch.setattr(A.postgres, "get_pool", lambda: self._Pool(0))
        assert ["pool_exhausted" in _keys() for _ in range(3)] == [False, False, True]
        monkeypatch.setattr(A.postgres, "get_pool", lambda: self._Pool(2))
        _keys()
        monkeypatch.setattr(A.postgres, "get_pool", lambda: self._Pool(0))
        assert "pool_exhausted" not in _keys()


class TestErrorRate:
    def test_fires_at_threshold_not_below(self, monkeypatch):
        monkeypatch.setattr(settings, "alert_error_rate_threshold", 5)
        monkeypatch.setattr(settings, "alert_error_rate_window_seconds", 300)
        for _ in range(4): A.record_server_error()
        assert "error_rate" not in _keys()
        A.record_server_error()
        assert "error_rate" in _keys()


# ── dedup / recovery ─────────────────────────────────────────────────────────

class TestCooldown:
    def test_memory_fallback_dedups_and_expires(self):
        assert asyncio.run(A._acquire_cooldown("k", 2)) is True
        assert asyncio.run(A._acquire_cooldown("k", 2)) is False
        A._mem_cooldown["k"] = time.time() - 1
        assert asyncio.run(A._acquire_cooldown("k", 2)) is True

    def test_send_suppress_recover_relapse(self, monkeypatch):
        sent = []
        async def fake_deliver(alert, *, recovered=False):
            sent.append(("R:" if recovered else "") + alert.key); return {}
        state = {"on": True}
        async def fake_eval():
            return [A.Alert("x", "critical", "X", "d")] if state["on"] else []
        monkeypatch.setattr(A, "deliver", fake_deliver)
        monkeypatch.setattr(A, "evaluate", fake_eval)
        monkeypatch.setattr(settings, "alert_cooldown_seconds", 1800)

        asyncio.run(A.check_once()); asyncio.run(A.check_once())
        assert sent == ["x"]                      # repeat inside cooldown suppressed
        state["on"] = False; asyncio.run(A.check_once())
        assert sent == ["x", "R:x"]               # one recovery
        state["on"] = True; asyncio.run(A.check_once())
        assert sent == ["x", "R:x", "x"]          # relapse pages: recovery released cooldown


# ── delivery never raises ────────────────────────────────────────────────────

class _Ctx:
    def __init__(self, post): self._post = post
    async def __aenter__(self): return self
    async def __aexit__(self, *a): pass
    async def post(self, *a, **k): return await self._post(*a, **k)

class _Resp:
    def __init__(self, code): self.status_code = code


class TestDeliver:
    @pytest.fixture(autouse=True)
    def _targets(self, monkeypatch):
        monkeypatch.setattr(settings, "alert_webhook_url", "https://hook.invalid/x")
        monkeypatch.setattr(settings, "alert_email_to", "ops@x.com")
        self.alert = A.Alert("t", "warning", "T", "d")

    def _run(self, monkeypatch, post, mail):
        monkeypatch.setattr(A, "shared_client", lambda **k: _Ctx(post))
        monkeypatch.setattr(E, "send_email", mail)
        return asyncio.run(A.deliver(self.alert))   # any raise fails the test

    def test_webhook_exception_is_reported_not_raised(self, monkeypatch):
        async def raises(*a, **k): raise ConnectionError("dns")
        async def mail(*a, **k): return {"sent": False, "reason": "x"}
        assert self._run(monkeypatch, raises, mail)["webhook"] is False

    def test_webhook_non_2xx_is_reported_false(self, monkeypatch):
        async def r500(*a, **k): return _Resp(500)
        async def mail(*a, **k): return {"sent": False}
        assert self._run(monkeypatch, r500, mail)["webhook"] is False

    def test_email_failure_and_email_exception_are_reported_not_raised(self, monkeypatch):
        async def r200(*a, **k): return _Resp(200)
        async def mail_fail(*a, **k): return {"sent": False, "reason": "email_not_configured"}
        async def mail_raise(*a, **k): raise RuntimeError("brevo exploded")
        assert self._run(monkeypatch, r200, mail_fail)["email"] is False
        assert self._run(monkeypatch, r200, mail_raise)["email"] is False

    def test_positive_path_and_channel_skipping(self, monkeypatch):
        async def r200(*a, **k): return _Resp(200)
        async def mail_ok(*a, **k): return {"sent": True}
        assert self._run(monkeypatch, r200, mail_ok) == {"webhook": True, "email": True}
        monkeypatch.setattr(settings, "alert_webhook_url", None)
        assert self._run(monkeypatch, r200, mail_ok) == {"email": True}


# ── the loop ─────────────────────────────────────────────────────────────────

class TestMonitorLoop:
    def test_exits_immediately_when_unconfigured(self):
        assert asyncio.run(asyncio.wait_for(A.alert_monitor_loop(), 1)) is None

    def test_survives_a_crashing_check(self, monkeypatch):
        monkeypatch.setattr(settings, "alert_webhook_url", "https://hook.invalid/x")
        monkeypatch.setattr(settings, "alert_check_interval_seconds", 0)
        n = {"c": 0}
        async def exploding(): n["c"] += 1; raise RuntimeError("boom")
        monkeypatch.setattr(A, "check_once", exploding)
        real_sleep = asyncio.sleep
        async def fast(_s): await real_sleep(0)
        monkeypatch.setattr(A.asyncio, "sleep", fast)

        async def drive():
            task = asyncio.create_task(A.alert_monitor_loop())
            for _ in range(20): await real_sleep(0.002)
            alive = not task.done(); task.cancel()
            try: await task
            except (asyncio.CancelledError, Exception): pass
            return alive

        assert asyncio.run(drive()) is True and n["c"] > 1

    def test_send_test_alert_reports_configuration_and_delivery(self, monkeypatch):
        monkeypatch.setattr(settings, "alert_webhook_url", "https://hook.invalid/x")
        sent = []
        async def fake_deliver(alert, *, recovered=False): sent.append(alert.key); return {"webhook": True}
        monkeypatch.setattr(A, "deliver", fake_deliver)
        out = asyncio.run(A.send_test_alert())
        assert out["configured"] is True and sent == ["test"]


# ── middleware integration ───────────────────────────────────────────────────

class TestMiddlewareCounts5xx:
    def test_counts_returned_500_and_raised_exception_but_not_200(self, monkeypatch):
        monkeypatch.setenv("APP_SECRET", "x-local-test-secret-xxxxxxxxxxxx")
        from fastapi.testclient import TestClient
        from fastapi.responses import JSONResponse
        import app.main as M

        @M.app.get("/__alerts_t/ok")
        async def _ok(): return {"ok": 1}
        @M.app.get("/__alerts_t/500")
        async def _500(): return JSONResponse({"e": 1}, status_code=500)
        @M.app.get("/__alerts_t/boom")
        async def _boom(): raise RuntimeError("x")

        c = TestClient(M.app, raise_server_exceptions=False)
        A._server_errors.clear()
        c.get("/__alerts_t/ok");   assert A.server_errors_in_window(300) == 0
        c.get("/__alerts_t/500");  assert A.server_errors_in_window(300) == 1
        c.get("/__alerts_t/boom"); assert A.server_errors_in_window(300) == 2
