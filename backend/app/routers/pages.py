"""
Content Publishing / Pages router.

Prefixes:
  /api/pages        — authenticated CRUD + analytics
  /api/public/pages — unauthenticated read + view logging
"""

from __future__ import annotations

import asyncio
import hashlib
import re
import secrets
import string
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from ..db.postgres import get_pool
from .deps import require_auth

router = APIRouter()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _slugify(text: str) -> str:
    s = text.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_-]+", "-", s)
    s = s.strip("-")[:80]
    return s or "page"


def _random_suffix(n: int = 6) -> str:
    return "".join(
        secrets.choice(string.ascii_lowercase + string.digits) for _ in range(n)
    )


def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def _get_client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else ""


async def _geo_lookup(ip: str) -> dict:
    if not ip or ip in ("127.0.0.1", "::1", "localhost"):
        return {}
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            r = await c.get(
                f"http://ip-api.com/json/{ip}?fields=country,city,regionName,isp"
            )
            if r.status_code == 200:
                d = r.json()
                return {
                    "country": d.get("country", ""),
                    "city": d.get("city", ""),
                    "region": d.get("regionName", ""),
                    "isp": d.get("isp", ""),
                }
    except Exception:
        pass
    return {}


async def _log_view_bg(
    page_id: str,
    ip: str,
    user_agent: str,
    referer: str,
    viewer_user_id: str | None,
) -> None:
    """Fire-and-forget: geo lookup + insert page_view + increment view_count."""
    pool = get_pool()
    if not pool:
        return
    geo = await _geo_lookup(ip)
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO page_views
                    (page_id, viewer_ip, user_agent, referer, country, city, region, isp, viewer_user_id)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                """,
                page_id,
                ip,
                user_agent,
                referer,
                geo.get("country"),
                geo.get("city"),
                geo.get("region"),
                geo.get("isp"),
                viewer_user_id,
            )
            await conn.execute(
                "UPDATE published_pages SET view_count = view_count + 1 WHERE id = $1",
                page_id,
            )
    except Exception:
        pass


def _is_privileged(role: str) -> bool:
    return role in ("superadmin", "admin", "manager")


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class CreatePageBody(BaseModel):
    title: str
    content_type: str = "markdown"
    content: str = ""
    slug: str | None = None
    metadata: dict = {}
    is_password_protected: bool = False
    password: str | None = None
    expires_at: str | None = None


class UpdatePageBody(BaseModel):
    title: str | None = None
    content_type: str | None = None
    content: str | None = None
    slug: str | None = None
    metadata: dict | None = None
    is_password_protected: bool | None = None
    password: str | None = None
    expires_at: str | None = None


class PublishBody(BaseModel):
    published: bool


class VerifyPasswordBody(BaseModel):
    password: str


class LogViewBody(BaseModel):
    referer: str = ""


# ---------------------------------------------------------------------------
# Authenticated endpoints
# ---------------------------------------------------------------------------

@router.post("/api/pages/")
async def create_page(
    body: CreatePageBody,
    request: Request,
    role: str = Depends(require_auth),
):
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")

    user_id = getattr(request.state, "auth_user_id", None)

    # Slug resolution
    base_slug = _slugify(body.slug or body.title)
    slug = base_slug

    async with pool.acquire() as conn:
        # Check slug uniqueness, append suffix if taken
        existing = await conn.fetchval(
            "SELECT id FROM published_pages WHERE slug = $1", slug
        )
        if existing:
            slug = f"{base_slug}-{_random_suffix()}"

        pw_hash = _hash_password(body.password) if body.is_password_protected and body.password else None

        expires_at = None
        if body.expires_at:
            try:
                expires_at = datetime.fromisoformat(body.expires_at.replace("Z", "+00:00"))
            except ValueError:
                pass

        row = await conn.fetchrow(
            """
            INSERT INTO published_pages
                (slug, title, content_type, content, metadata,
                 is_password_protected, password_hash, created_by, updated_by, expires_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9)
            RETURNING *
            """,
            slug,
            body.title,
            body.content_type,
            body.content,
            body.metadata or {},
            body.is_password_protected,
            pw_hash,
            user_id,
            expires_at,
        )
        return _page_dict(row)


@router.get("/api/pages/")
async def list_pages(
    request: Request,
    role: str = Depends(require_auth),
):
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")

    user_id = getattr(request.state, "auth_user_id", None)
    auth_role = getattr(request.state, "auth_role", role) or role

    async with pool.acquire() as conn:
        if _is_privileged(auth_role):
            rows = await conn.fetch(
                """
                SELECT id, slug, title, content_type, is_published, view_count,
                       created_at, updated_at, published_at, expires_at,
                       is_password_protected, created_by, metadata
                FROM published_pages
                ORDER BY created_at DESC
                """
            )
        else:
            rows = await conn.fetch(
                """
                SELECT id, slug, title, content_type, is_published, view_count,
                       created_at, updated_at, published_at, expires_at,
                       is_password_protected, created_by, metadata
                FROM published_pages
                WHERE created_by = $1
                ORDER BY created_at DESC
                """,
                user_id,
            )
    return [_page_list_dict(r) for r in rows]


@router.get("/api/pages/admin/all-views")
async def admin_all_views(
    request: Request,
    limit: int = 50,
    offset: int = 0,
    role: str = Depends(require_auth),
):
    auth_role = getattr(request.state, "auth_role", role) or role
    if not _is_privileged(auth_role):
        raise HTTPException(403, "Admin access required")

    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT pv.id, pv.page_id, pp.title, pp.slug,
                   pv.viewer_ip, pv.country, pv.city, pv.region, pv.isp,
                   pv.user_agent, pv.referer, pv.viewed_at
            FROM page_views pv
            JOIN published_pages pp ON pp.id = pv.page_id
            ORDER BY pv.viewed_at DESC
            LIMIT $1 OFFSET $2
            """,
            limit,
            offset,
        )
        total = await conn.fetchval("SELECT COUNT(*) FROM page_views")
    return {"total": total, "items": [dict(r) for r in rows]}


