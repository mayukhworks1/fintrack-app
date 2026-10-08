"""
Freeze the bootstrap schema at its size on the day Alembic was adopted.

app/db/postgres.py: SCHEMA is one idempotent SQL string run on every boot. It
grew for a year — 38 tables, 85 indexes, 105 ADD COLUMN IF NOT EXISTS — and it
can only ever add: no rename, no drop, no retype, no NOT NULL with a backfill,
and no record of what ran when. Those are the operations a schema eventually
needs, and they are what revisions in migrations/versions/ provide.

This pins the counts. Adding a line to SCHEMA fails here with the pointer to
migrations/README.md. The numbers may only go DOWN, if a statement is ever
deliberately moved into a migration.
"""

from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
SCHEMA_FILE = BACKEND / "app" / "db" / "postgres.py"

FROZEN = {
    "ADD COLUMN IF NOT EXISTS": 105,
    "CREATE TABLE IF NOT EXISTS": 38,
    "CREATE INDEX IF NOT EXISTS": 85,
}

HINT = (
    "New DDL belongs in an Alembic revision, not in SCHEMA: "
    "cd backend && alembic revision -m '<what changed>' — see migrations/README.md"
)


def _counts() -> dict[str, int]:
    src = SCHEMA_FILE.read_text(encoding="utf-8")
    return {stmt: src.count(stmt) for stmt in FROZEN}


class TestBootstrapSchemaIsFrozen:
    def test_no_new_statements_were_added_to_the_bootstrap(self):
        for stmt, frozen_at in FROZEN.items():
            actual = _counts()[stmt]
            assert actual <= frozen_at, f"{stmt}: {actual} > {frozen_at}. {HINT}"

    def test_the_baseline_revision_exists(self):
        assert (BACKEND / "migrations" / "versions" / "0001_baseline.py").exists()

    def test_counts_match_exactly_until_deliberately_reduced(self):
        # Exact, not just <=: a silent drop would also be worth noticing.
        assert _counts() == FROZEN, f"SCHEMA statement counts changed: {_counts()}"
