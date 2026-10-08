"""
Alembic environment — async, driven by app settings.

The URL comes from app.config.settings.postgres_url, never from alembic.ini,
so there is one source of truth and no credential in a config file. Both
`postgres://` and `postgresql://` are accepted and normalised to the asyncpg
dialect SQLAlchemy needs; `ssl=require` is passed to match the app's own pool.

This file is executed by Alembic, not imported by the app, so it may use
asyncio.run(). The app runs migrations from a worker thread
(app/db/migrate.py) precisely so that call has no running loop to collide
with.
"""
from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import settings

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# No SQLAlchemy models: the schema is hand-written SQL. Autogenerate is off.
target_metadata = None


# Defined in app.db.migrate so it is unit-testable; this module runs Alembic's
# context at import and cannot itself be imported by a test.
from app.db.migrate import asyncpg_url  # noqa: E402


def run_migrations_offline() -> None:
    """Emit SQL to stdout without a connection (`alembic upgrade head --sql`)."""
    context.configure(
        url=asyncpg_url(settings.postgres_url),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def _do_run_migrations(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    engine = create_async_engine(
        asyncpg_url(settings.postgres_url),
        poolclass=None,
        connect_args={"ssl": "require"},
    )
    try:
        async with engine.connect() as connection:
            await connection.run_sync(_do_run_migrations)
    finally:
        await engine.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
