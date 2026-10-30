"""Invoices: typed columns and indexes for the server-side list.

Revision ID: 0009_invoice_query
Revises: 0008_ai_gateway_v2
Create Date: 2026-10-30

GET /api/invoices/query filters, sorts, pages and totals invoices in
Postgres instead of shipping every record to the browser. Everything it
filters or adds up has to be readable without opening `fields`: that JSONB
carries attachment URLs and long remarks, is stored out of line, and reading
it for every row of a 50,000-row table is what would make the query slow.

  * Generated columns, computed from `fields` on every write, so the sync,
    the webhook and the write-through keep them right without knowing they
    exist: client_name (Client Name, else Client), raised_by, milestone,
    outstanding_amount, agening (Teable's stored aging), doc_count (files in
    Reference and Invoice PDF), raised_at / cleared_at / followup_at (the
    instants behind the dates, for local-month grouping and aging) and
    search_text (the searchable fields, lower-cased, one per line).
  * The helpers they use are IMMUTABLE. ft_inv_ts parses only ISO text with
    an explicit or implied UTC offset, so its answer cannot depend on the
    session's TimeZone or DateStyle.
  * Partial indexes on live rows: the default order (newest raised first,
    keyset by teable_id), owner scoping on lower(raised_by), client and
    follow-up date, and a trigram index on search_text when pg_trgm can be
    installed. Without pg_trgm the search runs the same LIKE as a scan.

Plain CREATE INDEX (not CONCURRENTLY): Alembic runs each revision inside a
transaction, and the mirror is small today.
"""
from __future__ import annotations

from alembic import op

revision = "0009_invoice_query"
down_revision = "0008_ai_gateway_v2"
branch_labels = None
depends_on = None

FUNCTIONS = [
    # Text of a single-select / text / number cell; '' and blanks are NULL.
    r"""
    CREATE OR REPLACE FUNCTION ft_inv_text(v jsonb) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
      SELECT NULLIF(CASE jsonb_typeof(v)
        WHEN 'string' THEN v #>> '{}'
        WHEN 'number' THEN v #>> '{}'
        WHEN 'boolean' THEN v #>> '{}'
        WHEN 'array' THEN (
          SELECT string_agg(COALESCE(e ->> 'title', e ->> 'name', CASE WHEN jsonb_typeof(e) IN ('string', 'number') THEN e #>> '{}' END), ', ')
            FROM jsonb_array_elements(v) AS e)
        ELSE NULL END, '')
    $fn$
    """,
    # A number cell, or numeric text; anything else is NULL.
    r"""
    CREATE OR REPLACE FUNCTION ft_inv_num(v jsonb) RETURNS numeric
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
      SELECT CASE
        WHEN jsonb_typeof(v) = 'number' THEN (v #>> '{}')::numeric
        WHEN jsonb_typeof(v) = 'string' AND btrim(v #>> '{}') ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$'
          THEN btrim(v #>> '{}')::numeric
        ELSE NULL END
    $fn$
    """,
    # The instant an ISO date / date-time names. A date alone is UTC midnight,
    # as in JavaScript; a date-time without an offset is read as UTC.
    r"""
    CREATE OR REPLACE FUNCTION ft_inv_ts(v text) RETURNS timestamptz
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $fn$
    BEGIN
      IF v IS NULL THEN RETURN NULL; END IF;
      v := btrim(v);
      IF v ~ '^\d{4}-\d{2}-\d{2}$' THEN
        RETURN (v || 'T00:00:00+00:00')::timestamptz;
      ELSIF v ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$' THEN
        RETURN v::timestamptz;
      ELSIF v ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?$' THEN
        RETURN (v || '+00:00')::timestamptz;
      END IF;
      RETURN NULL;
    EXCEPTION WHEN others THEN
      RETURN NULL;
    END
    $fn$
    """,
    # Seconds since the epoch: a sort key that is the same in every time zone.
    r"""
    CREATE OR REPLACE FUNCTION ft_inv_epoch(t timestamptz) RETURNS double precision
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
      SELECT extract(epoch FROM t)::double precision
    $fn$
    """,
    # parseAttachments(cell).length in the invoices page.
    r"""
    CREATE OR REPLACE FUNCTION ft_inv_files(v jsonb) RETURNS integer
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
      SELECT CASE jsonb_typeof(v)
        WHEN 'array' THEN jsonb_array_length(v)
        WHEN 'string' THEN (
          SELECT count(*)::integer FROM (
            SELECT p, row_number() OVER () AS i
              FROM regexp_split_to_table(v #>> '{}', '\s+') AS p) parts
           WHERE i % 2 = 0 AND p <> '')
        ELSE 0 END
    $fn$
    """,
    # What the invoice search looks through, lower-cased. One field per line,
    # so a match never straddles two fields. Attachments contribute names only.
    r"""
    CREATE OR REPLACE FUNCTION ft_inv_search(f jsonb) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
      SELECT lower(concat_ws(E'\n',
        ft_inv_text(f -> 'Invoice Number'), ft_inv_text(f -> 'Client Name'), ft_inv_text(f -> 'Client'),
        ft_inv_text(f -> 'Project'), ft_inv_text(f -> 'Description'), ft_inv_text(f -> 'Category'),
        ft_inv_text(f -> 'Milestone'), ft_inv_text(f -> 'Remark'),
        CASE jsonb_typeof(f -> 'Reference')
          WHEN 'array' THEN (SELECT string_agg(COALESCE(e ->> 'name', e ->> 'filename'), E'\n')
                               FROM jsonb_array_elements(f -> 'Reference') AS e)
          WHEN 'string' THEN f ->> 'Reference'
        END))
    $fn$
    """,
]

