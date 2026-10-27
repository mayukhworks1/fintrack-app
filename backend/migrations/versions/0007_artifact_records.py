"""Artifacts: shared data records.

Revision ID: 0007_artifact_records
Revises: 0006_pages_perf
Create Date: 2026-10-27

  * artifact_records: the rows an artifact keeps through window.fintrack.db,
    one per record, scoped to its page (deleted with it) and grouped by a
    collection name. `data` is the record itself, a JSON object.
  * seq: a change cursor. Every insert, update and delete takes the next
    value of artifact_records_seq, so "what changed on this page since N" is
    an index range scan on (page_id, seq). Writes to one page are serialised
    by an advisory lock (services/artifact_data.py), so a page's seq values
    become visible in order and a reader can never skip one.
  * Deletes are tombstones: deleted_at set, data emptied, a fresh seq. That is
    what lets a client that only asks for changes learn about a delete.
    Tombstones are purged after a retention window.
  * created_by_user / created_by_visitor: who added the record, a signed-in
    user or an anonymous visitor (stored as a hash, never the raw id).
  * scope_owner: '' for a shared record (everyone with access sees it), else
    the identity of the one person a private record belongs to ("u:<user id>"
    or "v:<visitor hash>"). Visibility is decided from this column on every
    read, so a client cannot see someone else's private records by asking for
    them as shared.
  * ukey: an optional key, unique among the live records of one collection
    and scope, for upsert() and the single-record documents (db.doc).
  * A GIN index on data (jsonb_path_ops) serves `where` equality filters.
"""
from __future__ import annotations

from alembic import op

revision = "0007_artifact_records"
down_revision = "0006_pages_perf"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SEQUENCE IF NOT EXISTS artifact_records_seq AS BIGINT")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS artifact_records (
          id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          page_id            UUID        NOT NULL REFERENCES published_pages(id) ON DELETE CASCADE,
          collection         TEXT        NOT NULL,
          data               JSONB       NOT NULL DEFAULT '{}'::jsonb,
          created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_by_user    UUID        REFERENCES auth_users(id) ON DELETE SET NULL,
          created_by_visitor TEXT,
          version            INTEGER     NOT NULL DEFAULT 1,
          seq                BIGINT      NOT NULL DEFAULT nextval('artifact_records_seq'),
          deleted_at         TIMESTAMPTZ,
          scope_owner        TEXT        NOT NULL DEFAULT '',
          ukey               TEXT
        )
        """
    )
    op.execute("ALTER SEQUENCE artifact_records_seq OWNED BY artifact_records.seq")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ar_page_coll_created_idx "
        "ON artifact_records (page_id, collection, created_at)"
    )
    op.execute("CREATE INDEX IF NOT EXISTS ar_page_seq_idx ON artifact_records (page_id, seq)")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ar_page_key_uidx "
        "ON artifact_records (page_id, collection, scope_owner, ukey) "
        "WHERE ukey IS NOT NULL AND deleted_at IS NULL"
    )
    op.execute("CREATE INDEX IF NOT EXISTS ar_data_gin_idx ON artifact_records USING GIN (data jsonb_path_ops)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ar_tombstone_idx "
        "ON artifact_records (deleted_at) WHERE deleted_at IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS artifact_records")
    op.execute("DROP SEQUENCE IF EXISTS artifact_records_seq")
