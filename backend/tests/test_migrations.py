"""
Cover for the Alembic integration, provable without a database.

What is worth pinning here is not that migrations apply — that needs Postgres —
but the properties that would otherwise fail silently or at 3 a.m.:

  * the URL rewrite accepts both schemes a provider might hand out;
  * the revision graph has exactly one head, so `upgrade head` is unambiguous;
  * run_migrations never raises, so a broken revision degrades to "serving on
    the previous schema" and not to "no database".
"""

import asyncio
from pathlib import Path

import pytest

import app.db.migrate as M
from app.config import settings

BACKEND = Path(__file__).resolve().parents[1]


class TestUrlRewrite:
    @pytest.mark.parametrize("raw", [
        "postgres://u:p@h:5432/db",
        "postgresql://u:p@h:5432/db",
        "postgresql+asyncpg://u:p@h:5432/db",
        "postgres+asyncpg://u:p@h:5432/db",
    ])
    def test_every_accepted_scheme_becomes_asyncpg(self, raw):
        assert M.asyncpg_url(raw) == "postgresql+asyncpg://u:p@h:5432/db"

    def test_credentials_survive_and_sslmode_is_dropped(self):
        # Production logged `connect() got an unexpected keyword argument
        # 'sslmode'` on every boot: SQLAlchemy hands URL query keys to
        # asyncpg.connect(), which has no sslmode. SSL comes from connect_args.
        assert M.asyncpg_url("postgres://u:p%40ss@h/db?sslmode=require") == \
            "postgresql+asyncpg://u:p%40ss@h/db"

    def test_other_query_keys_survive_only_libpq_ssl_keys_go(self):
        assert M.asyncpg_url("postgresql://u:p@h/db?sslmode=require&application_name=ft&sslrootcert=/x") == \
            "postgresql+asyncpg://u:p@h/db?application_name=ft"

    @pytest.mark.parametrize("raw", [None, "", "mysql://u:p@h/db"])
    def test_missing_or_foreign_scheme_raises_clearly(self, raw):
        with pytest.raises(RuntimeError):
            M.asyncpg_url(raw)


class TestRevisionGraph:
    def _script(self):
        from alembic.config import Config
        from alembic.script import ScriptDirectory
        cfg = Config(str(BACKEND / "alembic.ini"))
        cfg.set_main_option("script_location", str(BACKEND / "migrations"))
        return ScriptDirectory.from_config(cfg)

    def test_exactly_one_head(self):
        heads = self._script().get_heads()
        assert heads == ["0002_sync_log_indexes"], heads

    def test_the_chain_is_linear_from_the_baseline(self):
        rev = self._script().get_revision("0002_sync_log_indexes")
        assert rev.down_revision == "0001_baseline"

    def test_baseline_is_the_root(self):
        rev = self._script().get_revision("0001_baseline")
        assert rev.down_revision is None


class TestNeverRaises:
    def test_blocking_runner_reports_instead_of_raising(self, monkeypatch):
        monkeypatch.setattr(settings, "postgres_url", None)
        result = M.run_migrations_blocking()     # must not raise
        assert result["ran"] is True and result["ok"] is False
        assert "POSTGRES_URL" in result["error"]
        assert M.state()["ok"] is False          # surfaced for /health

    def test_async_wrapper_returns_false_instead_of_raising(self, monkeypatch):
        monkeypatch.setattr(settings, "postgres_url", None)
        assert asyncio.run(M.run_migrations()) is False

    def test_unreachable_database_is_reported_not_raised(self, monkeypatch):
        # A real URL to nowhere: exercises the actual Alembic/SQLAlchemy path
        # and proves a connection failure stays inside the result dict.
        monkeypatch.setattr(settings, "postgres_url", "postgresql://u:p@127.0.0.1:1/nope")
        result = M.run_migrations_blocking()
        assert result["ok"] is False and result["error"]
