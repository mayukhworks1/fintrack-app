"""AI gateway: any provider, a model catalogue, day/week/month limits.

Revision ID: 0008_ai_gateway_v2
Revises: 0007_artifact_records
Create Date: 2026-10-27

  * ai_gateway_providers can hold any OpenAI-compatible provider, not only
    the two built-ins: a label, the preset it came from, its default base URL,
    extra request headers, a display position and a removed flag (a removed
    built-in is kept as a row so its env key stays unused). Groq and
    OpenRouter get rows of their own.
  * ai_gateway_tasks.fallback_to_default: whether the global default chain
    follows the task's own chain (on unless switched off).
  * ai_gateway_models: the model catalogue per provider — label, on/off,
    context window, max output and per-request token limits, and a price per
    1M prompt and answer tokens for spend estimates.
  * ai_gateway_limits: requests, tokens or estimated spend per day, week or
    month, for the workspace ('global'), a provider, a model (target
    'provider|model'), a task or a user ('*' = each user). The 0003 daily caps
    are copied in; from here on this table is the only source of limits.
  * An index on ai_traces (provider, model, ts) for per-model statistics.

The service reads every one of these defensively: before this migration has
run it serves the 0003 settings, and writes that need it answer 503.
"""
from __future__ import annotations

from alembic import op

revision = "0008_ai_gateway_v2"
down_revision = "0007_artifact_records"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for column in (
        "label VARCHAR(60)",
        "preset VARCHAR(20)",
        "default_base_url TEXT",
        "extra_headers JSONB",
        "position INTEGER",
        "deleted BOOLEAN NOT NULL DEFAULT FALSE",
        "created_by VARCHAR(320)",
        "created_at TIMESTAMPTZ DEFAULT NOW()",
    ):
        op.execute(f"ALTER TABLE ai_gateway_providers ADD COLUMN IF NOT EXISTS {column}")
    op.execute(
        """
        INSERT INTO ai_gateway_providers (key, label, preset, default_base_url, position)
        VALUES ('groq', 'Groq', 'groq', 'https://api.groq.com/openai/v1', 0),
               ('openrouter', 'OpenRouter', 'openrouter', 'https://openrouter.ai/api/v1', 1)
        ON CONFLICT (key) DO UPDATE SET
          label = COALESCE(ai_gateway_providers.label, EXCLUDED.label),
          preset = COALESCE(ai_gateway_providers.preset, EXCLUDED.preset),
          default_base_url = COALESCE(ai_gateway_providers.default_base_url, EXCLUDED.default_base_url),
          position = COALESCE(ai_gateway_providers.position, EXCLUDED.position)
        """
    )
    op.execute(
        "ALTER TABLE ai_gateway_tasks ADD COLUMN IF NOT EXISTS fallback_to_default BOOLEAN NOT NULL DEFAULT TRUE"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_gateway_models (
          provider VARCHAR(20) NOT NULL,
          model VARCHAR(120) NOT NULL,
          label VARCHAR(80),
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          context_window INTEGER,
          max_output_tokens INTEGER,
          request_token_limit INTEGER,
          input_cost_per_m NUMERIC(14, 4),
          output_cost_per_m NUMERIC(14, 4),
          vision BOOLEAN,
          updated_by VARCHAR(320),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (provider, model)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_gateway_limits (
          scope VARCHAR(10) NOT NULL CHECK (scope IN ('global', 'provider', 'model', 'task', 'user')),
          target VARCHAR(160) NOT NULL DEFAULT '',
          period VARCHAR(8) NOT NULL CHECK (period IN ('day', 'week', 'month')),
          metric VARCHAR(10) NOT NULL CHECK (metric IN ('requests', 'tokens', 'spend')),
          cap NUMERIC(24, 4) NOT NULL CHECK (cap > 0),
          updated_by VARCHAR(320),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (scope, target, period, metric)
        )
        """
    )
    # The 0003 daily caps, carried over.
    op.execute(
        """
        INSERT INTO ai_gateway_limits (scope, target, period, metric, cap, updated_by)
        SELECT 'provider', key, 'day', 'requests', daily_request_cap, updated_by
          FROM ai_gateway_providers WHERE daily_request_cap > 0
        UNION ALL
        SELECT 'provider', key, 'day', 'tokens', daily_token_cap, updated_by
          FROM ai_gateway_providers WHERE daily_token_cap > 0
        UNION ALL
        SELECT 'task', key, 'day', 'requests', daily_cap, updated_by
          FROM ai_gateway_tasks WHERE daily_cap > 0
        UNION ALL
        SELECT 'global', '', 'day', CASE key WHEN 'daily_call_cap' THEN 'requests' ELSE 'tokens' END,
               (value #>> '{}')::numeric, updated_by
          FROM ai_gateway_settings
         WHERE key IN ('daily_call_cap', 'daily_token_cap')
           AND jsonb_typeof(value) = 'number' AND (value #>> '{}')::numeric > 0
        ON CONFLICT DO NOTHING
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS at_provider_model_ts_idx ON ai_traces (provider, model, ts DESC)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS at_provider_model_ts_idx")
    op.execute("DROP TABLE IF EXISTS ai_gateway_limits")
    op.execute("DROP TABLE IF EXISTS ai_gateway_models")
    op.execute("ALTER TABLE ai_gateway_tasks DROP COLUMN IF EXISTS fallback_to_default")
    # Providers added from the admin panel cannot be served by the 0003 code.
    op.execute("DELETE FROM ai_gateway_providers WHERE key NOT IN ('groq', 'openrouter')")
    for column in ("created_at", "created_by", "deleted", "position", "extra_headers",
                   "default_base_url", "preset", "label"):
        op.execute(f"ALTER TABLE ai_gateway_providers DROP COLUMN IF EXISTS {column}")
