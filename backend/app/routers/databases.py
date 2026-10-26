"""
Databases: typed rows over the page tree (services/databases.py).

  GET    /api/databases/templates                 templates to start from
  GET    /api/databases/people                    names for person properties
  POST   /api/databases                           create (optionally from a template)
  GET    /api/databases/row-context/{page_id}     the database a row page belongs to
  GET    /api/databases/{id}                      the database page and its schema
  PUT    /api/databases/{id}/schema               properties, views, default view
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
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from ..db.postgres import get_pool
from ..services import databases as D
from ..services import page_tree as T
from .deps import require_auth
from .pages import PageId, _can_see_all, _page_uuid, _random_suffix, _slugify


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


class QueryBody(BaseModel):
    view_id: str | None = None
    filter: dict | None = None
    sort: list | None = None
    search: str | None = None
    limit: int = 100
    offset: int = 0


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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _who(request: Request, role: str) -> tuple[str | None, str]:
    return getattr(request.state, "auth_user_id", None), (getattr(request.state, "auth_role", role) or role)


def _owns(row: Any, user_id: str | None, auth_role: str) -> bool:
    return _can_see_all(auth_role) or (user_id is not None and str(row["created_by"]) == str(user_id))


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


async def _load_db(conn, db_id: str, user_id, auth_role, *, writing: bool = False) -> tuple[Any, dict]:
    row = await conn.fetchrow(
        "SELECT id, slug, title, icon, cover, content_type, is_published, metadata, "
        "created_by, deleted_at, parent_id FROM published_pages WHERE id = $1",
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
        "database": schema,
    }


async def _unique_slug(conn, title: str) -> str:
    base = _slugify(title or "row") or "row"
    taken = await conn.fetchval("SELECT id FROM published_pages WHERE slug = $1", base)
    return f"{base}-{_random_suffix()}" if taken else base


async def _save_schema(conn, db_id: str, schema: dict, user_id) -> None:
    meta = await conn.fetchval("SELECT metadata FROM published_pages WHERE id = $1", db_id)
    meta = D._as_dict(meta)
    meta["database"] = schema
    await conn.execute(
        "UPDATE published_pages SET metadata = $1::jsonb, updated_at = $2, updated_by = $3 WHERE id = $4",
        json.dumps(meta), datetime.now(timezone.utc), user_id, db_id,
    )


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


def _icon(value: str | None) -> str | None:
    icon = (value or "").strip()
    if len(icon) > 16 or any(c in icon for c in "<>\"'&"):
        raise HTTPException(422, "Icon must be a single emoji")
    return icon or None


async def _update_row(conn, row: Any, schema: dict, user_id, *, title=None, props=None,
                      position=None, icon=None, icon_set=False) -> Any:
    sets: dict[str, Any] = {"updated_at": datetime.now(timezone.utc), "updated_by": user_id}
    if title is not None:
        sets["title"] = str(title)[:500]
    if props is not None:
        try:
            clean = D.clean_props(schema, props)
        except D.SchemaError as exc:
            raise _bad(exc)
        meta = D._as_dict(row["metadata"])
        merged = {**D.props_of(meta), **clean}
        meta["props"] = {k: v for k, v in merged.items() if v is not None}
        sets["metadata"] = json.dumps(meta)
    if position is not None:
        sets["position"] = float(position)
    if icon_set:
        sets["icon"] = icon
    cols = ", ".join(f"{k} = ${i + 1}{'::jsonb' if k == 'metadata' else ''}" for i, k in enumerate(sets))
    return await conn.fetchrow(
        f"UPDATE published_pages SET {cols} WHERE id = ${len(sets) + 1} "
        f"RETURNING {D.ROW_COLS.replace('p.', '')}, metadata",
        *sets.values(), row["id"],
    )


def _row_out(row: Any, schema: dict) -> dict:
    d = dict(row)
    if "props" not in d or d["props"] is None:
        d["props"] = D.props_of(d.get("metadata"))
    return D.row_dict(d, schema)


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
                     "database": schema},
        "row": _row_out(row, schema),
    }


@router.get("/api/databases/{db_id}")
async def get_database(db_id: DbId, request: Request, role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    async with _pool().acquire() as conn:
        row, schema = await _load_db(conn, db_id, user_id, auth_role)
    return _db_dict(row, schema)


@router.put("/api/databases/{db_id}/schema")
async def update_schema(db_id: DbId, body: SchemaBody, request: Request, role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    async with _pool().acquire() as conn:
        await _ready(conn)
        _row, old = await _load_db(conn, db_id, user_id, auth_role, writing=True)
        raw = body.model_dump()
        if raw.get("views") is None:
            raw["views"] = old["views"]
        if raw.get("row_type") is None:
            raw["row_type"] = old["row_type"]
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

        async with conn.transaction():
            if changed or dropped:
                rows = await conn.fetch(
                    "SELECT id, metadata FROM published_pages WHERE parent_id = $1", db_id
                )
                metas = [D._as_dict(r["metadata"]) for r in rows]
                # Retyped into a select: one option per distinct old value, as
                # a spreadsheet column turned into a dropdown would expect.
                for o, p in changed:
                    if p["type"] in ("select", "multi_select") and o["type"] not in ("select", "multi_select"):
                        D.add_options_for(p, (D.value_text(o, D.props_of(m).get(o["id"])) for m in metas))
                new = D.normalize_schema(new)
                converted = D.convert_props(old, new, [D.props_of(m) for m in metas])
                updates = []
                for r, m, props in zip(rows, metas, converted):
                    if props != D.props_of(m):
                        m["props"] = props
                        updates.append((json.dumps(m), r["id"]))
                if updates:
                    await conn.executemany(
                        "UPDATE published_pages SET metadata = $1::jsonb WHERE id = $2", updates
                    )
            await _save_schema(conn, db_id, new, user_id)
    return {"database": new}


@router.post("/api/databases/{db_id}/query")
async def query_rows(db_id: DbId, body: QueryBody, request: Request, role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    async with _pool().acquire() as conn:
        await _ready(conn)
        _row, schema = await _load_db(conn, db_id, user_id, auth_role)
        view = next((v for v in schema["views"] if v["id"] == body.view_id), None)
        if body.view_id and view is None:
            raise HTTPException(404, "View not found")
        try:
            flt = D.normalize_filter(body.filter, schema) if body.filter is not None else (view or {}).get("filter")
            sort = D.normalize_sort(body.sort, schema) if body.sort is not None else (view or {}).get("sort", [])
        except D.SchemaError as exc:
            raise _bad(exc)
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


# ---------------------------------------------------------------------------
# Rows
# ---------------------------------------------------------------------------

@router.post("/api/databases/{db_id}/rows")
async def create_row(db_id: DbId, body: RowBody, request: Request, role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    async with _pool().acquire() as conn:
        await _ready(conn)
        _db, schema = await _load_db(conn, db_id, user_id, auth_role, writing=True)
        try:
            props = {k: v for k, v in D.clean_props(schema, body.props).items() if v is not None}
        except D.SchemaError as exc:
            raise _bad(exc)
        ctype = body.content_type if body.content_type in D.ROW_TYPES else schema["row_type"]
        row = await _insert_row(conn, db_id, (body.title or "").strip(), props, user_id, ctype,
                                position=body.position, icon=_icon(body.icon))
    return _row_out(row, schema)


@router.patch("/api/databases/{db_id}/rows/{row_id}")
async def update_row(db_id: DbId, row_id: str, body: RowPatchBody, request: Request,
                     role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    row_id = _uuid(row_id)
    async with _pool().acquire() as conn:
        await _ready(conn)
        _db, schema = await _load_db(conn, db_id, user_id, auth_role, writing=True)
        row = await _load_row(conn, db_id, row_id, user_id, auth_role)
        icon_set = "icon" in body.model_fields_set
        updated = await _update_row(conn, row, schema, user_id, title=body.title, props=body.props,
                                    position=body.position, icon=_icon(body.icon) if icon_set else None,
                                    icon_set=icon_set)
    return _row_out(updated, schema)


@router.post("/api/databases/{db_id}/rows/bulk")
async def bulk_update_rows(db_id: DbId, body: BulkBody, request: Request, role: str = Depends(require_auth)):
    """Several rows at once, all or nothing: a card dragged to another column
    changes its group and its place, and its new neighbours may be renumbered."""
    user_id, auth_role = _who(request, role)
    if len(body.updates) > D.MAX_PAGE:
        raise HTTPException(422, f"At most {D.MAX_PAGE} rows per request")
    async with _pool().acquire() as conn:
        await _ready(conn)
        _db, schema = await _load_db(conn, db_id, user_id, auth_role, writing=True)
        out = []
        async with conn.transaction():
            for item in body.updates:
                row = await _load_row(conn, db_id, _uuid(item.id), user_id, auth_role)
                updated = await _update_row(conn, row, schema, user_id, title=item.title,
                                            props=item.props, position=item.position)
                out.append(_row_out(updated, schema))
    return {"rows": out}


@router.post("/api/databases/{db_id}/rows/delete")
async def delete_rows(db_id: DbId, body: IdsBody, request: Request, role: str = Depends(require_auth)):
    """Rows go to the trash, like any page, and can be restored from there."""
    user_id, auth_role = _who(request, role)
    ids = list(dict.fromkeys(_uuid(i) for i in body.ids))[: D.MAX_PAGE]
    async with _pool().acquire() as conn:
        await _ready(conn)
        await _load_db(conn, db_id, user_id, auth_role, writing=True)
        for rid in ids:
            await _load_row(conn, db_id, rid, user_id, auth_role)
        now = datetime.now(timezone.utc)
        # A row's own sub-pages go with it, stamped alike so restore brings
        # them back together.
        doomed = []
        for rid in ids:
            doomed += [r["id"] for r in await T.descendants(conn, rid)
                       if r["deleted_at"] is None and _owns(r, user_id, auth_role)]
        await conn.execute(
            "UPDATE published_pages SET deleted_at = $1 WHERE id = ANY($2::uuid[])", now, doomed
        )
    return {"ok": True, "trashed": [str(i) for i in doomed]}


@router.post("/api/databases/{db_id}/rows/publish")
async def publish_rows(db_id: DbId, body: PublishRowsBody, request: Request, role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    async with _pool().acquire() as conn:
        await _ready(conn)
        await _load_db(conn, db_id, user_id, auth_role, writing=True)
        scope, args = ("", []) if _can_see_all(auth_role) else (" AND created_by = $4", [user_id])
        status = await conn.execute(
            "UPDATE published_pages SET is_published = $1, "
            "  published_at = CASE WHEN $1 AND published_at IS NULL THEN $2 ELSE published_at END "
            f"WHERE parent_id = $3 AND deleted_at IS NULL{scope}",
            body.published, datetime.now(timezone.utc), db_id, *args,
        )
    try:
        count = int(str(status).split()[-1])
    except (ValueError, IndexError):
        count = 0
    return {"ok": True, "updated": count}


# ---------------------------------------------------------------------------
# CSV
# ---------------------------------------------------------------------------

@router.get("/api/databases/{db_id}/export.csv")
async def export_csv(db_id: DbId, request: Request, role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    async with _pool().acquire() as conn:
        await _ready(conn)
        db, schema = await _load_db(conn, db_id, user_id, auth_role)
        sql, args = D.build_rows_query(
            db_id, schema, None, [], D.MAX_PAGE, 0, owner=None if _can_see_all(auth_role) else user_id)
        rows = list(await conn.fetch(sql, *args))
        # Past the first page, keep reading: an export is every row.
        while rows and len(rows) < (rows[0]["total_count"] or 0) and len(rows) < 20_000:
            sql, args = D.build_rows_query(
                db_id, schema, None, [], D.MAX_PAGE, len(rows),
                owner=None if _can_see_all(auth_role) else user_id)
            more = await conn.fetch(sql, *args)
            if not more:
                break
            rows += list(more)
    text = D.export_csv(schema, rows)
    name = (_slugify(db["title"] or "database") or "database") + ".csv"
    return Response(
        content="﻿" + text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"},
    )


@router.post("/api/databases/{db_id}/import")
async def import_csv(db_id: DbId, body: ImportBody, request: Request, role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
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
        _db, schema = await _load_db(conn, db_id, user_id, auth_role, writing=True)
        try:
            new_schema, plan = D.plan_import(schema, header, body.mapping)
            if not plan:
                raise D.SchemaError("Map at least one column to a property")
            rows = D.import_rows(new_schema, data, plan)
            new_schema = D.normalize_schema(new_schema)
        except D.SchemaError as exc:
            raise _bad(exc)
        base = await conn.fetchval(
            "SELECT MAX(position) FROM published_pages WHERE parent_id = $1", db_id
        ) or 0.0
        async with conn.transaction():
            if new_schema != schema:
                await _save_schema(conn, db_id, new_schema, user_id)
            for i, (title, props) in enumerate(rows):
                await _insert_row(conn, db_id, title, props, user_id, new_schema["row_type"],
                                  position=float(base) + (i + 1) * 1024.0)
    return {"ok": True, "created": len(rows), "database": new_schema}


# ---------------------------------------------------------------------------
# Public
# ---------------------------------------------------------------------------

PUBLIC_ROW_LIMIT = 2000


async def public_rows(pool, page: Any) -> dict:
    """Rows of a published database for the public viewer. A row links to its
    own page only when that page is itself published. Empty for any other
    page, before the tree migration, and on error."""
    if page is None or T.field(page, "content_type") != D.CONTENT_TYPE or pool is None:
        return {}
    try:
        async with pool.acquire() as conn:
            if not await T.tree_ready(conn):
                return {}
            schema = D.schema_of(page["metadata"])
            sql, args = D.build_rows_query(str(page["id"]), schema, None, [], D.MAX_PAGE, 0)
            rows = list(await conn.fetch(sql, *args))
            while rows and len(rows) < min(rows[0]["total_count"] or 0, PUBLIC_ROW_LIMIT):
                sql, args = D.build_rows_query(str(page["id"]), schema, None, [], D.MAX_PAGE, len(rows))
                more = await conn.fetch(sql, *args)
                if not more:
                    break
                rows += list(more)
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
    return {"database_rows": out}