@router.get("/api/pages/{page_id}")
async def get_page(
    page_id: str,
    request: Request,
    role: str = Depends(require_auth),
):
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")

    user_id = getattr(request.state, "auth_user_id", None)
    auth_role = getattr(request.state, "auth_role", role) or role

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM published_pages WHERE id = $1", page_id
        )
    if not row:
        raise HTTPException(404, "Page not found")
    if not _is_privileged(auth_role) and str(row["created_by"]) != str(user_id):
        raise HTTPException(403, "Access denied")
    return _page_dict(row)


@router.put("/api/pages/{page_id}")
async def update_page(
    page_id: str,
    body: UpdatePageBody,
    request: Request,
    role: str = Depends(require_auth),
):
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")

    user_id = getattr(request.state, "auth_user_id", None)
    auth_role = getattr(request.state, "auth_role", role) or role

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM published_pages WHERE id = $1", page_id
        )
        if not row:
            raise HTTPException(404, "Page not found")
        if not _is_privileged(auth_role) and str(row["created_by"]) != str(user_id):
            raise HTTPException(403, "Access denied")

        # Build update fields
        updates: dict[str, Any] = {"updated_at": datetime.now(timezone.utc), "updated_by": user_id}
        if body.title is not None:
            updates["title"] = body.title
        if body.content_type is not None:
            updates["content_type"] = body.content_type
        if body.content is not None:
            updates["content"] = body.content
        if body.metadata is not None:
            updates["metadata"] = body.metadata
        if body.is_password_protected is not None:
            updates["is_password_protected"] = body.is_password_protected
        if body.password is not None:
            updates["password_hash"] = _hash_password(body.password)
        if body.expires_at is not None:
            try:
                updates["expires_at"] = datetime.fromisoformat(body.expires_at.replace("Z", "+00:00"))
            except ValueError:
                pass

        # Slug update with uniqueness check
        if body.slug is not None:
            new_slug = _slugify(body.slug)
            existing = await conn.fetchval(
                "SELECT id FROM published_pages WHERE slug = $1 AND id != $2",
                new_slug,
                page_id,
            )
            if existing:
                new_slug = f"{new_slug}-{_random_suffix()}"
            updates["slug"] = new_slug

        # Build dynamic SET clause
        set_parts = [f"{k} = ${i+1}" for i, k in enumerate(updates.keys())]
        values = list(updates.values())
        values.append(page_id)
        query = f"UPDATE published_pages SET {', '.join(set_parts)} WHERE id = ${len(values)} RETURNING *"
        updated = await conn.fetchrow(query, *values)
    return _page_dict(updated)


@router.delete("/api/pages/{page_id}")
async def delete_page(
    page_id: str,
    request: Request,
    role: str = Depends(require_auth),
):
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")

    user_id = getattr(request.state, "auth_user_id", None)
    auth_role = getattr(request.state, "auth_role", role) or role

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, created_by FROM published_pages WHERE id = $1", page_id
        )
        if not row:
            raise HTTPException(404, "Page not found")
        if not _is_privileged(auth_role) and str(row["created_by"]) != str(user_id):
            raise HTTPException(403, "Access denied")
        await conn.execute("DELETE FROM published_pages WHERE id = $1", page_id)
    return {"ok": True}


