"""
A real Postgres for the tests whose subject is the SQL itself.

Set-based writes (unnest / jsonb_to_recordset / CTEs), row locks, jsonb
merges and the migration are only worth testing against Postgres. The
harness uses, in order:

  * FINTRACK_TEST_PG: "host=... port=... user=..." of a server to use (a
    scratch database is created and dropped per test);
  * otherwise a throwaway cluster started from the local PostgreSQL binaries
    (/usr/lib/postgresql/*/bin, or initdb on PATH) in a temporary directory,
    on a Unix socket only, stopped at exit. As root it runs as the
    "postgres" account. GitHub's Ubuntu runners have the binaries.

When neither is possible the tests that need it are skipped.

Each test gets a fresh database cloned from a template that holds the
bootstrap SCHEMA plus every migration (or the migrations up to a given
revision, for the "migration not run yet" paths).
"""

from __future__ import annotations

# Imported when conftest loads, before smoke_test.py swaps a stub into
# sys.modules for the rest of the run.
import asyncpg

import asyncio
import atexit
import glob
import importlib.util
import os
import pwd
import shutil
import socket
import subprocess
import tempfile
import uuid
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
VERSIONS = sorted((BACKEND / "migrations" / "versions").glob("0*.py"))

_server: dict | None = None
_server_error: str | None = None
_templates: dict[str, str] = {}


def _bin_dir() -> str | None:
    for d in sorted(glob.glob("/usr/lib/postgresql/*/bin"), reverse=True):
        if os.path.exists(os.path.join(d, "initdb")) and os.path.exists(os.path.join(d, "pg_ctl")):
            return d
    initdb = shutil.which("initdb")
    return os.path.dirname(initdb) if initdb else None


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _parse_env(value: str) -> dict:
    out = {}
    for part in value.split():
        k, _, v = part.partition("=")
        out[k] = int(v) if k == "port" else v
    return out


def server() -> dict | None:
    """asyncpg connect() keyword arguments (without database), or None."""
    global _server, _server_error
    if _server is not None or _server_error is not None:
        return _server
    env = os.environ.get("FINTRACK_TEST_PG")
    if env:
        _server = _parse_env(env)
        return _server
    bindir = _bin_dir()
    if not bindir:
        _server_error = "no PostgreSQL binaries"
        return None
    run_as = None
    if os.geteuid() == 0:
        try:
            pwd.getpwnam("postgres")
            run_as = "postgres"
        except KeyError:
            _server_error = "running as root without a postgres account"
            return None
    base = tempfile.mkdtemp(prefix="fintrack-pg-")
    if run_as:
        shutil.chown(base, run_as, run_as)
    data, port = os.path.join(base, "data"), _free_port()
    try:
        subprocess.run([os.path.join(bindir, "initdb"), "-D", data, "-A", "trust", "-U", "postgres",
                        "--no-sync"], user=run_as, check=True, capture_output=True, cwd=base)
        subprocess.run([os.path.join(bindir, "pg_ctl"), "-D", data, "-l", os.path.join(base, "log"), "-w",
                        "-o", f"-p {port} -k {base} -c listen_addresses='' -c fsync=off "
                              "-c synchronous_commit=off -c full_page_writes=off -c max_connections=60",
                        "start"], user=run_as, check=True, capture_output=True, cwd=base)
    except (subprocess.CalledProcessError, OSError) as exc:
        _server_error = f"could not start PostgreSQL: {exc}"
        shutil.rmtree(base, ignore_errors=True)
        return None

    def _stop():
        subprocess.run([os.path.join(bindir, "pg_ctl"), "-D", data, "-m", "immediate", "stop"],
                       user=run_as, capture_output=True, cwd=base)
        shutil.rmtree(base, ignore_errors=True)

    atexit.register(_stop)
    _server = {"host": base, "port": port, "user": "postgres"}
    return _server


def skip_reason() -> str:
    return _server_error or "no PostgreSQL available"


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

def migration_statements(path: Path, direction: str = "upgrade") -> list[str]:
    """The SQL a revision's upgrade()/downgrade() runs, collected without
    Alembic (every revision here is op.execute only)."""
    import alembic.op as op_module

    stmts: list[str] = []
    saved = getattr(op_module, "execute", None)
    op_module.execute = lambda sql, *a, **k: stmts.append(str(sql))
    try:
        spec = importlib.util.spec_from_file_location(f"_mig_{path.stem}", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        getattr(mod, direction)()
    finally:
        op_module.execute = saved
    return stmts


async def _apply_schema(conn, upto: str | None) -> None:
    from app.db.postgres import SCHEMA

    await conn.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    i = SCHEMA.index("CREATE TABLE IF NOT EXISTS auth_users")
    j = SCHEMA.index(");", i) + 2
    await conn.execute(SCHEMA[i:j])
    await conn.execute(SCHEMA)
    for path in VERSIONS:
        for sql in migration_statements(path):
            await conn.execute(sql)
        if upto and path.stem == upto:
            break


async def _admin(kw):
    return await asyncpg.connect(**kw, database="postgres")


async def _template(kw, upto: str | None) -> str:
    key = upto or "head"
    if key in _templates:
        return _templates[key]
    name = f"ft_tpl_{key.replace('-', '_')}_{uuid.uuid4().hex[:6]}"
    admin = await _admin(kw)
    try:
        await admin.execute(f'CREATE DATABASE "{name}"')
    finally:
        await admin.close()
    conn = await asyncpg.connect(**kw, database=name)
    try:
        await _apply_schema(conn, upto)
    finally:
        await conn.close()
    _templates[key] = name
    return name


async def create_database(upto: str | None = None) -> str:
    kw = server()
    tpl = await _template(kw, upto)
    name = f"ft_t_{uuid.uuid4().hex[:10]}"
    admin = await _admin(kw)
    try:
        await admin.execute(f'CREATE DATABASE "{name}" TEMPLATE "{tpl}"')
    finally:
        await admin.close()
    return name


async def drop_database(name: str) -> None:
    admin = await _admin(server())
    try:
        await admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
    finally:
        await admin.close()


def connect_kwargs(name: str) -> dict:
    return {**server(), "database": name}


def run(coro):
    return asyncio.run(coro)
