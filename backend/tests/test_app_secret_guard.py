"""
Regression cover for the APP_SECRET fail-open.

app_secret is the HMAC key for every session token, and make_token() puts the
role inside the signed payload — so a known key lets anyone mint a superadmin
token. Its default, "fintrack-dev-secret-change-me", is committed to a public
repo.

The bug: startup logged an error about this and then served traffic anyway. A
deployment that lost APP_SECRET stayed fully bypassable behind a single log
line, while every other missing secret in the same block already failed closed.

Startup now refuses to boot on the dev default unless APP_ENV marks the machine
as development. APP_ENV defaults to production, so a host that never sets it
gets the strict path — guessing wrong in that direction is the safe one.
"""

import importlib
import sys

import pytest


def _reload_config(monkeypatch, *, app_secret=None, app_env=None):
    """Re-import app.config under a given environment and return the module."""
    monkeypatch.delenv("APP_SECRET", raising=False)
    monkeypatch.delenv("APP_ENV", raising=False)
    if app_secret is not None:
        monkeypatch.setenv("APP_SECRET", app_secret)
    if app_env is not None:
        monkeypatch.setenv("APP_ENV", app_env)
    sys.modules.pop("app.config", None)
    return importlib.import_module("app.config")


def _would_refuse(cfg) -> bool:
    """The condition main.py's lifespan raises on."""
    return cfg.using_insecure_app_secret() and not cfg.is_dev_env()


class TestRefusesTheDevSecretOutsideDevelopment:
    def test_unset_app_secret_with_no_app_env_is_refused(self, monkeypatch):
        # The real-world failure: a deploy that simply forgot the secret.
        assert _would_refuse(_reload_config(monkeypatch)) is True

    def test_explicit_production_is_refused(self, monkeypatch):
        assert _would_refuse(_reload_config(monkeypatch, app_env="production")) is True

    @pytest.mark.parametrize("value", ["prod", "", "staging", "PRODUCTION"])
    def test_anything_not_a_dev_name_is_refused(self, monkeypatch, value):
        # An unrecognised APP_ENV must not be read as permission to run insecurely.
        assert _would_refuse(_reload_config(monkeypatch, app_env=value)) is True


class TestAllowsLocalDevelopment:
    @pytest.mark.parametrize("value", ["development", "dev", "local", "test", "DEV", " Development "])
    def test_dev_env_names_may_run_on_the_dev_secret(self, monkeypatch, value):
        assert _would_refuse(_reload_config(monkeypatch, app_env=value)) is False


class TestNeverBlocksAConfiguredDeployment:
    @pytest.mark.parametrize("app_env", [None, "production", "development"])
    def test_a_real_secret_always_boots(self, monkeypatch, app_env):
        cfg = _reload_config(monkeypatch, app_secret="a-long-random-production-secret", app_env=app_env)
        assert cfg.using_insecure_app_secret() is False
        assert _would_refuse(cfg) is False


class TestHealthEndpointAgreesWithTheGuard:
    def test_app_secret_check_uses_the_shared_helper(self):
        # admin.py previously re-spelled the dev secret as a literal. A second
        # spelling could report "configured" while the guard saw it as insecure.
        source = (
            importlib.import_module("app.routers.admin").__file__
        )
        with open(source, encoding="utf-8") as fh:
            text = fh.read()
        assert "using_insecure_app_secret()" in text
        assert text.count('"fintrack-dev-secret-change-me"') == 0


def teardown_module(_module):
    # Leave app.config as the rest of the suite expects to find it.
    sys.modules.pop("app.config", None)
    importlib.import_module("app.config")
