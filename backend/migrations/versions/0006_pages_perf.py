"""Pages: indexes and bookkeeping for the hot paths.

Revision ID: 0006_pages_perf
Revises: 0005_comments
Create Date: 2026-10-26

  * pp_owner_live_updated_idx / pp_live_updated_idx: "recently edited" for an
    owner and for a superadmin, newest first, live pages only.
  * pv_viewer_viewed_idx: "recently opened by me" without visiting every view
    of every page.
  * pver_page_num_idx: the next version number of a page (MAX(version_num)).
  * asset_paths on published_pages and page_versions, kept by a trigger from
    the content, with GIN indexes: "which pages refer to this uploaded file"
    becomes an index lookup instead of a substring scan of every page and
    every saved version. Backfilled here.
  * page_create_requests: client request ids of recent page creations, so a
    retried POST /api/pages/ returns the page it already made.
  * Drafts: published_content / published_content_type / published_title /
    published_at_rev hold what the public sees, copied from the working copy
    (content, content_type, title) when the page is published. Autosave and
    live editing change only the working copy. draft_changed (kept by a
    trigger) says whether the working copy differs from the published one.
    Backfilled: a page published today publishes exactly its current content.
  * The slug had two indexes: the UNIQUE constraint's and the bootstrap's
    plain idx_published_pages_slug. The constraint now lives on a unique
    index under the bootstrap's name, so the bootstrap's
    CREATE INDEX IF NOT EXISTS finds it and adds nothing back on boot.

Plain CREATE INDEX (not CONCURRENTLY): Alembic runs each revision inside a
transaction. The tables involved are small enough that the brief lock is
acceptable.
"""
from __future__ import annotations

from alembic import op

revision = "0006_pages_perf"
down_revision = "0005_comments"
branch_labels = None
depends_on = None

# Mirrors routers/pages.py _ASSET_REF_RE: the path after the public asset
# prefix, up to the first character that cannot be part of a stored path.
ASSET_FN = r"""
CREATE OR REPLACE FUNCTION page_asset_paths(c text) RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT CASE WHEN c IS NULL OR strpos(c, '/api/public/pages/asset/') = 0 THEN '{}'::text[]
  ELSE COALESCE((
    SELECT array_agg(DISTINCT m[1])
      FROM regexp_matches(c, '/api/public/pages/asset/(pages/[^\s)"''<>?#&\\]+)', 'g') AS m
  ), '{}'::text[]) END
$fn$
"""

TRIGGER_FN = """
CREATE OR REPLACE FUNCTION page_asset_paths_sync() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.asset_paths := page_asset_paths(NEW.content);
  RETURN NEW;
END
$fn$
"""

# A page's references include its published copy, which may still show a
# file the working copy no longer has.
PAGE_TRIGGER_FN = """
CREATE OR REPLACE FUNCTION page_published_sync() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.asset_paths := ARRAY(SELECT DISTINCT unnest(
      page_asset_paths(NEW.content) || page_asset_paths(NEW.published_content)));
  NEW.draft_changed := NEW.published_content IS NOT NULL AND (
      NEW.content IS DISTINCT FROM NEW.published_content
      OR NEW.title IS DISTINCT FROM NEW.published_title
      OR NEW.content_type IS DISTINCT FROM NEW.published_content_type);
  RETURN NEW;
END
$fn$
"""


