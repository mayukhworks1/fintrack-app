"""
Databases: typed rows over the page tree (services/databases.py).

  GET    /api/databases/templates                 templates to start from
  GET    /api/databases/people                    names for person properties
  POST   /api/databases                           create (optionally from a template)
  GET    /api/databases/row-context/{page_id}     the database a row page belongs to
  GET    /api/databases/{id}                      the database page and its schema
                                                  (?rows=1: and the first page of rows)
  PUT    /api/databases/{id}/schema               properties, views, default view
  PUT    /api/databases/{id}/views/{view_id}      add or replace one view
  DELETE /api/databases/{id}/views/{view_id}      remove one view
  POST   /api/databases/{id}/query                rows: filter, sort, page
  POST   /api/databases/{id}/rows                 add a row
  PATCH  /api/databases/{id}/rows/{row_id}        update one row
  POST   /api/databases/{id}/rows/bulk            update many rows (board drag)
  POST   /api/databases/{id}/rows/delete          move rows to the trash
  POST   /api/databases/{id}/rows/publish         publish / unpublish every row
  GET    /api/databases/{id}/export.csv           CSV export
  POST   /api/databases/{id}/import               CSV import with a column mapping

Ownership is the pages router's: a superadmin reaches every database and row,
everyone else the ones they created. A row is a child page of the database;
trashed rows are never listed.

Concurrency. The schema lives on the database page, each row's values on the
row page. A write of row values takes a share lock on the database page and
merges into the stored values in SQL (jsonb ||), so two people editing
different cells of one row both keep their edit, and a value is always checked
against the schema as it stands when it is written: a schema change takes the
exclusive lock and waits for them, and they wait for it. Every schema write
bumps database.revision; a client that sends the revision it loaded gets a 409
instead of overwriting a newer schema.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from ..db import valkey as vk
from ..db.postgres import get_pool
from ..services import collab
from ..services import databases as D
from ..services import page_tree as T
from .deps import require_auth
from .pages import PageId, _can_see_all, _owns_page, _page_uuid, _random_suffix, _slugify


def _db_uuid(db_id: str) -> str:
    """Path dependency for {db_id}; PageId reads a parameter named page_id."""
    return _page_uuid(db_id)


DbId = Annotated[str, Depends(_db_uuid)]

router = APIRouter()


class CreateDatabaseBody(BaseModel):
    title: str = "Untitled database"
    template: str = "blank"
    parent_id: str | None = None


class SchemaBody(BaseModel):
    properties: list
    views: list | None = None
    default_view: str | None = None
    row_type: str | None = None
    # The schema revision the client loaded (database.revision). When given
    # and stale, nothing is written: 409 with the current schema.
    revision: int | None = None
    # Property ids to remove. When this or revision is sent, a property is
    # removed only if listed here: one left out of `properties` (a tab with
    # an older copy of the schema) is kept. Older clients that send neither
    # keep the previous meaning (left out = removed).
    deleted: list[str] | None = None


class ViewBody(BaseModel):
    view: dict
    revision: int | None = None
    make_default: bool = False


class QueryBody(BaseModel):
    view_id: str | None = None
    filter: dict | None = None
    sort: list | None = None
    search: str | None = None
    limit: int = 100
    offset: int = 0
    # Also return the database (as GET /api/databases/{id}) in "database".
    include_database: bool = False


class RowBody(BaseModel):
    title: str = ""
    props: dict | None = None
    icon: str | None = None
    position: float | None = None
    content_type: str | None = None


class RowPatchBody(BaseModel):
    title: str | None = None
    props: dict | None = None
    icon: str | None = None
    position: float | None = None


class BulkItem(BaseModel):
    id: str
    title: str | None = None
    props: dict | None = None
    position: float | None = None


class BulkBody(BaseModel):
    updates: list[BulkItem]


class IdsBody(BaseModel):
    ids: list[str]


class PublishRowsBody(BaseModel):
    published: bool


class ImportBody(BaseModel):
    csv: str
    mapping: list
    has_header: bool = True
    # Idempotency key chosen by the client for this import. A retry with the
    # same id (a timed-out request sent again) creates nothing and answers
    # like the first one, with "duplicate": true.
    import_id: str | None = None


MAX_MAPPING = 200
# Import ids remembered per database.
IMPORT_IDS_KEPT = 20


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _who(request: Request, role: str) -> tuple[str | None, str]:
    return getattr(request.state, "auth_user_id", None), (getattr(request.state, "auth_role", role) or role)


def _owns(row: Any, user_id: str | None, auth_role: str) -> bool:
    return _owns_page(row, user_id, auth_role)


def _pool():
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")
    return pool


def _bad(exc: D.SchemaError) -> HTTPException:
    return HTTPException(422, str(exc))


def _uuid(value: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        raise HTTPException(422, "Not a valid row id")


async def _ready(conn) -> None:
    if not await T.tree_ready(conn):
        raise HTTPException(503, T.NOT_READY)


def _revision(metadata: Any) -> int:
    db = D._as_dict(metadata).get("database")
    rev = db.get("revision") if isinstance(db, dict) else None
    return rev if isinstance(rev, int) and not isinstance(rev, bool) else 0


def _with_rev(schema: dict, rev: int) -> dict:
    return {**schema, "revision": rev}


async def _load_db(conn, db_id: str, user_id, auth_role, *, writing: bool = False,
                   lock: str = "") -> tuple[Any, dict]:
    """The database page and its schema. lock is "" or a row lock clause
    ("FOR SHARE" for row writes, "FOR UPDATE" for schema writes); with a
    lock it must run inside a transaction."""
    row = await conn.fetchrow(
        "SELECT id, slug, title, icon, cover, content_type, is_published, metadata, "
        f"created_by, deleted_at, parent_id, updated_at FROM published_pages WHERE id = $1 {lock}",
        db_id,
    )
    if not row:
        raise HTTPException(404, "Database not found")
    if not _owns(row, user_id, auth_role):
        raise HTTPException(403, "Access denied")
    if row["content_type"] != D.CONTENT_TYPE:
        raise HTTPException(409, "This page is not a database")
    if writing and T.is_trashed(row):
        raise HTTPException(409, "The database is in the trash")
    return row, D.schema_of(row["metadata"])


def _db_dict(row: Any, schema: dict) -> dict:
    return {
        "id": str(row["id"]), "slug": row["slug"], "title": row["title"] or "",
        "icon": T.field(row, "icon"), "cover": T.field(row, "cover"),
        "is_published": bool(row["is_published"]),
        "parent_id": str(row["parent_id"]) if T.field(row, "parent_id") else None,
        "database": _with_rev(schema, _revision(row["metadata"])),
    }


async def _unique_slug(conn, title: str) -> str:
    base = _slugify(title or "row") or "row"
    taken = await conn.fetchval("SELECT id FROM published_pages WHERE slug = $1", base)
    return f"{base}-{_random_suffix()}" if taken else base


async def _save_schema(conn, db_id: str, schema: dict, user_id, rev: int,
                       imports: dict | None = None) -> dict:
    """Write the schema (and the import ids) into the database page's
    metadata in place, leaving every other key as stored. Returns the schema
    with its new revision."""
    out = _with_rev(schema, rev + 1)
    if imports is None:
        await conn.execute(
            "UPDATE published_pages SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), "
            "'{database}', $1::jsonb), updated_at = $2, updated_by = $3 WHERE id = $4",
            json.dumps(out), datetime.now(timezone.utc), user_id, db_id,
        )
    else:
        await conn.execute(
            "UPDATE published_pages SET metadata = jsonb_set(jsonb_set(COALESCE(metadata, '{}'::jsonb), "
            "'{database}', $1::jsonb), '{imports}', $5::jsonb), updated_at = $2, updated_by = $3 WHERE id = $4",
            json.dumps(out), datetime.now(timezone.utc), user_id, db_id, json.dumps(imports),
        )
    return out


async def _insert_row(conn, db_id: str, title: str, props: dict, user_id, content_type: str,
                      position: float | None = None, icon: str | None = None) -> Any:
    slug = await _unique_slug(conn, title)
    return await conn.fetchrow(
        "INSERT INTO published_pages "
        "  (slug, title, content_type, content, metadata, created_by, updated_by, parent_id, position, icon) "
        "VALUES ($1, $2, $3, '', $4::jsonb, $5, $5, $6, "
        "        COALESCE($7::float8, EXTRACT(EPOCH FROM clock_timestamp())), $8) "
        f"RETURNING {D.ROW_COLS.replace('p.', '')}, metadata",
        slug, title[:500], content_type, json.dumps({"props": props, "db_row": db_id}),
        user_id, db_id, position, icon,
    )


async def _load_row(conn, db_id: str, row_id: str, user_id, auth_role) -> Any:
    row = await conn.fetchrow(
        "SELECT id, parent_id, created_by, deleted_at, metadata, title FROM published_pages WHERE id = $1",
        row_id,
    )
    if not row or str(row["parent_id"]) != str(db_id) or T.is_trashed(row):
        raise HTTPException(404, "Row not found")
    if not _owns(row, user_id, auth_role):
        raise HTTPException(403, "Access denied")
    return row


async def _explain_missing(conn, db_id: str, ids: list[str], user_id, auth_role) -> HTTPException:
    """Why some of these rows could not be written: 404 or 403, as one-by-one
    loading would have said."""
    found = {str(r["id"]): r for r in await conn.fetch(
        "SELECT id, parent_id, created_by, deleted_at FROM published_pages WHERE id = ANY($1::uuid[])", ids)}
    for i in ids:
        r = found.get(i)
        if not r or str(r["parent_id"]) != str(db_id) or T.is_trashed(r):
            return HTTPException(404, "Row not found")
    for i in ids:
        if not _owns(found[i], user_id, auth_role):
            return HTTPException(403, "Access denied")
    return HTTPException(409, "The rows changed while saving; try again")


def _icon(value: str | None) -> str | None:
    icon = (value or "").strip()
    if len(icon) > 16 or any(c in icon for c in "<>\"'&"):
        raise HTTPException(422, "Icon must be a single emoji")
    return icon or None


def _split_props(schema: dict, props: Any) -> tuple[dict, list[str]]:
    """Validated values to set, and property ids to clear (sent as null)."""
    try:
        clean = D.clean_props(schema, props)
    except D.SchemaError as exc:
        raise _bad(exc)
    return ({k: v for k, v in clean.items() if v is not None},
            [k for k, v in clean.items() if v is None])


# Merge values into a row's stored props in SQL: what another writer stored
# meanwhile under other keys survives.
_MERGE_PROPS = (
    "jsonb_set(COALESCE(p.metadata, '{{}}'::jsonb), '{{props}}', "
    "(CASE WHEN jsonb_typeof(p.metadata->'props') = 'object' THEN p.metadata->'props' ELSE '{{}}'::jsonb END "
    "|| COALESCE({set}, '{{}}'::jsonb)) - COALESCE({drop}, '{{}}'::text[]))"
)

_ROW_RETURNING = f"{D.ROW_COLS}, p.metadata"


def _row_out(row: Any, schema: dict) -> dict:
    d = dict(row)
    if "props" not in d or d["props"] is None:
        d["props"] = D.props_of(d.get("metadata"))
    return D.row_dict(d, schema)


def _scope_sql(auth_role: str, user_id, n: int, col: str = "p.created_by") -> tuple[str, list]:
    if _can_see_all(auth_role):
        return "", []
    return f" AND {col} = ${n}", [user_id]


# ---------------------------------------------------------------------------
# Public rows cache
# ---------------------------------------------------------------------------

PUBLIC_CACHE_TTL = 30


def _pub_key(db_id: Any) -> str:
    return f"pubdb:{db_id}"


async def invalidate_public_rows(db_id: Any) -> None:
    """Drop the public viewer's cached rows of a database (a row or the
    schema changed). One SET of a stale marker, sent without waiting; the
    cache's TTL bounds anything this misses."""
    if not db_id or vk.get_client() is None:
        return

    async def _go():
        try:
            await vk.cache_set(_pub_key(db_id), {"stale": True}, PUBLIC_CACHE_TTL)
        except Exception:
            pass

    asyncio.get_running_loop().create_task(_go())


