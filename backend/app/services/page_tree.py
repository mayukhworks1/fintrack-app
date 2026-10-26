"""
Pages as a tree: nesting, ordering, trash and the public family of a page.

Migration 0004 adds parent_id / position / icon / cover / deleted_at to
published_pages and the page_favourites table. Migrations run in a thread at
boot and may not have reached the database yet, so everything here asks
`tree_ready` first and degrades to the flat behaviour pages had before:
lists stay complete, the public viewer serves the page without a family, and
the tree's own writes answer 503 with a plain reason.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Iterable

logger = logging.getLogger("fintrack.page_tree")

NOT_READY = "Page tree storage is not ready (database migration 0004 has not run)."

# Deep enough for any real outline; a hard stop for the recursive queries in
# case a cycle ever got into the data by hand.
MAX_DEPTH = 64

# A failed readiness check is re-asked after this long, so the tree switches
# on by itself once the migration lands. A positive answer is kept for good.
_RETRY_S = 30.0
_ready: bool | None = None
_ready_checked_at = 0.0

_READY_SQL = """
SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_name = 'published_pages' AND column_name = 'deleted_at'
       )
   AND to_regclass('page_favourites') IS NOT NULL
"""


def reset_ready_cache() -> None:
    global _ready, _ready_checked_at
    _ready, _ready_checked_at = None, 0.0


async def tree_ready(conn) -> bool:
    """True once migration 0004's columns and table exist. Never raises."""
    global _ready, _ready_checked_at
    if _ready:
        return True
    if _ready is False and time.monotonic() - _ready_checked_at < _RETRY_S:
        return False
    try:
        ok = bool(await conn.fetchval(_READY_SQL))
    except Exception as exc:  # no database, a fake one, or a blip
        logger.debug("page tree readiness check failed: %s", exc)
        ok = False
    _ready, _ready_checked_at = ok, time.monotonic()
    return ok


def field(row: Any, key: str, default: Any = None) -> Any:
    """Read a column that may not exist yet (pre-migration rows, fakes)."""
    if row is None:
        return default
    try:
        return row[key]
    except (KeyError, IndexError, TypeError):
        return default


def is_trashed(row: Any) -> bool:
    return field(row, "deleted_at") is not None


