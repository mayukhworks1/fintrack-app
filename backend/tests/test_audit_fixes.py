"""
Regression cover for the audit fixes landed together.

Each class guards one behaviour that was verified by hand before being
committed; these pin them so they cannot quietly regress.

  * mirror writes never move backwards (upsert_record stale-skip)
  * legacy role tokens are revoked by logout (deps.require_auth)
  * the AI quota gates exactly the LLM-calling endpoints (every router)
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
    """
    The legacy login_sessions.is_active read now rides in the same statement
    as the auth_sessions lookup (deps._AUTH_LOOKUP_SQL), so a legacy token
    costs one round trip, not two. The row always comes back — session
    columns NULL when there is no email-auth session — with `legacy_active`
    alongside. These pin what each shape of row must do.
    """

    class _P:
        def __init__(self, legacy_active=None, session=False):
            self.legacy_active, self.session = legacy_active, session
            self.calls = 0
        async def fetchrow(self, sql, *p):
            self.calls += 1
            assert "auth_sessions s" in sql and "login_sessions" in sql, "both reads in one statement"
            row = {"session_id": None, "user_id": None, "expires_at": None, "revoked_at": None,
                   "metadata": None, "email": None, "first_name": None, "last_name": None,
                   "full_name": None, "status": None, "teable_email": None, "auth_role": None,
                   "legacy_active": self.legacy_active}
            if self.session:
                row.update(session_id="s1", user_id="u1", email="u@x", status="active")
            return row

    def _attach(self, monkeypatch, pool):
        import app.routers.deps as D
        monkeypatch.setattr(D, "get_pool", lambda: pool)
        class Req:
            class state: pass
            class url: path = "/x"
        try:
            return asyncio.run(D._attach_auth_session(Req(), "abcdefghijklmnop"))
        except HTTPException as e:
            return e.status_code

    def test_explicitly_inactive_legacy_login_is_rejected(self, monkeypatch):
        assert self._attach(monkeypatch, self._P(legacy_active=False)) == 401

    @pytest.mark.parametrize("pool", [_P(legacy_active=True), _P(legacy_active=None), None])
    def test_active_missing_and_no_pool_all_allow(self, monkeypatch, pool):
        # Closing the logout gap must not become a mass logout.
        assert self._attach(monkeypatch, pool) is None

    def test_an_email_session_is_attached_regardless_of_the_legacy_column(self, monkeypatch):
        out = self._attach(monkeypatch, self._P(legacy_active=False, session=True))
        assert isinstance(out, dict) and out["session_id"] == "s1"

    @pytest.mark.parametrize("session", [True, False])
    def test_require_auth_is_one_round_trip_for_both_token_kinds(self, monkeypatch, session):
        import app.routers.deps as D
        pool = self._P(legacy_active=None, session=session)
        monkeypatch.setattr(D, "get_pool", lambda: pool)
        monkeypatch.setattr(D, "verify_token", lambda t: "viewer")
        class Req:
            class state: pass
            class url: path = "/x"
        asyncio.run(D.require_auth(Req(), token="abcdefghijklmnopqrstuvwxyz"))
        assert pool.calls == 1


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

    # The list above names routers.ai only, so model calls made from other
    # routers went ungated without this test noticing: page generation,
    # invoice parsing and the status-board update. They are named here, and the
    # route walk below catches the next one before it ships.
    OTHER_LLM_ENDPOINTS = [
        ("pages", "ai_generate_page"), ("pages", "ai_interview"), ("pages", "ai_stream_page"),
        ("pages", "ai_section_edit"), ("pages", "ai_fix_error"),
        ("invoices", "parse_invoice"), ("web_invoices", "parse_web_invoice"),
        ("status", "generate_ai_status_update"),
    ]

    @pytest.mark.parametrize("module,name", OTHER_LLM_ENDPOINTS)
    def test_llm_callers_in_other_routers_are_gated(self, module, name):
        import importlib
        fn = getattr(importlib.import_module(f"app.routers.{module}"), name)
        assert _gated(fn), f"{module}.{name} calls the LLM but has no quota gate"

    # What a route calls to reach the model. Studio's /ask and /analyze check
    # the same quota inline and are covered in test_studio_scoping.
    LLM_ENTRY_POINTS = {
        "generate_page", "analyze_prompt_needs", "stream_generate_page",
        "edit_page_section", "fix_page_script_error",
        "_try_chat", "chat_with_ai", "chat_with_ai_tuned", "stream_chat_with_ai",
        "judge_answer", "autofill_project", "analyze_project", "generate_report",
        "generate_status_briefing", "ai_status_update", "parse_invoice_document",
    }

    def test_no_registered_route_reaches_the_model_without_the_gate(self):
        import app.main as M
        import app.routers.ai as AI
        from fastapi.routing import APIRoute

        def referenced(code):
            # A streaming route calls the model from a generator nested inside it.
            names = set(code.co_names)
            for const in code.co_consts:
                if inspect.iscode(const):
                    names |= referenced(const)
            return names

        def gated(dependant):
            return any(d.call is AI._ai_quota or gated(d) for d in dependant.dependencies)

        callers = {
            r.path: gated(r.dependant)
            for r in M.app.routes
            if isinstance(r, APIRoute)
            and r.endpoint.__module__ != "app.routers.studio"
            and referenced(r.endpoint.__code__) & self.LLM_ENTRY_POINTS
        }
        # The walk must actually find the callers it exists to police.
        assert {"/api/pages/ai/stream", "/api/invoices/parse", "/api/web-invoices/parse",
                "/api/status/ai-update"} <= set(callers)
        ungated = sorted(path for path, ok in callers.items() if not ok)
        assert ungated == [], f"these routes call the model without the AI quota: {ungated}"


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
