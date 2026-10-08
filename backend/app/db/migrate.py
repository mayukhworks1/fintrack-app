"""
Run Alembic migrations at startup, without ever taking the app down.

init_pool() calls run_migrations() right after the bootstrap SCHEMA. Two
properties matter:

  * It runs in a worker thread. migrations/env.py uses Alembic's async
    template, which calls asyncio.run(); that needs no event loop running in
    the current thread, and the app's loop is already running. to_thread gives
    it a clean thread and keeps startup from blocking on the migration.

  * It never raises. The pool is already up and the bootstrap schema already
    applied, so a broken revision must not turn a working database into a
    dead service. The failure is logged, kept in `last_result` for /health,
    and the app serves on the previous schema until the revision is fixed.

alembic.ini is resolved relative to this file, not the working directory —
the Space does not start from backend/.
"""
from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger("fintrack.migrate")


def asyncpg_url(raw: str | None) -> str:
    """Normalise a Postgres URL to the postgresql+asyncpg:// form SQLAlchemy needs.

    Lives here, not in migrations/env.py, so it can be unit-tested: env.py
    executes Alembic's context at import time and cannot be imported directly.
    """
    if not raw:
        raise RuntimeError("POSTGRES_URL is not set; cannot run migrations")
    url = raw.strip()
    for prefix in ("postgresql+asyncpg://", "postgres+asyncpg://", "postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+asyncpg://" + _strip_libpq_ssl_params(url[len(prefix):])
    raise RuntimeError(f"Unrecognised Postgres URL scheme: {url.split('://', 1)[0]}://")


# Query keys libpq understands and asyncpg.connect() does not. SQLAlchemy
# passes every URL query key to the driver as a keyword argument.
_LIBPQ_SSL_KEYS = {"sslmode", "sslcert", "sslkey", "sslrootcert", "sslcrl", "ssl"}


def _strip_libpq_ssl_params(rest: str) -> str:
    """Drop `?sslmode=...` and friends; keep every other query key.

    Aiven DSNs carry `?sslmode=require`. Production logged
    `connect() got an unexpected keyword argument 'sslmode'` on every boot
    and never ran a migration. SSL itself is requested through connect_args
    in migrations/env.py, matching the app's own pool.
    """
    if "?" not in rest:
        return rest
    path, _, query = rest.partition("?")
    kept = [p for p in query.split("&") if p and p.split("=", 1)[0].lower() not in _LIBPQ_SSL_KEYS]
    return path + ("?" + "&".join(kept) if kept else "")

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_INI = _BACKEND_DIR / "alembic.ini"

last_result: dict[str, Any] = {"ran": False}


def run_migrations_blocking() -> dict[str, Any]:
    """Apply `alembic upgrade head`. Returns a result dict; never raises."""
    from ..config import settings
    started = time.time()
    result: dict[str, Any] = {"ran": True, "ok": False, "error": None,
                              "duration_ms": 0, "at": started}
    try:
        if not settings.postgres_url:
            raise RuntimeError("POSTGRES_URL is not set")
        if not _INI.exists():
            raise RuntimeError(f"alembic.ini not found at {_INI}")

        from alembic import command
        from alembic.config import Config

        cfg = Config(str(_INI))
        cfg.set_main_option("script_location", str(_BACKEND_DIR / "migrations"))
        # Alembic's fileConfig would reconfigure root logging; the app owns that.
        cfg.attributes["configure_logger"] = False
        command.upgrade(cfg, "head")
        result["ok"] = True
        logger.info("migrations: at head (%.0f ms)", (time.time() - started) * 1000)
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
        logger.error("migrations failed (serving on previous schema): %s", exc)
    result["duration_ms"] = int((time.time() - started) * 1000)
    last_result.clear()
    last_result.update(result)
    return result


async def run_migrations() -> bool:
    """Async entry point for lifespan. True on success; never raises."""
    try:
        result = await asyncio.to_thread(run_migrations_blocking)
        return bool(result.get("ok"))
    except Exception as exc:   # to_thread itself failing — still never propagate
        logger.error("migrations: could not run (%s)", exc)
        last_result.clear()
        last_result.update({"ran": True, "ok": False, "error": f"{type(exc).__name__}: {exc}"})
        return False


def state() -> dict[str, Any]:
    """For /health."""
    return dict(last_result)
