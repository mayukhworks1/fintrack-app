"""
Content Publishing / Pages router.

Prefixes:
  /api/pages        — authenticated CRUD + analytics
  /api/public/pages — unauthenticated read + view logging
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import re
import secrets
import string
import time
from datetime import datetime, timezone
from typing import Any

import httpx
from ..utils.http import shared_client
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, Response, StreamingResponse
from pydantic import BaseModel

from ..config import settings
from ..db import valkey as vk
from ..db.postgres import get_pool
from ..services import page_design
from ..services.page_ai import generate_page, analyze_prompt_needs, stream_generate_page, edit_page_section, fix_page_script_error
from ..services import page_render
from .deps import require_auth

router = APIRouter()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# --- editor preview store ---------------------------------------------------
#
# Short-lived, because a preview only has to survive the round trip from the
# editor's iframe. Valkey keeps it working across workers; the in-process copy
# keeps it working when Valkey is not configured at all, which is the common
# single-worker deployment.
PREVIEW_TTL_SECONDS = 900
MAX_PREVIEW_CHARS = 400_000
_PREVIEW_KEY = "pagepreview:"
_preview_local: dict[str, tuple[float, str]] = {}


def _preview_sweep() -> None:
    now = time.time()
    for tok in [t for t, (exp, _) in _preview_local.items() if exp < now]:
        _preview_local.pop(tok, None)


async def _preview_put(token: str, content: str) -> None:
    _preview_sweep()
    _preview_local[token] = (time.time() + PREVIEW_TTL_SECONDS, content)
    await vk.cache_set(_PREVIEW_KEY + token, content, PREVIEW_TTL_SECONDS)


async def _preview_get(token: str) -> str | None:
    _preview_sweep()
    hit = _preview_local.get(token)
    if hit:
        return hit[1]
    value = await vk.cache_get(_PREVIEW_KEY + token)
    return value if isinstance(value, str) else None


# --- unlock tokens for password-protected pages ------------------------------
#
# The renderer serves the document directly to an iframe, so it cannot be
# handed a password. Verifying the password mints a short-lived token instead,
# and the renderer accepts nothing else for a protected page.
RENDER_TOKEN_TTL_SECONDS = 6 * 60 * 60


def _render_token(slug: str, ttl: int = RENDER_TOKEN_TTL_SECONDS) -> str:
    expiry = int(time.time()) + ttl
    payload = f"{expiry}:{slug}"
    sig = hmac.new(settings.app_secret.encode(), payload.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{expiry}.{sig}"


def _render_token_valid(slug: str, token: str | None) -> bool:
    if not token or "." not in token:
        return False
    expiry_raw, _, sig = token.partition(".")
    try:
        expiry = int(expiry_raw)
    except ValueError:
        return False
    if expiry < time.time():
        return False
    expected = hmac.new(
        settings.app_secret.encode(), f"{expiry}:{slug}".encode(), hashlib.sha256
    ).hexdigest()[:32]
    return hmac.compare_digest(sig, expected)


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
        fields = "status,country,countryCode,regionName,city,zip,lat,lon,timezone,isp,org,as,query"
        async with shared_client(timeout=4) as c:
            r = await c.get(f"http://ip-api.com/json/{ip}?fields={fields}")
            if r.status_code == 200:
                d = r.json()
                if d.get("status") == "success":
                    return {
                        "country":      d.get("country", ""),
                        "country_code": d.get("countryCode", ""),
                        "city":         d.get("city", ""),
                        "region":       d.get("regionName", ""),
                        "zip":          d.get("zip", ""),
                        "lat":          d.get("lat"),
                        "lon":          d.get("lon"),
                        "timezone":     d.get("timezone", ""),
                        "isp":          d.get("isp", ""),
                        "org":          d.get("org", ""),
                        "as":           d.get("as", ""),
                    }
    except Exception:
        pass
    return {}


async def _reverse_geocode(lat: float, lon: float) -> dict:
    """Resolve precise GPS coords to a place name via OpenStreetMap Nominatim.

    Best-effort — returns {} on any failure. Nominatim requires a descriptive
    User-Agent and is rate-limited to ~1 req/s, which is fine for page views.
    """
    try:
        async with shared_client(timeout=5) as c:
            r = await c.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={"lat": lat, "lon": lon, "format": "jsonv2", "zoom": 16, "addressdetails": 1},
                headers={"User-Agent": "FinTrack-Pages/1.0 (analytics)"},
            )
            if r.status_code == 200:
                d = r.json()
                a = d.get("address", {}) or {}
                return {
                    "country":      a.get("country", ""),
                    "country_code": (a.get("country_code", "") or "").upper(),
                    "city":         a.get("city") or a.get("town") or a.get("village") or a.get("municipality", ""),
                    "region":       a.get("state") or a.get("region", ""),
                    "zip":          a.get("postcode", ""),
                    "suburb":       a.get("suburb") or a.get("neighbourhood", ""),
                    "road":         a.get("road", ""),
                    "display_name": d.get("display_name", ""),
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
    client_meta: dict | None = None,
) -> None:
    """Fire-and-forget: geo lookup + insert page_view + increment view_count."""
    pool = get_pool()
    if not pool:
        return
    geo = await _geo_lookup(ip)
    cm = client_meta or {}

    # GPS — present only when the visitor's browser already had location
    # permission granted (the frontend never prompts). When available it is far
    # more precise than IP geo, so we reverse-geocode it and treat it as the
    # authoritative location.
    gps = None
    g_lat, g_lon = cm.get("gps_lat"), cm.get("gps_lon")
    if g_lat is not None and g_lon is not None:
        rev = await _reverse_geocode(float(g_lat), float(g_lon))
        gps = {
            "lat":      g_lat,
            "lon":      g_lon,
            "accuracy": cm.get("gps_accuracy"),
            **rev,
        }

    # Unified location block: GPS wins over IP when present.
    location_source = "gps" if gps else ("ip" if geo else "unknown")
    location = {
        "source":       location_source,
        "lat":          (gps or {}).get("lat", geo.get("lat")),
        "lon":          (gps or {}).get("lon", geo.get("lon")),
        "accuracy_m":   (gps or {}).get("accuracy"),
        "country":      (gps or {}).get("country") or geo.get("country", ""),
        "country_code": (gps or {}).get("country_code") or geo.get("country_code", ""),
        "city":         (gps or {}).get("city") or geo.get("city", ""),
        "region":       (gps or {}).get("region") or geo.get("region", ""),
        "zip":          (gps or {}).get("zip") or geo.get("zip", ""),
        "display_name": (gps or {}).get("display_name", ""),
    }

    meta = {
        # Full IP geo (always attempted)
        "geo": geo,
        # GPS (only when permission already granted)
        "gps": gps,
        # Resolved best-available location
        "location": location,
        # Client-side metadata sent by browser
        "client": cm,
    }
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO page_views
                    (page_id, viewer_ip, user_agent, referer, country, city, region, isp, viewer_user_id, metadata)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                """,
                page_id,
                ip,
                user_agent,
                referer,
                location.get("country") or geo.get("country"),
                location.get("city") or geo.get("city"),
                location.get("region") or geo.get("region"),
                geo.get("isp"),
                viewer_user_id,
                json.dumps(meta),
            )
            await conn.execute(
                "UPDATE published_pages SET view_count = view_count + 1 WHERE id = $1",
                page_id,
            )
    except Exception:
        pass


