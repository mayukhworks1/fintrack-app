"""
Pages as a tree: the sidebar's endpoints.

  GET    /api/pages/tree                  lightweight outline + favourite ids
  GET    /api/pages/trash                 trashed pages (top of each trashed subtree)
  GET    /api/pages/favourites            the caller's starred pages
  GET    /api/pages/recent                recently edited or opened pages
  POST   /api/pages/{id}/move             new parent and place among siblings
  POST   /api/pages/{id}/children         create a sub-page
  PUT    /api/pages/{id}/appearance       icon / cover
  POST   /api/pages/{id}/trash            soft delete, with the subtree
  POST   /api/pages/{id}/restore          back out of the trash, with the subtree
  DELETE /api/pages/{id}/forever          permanently delete a trashed subtree
  PUT    /api/pages/{id}/favourite        star
  DELETE /api/pages/{id}/favourite        unstar
  GET    /api/pages/{id}/breadcrumbs      ancestors, top first
  GET    /api/pages/{id}/children         direct sub-pages (bounded, ?limit=&cursor=)
  GET    /api/pages/{id}/context          everything the editor shows around a page, at once

Ownership follows routers/pages.py exactly: a superadmin sees every page,
everyone else only the pages they created. A page whose parent the caller
cannot see shows at the caller's top level.

Included in the app before the pages router, because /api/pages/tree and its
siblings would otherwise be taken for /api/pages/{page_id}.
"""

from __future__ import annotations

import base64
import json
import re
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from ..db.postgres import get_pool
from ..services import databases as D
from ..services import page_comments
from ..services import page_tree as T
from ..utils import fast_json
from .deps import require_auth
from .pages import (
    TRASHED_DETAIL,
    CreatePageBody,
    PageId,
    _can_see_all,
    _create_page,
    _delete_asset_paths,
    _extract_asset_paths,
    _invalidate_public_rows,
    _owns_page,
    _page_dict,
    _trash_subtree,
    page_cols_for,
)

router = APIRouter()

_TREE_COLS = "id, slug, title, icon, parent_id, position, content_type, is_published, updated_at, created_by"


class MoveBody(BaseModel):
    parent_id: str | None = None
    # Where among the new siblings: an index (0 = first), or an explicit
    # position. Neither means "at the end".
    index: int | None = None
    position: float | None = None


class AppearanceBody(BaseModel):
    icon: str | None = None
    cover: str | None = None


def _who(request: Request, role: str) -> tuple[str | None, str]:
    user_id = getattr(request.state, "auth_user_id", None)
    auth_role = getattr(request.state, "auth_role", role) or role
    return user_id, auth_role


def _owns(row: Any, user_id: str | None, auth_role: str) -> bool:
    return _owns_page(row, user_id, auth_role)


def _scope(auth_role: str, user_id: str | None, col: str = "created_by", n: int = 1) -> tuple[str, list]:
    """SQL fragment + args limiting rows to what the caller may see."""
    if _can_see_all(auth_role):
        return "", []
    return f" AND {col} = ${n}", [user_id]


def _pool():
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")
    return pool


async def _require_ready(conn) -> None:
    if not await T.tree_ready(conn):
        raise HTTPException(503, T.NOT_READY)


async def _load(conn, page_id: str, user_id, auth_role) -> Any:
    row = await conn.fetchrow(
        "SELECT id, created_by, parent_id, deleted_at, title, slug, icon, is_published "
        "FROM published_pages WHERE id = $1",
        page_id,
    )
    if not row:
        raise HTTPException(404, "Page not found")
    if not _owns(row, user_id, auth_role):
        raise HTTPException(403, "Access denied")
    return row


