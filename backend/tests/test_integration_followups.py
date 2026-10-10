"""
Follow-ups from the cross-group review of the audit fix branch.

Each class pins one problem that only showed up once the fix groups were
merged: Studio scoped by the invoice "Raised By" override instead of the
login it stamps rows with, legacy password sessions calling the models
unmetered, the status stream skipping session checks, and "Share selected"
status links silently losing their files.
"""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import app.main as M
import app.routers.ai as A
import app.routers.deps as D
import app.routers.studio as S
from app.config import settings
from app.routers.auth import make_token
from app.services import shared_views as SV


def _req(**state):
    return SimpleNamespace(state=SimpleNamespace(**state), headers={}, client=None)


class TestStudioScope:
    def test_scoped_user_is_matched_on_login_email_not_the_raised_by_override(self):
        req = _req(is_email_auth=True, auth_role="user",
                   auth_user_email="uma@corp.example", auth_teable_email="vik@corp.example")
        assert D.owner_scope_email(req) == "vik@corp.example"   # invoices keep the override
        assert S._studio_scope(req) == "uma@corp.example"       # Studio rows are stamped with the login

    def test_privileged_roles_stay_unscoped(self):
        req = _req(is_email_auth=True, auth_role="admin", auth_user_email="a@corp.example")
        assert S._studio_scope(req) is None

    def test_legacy_sessions_stay_unscoped(self):
        assert S._studio_scope(_req(is_email_auth=False)) is None


class TestLegacyAiBudget:
    @pytest.fixture
    def counter(self, monkeypatch):
        seen: dict[str, int] = {}

        async def rate_check(key, limit=60, window_sec=60, bucket="ratelimit"):
            k = f"{bucket}:{key}"
            seen[k] = seen.get(k, 0) + 1
            return seen[k] <= limit, max(0, limit - seen[k])

        monkeypatch.setattr(A, "rate_check", rate_check)
        return seen

    def test_a_legacy_role_shares_one_daily_budget(self, counter, monkeypatch):
        monkeypatch.setattr(settings, "legacy_ai_daily_call_limit", 2)
        monkeypatch.setattr(settings, "ai_daily_limit_by_role", {})
        req = _req(role="viewer")
        asyncio.run(A._ai_quota(req))
        asyncio.run(A._ai_quota(req))
        with pytest.raises(HTTPException) as e:
            asyncio.run(A._ai_quota(req))
        assert e.value.status_code == 429
        assert counter == {"aiquota:legacy:viewer": 3}

    def test_each_legacy_role_has_its_own_budget(self, counter, monkeypatch):
        monkeypatch.setattr(settings, "legacy_ai_daily_call_limit", 1)
        monkeypatch.setattr(settings, "ai_daily_limit_by_role", {})
        asyncio.run(A._ai_quota(_req(role="viewer")))
        asyncio.run(A._ai_quota(_req(role="editor")))   # not blocked by the viewer's spend

    def test_a_role_override_of_zero_blocks_ai(self, counter, monkeypatch):
        monkeypatch.setattr(settings, "ai_daily_limit_by_role", {"legacy:web": 0})
        with pytest.raises(HTTPException) as e:
            asyncio.run(A._ai_quota(_req(role="web")))
        assert e.value.status_code == 403
        assert counter == {}

    def test_email_users_keep_the_per_user_quota(self, counter, monkeypatch):
        calls = []

        async def quota_state(user_id, role=None):
            calls.append(user_id)
            return {"allowed": True, "used": 0, "limit": 200, "metered": True}

        monkeypatch.setattr(A.ai_usage, "quota_state", quota_state)
        asyncio.run(A._ai_quota(_req(role="editor", auth_user_id="u-1", auth_role="manager")))
        assert calls == ["u-1"] and counter == {}


class TestStatusStreamSessionChecks:
    def test_a_revoked_session_cannot_open_the_stream(self, monkeypatch):
        async def attach(request, token_hint, **kw):
            if kw.get("session_bound"):
                raise HTTPException(401, "Session has been revoked")
            return None

        monkeypatch.setattr(D, "_attach_auth_session", attach)
        token = make_token("editor", session_bound=True)
        r = TestClient(M.app).get(f"/api/status/stream?token={token}")
        assert r.status_code == 401

    def test_an_invalid_token_is_refused(self):
        r = TestClient(M.app).get("/api/status/stream?token=not-a-token")
        assert r.status_code == 401


class TestStatusShareFiles:
    def test_share_selected_links_without_columns_still_show_files(self):
        assert "Attachments" in SV._public_fields("status", None, "read")

    def test_links_with_columns_show_files_only_when_chosen(self):
        cols = {"columns": ["Client", "Project", "Status"]}
        assert "Attachments" not in SV._public_fields("status", cols, "read")
        assert "Attachments" in SV._public_fields("status", {"columns": ["Client", "Attachments"]}, "read")
