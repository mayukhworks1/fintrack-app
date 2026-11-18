"""Daily database backup (services/db_backup.py)."""
import io
import json
import tarfile
from datetime import datetime, timezone

import pytest

from app.services import db_backup as B


def test_next_run_is_0215_india_time():
    now = datetime(2026, 11, 18, 20, 0, tzinfo=timezone.utc)   # 01:30 IST
    assert B.seconds_until_next_run(now) == 45 * 60
    now = datetime(2026, 11, 18, 21, 0, tzinfo=timezone.utc)   # 02:30 IST
    assert B.seconds_until_next_run(now) == 23 * 3600 + 45 * 60


def test_file_name_is_dated_in_india_time():
    assert B.file_name(datetime(2026, 11, 18, 20, 0, tzinfo=timezone.utc)) == "backups/db/fintrack-2026-11-19.tar.gz"


def test_archive_holds_every_table_and_a_manifest(pg):
    pg.user("Backup Person")

    async def main(pool):
        return await B.build_archive(pool)
    data, manifest = pg.run(main)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        names = set(tar.getnames())
        assert "manifest.json" in names
        assert "auth_users.csv" in names
        assert json.loads(tar.extractfile("manifest.json").read())["tables"] == manifest["tables"]
        users = tar.extractfile("auth_users.csv").read().decode()
    assert "Backup Person" in users
    assert "alembic_revision" in manifest   # the test schema has no alembic_version table


def test_refuses_a_public_repo(monkeypatch, pg):
    monkeypatch.setattr(B, "configured", lambda: True)
    monkeypatch.setattr(B, "_repo_is_private", lambda: False)
    uploads = []

    async def fake_upload(*a, **k):
        uploads.append(a)
    monkeypatch.setattr("app.services.storage.upload_bytes", fake_upload)

    async def main(pool):
        return await B.run_backup(force=True)
    out = pg.run(main)
    assert out["ok"] is False and "not private" in out["error"] and uploads == []


def test_uploads_and_prunes_old_files(monkeypatch, pg):
    monkeypatch.setattr(B, "configured", lambda: True)
    monkeypatch.setattr(B, "_repo_is_private", lambda: True)
    monkeypatch.setattr(B, "_existing_backups", lambda: [])
    pruned_before = []
    monkeypatch.setattr(B, "_prune", lambda cutoff: pruned_before.append(cutoff) or ["backups/db/fintrack-2020-01-01.tar.gz"])
    uploads = []

    async def fake_upload(data, name, ctype):
        uploads.append((name, len(data)))
    monkeypatch.setattr("app.services.storage.upload_bytes", fake_upload)

    async def main(pool):
        monkeypatch.setattr(B, "get_pool", lambda: pool)
        return await B.run_backup(force=True)
    out = pg.run(main)
    assert out["ok"] is True, out
    assert uploads and uploads[0][0].startswith("backups/db/fintrack-") and uploads[0][1] > 200
    assert out["pruned"] == 1 and pruned_before
