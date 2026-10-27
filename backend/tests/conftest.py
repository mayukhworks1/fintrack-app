"""Shared fixtures. `pg` gives a test its own Postgres database (see
tests/pg_harness.py); tests that ask for it are skipped without one."""

from __future__ import annotations

# Imported when conftest loads, before smoke_test.py swaps a stub into
# sys.modules for the rest of the run.
import asyncpg

import asyncio
import json
import uuid
from types import SimpleNamespace

import pytest

from tests import pg_harness


class PgEnv:
    def __init__(self, name: str, monkeypatch):
        self.name = name
        self.kw = pg_harness.connect_kwargs(name)
        self._pool = None
        getter = lambda: self._pool  # noqa: E731
        import app.db.postgres as PG
        import app.routers.comments as RC
        import app.routers.databases as RD
        import app.routers.page_tree as RT
        import app.routers.pages as RP
        import app.routers.artifact_data as RA
        for mod in (PG, RC, RD, RT, RP, RA):
            monkeypatch.setattr(mod, "get_pool", getter)

    def run(self, fn, pool_size: int = 8):
        """Run `await fn(pool)` on a fresh event loop with a pool of this
        database installed as the app's pool."""
        from app.services import artifact_data as AD
        from app.services import page_tree as T

        async def main():
            T.reset_ready_cache()
            AD.reset_ready_cache()
            self._pool = await asyncpg.create_pool(**self.kw, min_size=1, max_size=pool_size)
            try:
                return await fn(self._pool)
            finally:
                await self._pool.close()
                self._pool = None
                T.reset_ready_cache()

        return asyncio.run(main())

    def sql(self, query: str, *args):
        """One query on its own connection (setup and checks)."""
    
        async def main():
            conn = await asyncpg.connect(**self.kw)
            try:
                return await conn.fetch(query, *args)
            finally:
                await conn.close()

        return asyncio.run(main())

    def execute(self, script: str):
        """Several statements, no parameters (a schema script)."""
    
        async def main():
            conn = await asyncpg.connect(**self.kw)
            try:
                await conn.execute(script)
            finally:
                await conn.close()

        asyncio.run(main())

    # -- data ------------------------------------------------------------------
    def user(self, name: str = "User") -> str:
        uid = str(uuid.uuid4())
        self.sql("INSERT INTO auth_users (id, email, email_normalized, full_name, status) "
                 "VALUES ($1, $2, $2, $3, 'active')", uid, f"{uid[:8]}@example.in", name)
        return uid

    def page(self, owner: str | None, title: str = "Page", *, parent: str | None = None,
             content: str = "", content_type: str = "markdown", metadata: dict | None = None,
             position: float | None = None, published: bool = False, slug: str | None = None) -> str:
        pid = str(uuid.uuid4())
        self.sql(
            "INSERT INTO published_pages (id, slug, title, content_type, content, metadata, created_by, "
            "updated_by, parent_id, position, is_published) "
            "VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $7, $8, COALESCE($9, EXTRACT(EPOCH FROM clock_timestamp())), $10)",
            pid, slug or f"{title.lower().replace(' ', '-')}-{pid[:8]}", title, content_type, content,
            json.dumps(metadata or {}), owner, parent, position, published,
        )
        return pid


def req(user: str | None, role: str = "editor", headers: dict | None = None):
    return SimpleNamespace(
        state=SimpleNamespace(auth_user_id=user, auth_role=role, auth_user_name="Tester", token_hint="t"),
        headers=headers or {},
    )


@pytest.fixture
def pg(monkeypatch):
    if pg_harness.server() is None:
        pytest.skip(pg_harness.skip_reason())
    name = asyncio.run(pg_harness.create_database())
    env = PgEnv(name, monkeypatch)
    from app.services import collab
    collab.configure(None)
    try:
        yield env
    finally:
        collab.configure(None, **{k: getattr(collab.Limits(), k) for k in vars(collab.Limits())})
        asyncio.run(pg_harness.drop_database(name))


@pytest.fixture
def pg_upto(monkeypatch):
    """A database whose migrations stop at the given revision."""
    if pg_harness.server() is None:
        pytest.skip(pg_harness.skip_reason())
    made = []

    def make(revision: str) -> PgEnv:
        name = asyncio.run(pg_harness.create_database(upto=revision))
        made.append(name)
        return PgEnv(name, monkeypatch)

    yield make
    for name in made:
        asyncio.run(pg_harness.drop_database(name))