@router.post("/api/pages/{page_id}/publish")
async def publish_page(
    page_id: str,
    body: PublishBody,
    request: Request,
    role: str = Depends(require_auth),
):
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")

    user_id = getattr(request.state, "auth_user_id", None)
    auth_role = getattr(request.state, "auth_role", role) or role

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, created_by FROM published_pages WHERE id = $1", page_id
        )
        if not row:
            raise HTTPException(404, "Page not found")
        if not _is_privileged(auth_role) and str(row["created_by"]) != str(user_id):
            raise HTTPException(403, "Access denied")

        published_at = datetime.now(timezone.utc) if body.published else None
        updated = await conn.fetchrow(
            """
            UPDATE published_pages
            SET is_published = $1,
                published_at = CASE WHEN $1 = TRUE AND published_at IS NULL THEN $2 ELSE published_at END,
                updated_at   = $2
            WHERE id = $3
            RETURNING *
            """,
            body.published,
            datetime.now(timezone.utc),
            page_id,
        )
    return _page_dict(updated)


@router.get("/api/pages/{page_id}/analytics")
async def page_analytics(
    page_id: str,
    request: Request,
    limit: int = 50,
    offset: int = 0,
    role: str = Depends(require_auth),
):
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")

    user_id = getattr(request.state, "auth_user_id", None)
    auth_role = getattr(request.state, "auth_role", role) or role

    async with pool.acquire() as conn:
        page = await conn.fetchrow(
            "SELECT id, created_by FROM published_pages WHERE id = $1", page_id
        )
        if not page:
            raise HTTPException(404, "Page not found")
        if not _is_privileged(auth_role) and str(page["created_by"]) != str(user_id):
            raise HTTPException(403, "Access denied")

        rows = await conn.fetch(
            """
            SELECT id, viewer_ip, country, city, region, isp,
                   user_agent, referer, viewed_at, metadata
            FROM page_views
            WHERE page_id = $1
            ORDER BY viewed_at DESC
            LIMIT $2 OFFSET $3
            """,
            page_id,
            limit,
            offset,
        )
        total = await conn.fetchval(
            "SELECT COUNT(*) FROM page_views WHERE page_id = $1", page_id
        )
    return {"total": total, "items": [dict(r) for r in rows]}


# ---------------------------------------------------------------------------
# Public endpoints
# ---------------------------------------------------------------------------

@router.get("/api/public/pages/{slug}")
async def public_get_page(slug: str, request: Request):
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM published_pages WHERE slug = $1", slug
        )

    if not row:
        raise HTTPException(404, "Page not found")
    if not row["is_published"]:
        raise HTTPException(404, "Page not found")
    if row["expires_at"] and row["expires_at"] < datetime.now(timezone.utc):
        raise HTTPException(410, "Page has expired")

    if row["is_password_protected"]:
        return {
            "requires_password": True,
            "title": row["title"],
            "id": str(row["id"]),
            "slug": row["slug"],
        }

    return _public_page_dict(row)


@router.post("/api/public/pages/{slug}/verify")
async def public_verify_password(slug: str, body: VerifyPasswordBody):
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM published_pages WHERE slug = $1", slug
        )

    if not row or not row["is_published"]:
        raise HTTPException(404, "Page not found")
    if row["expires_at"] and row["expires_at"] < datetime.now(timezone.utc):
        raise HTTPException(410, "Page has expired")

    if not row["is_password_protected"]:
        return _public_page_dict(row)

    if _hash_password(body.password) != (row["password_hash"] or ""):
        raise HTTPException(401, "Incorrect password")

    return _public_page_dict(row)


@router.post("/api/public/pages/{slug}/view")
async def public_log_view(slug: str, body: LogViewBody, request: Request):
    pool = get_pool()
    if not pool:
        return {"ok": True}

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, is_published FROM published_pages WHERE slug = $1", slug
        )

    if not row or not row["is_published"]:
        return {"ok": True}

    ip = _get_client_ip(request)
    ua = request.headers.get("user-agent", "")
    page_id = str(row["id"])

    # Fire-and-forget
    asyncio.create_task(_log_view_bg(page_id, ip, ua, body.referer, None))
    return {"ok": True}


# ---------------------------------------------------------------------------
# Serialisation helpers
# ---------------------------------------------------------------------------

def _page_dict(row) -> dict:
    d = dict(row)
    d["id"] = str(d["id"])
    if d.get("created_by"):
        d["created_by"] = str(d["created_by"])
    if d.get("updated_by"):
        d["updated_by"] = str(d["updated_by"])
    # Remove password_hash from response
    d.pop("password_hash", None)
    return d


def _page_list_dict(row) -> dict:
    d = dict(row)
    d["id"] = str(d["id"])
    if d.get("created_by"):
        d["created_by"] = str(d["created_by"])
    return d


def _public_page_dict(row) -> dict:
    return {
        "id": str(row["id"]),
        "slug": row["slug"],
        "title": row["title"],
        "content_type": row["content_type"],
        "content": row["content"],
        "published_at": row["published_at"].isoformat() if row["published_at"] else None,
        "metadata": row["metadata"] or {},
    }
