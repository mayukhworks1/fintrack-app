"""
PostgreSQL connection pool (Aiven, SSL) + schema bootstrap.

Tables created on first startup:
  audit_log        — every API request with device/geo enrichment
  login_sessions   — active login tokens with last-seen tracking
  chat_sessions    — AI assistant conversation groups
  chat_messages    — individual AI chat turns
  projects_mirror  — Teable project records (full replica)
  invoices_mirror  — Teable invoice records (full replica)
  record_history   — field-level change log for mirrored records
  sync_log         — sync run metadata
"""

import logging
import asyncpg
from ..config import settings

logger = logging.getLogger("fintrack.db.postgres")
_pool: asyncpg.Pool | None = None

# ---------------------------------------------------------------------------
SCHEMA = """
-- ── Audit log ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
    id           BIGSERIAL    PRIMARY KEY,
    ts           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    role         VARCHAR(20),
    token_hint   VARCHAR(20),

    method       VARCHAR(10),
    path         VARCHAR(500),
    status       SMALLINT,
    duration_ms  INTEGER,
    request_id   VARCHAR(50),

    ip           VARCHAR(45),
    user_agent   TEXT,
    os           VARCHAR(100),
    browser      VARCHAR(100),
    device       VARCHAR(20),

    country      VARCHAR(80),
    country_code VARCHAR(4),
    region       VARCHAR(100),
    city         VARCHAR(100),
    isp          VARCHAR(150),

    extra        JSONB        NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS al_ts_idx   ON audit_log (ts DESC);
CREATE INDEX IF NOT EXISTS al_role_idx ON audit_log (role, ts DESC);
CREATE INDEX IF NOT EXISTS al_ip_idx   ON audit_log (ip,   ts DESC);
CREATE INDEX IF NOT EXISTS al_path_idx ON audit_log (path, ts DESC);

-- ── Login sessions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS login_sessions (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hint    VARCHAR(20)  NOT NULL,
    role          VARCHAR(20)  NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_seen_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ  NOT NULL,

    ip            VARCHAR(45),
    user_agent    TEXT,
    os            VARCHAR(100),
    browser       VARCHAR(100),
    device        VARCHAR(20),
    country       VARCHAR(80),
    country_code  VARCHAR(4),
    city          VARCHAR(100),

    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    request_count INTEGER      NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ls_token_idx   ON login_sessions (token_hint);
CREATE INDEX IF NOT EXISTS ls_role_idx    ON login_sessions (role, created_at DESC);
CREATE INDEX IF NOT EXISTS ls_active_idx  ON login_sessions (is_active, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS ls_expires_idx ON login_sessions (expires_at DESC);

-- ── AI chat sessions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_sessions (
    id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    role       VARCHAR(20),
    ip         VARCHAR(45),
    country    VARCHAR(80),
    city       VARCHAR(100),
    os         VARCHAR(100),
    browser    VARCHAR(100),
    msg_count  INTEGER      NOT NULL DEFAULT 0,
    title      VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS cs_started_idx ON chat_sessions (started_at DESC);

-- ── AI chat messages ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
    id          BIGSERIAL   PRIMARY KEY,
    session_id  UUID        NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    role        VARCHAR(20) NOT NULL,
    content     TEXT        NOT NULL,
    model       VARCHAR(120),
    tokens_used INTEGER,
    duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS cm_session_idx ON chat_messages (session_id, ts);

-- ── Teable mirror: projects ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects_mirror (
    teable_id     VARCHAR(60)   PRIMARY KEY,
    synced_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    fields        JSONB         NOT NULL DEFAULT '{}'::jsonb,

    project_name  VARCHAR(255),
    client        VARCHAR(255),
    status        VARCHAR(80),
    amount_billed NUMERIC(15,2),
    actual_profit NUMERIC(15,2),
    profit_pct    NUMERIC(8,4),
    created_time  TIMESTAMPTZ,
    modified_time TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS pm_status_idx ON projects_mirror (status);
CREATE INDEX IF NOT EXISTS pm_client_idx ON projects_mirror (client);

-- ── Teable mirror: invoices ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices_mirror (
    teable_id        VARCHAR(60)   PRIMARY KEY,
    synced_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    fields           JSONB         NOT NULL DEFAULT '{}'::jsonb,

    invoice_number   VARCHAR(120),
    project          VARCHAR(255),
    category         VARCHAR(120),
    payment_status   VARCHAR(60),
    amount_raised    NUMERIC(15,2),
    amount_with_tax  NUMERIC(15,2),
    amount_received  NUMERIC(15,2),
    raised_date      DATE,
    cleared_date     DATE
);
CREATE INDEX IF NOT EXISTS im_status_idx  ON invoices_mirror (payment_status);
CREATE INDEX IF NOT EXISTS im_project_idx ON invoices_mirror (project);
CREATE INDEX IF NOT EXISTS im_date_idx    ON invoices_mirror (raised_date DESC);

-- ── Record change history ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS record_history (
    id             BIGSERIAL    PRIMARY KEY,
    recorded_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    source_table   VARCHAR(20)  NOT NULL,
    teable_id      VARCHAR(60)  NOT NULL,
    change_type    VARCHAR(10)  NOT NULL,
    old_fields     JSONB,
    new_fields     JSONB,
    changed_fields TEXT[]
);
CREATE INDEX IF NOT EXISTS rh_id_idx ON record_history (source_table, teable_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS rh_ts_idx ON record_history (recorded_at DESC);

-- ── Sync run log ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_log (
    id          BIGSERIAL    PRIMARY KEY,
    synced_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    source      VARCHAR(20)  NOT NULL,
    total       INTEGER      NOT NULL DEFAULT 0,
    created     INTEGER      NOT NULL DEFAULT 0,
    updated     INTEGER      NOT NULL DEFAULT 0,
    unchanged   INTEGER      NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    error       TEXT
);

-- ── Web invoices mirror (separate Teable table + token) ───────────────────
CREATE TABLE IF NOT EXISTS web_invoices_mirror (
    teable_id        VARCHAR(60)   PRIMARY KEY,
    synced_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    fields           JSONB         NOT NULL DEFAULT '{}'::jsonb,

    invoice_number   VARCHAR(120),
    project          VARCHAR(255),
    category         VARCHAR(120),
    description      TEXT,
    milestone        VARCHAR(255),
    raised_by        VARCHAR(255),
    payment_status   VARCHAR(60),
    amount_raised    NUMERIC(15,2),
    amount_with_tax  NUMERIC(15,2),
    amount_received  NUMERIC(15,2),
    raised_date      DATE,
    cleared_date     DATE,
    currency         VARCHAR(20),
    remark           TEXT
);
CREATE INDEX IF NOT EXISTS wim_status_idx  ON web_invoices_mirror (payment_status);
CREATE INDEX IF NOT EXISTS wim_project_idx ON web_invoices_mirror (project);
CREATE INDEX IF NOT EXISTS wim_date_idx    ON web_invoices_mirror (raised_date DESC);

-- ── Idempotent column migrations ──────────────────────────────────────────
-- Safe to run on every startup — adds missing columns to existing tables
-- without touching tables that already have them (IF NOT EXISTS guard).

-- audit_log: detailed request fields (added in v2.3)
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS referer      TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS body_size    INTEGER;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS query_params TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS resp_size    INTEGER;

-- login_sessions: device + location columns may be absent on old deployments
ALTER TABLE login_sessions ADD COLUMN IF NOT EXISTS device       VARCHAR(20);
ALTER TABLE login_sessions ADD COLUMN IF NOT EXISTS country_code VARCHAR(4);
ALTER TABLE login_sessions ADD COLUMN IF NOT EXISTS city         VARCHAR(100);
"""
# ---------------------------------------------------------------------------


async def init_pool() -> None:
    global _pool
    if not settings.postgres_url:
        logger.warning("POSTGRES_URL not set — PostgreSQL features disabled")
        return
    try:
        _pool = await asyncpg.create_pool(
            settings.postgres_url,
            min_size=2,
            max_size=10,
            command_timeout=30,
            ssl="require",
        )
        async with _pool.acquire() as conn:
            await conn.execute(SCHEMA)
        logger.info("PostgreSQL connected and schema ready")
    except Exception as exc:
        logger.error("PostgreSQL init failed: %s", exc)
        _pool = None


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


def get_pool() -> asyncpg.Pool | None:
    return _pool
