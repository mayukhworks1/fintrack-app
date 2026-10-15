"""AI gateway: provider, task, prompt and settings tables; call-log columns.

Revision ID: 0003_ai_gateway
Revises: 0002_sync_log_indexes
Create Date: 2026-10-15

AI providers, model routes, caps and prompts move from env vars and hardcoded
model ids into the database, where the superadmin edits them from the admin
panel. Only overrides are stored: a missing row means "use the built-in
default", so an empty table behaves exactly like a fresh install.

ai_traces becomes the gateway's call log. It gains the task, the provider, an
explicit status (ok / failed / not_sent) and the provider's HTTP status, so a
cap can count one task's calls and the log can say why a call never left.
"""
from __future__ import annotations

from alembic import op

revision = "0003_ai_gateway"
down_revision = "0002_sync_log_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_gateway_providers (
          key VARCHAR(20) PRIMARY KEY,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          base_url TEXT,
          api_key_enc TEXT,
          key_hint VARCHAR(12),
          key_set_by VARCHAR(320),
          key_set_at TIMESTAMPTZ,
          timeout_s INTEGER,
          daily_request_cap INTEGER,
          daily_token_cap BIGINT,
          models JSONB,
          last_test_at TIMESTAMPTZ,
          last_test_ok BOOLEAN,
          last_test_ms INTEGER,
          last_test_error TEXT,
          updated_by VARCHAR(320),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_gateway_tasks (
          key VARCHAR(40) PRIMARY KEY,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          route JSONB,
          daily_cap INTEGER,
          prompt_version INTEGER NOT NULL DEFAULT 0,
          updated_by VARCHAR(320),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_gateway_prompts (
          task VARCHAR(40) NOT NULL,
          version INTEGER NOT NULL,
          prompt TEXT,
          created_by VARCHAR(320),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (task, version)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_gateway_settings (
          key VARCHAR(40) PRIMARY KEY,
          value JSONB NOT NULL,
          updated_by VARCHAR(320),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute("ALTER TABLE ai_traces ADD COLUMN IF NOT EXISTS task VARCHAR(40)")
    op.execute("ALTER TABLE ai_traces ADD COLUMN IF NOT EXISTS provider VARCHAR(20)")
    op.execute("ALTER TABLE ai_traces ADD COLUMN IF NOT EXISTS status VARCHAR(12)")
    op.execute("ALTER TABLE ai_traces ADD COLUMN IF NOT EXISTS http_status SMALLINT")
    op.execute("CREATE INDEX IF NOT EXISTS at_task_ts_idx ON ai_traces (task, ts DESC)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS at_task_ts_idx")
    op.execute("ALTER TABLE ai_traces DROP COLUMN IF EXISTS http_status")
    op.execute("ALTER TABLE ai_traces DROP COLUMN IF EXISTS status")
    op.execute("ALTER TABLE ai_traces DROP COLUMN IF EXISTS provider")
    op.execute("ALTER TABLE ai_traces DROP COLUMN IF EXISTS task")
    op.execute("DROP TABLE IF EXISTS ai_gateway_settings")
    op.execute("DROP TABLE IF EXISTS ai_gateway_prompts")
    op.execute("DROP TABLE IF EXISTS ai_gateway_tasks")
    op.execute("DROP TABLE IF EXISTS ai_gateway_providers")