# ---------------------------------------------------------------------------
# Catalogue
# ---------------------------------------------------------------------------

@router.get("/api/databases/templates")
async def database_templates(role: str = Depends(require_auth)):
    return D.template_list()


@router.get("/api/databases/people")
async def database_people(role: str = Depends(require_auth)):
    """Display names of active accounts, for person properties. Names only:
    no email addresses or ids leave the server through here."""
    pool = _pool()
    async with pool.acquire() as conn:
        try:
            rows = await conn.fetch(
                "SELECT full_name, email FROM auth_users "
                "WHERE status = 'active' AND disabled_at IS NULL ORDER BY full_name NULLS LAST LIMIT 500"
            )
        except Exception:
            return []
    names = []
    for r in rows:
        name = (r["full_name"] or "").strip() or (r["email"] or "").split("@")[0]
        if name and name not in names:
            names.append(name)
    return [{"name": n} for n in names]


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

@router.post("/api/databases")
async def create_database(body: CreateDatabaseBody, request: Request, role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    try:
        schema, samples, icon = D.template(body.template or "blank")
    except D.SchemaError as exc:
        raise _bad(exc)
    title = (body.title or "").strip()[:500] or "Untitled database"
    parent_id = _uuid(body.parent_id) if body.parent_id else None
    pool = _pool()
    async with pool.acquire() as conn:
        await _ready(conn)
        if parent_id:
            parent = await conn.fetchrow(
                "SELECT id, created_by, deleted_at FROM published_pages WHERE id = $1", parent_id)
            if not parent:
                raise HTTPException(404, "Parent page not found")
            if not _owns(parent, user_id, auth_role):
                raise HTTPException(403, "Access denied")
            if T.is_trashed(parent):
                raise HTTPException(409, "The parent page is in the trash")
        async with conn.transaction():
            slug = await _unique_slug(conn, title)
            page = await conn.fetchrow(
                "INSERT INTO published_pages "
                "  (slug, title, content_type, content, metadata, created_by, updated_by, parent_id, icon) "
                "VALUES ($1, $2, $3, '', $4::jsonb, $5, $5, $6, $7) "
                "RETURNING id, slug, title, icon, cover, content_type, is_published, metadata, "
                "          created_by, deleted_at, parent_id",
                slug, title, D.CONTENT_TYPE, json.dumps({"database": schema}), user_id, parent_id, icon,
            )
            for i, (rtitle, props) in enumerate(samples):
                await _insert_row(conn, str(page["id"]), rtitle, D.clean_props(schema, props), user_id,
                                  schema["row_type"], position=float((i + 1) * 1024))
    return _db_dict(page, schema)


@router.get("/api/databases/row-context/{page_id}")
async def row_context(page_id: PageId, request: Request, role: str = Depends(require_auth)):
    """For the page editor: if this page is a row, its database and values."""
    user_id, auth_role = _who(request, role)
    pool = _pool()
    async with pool.acquire() as conn:
        if not await T.tree_ready(conn):
            return {"database": None}
        row = await conn.fetchrow(
            "SELECT p.id, p.slug, p.title, p.icon, p.cover, p.content_type, p.is_published, p.expires_at, "
            "       p.created_at, p.updated_at, p.position, p.created_by, p.metadata, "
            "       d.id AS db_id, d.title AS db_title, d.icon AS db_icon, d.metadata AS db_metadata, "
            "       d.content_type AS db_type, d.created_by AS db_owner "
            "  FROM published_pages p LEFT JOIN published_pages d ON d.id = p.parent_id "
            " WHERE p.id = $1",
            page_id,
        )
    if not row:
        raise HTTPException(404, "Page not found")
    if not _owns(row, user_id, auth_role):
        raise HTTPException(403, "Access denied")
    if row["db_type"] != D.CONTENT_TYPE or not _owns({"created_by": row["db_owner"]}, user_id, auth_role):
        return {"database": None}
    schema = D.schema_of(row["db_metadata"])
    return {
        "database": {"id": str(row["db_id"]), "title": row["db_title"] or "", "icon": row["db_icon"],
                     "database": _with_rev(schema, _revision(row["db_metadata"]))},
        "row": _row_out(row, schema),
    }


def _query_plan(body: QueryBody, schema: dict) -> tuple[dict | None, list]:
    view = next((v for v in schema["views"] if v["id"] == body.view_id), None)
    if body.view_id and view is None:
        raise HTTPException(404, "View not found")
    try:
        flt = D.normalize_filter(body.filter, schema) if body.filter is not None else (view or {}).get("filter")
        sort = D.normalize_sort(body.sort, schema) if body.sort is not None else (view or {}).get("sort", [])
    except D.SchemaError as exc:
        raise _bad(exc)
    return flt, sort


async def _run_query(conn, db_id: str, schema: dict, body: QueryBody, user_id, auth_role) -> dict:
    flt, sort = _query_plan(body, schema)
    sql, args = D.build_rows_query(
        db_id, schema, flt, sort, body.limit, body.offset,
        owner=None if _can_see_all(auth_role) else user_id, search=body.search,
    )
    rows = await conn.fetch(sql, *args)
    total = rows[0]["total_count"] if rows else 0
    return {
        "rows": [D.row_dict(r, schema) for r in rows],
        "total": total,
        "limit": max(1, min(body.limit, D.MAX_PAGE)),
        "offset": max(0, body.offset),
    }


@router.get("/api/databases/{db_id}")
async def get_database(db_id: DbId, request: Request, role: str = Depends(require_auth),
                       rows: bool = False, view_id: str | None = None, limit: int = 100):
    """The database and its schema. With ?rows=1, also "query": the first page
    of rows of view_id (or the default view), exactly as POST .../query
    answers, so opening a database is one request."""
    user_id, auth_role = _who(request, role)
    async with _pool().acquire() as conn:
        row, schema = await _load_db(conn, db_id, user_id, auth_role)
        out = _db_dict(row, schema)
        if rows and await T.tree_ready(conn):
            body = QueryBody(view_id=view_id or schema["default_view"], limit=limit)
            out["query"] = await _run_query(conn, db_id, schema, body, user_id, auth_role)
    return out


def _schema_conflict(row: Any, schema: dict) -> HTTPException:
    return HTTPException(409, {
        "code": "conflict",
        "message": "The database was changed in another tab or by someone else. "
                   "Reload it to see the latest columns and views.",
        "database": _with_rev(schema, _revision(row["metadata"])),
    })


@router.put("/api/databases/{db_id}/schema")
async def update_schema(db_id: DbId, body: SchemaBody, request: Request, role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    async with _pool().acquire() as conn:
        await _ready(conn)
        async with conn.transaction():
            # Under the database's row lock: row writes (share lock) wait,
            # so no value is written against a schema that is going away.
            row, old = await _load_db(conn, db_id, user_id, auth_role, writing=True, lock="FOR UPDATE")
            rev = _revision(row["metadata"])
            if body.revision is not None and body.revision != rev:
                raise _schema_conflict(row, old)
            raw = body.model_dump(exclude={"revision", "deleted"})
            if raw.get("views") is None:
                raw["views"] = old["views"]
            if raw.get("row_type") is None:
                raw["row_type"] = old["row_type"]
            strict = body.revision is not None or body.deleted is not None
            if strict:
                # Only properties named in `deleted` go; one simply missing
                # from this copy of the schema is kept where it was.
                deleted = set(body.deleted or [])
                sent = {p.get("id") for p in raw["properties"] if isinstance(p, dict)}
                raw["properties"] = [p for p in raw["properties"]
                                     if not (isinstance(p, dict) and p.get("id") in deleted)]
                raw["properties"] += [p for p in old["properties"]
                                      if p["id"] not in sent and p["id"] not in deleted]
            try:
                new = D.normalize_schema(raw)
            except D.SchemaError as exc:
                raise _bad(exc)

            old_by = {p["id"]: p for p in old["properties"]}
            changed = []
            for p in new["properties"]:
                o = old_by.get(p["id"])
                if o is None:
                    continue
                if o["type"] != p["type"]:
                    changed.append((o, p))
                elif p["type"] in ("select", "multi_select") and \
                        {x["id"] for x in o.get("options", [])} - {x["id"] for x in p.get("options", [])}:
                    changed.append((o, p))
            dropped = set(old_by) - {p["id"] for p in new["properties"]}

            if changed or dropped:
                rows = await conn.fetch(
                    "SELECT id, metadata->'props' AS props FROM published_pages WHERE parent_id = $1", db_id
                )
                current = [D._as_dict(r["props"]) for r in rows]
                # Retyped into a select: one option per distinct old value, as
                # a spreadsheet column turned into a dropdown would expect.
                for o, p in changed:
                    if p["type"] in ("select", "multi_select") and o["type"] not in ("select", "multi_select"):
                        D.add_options_for(p, (D.value_text(o, props.get(o["id"])) for props in current))
                try:
                    new = D.normalize_schema(new)
                except D.SchemaError as exc:
                    raise _bad(exc)
                converted = D.convert_props(old, new, current)
                updates = {str(r["id"]): props for r, cur, props in zip(rows, current, converted) if props != cur}
                if updates:
                    # Every converted row in one statement.
                    await conn.execute(
                        "UPDATE published_pages p SET metadata = jsonb_set(COALESCE(p.metadata, '{}'::jsonb), "
                        "'{props}', u.value) FROM jsonb_each($1::jsonb) AS u WHERE p.id = u.key::uuid",
                        json.dumps(updates),
                    )
            saved = await _save_schema(conn, db_id, new, user_id, rev)
    await invalidate_public_rows(db_id)
    return {"database": saved}


@router.put("/api/databases/{db_id}/views/{view_id}")
async def put_view(db_id: DbId, view_id: str, body: ViewBody, request: Request,
                   role: str = Depends(require_auth)):
    """Add or replace one view (its filter, sort, columns...). Nothing else in
    the schema is touched, so a view tweak from a tab with an older schema
    cannot undo someone's property changes."""
    user_id, auth_role = _who(request, role)
    async with _pool().acquire() as conn:
        await _ready(conn)
        async with conn.transaction():
            row, schema = await _load_db(conn, db_id, user_id, auth_role, writing=True, lock="FOR UPDATE")
            rev = _revision(row["metadata"])
            if body.revision is not None and body.revision != rev:
                raise _schema_conflict(row, schema)
            view = {**(body.view or {}), "id": view_id}
            views = [v for v in schema["views"] if v["id"] != view_id]
            at = next((i for i, v in enumerate(schema["views"]) if v["id"] == view_id), len(views))
            views.insert(at, view)
            raw = {**schema, "views": views}
            if body.make_default:
                raw["default_view"] = view_id
            try:
                new = D.normalize_schema(raw)
            except D.SchemaError as exc:
                raise _bad(exc)
            saved = await _save_schema(conn, db_id, new, user_id, rev)
    return {"database": saved, "view": next(v for v in saved["views"] if v["id"] == view_id)}


@router.delete("/api/databases/{db_id}/views/{view_id}")
async def delete_view(db_id: DbId, view_id: str, request: Request, revision: int | None = None,
                      role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    async with _pool().acquire() as conn:
        await _ready(conn)
        async with conn.transaction():
            row, schema = await _load_db(conn, db_id, user_id, auth_role, writing=True, lock="FOR UPDATE")
            rev = _revision(row["metadata"])
            if revision is not None and revision != rev:
                raise _schema_conflict(row, schema)
            views = [v for v in schema["views"] if v["id"] != view_id]
            if len(views) == len(schema["views"]):
                raise HTTPException(404, "View not found")
            if not views:
                raise HTTPException(409, "A database keeps at least one view")
            try:
                new = D.normalize_schema({**schema, "views": views})
            except D.SchemaError as exc:
                raise _bad(exc)
            saved = await _save_schema(conn, db_id, new, user_id, rev)
    return {"database": saved}


@router.post("/api/databases/{db_id}/query")
async def query_rows(db_id: DbId, body: QueryBody, request: Request, role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    async with _pool().acquire() as conn:
        await _ready(conn)
        row, schema = await _load_db(conn, db_id, user_id, auth_role)
        out = await _run_query(conn, db_id, schema, body, user_id, auth_role)
    if body.include_database:
        out["database"] = _db_dict(row, schema)
    return out


# ---------------------------------------------------------------------------
# Rows
# ---------------------------------------------------------------------------

@router.post("/api/databases/{db_id}/rows")
async def create_row(db_id: DbId, body: RowBody, request: Request, role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    async with _pool().acquire() as conn:
        await _ready(conn)
        async with conn.transaction():
            _db, schema = await _load_db(conn, db_id, user_id, auth_role, writing=True, lock="FOR SHARE")
            try:
                props = {k: v for k, v in D.clean_props(schema, body.props).items() if v is not None}
            except D.SchemaError as exc:
                raise _bad(exc)
            ctype = body.content_type if body.content_type in D.ROW_TYPES else schema["row_type"]
            row = await _insert_row(conn, db_id, (body.title or "").strip(), props, user_id, ctype,
                                    position=body.position, icon=_icon(body.icon))
    await invalidate_public_rows(db_id)
    return _row_out(row, schema)


@router.patch("/api/databases/{db_id}/rows/{row_id}")
async def update_row(db_id: DbId, row_id: str, body: RowPatchBody, request: Request,
                     role: str = Depends(require_auth)):
    """One row's title, values, place or icon. Values are merged into what is
    stored in the same UPDATE, so concurrent edits of other cells survive."""
    user_id, auth_role = _who(request, role)
    row_id = _uuid(row_id)
    icon_set = "icon" in body.model_fields_set
    icon = _icon(body.icon) if icon_set else None
    async with _pool().acquire() as conn:
        await _ready(conn)
        async with conn.transaction():
            _db, schema = await _load_db(conn, db_id, user_id, auth_role, writing=True, lock="FOR SHARE")
            args: list[Any] = [row_id, db_id, datetime.now(timezone.utc), user_id]
            sets = ["updated_at = $3", "updated_by = $4"]
            if body.title is not None:
                args.append(str(body.title)[:500])
                sets.append(f"title = ${len(args)}")
            if body.props is not None:
                set_props, drop = _split_props(schema, body.props)
                args += [json.dumps(set_props), drop]
                sets.append("metadata = " + _MERGE_PROPS.format(
                    set=f"${len(args) - 1}::jsonb", drop=f"${len(args)}::text[]"))
            if body.position is not None:
                args.append(float(body.position))
                sets.append(f"position = ${len(args)}")
            if icon_set:
                args.append(icon)
                sets.append(f"icon = ${len(args)}")
            scope, sargs = _scope_sql(auth_role, user_id, len(args) + 1)
            updated = await conn.fetchrow(
                f"UPDATE published_pages p SET {', '.join(sets)} "
                f"WHERE p.id = $1 AND p.parent_id = $2 AND p.deleted_at IS NULL{scope} "
                f"RETURNING {_ROW_RETURNING}",
                *args, *sargs,
            )
            if not updated:
                raise await _explain_missing(conn, db_id, [row_id], user_id, auth_role)
    await invalidate_public_rows(db_id)
    return _row_out(updated, schema)


@router.post("/api/databases/{db_id}/rows/bulk")
async def bulk_update_rows(db_id: DbId, body: BulkBody, request: Request, role: str = Depends(require_auth)):
    """Several rows at once, all or nothing, in one UPDATE: a card dragged to
    another column changes its group and its place, and its new neighbours
    may be renumbered."""
    user_id, auth_role = _who(request, role)
    if len(body.updates) > D.MAX_PAGE:
        raise HTTPException(422, f"At most {D.MAX_PAGE} rows per request")
    # One entry per row, in first-seen order; a row named twice gets both
    # changes, later ones winning, as applying them one by one would.
    merged: dict[str, dict] = {}
    for item in body.updates:
        rid = _uuid(item.id)
        m = merged.setdefault(rid, {"id": rid, "has_title": False, "title": None, "props": None, "position": None})
        if item.title is not None:
            m["has_title"], m["title"] = True, str(item.title)[:500]
        if item.props is not None:
            m["props"] = {**(m["props"] or {}), **item.props}
        if item.position is not None:
            m["position"] = float(item.position)
    if not merged:
        return {"rows": []}
    async with _pool().acquire() as conn:
        await _ready(conn)
        async with conn.transaction():
            _db, schema = await _load_db(conn, db_id, user_id, auth_role, writing=True, lock="FOR SHARE")
            items = []
            for m in merged.values():
                props, drop = (None, None)
                if m["props"] is not None:
                    props, drop = _split_props(schema, m["props"])
                items.append({**m, "props": props, "rm": drop})
            scope, sargs = _scope_sql(auth_role, user_id, 5)
            rows = await conn.fetch(
                "UPDATE published_pages p SET "
                "  title = CASE WHEN u.has_title THEN u.title ELSE p.title END, "
                "  position = COALESCE(u.position, p.position), "
                "  metadata = CASE WHEN u.props IS NULL AND u.rm IS NULL THEN p.metadata ELSE "
                + _MERGE_PROPS.format(set="u.props", drop="u.rm") + " END, "
                "  updated_at = $3, updated_by = $4 "
                "FROM jsonb_to_recordset($1::jsonb) AS u(id uuid, has_title boolean, title text, "
                "                                        props jsonb, rm text[], position float8) "
                f"WHERE p.id = u.id AND p.parent_id = $2 AND p.deleted_at IS NULL{scope} "
                f"RETURNING {_ROW_RETURNING}",
                json.dumps(items), db_id, datetime.now(timezone.utc), user_id, *sargs,
            )
            if len(rows) != len(items):
                done = {str(r["id"]) for r in rows}
                raise await _explain_missing(conn, db_id, [i for i in merged if i not in done], user_id, auth_role)
    by_id = {str(r["id"]): r for r in rows}
    await invalidate_public_rows(db_id)
    return {"rows": [_row_out(by_id[i], schema) for i in merged]}


_DESCEND_MANY = f"""
WITH RECURSIVE down(id, depth) AS (
    SELECT id, 0 FROM published_pages WHERE id = ANY($1::uuid[])
  UNION ALL
    SELECT p.id, down.depth + 1 FROM published_pages p JOIN down ON p.parent_id = down.id
     WHERE down.depth < {T.MAX_DEPTH}
)
SELECT DISTINCT p.id FROM down JOIN published_pages p ON p.id = down.id
 WHERE p.deleted_at IS NULL"""


@router.post("/api/databases/{db_id}/rows/delete")
async def delete_rows(db_id: DbId, body: IdsBody, request: Request, role: str = Depends(require_auth)):
    """Rows go to the trash, like any page, and can be restored from there."""
    user_id, auth_role = _who(request, role)
    ids = list(dict.fromkeys(_uuid(i) for i in body.ids))[: D.MAX_PAGE]
    if not ids:
        return {"ok": True, "trashed": []}
    async with _pool().acquire() as conn:
        await _ready(conn)
        await _load_db(conn, db_id, user_id, auth_role, writing=True)
        # Every id checked in one read: a row of this database, live, the
        # caller's.
        found = await conn.fetch(
            "SELECT id, parent_id, created_by, deleted_at FROM published_pages WHERE id = ANY($1::uuid[])", ids)
        if len(found) != len(ids) or any(
                str(r["parent_id"]) != str(db_id) or T.is_trashed(r) for r in found):
            raise HTTPException(404, "Row not found")
        if any(not _owns(r, user_id, auth_role) for r in found):
            raise HTTPException(403, "Access denied")
        # A row's own sub-pages go with it, stamped alike so restore brings
        # them back together.
        scope, sargs = _scope_sql(auth_role, user_id, 2)
        doomed = [r["id"] for r in await conn.fetch(_DESCEND_MANY + scope, ids, *sargs)]
        try:
            await collab.close_pages([str(i) for i in doomed])
        except Exception:
            pass
        await conn.execute(
            "UPDATE published_pages SET deleted_at = $1 WHERE id = ANY($2::uuid[])",
            datetime.now(timezone.utc), doomed,
        )
    await invalidate_public_rows(db_id)
    return {"ok": True, "trashed": [str(i) for i in doomed]}


@router.post("/api/databases/{db_id}/rows/publish")
async def publish_rows(db_id: DbId, body: PublishRowsBody, request: Request, role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    async with _pool().acquire() as conn:
        await _ready(conn)
        await _load_db(conn, db_id, user_id, auth_role, writing=True)
        scope, args = ("", []) if _can_see_all(auth_role) else (" AND created_by = $4", [user_id])
        # As publishing one page does: the rows' working copies become what
        # the public sees (migration 0006).
        snapshot = (
            ", published_content = CASE WHEN $1 THEN content ELSE published_content END"
            ", published_content_type = CASE WHEN $1 THEN content_type ELSE published_content_type END"
            ", published_title = CASE WHEN $1 THEN title ELSE published_title END"
            ", published_at_rev = CASE WHEN $1 THEN $2 ELSE published_at_rev END"
        ) if await T.perf_ready(conn) else ""
        status = await conn.execute(
            "UPDATE published_pages SET is_published = $1, "
            "  published_at = CASE WHEN $1 AND published_at IS NULL THEN $2 ELSE published_at END"
            f"{snapshot} WHERE parent_id = $3 AND deleted_at IS NULL{scope}",
            body.published, datetime.now(timezone.utc), db_id, *args,
        )
    try:
        count = int(str(status).split()[-1])
    except (ValueError, IndexError):
        count = 0
    await invalidate_public_rows(db_id)
    return {"ok": True, "updated": count}


# ---------------------------------------------------------------------------
# CSV
# ---------------------------------------------------------------------------

EXPORT_MAX_ROWS = 20_000


@router.get("/api/databases/{db_id}/export.csv")
async def export_csv(db_id: DbId, request: Request, role: str = Depends(require_auth)):
    """Every row (up to EXPORT_MAX_ROWS) in one query; the CSV is written in
    a worker thread."""
    user_id, auth_role = _who(request, role)
    async with _pool().acquire() as conn:
        await _ready(conn)
        db, schema = await _load_db(conn, db_id, user_id, auth_role)
        sql, args = D.build_rows_query(
            db_id, schema, None, [], EXPORT_MAX_ROWS, 0, owner=None if _can_see_all(auth_role) else user_id,
            with_total=False, max_limit=EXPORT_MAX_ROWS)
        rows = await conn.fetch(sql, *args)
    text = await asyncio.to_thread(D.export_csv, schema, rows)
    name = (_slugify(db["title"] or "database") or "database") + ".csv"
    return Response(
        content="﻿" + text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"},
    )


def _import_slugs(titles: list[str], taken: set[str]) -> list[str]:
    out, used = [], set(taken)
    for t in titles:
        base = _slugify(t or "row") or "row"
        slug = base if base not in used else f"{base}-{_random_suffix()}"
        while slug in used:
            slug = f"{base}-{_random_suffix()}"
        used.add(slug)
        out.append(slug)
    return out


_IMPORT_INSERT = """
INSERT INTO published_pages
  (slug, title, content_type, content, metadata, created_by, updated_by, parent_id, position)
SELECT u.slug, u.title, $2, '', u.metadata, $3, $3, $4, b.base + u.ord * 1024.0
  FROM jsonb_to_recordset($1::jsonb) AS u(slug text, title text, metadata jsonb, ord int),
       (SELECT COALESCE(MAX(position), 0) AS base FROM published_pages WHERE parent_id = $4) b
ON CONFLICT (slug) DO NOTHING
RETURNING slug
"""


@router.post("/api/databases/{db_id}/import")
async def import_csv(db_id: DbId, body: ImportBody, request: Request, role: str = Depends(require_auth)):
    """Every CSV row becomes a row page, in one INSERT. With import_id, a
    retried request (the client timed out and sent it again) creates nothing
    a second time."""
    user_id, auth_role = _who(request, role)
    import_id = (body.import_id or "").strip()[:100] or None
    if not isinstance(body.mapping, list) or len(body.mapping) > MAX_MAPPING:
        raise HTTPException(422, f"The column mapping takes at most {MAX_MAPPING} entries")
    try:
        grid = D.parse_csv(body.csv)
    except D.SchemaError as exc:
        raise _bad(exc)
    if not grid:
        raise HTTPException(422, "The CSV is empty")
    header = grid[0] if body.has_header else [f"Column {i + 1}" for i in range(max(len(r) for r in grid))]
    data = grid[1:] if body.has_header else grid
    async with _pool().acquire() as conn:
        await _ready(conn)
        async with conn.transaction():
            # One import at a time per database: a retry waits for the first
            # attempt to commit, then finds its import id.
            db, schema = await _load_db(conn, db_id, user_id, auth_role, writing=True, lock="FOR UPDATE")
            meta = D._as_dict(db["metadata"])
            rev = _revision(meta)
            imports = meta.get("imports") if isinstance(meta.get("imports"), dict) else {}
            if import_id and import_id in imports:
                done = imports[import_id] if isinstance(imports[import_id], dict) else {}
                return {"ok": True, "created": int(done.get("created") or 0),
                        "database": _with_rev(schema, rev), "duplicate": True}
            try:
                new_schema, plan = D.plan_import(schema, header, body.mapping)
                if not plan:
                    raise D.SchemaError("Map at least one column to a property")
                rows = D.import_rows(new_schema, data, plan)
                new_schema = D.normalize_schema(new_schema)
            except D.SchemaError as exc:
                raise _bad(exc)
            titles = [t[:500] for t, _ in rows]
            bases = list({_slugify(t or "row") or "row" for t in titles})
            taken = {r["slug"] for r in await conn.fetch(
                "SELECT slug FROM published_pages WHERE slug = ANY($1::text[])", bases)}
            slugs = _import_slugs(titles, taken)
            pending = [
                {"slug": s, "title": t, "ord": i + 1, "metadata": {"props": props, "db_row": db_id}}
                for i, (s, t, (_title, props)) in enumerate(zip(slugs, titles, rows))
            ]
            for _attempt in range(4):
                if not pending:
                    break
                made = {r["slug"] for r in await conn.fetch(
                    _IMPORT_INSERT, json.dumps(pending), new_schema["row_type"], user_id, db_id)}
                # A slug taken meanwhile by someone else: those rows go again
                # with a fresh suffix.
                pending = [{**p, "slug": f"{_slugify(p['title'] or 'row') or 'row'}-{_random_suffix(8)}"}
                           for p in pending if p["slug"] not in made]
            if pending:
                raise HTTPException(409, "Could not name the imported rows; try again")
            if import_id:
                imports = dict(list(imports.items())[-(IMPORT_IDS_KEPT - 1):])
                imports[import_id] = {"created": len(rows), "at": datetime.now(timezone.utc).isoformat()}
            if new_schema != schema or import_id:
                saved = await _save_schema(conn, db_id, new_schema, user_id, rev,
                                           imports=imports if import_id else None)
            else:
                saved = _with_rev(new_schema, rev)
    await invalidate_public_rows(db_id)
    return {"ok": True, "created": len(rows), "database": saved}


# ---------------------------------------------------------------------------
# Public
# ---------------------------------------------------------------------------

PUBLIC_ROW_LIMIT = 2000


async def public_rows(pool, page: Any) -> dict:
    """Rows of a published database for the public viewer. A row links to its
    own page only when that page is itself published. Empty for any other
    page, before the tree migration, and on error.

    One bounded query (no total, no paging loop), cached in Valkey for
    PUBLIC_CACHE_TTL seconds under the database id and stamped with its
    updated_at; any write to the database's rows marks the entry stale."""
    if page is None or T.field(page, "content_type") != D.CONTENT_TYPE or pool is None:
        return {}
    stamp = T.field(page, "updated_at")
    stamp = stamp.isoformat() if isinstance(stamp, datetime) else str(stamp)
    key = _pub_key(page["id"])
    hit = await vk.cache_get(key) if vk.get_client() is not None else None
    if isinstance(hit, dict) and hit.get("u") == stamp and isinstance(hit.get("rows"), list):
        return {"database_rows": hit["rows"]}
    try:
        async with pool.acquire() as conn:
            if not await T.tree_ready(conn):
                return {}
            schema = D.schema_of(page["metadata"])
            sql, args = D.build_rows_query(str(page["id"]), schema, None, [], PUBLIC_ROW_LIMIT, 0,
                                           with_total=False, max_limit=PUBLIC_ROW_LIMIT)
            rows = await conn.fetch(sql, *args)
    except Exception:
        return {}
    out = []
    for r in rows[:PUBLIC_ROW_LIMIT]:
        d = D.row_dict(r, schema)
        visible = bool(r["is_published"]) and not T.is_expired(r)
        out.append({
            "id": d["id"], "title": d["title"], "icon": d["icon"], "cover": d["cover"],
            "props": d["props"], "position": d["position"],
            "created_at": d["created_at"], "updated_at": d["updated_at"],
            "slug": d["slug"] if visible else None,
        })
    if vk.get_client() is not None:
        await vk.cache_set(key, {"u": stamp, "rows": out}, PUBLIC_CACHE_TTL)
    return {"database_rows": out}
