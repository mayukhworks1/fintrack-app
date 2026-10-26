"""Pages: comment threads, mentions and in-app notifications.

Revision ID: 0005_comments
Revises: 0004_page_tree
Create Date: 2026-10-26

page_comments holds every comment on a page. A thread is its first comment
(thread_id = id); replies carry the thread's id and, optionally, the comment
they answer (parent_id). Resolution is recorded on the thread's first comment.
body is plain text; a mention is stored inline as a token
"@[Display Name](<auth user uuid>)" and rendered by the client. anchor is null
for a page-level discussion, or {block_id, from, to, quote} for a comment
pinned to a block or a selection in the block editor.

Deleting a comment is soft (deleted_at, body emptied) so a thread keeps its
shape when one message in the middle goes away.

notifications is one row per person per event (a mention, a reply to a thread
they are in). It points at the page and the comment, both ON DELETE CASCADE,
so a deleted page takes its notifications with it.
"""
from __future__ import annotations

from alembic import op

revision = "0005_comments"
down_revision = "0004_page_tree"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS page_comments (
          id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          page_id        UUID        NOT NULL REFERENCES published_pages(id) ON DELETE CASCADE,
          thread_id      UUID        NOT NULL,
          parent_id      UUID        REFERENCES page_comments(id) ON DELETE SET NULL,
          author_user_id UUID        REFERENCES auth_users(id) ON DELETE SET NULL,
          body           TEXT        NOT NULL DEFAULT '',
          anchor         JSONB,
          resolved_at    TIMESTAMPTZ,
          resolved_by    UUID        REFERENCES auth_users(id) ON DELETE SET NULL,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          edited_at      TIMESTAMPTZ,
          deleted_at     TIMESTAMPTZ
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS pc_page_created_idx ON page_comments (page_id, created_at)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS pc_thread_created_idx ON page_comments (thread_id, created_at)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS pc_author_idx ON page_comments (author_user_id)"
    )
    # Open thread counts per page (the comments button, the tree).
    op.execute(
        "CREATE INDEX IF NOT EXISTS pc_open_threads_idx ON page_comments (page_id) "
        "WHERE id = thread_id AND resolved_at IS NULL AND deleted_at IS NULL"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS notifications (
          id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id       UUID        NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
          kind          VARCHAR(40) NOT NULL,
          page_id       UUID        REFERENCES published_pages(id) ON DELETE CASCADE,
          comment_id    UUID        REFERENCES page_comments(id) ON DELETE CASCADE,
          actor_user_id UUID        REFERENCES auth_users(id) ON DELETE SET NULL,
          payload       JSONB       NOT NULL DEFAULT '{}'::jsonb,
          read_at       TIMESTAMPTZ,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ntf_user_created_idx ON notifications (user_id, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ntf_user_unread_idx ON notifications (user_id) WHERE read_at IS NULL"
    )
    op.execute("CREATE INDEX IF NOT EXISTS ntf_comment_idx ON notifications (comment_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS notifications")
    op.execute("DROP TABLE IF EXISTS page_comments")
