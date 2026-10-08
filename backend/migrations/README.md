# Schema migrations

Schema changes are Alembic revisions in `versions/`. They are applied
automatically at startup, right after the bootstrap schema, by
`app/db/migrate.py` — so a deploy is a migration. There is no separate step.

## The one rule

**New DDL goes in a revision, not in `SCHEMA`** (`app/db/postgres.py`).

The bootstrap `SCHEMA` string stays exactly as it is: it creates a usable
database from nothing and every deployed database already matches it. But it
can only ever *add* — `ADD COLUMN IF NOT EXISTS` cannot rename, drop, retype,
or add `NOT NULL` with a backfill, and it records nothing. `tests/test_schema_freeze.py`
pins its size; adding a line there fails the suite with a pointer back here.

## Adding a change

```bash
cd backend
alembic revision -m "add invoice currency index"
```

That writes `versions/<rev>_add_invoice_currency_index.py`. Fill in `upgrade()`
and `downgrade()` using plain SQL:

```python
def upgrade() -> None:
    op.execute("CREATE INDEX IF NOT EXISTS im_currency_idx ON invoices_mirror (currency)")

def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS im_currency_idx")
```

Every `upgrade` needs a working `downgrade`. A migration you cannot reverse is
one you cannot test.

## Running by hand

```bash
alembic upgrade head          # apply
alembic downgrade -1          # undo the last one
alembic current               # what the database is at
alembic upgrade head --sql    # print the SQL without connecting
```

The database URL is read from `POSTGRES_URL` via app settings; `alembic.ini`
holds none. `postgres://` and `postgresql://` are both accepted.

## What startup does

`init_pool()` runs the bootstrap `SCHEMA`, then `run_migrations()` in a worker
thread (Alembic's async env calls `asyncio.run()`, which needs no loop running).
A migration failure is logged and reported in `/health` under `migrations`,
but it does **not** stop the app: the pool is already up and the bootstrap
schema is already in place, so serving on the previous schema beats a dead
service. Fix the revision and redeploy.