COLUMNS = [
    "client_name text GENERATED ALWAYS AS (COALESCE(ft_inv_text(fields -> 'Client Name'), ft_inv_text(fields -> 'Client'))) STORED",
    "raised_by text GENERATED ALWAYS AS (ft_inv_text(fields -> 'Raised By')) STORED",
    "milestone text GENERATED ALWAYS AS (ft_inv_text(fields -> 'Milestone')) STORED",
    "outstanding_amount numeric GENERATED ALWAYS AS (ft_inv_num(fields -> 'Outstanding Amount')) STORED",
    "agening numeric GENERATED ALWAYS AS (ft_inv_num(fields -> 'Agening (Days)')) STORED",
    "doc_count integer GENERATED ALWAYS AS (ft_inv_files(fields -> 'Reference') + ft_inv_files(fields -> 'Invoice PDF')) STORED",
    "raised_at timestamptz GENERATED ALWAYS AS (ft_inv_ts(fields ->> 'Raised Date')) STORED",
    "cleared_at timestamptz GENERATED ALWAYS AS (ft_inv_ts(fields ->> 'Cleared Date')) STORED",
    "followup_at timestamptz GENERATED ALWAYS AS (ft_inv_ts(fields ->> 'Next followup')) STORED",
    "search_text text GENERATED ALWAYS AS (ft_inv_search(fields)) STORED",
]

TRIGRAM = r"""
DO $do$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'pg_trgm unavailable (%); invoice search runs without an index', SQLERRM;
  END;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS im_search_trgm_idx ON invoices_mirror '
            'USING gin (search_text gin_trgm_ops) WHERE deleted_at IS NULL';
  END IF;
END
$do$
"""


def upgrade() -> None:
    for sql in FUNCTIONS:
        op.execute(sql)
    op.execute("ALTER TABLE invoices_mirror " + ", ".join(f"ADD COLUMN IF NOT EXISTS {c}" for c in COLUMNS))
    op.execute(
        "CREATE INDEX IF NOT EXISTS im_live_raised_key_idx ON invoices_mirror "
        "((COALESCE(ft_inv_epoch(raised_at), '-Infinity'::double precision)) DESC, (teable_id COLLATE \"C\") DESC) "
        "WHERE deleted_at IS NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS im_live_owner_idx ON invoices_mirror (lower(raised_by)) "
        "WHERE deleted_at IS NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS im_live_client_idx ON invoices_mirror (client_name) "
        "WHERE deleted_at IS NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS im_live_followup_idx ON invoices_mirror (followup_at) "
        "WHERE deleted_at IS NULL AND followup_at IS NOT NULL"
    )
    op.execute(TRIGRAM)


def downgrade() -> None:
    for name in ("im_search_trgm_idx", "im_live_followup_idx", "im_live_client_idx",
                 "im_live_owner_idx", "im_live_raised_key_idx"):
        op.execute(f"DROP INDEX IF EXISTS {name}")
    op.execute("ALTER TABLE invoices_mirror " + ", ".join(
        f"DROP COLUMN IF EXISTS {c.split()[0]}" for c in reversed(COLUMNS)))
    for fn in ("ft_inv_search(jsonb)", "ft_inv_files(jsonb)", "ft_inv_epoch(timestamptz)",
               "ft_inv_ts(text)", "ft_inv_num(jsonb)", "ft_inv_text(jsonb)"):
        op.execute(f"DROP FUNCTION IF EXISTS {fn}")
    # pg_trgm stays: other objects may have come to rely on it.
