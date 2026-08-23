"""
PostgreSQL connection pool (Aiven, SSL) + schema bootstrap.

Tables created on first startup:
  audit_log        — every API request with device/geo enrichment
  login_sessions   — active login tokens with last-seen tracking
  chat_sessions    — AI assistant conversation groups
  chat_messages    — individual AI chat turns
  report_history   — generated AI/board reports for replay and audit
  ai_generations   — structured AI chat/report/dashboard artifacts for audit
  insight_configs  — saved custom dashboard/report presets
  insight_exports  — export audit trail for dashboard/report downloads
  projects_mirror  — Teable project records (full replica)
  invoices_mirror  — Teable invoice records (full replica)
  web_invoices_mirror — Teable web invoice records (full replica)
  status_mirror    — Teable Current Status table replica (tblgdbV6T4Ly9n6YNCU)
  record_history   — field-level change log for mirrored records
  sync_log         — sync run metadata
  auth_users       — master user identities for email/password + future SSO
  auth_sessions    — server-side session control plane for new auth
  auth_events      — security/audit events for auth and approvals
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

    lat          DOUBLE PRECISION,
    lon          DOUBLE PRECISION,
    timezone     VARCHAR(60),
    org          VARCHAR(200),
    referer      VARCHAR(500),
    body_size    INTEGER,
    query_params VARCHAR(500),
    resp_size    INTEGER,

    -- Identity columns — populated for email-auth sessions; NULL for legacy tokens
    user_id      UUID         REFERENCES auth_users(id) ON DELETE SET NULL,
    user_email   VARCHAR(320),
    user_name    VARCHAR(255),

    extra        JSONB        NOT NULL DEFAULT '{}'::jsonb
);
-- Add new columns to existing installs (idempotent)
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS lat          DOUBLE PRECISION;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS lon          DOUBLE PRECISION;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS timezone     VARCHAR(60);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS org          VARCHAR(200);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS referer      VARCHAR(500);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS body_size    INTEGER;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS query_params VARCHAR(500);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS resp_size    INTEGER;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS user_id      UUID;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS user_email   VARCHAR(320);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS user_name    VARCHAR(255);
-- Constraint only if auth_users exists (safe on new installs)
DO $$ BEGIN
  IF to_regclass('public.auth_users') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'audit_log' AND constraint_name = 'audit_log_user_id_fkey'
  ) THEN
    ALTER TABLE audit_log ADD CONSTRAINT audit_log_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS al_ts_idx      ON audit_log (ts DESC);
CREATE INDEX IF NOT EXISTS al_role_idx    ON audit_log (role, ts DESC);
CREATE INDEX IF NOT EXISTS al_ip_idx      ON audit_log (ip,   ts DESC);
CREATE INDEX IF NOT EXISTS al_path_idx    ON audit_log (path, ts DESC);
CREATE INDEX IF NOT EXISTS al_user_idx    ON audit_log (user_id, ts DESC);
CREATE INDEX IF NOT EXISTS al_email_idx   ON audit_log (user_email, ts DESC);
CREATE INDEX IF NOT EXISTS al_status_idx  ON audit_log (status, ts DESC);

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
    region        VARCHAR(100),
    isp           VARCHAR(150),
    lat           DOUBLE PRECISION,
    lon           DOUBLE PRECISION,
    timezone      VARCHAR(60),
    device_label  VARCHAR(255),
    device_model  VARCHAR(120),
    platform_version VARCHAR(40),

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

-- ── AI report history ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS report_history (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    report_type VARCHAR(40)  NOT NULL DEFAULT 'board-pack',
    title       VARCHAR(255),
    content     TEXT         NOT NULL,
    model       VARCHAR(120),
    role        VARCHAR(20),
    ip          VARCHAR(45),
    metadata    JSONB        NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS rpt_created_idx ON report_history (created_at DESC);
CREATE INDEX IF NOT EXISTS rpt_type_idx    ON report_history (report_type, created_at DESC);

-- ── AI generation audit ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_generations (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    session_id    UUID,
    task_type     VARCHAR(40)  NOT NULL,
    response_mode VARCHAR(20),
    model         VARCHAR(120),
    role          VARCHAR(20),
    ip            VARCHAR(45),
    prompt        TEXT         NOT NULL,
    output_text   TEXT,
    artifact      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    verification  JSONB        NOT NULL DEFAULT '{}'::jsonb,
    metadata      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    duration_ms   INTEGER
);
CREATE INDEX IF NOT EXISTS aig_created_idx ON ai_generations (created_at DESC);
CREATE INDEX IF NOT EXISTS aig_task_idx    ON ai_generations (task_type, created_at DESC);
CREATE INDEX IF NOT EXISTS aig_session_idx ON ai_generations (session_id, created_at DESC);

-- ── Custom insight presets + export audit ────────────────────────────────
CREATE TABLE IF NOT EXISTS insight_configs (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    page_key      VARCHAR(40)  NOT NULL,
    config_kind   VARCHAR(20)  NOT NULL DEFAULT 'dashboard',
    title         VARCHAR(255) NOT NULL,
    role          VARCHAR(20),
    ip            VARCHAR(45),
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    config        JSONB        NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ic_page_idx  ON insight_configs (page_key, config_kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS ic_role_idx  ON insight_configs (role, updated_at DESC);

CREATE TABLE IF NOT EXISTS insight_exports (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    page_key      VARCHAR(40)  NOT NULL,
    source_key    VARCHAR(40)  NOT NULL,
    export_format VARCHAR(20)  NOT NULL,
    title         VARCHAR(255) NOT NULL,
    role          VARCHAR(20),
    ip            VARCHAR(45),
    config_id     UUID         REFERENCES insight_configs(id) ON DELETE SET NULL,
    column_count  INTEGER      NOT NULL DEFAULT 0,
    row_count     INTEGER      NOT NULL DEFAULT 0,
    columns       JSONB        NOT NULL DEFAULT '[]'::jsonb,
    filters       JSONB        NOT NULL DEFAULT '{}'::jsonb,
    metadata      JSONB        NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ie_page_idx   ON insight_exports (page_key, created_at DESC);
CREATE INDEX IF NOT EXISTS ie_format_idx ON insight_exports (export_format, created_at DESC);

-- ── Teable mirror: projects ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects_mirror (
    teable_id     VARCHAR(60)   PRIMARY KEY,
    synced_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    deleted_at    TIMESTAMPTZ,
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
    deleted_at       TIMESTAMPTZ,
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
    source      VARCHAR(40)  NOT NULL,
    total       INTEGER      NOT NULL DEFAULT 0,
    created     INTEGER      NOT NULL DEFAULT 0,
    updated     INTEGER      NOT NULL DEFAULT 0,
    unchanged   INTEGER      NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    error       TEXT,
    details     JSONB        NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE sync_log ALTER COLUMN source TYPE VARCHAR(40);

-- ── Web invoices mirror (separate Teable table + token) ───────────────────
CREATE TABLE IF NOT EXISTS web_invoices_mirror (
    teable_id        VARCHAR(60)   PRIMARY KEY,
    synced_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    deleted_at       TIMESTAMPTZ,
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
    deleted_at    TIMESTAMPTZ,
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
ALTER TABLE projects_mirror ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE invoices_mirror ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE web_invoices_mirror ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE status_mirror ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

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
    access_mode      VARCHAR(10)   NOT NULL DEFAULT 'read',
    is_active        BOOLEAN       NOT NULL DEFAULT TRUE,
    access_count     INTEGER       NOT NULL DEFAULT 0,
    last_accessed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sv_token_idx   ON shared_views (token);
CREATE INDEX IF NOT EXISTS sv_created_idx ON shared_views (created_at DESC);
CREATE INDEX IF NOT EXISTS sv_active_idx  ON shared_views (is_active, expires_at);
ALTER TABLE shared_views ADD COLUMN IF NOT EXISTS view_config JSONB;
ALTER TABLE shared_views ADD COLUMN IF NOT EXISTS access_mode VARCHAR(10) NOT NULL DEFAULT 'read';
ALTER TABLE shared_views ADD COLUMN IF NOT EXISTS resource_type VARCHAR(20) NOT NULL DEFAULT 'status';

CREATE TABLE IF NOT EXISTS shared_view_accesses (
    id          UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    view_token  VARCHAR(32)      NOT NULL,
    accessed_at TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    event_type  VARCHAR(20)      NOT NULL DEFAULT 'view',
    viewer_key  VARCHAR(120),
    record_id   VARCHAR(60),
    ip          VARCHAR(100),
    country     VARCHAR(100),
    country_code VARCHAR(4),
    region      VARCHAR(100),
    city        VARCHAR(100),
    isp         VARCHAR(200),
    lat         DOUBLE PRECISION,
    lon         DOUBLE PRECISION,
    timezone    VARCHAR(100),
    geo_source  VARCHAR(20),
    accuracy_m  INTEGER,
    os          VARCHAR(200),
    browser     VARCHAR(200),
    device_type VARCHAR(100),
    device_label VARCHAR(255),
    device_model VARCHAR(120),
    platform_version VARCHAR(40),
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
ALTER TABLE login_sessions ADD COLUMN IF NOT EXISTS lat          DOUBLE PRECISION;
ALTER TABLE login_sessions ADD COLUMN IF NOT EXISTS lon          DOUBLE PRECISION;
ALTER TABLE login_sessions ADD COLUMN IF NOT EXISTS timezone     VARCHAR(60);
ALTER TABLE login_sessions ADD COLUMN IF NOT EXISTS device_label VARCHAR(255);
ALTER TABLE login_sessions ADD COLUMN IF NOT EXISTS device_model VARCHAR(120);
ALTER TABLE login_sessions ADD COLUMN IF NOT EXISTS platform_version VARCHAR(40);
ALTER TABLE shared_view_accesses ADD COLUMN IF NOT EXISTS country_code VARCHAR(4);
ALTER TABLE shared_view_accesses ADD COLUMN IF NOT EXISTS region VARCHAR(100);
ALTER TABLE shared_view_accesses ADD COLUMN IF NOT EXISTS geo_source VARCHAR(20);
ALTER TABLE shared_view_accesses ADD COLUMN IF NOT EXISTS accuracy_m INTEGER;
ALTER TABLE shared_view_accesses ADD COLUMN IF NOT EXISTS event_type VARCHAR(20) NOT NULL DEFAULT 'view';
ALTER TABLE shared_view_accesses ADD COLUMN IF NOT EXISTS viewer_key VARCHAR(120);
ALTER TABLE shared_view_accesses ADD COLUMN IF NOT EXISTS record_id VARCHAR(60);
ALTER TABLE shared_view_accesses ADD COLUMN IF NOT EXISTS device_label VARCHAR(255);
ALTER TABLE shared_view_accesses ADD COLUMN IF NOT EXISTS device_model VARCHAR(120);
ALTER TABLE shared_view_accesses ADD COLUMN IF NOT EXISTS platform_version VARCHAR(40);
ALTER TABLE shared_view_accesses ADD COLUMN IF NOT EXISTS meta JSONB;
CREATE INDEX IF NOT EXISTS sva_event_idx ON shared_view_accesses (view_token, event_type);

-- ── Auth master: users, roles, permissions, sessions ─────────────────────
-- Additive auth control plane. Existing password-role login remains compatible
-- until the SSO/RBAC rollout is complete.
CREATE TABLE IF NOT EXISTS auth_users (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    approved_at         TIMESTAMPTZ,
    disabled_at         TIMESTAMPTZ,
    email               VARCHAR(320) UNIQUE NOT NULL,
    email_normalized    VARCHAR(320) UNIQUE NOT NULL,
    full_name           VARCHAR(255),
    status              VARCHAR(30)  NOT NULL DEFAULT 'pending_approval',
    password_hash       TEXT,
    password_changed_at TIMESTAMPTZ,
    email_verified_at   TIMESTAMPTZ,
    approved_by         UUID,
    phone               VARCHAR(40),
    job_title           VARCHAR(120),
    department          VARCHAR(120),
    company             VARCHAR(160),
    location            VARCHAR(160),
    timezone            VARCHAR(80),
    -- Optional override: the email stored in Teable's "Raised By" field.
    -- When set, ownership scoping uses this email instead of the login email.
    -- Allows login as mayukh@gmail.com while matching Teable records for mayukh@worksmayukh.space.
    teable_email        VARCHAR(320),
    metadata            JSONB        NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT auth_users_status_chk CHECK (status IN ('pending_approval', 'active', 'rejected', 'disabled'))
);
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS teable_email VARCHAR(320);
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS phone VARCHAR(40);
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS job_title VARCHAR(120);
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS department VARCHAR(120);
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS company VARCHAR(160);
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS location VARCHAR(160);
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS timezone VARCHAR(80);
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
-- TRUE once the user has manually uploaded a profile picture — SSO login must
-- never overwrite it again after that point.
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS avatar_is_custom BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS first_name VARCHAR(128);
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS last_name  VARCHAR(128);
-- Backfill first_name / last_name from legacy full_name on existing rows
UPDATE auth_users
   SET first_name = SPLIT_PART(TRIM(full_name), ' ', 1),
       last_name  = NULLIF(TRIM(SUBSTRING(TRIM(full_name) FROM POSITION(' ' IN TRIM(full_name)) + 1)), '')
 WHERE full_name IS NOT NULL
   AND first_name IS NULL;
CREATE INDEX IF NOT EXISTS au_status_idx ON auth_users (status, created_at DESC);
CREATE INDEX IF NOT EXISTS au_email_norm_idx ON auth_users (email_normalized);
CREATE INDEX IF NOT EXISTS au_teable_email_idx ON auth_users (teable_email);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'audit_log' AND constraint_name = 'audit_log_user_id_fkey'
  ) THEN
    ALTER TABLE audit_log ADD CONSTRAINT audit_log_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS auth_identities (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID         NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    provider         VARCHAR(30)  NOT NULL,
    provider_user_id VARCHAR(255) NOT NULL,
    email            VARCHAR(320),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_seen_at     TIMESTAMPTZ,
    raw_profile      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE(provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS ai_user_idx ON auth_identities (user_id);

CREATE TABLE IF NOT EXISTS auth_roles (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    role_key    VARCHAR(60)  UNIQUE NOT NULL,
    label       VARCHAR(120) NOT NULL,
    description TEXT,
    rank        INTEGER      NOT NULL DEFAULT 100,
    is_system   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_permissions (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    permission_key VARCHAR(120) UNIQUE NOT NULL,
    label          VARCHAR(160) NOT NULL,
    module_key     VARCHAR(60)  NOT NULL,
    action_key     VARCHAR(60)  NOT NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_role_permissions (
    role_id       UUID NOT NULL REFERENCES auth_roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES auth_permissions(id) ON DELETE CASCADE,
    PRIMARY KEY(role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS auth_user_roles (
    user_id     UUID        NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    role_id     UUID        NOT NULL REFERENCES auth_roles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_by UUID,
    PRIMARY KEY(user_id, role_id)
);

CREATE TABLE IF NOT EXISTS auth_user_scopes (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    scope_type       VARCHAR(40) NOT NULL DEFAULT 'own',
    module_key       VARCHAR(60),
    client_name      VARCHAR(255),
    project_name     VARCHAR(255),
    raised_by        VARCHAR(255),
    can_view_amounts BOOLEAN     NOT NULL DEFAULT TRUE,
    can_export       BOOLEAN     NOT NULL DEFAULT FALSE,
    can_share        BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by       UUID,
    metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS aus_user_idx ON auth_user_scopes (user_id);
CREATE INDEX IF NOT EXISTS aus_scope_idx ON auth_user_scopes (scope_type, module_key);

-- Per-user permission overrides (grant or deny a specific permission regardless of role)
CREATE TABLE IF NOT EXISTS auth_user_permission_grants (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID        NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    permission_id UUID        NOT NULL REFERENCES auth_permissions(id) ON DELETE CASCADE,
    granted       BOOLEAN     NOT NULL,
    granted_by    UUID,
    granted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, permission_id)
);
CREATE INDEX IF NOT EXISTS aupg_user_idx ON auth_user_permission_grants (user_id);

CREATE TABLE IF NOT EXISTS auth_sessions (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID         NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    token_hint    VARCHAR(20)  NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_seen_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ  NOT NULL,
    revoked_at    TIMESTAMPTZ,
    ip            VARCHAR(45),
    user_agent    TEXT,
    os            VARCHAR(100),
    browser       VARCHAR(100),
    device        VARCHAR(20),
    device_label  VARCHAR(255),
    country       VARCHAR(80),
    country_code  VARCHAR(4),
    region        VARCHAR(100),
    city          VARCHAR(100),
    isp           VARCHAR(150),
    request_count INTEGER      NOT NULL DEFAULT 1,
    metadata      JSONB        NOT NULL DEFAULT '{}'::jsonb
);
-- Older deployments may already have auth_sessions without newer tracking columns.
-- Keep this additive so admin timeline/session views never break on missing columns.
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS os            VARCHAR(100);
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS browser       VARCHAR(100);
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS device        VARCHAR(20);
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS device_label  VARCHAR(255);
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS country       VARCHAR(80);
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS country_code  VARCHAR(4);
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS region        VARCHAR(100);
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS city          VARCHAR(100);
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS isp           VARCHAR(150);
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS request_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS metadata      JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS as_token_idx ON auth_sessions (token_hint);
CREATE INDEX IF NOT EXISTS as_user_idx ON auth_sessions (user_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS as_active_idx ON auth_sessions (revoked_at, expires_at DESC);

CREATE TABLE IF NOT EXISTS auth_password_resets (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    token_hash  TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    ip          VARCHAR(45),
    user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS apr_user_idx ON auth_password_resets (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS auth_oauth_states (
    state_hash  TEXT        PRIMARY KEY,
    provider    VARCHAR(30) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    ip          VARCHAR(45),
    user_agent  TEXT,
    redirect_to TEXT,
    metadata    JSONB       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS aos_provider_idx ON auth_oauth_states (provider, created_at DESC);
CREATE INDEX IF NOT EXISTS aos_expires_idx ON auth_oauth_states (expires_at DESC);

CREATE TABLE IF NOT EXISTS auth_events (
    id             BIGSERIAL    PRIMARY KEY,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    event_type     VARCHAR(80)  NOT NULL,
    actor_user_id  UUID,
    target_user_id UUID,
    role           VARCHAR(60),
    email          VARCHAR(320),
    status         VARCHAR(40),
    ip             VARCHAR(45),
    user_agent     TEXT,
    request_id     VARCHAR(50),
    metadata       JSONB        NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ae_created_idx ON auth_events (created_at DESC);
CREATE INDEX IF NOT EXISTS ae_type_idx ON auth_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS ae_target_idx ON auth_events (target_user_id, created_at DESC);

INSERT INTO auth_roles (role_key, label, description, rank, is_system) VALUES
  ('superadmin', 'Super Admin', 'Full auth, security, system, data, and audit control.', 1, true),
  ('admin', 'Admin', 'Business administration and operational control.', 10, true),
  ('manager', 'Manager', 'Scoped team/client/project operations.', 30, true),
  ('finance', 'Finance', 'Invoice, tax ledger, reports, and payment operations.', 40, true),
  ('web_admin', 'Web Invoice Admin', 'Full access across web invoices, web projects, and web finance controls.', 45, true),
  ('web', 'Web Invoice User', 'Scoped web invoice access owned by user email.', 50, true),
  ('user', 'User', 'Scoped operational user.', 60, true),
  ('viewer', 'Viewer', 'Read-only scoped access.', 90, true)
ON CONFLICT (role_key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  rank = EXCLUDED.rank;

INSERT INTO auth_permissions (permission_key, label, module_key, action_key) VALUES
  ('module.dashboard.view', 'View Dashboard', 'dashboard', 'view'),
  ('module.projects.view', 'View Projects', 'projects', 'view'),
  ('module.projects.create', 'Create Projects', 'projects', 'create'),
  ('module.projects.edit', 'Edit Projects', 'projects', 'edit'),
  ('module.projects.delete', 'Delete Projects', 'projects', 'delete'),
  ('module.invoices.view', 'View Invoices', 'invoices', 'view'),
  ('module.invoices.create', 'Create Invoices', 'invoices', 'create'),
  ('module.invoices.edit', 'Edit Invoices', 'invoices', 'edit'),
  ('module.invoices.delete', 'Delete Invoices', 'invoices', 'delete'),
  ('module.invoices.payment', 'Record Invoice Payments', 'invoices', 'payment'),
  ('module.tax.view', 'View Tax Ledger', 'tax', 'view'),
  ('module.tax.export', 'Export Tax Ledger', 'tax', 'export'),
  ('module.tax.share', 'Share Tax Ledger', 'tax', 'share'),
  ('module.analytics.view', 'View Analytics', 'analytics', 'view'),
  ('module.reports.create', 'Create Reports', 'reports', 'create'),
  ('module.reports.export', 'Export Reports', 'reports', 'export'),
  ('module.ai.use', 'Use AI Assistant', 'ai', 'use'),
  ('module.status.view', 'View Status Board', 'status', 'view'),
  ('module.status.edit', 'Edit Status Board', 'status', 'edit'),
  ('module.shared.manage', 'Manage Shared Views', 'shared', 'manage'),
  ('module.admin.view', 'View Admin Panel', 'admin', 'view'),
  ('module.admin.users.approve', 'Approve Users', 'admin', 'users.approve'),
  ('module.admin.users.manage', 'Manage Users', 'admin', 'users.manage'),
  ('module.admin.audit.view', 'View Audit Logs', 'admin', 'audit.view'),
  ('module.studio.view', 'View Studio', 'studio', 'view'),
  ('module.studio.ask', 'Ask Studio Questions', 'studio', 'ask'),
  ('module.studio.docs.manage', 'Manage Studio Documents', 'studio', 'docs.manage'),
  ('system.sync.trigger', 'Trigger System Sync', 'system', 'sync.trigger'),
  ('system.roles.manage', 'Manage Roles and Permissions', 'system', 'roles.manage')
ON CONFLICT (permission_key) DO UPDATE SET
  label = EXCLUDED.label,
  module_key = EXCLUDED.module_key,
  action_key = EXCLUDED.action_key;

INSERT INTO auth_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth_roles r
CROSS JOIN auth_permissions p
WHERE r.role_key = 'superadmin'
ON CONFLICT DO NOTHING;

INSERT INTO auth_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth_roles r
JOIN auth_permissions p ON p.permission_key IN (
  'module.dashboard.view', 'module.projects.view', 'module.projects.create', 'module.projects.edit',
  'module.invoices.view', 'module.invoices.create', 'module.invoices.edit', 'module.invoices.payment',
  'module.tax.view', 'module.tax.export', 'module.analytics.view', 'module.reports.create',
  'module.reports.export', 'module.ai.use', 'module.status.view', 'module.status.edit',
  'module.shared.manage', 'module.admin.view', 'module.admin.audit.view', 'system.sync.trigger',
  'module.studio.view', 'module.studio.ask', 'module.studio.docs.manage'
)
WHERE r.role_key = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO auth_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth_roles r
JOIN auth_permissions p ON p.permission_key IN (
  'module.dashboard.view', 'module.projects.view', 'module.projects.edit',
  'module.invoices.view', 'module.invoices.edit', 'module.invoices.payment',
  'module.tax.view', 'module.analytics.view', 'module.reports.create',
  'module.ai.use', 'module.status.view', 'module.status.edit',
  'module.studio.view', 'module.studio.ask', 'module.studio.docs.manage'
)
WHERE r.role_key = 'manager'
ON CONFLICT DO NOTHING;

INSERT INTO auth_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth_roles r
JOIN auth_permissions p ON p.permission_key IN (
  'module.dashboard.view', 'module.invoices.view', 'module.invoices.create',
  'module.invoices.edit', 'module.invoices.payment', 'module.tax.view',
  'module.tax.export', 'module.reports.create', 'module.reports.export'
)
WHERE r.role_key = 'finance'
ON CONFLICT DO NOTHING;

INSERT INTO auth_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth_roles r
JOIN auth_permissions p ON p.permission_key IN (
  'module.dashboard.view', 'module.projects.view', 'module.projects.create', 'module.projects.edit',
  'module.projects.delete', 'module.invoices.view', 'module.invoices.create', 'module.invoices.edit',
  'module.invoices.delete', 'module.invoices.payment', 'module.tax.view', 'module.tax.export',
  'module.tax.share', 'module.analytics.view', 'module.reports.create', 'module.reports.export',
  'module.ai.use', 'module.shared.manage'
)
WHERE r.role_key = 'web_admin'
ON CONFLICT DO NOTHING;

INSERT INTO auth_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth_roles r
JOIN auth_permissions p ON p.permission_key IN (
  'module.invoices.view', 'module.invoices.create',
  'module.invoices.edit', 'module.invoices.payment'
)
WHERE r.role_key = 'web'
ON CONFLICT DO NOTHING;

-- 'user' maps to 'viewer' legacy role — AI route is blocked by ViewerGuard regardless,
-- so module.ai.use is removed to keep the permission matrix accurate.
INSERT INTO auth_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth_roles r
JOIN auth_permissions p ON p.permission_key IN (
  'module.dashboard.view', 'module.projects.view', 'module.invoices.view',
  'module.status.view'
)
WHERE r.role_key = 'user'
ON CONFLICT DO NOTHING;

INSERT INTO auth_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth_roles r
JOIN auth_permissions p ON p.permission_key IN (
  'module.dashboard.view', 'module.projects.view', 'module.invoices.view',
  'module.tax.view', 'module.analytics.view', 'module.status.view'
)
WHERE r.role_key = 'viewer'
ON CONFLICT DO NOTHING;

-- Backfill teable_email for existing Google-SSO users who signed up before
-- auto-population was added. COALESCE guard makes this a no-op on re-runs.
UPDATE auth_users u
SET    teable_email = u.email,
       updated_at   = NOW()
FROM   auth_identities i
WHERE  i.user_id   = u.id
  AND  i.provider  = 'google'
  AND  u.teable_email IS NULL;

-- ── pgvector: semantic RAG for AI assistant ──────────────────────────────
-- Enable the vector extension (requires pgvector installed in PostgreSQL).
-- Wrapped in a DO block so startup continues even if the extension is absent.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pgvector extension not available (install it in Aiven console): %', SQLERRM;
END
$$;

-- Record embeddings table — populated by the background embedding job.
-- Only created when pgvector is available; silently skipped otherwise.
DO $$
BEGIN
  CREATE TABLE IF NOT EXISTS record_embeddings (
    id           BIGSERIAL    PRIMARY KEY,
    record_id    VARCHAR(60)  NOT NULL,
    table_name   VARCHAR(60)  NOT NULL,
    content      TEXT         NOT NULL DEFAULT '',
    embedding    vector(1536),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE(record_id, table_name)
  );
  CREATE INDEX IF NOT EXISTS re_record_idx ON record_embeddings (record_id, table_name);
  CREATE INDEX IF NOT EXISTS re_table_idx  ON record_embeddings (table_name, updated_at DESC);
  -- IVFFlat index for fast cosine similarity (requires >100 rows to be useful)
  CREATE INDEX IF NOT EXISTS re_ivfflat_idx ON record_embeddings
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 20);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'record_embeddings table/index creation skipped (pgvector absent): %', SQLERRM;
END
$$;

-- AI trace log — captures timing, model, retrieval metadata per AI request
CREATE TABLE IF NOT EXISTS ai_traces (
  id            BIGSERIAL    PRIMARY KEY,
  ts            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  session_id    VARCHAR(60),
  request_id    VARCHAR(60),
  endpoint      VARCHAR(60),
  model         VARCHAR(120),
  retrieval     VARCHAR(30),   -- 'lexical' | 'hybrid' | 'vector' | 'none'
  latency_ms    INTEGER,
  prompt_tokens INTEGER,
  answer_tokens INTEGER,
  user_id       UUID,
  query_snippet TEXT,
  extra         JSONB         NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS at_ts_idx ON ai_traces (ts DESC);
CREATE INDEX IF NOT EXISTS at_session_idx ON ai_traces (session_id, ts DESC);

CREATE TABLE IF NOT EXISTS published_pages (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            VARCHAR(200) UNIQUE NOT NULL,
    title           VARCHAR(500) NOT NULL DEFAULT '',
    content_type    VARCHAR(20)  NOT NULL DEFAULT 'markdown',
    content         TEXT         NOT NULL DEFAULT '',
    is_published    BOOLEAN      NOT NULL DEFAULT FALSE,
    is_password_protected BOOLEAN NOT NULL DEFAULT FALSE,
    password_hash   TEXT,
    created_by      UUID         REFERENCES auth_users(id) ON DELETE SET NULL,
    updated_by      UUID         REFERENCES auth_users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    published_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    view_count      INTEGER      NOT NULL DEFAULT 0,
    metadata        JSONB        NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_published_pages_slug ON published_pages(slug);
CREATE INDEX IF NOT EXISTS idx_published_pages_created_by ON published_pages(created_by);

CREATE TABLE IF NOT EXISTS page_views (
    id          BIGSERIAL    PRIMARY KEY,
    page_id     UUID         NOT NULL REFERENCES published_pages(id) ON DELETE CASCADE,
    viewer_ip   TEXT,
    user_agent  TEXT,
    referer     TEXT,
    country     VARCHAR(100),
    city        VARCHAR(100),
    region      VARCHAR(100),
    isp         VARCHAR(200),
    viewer_user_id UUID      REFERENCES auth_users(id) ON DELETE SET NULL,
    viewed_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    metadata    JSONB        NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_page_views_page_id ON page_views(page_id);
CREATE INDEX IF NOT EXISTS idx_page_views_viewed_at ON page_views(viewed_at DESC);

CREATE TABLE IF NOT EXISTS page_versions (
    id           BIGSERIAL    PRIMARY KEY,
    page_id      UUID         NOT NULL REFERENCES published_pages(id) ON DELETE CASCADE,
    version_num  INTEGER      NOT NULL DEFAULT 1,
    title        VARCHAR(500) NOT NULL DEFAULT '',
    content      TEXT         NOT NULL DEFAULT '',
    content_type VARCHAR(20)  NOT NULL DEFAULT 'markdown',
    metadata     JSONB        NOT NULL DEFAULT '{}'::jsonb,
    saved_by     UUID         REFERENCES auth_users(id) ON DELETE SET NULL,
    saved_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    word_count   INTEGER      NOT NULL DEFAULT 0,
    note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_page_versions_page_id ON page_versions(page_id);
CREATE INDEX IF NOT EXISTS idx_page_versions_saved_at ON page_versions(page_id, saved_at DESC);

-- ── Studio: ask questions of your own documents ─────────────────────────────
-- Source files an author uploads and then questions in plain language. Kept
-- separate from record_embeddings on purpose: that table is keyed
-- (record_id, table_name) and is owned by the Teable sync job, which would
-- overwrite anything it did not put there.
CREATE TABLE IF NOT EXISTS studio_documents (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    title         VARCHAR(500) NOT NULL DEFAULT '',
    filename      VARCHAR(500) NOT NULL DEFAULT '',
    storage_path  TEXT         NOT NULL DEFAULT '',
    mime_type     VARCHAR(120) NOT NULL DEFAULT '',
    byte_size     BIGINT       NOT NULL DEFAULT 0,
    page_count    INTEGER      NOT NULL DEFAULT 0,
    chunk_count   INTEGER      NOT NULL DEFAULT 0,
    -- 'pending' → 'ready' | 'failed'. Ingestion runs in the background and the
    -- Space can sleep mid-job, so state lives in the row rather than in memory.
    status        VARCHAR(20)  NOT NULL DEFAULT 'pending',
    error         TEXT,
    owner_email   VARCHAR(320),
    created_by    UUID         REFERENCES auth_users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    ingested_at   TIMESTAMPTZ,
    metadata      JSONB        NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS sd_created_idx ON studio_documents (created_at DESC);
CREATE INDEX IF NOT EXISTS sd_owner_idx   ON studio_documents (owner_email);
CREATE INDEX IF NOT EXISTS sd_status_idx  ON studio_documents (status, created_at DESC);

-- Chunks carry their page number so a citation can point at somewhere real.
-- The embedding column is added separately below, because pgvector may not be
-- installed and the rest of the table must still work (lexical search only).
CREATE TABLE IF NOT EXISTS studio_doc_chunks (
    id           BIGSERIAL    PRIMARY KEY,
    document_id  UUID         NOT NULL REFERENCES studio_documents(id) ON DELETE CASCADE,
    chunk_index  INTEGER      NOT NULL DEFAULT 0,
    page_number  INTEGER,
    content      TEXT         NOT NULL DEFAULT '',
    token_est    INTEGER      NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE(document_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS sdc_doc_idx ON studio_doc_chunks (document_id, chunk_index);

-- Full-text search index. This is the primary retrieval path, not a fallback:
-- pgvector is an extension the managed Postgres plan does not offer, so the
-- vector column below may never exist. Full-text search is core Postgres, needs
-- no extension, and a GIN index makes it an index lookup rather than the
-- regex scan over every chunk that this replaced.
-- Guarded, like every other optional piece of schema in this file. The whole
-- SCHEMA string runs as one statement batch inside init_pool(); an unguarded
-- statement that raises does not skip a feature, it aborts the batch and leaves
-- the app with no pool at all. A search index is not worth that risk.
DO $$
BEGIN
  ALTER TABLE studio_doc_chunks
    ADD COLUMN IF NOT EXISTS content_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
  CREATE INDEX IF NOT EXISTS sdc_tsv_idx ON studio_doc_chunks USING GIN (content_tsv);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'studio_doc_chunks full-text column skipped: %', SQLERRM;
END
$$;

-- Embeddings stored as a plain float array, which needs no extension either.
-- Brute-force cosine over a whole corpus would be slow, so this is only ever
-- computed over the handful of candidates full-text search already narrowed to
-- — semantic ranking without an ANN index, at a cost that stays bounded.
DO $$
BEGIN
  ALTER TABLE studio_doc_chunks ADD COLUMN IF NOT EXISTS embedding_vec DOUBLE PRECISION[];

  CREATE OR REPLACE FUNCTION ft_cosine(a DOUBLE PRECISION[], b DOUBLE PRECISION[])
  RETURNS DOUBLE PRECISION AS $fn$
    SELECT COALESCE(SUM(x * y), 0)
         / NULLIF(SQRT(SUM(x * x)) * SQRT(SUM(y * y)), 0)
      FROM unnest(a, b) AS t(x, y);
  $fn$ LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'studio_doc_chunks embedding array/function skipped: %', SQLERRM;
END
$$;

-- The pgvector column stays defined when the extension happens to be present,
-- so an instance that gains it later gets the faster path with no migration.
DO $$
BEGIN
  ALTER TABLE studio_doc_chunks ADD COLUMN IF NOT EXISTS embedding vector(1536);
  CREATE INDEX IF NOT EXISTS sdc_ivfflat_idx ON studio_doc_chunks
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 20);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'studio_doc_chunks pgvector column skipped (extension absent): %', SQLERRM;
END
$$;

-- Threads keep the sources attached to the turn that used them, so an answer
-- stays auditable after the fact.
CREATE TABLE IF NOT EXISTS studio_threads (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    title       VARCHAR(500) NOT NULL DEFAULT '',
    created_by  UUID         REFERENCES auth_users(id) ON DELETE SET NULL,
    owner_email VARCHAR(320),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS st_owner_idx ON studio_threads (owner_email, updated_at DESC);

CREATE TABLE IF NOT EXISTS studio_turns (
    id         BIGSERIAL    PRIMARY KEY,
    thread_id  UUID         NOT NULL REFERENCES studio_threads(id) ON DELETE CASCADE,
    question   TEXT         NOT NULL DEFAULT '',
    answer     TEXT         NOT NULL DEFAULT '',
    model      VARCHAR(120),
    verdict    VARCHAR(20),
    sources    JSONB        NOT NULL DEFAULT '[]'::jsonb,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS stt_thread_idx ON studio_turns (thread_id, created_at);

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
