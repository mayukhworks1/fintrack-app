"""
Daily backup of the PostgreSQL database to the private Hugging Face dataset
the app already uses for file storage (settings.hf_dataset_repo).

Why here and not only in GitHub Actions: the Actions backup needs three
repository secrets and a Google Apps Script before it does anything, and until
then it skipped every night. This one needs nothing beyond what the server
already has (DATABASE_URL and HF_TOKEN), so the data is protected from day one.

What a backup is:
  backups/db/fintrack-YYYY-MM-DD.tar.gz
    manifest.json        tables, row counts, schema revision, time taken
    <table>.csv          every row of every table in the public schema
The schema itself comes from the Alembic migrations in the repo: restore is
`alembic upgrade <revision in manifest>` then COPY each CSV back in
(docs/BACKUPS.md).

Safety:
  * refuses to upload unless the dataset repo is private (a backup holds
    login accounts and page content);
  * one run per day across workers (Valkey lock), plus a startup catch-up
    when today's file is missing;
  * keeps the newest RETAIN_DAYS backups and deletes older ones;
  * never raises into the app: failures are logged and reported by status().
"""
from __future__ import annotations

import asyncio
import io
import json
import logging
import tarfile
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from ..config import settings
from ..db.postgres import get_pool

logger = logging.getLogger("fintrack.backup")

PREFIX = "backups/db/"
RETAIN_DAYS = 30
RUN_AT_IST = (2, 15)                 # 02:15 India time
IST = timezone(timedelta(hours=5, minutes=30))
STARTUP_DELAY_S = 300                # let the app settle before a catch-up run

_last: dict[str, Any] = {"ok": None, "at": None, "file": None, "bytes": 0, "tables": 0, "rows": 0, "error": None}

TABLES_SQL = (
    "SELECT table_name FROM information_schema.tables "
    "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
)


def configured() -> bool:
    return bool(get_pool() and settings.hf_token and settings.hf_dataset_repo)


def status() -> dict[str, Any]:
    return {"configured": configured(), "retain_days": RETAIN_DAYS, **_last}


def file_name(day: datetime) -> str:
    return f"{PREFIX}fintrack-{day.astimezone(IST).strftime('%Y-%m-%d')}.tar.gz"


def _quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


async def build_archive(pool) -> tuple[bytes, dict[str, Any]]:
    """Every public table as CSV inside one gzipped tar, plus a manifest."""
    started = time.monotonic()
    buf = io.BytesIO()
    manifest: dict[str, Any] = {"created_at": datetime.now(timezone.utc).isoformat(), "tables": {}}
    async with pool.acquire() as conn:
        tables = [r["table_name"] for r in await conn.fetch(TABLES_SQL)]
        try:
            manifest["alembic_revision"] = await conn.fetchval("SELECT version_num FROM alembic_version LIMIT 1")
        except Exception:
            manifest["alembic_revision"] = None
        with tarfile.open(fileobj=buf, mode="w:gz", compresslevel=6) as tar:
            for table in tables:
                out = io.BytesIO()
                await conn.copy_from_query(f"SELECT * FROM {_quote_ident(table)}", output=out,
                                           format="csv", header=True)
                data = out.getvalue()
                rows = max(0, data.count(b"\n") - 1)   # approximate: quoted newlines count too
                info = tarfile.TarInfo(name=f"{table}.csv")
                info.size = len(data)
                info.mtime = int(time.time())
                tar.addfile(info, io.BytesIO(data))
                manifest["tables"][table] = {"bytes": len(data), "lines": rows}
            manifest["seconds"] = round(time.monotonic() - started, 2)
            mbytes = json.dumps(manifest, indent=1).encode()
            info = tarfile.TarInfo(name="manifest.json")
            info.size = len(mbytes)
            info.mtime = int(time.time())
            tar.addfile(info, io.BytesIO(mbytes))
    return buf.getvalue(), manifest


def _repo_is_private() -> bool:
    from .storage import _hf_api, _repo_id, _ensure_repo_sync
    _ensure_repo_sync()
    info = _hf_api().repo_info(repo_id=_repo_id(), repo_type="dataset")
    return bool(getattr(info, "private", False))


def _existing_backups() -> list[str]:
    from .storage import _hf_api, _repo_id
    files = _hf_api().list_repo_files(repo_id=_repo_id(), repo_type="dataset")
    return sorted(f for f in files if f.startswith(PREFIX) and f.endswith(".tar.gz"))


def _prune(keep_after: str) -> list[str]:
    """Delete backups whose name sorts before keep_after (older dates)."""
    from huggingface_hub import CommitOperationDelete
    from .storage import _hf_api, _repo_id
    old = [f for f in _existing_backups() if f < keep_after]
    if old:
        _hf_api().create_commit(repo_id=_repo_id(), repo_type="dataset",
                                operations=[CommitOperationDelete(path_in_repo=f) for f in old],
                                commit_message=f"Remove {len(old)} backup(s) older than {RETAIN_DAYS} days")
    return old


async def run_backup(*, force: bool = False) -> dict[str, Any]:
    """Make today's backup (unless it exists and not force). Never raises."""
    if not configured():
        _last.update(ok=False, error="Backup needs the database and HF_TOKEN / HF_DATASET_REPO")
        return status()
    pool = get_pool()
    now = datetime.now(timezone.utc)
    name = file_name(now)
    loop = asyncio.get_running_loop()
    try:
        if not await loop.run_in_executor(None, _repo_is_private):
            raise RuntimeError(f"Refusing to back up: dataset {settings.hf_dataset_repo} is not private")
        if not force and name in await loop.run_in_executor(None, _existing_backups):
            _last.update(ok=True, at=now.isoformat(), file=name, error=None)
            return status()
        data, manifest = await build_archive(pool)
        if len(data) < 200:
            raise RuntimeError(f"Backup came out at {len(data)} bytes, which is too small to be real")
        from .storage import upload_bytes
        await upload_bytes(data, name, "application/gzip")
        cutoff = file_name(now - timedelta(days=RETAIN_DAYS))
        pruned = await loop.run_in_executor(None, _prune, cutoff)
        _last.update(ok=True, at=now.isoformat(), file=name, bytes=len(data), error=None,
                     tables=len(manifest["tables"]),
                     rows=sum(t["lines"] for t in manifest["tables"].values()), pruned=len(pruned))
        logger.info("backup: %s, %d bytes, %d tables, pruned %d", name, len(data), len(manifest["tables"]), len(pruned))
    except Exception as exc:   # noqa: BLE001 - reported, never raised into the app
        _last.update(ok=False, at=now.isoformat(), file=name, error=str(exc)[:300])
        logger.error("backup failed: %s", exc)
    return status()


def seconds_until_next_run(now: Optional[datetime] = None) -> float:
    now = (now or datetime.now(timezone.utc)).astimezone(IST)
    target = now.replace(hour=RUN_AT_IST[0], minute=RUN_AT_IST[1], second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


async def _claim(day_key: str) -> bool:
    """One worker per day runs the backup."""
    try:
        from ..db.valkey import set_nx
        return await set_nx(f"db-backup:{day_key}", "1", ttl=20 * 3600)
    except Exception:
        return True


async def backup_loop() -> None:
    """Catch up shortly after startup if today's backup is missing, then daily."""
    await asyncio.sleep(STARTUP_DELAY_S)
    while True:
        day_key = datetime.now(IST).strftime("%Y-%m-%d")
        if await _claim(day_key):
            await run_backup()
        await asyncio.sleep(max(60.0, seconds_until_next_run()))
