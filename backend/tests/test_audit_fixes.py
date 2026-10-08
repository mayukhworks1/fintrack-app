"""
Regression cover for the audit fixes landed together.

Each class guards one behaviour that was verified by hand before being
committed; these pin them so they cannot quietly regress.

  * mirror writes never move backwards (upsert_record stale-skip)
  * legacy role tokens are revoked by logout (deps.require_auth)
  * the AI quota gates exactly the LLM-calling endpoints (routers.ai)
  * a failing cold-start sync does not kill the sync loop (db.sync)
  * responses over the wire are gzip-compressed (main)
"""

import asyncio
import inspect
import json
import logging

import pytest
from fastapi import HTTPException


# ── 1. upsert_record refuses to move backwards ───────────────────────────────

class TestStaleSkip:
    def _t(self, s):
        return {"lastModifiedTime": s}

    @pytest.mark.parametrize("incoming,stored,expected", [
        ({"lastModifiedTime": "2026-10-01T00:00:00.000Z"}, {"lastModifiedTime": "2026-10-02T00:00:00.000Z"}, True),
        ({"lastModifiedTime": "2026-10-02T00:00:00.000Z"}, {"lastModifiedTime": "2026-10-02T00:00:00.000Z"}, False),
        ({"lastModifiedTime": "2026-10-03T00:00:00.000Z"}, {"lastModifiedTime": "2026-10-02T00:00:00.000Z"}, False),
        ({},                                                {"lastModifiedTime": "2026-10-02T00:00:00.000Z"}, False),
        ({"lastModifiedTime": "2026-10-01T00:00:00.000Z"}, {},                                                False),
        ({"lastModifiedTime": "not-a-date"},               {"lastModifiedTime": "2026-10-02T00:00:00.000Z"}, False),
    ])
    def test_only_a_strictly_newer_stored_copy_blocks(self, incoming, stored, expected):
        from app.db.sync import _is_older_than_stored
        assert _is_older_than_stored(incoming, stored) is expected

    def test_older_record_is_skipped_without_write_or_history(self, monkeypatch):
        import app.db.sync as S
        import app.db.attribution as A
        from app.db.sync import upsert_record

        execs, hist = [], []

        class Conn:
            async def fetchrow(self, sql, *p):
                return {"fields": json.dumps({"Name": "new", "lastModifiedTime": "2026-10-02T00:00:00.000Z"})}
            async def execute(self, sql, *p):
                execs.append(sql.split()[0])

        class Pool:
            def acquire(self): return self
            async def __aenter__(self): return Conn()
            async def __aexit__(self, *a): pass

        async def fake_hist(*a, **k): hist.append(1)
        async def nopop(tid): return None
        monkeypatch.setattr(S, "_insert_history", fake_hist)
        monkeypatch.setattr(A, "pop_attribution", nopop)

        older = {"Name": "OLD", "lastModifiedTime": "2026-10-01T00:00:00.000Z"}
        assert asyncio.run(upsert_record(Pool(), "invoices", "invoices_mirror", "r", older, lambda f: {})) == "stale"
        assert execs.count("UPDATE") == 0 and hist == []

        newer = {"Name": "NEWER", "lastModifiedTime": "2026-10-03T00:00:00.000Z"}
        assert asyncio.run(upsert_record(Pool(), "invoices", "invoices_mirror", "r", newer, lambda f: {})) == "updated"
        assert execs.count("UPDATE") == 1 and len(hist) == 1


# ── 2. legacy tokens honour logout ───────────────────────────────────────────

class TestLegacyRevocation:
    class _P:
        def __init__(self, v=None, raise_=False): self.v, self.r = v, raise_
        async def fetchval(self, sql, *p):
            if self.r: raise RuntimeError("pg down")
            assert "login_sessions" in sql and "token_hint" in sql
            return self.v

    def _run(self, monkeypatch, pool):
        import app.routers.deps as D
        monkeypatch.setattr(D, "get_pool", lambda: pool)
        try:
            asyncio.run(D._reject_if_legacy_session_revoked("abcdefghijklmnop"))
            return "allow"
        except HTTPException as e:
            return e.status_code

    def test_explicitly_inactive_is_rejected(self, monkeypatch):
        assert self._run(monkeypatch, self._P(False)) == 401

    @pytest.mark.parametrize("pool", [_P(True), _P(None), _P(raise_=True), None])
    def test_active_missing_error_and_no_pool_all_allow(self, monkeypatch, pool):
        # Closing the logout gap must not become a mass logout on a DB blip.
        assert self._run(monkeypatch, pool) == "allow"

    def test_email_auth_sessions_never_reach_the_legacy_lookup(self, monkeypatch):
        import app.routers.deps as D
        calls = []
        async def attach_row(request, hint): return {"session_id": "s"}
        async def legacy(hint): calls.append(hint)
        monkeypatch.setattr(D, "_attach_auth_session", attach_row)
        monkeypatch.setattr(D, "_reject_if_legacy_session_revoked", legacy)
        monkeypatch.setattr(D, "verify_token", lambda t: "viewer")
        class Req:
            class state: pass
        asyncio.run(D.require_auth(Req(), token="abcdefghijklmnopqrstuvwxyz"))
        assert calls == []

    def test_legacy_tokens_do_reach_it(self, monkeypatch):
        import app.routers.deps as D
        calls = []
        async def attach_none(request, hint): return None
        async def legacy(hint): calls.append(hint)
        monkeypatch.setattr(D, "_attach_auth_session", attach_none)
        monkeypatch.setattr(D, "_reject_if_legacy_session_revoked", legacy)
        monkeypatch.setattr(D, "verify_token", lambda t: "viewer")
        class Req:
            class state: pass
        asyncio.run(D.require_auth(Req(), token="abcdefghijklmnopqrstuvwxyz"))
        assert calls == ["abcdefghijklmnop"]


