"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}

Write DDL as plain SQL via op.execute() — the schema is hand-written, there
are no SQLAlchemy models to autogenerate from. Every upgrade must have a
working downgrade; a migration you cannot reverse is a migration you cannot
test.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