def is_expired(row: Any) -> bool:
    exp = field(row, "expires_at")
    return bool(exp and exp <= datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

def would_cycle(page_id: str, new_parent_id: str | None, parent_of: dict[str, str | None]) -> bool:
    """Would hanging page_id under new_parent_id make a page its own ancestor?

    parent_of maps page id -> parent id for (at least) the new parent's chain.
    """
    if new_parent_id is None:
        return False
    seen: set[str] = set()
    cur: str | None = str(new_parent_id)
    while cur is not None and cur not in seen and len(seen) <= MAX_DEPTH:
        if cur == str(page_id):
            return True
        seen.add(cur)
        cur = parent_of.get(cur)
        cur = str(cur) if cur is not None else None
    return False


def position_between(before: float | None, after: float | None) -> float | None:
    """A position strictly between two neighbours, or None when they are too
    close to split and the siblings need renumbering."""
    if before is None and after is None:
        return 1024.0
    if before is None:
        return after - 1024.0
    if after is None:
        return before + 1024.0
    mid = (before + after) / 2.0
    if not (before < mid < after) or after - before < 1e-6:
        return None
    return mid


def place_at(sibling_positions: list[float | None], index: int) -> tuple[float, list[float] | None]:
    """Position for an item inserted at `index` among ordered siblings.

    Returns (position, renumbered) where renumbered is a fresh list of sibling
    positions when the gap had to be widened (or a sibling had none), else None.
    """
    index = max(0, min(index, len(sibling_positions)))
    renumber = any(p is None for p in sibling_positions)
    pos = None
    if not renumber:
        before = sibling_positions[index - 1] if index > 0 else None
        after = sibling_positions[index] if index < len(sibling_positions) else None
        pos = position_between(before, after)
    if pos is None:
        fresh = [float((i + 1) * 1024) for i in range(len(sibling_positions) + 1)]
        pos = fresh.pop(index)
        return pos, fresh
    return pos, None


def node(row: Any, visible_ids: set[str] | None = None, child_ids: set[str] | None = None) -> dict:
    """The lightweight shape the sidebar works with."""
    pid = field(row, "parent_id")
    pid = str(pid) if pid is not None else None
    if visible_ids is not None and pid is not None and pid not in visible_ids:
        pid = None  # parent is out of this user's sight: show at the top level
    rid = str(row["id"])
    updated = field(row, "updated_at")
    return {
        "id": rid,
        "slug": field(row, "slug"),
        "title": field(row, "title") or "",
        "icon": field(row, "icon"),
        "parent_id": pid,
        "position": field(row, "position"),
        "content_type": field(row, "content_type"),
        "is_published": bool(field(row, "is_published", False)),
        "updated_at": updated.isoformat() if isinstance(updated, datetime) else updated,
        "has_children": (rid in child_ids) if child_ids is not None else bool(field(row, "has_children", False)),
    }


def tree_nodes(rows: Iterable[Any]) -> list[dict]:
    rows = list(rows)
    ids = {str(r["id"]) for r in rows}
    parents = {str(field(r, "parent_id")) for r in rows if field(r, "parent_id") is not None}
    child_ids = ids & parents
    return [node(r, ids, child_ids) for r in rows]


# ---------------------------------------------------------------------------
# Queries shared by the routers
# ---------------------------------------------------------------------------

ANCESTORS_SQL = f"""
WITH RECURSIVE up(id, parent_id, depth) AS (
    SELECT id, parent_id, 0 FROM published_pages WHERE id = $1
  UNION ALL
    SELECT p.id, p.parent_id, up.depth + 1
      FROM published_pages p JOIN up ON p.id = up.parent_id
     WHERE up.depth < {MAX_DEPTH}
)
SELECT p.id, p.parent_id, p.title, p.slug, p.icon, p.is_published, p.deleted_at,
       p.expires_at, p.is_password_protected, p.created_by, up.depth
  FROM up JOIN published_pages p ON p.id = up.id
 ORDER BY up.depth
"""

DESCENDANTS_SQL = f"""
WITH RECURSIVE down(id, depth) AS (
    SELECT id, 0 FROM published_pages WHERE id = $1
  UNION ALL
    SELECT p.id, down.depth + 1
      FROM published_pages p JOIN down ON p.parent_id = down.id
     WHERE down.depth < {MAX_DEPTH}
)
SELECT p.id, p.deleted_at, p.content, p.created_by, down.depth
  FROM down JOIN published_pages p ON p.id = down.id
 ORDER BY down.depth
"""


async def ancestors(conn, page_id: str) -> list[Any]:
    """The page's chain upwards, nearest first, the page itself excluded."""
    rows = await conn.fetch(ANCESTORS_SQL, page_id)
    out, seen = [], {str(page_id)}
    for r in rows:
        rid = str(r["id"])
        if r["depth"] == 0:
            continue
        if rid in seen:  # a cycle that slipped in by hand: stop at it
            break
        seen.add(rid)
        out.append(r)
    return out


async def descendants(conn, page_id: str) -> list[Any]:
    """The page and everything under it, the page first."""
    rows = await conn.fetch(DESCENDANTS_SQL, page_id)
    out, seen = [], set()
    for r in rows:
        rid = str(r["id"])
        if rid not in seen:
            seen.add(rid)
            out.append(r)
    return out


def _publicly_visible(row: Any) -> bool:
    return bool(field(row, "is_published")) and not is_trashed(row) and not is_expired(row)


async def public_family(pool, row: Any) -> dict:
    """Published children and published ancestors of a public page.

    Empty before the migration (the row has no parent_id column) and on any
    error: the page itself must still be served.
    """
    try:
        row["parent_id"]
    except (KeyError, IndexError, TypeError):
        return {}
    if pool is None:
        return {}
    try:
        async with pool.acquire() as conn:
            kids = await conn.fetch(
                """
                SELECT slug, title, icon, is_published, deleted_at, expires_at
                  FROM published_pages
                 WHERE parent_id = $1 AND is_published AND deleted_at IS NULL
                 ORDER BY position NULLS LAST, created_at
                """,
                row["id"],
            )
            crumbs: list[dict] = []
            if row["parent_id"] is not None:
                # Only the unbroken run of published ancestors: an unpublished
                # page in between ends the trail, so nothing above it leaks.
                for a in await ancestors(conn, row["id"]):
                    if not _publicly_visible(a):
                        break
                    crumbs.append({"title": a["title"] or "Untitled", "slug": a["slug"], "icon": field(a, "icon")})
                crumbs.reverse()
    except Exception as exc:
        logger.warning("public page family lookup failed: %s", exc)
        return {}
    return {
        "children": [
            {"title": k["title"] or "Untitled", "slug": k["slug"], "icon": field(k, "icon")}
            for k in kids if _publicly_visible(k)
        ],
        "breadcrumbs": crumbs,
    }