def _uuid_or_422(value: str, what: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        raise HTTPException(422, f"{what} is not a valid page id")


# ---------------------------------------------------------------------------
# Listings
# ---------------------------------------------------------------------------

@router.get("/api/pages/tree")
async def page_tree(request: Request, role: str = Depends(require_auth), include_rows: bool = False):
    """The sidebar outline. Rows of databases are not in it (a database is
    opened to see them; include_rows=true brings them back). JSON with an
    ETag: a client polling with If-None-Match gets a 304 when nothing moved."""
    user_id, auth_role = _who(request, role)
    pool = _pool()
    async with pool.acquire() as conn:
        if not await T.tree_ready(conn):
            # Before migration 0004: every page at the top level, oldest first,
            # so the sidebar still works as a flat list.
            where, args = ("", []) if _can_see_all(auth_role) else (" WHERE created_by = $1", [user_id])
            rows = await conn.fetch(
                "SELECT id, slug, title, content_type, is_published, updated_at, created_by "
                f"FROM published_pages{where} ORDER BY created_at",
                *args,
            )
            return fast_json.json_response(request, {"ready": False, "pages": T.tree_nodes(rows), "favourites": []})
        scope, args = _scope(auth_role, user_id, "p.created_by")
        rows_sql = "" if include_rows else f" AND {T.not_db_row('p')}"
        cols = ", ".join("p." + c.strip() for c in _TREE_COLS.split(","))
        rows = await conn.fetch(
            f"SELECT {cols} FROM published_pages p "
            f"WHERE p.deleted_at IS NULL{scope}{rows_sql} ORDER BY p.position NULLS LAST, p.created_at",
            *args,
        )
        favs = []
        if user_id:
            favs = await conn.fetch(
                "SELECT page_id FROM page_favourites WHERE user_id = $1 ORDER BY created_at",
                user_id,
            )
    visible = {str(r["id"]) for r in rows}
    return fast_json.json_response(request, {
        "ready": True,
        "pages": T.tree_nodes(rows),
        "favourites": [str(f["page_id"]) for f in favs if str(f["page_id"]) in visible],
    })


@router.get("/api/pages/trash")
async def page_trash(request: Request, role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    pool = _pool()
    async with pool.acquire() as conn:
        if not await T.tree_ready(conn):
            return []
        scope, args = _scope(auth_role, user_id, "p.created_by")
        rows = await conn.fetch(
            "SELECT p.id, p.slug, p.title, p.icon, p.content_type, p.is_published, p.deleted_at, "
            "       p.parent_id, pp.deleted_at AS parent_deleted_at "
            "  FROM published_pages p LEFT JOIN published_pages pp ON pp.id = p.parent_id "
            f" WHERE p.deleted_at IS NOT NULL{scope} ORDER BY p.deleted_at DESC",
            *args,
        )
    out = []
    for r in rows:
        # A page trashed together with its parent is restored with it, so only
        # the top of each trashed subtree is listed.
        if r["parent_deleted_at"] is not None and r["parent_deleted_at"] == r["deleted_at"]:
            continue
        out.append({
            "id": str(r["id"]), "slug": r["slug"], "title": r["title"] or "", "icon": r["icon"],
            "content_type": r["content_type"], "is_published": bool(r["is_published"]),
            "deleted_at": r["deleted_at"].isoformat() if isinstance(r["deleted_at"], datetime) else r["deleted_at"],
        })
    return out


@router.get("/api/pages/favourites")
async def page_favourites(request: Request, role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    pool = _pool()
    async with pool.acquire() as conn:
        if not user_id or not await T.tree_ready(conn):
            return []
        scope, args = _scope(auth_role, user_id, "p.created_by", 2)
        rows = await conn.fetch(
            "SELECT p.id, p.slug, p.title, p.icon, p.parent_id, p.position, p.content_type, "
            "       p.is_published, p.updated_at "
            "  FROM page_favourites f JOIN published_pages p ON p.id = f.page_id "
            f" WHERE f.user_id = $1 AND p.deleted_at IS NULL{scope} ORDER BY f.created_at",
            user_id, *args,
        )
    return [T.node(r) for r in rows]


@router.get("/api/pages/recent")
async def page_recent(request: Request, limit: int = 8, role: str = Depends(require_auth)):
    """Pages most recently edited, or opened by the caller, newest first."""
    user_id, auth_role = _who(request, role)
    limit = max(1, min(limit, 30))
    pool = _pool()
    async with pool.acquire() as conn:
        ready = await T.tree_ready(conn)
        scope, args = _scope(auth_role, user_id, "p.created_by", 3)
        trash = " AND p.deleted_at IS NULL" if ready else ""
        icon = "p.icon" if ready else "NULL::text AS icon"
        # A page's place is max(last edit, last opened by the caller). The
        # top `limit` by that are among the `limit` most recently edited
        # and the pages the caller opened, so only those are ranked: two
        # index walks (0006's pp_*_updated_idx and pv_viewer_viewed_idx)
        # instead of a lateral MAX over every page's views.
        rows = await conn.fetch(
            "WITH seen AS ("
            "  SELECT page_id, MAX(viewed_at) AS seen FROM page_views "
            "   WHERE viewer_user_id = $1 GROUP BY page_id ORDER BY 2 DESC LIMIT $2), "
            "edited AS ("
            f"  SELECT p.id FROM published_pages p WHERE TRUE{trash}{scope} "
            "   ORDER BY p.updated_at DESC LIMIT $2) "
            f"SELECT p.id, p.slug, p.title, {icon}, p.content_type, p.is_published, p.updated_at, "
            "       GREATEST(p.updated_at, COALESCE(s.seen, p.updated_at)) AS touched "
            "  FROM published_pages p "
            "  LEFT JOIN seen s ON s.page_id = p.id "
            " WHERE p.id IN (SELECT id FROM edited UNION SELECT page_id FROM seen)"
            f"{trash}{scope} ORDER BY touched DESC LIMIT $2",
            user_id, limit, *args,
        )
    return [T.node(r) for r in rows]


# ---------------------------------------------------------------------------
# Structure
# ---------------------------------------------------------------------------

# Moves take one transaction-level advisory lock: two moves checked for a
# cycle at the same time could each pass and together make a loop.
MOVE_LOCK_KEY = 0x70616765  # "page"

_SIBLING_ORDER = "COALESCE(position, 'Infinity'::float8), created_at, id"


@router.post("/api/pages/{page_id}/move")
async def move_page(page_id: PageId, body: MoveBody, request: Request, role: str = Depends(require_auth)):
    """New parent and place. Only the neighbours at the target index are read;
    when there is no room between them the siblings are renumbered by one
    UPDATE. A database row moved out of its database stops being a row: its
    db_row marker and property values are cleared."""
    user_id, auth_role = _who(request, role)
    parent_id = _uuid_or_422(body.parent_id, "parent_id") if body.parent_id else None
    pool = _pool()
    async with pool.acquire() as conn:
        await _require_ready(conn)
        page = await _load(conn, page_id, user_id, auth_role)
        if T.is_trashed(page):
            raise HTTPException(409, "Restore the page from the trash before moving it")
        if parent_id is not None and parent_id == page_id:
            raise HTTPException(409, "A page cannot be moved inside itself")

        async with conn.transaction():
            if parent_id is not None:
                # Only a move under a page can close a loop.
                await conn.execute("SELECT pg_advisory_xact_lock($1)", MOVE_LOCK_KEY)
                parent = await _load(conn, parent_id, user_id, auth_role)
                if T.is_trashed(parent):
                    raise HTTPException(409, "The destination page is in the trash")
                chain = await T.ancestors(conn, parent_id)
                parent_of = {str(parent["id"]): parent["parent_id"]}
                parent_of.update({str(a["id"]): a["parent_id"] for a in chain})
                if T.would_cycle(page_id, parent_id, parent_of):
                    raise HTTPException(409, "A page cannot be moved inside one of its own sub-pages")

            if body.position is not None:
                pos = float(body.position)
            else:
                pos = await _place(conn, page_id, parent_id, body.index, user_id, auth_role)
            row = await conn.fetchrow(
                "UPDATE published_pages SET parent_id = $1::uuid, position = $2, "
                "  metadata = CASE WHEN metadata ? 'db_row' AND (metadata->>'db_row') IS DISTINCT FROM $1::text "
                "                  THEN metadata - 'db_row' - 'props' ELSE metadata END "
                f"WHERE id = $3 RETURNING {_TREE_COLS}",
                parent_id, pos, page_id,
            )
    for db in {str(page["parent_id"]) if page["parent_id"] else None, parent_id} - {None}:
        await _invalidate_public_rows(db)
    return T.node(row)


async def _place(conn, page_id: str, parent_id: str | None, index: int | None, user_id, auth_role) -> float:
    """Position for page_id at `index` among the parent's other children (the
    end when index is None), reading only the neighbours there."""
    # Two shapes so each uses pp_parent_position_idx: IS NOT DISTINCT FROM
    # cannot.
    if parent_id is None:
        sib, args = "parent_id IS NULL", [page_id]
    else:
        sib, args = "parent_id = $2::uuid", [page_id, parent_id]
    scope, sargs = _scope(auth_role, user_id, "created_by", len(args) + 1)
    where = f"{sib} AND deleted_at IS NULL AND id <> $1{scope}"
    args += sargs
    before = after = None
    if index is None:
        last = await conn.fetchrow(
            f"SELECT position FROM published_pages WHERE {where} ORDER BY {_SIBLING_ORDER.replace(', created_at, id', '')} DESC, created_at DESC LIMIT 1",
            *args,
        )
        if last is None:
            return 1024.0
        before = (last["position"],)
        idx = None
    else:
        idx = max(0, int(index))
        n = len(args)
        rows = await conn.fetch(
            f"SELECT position FROM published_pages WHERE {where} "
            f"ORDER BY {_SIBLING_ORDER} OFFSET ${n + 1} LIMIT 2",
            *args, max(idx - 1, 0),
        )
        if idx == 0:
            after = (rows[0]["position"],) if rows else None
        elif rows:
            before = (rows[0]["position"],)
            after = (rows[1]["position"],) if len(rows) > 1 else None
        else:  # past the end: after the last sibling
            return await _place(conn, page_id, parent_id, None, user_id, auth_role)
    if (before is None or before[0] is not None) and (after is None or after[0] is not None):
        pos = T.position_between(before and before[0], after and after[0])
        if pos is not None:
            return pos
    # No room (or a sibling without a position): renumber every sibling in one
    # statement, leaving the gap at idx.
    gap = idx if idx is not None else 2 ** 31 - 1
    n = len(args)
    await conn.execute(
        "UPDATE published_pages p SET position = (CASE WHEN r.rn <= $%d THEN r.rn ELSE r.rn + 1 END) * 1024.0 "
        "FROM (SELECT id, row_number() OVER (ORDER BY %s) AS rn FROM published_pages WHERE %s) r "
        "WHERE p.id = r.id" % (n + 1, _SIBLING_ORDER, where),
        *args, gap,
    )
    if idx is None:
        count = await conn.fetchval(f"SELECT count(*) FROM published_pages WHERE {where}", *args)
        return float((count + 1) * 1024)
    return float((idx + 1) * 1024)


@router.post("/api/pages/{page_id}/children")
async def create_child_page(page_id: PageId, body: CreatePageBody, request: Request,
                            role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    pool = _pool()
    async with pool.acquire() as conn:
        await _require_ready(conn)
        parent = await _load(conn, page_id, user_id, auth_role)
        if T.is_trashed(parent):
            raise HTTPException(409, "The parent page is in the trash")
    # The ordinary create path (slug, inline images, ownership, idempotency
    # key), inserted under the parent in the same statement: no window in
    # which the page exists at the top level. position's default puts it
    # after existing siblings.
    created = await _create_page(body, request, role, parent_id=page_id)
    created["parent_id"] = str(created.get("parent_id") or page_id)
    return created


_COVER_RE = re.compile(r"^(https://[^\s\"'<>()]+|/api/public/pages/asset/[^\s\"'<>()]+|preset:[a-z0-9-]{1,32})$")


@router.put("/api/pages/{page_id}/appearance")
async def set_appearance(page_id: PageId, body: AppearanceBody, request: Request,
                         role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    sets: dict[str, Any] = {}
    if "icon" in body.model_fields_set:
        icon = (body.icon or "").strip()
        if len(icon) > 16 or any(c in icon for c in "<>\"'&"):
            raise HTTPException(422, "Icon must be a single emoji")
        sets["icon"] = icon or None
    if "cover" in body.model_fields_set:
        cover = (body.cover or "").strip()
        if cover and (len(cover) > 1000 or not _COVER_RE.match(cover)):
            raise HTTPException(422, "Cover must be an https URL, an uploaded page asset or a preset")
        sets["cover"] = cover or None
    pool = _pool()
    async with pool.acquire() as conn:
        await _require_ready(conn)
        page = await _load(conn, page_id, user_id, auth_role)
        if sets and T.is_trashed(page):
            raise HTTPException(409, TRASHED_DETAIL)
        if not sets:
            row = await conn.fetchrow(f"SELECT {_TREE_COLS}, cover FROM published_pages WHERE id = $1", page_id)
        else:
            parts = ", ".join(f"{k} = ${i + 1}" for i, k in enumerate(sets))
            row = await conn.fetchrow(
                f"UPDATE published_pages SET {parts} WHERE id = ${len(sets) + 1} RETURNING {_TREE_COLS}, cover",
                *sets.values(), page_id,
            )
    return {**T.node(row), "cover": T.field(row, "cover")}


@router.post("/api/pages/{page_id}/trash")
async def trash_page(page_id: PageId, request: Request, role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    pool = _pool()
    async with pool.acquire() as conn:
        await _require_ready(conn)
        page = await _load(conn, page_id, user_id, auth_role)
        if T.is_trashed(page):
            return {"ok": True, "trashed": []}
        # The whole subtree goes with it, stamped with the same moment so a
        # restore brings back exactly what went in together. Pages under it
        # that belong to someone else stay where they are. Live editors of
        # any of them are disconnected (close code 4410) after a last save.
        ids = await _trash_subtree(conn, page_id, user_id, auth_role)
    if page["parent_id"]:
        await _invalidate_public_rows(page["parent_id"])
    return {"ok": True, "trashed": [str(i) for i in ids]}


@router.post("/api/pages/{page_id}/restore")
async def restore_page(page_id: PageId, request: Request, role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    pool = _pool()
    async with pool.acquire() as conn:
        await _require_ready(conn)
        page = await _load(conn, page_id, user_id, auth_role)
        stamp = page["deleted_at"]
        if stamp is None:
            return {"ok": True, "restored": []}
        ids = [r["id"] for r in await T.descendants(conn, page_id)
               if r["deleted_at"] == stamp and _owns(r, user_id, auth_role)]
        async with conn.transaction():
            await conn.execute(
                "UPDATE published_pages SET deleted_at = NULL WHERE id = ANY($1::uuid[])", ids
            )
            # Its parent may still be in the trash, or out of the caller's
            # reach: then it comes back at the top level.
            if page["parent_id"] is not None:
                parent = await conn.fetchrow(
                    "SELECT id, created_by, deleted_at FROM published_pages WHERE id = $1", page["parent_id"]
                )
                if not parent or T.is_trashed(parent) or not _owns(parent, user_id, auth_role):
                    await conn.execute("UPDATE published_pages SET parent_id = NULL WHERE id = $1", page_id)
    return {"ok": True, "restored": [str(i) for i in ids]}


@router.delete("/api/pages/{page_id}/forever")
async def delete_page_forever(page_id: PageId, request: Request, role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    pool = _pool()
    async with pool.acquire() as conn:
        await _require_ready(conn)
        page = await _load(conn, page_id, user_id, auth_role)
        if not T.is_trashed(page):
            raise HTTPException(409, "Only a page in the trash can be deleted forever")
        doomed = [r for r in await T.descendants(conn, page_id)
                  if T.is_trashed(r) and _owns(r, user_id, auth_role)]
        ids = [r["id"] for r in doomed]
        perf = await T.perf_ready(conn)
        async with conn.transaction():
            # The asset references come back from the DELETE itself (0006's
            # array, or the content before it), not from a second read.
            gone = await conn.fetch(
                "DELETE FROM published_pages WHERE id = ANY($1::uuid[]) "
                f"RETURNING id, {'asset_paths' if perf else 'content'}",
                ids,
            )
            # Rows of a database deleted here that were not in the trash with
            # it (restored on their own, or someone else's) are ordinary
            # pages now: no row marker pointing at nothing.
            dbs = [str(r["id"]) for r in doomed if r["content_type"] == D.CONTENT_TYPE]
            if dbs:
                await conn.execute(
                    "UPDATE published_pages SET metadata = metadata - 'db_row' - 'props' "
                    "WHERE metadata->>'db_row' = ANY($1::text[])",
                    dbs,
                )
    paths: list[str] = []
    for r in gone:  # best-effort, as for an ordinary delete; one reference check
        paths += list(r["asset_paths"] or []) if perf else _extract_asset_paths(r["content"])
    await _delete_asset_paths(paths)
    return {"ok": True, "deleted": [str(i) for i in ids]}


# ---------------------------------------------------------------------------
# Favourites
# ---------------------------------------------------------------------------

@router.put("/api/pages/{page_id}/favourite")
async def add_favourite(page_id: PageId, request: Request, role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    if not user_id:
        raise HTTPException(400, "Favourites need a signed-in account")
    pool = _pool()
    async with pool.acquire() as conn:
        await _require_ready(conn)
        await _load(conn, page_id, user_id, auth_role)
        await conn.execute(
            "INSERT INTO page_favourites (user_id, page_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            user_id, page_id,
        )
    return {"ok": True, "favourite": True}


@router.delete("/api/pages/{page_id}/favourite")
async def remove_favourite(page_id: PageId, request: Request, role: str = Depends(require_auth)):
    user_id, _ = _who(request, role)
    if not user_id:
        raise HTTPException(400, "Favourites need a signed-in account")
    pool = _pool()
    async with pool.acquire() as conn:
        await _require_ready(conn)
        await conn.execute(
            "DELETE FROM page_favourites WHERE user_id = $1 AND page_id = $2", user_id, page_id
        )
    return {"ok": True, "favourite": False}


# ---------------------------------------------------------------------------
# Around one page
# ---------------------------------------------------------------------------

@router.get("/api/pages/{page_id}/breadcrumbs")
async def page_breadcrumbs(page_id: PageId, request: Request, role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    pool = _pool()
    async with pool.acquire() as conn:
        if not await T.tree_ready(conn):
            await _load_flat(conn, page_id, user_id, auth_role)
            return []
        await _load(conn, page_id, user_id, auth_role)
        chain = await T.ancestors(conn, page_id)
    out = []
    for a in chain:
        if T.is_trashed(a) or not _owns(a, user_id, auth_role):
            break
        out.append({"id": str(a["id"]), "title": a["title"] or "", "slug": a["slug"], "icon": a["icon"]})
    out.reverse()
    return out


CHILDREN_LIMIT = 500


def _encode_cursor(row: Any) -> str:
    pos = row["position"]
    raw = json.dumps([pos if pos is not None else None, row["created_at"].isoformat(), str(row["id"])])
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[float, datetime, str]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        pos, created, rid = json.loads(raw)
        return (float("inf") if pos is None else float(pos), datetime.fromisoformat(created),
                str(uuid.UUID(rid)))
    except Exception:
        raise HTTPException(422, "Invalid cursor")


@router.get("/api/pages/{page_id}/children")
async def page_children(page_id: PageId, request: Request, role: str = Depends(require_auth),
                        limit: int = CHILDREN_LIMIT, cursor: str | None = None,
                        response: Response = None):
    """Direct sub-pages in order, at most `limit` (default and max 500). When
    more follow, the X-Next-Cursor header carries the cursor for the next
    call (?cursor=...)."""
    user_id, auth_role = _who(request, role)
    limit = max(1, min(int(limit or CHILDREN_LIMIT), CHILDREN_LIMIT))
    pool = _pool()
    async with pool.acquire() as conn:
        if not await T.tree_ready(conn):
            await _load_flat(conn, page_id, user_id, auth_role)
            return []
        await _load(conn, page_id, user_id, auth_role)
        args: list[Any] = [page_id, limit + 1]
        after = ""
        if cursor:
            pos, created, rid = _decode_cursor(cursor)
            args += [pos, created, rid]
            after = (" AND (COALESCE(p.position, 'Infinity'::float8), p.created_at, p.id) "
                     "> ($3::float8, $4::timestamptz, $5::uuid)")
        scope, sargs = _scope(auth_role, user_id, "p.created_by", len(args) + 1)
        rows = await conn.fetch(
            "SELECT p.id, p.slug, p.title, p.icon, p.parent_id, p.position, p.content_type, "
            "       p.is_published, p.updated_at, p.created_at, "
            "       EXISTS (SELECT 1 FROM published_pages c "
            "                WHERE c.parent_id = p.id AND c.deleted_at IS NULL) AS has_children "
            "  FROM published_pages p "
            f" WHERE p.parent_id = $1 AND p.deleted_at IS NULL{scope}{after} "
            " ORDER BY COALESCE(p.position, 'Infinity'::float8), p.created_at, p.id LIMIT $2",
            *args, *sargs,
        )
    more = len(rows) > limit
    rows = rows[:limit]
    if more and response is not None:
        response.headers["X-Next-Cursor"] = _encode_cursor(rows[-1])
    return [T.node(r) for r in rows]


CONTEXT_CHILDREN = 100


@router.get("/api/pages/{page_id}/context")
async def page_context(page_id: PageId, request: Request, role: str = Depends(require_auth),
                       children_limit: int = CONTEXT_CHILDREN):
    """What the editor shows around a page, in one database round trip:

      page               the page, exactly as GET /api/pages/{id}
      breadcrumbs        as GET /api/pages/{id}/breadcrumbs
      children           as GET /api/pages/{id}/children, the first
                         children_limit (default and max 100)
      children_has_more  true when more children exist (page through
                         /children with its cursor)
      row_context        as GET /api/databases/row-context/{id} when the page
                         is a row of a database the caller may open, else null
      open_thread_count  open comment threads on the page (0 before the
                         comments migration)
    """
    user_id, auth_role = _who(request, role)
    limit = max(1, min(int(children_limit or CONTEXT_CHILDREN), CONTEXT_CHILDREN))
    pool = _pool()
    async with pool.acquire() as conn:
        tree = await T.tree_ready(conn)
        comments = await page_comments.comments_ready(conn)
        open_sql = (
            "(SELECT count(*) FROM page_comments c WHERE c.page_id = p.id AND c.id = c.thread_id "
            " AND c.resolved_at IS NULL AND c.deleted_at IS NULL)" if comments else "0"
        )
        cols = await page_cols_for(conn, "p")
        if not tree:
            row = await conn.fetchrow(
                f"SELECT {cols}, {open_sql} AS _open FROM published_pages p WHERE p.id = $1", page_id)
            extras = None
        else:
            row = await conn.fetchrow(
                f"""
                SELECT {cols}, {open_sql} AS _open,
                  (WITH RECURSIVE up(id, depth) AS (
                       SELECT p.parent_id, 1 WHERE p.parent_id IS NOT NULL
                     UNION ALL
                       SELECT a.parent_id, up.depth + 1 FROM published_pages a JOIN up ON a.id = up.id
                        WHERE a.parent_id IS NOT NULL AND up.depth < {T.MAX_DEPTH})
                   SELECT COALESCE(json_agg(json_build_object(
                            'id', a.id, 'title', a.title, 'slug', a.slug, 'icon', a.icon,
                            'trashed', a.deleted_at IS NOT NULL, 'created_by', a.created_by)
                          ORDER BY up.depth), '[]'::json)
                     FROM up JOIN published_pages a ON a.id = up.id) AS _crumbs,
                  (SELECT COALESCE(json_agg(k ORDER BY k.o, k.created_at, k.id), '[]'::json) FROM (
                     SELECT c.id, c.slug, c.title, c.icon, c.parent_id, c.position, c.content_type,
                            c.is_published, c.updated_at, c.created_at,
                            COALESCE(c.position, 'Infinity'::float8) AS o,
                            EXISTS (SELECT 1 FROM published_pages g
                                     WHERE g.parent_id = c.id AND g.deleted_at IS NULL) AS has_children
                       FROM published_pages c
                      WHERE c.parent_id = p.id AND c.deleted_at IS NULL
                        AND ($3::uuid IS NULL OR c.created_by = $3::uuid)
                      ORDER BY COALESCE(c.position, 'Infinity'::float8), c.created_at, c.id
                      LIMIT $2) k) AS _children,
                  (SELECT json_build_object('id', d.id, 'title', d.title, 'icon', d.icon,
                                            'metadata', d.metadata, 'created_by', d.created_by)
                     FROM published_pages d
                    WHERE d.id = p.parent_id AND d.content_type = '{D.CONTENT_TYPE}') AS _db
                  FROM published_pages p WHERE p.id = $1
                """,
                page_id, limit + 1, None if _can_see_all(auth_role) else user_id,
            )
            extras = row
    if not row:
        raise HTTPException(404, "Page not found")
    if not _owns(row, user_id, auth_role):
        raise HTTPException(403, "Access denied")
    page = {k: v for k, v in dict(row).items() if not k.startswith("_")}
    out = {
        "page": _page_dict(page),
        "breadcrumbs": [],
        "children": [],
        "children_has_more": False,
        "row_context": None,
        "open_thread_count": int(row["_open"] or 0),
    }
    if extras is None:
        return out
    crumbs = []
    for a in _json(extras["_crumbs"]) or []:
        if a.get("trashed") or not _owns(a, user_id, auth_role):
            break
        crumbs.append({"id": str(a["id"]), "title": a["title"] or "", "slug": a["slug"], "icon": a["icon"]})
    crumbs.reverse()
    out["breadcrumbs"] = crumbs
    kids = _json(extras["_children"]) or []
    out["children_has_more"] = len(kids) > limit
    out["children"] = [T.node(k) for k in kids[:limit]]
    db = _json(extras["_db"])
    if db and _owns(db, user_id, auth_role):
        schema = D.schema_of(db.get("metadata"))
        out["row_context"] = {
            "database": {"id": str(db["id"]), "title": db["title"] or "", "icon": db["icon"], "database": schema},
            "row": D.row_dict({**page, "props": D.props_of(page.get("metadata"))}, schema),
        }
    return out


def _json(v: Any) -> Any:
    return json.loads(v) if isinstance(v, str) else v


async def _load_flat(conn, page_id: str, user_id, auth_role) -> None:
    """Ownership check that works before the migration (no tree columns)."""
    row = await conn.fetchrow("SELECT id, created_by FROM published_pages WHERE id = $1", page_id)
    if not row:
        raise HTTPException(404, "Page not found")
    if not _owns(row, user_id, auth_role):
        raise HTTPException(403, "Access denied")
