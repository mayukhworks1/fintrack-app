"""Security state: the sign-in key generation, for "sign out everyone".

Revision ID: 0013_security_state
Revises: 0012_page_access_requests
Create Date: 2026-11-18

security_state holds small named values the security controls need to keep
across restarts. The first is token_epoch: login tokens are signed with
APP_SECRET plus this number, so raising it invalidates every token at once,
including tokens from the shared role passwords that have no session row.
"""
from __future__ import annotations

from alembic import op

revision = "0013_security_state"
down_revision = "0012_page_access_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE TABLE IF NOT EXISTS security_state ("
        " key TEXT PRIMARY KEY,"
        " value TEXT NOT NULL,"
        " updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),"
        " updated_by TEXT)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS security_state")
