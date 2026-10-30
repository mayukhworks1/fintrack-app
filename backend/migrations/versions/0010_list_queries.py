"""Projects, tax ledger and web invoices: typed columns and indexes for their server-side lists.

Revision ID: 0010_list_queries
Revises: 0009_invoice_query
Create Date: 2026-10-30

0009 gave invoices_mirror the generated columns GET /api/invoices/query reads
instead of opening `fields` for every row. This does the same for the three
pages that still downloaded whole tables into the browser:

  * web_invoices_mirror gets the invoice columns it lacked (client_name,
    outstanding_amount, agening, doc_count, raised_at / cleared_at /
    followup_at, search_text), so GET /api/web-invoices/query runs the
    invoice query's SQL unchanged. raised_by and milestone already exist
    there as typed columns the sync writes.
  * Both invoice mirrors get currency_code (the Currency cell, RS when
    blank) and tax_client (Client Name, else Project: how the tax ledger
    groups), for the tax ledger's scope and its client breakdown.
  * projects_mirror gets health, the money columns the cards and totals add
    up, target_achieved and search_text (Project Name, Client, Project
    Status and Health, lower-cased, one per line).

Indexes are partial on live rows, as in 0009: the default order of each list
(keyset by teable_id), owner scoping, the raised day the tax periods filter
on, and trigram indexes on the search text when pg_trgm is available.

The code reads these columns only when they exist: until this runs, the
lists answer from Teable through the same rules (the fallback path).
"""
from __future__ import annotations

from alembic import op

revision = "0010_list_queries"
down_revision = "0009_invoice_query"
branch_labels = None
depends_on = None

FUNCTIONS = [
    # What the project search looks through, lower-cased, one field per line.
    r"""
    CREATE OR REPLACE FUNCTION ft_prj_search(f jsonb) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
      SELECT lower(concat_ws(E'\n',
        ft_inv_text(f -> 'Project Name'), ft_inv_text(f -> 'Client'),
        ft_inv_text(f -> 'Project Status'), ft_inv_text(f -> 'Health')))
    $fn$
    """,
    # Python truthiness of a cell (a checkbox, a formula's 0/1, some text).
    r"""
    CREATE OR REPLACE FUNCTION ft_truthy(v jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
      SELECT CASE jsonb_typeof(v)
        WHEN 'boolean' THEN (v #>> '{}')::boolean
        WHEN 'number' THEN (v #>> '{}')::numeric <> 0
        WHEN 'string' THEN (v #>> '{}') <> ''
        WHEN 'array' THEN jsonb_array_length(v) > 0
        WHEN 'object' THEN v <> '{}'::jsonb
        ELSE false END
    $fn$
    """,
]

_CURRENCY = "currency_code text GENERATED ALWAYS AS (COALESCE(ft_inv_text(fields -> 'Currency'), 'RS')) STORED"
_TAX_CLIENT = ("tax_client text GENERATED ALWAYS AS (COALESCE(ft_inv_text(fields -> 'Client Name'), "
               "ft_inv_text(fields -> 'Project'), 'Unknown')) STORED")

INVOICE_COLUMNS = [_CURRENCY, _TAX_CLIENT]

# 0009's invoice columns, less raised_by and milestone (typed columns already).
WEB_INVOICE_COLUMNS = [
    "client_name text GENERATED ALWAYS AS (COALESCE(ft_inv_text(fields -> 'Client Name'), ft_inv_text(fields -> 'Client'))) STORED",
    "outstanding_amount numeric GENERATED ALWAYS AS (ft_inv_num(fields -> 'Outstanding Amount')) STORED",
    "agening numeric GENERATED ALWAYS AS (ft_inv_num(fields -> 'Agening (Days)')) STORED",
    "doc_count integer GENERATED ALWAYS AS (ft_inv_files(fields -> 'Reference') + ft_inv_files(fields -> 'Invoice PDF')) STORED",
    "raised_at timestamptz GENERATED ALWAYS AS (ft_inv_ts(fields ->> 'Raised Date')) STORED",
    "cleared_at timestamptz GENERATED ALWAYS AS (ft_inv_ts(fields ->> 'Cleared Date')) STORED",
    "followup_at timestamptz GENERATED ALWAYS AS (ft_inv_ts(fields ->> 'Next followup')) STORED",
    "search_text text GENERATED ALWAYS AS (ft_inv_search(fields)) STORED",
    _CURRENCY,
    _TAX_CLIENT,
]

