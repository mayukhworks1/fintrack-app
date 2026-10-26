"""Pages: nesting, ordering, icons, covers, trash and favourites.

Revision ID: 0004_page_tree
Revises: 0003_ai_gateway
Create Date: 2026-10-26

Pages become a tree. A page may sit under a parent page (parent_id), siblings
keep an explicit order (position), and each page can carry an emoji icon and a
cover. Deleting from the tree moves a page to the trash (deleted_at) instead of
removing it, so it can be restored; trashed pages are hidden from lists and
from the public viewer.

position defaults to the insert time in epoch seconds, so a page created by
code that knows nothing about ordering lands at the end of its siblings, and
existing pages keep their creation order. Moves place a page between two
neighbours by taking the midpoint, which a double has room for.

parent_id is ON DELETE SET NULL: permanently deleting a page that still has
children (outside the trash flow) lifts them to the top level rather than
deleting them with it.
"""
from __future__ import annotations

from alembic import op

revision = "0004_page_tree"
down_revision = "0003_ai_gateway"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE published_pages ADD COLUMN IF NOT EXISTS parent_id UUID "
        "REFERENCES published_pages(id) ON DELETE SET NULL"
    )
    op.execute("ALTER TABLE published_pages ADD COLUMN IF NOT EXISTS position DOUBLE PRECISION")
    op.execute("ALTER TABLE published_pages ADD COLUMN IF NOT EXISTS icon VARCHAR(16)")
    op.execute("ALTER TABLE published_pages ADD COLUMN IF NOT EXISTS cover TEXT")
    op.execute("ALTER TABLE published_pages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ")
    op.execute(
        "UPDATE published_pages SET position = EXTRACT(EPOCH FROM created_at) WHERE position IS NULL"
    )
    op.execute(
        "ALTER TABLE published_pages ALTER COLUMN position "
        "SET DEFAULT EXTRACT(EPOCH FROM clock_timestamp())"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS pp_parent_position_idx ON published_pages (parent_id, position)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS pp_trash_idx ON published_pages (deleted_at) "
        "WHERE deleted_at IS NOT NULL"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS page_favourites (
          user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
          page_id UUID NOT NULL REFERENCES published_pages(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, page_id)
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS pf_page_idx ON page_favourites (page_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS page_favourites")
    op.execute("DROP INDEX IF EXISTS pp_trash_idx")
    op.execute("DROP INDEX IF EXISTS pp_parent_position_idx")
    op.execute("ALTER TABLE published_pages DROP COLUMN IF EXISTS deleted_at")
    op.execute("ALTER TABLE published_pages DROP COLUMN IF EXISTS cover")
    op.execute("ALTER TABLE published_pages DROP COLUMN IF EXISTS icon")
    op.execute("ALTER TABLE published_pages DROP COLUMN IF EXISTS position")
    op.execute("ALTER TABLE published_pages DROP COLUMN IF EXISTS parent_id")