# ── 3. AI quota gates exactly the LLM callers ────────────────────────────────

LLM_ENDPOINTS  = ["ai_chat", "ai_chat_stream", "ai_autofill", "ai_analyze", "ai_report", "ai_status_briefing"]
CRUD_ENDPOINTS = ["ai_report_invalidate", "ai_report_history", "ai_report_history_detail", "ai_report_history_delete"]


def _gated(fn):
    import app.routers.ai as AI
    return any(getattr(p.default, "dependency", None) is AI._ai_quota
               for p in inspect.signature(fn).parameters.values())


class TestAIQuotaCoverage:
    @pytest.mark.parametrize("name", LLM_ENDPOINTS)
    def test_every_llm_caller_is_gated(self, name):
        import app.routers.ai as AI
        assert _gated(getattr(AI, name)), f"{name} calls the LLM but has no quota gate"

    @pytest.mark.parametrize("name", CRUD_ENDPOINTS)
    def test_report_crud_is_not_gated(self, name):
        # Reading or deleting a stored report costs nothing; gating it would
        # lock users out of their own history once the daily cap is hit.
        import app.routers.ai as AI
        assert not _gated(getattr(AI, name)), f"{name} must not be quota-gated"

    def test_gate_rejects_with_429_when_spent(self, monkeypatch):
        import app.routers.ai as AI
        import app.services.ai_usage as U
        async def spent(uid, role): return {"allowed": False, "used": 200, "limit": 200}
        monkeypatch.setattr(U, "quota_state", spent)
        class R:
            class state: auth_user_id = "u1"; auth_role = "viewer"
        with pytest.raises(HTTPException) as e:
            asyncio.run(AI._ai_quota(R()))
        assert e.value.status_code == 429

    def test_gate_passes_when_allowed_and_for_unmetered_legacy_tokens(self, monkeypatch):
        import app.routers.ai as AI
        import app.services.ai_usage as U
        seen = {}
        async def fine(uid, role):
            seen["uid"] = uid
            return {"allowed": True, "used": 0, "limit": 200}
        monkeypatch.setattr(U, "quota_state", fine)
        class R:
            class state: auth_user_id = "u1"; auth_role = "viewer"
        asyncio.run(AI._ai_quota(R()))
        class Legacy:
            class state: auth_role = "editor"
        asyncio.run(AI._ai_quota(Legacy()))
        assert seen["uid"] is None


# ── 4. a failing cold-start sync no longer kills the loop ────────────────────

class TestSyncColdStart:
    def test_loop_survives_a_raising_initial_sync(self, monkeypatch):
        import app.db.sync as S
        monkeypatch.setattr(S, "_INCREMENTAL_INTERVAL", 0.01)
        monkeypatch.setattr(S, "_FULL_INTERVAL", 1)
        n = {"calls": 0}
        async def boom_then_ok(incremental=False):
            n["calls"] += 1
            if n["calls"] == 1:
                raise RuntimeError("Teable timeout at cold start")
        monkeypatch.setattr(S, "run_sync", boom_then_ok)
        real_sleep = asyncio.sleep
        async def fast(s): await real_sleep(0)
        monkeypatch.setattr(S.asyncio, "sleep", fast)
        logged = []
        class H(logging.Handler):
            def emit(self, r): logged.append(r.getMessage())
        S.logger.addHandler(h := H())
        try:
            async def drive():
                t = asyncio.create_task(S.sync_loop())
                for _ in range(30):
                    await real_sleep(0.005)
                alive = not t.done()
                t.cancel()
                try: await t
                except (asyncio.CancelledError, Exception): pass
                return alive
            assert asyncio.run(drive()) is True
            assert n["calls"] > 1
            assert any("initial full sync failed" in m for m in logged)
        finally:
            S.logger.removeHandler(h)


# ── 5. responses are compressed ──────────────────────────────────────────────

class TestGzip:
    def test_large_bodies_are_gzipped_and_tiny_ones_are_not(self, monkeypatch):
        monkeypatch.setenv("APP_SECRET", "x-local-test-secret-xxxxxxxxxxxx")
        from fastapi.testclient import TestClient
        from fastapi.middleware.gzip import GZipMiddleware
        import app.main as M
        assert any(m.cls is GZipMiddleware for m in M.app.user_middleware)
        c = TestClient(M.app)
        big = c.get("/openapi.json", headers={"Accept-Encoding": "gzip"})
        small = c.get("/health/live", headers={"Accept-Encoding": "gzip"})
        assert big.headers.get("content-encoding") == "gzip"
        assert small.headers.get("content-encoding") is None
