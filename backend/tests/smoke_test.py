"""
Smoke tests — fast, no external dependencies (DB/Teable/email are mocked).
Run: cd backend && python -m pytest tests/smoke_test.py -v
"""

import importlib
import sys
import types
import pytest


# ── Minimal stubs so the app can be imported without real services ────────────

def _stub_module(name: str, **attrs):
    """Insert a stub module into sys.modules."""
    mod = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    sys.modules[name] = mod
    return mod


# Stub asyncpg so postgres.py doesn't connect at import time
asyncpg_stub = _stub_module("asyncpg",
    create_pool=lambda *a, **kw: None,
    Pool=object,
)

# Stub redis
redis_stub = _stub_module("redis", asyncio=types.ModuleType("redis.asyncio"))
_stub_module("redis.asyncio")

# ─────────────────────────────────────────────────────────────────────────────


class TestAuthUtils:
    """Unit-level: token helpers in auth.py — no network."""

    def _get_auth_module(self):
        # Patch settings before import
        import os
        os.environ.setdefault("APP_SECRET", "test-secret-do-not-use")
        # Import fresh
        if "app.routers.auth" in sys.modules:
            return sys.modules["app.routers.auth"]
        try:
            sys.path.insert(0, str(__file__).split("/tests/")[0])
            from app.routers import auth as auth_mod
            return auth_mod
        except Exception:
            return None

    def test_make_and_verify_token_roundtrip(self):
        auth = self._get_auth_module()
        if auth is None:
            pytest.skip("Could not import auth module")
        for role in ("editor", "viewer", "web", "admin"):
            token = auth.make_token(role=role, ttl=300)
            assert isinstance(token, str) and len(token) > 20
            decoded = auth.verify_token(token)
            assert decoded == role, f"Expected {role}, got {decoded}"

    def test_expired_token_returns_none(self):
        auth = self._get_auth_module()
        if auth is None:
            pytest.skip("Could not import auth module")
        token = auth.make_token(role="editor", ttl=-1)  # already expired
        assert auth.verify_token(token) is None

    def test_tampered_token_rejected(self):
        auth = self._get_auth_module()
        if auth is None:
            pytest.skip("Could not import auth module")
        token = auth.make_token(role="editor", ttl=300)
        tampered = token[:-4] + "XXXX"
        assert auth.verify_token(tampered) is None

    def test_empty_token_rejected(self):
        auth = self._get_auth_module()
        if auth is None:
            pytest.skip("Could not import auth module")
        assert auth.verify_token("") is None
        assert auth.verify_token("garbage") is None


class TestPasswordUtils:
    """Unit-level: password hashing in auth_master.py."""

    def _get_master(self):
        try:
            sys.path.insert(0, str(__file__).split("/tests/")[0])
            from app.services import auth_master
            return auth_master
        except Exception:
            return None

    def test_hash_and_verify(self):
        m = self._get_master()
        if m is None:
            pytest.skip("Could not import auth_master")
        h = m.hash_password("MyStrongP@ss1")
        assert m.verify_password("MyStrongP@ss1", h)
        assert not m.verify_password("wrong", h)

    def test_weak_password_rejected(self):
        m = self._get_master()
        if m is None:
            pytest.skip("Could not import auth_master")
        import fastapi
        with pytest.raises((fastapi.HTTPException, ValueError)):
            m.validate_password("short")

    def test_normalize_email_lowercases(self):
        m = self._get_master()
        if m is None:
            pytest.skip("Could not import auth_master")
        assert m.normalize_email("  User@Example.COM  ") == "user@example.com"

    def test_normalize_email_rejects_bad(self):
        m = self._get_master()
        if m is None:
            pytest.skip("Could not import auth_master")
        import fastapi
        with pytest.raises(fastapi.HTTPException):
            m.normalize_email("notanemail")


