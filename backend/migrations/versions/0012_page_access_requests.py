"""Published pages: "request the password", like shared view links.

Revision ID: 0012_page_access_requests
Revises: 0011_shared_view_access
Create Date: 2026-11-16

published_pages gains:

  * password_enc — the page password encrypted with the MultiFernet helper in
    services/ai_gateway.py (the shared views scheme), written whenever a page
    password is set or changed, so an approved request can be emailed it.
    Pages whose password predates this column have only the hash: approving a
    request for one asks the owner to set the password again, or to share it
    by hand.
  * auto_approve_domains — email domains whose requests are answered at once
    (empty: every request waits for the owner).

shared_view_access_requests now holds requests for either a shared view
(view_token) or a published page (page_id), exactly one of the two.
"""
from __future__ import annotations

from alembic import op

revision = "0012_page_access_requests"
down_revision = "0011_shared_view_access"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE published_pages "
        "ADD COLUMN IF NOT EXISTS password_enc TEXT, "
        "ADD COLUMN IF NOT EXISTS auto_approve_domains JSONB NOT NULL DEFAULT '[]'::jsonb"
    )
    op.execute(
        "ALTER TABLE shared_view_access_requests "
        "ADD COLUMN IF NOT EXISTS page_id UUID REFERENCES published_pages(id) ON DELETE CASCADE, "
        "ALTER COLUMN view_token DROP NOT NULL"
    )
    op.execute("ALTER TABLE shared_view_access_requests DROP CONSTRAINT IF EXISTS svar_target_chk")
    op.execute(
        "ALTER TABLE shared_view_access_requests ADD CONSTRAINT svar_target_chk "
        "CHECK ((view_token IS NULL) <> (page_id IS NULL))"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS svar_page_created_idx "
        "ON shared_view_access_requests (page_id, created_at DESC) WHERE page_id IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DELETE FROM shared_view_access_requests WHERE page_id IS NOT NULL")
    op.execute("DROP INDEX IF EXISTS svar_page_created_idx")
    op.execute("ALTER TABLE shared_view_access_requests DROP CONSTRAINT IF EXISTS svar_target_chk")
    op.execute(
        "ALTER TABLE shared_view_access_requests "
        "DROP COLUMN IF EXISTS page_id, "
        "ALTER COLUMN view_token SET NOT NULL"
    )
    op.execute(
        "ALTER TABLE published_pages "
        "DROP COLUMN IF EXISTS auto_approve_domains, "
        "DROP COLUMN IF EXISTS password_enc"
    )