def upgrade() -> None:
    op.execute(
        "CREATE INDEX IF NOT EXISTS pp_owner_live_updated_idx "
        "ON published_pages (created_by, updated_at DESC) WHERE deleted_at IS NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS pp_live_updated_idx "
        "ON published_pages (updated_at DESC) WHERE deleted_at IS NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS pv_viewer_viewed_idx "
        "ON page_views (viewer_user_id, viewed_at DESC) INCLUDE (page_id) "
        "WHERE viewer_user_id IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS pver_page_num_idx ON page_versions (page_id, version_num DESC)"
    )

    # Drafts: the published copy.
    op.execute("ALTER TABLE published_pages ADD COLUMN IF NOT EXISTS published_content TEXT")
    op.execute("ALTER TABLE published_pages ADD COLUMN IF NOT EXISTS published_content_type VARCHAR(20)")
    op.execute("ALTER TABLE published_pages ADD COLUMN IF NOT EXISTS published_title VARCHAR(500)")
    op.execute("ALTER TABLE published_pages ADD COLUMN IF NOT EXISTS published_at_rev TIMESTAMPTZ")
    op.execute("ALTER TABLE published_pages ADD COLUMN IF NOT EXISTS draft_changed BOOLEAN NOT NULL DEFAULT FALSE")
    op.execute(
        "UPDATE published_pages SET published_content = content, published_content_type = content_type, "
        "published_title = title, published_at_rev = updated_at "
        "WHERE is_published AND published_content IS NULL"
    )

    # Asset references.
    op.execute(ASSET_FN)
    op.execute(TRIGGER_FN)
    op.execute(PAGE_TRIGGER_FN)
    for table, short in (("published_pages", "pp"), ("page_versions", "pver")):
        op.execute(
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS asset_paths TEXT[] NOT NULL DEFAULT '{{}}'::text[]"
        )
        op.execute(
            f"UPDATE {table} SET asset_paths = page_asset_paths(content) "
            "WHERE strpos(content, '/api/public/pages/asset/') > 0"
        )
        op.execute(
            f"CREATE INDEX IF NOT EXISTS {short}_asset_paths_idx ON {table} USING GIN (asset_paths) "
            "WHERE asset_paths <> '{}'::text[]"
        )
        op.execute(f"DROP TRIGGER IF EXISTS {short}_asset_paths_trg ON {table}")
    op.execute(
        "CREATE TRIGGER pver_asset_paths_trg BEFORE INSERT OR UPDATE OF content ON page_versions "
        "FOR EACH ROW EXECUTE FUNCTION page_asset_paths_sync()"
    )
    op.execute(
        "CREATE TRIGGER pp_asset_paths_trg BEFORE INSERT OR UPDATE OF content, title, content_type, "
        "published_content, published_title, published_content_type ON published_pages "
        "FOR EACH ROW EXECUTE FUNCTION page_published_sync()"
    )

    # Idempotent page creation.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS page_create_requests (
          user_key    TEXT        NOT NULL,
          request_id  TEXT        NOT NULL,
          page_id     UUID        REFERENCES published_pages(id) ON DELETE CASCADE,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_key, request_id)
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS pcr_created_idx ON page_create_requests (created_at)")

    # One unique index on slug, under the name the bootstrap looks for.
    op.execute(
        """
        DO $do$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'published_pages_slug_key'
                       AND conrelid = 'published_pages'::regclass) THEN
            DROP INDEX IF EXISTS idx_published_pages_slug;
            CREATE UNIQUE INDEX idx_published_pages_slug ON published_pages (slug);
            ALTER TABLE published_pages
              DROP CONSTRAINT published_pages_slug_key,
              ADD CONSTRAINT idx_published_pages_slug UNIQUE USING INDEX idx_published_pages_slug;
          END IF;
        END
        $do$
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $do$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'idx_published_pages_slug'
                       AND conrelid = 'published_pages'::regclass) THEN
            ALTER TABLE published_pages
              DROP CONSTRAINT idx_published_pages_slug,
              ADD CONSTRAINT published_pages_slug_key UNIQUE (slug);
            CREATE INDEX IF NOT EXISTS idx_published_pages_slug ON published_pages (slug);
          END IF;
        END
        $do$
        """
    )
    op.execute("DROP TABLE IF EXISTS page_create_requests")
    for table, short in (("published_pages", "pp"), ("page_versions", "pver")):
        op.execute(f"DROP TRIGGER IF EXISTS {short}_asset_paths_trg ON {table}")
        op.execute(f"DROP INDEX IF EXISTS {short}_asset_paths_idx")
        op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS asset_paths")
    op.execute("DROP FUNCTION IF EXISTS page_published_sync()")
    op.execute("DROP FUNCTION IF EXISTS page_asset_paths_sync()")
    for col in ("draft_changed", "published_at_rev", "published_title", "published_content_type",
                "published_content"):
        op.execute(f"ALTER TABLE published_pages DROP COLUMN IF EXISTS {col}")
    op.execute("DROP FUNCTION IF EXISTS page_asset_paths(text)")
    op.execute("DROP INDEX IF EXISTS pver_page_num_idx")
    op.execute("DROP INDEX IF EXISTS pv_viewer_viewed_idx")
    op.execute("DROP INDEX IF EXISTS pp_live_updated_idx")
    op.execute("DROP INDEX IF EXISTS pp_owner_live_updated_idx")