def _is_privileged(role: str) -> bool:
    return role in ("superadmin", "admin", "manager")


def _can_see_all(role: str) -> bool:
    """Only the superadmin sees/manages every user's pages. Everyone else is
    scoped to the pages they created (row-level isolation)."""
    return role == "superadmin"


_ASSET_PATH_RE = re.compile(r"/api/public/pages/asset/([^\s)\"'<>]+)")


def _extract_asset_paths(content: str | None) -> list[str]:
    """Pull stored HF asset paths (pages/...) referenced in a page's content."""
    if not content:
        return []
    out: list[str] = []
    for m in _ASSET_PATH_RE.finditer(content):
        p = m.group(1).split("?")[0].split("#")[0]
        if p.startswith("pages/") and ".." not in p and p not in out:
            out.append(p)
    return out


def _word_count(text: str | None) -> int:
    if not text:
        return 0
    return len(text.split())


async def _snapshot_version(conn, page_id: str, row: Any, user_id: str | None) -> None:
    """Insert a version snapshot, throttled to at most once per 5 minutes per page.

    Called from update_page before applying changes so the snapshot captures
    what the page looked like BEFORE this edit.
    """
    try:
        last = await conn.fetchrow(
            "SELECT saved_at FROM page_versions WHERE page_id = $1 ORDER BY saved_at DESC LIMIT 1",
            page_id,
        )
        if last:
            age = (datetime.now(timezone.utc) - last["saved_at"]).total_seconds()
            if age < 300:  # 5-minute throttle: don't spam versions on every auto-save
                return

        last_num = await conn.fetchval(
            "SELECT COALESCE(MAX(version_num), 0) FROM page_versions WHERE page_id = $1",
            page_id,
        )
        await conn.execute(
            """
            INSERT INTO page_versions
                (page_id, version_num, title, content, content_type, metadata, saved_by, word_count)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
            page_id,
            last_num + 1,
            row["title"],
            row["content"],
            row["content_type"],
            row["metadata"] if isinstance(row["metadata"], str) else json.dumps(row["metadata"] or {}),
            user_id,
            _word_count(row["content"]),
        )
    except Exception:
        pass  # best-effort; never block the actual save


async def _delete_page_assets(content: str | None) -> None:
    """Best-effort: remove a page's uploaded attachments from HF storage."""
    paths = _extract_asset_paths(content)
    if not paths:
        return
    from ..services import storage
    for p in paths:
        try:
            await storage.delete_path(p)
        except Exception:
            pass


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


class RestoreVersionBody(BaseModel):
    note: str | None = None


class VerifyPasswordBody(BaseModel):
    password: str


class LogViewBody(BaseModel):
    referer: str = ""
    # Client-side metadata (sent by browser JS)
    screen_width:   int | None = None
    screen_height:  int | None = None
    viewport_width: int | None = None
    viewport_height:int | None = None
    color_depth:    int | None = None
    pixel_ratio:    float | None = None
    language:       str | None = None
    languages:      list[str] | None = None
    timezone:       str | None = None
    platform:       str | None = None
    touch_support:  bool | None = None
    cookie_enabled: bool | None = None
    do_not_track:   str | None = None
    connection_type:str | None = None
    connection_downlink: float | None = None
    page_url:       str | None = None
    utm_source:     str | None = None
    utm_medium:     str | None = None
    utm_campaign:   str | None = None
    # GPS — only sent when the browser already had location permission granted
    gps_lat:        float | None = None
    gps_lon:        float | None = None
    gps_accuracy:   float | None = None


class PreviewBody(BaseModel):
    content: str = ""


class AIGenerateBody(BaseModel):
    prompt:       str
    content_type: str = "html"
    # Which visual direction to build in. Omitted lets the server pick from
    # the brief, which is better than every page looking the same.
    style:        str | None = None
    # When present the model revises this document instead of starting fresh,
    # which is what lets an author iterate on a design across several prompts.
    existing:     str | None = None


class AIInterviewBody(BaseModel):
    prompt: str
    content_type: str = "html"


class AIStreamBody(BaseModel):
    prompt: str
    content_type: str = "html"
    existing: str | None = None
    clarifications: dict | None = None


class AISectionEditBody(BaseModel):
    content: str
    section_id: str
    prompt: str


class AIFixErrorBody(BaseModel):
    content: str
    error: dict


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
            json.dumps(body.metadata or {}),
            body.is_password_protected,
            pw_hash,
            user_id,
            expires_at,
        )
        return _page_dict(row)


