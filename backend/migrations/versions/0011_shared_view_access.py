"""Shared views: optional password, and requests for the password.

Revision ID: 0011_shared_view_access
Revises: 0010_list_queries
Create Date: 2026-11-16

shared_views gains:

  * password_hash — the published pages scheme (SHA-256 hex of the password).
    NULL means the link is open to anyone who has it.
  * password_enc — the same password encrypted with the MultiFernet helper in
    services/ai_gateway.py, so an approved request can be emailed the password.
    It is never sent to a browser except to the owner behind "show".
  * password_version — bumped on every change or removal. Unlock tokens are
    signed over it, so changing the password ends every open unlock.
  * auto_approve_domains — email domains whose requests are answered at once
    (empty: every request waits for the owner).
  * owner_user_id — the signed-in user who made the link (created_by only
    ever held a role name), who is told about requests.

shared_view_access_requests holds one row per "request the password" form a
visitor sent: who asked, from where, and what the owner decided.
"""
from __future__ import annotations

from alembic import op

revision = "0011_shared_view_access"
down_revision = "0010_list_queries"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE shared_views "
        "ADD COLUMN IF NOT EXISTS password_hash TEXT, "
        "ADD COLUMN IF NOT EXISTS password_enc TEXT, "
        "ADD COLUMN IF NOT EXISTS password_version INTEGER NOT NULL DEFAULT 0, "
        "ADD COLUMN IF NOT EXISTS password_updated_at TIMESTAMPTZ, "
        "ADD COLUMN IF NOT EXISTS auto_approve_domains JSONB NOT NULL DEFAULT '[]'::jsonb, "
        "ADD COLUMN IF NOT EXISTS owner_user_id UUID"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS shared_view_access_requests (
          id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
          view_token    VARCHAR(32)  NOT NULL REFERENCES shared_views(token) ON DELETE CASCADE,
          name          VARCHAR(100) NOT NULL,
          email         VARCHAR(254) NOT NULL,
          message       TEXT,
          ip            VARCHAR(45),
          user_agent    TEXT,
          link_origin   VARCHAR(200),
          status        VARCHAR(10)  NOT NULL DEFAULT 'pending',
          decided_by    UUID,
          decided_via   VARCHAR(12),
          decision_note TEXT,
          sent_at       TIMESTAMPTZ,
          decided_at    TIMESTAMPTZ,
          created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
          updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
          CONSTRAINT svar_status_chk CHECK (status IN ('pending', 'approved', 'denied'))
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS svar_view_created_idx "
        "ON shared_view_access_requests (view_token, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS svar_pending_idx "
        "ON shared_view_access_requests (created_at DESC) WHERE status = 'pending'"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS shared_view_access_requests")
    op.execute(
        "ALTER TABLE shared_views "
        "DROP COLUMN IF EXISTS owner_user_id, "
        "DROP COLUMN IF EXISTS auto_approve_domains, "
        "DROP COLUMN IF EXISTS password_updated_at, "
        "DROP COLUMN IF EXISTS password_version, "
        "DROP COLUMN IF EXISTS password_enc, "
        "DROP COLUMN IF EXISTS password_hash"
    )