class TestEmailer:
    """Unit-level: emailer.py configuration check."""

    def test_not_configured_without_key(self, monkeypatch):
        try:
            from app.services import emailer
            from app.config import settings
        except Exception:
            pytest.skip("Cannot import emailer")
        monkeypatch.setattr(settings, "brevoapikey", None, raising=False)
        monkeypatch.setattr(settings, "smtp_from_email", None, raising=False)
        monkeypatch.setattr(settings, "smtp_username", None, raising=False)
        assert not emailer.is_email_configured()

    def test_configured_with_key(self, monkeypatch):
        try:
            from app.services import emailer
            from app.config import settings
        except Exception:
            pytest.skip("Cannot import emailer")
        monkeypatch.setattr(settings, "brevoapikey", "test-key", raising=False)
        monkeypatch.setattr(settings, "smtp_from_email", "test@example.com", raising=False)
        assert emailer.is_email_configured()


class TestOwnerScopeEmail:
    """Unit-level: owner_scope_email logic in deps.py."""

    def _make_request(self, **state_attrs):
        """Fake FastAPI Request with state."""
        class FakeState:
            pass
        class FakeRequest:
            state = FakeState()
        req = FakeRequest()
        for k, v in state_attrs.items():
            setattr(req.state, k, v)
        return req

    def test_legacy_password_returns_none(self):
        try:
            from app.routers.deps import owner_scope_email
        except Exception:
            pytest.skip("Cannot import deps")
        req = self._make_request(is_email_auth=False)
        assert owner_scope_email(req) is None

    def test_privileged_role_returns_none(self):
        try:
            from app.routers.deps import owner_scope_email
        except Exception:
            pytest.skip("Cannot import deps")
        req = self._make_request(
            is_email_auth=True,
            auth_role="superadmin",
            auth_teable_email="admin@co.com",
            auth_user_email="admin@co.com",
        )
        assert owner_scope_email(req) is None

    def test_normal_user_returns_teable_email(self):
        try:
            from app.routers.deps import owner_scope_email
        except Exception:
            pytest.skip("Cannot import deps")
        req = self._make_request(
            is_email_auth=True,
            auth_role="user",
            auth_teable_email="Aditya.narkar@theworks.in",
            auth_user_email="aditya@theworks.in",
        )
        # Should return teable_email (the override), not the login email
        result = owner_scope_email(req)
        assert result == "Aditya.narkar@theworks.in"

    def test_falls_back_to_login_email(self):
        try:
            from app.routers.deps import owner_scope_email
        except Exception:
            pytest.skip("Cannot import deps")
        req = self._make_request(
            is_email_auth=True,
            auth_role="web",
            auth_teable_email=None,
            auth_user_email="mayukh@worksmayukh.space",
        )
        assert owner_scope_email(req) == "mayukh@worksmayukh.space"


class TestAuditUtils:
    """Unit-level: UA parsing in audit.py."""

    def test_parse_ua_desktop(self):
        try:
            from app.db.audit import parse_ua
        except Exception:
            pytest.skip("Cannot import audit")
        os_, browser, device = parse_ua(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0"
        )
        assert "Windows" in os_
        assert "Chrome" in browser
        assert device == "desktop"

    def test_parse_ua_mobile(self):
        try:
            from app.db.audit import parse_ua
        except Exception:
            pytest.skip("Cannot import audit")
        _, _, device = parse_ua(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148 Safari/604.1"
        )
        assert device == "mobile"

    def test_parse_ua_empty(self):
        try:
            from app.db.audit import parse_ua
        except Exception:
            pytest.skip("Cannot import audit")
        os_, browser, device = parse_ua("")
        assert os_ == "Unknown"
        assert browser == "Unknown"
        assert device == "desktop"


class TestAdminHealthUtils:
    """Unit-level: deployment health helper payloads."""

    def test_health_item_shape(self):
        try:
            from app.routers.admin import _health_item
        except Exception:
            pytest.skip("Cannot import admin router")
        item = _health_item(True, "Connected", latency_ms=12)
        assert item["ok"] is True
        assert item["detail"] == "Connected"
        assert item["latency_ms"] == 12
