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
    source      VARCHAR(20)  NOT NULL,
    total       INTEGER      NOT NULL DEFAULT 0,
    created     INTEGER      NOT NULL DEFAULT 0,
    updated     INTEGER      NOT NULL DEFAULT 0,
    unchanged   INTEGER      NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    error       TEXT,
    details     JSONB        NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;

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
    metadata            JSONB        NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT auth_users_status_chk CHECK (status IN ('pending_approval', 'active', 'rejected', 'disabled'))
);
CREATE INDEX IF NOT EXISTS au_status_idx ON auth_users (status, created_at DESC);
CREATE INDEX IF NOT EXISTS au_email_norm_idx ON auth_users (email_normalized);

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
    metadata      JSONB        NOT NULL DEFAULT '{}'::jsonb
);
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
  'module.shared.manage', 'module.admin.view', 'module.admin.audit.view', 'system.sync.trigger'
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
  'module.ai.use', 'module.status.view', 'module.status.edit'
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
  'module.dashboard.view', 'module.projects.view', 'module.invoices.view',
  'module.status.view', 'module.ai.use'
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