PROJECT_COLUMNS = [
    "health text GENERATED ALWAYS AS (ft_inv_text(fields -> 'Health')) STORED",
    "billed_amount numeric GENERATED ALWAYS AS (ft_inv_num(fields -> 'Amount Billed So far')) STORED",
    "profit_amount numeric GENERATED ALWAYS AS (ft_inv_num(fields -> 'Actual Profit')) STORED",
    "profit_percent numeric GENERATED ALWAYS AS (ft_inv_num(fields -> 'Profit percentage')) STORED",
    "input_cost numeric GENERATED ALWAYS AS (ft_inv_num(fields -> 'Input cost so far')) STORED",
    "overhead_cost numeric GENERATED ALWAYS AS (ft_inv_num(fields -> 'Total Overhead Cost')) STORED",
    "target_revenue numeric GENERATED ALWAYS AS (ft_inv_num(fields -> 'Target Revenue')) STORED",
    "target_achieved boolean GENERATED ALWAYS AS (ft_truthy(fields -> 'Target Achieved ')) STORED",
    "search_text text GENERATED ALWAYS AS (ft_prj_search(fields)) STORED",
]

INDEXES = [
    # Web invoices: the default order (newest raised first), owner scoping,
    # follow-ups, and the raised day the tax periods filter on.
    "CREATE INDEX IF NOT EXISTS wim_live_raised_key_idx ON web_invoices_mirror "
    "((COALESCE(ft_inv_epoch(raised_at), '-Infinity'::double precision)) DESC, (teable_id COLLATE \"C\") DESC) "
    "WHERE deleted_at IS NULL",
    "CREATE INDEX IF NOT EXISTS wim_live_owner_idx ON web_invoices_mirror (lower(raised_by)) WHERE deleted_at IS NULL",
    "CREATE INDEX IF NOT EXISTS wim_live_followup_idx ON web_invoices_mirror (followup_at) "
    "WHERE deleted_at IS NULL AND followup_at IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS wim_live_raised_day_idx ON web_invoices_mirror (raised_date) WHERE deleted_at IS NULL",
    "CREATE INDEX IF NOT EXISTS im_live_raised_day_idx ON invoices_mirror (raised_date) WHERE deleted_at IS NULL",
    # Projects: the default order (most billed first) and the filters.
    "CREATE INDEX IF NOT EXISTS pm_live_billed_key_idx ON projects_mirror "
    "((COALESCE(billed_amount::double precision, '-Infinity'::double precision)) DESC, (teable_id COLLATE \"C\") DESC) "
    "WHERE deleted_at IS NULL",
    "CREATE INDEX IF NOT EXISTS pm_live_status_idx ON projects_mirror (status) WHERE deleted_at IS NULL",
    "CREATE INDEX IF NOT EXISTS pm_live_client_idx ON projects_mirror (client) WHERE deleted_at IS NULL",
]
INDEX_NAMES = ["wim_live_raised_key_idx", "wim_live_owner_idx", "wim_live_followup_idx", "wim_live_raised_day_idx",
               "im_live_raised_day_idx", "pm_live_billed_key_idx", "pm_live_status_idx", "pm_live_client_idx"]

TRIGRAM = r"""
DO $do$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'pg_trgm unavailable (%); web invoice and project search run without an index', SQLERRM;
  END;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS wim_search_trgm_idx ON web_invoices_mirror '
            'USING gin (search_text gin_trgm_ops) WHERE deleted_at IS NULL';
    EXECUTE 'CREATE INDEX IF NOT EXISTS pm_search_trgm_idx ON projects_mirror '
            'USING gin (search_text gin_trgm_ops) WHERE deleted_at IS NULL';
  END IF;
END
$do$
"""


def _add(table: str, columns: list[str]) -> str:
    return f"ALTER TABLE {table} " + ", ".join(f"ADD COLUMN IF NOT EXISTS {c}" for c in columns)


def _drop(table: str, columns: list[str]) -> str:
    return f"ALTER TABLE {table} " + ", ".join(f"DROP COLUMN IF EXISTS {c.split()[0]}" for c in reversed(columns))


def upgrade() -> None:
    for sql in FUNCTIONS:
        op.execute(sql)
    op.execute(_add("invoices_mirror", INVOICE_COLUMNS))
    op.execute(_add("web_invoices_mirror", WEB_INVOICE_COLUMNS))
    op.execute(_add("projects_mirror", PROJECT_COLUMNS))
    for sql in INDEXES:
        op.execute(sql)
    op.execute(TRIGRAM)


def downgrade() -> None:
    for name in ["pm_search_trgm_idx", "wim_search_trgm_idx"] + list(reversed(INDEX_NAMES)):
        op.execute(f"DROP INDEX IF EXISTS {name}")
    op.execute(_drop("projects_mirror", PROJECT_COLUMNS))
    op.execute(_drop("web_invoices_mirror", WEB_INVOICE_COLUMNS))
    op.execute(_drop("invoices_mirror", INVOICE_COLUMNS))
    for fn in ("ft_truthy(jsonb)", "ft_prj_search(jsonb)"):
        op.execute(f"DROP FUNCTION IF EXISTS {fn}")
