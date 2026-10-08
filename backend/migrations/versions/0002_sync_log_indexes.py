"""sync_log: index synced_at.

Revision ID: 0002_sync_log_indexes
Revises: 0001_baseline
Create Date: 2026-10-09

/health, the admin deployment-health card and the sync-freshness checks all
ask for the newest sync_log row (ORDER BY synced_at DESC LIMIT 1). The table
gains one row per source per sync — every 30 seconds — and had no index on
synced_at, so each of those reads sorted the whole table on a 1 GB instance.

The first revision that actually changes the database. It also proves the
migration runner works end to end, which the baseline, being empty, could not.
"""
from __future__ import annotations

from alembic import op

revision = "0002_sync_log_indexes"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE INDEX IF NOT EXISTS sl_synced_idx ON sync_log (synced_at DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS sl_source_synced_idx ON sync_log (source, synced_at DESC)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS sl_source_synced_idx")
    op.execute("DROP INDEX IF EXISTS sl_synced_idx")
