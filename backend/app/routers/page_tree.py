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
  GET    /api/pages/{id}/children         direct sub-pages

Ownership follows routers/pages.py exactly: a superadmin sees every page,
everyone else only the pages they created. A page whose parent the caller
cannot see shows at the caller's top level.

Included in the app before the pages router, because /api/pages/tree and its
siblings would otherwise be taken for /api/pages/{page_id}.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from ..db.postgres import get_pool
from ..services import page_tree as T
from .deps import require_auth
from .pages import (
    CreatePageBody,
    PageId,
    _can_see_all,
    _delete_page_assets,
    create_page,
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
    return _can_see_all(auth_role) or (user_id is not None and str(row["created_by"]) == str(user_id))


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
async def page_tree(request: Request, role: str = Depends(require_auth)):
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
            return {"ready": False, "pages": T.tree_nodes(rows), "favourites": []}
        scope, args = _scope(auth_role, user_id)
        rows = await conn.fetch(
            f"SELECT {_TREE_COLS} FROM published_pages "
            f"WHERE deleted_at IS NULL{scope} ORDER BY position NULLS LAST, created_at",
            *args,
        )
        favs = []
        if user_id:
            favs = await conn.fetch(
                "SELECT page_id FROM page_favourites WHERE user_id = $1 ORDER BY created_at",
                user_id,
            )
    visible = {str(r["id"]) for r in rows}
    return {
        "ready": True,
        "pages": T.tree_nodes(rows),
        "favourites": [str(f["page_id"]) for f in favs if str(f["page_id"]) in visible],
    }


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
        rows = await conn.fetch(
            f"SELECT p.id, p.slug, p.title, {icon}, p.content_type, p.is_published, p.updated_at, "
            "       GREATEST(p.updated_at, COALESCE(v.seen, p.updated_at)) AS touched "
            "  FROM published_pages p "
            "  LEFT JOIN LATERAL (SELECT MAX(viewed_at) AS seen FROM page_views "
            "                      WHERE page_id = p.id AND viewer_user_id = $1) v ON TRUE "
            f" WHERE TRUE{trash}{scope} ORDER BY touched DESC LIMIT $2",
            user_id, limit, *args,
        )
    return [T.node(r) for r in rows]


# ---------------------------------------------------------------------------
# Structure
# ---------------------------------------------------------------------------

@router.post("/api/pages/{page_id}/move")
async def move_page(page_id: PageId, body: MoveBody, request: Request, role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    parent_id = _uuid_or_422(body.parent_id, "parent_id") if body.parent_id else None
    pool = _pool()
    async with pool.acquire() as conn:
        await _require_ready(conn)
        page = await _load(conn, page_id, user_id, auth_role)
        if T.is_trashed(page):
            raise HTTPException(409, "Restore the page from the trash before moving it")
        if parent_id is not None:
            if parent_id == page_id:
                raise HTTPException(409, "A page cannot be moved inside itself")
            parent = await _load(conn, parent_id, user_id, auth_role)
            if T.is_trashed(parent):
                raise HTTPException(409, "The destination page is in the trash")
            chain = await T.ancestors(conn, parent_id)
            parent_of = {str(parent["id"]): parent["parent_id"]}
            parent_of.update({str(a["id"]): a["parent_id"] for a in chain})
            if T.would_cycle(page_id, parent_id, parent_of):
                raise HTTPException(409, "A page cannot be moved inside one of its own sub-pages")

        async with conn.transaction():
            renumbered = None
            if body.position is not None:
                pos = float(body.position)
            else:
                scope, sargs = _scope(auth_role, user_id, "created_by", 3)
                siblings = await conn.fetch(
                    "SELECT id, position FROM published_pages "
                    "WHERE parent_id IS NOT DISTINCT FROM $1::uuid AND deleted_at IS NULL AND id <> $2"
                    f"{scope} ORDER BY position NULLS LAST, created_at",
                    parent_id, page_id, *sargs,
                )
                index = len(siblings) if body.index is None else body.index
                pos, renumbered = T.place_at([s["position"] for s in siblings], index)
                if renumbered:
                    await conn.executemany(
                        "UPDATE published_pages SET position = $1 WHERE id = $2",
                        [(p, s["id"]) for p, s in zip(renumbered, siblings)],
                    )
            row = await conn.fetchrow(
                f"UPDATE published_pages SET parent_id = $1::uuid, position = $2 WHERE id = $3 "
                f"RETURNING {_TREE_COLS}",
                parent_id, pos, page_id,
            )
    return T.node(row)


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
    # The ordinary create path (slug, inline images, ownership), then hang it
    # under the parent. position's default puts it after existing siblings.
    created = await create_page(body, request, role)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE published_pages SET parent_id = $1 WHERE id = $2 RETURNING parent_id, position, icon",
            page_id, created["id"],
        )
    created.update({
        "parent_id": str(row["parent_id"]) if row and row["parent_id"] else page_id,
        "position": row["position"] if row else None,
    })
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
        await _load(conn, page_id, user_id, auth_role)
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
        now = datetime.now(timezone.utc)
        # The whole subtree goes with it, stamped with the same moment so a
        # restore brings back exactly what went in together. Pages under it
        # that belong to someone else stay where they are.
        ids = [r["id"] for r in await T.descendants(conn, page_id)
               if r["deleted_at"] is None and _owns(r, user_id, auth_role)]
        await conn.execute(
            "UPDATE published_pages SET deleted_at = $1 WHERE id = ANY($2::uuid[])", now, ids
        )
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
        await conn.execute(
            "DELETE FROM published_pages WHERE id = ANY($1::uuid[])", [r["id"] for r in doomed]
        )
    for r in doomed:  # best-effort, as for an ordinary delete
        await _delete_page_assets(r["content"])
    return {"ok": True, "deleted": [str(r["id"]) for r in doomed]}


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


@router.get("/api/pages/{page_id}/children")
async def page_children(page_id: PageId, request: Request, role: str = Depends(require_auth)):
    user_id, auth_role = _who(request, role)
    pool = _pool()
    async with pool.acquire() as conn:
        if not await T.tree_ready(conn):
            await _load_flat(conn, page_id, user_id, auth_role)
            return []
        await _load(conn, page_id, user_id, auth_role)
        scope, args = _scope(auth_role, user_id, "p.created_by", 2)
        rows = await conn.fetch(
            "SELECT p.id, p.slug, p.title, p.icon, p.parent_id, p.position, p.content_type, "
            "       p.is_published, p.updated_at, "
            "       EXISTS (SELECT 1 FROM published_pages c "
            "                WHERE c.parent_id = p.id AND c.deleted_at IS NULL) AS has_children "
            "  FROM published_pages p "
            f" WHERE p.parent_id = $1 AND p.deleted_at IS NULL{scope} "
            " ORDER BY p.position NULLS LAST, p.created_at",
            page_id, *args,
        )
    return [T.node(r) for r in rows]


async def _load_flat(conn, page_id: str, user_id, auth_role) -> None:
    """Ownership check that works before the migration (no tree columns)."""
    row = await conn.fetchrow("SELECT id, created_by FROM published_pages WHERE id = $1", page_id)
    if not row:
        raise HTTPException(404, "Page not found")
    if not _owns(row, user_id, auth_role):
        raise HTTPException(403, "Access denied")
