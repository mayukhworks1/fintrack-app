"""Baseline: adopt the existing schema without changing it.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-10-08

The schema was built up over a year as one idempotent SQL string — 38 CREATE
TABLE IF NOT EXISTS, 85 CREATE INDEX IF NOT EXISTS and 105 ALTER TABLE ADD
COLUMN IF NOT EXISTS, executed on every boot (app/db/postgres.py: SCHEMA).
That bootstrap stays: it is what makes a fresh database usable, and every
deployed database already matches it.

This revision therefore creates nothing. Its only effect is that `alembic
upgrade head` on an existing database writes `alembic_version = 0001_baseline`,
which is the point from which real migrations are tracked. From here on, a
schema change is a new revision in this directory — never another line in
SCHEMA, which tests/test_schema_freeze.py now holds at its current size.

Why the bootstrap could not simply become migrations: ADD COLUMN IF NOT
EXISTS can only ever add. It cannot rename, drop, retype, or add a NOT NULL
with a backfill, and it records nothing about what ran when. Those are the
operations a growing schema eventually needs, and they are what revisions
give us.
"""
from __future__ import annotations

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Intentionally empty — see module docstring.
    pass


def downgrade() -> None:
    # Nothing to undo: this revision created nothing.
    pass