@router.get("/api/pages/ai/styles")
async def list_styles(role: str = Depends(require_auth)):
    """The design directions a page can be generated in."""
    return {"styles": page_design.catalogue()}


@router.post("/api/pages/ai-generate")
async def ai_generate_page(
    body: AIGenerateBody,
    request: Request,
    role: str = Depends(require_auth),
):
    """
    Generate or revise page content from a prompt.

    Returns the document only — nothing is persisted. The author reviews it in
    the editor and decides whether to keep it, so a poor generation can never
    overwrite a published page on its own.
    """
    try:
        result = await generate_page(
            prompt=body.prompt,
            content_type=body.content_type,
            existing=body.existing,
            style=body.style,
        )
    except ValueError as e:
        # Prompt/validation problems are the caller's to fix, not server faults.
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Page generation failed: {e}")

    return {
        "content":     result["content"],
        "model":       result["model_short"] or result["model"],
        # Names anything in the generated markup that publishes badly — a
        # relative file path, content hidden until a script reveals it — so the
        # author is told up front rather than discovering it after publishing.
        "warnings":    result["warnings"],
        "content_type": body.content_type,
    }


@router.post("/api/pages/ai/interview")
async def ai_interview(
    body: AIInterviewBody,
    request: Request,
    role: str = Depends(require_auth),
):
    """Analyse a prompt and return clarifying questions if needed."""
    try:
        result = await analyze_prompt_needs(
            prompt=body.prompt,
            content_type=body.content_type,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Interview analysis failed: {e}")
    return result


@router.post("/api/pages/ai/stream")
async def ai_stream_page(
    body: AIStreamBody,
    request: Request,
    role: str = Depends(require_auth),
):
    """Stream page generation as SSE events."""
    async def event_stream():
        try:
            async for frame in stream_generate_page(
                prompt=body.prompt,
                content_type=body.content_type,
                existing=body.existing,
                clarifications=body.clarifications,
            ):
                yield f"data: {json.dumps(frame)}\n\n"
        except ValueError as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': f'Generation failed: {e}'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/api/pages/ai/section-edit")
async def ai_section_edit(
    body: AISectionEditBody,
    request: Request,
    role: str = Depends(require_auth),
):
    """Surgically edit a single section of a page."""
    try:
        result = await edit_page_section(
            full_html=body.content,
            section_id=body.section_id,
            prompt=body.prompt,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Section edit failed: {e}")
    return result


@router.post("/api/pages/ai/fix-error")
async def ai_fix_error(
    body: AIFixErrorBody,
    request: Request,
    role: str = Depends(require_auth),
):
    """Attempt to fix a runtime JavaScript error in a page."""
    try:
        result = await fix_page_script_error(
            full_html=body.content,
            error_details=body.error,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error fix failed: {e}")
    return result


@router.post("/api/pages/preview")
async def create_page_preview(body: PreviewBody, role: str = Depends(require_auth)):
    """
    Park unsaved editor content so it can be rendered by the public renderer.

    The editor preview has to go through the same document pipeline as the
    published page or the two drift — and they did: the preview showed markup
    the published page then rendered differently. It cannot simply post the
    content to the renderer, because a public endpoint that echoes arbitrary
    HTML back under a permissive CSP is a reflected-XSS hole on the API origin.
    So the content is stored behind an unguessable token by an authenticated
    author, and the renderer only ever serves what it finds under that token.
    """
    content = body.content or ""
    if len(content) > MAX_PREVIEW_CHARS:
        raise HTTPException(413, "This document is too large to preview.")

    token = secrets.token_urlsafe(24)
    await _preview_put(token, content)
    return {"token": token, "expires_in": PREVIEW_TTL_SECONDS}


@router.post("/api/pages/upload")
async def upload_page_asset(
    request: Request,
    file: UploadFile = File(...),
    role: str = Depends(require_auth),
):
    """Upload an image/file attachment for use inside a page.

    Stored in the private HF dataset under `pages/`, but served back through the
    PUBLIC asset endpoint (`/api/public/pages/asset/...`) so that images embedded
    in a published page render for anonymous visitors. Only the `pages/` prefix
    is ever exposed publicly — the rest of the dataset stays auth-only.
    """
    from ..services import storage

    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file")
    if len(data) > storage.MAX_PAGE_FILE_BYTES:
        raise HTTPException(413, f"File exceeds {storage.MAX_PAGE_FILE_BYTES // (1024 * 1024)} MB limit")

    content_type = (file.content_type or "application/octet-stream").split(";")[0].strip()
    ext = storage.EXT_FOR_MIME.get(content_type)
    if not ext:
        # Fall back to the uploaded filename's extension
        if file.filename and "." in file.filename:
            ext = file.filename.rsplit(".", 1)[-1].lower()[:8]
        else:
            ext = "bin"

    safe_name = _slugify((file.filename or "file").rsplit(".", 1)[0])[:40] or "file"
    path_in_repo = f"pages/{datetime.now(timezone.utc):%Y/%m}/{secrets.token_hex(8)}-{safe_name}.{ext}"

    try:
        await storage.upload_bytes(data, path_in_repo, content_type=content_type)
    except Exception as exc:
        raise HTTPException(502, f"Storage upload failed: {exc}")

    return {
        "url":          f"/api/public/pages/asset/{path_in_repo}",
        "path":         path_in_repo,
        "filename":     file.filename,
        "content_type": content_type,
        "size":         len(data),
        "is_image":     content_type.startswith("image/"),
        "inline":       content_type in storage.INLINE_MIME,
    }


@router.delete("/api/pages/asset")
async def delete_page_asset(path: str, role: str = Depends(require_auth)):
    """Delete a previously-uploaded page attachment from HF storage.

    Accepts either the stored repo path (`pages/...`) or the full asset URL.
    Scoped strictly to the `pages/` prefix.
    """
    from ..services import storage

    p = path.strip()
    if "/api/public/pages/asset/" in p:
        p = p.split("/api/public/pages/asset/", 1)[1]
    p = p.split("?")[0].split("#")[0]
    if ".." in p or p.startswith("/") or not p.startswith("pages/"):
        raise HTTPException(400, "Invalid asset path")

    await storage.delete_path(p)
    return {"ok": True, "deleted": p}


@router.get("/api/pages/slug-check")
async def slug_check(slug: str, exclude_id: str | None = None, role: str = Depends(require_auth)):
    """Check whether a slug is free; if taken, return alternative suggestions."""
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")

    base = _slugify(slug)
    suggestions: list[str] = []

    async with pool.acquire() as conn:
        async def _taken(s: str) -> bool:
            if exclude_id:
                try:
                    return await conn.fetchval(
                        "SELECT 1 FROM published_pages WHERE slug=$1 AND id<>$2::uuid", s, exclude_id
                    ) is not None
                except Exception:
                    pass
            return await conn.fetchval("SELECT 1 FROM published_pages WHERE slug=$1", s) is not None

        available = not await _taken(base)
        if not available:
            candidates = [f"{base}-{i}" for i in range(2, 8)]
            candidates += [f"{base}-{_random_suffix(4)}", f"{base}-{_random_suffix(5)}"]
            for cand in candidates:
                if not await _taken(cand):
                    suggestions.append(cand)
                if len(suggestions) >= 4:
                    break

    return {"slug": base, "available": available, "suggestions": suggestions}


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
        if _can_see_all(auth_role):
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
    if not _can_see_all(auth_role):
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
    def _view_dict(r):
        d = dict(r)
        d["viewed_at"] = _dt(d.get("viewed_at"))
        d["page_id"] = str(d["page_id"]) if d.get("page_id") else None
        return d
    return {"total": total, "items": [_view_dict(r) for r in rows]}


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
    if not _can_see_all(auth_role) and str(row["created_by"]) != str(user_id):
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
        if not _can_see_all(auth_role) and str(row["created_by"]) != str(user_id):
            raise HTTPException(403, "Access denied")

        # Snapshot the current state as a version BEFORE applying this update
        await _snapshot_version(conn, page_id, row, user_id)

        # Build update fields
        updates: dict[str, Any] = {"updated_at": datetime.now(timezone.utc), "updated_by": user_id}
        if body.title is not None:
            updates["title"] = body.title
        if body.content_type is not None:
            updates["content_type"] = body.content_type
        if body.content is not None:
            updates["content"] = body.content
        if body.metadata is not None:
            updates["metadata"] = json.dumps(body.metadata)
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
        if not updated:
            raise HTTPException(404, "Page not found or was deleted")
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
            "SELECT id, created_by, content FROM published_pages WHERE id = $1", page_id
        )
        if not row:
            raise HTTPException(404, "Page not found")
        if not _can_see_all(auth_role) and str(row["created_by"]) != str(user_id):
            raise HTTPException(403, "Access denied")
        await conn.execute("DELETE FROM published_pages WHERE id = $1", page_id)
    # Best-effort: remove the page's uploaded attachments from HF storage
    await _delete_page_assets(row["content"])
    return {"ok": True}


@router.delete("/api/pages/{page_id}/views/{view_id}")
async def delete_page_view(
    page_id: str,
    view_id: str,
    request: Request,
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
        if not _can_see_all(auth_role) and str(page["created_by"]) != str(user_id):
            raise HTTPException(403, "Access denied")

        result = await conn.execute(
            "DELETE FROM page_views WHERE id = $1 AND page_id = $2",
            int(view_id), page_id,
        )
        # Decrement view_count to stay in sync
        if result != "DELETE 0":
            await conn.execute(
                "UPDATE published_pages SET view_count = GREATEST(view_count - 1, 0) WHERE id = $1",
                page_id,
            )
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
        if not _can_see_all(auth_role) and str(row["created_by"]) != str(user_id):
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
        if not _can_see_all(auth_role) and str(page["created_by"]) != str(user_id):
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
    def _av(r):
        d = dict(r)
        d["viewed_at"] = _dt(d.get("viewed_at"))
        if d.get("metadata"):
            d["metadata"] = _meta(d["metadata"])
        return d
    return {"total": total, "items": [_av(r) for r in rows]}


# ---------------------------------------------------------------------------
# Version history endpoints
# ---------------------------------------------------------------------------

@router.get("/api/pages/{page_id}/versions")
async def list_page_versions(
    page_id: str,
    request: Request,
    limit: int = 50,
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
        if not _can_see_all(auth_role) and str(page["created_by"]) != str(user_id):
            raise HTTPException(403, "Access denied")

        rows = await conn.fetch(
            """
            SELECT pv.id, pv.version_num, pv.title, pv.content_type,
                   pv.word_count, pv.note, pv.saved_at,
                   au.full_name AS saved_by_name, au.email AS saved_by_email
            FROM page_versions pv
            LEFT JOIN auth_users au ON au.id = pv.saved_by
            WHERE pv.page_id = $1
            ORDER BY pv.saved_at DESC
            LIMIT $2
            """,
            page_id,
            limit,
        )

    def _ver_list(r):
        d = dict(r)
        d["saved_at"] = _dt(d.get("saved_at"))
        return d

    return {"total": len(rows), "items": [_ver_list(r) for r in rows]}


@router.get("/api/pages/{page_id}/versions/{version_id}")
async def get_page_version(
    page_id: str,
    version_id: int,
    request: Request,
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
        if not _can_see_all(auth_role) and str(page["created_by"]) != str(user_id):
            raise HTTPException(403, "Access denied")

        row = await conn.fetchrow(
            """
            SELECT pv.*, au.full_name AS saved_by_name, au.email AS saved_by_email
            FROM page_versions pv
            LEFT JOIN auth_users au ON au.id = pv.saved_by
            WHERE pv.id = $1 AND pv.page_id = $2
            """,
            version_id,
            page_id,
        )
        if not row:
            raise HTTPException(404, "Version not found")

    d = dict(row)
    d["saved_at"] = _dt(d.get("saved_at"))
    if d.get("metadata"):
        d["metadata"] = _meta(d["metadata"])
    d["page_id"] = str(d["page_id"]) if d.get("page_id") else None
    return d


@router.post("/api/pages/{page_id}/versions/{version_id}/restore")
async def restore_page_version(
    page_id: str,
    version_id: int,
    request: Request,
    role: str = Depends(require_auth),
):
    """Restore a page to a previous version.

    Snapshots the CURRENT state first (so the restore itself is undoable),
    then overwrites title/content/content_type with the historical version.
    """
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")

    user_id = getattr(request.state, "auth_user_id", None)
    auth_role = getattr(request.state, "auth_role", role) or role

    async with pool.acquire() as conn:
        page = await conn.fetchrow(
            "SELECT * FROM published_pages WHERE id = $1", page_id
        )
        if not page:
            raise HTTPException(404, "Page not found")
        if not _can_see_all(auth_role) and str(page["created_by"]) != str(user_id):
            raise HTTPException(403, "Access denied")

        ver = await conn.fetchrow(
            "SELECT * FROM page_versions WHERE id = $1 AND page_id = $2",
            version_id, page_id,
        )
        if not ver:
            raise HTTPException(404, "Version not found")

        # Snapshot the current state BEFORE overwriting
        last_num = await conn.fetchval(
            "SELECT COALESCE(MAX(version_num), 0) FROM page_versions WHERE page_id = $1",
            page_id,
        )
        await conn.execute(
            """
            INSERT INTO page_versions
                (page_id, version_num, title, content, content_type, metadata, saved_by, word_count, note)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            """,
            page_id,
            last_num + 1,
            page["title"],
            page["content"],
            page["content_type"],
            page["metadata"] if isinstance(page["metadata"], str) else json.dumps(dict(page["metadata"]) if page["metadata"] else {}),
            user_id,
            _word_count(page["content"]),
            f"Auto-saved before restoring v{ver['version_num']}",
        )

        # Now overwrite with the historical version
        updated = await conn.fetchrow(
            """
            UPDATE published_pages
            SET title        = $1,
                content      = $2,
                content_type = $3,
                updated_at   = NOW(),
                updated_by   = $4
            WHERE id = $5
            RETURNING *
            """,
            ver["title"],
            ver["content"],
            ver["content_type"],
            user_id,
            page_id,
        )

    return {"ok": True, "page": _page_dict(updated)}


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

    import json as _json
    _no_cache = {"Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache"}

    if row["is_password_protected"]:
        return Response(
            content=_json.dumps({"requires_password": True, "title": row["title"], "id": str(row["id"]), "slug": row["slug"]}),
            media_type="application/json",
            headers=_no_cache,
        )

    return Response(
        content=_json.dumps(_public_page_dict(row)),
        media_type="application/json",
        headers=_no_cache,
    )


@router.get("/api/public/pages/preview/{token}", response_class=HTMLResponse)
async def public_render_preview(token: str):
    """Render whatever an author parked under this token. Declared before the
    slug route so `preview` is never mistaken for a page slug."""
    content = await _preview_get(token)
    if content is None:
        raise HTTPException(404, "This preview has expired. Close and reopen the preview.")
    return HTMLResponse(
        content=page_render.build_document(content, padded=True, preview=True),
        headers={**page_render.render_headers(), "X-Robots-Tag": "noindex, nofollow"},
    )


@router.get("/api/public/pages/{slug}/render", response_class=HTMLResponse)
async def public_render_page(slug: str, t: str | None = None):
    """
    Serve a published page as its own document.

    The SPA frames this URL rather than assembling the markup itself. That is
    the whole point: a document fetched over the network carries the policy set
    here instead of inheriting the app's, so the author's scripts, stylesheets
    and web fonts actually run. See services/page_render.py for why that broke
    entire pages before.
    """
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")

    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM published_pages WHERE slug = $1", slug)

    if not row or not row["is_published"]:
        raise HTTPException(404, "Page not found")
    if row["expires_at"] and row["expires_at"] < datetime.now(timezone.utc):
        raise HTTPException(410, "Page has expired")
    if row["is_password_protected"] and not _render_token_valid(slug, t):
        raise HTTPException(401, "This page is protected.")

    return HTMLResponse(
        content=page_render.build_document(row["content"] or ""),
        headers=page_render.render_headers(cacheable=not row["is_password_protected"]),
    )


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

    # The renderer serves the document straight into an iframe and has no way
    # to be told a password, so proof of the password travels as a token.
    return {**_public_page_dict(row), "render_token": _render_token(slug)}


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

    client_meta = {k: v for k, v in {
        "screen_width":        body.screen_width,
        "screen_height":       body.screen_height,
        "viewport_width":      body.viewport_width,
        "viewport_height":     body.viewport_height,
        "color_depth":         body.color_depth,
        "pixel_ratio":         body.pixel_ratio,
        "language":            body.language,
        "languages":           body.languages,
        "timezone":            body.timezone,
        "platform":            body.platform,
        "touch_support":       body.touch_support,
        "cookie_enabled":      body.cookie_enabled,
        "do_not_track":        body.do_not_track,
        "connection_type":     body.connection_type,
        "connection_downlink": body.connection_downlink,
        "page_url":            body.page_url,
        "utm_source":          body.utm_source,
        "utm_medium":          body.utm_medium,
        "utm_campaign":        body.utm_campaign,
        "gps_lat":             body.gps_lat,
        "gps_lon":             body.gps_lon,
        "gps_accuracy":        body.gps_accuracy,
    }.items() if v is not None}

    # Fire-and-forget
    asyncio.create_task(_log_view_bg(page_id, ip, ua, body.referer, None, client_meta))
    return {"ok": True}


@router.get("/api/public/pages/asset/{path:path}")
async def public_page_asset(path: str):
    """Serve a page attachment publicly — ONLY files under the `pages/` prefix.

    This is the public counterpart to /api/storage/file (which requires auth).
    Scoped strictly to `pages/` so the rest of the private dataset is never
    exposed. Paths are unguessable (random token in the name).
    """
    from ..services import storage

    if ".." in path or path.startswith("/") or not path.startswith("pages/"):
        raise HTTPException(400, "Invalid asset path")

    data = await storage.read_bytes(path)
    if data is None:
        raise HTTPException(404, "Asset not found")

    ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
    content_type = storage.MIME_FOR_EXT.get(ext, "application/octet-stream")
    disposition = "inline" if content_type in storage.INLINE_MIME else "attachment"

    return Response(
        content=data,
        media_type=content_type,
        headers={
            "Cache-Control": "public, max-age=604800, immutable",
            "Content-Length": str(len(data)),
            "Content-Disposition": disposition,
        },
    )


# ---------------------------------------------------------------------------
# Serialisation helpers
# ---------------------------------------------------------------------------

def _dt(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.isoformat()
    return str(v)


def _meta(v) -> dict:
    if not v:
        return {}
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return {}
    return dict(v)


def _page_dict(row) -> dict:
    d = dict(row)
    d["id"] = str(d["id"])
    d["created_by"] = str(d["created_by"]) if d.get("created_by") else None
    d["updated_by"] = str(d["updated_by"]) if d.get("updated_by") else None
    d["created_at"] = _dt(d.get("created_at"))
    d["updated_at"] = _dt(d.get("updated_at"))
    d["published_at"] = _dt(d.get("published_at"))
    d["expires_at"] = _dt(d.get("expires_at"))
    d["metadata"] = _meta(d.get("metadata"))
    d.pop("password_hash", None)
    return d


def _page_list_dict(row) -> dict:
    d = dict(row)
    d["id"] = str(d["id"])
    d["created_by"] = str(d["created_by"]) if d.get("created_by") else None
    d["created_at"] = _dt(d.get("created_at"))
    d["updated_at"] = _dt(d.get("updated_at"))
    d["published_at"] = _dt(d.get("published_at"))
    d["expires_at"] = _dt(d.get("expires_at"))
    d["metadata"] = _meta(d.get("metadata"))
    return d


def _public_page_dict(row) -> dict:
    return {
        "id": str(row["id"]),
        "slug": row["slug"],
        "title": row["title"],
        "content_type": row["content_type"],
        "content": row["content"],
        "published_at": _dt(row["published_at"]),
        "metadata": _meta(row.get("metadata")),
    }
