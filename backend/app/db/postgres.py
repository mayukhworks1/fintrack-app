"""
PostgreSQL connection pool (Aiven, SSL) + schema bootstrap.

Tables created on first startup:
  audit_log        — every API request with device/geo enrichment
  login_sessions   — active login tokens with last-seen tracking
  chat_sessions    — AI assistant conversation groups
  chat_messages    — individual AI chat turns
  projects_mirror  — Teable project records (full replica)
  invoices_mirror  — Teable invoice records (full replica)
  web_invoices_mirror — Teable web invoice records (full replica)
  status_mirror    — Teable Current Status table replica (tblgdbV6T4Ly9n6YNCU)
  record_history   — field-level change log for mirrored records
  sync_log         — sync run metadata
"""

from __future__ import annotations

import logging
import asyncpg
from ..config import settings

logger = logging.getLogger("fintrack.db.postgres")
_pool: asyncpg.Pool | None = None
_init_error: str | None = None   # last init failure reason (exposed via /health)

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
-- Field-level audit trail for every create/update/delete on mirrored records.
-- The `actor_*` columns capture WHO made the change, enriched from the user's
-- HTTP request at mutation time and shuttled to the sync loop via a short-lived
-- Valkey attribution entry (see db/valkey.attribution_set / attribution_pop).
CREATE TABLE IF NOT EXISTS record_history (
    id               BIGSERIAL    PRIMARY KEY,
    recorded_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    source_table     VARCHAR(20)  NOT NULL,
    teable_id        VARCHAR(60)  NOT NULL,
    change_type      VARCHAR(10)  NOT NULL,
    old_fields       JSONB,
    new_fields       JSONB,
    changed_fields   TEXT[],

    -- Actor attribution (populated when change originated from a user request)
    change_source    VARCHAR(10)  DEFAULT 'sync',  -- 'user' | 'sync' | 'system'
    actor_role       VARCHAR(20),
    actor_ip         VARCHAR(45),
    actor_country    VARCHAR(80),
    actor_city       VARCHAR(100),
    actor_region     VARCHAR(100),
    actor_isp        VARCHAR(150),
    actor_lat        DOUBLE PRECISION,
    actor_lon        DOUBLE PRECISION,
    actor_os         VARCHAR(100),
    actor_browser    VARCHAR(100),
    actor_device     VARCHAR(20),
    actor_user_agent TEXT,
    actor_session_id UUID,
    actor_path       VARCHAR(200),    -- API path that triggered the change
    actor_method     VARCHAR(10),

    -- Rich device fingerprint (from JS-collected X-Client-Hint header)
    actor_device_label     VARCHAR(255),    -- Human-readable e.g. "MacBook · macOS 14.5 · Chrome 131"
    actor_device_model     VARCHAR(120),    -- e.g. "iPhone 15 Pro", "Pixel 8" (UA Client Hints)
    actor_platform_version VARCHAR(40),     -- e.g. "14.5.1"
    actor_arch             VARCHAR(40),     -- e.g. "arm64", "x86_64"
    actor_cpu_cores        SMALLINT,        -- navigator.hardwareConcurrency
    actor_memory_gb        SMALLINT,        -- navigator.deviceMemory (Chromium only)
    actor_gpu              VARCHAR(200),    -- WebGL UNMASKED_RENDERER_WEBGL
    actor_screen           VARCHAR(40),     -- "1920x1080@2x"
    actor_timezone         VARCHAR(60),     -- IANA tz, e.g. "Asia/Kolkata"
    actor_language         VARCHAR(20),     -- "en-IN"
    actor_network          VARCHAR(20)      -- "4g", "wifi", etc.
);
CREATE INDEX IF NOT EXISTS rh_id_idx ON record_history (source_table, teable_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS rh_ts_idx ON record_history (recorded_at DESC);
-- NOTE: rh_actor_idx and rh_source_idx are created AFTER the ALTER TABLE block below
-- because actor_role / change_source may not exist yet on older deployments.

-- Migration: backfill the actor columns on existing tables that pre-date this schema.
-- ADD COLUMN IF NOT EXISTS is a no-op when the column already exists.
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS change_source    VARCHAR(10) DEFAULT 'sync';
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS actor_role       VARCHAR(20);
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS actor_ip         VARCHAR(45);
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS actor_country    VARCHAR(80);
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS actor_city       VARCHAR(100);
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS actor_region     VARCHAR(100);
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS actor_isp        VARCHAR(150);
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS actor_lat        DOUBLE PRECISION;
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS actor_lon        DOUBLE PRECISION;
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS actor_os         VARCHAR(100);
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS actor_browser    VARCHAR(100);
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS actor_device     VARCHAR(20);
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS actor_user_agent TEXT;
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS actor_session_id UUID;
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS actor_path       VARCHAR(200);
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS actor_method     VARCHAR(10);
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS actor_device_label     VARCHAR(255);
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS actor_device_model     VARCHAR(120);
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS actor_platform_version VARCHAR(40);
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS actor_arch             VARCHAR(40);
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS actor_cpu_cores        SMALLINT;
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS actor_memory_gb        SMALLINT;
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS actor_gpu              VARCHAR(200);
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS actor_screen           VARCHAR(40);
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS actor_timezone         VARCHAR(60);
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS actor_language         VARCHAR(20);
ALTER TABLE record_history ADD COLUMN IF NOT EXISTS actor_network          VARCHAR(20);

-- These indexes reference columns added above — must come AFTER the ALTER TABLE block.
CREATE INDEX IF NOT EXISTS rh_actor_idx  ON record_history (actor_role,     recorded_at DESC);
CREATE INDEX IF NOT EXISTS rh_source_idx ON record_history (change_source,  recorded_at DESC);

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

-- ── Current Status table mirror (tblgdbV6T4Ly9n6YNCU) ────────────────────────
CREATE TABLE IF NOT EXISTS status_mirror (
    teable_id     VARCHAR(60)   PRIMARY KEY,
    synced_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    fields        JSONB         NOT NULL DEFAULT '{}'::jsonb,

    client        VARCHAR(255),
    project       VARCHAR(255),
    short_status  VARCHAR(500),
    detail_status TEXT,
    modified_time TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS stm_client_idx  ON status_mirror (client);
CREATE INDEX IF NOT EXISTS stm_project_idx ON status_mirror (project);
CREATE INDEX IF NOT EXISTS stm_synced_idx  ON status_mirror (synced_at DESC);
ALTER TABLE status_mirror ADD COLUMN IF NOT EXISTS status VARCHAR(100);

-- ── Shared Views (manager share links with access tracking) ──────────────────
CREATE TABLE IF NOT EXISTS shared_views (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    token            VARCHAR(32)   UNIQUE NOT NULL,
    title            VARCHAR(500),
    record_ids       JSONB         NOT NULL DEFAULT '[]'::jsonb,
    created_by       VARCHAR(50)   NOT NULL,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    created_from_ip  VARCHAR(100),
    expires_at       TIMESTAMPTZ,
    is_active        BOOLEAN       NOT NULL DEFAULT TRUE,
    access_count     INTEGER       NOT NULL DEFAULT 0,
    last_accessed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sv_token_idx   ON shared_views (token);
CREATE INDEX IF NOT EXISTS sv_created_idx ON shared_views (created_at DESC);
CREATE INDEX IF NOT EXISTS sv_active_idx  ON shared_views (is_active, expires_at);

CREATE TABLE IF NOT EXISTS shared_view_accesses (
    id          UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    view_token  VARCHAR(32)      NOT NULL,
    accessed_at TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    ip          VARCHAR(100),
    country     VARCHAR(100),
    city        VARCHAR(100),
    isp         VARCHAR(200),
    lat         DOUBLE PRECISION,
    lon         DOUBLE PRECISION,
    timezone    VARCHAR(100),
    os          VARCHAR(200),
    browser     VARCHAR(200),
    device_type VARCHAR(100),
    user_agent  TEXT,
    referer     VARCHAR(500)
);
CREATE INDEX IF NOT EXISTS sva_token_idx ON shared_view_accesses (view_token);
CREATE INDEX IF NOT EXISTS sva_time_idx  ON shared_view_accesses (accessed_at DESC);

-- ── Idempotent column migrations ──────────────────────────────────────────
-- Safe to run on every startup — adds missing columns to existing tables
-- without touching tables that already have them (IF NOT EXISTS guard).

-- audit_log: detailed request fields (added in v2.3)
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS referer      TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS body_size    INTEGER;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS query_params TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS resp_size    INTEGER;

-- audit_log: extended geo fields (added in v2.4)
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS lat      NUMERIC(9,6);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS lon      NUMERIC(9,6);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS timezone VARCHAR(50);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS org      VARCHAR(200);

-- audit_log: performance indexes for filter queries
CREATE INDEX IF NOT EXISTS al_status_idx  ON audit_log (status,  ts DESC);
CREATE INDEX IF NOT EXISTS al_country_idx ON audit_log (country, ts DESC);
CREATE INDEX IF NOT EXISTS al_method_idx  ON audit_log (method,  ts DESC);

-- login_sessions: device + location columns may be absent on old deployments
ALTER TABLE login_sessions ADD COLUMN IF NOT EXISTS device       VARCHAR(20);
ALTER TABLE login_sessions ADD COLUMN IF NOT EXISTS country_code VARCHAR(4);
ALTER TABLE login_sessions ADD COLUMN IF NOT EXISTS city         VARCHAR(100);
ALTER TABLE login_sessions ADD COLUMN IF NOT EXISTS region       VARCHAR(100);
ALTER TABLE login_sessions ADD COLUMN IF NOT EXISTS isp          VARCHAR(150);
"""
# ---------------------------------------------------------------------------


async def init_pool() -> None:
    global _pool, _init_error
    if not settings.postgres_url:
        _init_error = "POSTGRES_URL env var not set"
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
        _init_error = None
        logger.info("PostgreSQL connected and schema ready")
    except Exception as exc:
        _init_error = f"{type(exc).__name__}: {exc}"
        logger.error("PostgreSQL init failed: %s", exc, exc_info=True)
        _pool = None


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


def get_pool() -> asyncpg.Pool | None:
    return _pool


def get_init_error() -> str | None:
    """Return the last pool initialisation error (for diagnostics)."""
    return _init_error
