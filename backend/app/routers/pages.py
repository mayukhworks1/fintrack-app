"""
Content Publishing / Pages router.

Prefixes:
  /api/pages        — authenticated CRUD + analytics
  /api/public/pages — unauthenticated read + view logging
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import hashlib
import hmac
import json
import logging
import re
import secrets
import string
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any
from urllib.parse import quote

from ..utils.http import shared_client
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, Response, StreamingResponse
from pydantic import BaseModel

from ..config import settings
from ..db import valkey as vk
from ..db.postgres import get_pool
from ..utils.uploads import read_upload, upload_limit
from ..utils import fast_json
from ..utils.client_ip import client_ip
from ..services.page_ai import generate_page, analyze_prompt_needs, stream_generate_page, edit_page_section, fix_page_script_error
from ..services import page_render
from ..services import page_share
from ..services import page_doc
from ..services import artifact
from ..services import page_tree
from ..services import collab

IST = timezone(timedelta(hours=5, minutes=30), "IST")
from .ai import _ai_quota
from .deps import require_auth, require_permission

logger = logging.getLogger("fintrack.pages")

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


def _can_see_all(role: str) -> bool:
    """Only the superadmin sees/manages every user's pages. Everyone else is
    scoped to the pages they created (row-level isolation)."""
    return role == "superadmin"


def _owns_page(row, user_id, auth_role: str) -> bool:
    """Who may open or change a page in the app: a superadmin, or its creator.
    A session without a user id (a legacy token) matches no creator, not even
    a page whose created_by is NULL: str(None) == str(None) let any such
    session edit every ownerless page."""
    if _can_see_all(auth_role):
        return True
    owner = row["created_by"]
    return user_id is not None and owner is not None and str(owner) == str(user_id)


# The same cap the live editor holds (services/collab.py). JSON bodies had no
# limit at all: a 12 MB PUT was accepted and then too large to open.
MAX_CONTENT_CHARS = 5_000_000
TOO_LARGE_DETAIL = (
    "This page is too large to save: it is over 5,000,000 characters. "
    "Split it into sub-pages or move large embedded files out of it."
)
TRASHED_DETAIL = "This page is in the trash \u2014 restore it to edit."


def _check_size(content: str | None) -> None:
    if content is not None and len(content) > MAX_CONTENT_CHARS:
        raise HTTPException(413, TOO_LARGE_DETAIL)


def _page_uuid(page_id: str) -> str:
    """Path dependency for {page_id}. Page ids are UUIDs, and anything else sent
    to the uuid column raises in asyncpg — a 500 for what is a missing page."""
    try:
        return str(uuid.UUID(page_id))
    except ValueError:
        raise HTTPException(404, "Page not found")


PageId = Annotated[str, Depends(_page_uuid)]


_ASSET_PATH_RE = re.compile(r"/api/public/pages/asset/([^\s)\"'<>]+)")
# What migration 0006's page_asset_paths() stores per page and version: the
# path up to the first character a stored path never contains, so an HTML
# entity (&quot;) or a JSON escape (\") after the URL is not taken as part of it.
_ASSET_REF_RE = re.compile(r"/api/public/pages/asset/(pages/[^\s)\"'<>?#&\\]+)")


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


# A base64 image pasted or exported into page content. Whitespace is allowed
# inside the payload (some exporters wrap it) and stripped before decoding; a
# payload that then fails strict decoding is left exactly as it was.
_INLINE_IMAGE_RE = re.compile(
    r"data:(image/(?:png|jpeg|jpg|gif|webp|svg\+xml));base64,([A-Za-z0-9+/=\s]+)",
    re.IGNORECASE,
)
_INLINE_MIME_EXT = {
    "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg",
    "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg",
}
_MAX_INLINE_IMAGES_PER_SAVE = 60


async def externalise_inline_images(content: str | None) -> tuple[str | None, int]:
    """Move base64 data-URI images out of page content into page assets.

    One shared page in production was 1.4 MB, of which 1.36 MB was fifteen
    images embedded as base64. Every visitor pulled all of it through the
    database and the API before the first paint, and none of it could be
    cached. Uploaded assets are served from /api/public/pages/asset/ with an
    immutable cache header, so the page body shrinks to its text and each
    image is fetched once per browser.

    Identical payloads share one asset. All images in a save go up as ONE
    storage commit. Any failure leaves the content untouched — nothing is
    ever lost, it simply stays inline. Returns (content, images_moved).
    """
    if not content or "data:image/" not in content.lower():
        return content, 0
    matches = list(_INLINE_IMAGE_RE.finditer(content))
    if not matches:
        return content, 0

    from ..services import storage

    def _key(payload: str) -> str:
        return hashlib.sha1(payload.encode("ascii", "ignore")).hexdigest()

    decoded: dict[str, tuple[str, bytes]] = {}
    for m in matches[:_MAX_INLINE_IMAGES_PER_SAVE]:
        mime, payload = m.group(1).lower(), m.group(2)
        key = _key(payload)
        if key in decoded:
            continue
        try:
            data = base64.b64decode(re.sub(r"\s+", "", payload), validate=True)
        except Exception:
            continue
        if not data or len(data) > storage.MAX_PAGE_FILE_BYTES:
            continue
        decoded[key] = (mime, data)
    if not decoded:
        return content, 0

    # Content-addressed: the same image always lands on the same path, so an
    # autosave of a page that still carries it inline (an editor that kept
    # its own copy) does not upload it again and again under new names.
    files: list[tuple[bytes, str, str]] = []
    url_for: dict[str, str] = {}
    by_path: dict[str, tuple[bytes, str, str]] = {}
    for key, (mime, data) in decoded.items():
        digest = hashlib.sha1(data).hexdigest()
        path = f"pages/inline/{digest[:2]}/{digest}.{_INLINE_MIME_EXT.get(mime, 'bin')}"
        by_path.setdefault(path, (data, path, mime))
        url_for[key] = f"/api/public/pages/asset/{path}"
    known = await _assets_already_stored(list(by_path))
    files = [f for path, f in by_path.items() if path not in known]
    try:
        if files:
            await storage.upload_many(files)
    except Exception as exc:
        logger.warning("pages: inline image upload failed; content left as-is: %s", exc)
        return content, 0

    def _swap(m: re.Match) -> str:
        return url_for.get(_key(m.group(2))) or m.group(0)

    return _INLINE_IMAGE_RE.sub(_swap, content), len(by_path)


async def _assets_already_stored(paths: list[str]) -> set[str]:
    """Which of these content-addressed paths storage already holds. Asked
    every time (no local memory: another worker may have deleted the file
    since); any failure counts as "not stored", and uploading identical bytes
    again is harmless."""
    from ..services import storage

    exists = getattr(storage, "file_exists", None)
    if not paths or exists is None:
        return set()
    results = await asyncio.gather(*(exists(p) for p in paths), return_exceptions=True)
    return {p for p, ok in zip(paths, results) if ok is True}


async def sweep_inline_images_once(delay_s: float = 90.0) -> dict[str, int]:
    """Externalise inline images in pages saved before this existed. Once, at boot.

    Compare-and-set on the content, so an edit made while an upload was in
    flight is never overwritten; that page is simply picked up next boot.
    """
    await asyncio.sleep(delay_s)
    pool = get_pool()
    if not pool:
        return {"pages": 0, "images": 0}
    try:
        rows = await pool.fetch(
            "SELECT id, content FROM published_pages WHERE content ILIKE '%data:image/%'"
        )
    except Exception as exc:
        logger.warning("pages sweep: could not list pages: %s", exc)
        return {"pages": 0, "images": 0}
    pages = images = 0
    for r in rows:
        try:
            new_content, moved = await externalise_inline_images(r["content"])
            if not moved or new_content == r["content"]:
                continue
            status = await pool.execute(
                "UPDATE published_pages SET content = $1 WHERE id = $2 AND content = $3",
                new_content, r["id"], r["content"],
            )
            if str(status).endswith(" 1"):
                pages += 1
                images += moved
        except Exception as exc:
            logger.warning("pages sweep: page %s skipped: %s", r["id"], exc)
    if rows:
        logger.info("pages sweep: %d page(s) found, %d rewritten, %d image(s) moved to assets",
                    len(rows), pages, images)
    return {"pages": pages, "images": images}


def _word_count(text: str | None, content_type: str | None = None) -> int:
    return page_doc.word_count(text, content_type)


def _check_doc_content(content_type: str | None, content: str | None) -> None:
    """A block document's content must be document JSON (or empty)."""
    if content_type != page_doc.DOC_TYPE:
        return
    try:
        page_doc.validate_doc(content)
    except page_doc.InvalidDoc as exc:
        raise HTTPException(422, str(exc))


# word_count of a version written by snapshot_update_sql, which copies the
# content inside the database and never sees it. Worked out when the version
# list is next read (_fill_word_counts).
WORD_COUNT_PENDING = -1


def snapshot_update_sql(set_sql: str, *, page: str = "$1", now: str = "$3", user: str = "$4",
                        force: str = "$6", note: str = "$7", guard: str = "TRUE",
                        returning: str = "p.id", writer_rule: bool = False) -> str:
    """Two CTEs, `snap` and `upd`, for a WITH clause: write the page and, in
    the same statement, keep a version of it as it was before.

    Every CTE of one statement reads the same snapshot, so `snap` copies the
    content as it stood before `upd` changes it, inside the database: the
    old content never travels to the API. A version is written when `force`
    is true, when none was written in the last five minutes, and (writer_rule)
    when the page was last written by someone else or the last version was
    saved by someone else, so one person's work is always kept in History
    before another's save replaces it. `guard` must also hold (it is checked
    again on the row being updated) or neither happens.
    """
    writer = ""
    if writer_rule:
        writer = (
            f" OR p.updated_by IS DISTINCT FROM {user}"
            f" OR (SELECT v.saved_by FROM page_versions v WHERE v.page_id = p.id"
            f"      ORDER BY v.saved_at DESC LIMIT 1) IS DISTINCT FROM {user}"
        )
    return (
        "snap AS ("
        " INSERT INTO page_versions"
        "   (page_id, version_num, title, content, content_type, metadata, saved_by, word_count, note)"
        " SELECT p.id,"
        "        COALESCE((SELECT MAX(v.version_num) FROM page_versions v WHERE v.page_id = p.id), 0) + 1,"
        f"        p.title, p.content, p.content_type, p.metadata, {user}, {WORD_COUNT_PENDING}, {note}::text"
        "   FROM published_pages p"
        f"  WHERE p.id = {page} AND ({guard})"
        f"    AND ({force}::boolean"
        "         OR NOT EXISTS (SELECT 1 FROM page_versions v WHERE v.page_id = p.id"
        f"                         AND v.saved_at > {now}::timestamptz - interval '5 minutes')"
        f"         {writer})"
        " RETURNING id), "
        "upd AS ("
        f" UPDATE published_pages p SET {set_sql}"
        f"  WHERE p.id = {page} AND ({guard})"
        f" RETURNING {returning})"
    )


async def _fill_word_counts(conn, rows: list[dict]) -> None:
    """Word counts of versions written by snapshot_update_sql, computed once
    from their content and stored, so the list shows real numbers."""
    pending = [r["id"] for r in rows if (r.get("word_count") or 0) < 0]
    if not pending:
        return
    try:
        found = await conn.fetch(
            "SELECT id, content, content_type FROM page_versions WHERE id = ANY($1::bigint[])", pending)
        counts = {r["id"]: _word_count(r["content"], r["content_type"]) for r in found}
        if counts:
            await conn.execute(
                "UPDATE page_versions v SET word_count = u.n "
                "FROM unnest($1::bigint[], $2::int[]) AS u(id, n) WHERE v.id = u.id",
                list(counts), list(counts.values()),
            )
        for r in rows:
            if r["id"] in counts:
                r["word_count"] = counts[r["id"]]
    except Exception as exc:
        logger.warning("pages: filling version word counts failed: %s", exc)
        for r in rows:
            if (r.get("word_count") or 0) < 0:
                r["word_count"] = 0


async def _snapshot_version(conn, page_id: str, row: Any, user_id: str | None,
                            note: str | None = None) -> None:
    """Insert a version snapshot, throttled to at most once per 5 minutes per page.

    Called before applying changes so the snapshot captures what the page
    looked like BEFORE this edit. A snapshot with a note (an explicit
    checkpoint, such as before converting a page to blocks) is always
    written, whatever the throttle says.

    Best-effort, inside a savepoint: a failed insert must not abort the
    caller's transaction (inside one, the next statement would fail with
    "current transaction is aborted" and the save itself would be lost).
    """
    try:
        async with conn.transaction():
            await _snapshot_version_inner(conn, page_id, row, user_id, note)
    except Exception as exc:
        logger.warning("pages: version snapshot of %s skipped: %s", page_id, exc)


async def _snapshot_version_inner(conn, page_id: str, row: Any, user_id: str | None,
                                  note: str | None = None) -> None:
    last = await conn.fetchrow(
        "SELECT saved_at FROM page_versions WHERE page_id = $1 ORDER BY saved_at DESC LIMIT 1",
        page_id,
    )
    if last and not note:
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
            (page_id, version_num, title, content, content_type, metadata, saved_by, word_count, note)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        """,
        page_id,
        last_num + 1,
        row["title"],
        row["content"],
        row["content_type"],
        row["metadata"] if isinstance(row["metadata"], str) else json.dumps(row["metadata"] or {}),
        user_id,
        _word_count(row["content"], row["content_type"]),
        (note or "")[:200] or None,
    )


_ASSET_URL_PREFIX = "/api/public/pages/asset/"


async def _asset_page_owners(pool, paths: list[str]) -> dict[str, set]:
    """Map each asset path to the owners (created_by) of the pages using it.

    A page uses an asset when its content, or any saved version of it, carries
    the asset's public URL — as written, or percent-encoded, which is how an
    editor may have stored a non-ASCII file name. Paths nothing refers to are
    absent from the result. strpos rather than LIKE, so a `_` or `%` in a file
    name is matched literally instead of as a wildcard.
    """
    needles: dict[str, str] = {}
    for p in paths:
        for form in (p, quote(p, safe="/")):
            needles.setdefault(_ASSET_URL_PREFIX + form, p)
    owners: dict[str, set] = {}
    async with pool.acquire() as conn:
        if await page_tree.perf_ready(conn):
            # Migration 0006: the references are an indexed array per page
            # and per version (kept by a trigger), not a scan of all content.
            forms = {n[len(_ASSET_URL_PREFIX):]: p for n, p in needles.items()}
            rows = await conn.fetch(
                """
                SELECT f.ref, p.created_by
                  FROM unnest($1::text[]) AS f(ref)
                  JOIN published_pages p ON p.asset_paths @> ARRAY[f.ref]
                UNION
                SELECT f.ref, p.created_by
                  FROM unnest($1::text[]) AS f(ref)
                  JOIN page_versions v ON v.asset_paths @> ARRAY[f.ref]
                  JOIN published_pages p ON p.id = v.page_id
                """,
                list(forms),
            )
            for r in rows:
                owners.setdefault(forms[r["ref"]], set()).add(r["created_by"])
            return owners
    rows = await pool.fetch(
        """
        SELECT n.needle, p.created_by
          FROM unnest($1::text[]) AS n(needle)
          JOIN published_pages p ON strpos(p.content, n.needle) > 0
        UNION
        SELECT n.needle, p.created_by
          FROM unnest($1::text[]) AS n(needle)
          JOIN page_versions v ON strpos(v.content, n.needle) > 0
          JOIN published_pages p ON p.id = v.page_id
        """,
        list(needles),
    )
    for r in rows:
        owners.setdefault(needles[r["needle"]], set()).add(r["created_by"])
    return owners


async def _delete_page_assets(content: str | None) -> None:
    """Best-effort: remove a page's uploaded attachments from HF storage.

    Runs after the page row, and with it its versions, is gone, so a reference
    still found belongs to another page: content copied between pages, or an
    asset URL lifted from someone else's published page. Those files stay —
    deleting them would break that page.
    """
    await _delete_asset_paths(_extract_asset_paths(content))


async def _delete_asset_paths(paths: list[str]) -> None:
    """_delete_page_assets for paths already gathered, from any number of
    deleted pages: one reference check for all of them."""
    paths = [p for p in dict.fromkeys(paths or []) if p.startswith("pages/") and ".." not in p]
    if not paths:
        return
    from ..services import storage
    pool = get_pool()
    try:
        still_used = await _asset_page_owners(pool, paths) if pool else None
    except Exception as exc:
        logger.warning("pages: could not check asset references, keeping files: %s", exc)
        still_used = None
    if still_used is None:
        return  # an orphaned file is the safe failure; a deleted one in use is not
    for p in paths:
        if p in still_used:
            continue
        try:
            await storage.delete_path(p)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

def _parse_expiry(value: str | None) -> tuple[bool, datetime | None]:
    """(given, when) for an expires_at field. "" clears the expiry; a value
    without an offset is read as IST, the timezone the editor works in."""
    if value is None:
        return False, None
    value = value.strip()
    if not value:
        return True, None
    try:
        when = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(422, "Invalid expiry date")
    if when.tzinfo is None:
        when = when.replace(tzinfo=IST)
    return True, when


def _is_expired(row) -> bool:
    return bool(row["expires_at"] and row["expires_at"] <= datetime.now(timezone.utc))


def _source_protected(row) -> bool:
    return bool(_meta(row["metadata"]).get("protect_source"))


class CreatePageBody(BaseModel):
    title: str
    content_type: str = "markdown"
    content: str = ""
    slug: str | None = None
    metadata: dict = {}
    is_password_protected: bool = False
    password: str | None = None
    expires_at: str | None = None
    # Idempotency key chosen by the client for this create. A retry with the
    # same id (same user, within CREATE_DEDUPE_S) returns the page the first
    # request made instead of making another.
    client_request_id: str | None = None


class UpdatePageBody(BaseModel):
    title: str | None = None
    content_type: str | None = None
    content: str | None = None
    slug: str | None = None
    metadata: dict | None = None
    is_password_protected: bool | None = None
    password: str | None = None
    expires_at: str | None = None
    # Writes a named version of the page as it stands before this update,
    # regardless of the usual five-minute throttle.
    version_note: str | None = None
    # Optimistic concurrency: the updated_at the client's copy was loaded at
    # (as the API returned it). When given and the page has changed since,
    # nothing is written and the answer is 409 with the server copy's
    # metadata. Absent, the update applies unconditionally (older clients).
    base_updated_at: str | None = None


class PublishBody(BaseModel):
    published: bool


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

# Retries of one create (same client_request_id) within this window return
# the first page instead of making another.
CREATE_DEDUPE_S = 600
_create_local: dict[tuple[str, str], tuple[float, str]] = {}


def _request_key(user_id, request) -> str:
    return str(user_id) if user_id else "anon:" + str(getattr(request.state, "token_hint", "") or "")


@router.post("/api/pages/")
async def create_page(
    body: CreatePageBody,
    request: Request,
    role: str = Depends(require_auth),
):
    return await _create_page(body, request, role)


async def _create_page(body: CreatePageBody, request: Request, role: str, parent_id: str | None = None) -> dict:
    """Create a page, optionally under a parent, in one INSERT. A client
    request id makes a retried create return the page already made."""
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")

    user_id = getattr(request.state, "auth_user_id", None)

    # Slug resolution
    base_slug = _slugify(body.slug or body.title)
    slug = base_slug

    _check_size(body.content)
    _check_doc_content(body.content_type, body.content)
    request_id = (body.client_request_id or "").strip()[:100] or None
    if request_id and len(request_id) < 8:
        raise HTTPException(422, "client_request_id must be at least 8 characters")

    # Before a connection is held: the upload can take a few seconds.
    content, _moved = await externalise_inline_images(body.content)
    _check_size(content)
    metadata = {k: v for k, v in (body.metadata or {}).items() if k != "_slim"}

    async with pool.acquire() as conn:
        dedupe_table = bool(request_id) and await page_tree.perf_ready(conn)
        key = _request_key(user_id, request)
        if request_id and not dedupe_table:
            # Before migration 0006: this process remembers recent ids.
            now = time.time()
            for k in [k for k, (t, _) in _create_local.items() if now - t > CREATE_DEDUPE_S]:
                _create_local.pop(k, None)
            hit = _create_local.get((key, request_id))
            if hit:
                row = await conn.fetchrow("SELECT * FROM published_pages WHERE id = $1", hit[1])
                if row:
                    return _page_dict(row)

        pw_hash = _hash_password(body.password) if body.is_password_protected and body.password else None
        _, expires_at = _parse_expiry(body.expires_at)
        cols = ("slug, title, content_type, content, metadata, "
                "is_password_protected, password_hash, created_by, updated_by, expires_at")
        vals = "$1,$2,$3,$4,$5,$6,$7,$8,$8,$9"
        args: list[Any] = [slug, body.title, body.content_type, content, json.dumps(metadata),
                           body.is_password_protected, pw_hash, user_id, expires_at]
        if parent_id is not None:
            cols += ", parent_id"
            vals += ",$10"
            args.append(parent_id)

        async with (conn.transaction() if dedupe_table else contextlib.nullcontext()):
            if dedupe_table:
                # The claim blocks a concurrent retry until this one commits,
                # which then finds the page.
                await conn.execute(
                    "DELETE FROM page_create_requests WHERE user_key = $1 AND request_id = $2 "
                    f"AND created_at < NOW() - interval '{CREATE_DEDUPE_S} seconds'",
                    key, request_id,
                )
                claimed = await conn.fetchval(
                    "INSERT INTO page_create_requests (user_key, request_id) VALUES ($1, $2) "
                    "ON CONFLICT DO NOTHING RETURNING TRUE",
                    key, request_id,
                )
                if not claimed:
                    row = await conn.fetchrow(
                        "SELECT p.* FROM page_create_requests r JOIN published_pages p ON p.id = r.page_id "
                        "WHERE r.user_key = $1 AND r.request_id = $2",
                        key, request_id,
                    )
                    if row:
                        return _page_dict(row)
                    raise HTTPException(409, "This page is still being created. Try again in a moment.")
            if await conn.fetchval("SELECT id FROM published_pages WHERE slug = $1", slug):
                args[0] = slug = f"{base_slug}-{_random_suffix()}"
            row = await conn.fetchrow(
                f"INSERT INTO published_pages ({cols}) VALUES ({vals}) RETURNING *", *args
            )
            if dedupe_table:
                await conn.execute(
                    "UPDATE page_create_requests SET page_id = $3 WHERE user_key = $1 AND request_id = $2",
                    key, request_id, row["id"],
                )
        if request_id and not dedupe_table:
            _create_local[(key, request_id)] = (time.time(), str(row["id"]))
        return _page_dict(row)


# The five model-calling routes below sit behind the same two gates as the AI
# assistant in routers/ai.py: the module.ai.use permission and the rolling-24h
# quota. They draw on the same shared model budget; without the gates, a user
# whose AI access was revoked, or whose allowance was spent, carried on here.
@router.post("/api/pages/ai-generate")
async def ai_generate_page(
    body: AIGenerateBody,
    request: Request,
    role: str = Depends(require_auth),
    _perm: str = Depends(require_permission("module.ai.use")),
    _quota: None = Depends(_ai_quota),
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
    _perm: str = Depends(require_permission("module.ai.use")),
    _quota: None = Depends(_ai_quota),
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
    _perm: str = Depends(require_permission("module.ai.use")),
    _quota: None = Depends(_ai_quota),
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
    _perm: str = Depends(require_permission("module.ai.use")),
    _quota: None = Depends(_ai_quota),
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
    _perm: str = Depends(require_permission("module.ai.use")),
    _quota: None = Depends(_ai_quota),
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
        raise HTTPException(
            413,
            f"This document is too large to preview here (over {MAX_PREVIEW_CHARS:,} characters). "
            "Save it and open the published page instead.",
        )

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

    data = await read_upload(file, upload_limit(storage.MAX_PAGE_FILE_BYTES))
    if not data:
        raise HTTPException(400, "Empty file")

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
async def delete_page_asset(path: str, request: Request, role: str = Depends(require_auth)):
    """Delete a previously-uploaded page attachment from HF storage.

    Accepts either the stored repo path (`pages/...`) or the full asset URL.
    Scoped strictly to the `pages/` prefix.

    Asset URLs are public in every published page, so knowing a path proves
    nothing. A file is deleted only by the owner of every page that uses it
    (see _asset_page_owners), or by a superadmin, the same rule as the page
    routes. A file no page refers to yet — uploaded into an editor that has not
    been saved — is the uploader's to discard.
    """
    from ..services import storage

    p = path.strip()
    if "/api/public/pages/asset/" in p:
        p = p.split("/api/public/pages/asset/", 1)[1]
    p = p.split("?")[0].split("#")[0]
    if ".." in p or p.startswith("/") or not p.startswith("pages/"):
        raise HTTPException(400, "Invalid asset path")
    # Only the form a page refers to. "pages/a//b" or "pages/a/./b" match no
    # reference below, so they would pass as unused, yet storage may resolve
    # them to the same file.
    if "\\" in p or any(seg in ("", ".") for seg in p.split("/")):
        raise HTTPException(400, "Invalid asset path")

    auth_role = getattr(request.state, "auth_role", role) or role
    if not _can_see_all(auth_role):
        pool = get_pool()
        if not pool:
            raise HTTPException(503, "Database unavailable")
        user_id = getattr(request.state, "auth_user_id", None)
        owners = (await _asset_page_owners(pool, [p])).get(p, set())
        # A page with no owner (legacy-created, or its creator was deleted)
        # matches no caller: str(None) == str(None) would let every legacy
        # session, which has no user id either, strip it.
        if any(o is None or not user_id or str(o) != str(user_id) for o in owners):
            raise HTTPException(403, "Access denied")

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


# The metadata keys the page list shows (folder, description, protection,
# width, icon). Everything else (a database's schema, a sheet's formatting)
# stays out of the list; a list item's metadata is marked {"_slim": true} so
# an update that sends it back merges into the stored metadata instead of
# replacing it (see update_page).
LIST_META_KEYS = ("folder", "description", "protect_source", "full_width", "icon")
LIST_MAX = 1000


@router.get("/api/pages/")
async def list_pages(
    request: Request,
    role: str = Depends(require_auth),
    limit: int | None = None,
    offset: int = 0,
    include_rows: bool = False,
    full_metadata: bool = False,
):
    """Every page the caller may open, newest first.

    Rows of databases are left out (include_rows=true brings them back), and
    metadata carries only LIST_META_KEYS (full_metadata=true for all of it).
    limit/offset page through the list; the default is the whole list, as
    before. X-Has-More says whether a further page exists. The response has
    an ETag; If-None-Match gets a 304 when nothing changed.
    """
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")

    user_id = getattr(request.state, "auth_user_id", None)
    auth_role = getattr(request.state, "auth_role", role) or role

    meta = "p.metadata" if full_metadata else (
        "jsonb_strip_nulls(jsonb_build_object("
        + ", ".join(f"'{k}', p.metadata->'{k}'" for k in LIST_META_KEYS)
        + ")) || '{\"_slim\": true}'::jsonb"
    )
    async with pool.acquire() as conn:
        ready = await page_tree.tree_ready(conn)
        unpublished = (", " + _unpublished_sql("p")) if await page_tree.perf_ready(conn) else ""
        where = ["TRUE"]
        args: list[Any] = []
        if ready:
            # Trashed pages (migration 0004) are listed only by /api/pages/trash.
            where.append("p.deleted_at IS NULL")
            if not include_rows:
                where.append(page_tree.not_db_row("p"))
        if not _can_see_all(auth_role):
            args.append(user_id)
            where.append(f"p.created_by = ${len(args)}")
        page_sql = ""
        if limit is not None:
            limit = max(1, min(int(limit), LIST_MAX))
            args += [limit + 1, max(0, int(offset or 0))]
            page_sql = f" LIMIT ${len(args) - 1} OFFSET ${len(args)}"
        rows = await conn.fetch(
            f"""
            SELECT p.id, p.slug, p.title, p.content_type, p.is_published, p.view_count,
                   p.created_at, p.updated_at, p.published_at, p.expires_at,
                   p.is_password_protected, p.created_by, {meta} AS metadata{unpublished}
            FROM published_pages p
            WHERE {' AND '.join(where)}
            ORDER BY p.created_at DESC, p.id{page_sql}
            """,
            *args,
        )
    headers = {}
    if limit is not None:
        headers["X-Has-More"] = "1" if len(rows) > limit else "0"
        rows = rows[:limit]
    return fast_json.json_response(request, [_page_list_dict(r) for r in rows], headers=headers)


@router.get("/api/pages/{page_id}")
async def get_page(
    page_id: PageId,
    request: Request,
    role: str = Depends(require_auth),
):
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")

    user_id = getattr(request.state, "auth_user_id", None)
    auth_role = getattr(request.state, "auth_role", role) or role

    async with pool.acquire() as conn:
        cols = await page_cols_for(conn)
        row = await conn.fetchrow(
            f"SELECT {cols} FROM published_pages WHERE id = $1", page_id
        )
    if not row:
        raise HTTPException(404, "Page not found")
    if not _owns_page(row, user_id, auth_role):
        raise HTTPException(403, "Access denied")
    return _page_dict(row)


async def page_cols_for(conn, alias: str = "") -> str:
    """The columns of a full page response: every column before migration
    0006, after it every column but the published copy (which would double
    the payload), plus has_unpublished_changes."""
    if await page_tree.perf_ready(conn):
        return _page_cols(await page_tree.tree_ready(conn), True, alias=alias, drafts=True)
    return f"{alias}.*" if alias else "*"


def _page_cols(tree: bool, content: bool = True, alias: str = "", drafts: bool = False) -> str:
    """Every column a page response carries, so content can be left out (and
    the published copy is never read for an editor's response)."""
    a = f"{alias}." if alias else ""
    cols = ["id", "slug", "title", "content_type", "is_published", "is_password_protected",
            "created_by", "updated_by", "created_at", "updated_at", "published_at", "expires_at",
            "view_count", "metadata"]
    if tree:
        cols += ["parent_id", "position", "icon", "cover", "deleted_at"]
    if content:
        cols.append("content")
    out = [a + c for c in cols]
    if drafts:
        out += [f"{a}published_at_rev", _unpublished_sql(alias)]
    return ", ".join(out)


def _unpublished_sql(alias: str = "") -> str:
    """has_unpublished_changes: a published page whose working copy differs
    from what the public sees (draft_changed is kept by a 0006 trigger)."""
    a = f"{alias}." if alias else ""
    return f"({a}is_published AND {a}draft_changed) AS has_unpublished_changes"


# Columns of the published copy (migration 0006). Never sent to the editor.
_PUBLISHED_COLS = ("published_content", "published_content_type", "published_title", "draft_changed")


def _public_copy(row) -> dict:
    """The page as the public sees it: the published copy of its title and
    content when there is one (migration 0006), else the page as stored."""
    d = dict(row)
    if d.get("published_content") is not None:
        d["content"] = d["published_content"]
        d["content_type"] = d.get("published_content_type") or d["content_type"]
        d["title"] = d["published_title"] if d.get("published_title") is not None else d["title"]
    return d


def _parse_base(value: str | None) -> datetime | None:
    if value is None or not str(value).strip():
        return None
    try:
        when = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(422, "base_updated_at is not a valid timestamp")
    return when if when.tzinfo else when.replace(tzinfo=timezone.utc)


def _conflict(current: Any) -> HTTPException:
    """409 for a save made from an out-of-date copy, with what the server
    holds now (no content: the client fetches the page if it wants it)."""
    return HTTPException(409, {
        "code": "conflict",
        "message": "This page was changed since you opened it. Reload it to see the latest "
                   "version; your text is still in the editor.",
        "current": {
            "id": str(current["id"]),
            "title": current["title"],
            "content_type": current["content_type"],
            "updated_at": _dt(current["updated_at"]),
            "updated_by": str(current["updated_by"]) if current["updated_by"] else None,
        },
    })


@router.put("/api/pages/{page_id}")
async def update_page(
    page_id: PageId,
    body: UpdatePageBody,
    request: Request,
    role: str = Depends(require_auth),
):
    """Save a page. The stored content is never read back to the API: the
    row is loaded without it, and the version snapshot and the write happen
    in one statement (snapshot_update_sql). The response echoes the content
    that was saved."""
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")

    user_id = getattr(request.state, "auth_user_id", None)
    auth_role = getattr(request.state, "auth_role", role) or role
    _check_size(body.content)
    base_at = _parse_base(body.base_updated_at)

    # Before a connection is held: the upload can take a few seconds.
    new_content = body.content
    if new_content is not None:
        new_content, _moved = await externalise_inline_images(new_content)
        _check_size(new_content)

    async with pool.acquire() as conn:
        tree = await page_tree.tree_ready(conn)
        drafts = await page_tree.perf_ready(conn)
        slim = f"SELECT {_page_cols(tree, content=False)} FROM published_pages WHERE id = $1"
        row = await conn.fetchrow(slim, page_id)
        if not row:
            raise HTTPException(404, "Page not found")
        if not _owns_page(row, user_id, auth_role):
            raise HTTPException(403, "Access denied")
        if page_tree.is_trashed(row):
            raise HTTPException(409, TRASHED_DETAIL)
        if base_at is not None and row["updated_at"] != base_at:
            raise _conflict(row)

        # Checked against the type the page will have after this update.
        new_type = body.content_type if body.content_type is not None else row["content_type"]
        if new_content is not None:
            _check_doc_content(new_type, new_content)
        elif body.content_type is not None and body.content_type != row["content_type"]:
            _check_doc_content(new_type, await conn.fetchval(
                "SELECT content FROM published_pages WHERE id = $1", page_id))

        # A live editing room owns a block document's content: refused (409)
        # while editors are connected, otherwise saved and closed first.
        live_note = None
        if new_content is not None or (body.content_type is not None and body.content_type != row["content_type"]):
            try:
                live_note = await collab.before_external_write(page_id)
            except collab.Busy as exc:
                raise HTTPException(409, str(exc))
            if live_note:
                row = await conn.fetchrow(slim, page_id)
                if base_at is not None and row and row["updated_at"] != base_at:
                    raise _conflict(row)

        # Build update fields
        updates: dict[str, Any] = {"updated_at": datetime.now(timezone.utc), "updated_by": user_id}
        if body.title is not None:
            updates["title"] = body.title
        if body.content_type is not None:
            updates["content_type"] = body.content_type
        if new_content is not None:
            updates["content"] = new_content
        if body.metadata is not None:
            old_meta = _meta(row["metadata"])
            new_meta = dict(body.metadata)
            if new_meta.pop("_slim", None):
                # Sent back from a page-list item, which carries only the
                # list's keys: the rest of the stored metadata is kept.
                kept = {k: v for k, v in old_meta.items() if k not in LIST_META_KEYS}
                new_meta = {**kept, **new_meta}
            # A database's schema and a row's property values are written by
            # routers/databases.py; an editor saving its copy of the metadata
            # must not roll them back.
            for owned in ("database", "props", "db_row", "imports"):
                if owned in old_meta:
                    new_meta[owned] = old_meta[owned]
            updates["metadata"] = json.dumps(new_meta)
        if body.is_password_protected is not None:
            updates["is_password_protected"] = body.is_password_protected
        if body.password is not None:
            updates["password_hash"] = _hash_password(body.password)
        given, expires_at = _parse_expiry(body.expires_at)
        if given:
            updates["expires_at"] = expires_at

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

        values = list(updates.values())
        n = len(values)
        set_sql = ", ".join(f"{k} = ${i + 1}{'::jsonb' if k == 'metadata' else ''}" for i, k in enumerate(updates))
        note = body.version_note or live_note
        guard = f"(${n + 4}::timestamptz IS NULL OR p.updated_at = ${n + 4}::timestamptz)"
        if tree:
            guard += " AND p.deleted_at IS NULL"
        sql = "WITH " + snapshot_update_sql(
            set_sql, page=f"${n + 1}", now="$1", user="$2", force=f"${n + 2}", note=f"${n + 3}",
            guard=guard, returning=_page_cols(tree, content=new_content is None, alias="p", drafts=drafts),
            writer_rule=True,
        ) + " SELECT * FROM upd"
        updated = await conn.fetchrow(
            sql, *values, page_id, bool(note), (note or "")[:200] or None, base_at,
        )
        if not updated:
            current = await conn.fetchrow(slim, page_id)
            if not current:
                raise HTTPException(404, "Page not found or was deleted")
            if page_tree.is_trashed(current):
                raise HTTPException(409, TRASHED_DETAIL)
            raise _conflict(current)
    out = _page_dict(updated)
    if new_content is not None:
        out["content"] = new_content
    if tree and updated["parent_id"] is not None:
        await _invalidate_public_rows(updated["parent_id"])
    return out


async def _invalidate_public_rows(db_id) -> None:
    from .databases import invalidate_public_rows  # databases imports this module
    await invalidate_public_rows(db_id)


async def _trash_subtree(conn, page_id: str, user_id, auth_role: str) -> list:
    """Move a page and everything under it that the caller owns to the trash,
    stamped with one moment so a restore brings back exactly that set. Live
    editing rooms on those pages are saved and closed first (close code
    4410). Returns the ids trashed."""
    now = datetime.now(timezone.utc)
    ids = [r["id"] for r in await page_tree.descendants(conn, page_id)
           if r["deleted_at"] is None and _owns_page(r, user_id, auth_role)]
    if not ids:
        return []
    try:
        await collab.close_pages([str(i) for i in ids])
    except Exception as exc:
        logger.warning("pages: closing live rooms before trash failed: %s", exc)
    await conn.execute(
        "UPDATE published_pages SET deleted_at = $1 WHERE id = ANY($2::uuid[])", now, ids
    )
    return ids


@router.delete("/api/pages/{page_id}")
async def delete_page(
    page_id: PageId,
    request: Request,
    role: str = Depends(require_auth),
):
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")

    user_id = getattr(request.state, "auth_user_id", None)
    auth_role = getattr(request.state, "auth_role", role) or role

    async with pool.acquire() as conn:
        if await page_tree.tree_ready(conn):
            # The page and its sub-pages (a database's rows included) go to
            # the trash, as from the sidebar: restorable, and nothing left
            # behind as an orphan. Deleting for good is the trash's job
            # (DELETE /api/pages/{id}/forever).
            row = await conn.fetchrow(
                "SELECT id, created_by, deleted_at FROM published_pages WHERE id = $1", page_id
            )
            if not row:
                raise HTTPException(404, "Page not found")
            if not _owns_page(row, user_id, auth_role):
                raise HTTPException(403, "Access denied")
            if page_tree.is_trashed(row):
                return {"ok": True, "trashed": []}
            ids = await _trash_subtree(conn, page_id, user_id, auth_role)
            if row and ids:
                parent = await conn.fetchval("SELECT parent_id FROM published_pages WHERE id = $1", page_id)
                if parent:
                    await _invalidate_public_rows(parent)
            return {"ok": True, "trashed": [str(i) for i in ids]}
        row = await conn.fetchrow(
            "SELECT id, created_by, content FROM published_pages WHERE id = $1", page_id
        )
        if not row:
            raise HTTPException(404, "Page not found")
        if not _owns_page(row, user_id, auth_role):
            raise HTTPException(403, "Access denied")
        await conn.execute("DELETE FROM published_pages WHERE id = $1", page_id)
    # Best-effort: remove the page's uploaded attachments from HF storage
    await _delete_page_assets(row["content"])
    return {"ok": True}


@router.delete("/api/pages/{page_id}/views/{view_id}")
async def delete_page_view(
    page_id: PageId,
    view_id: str,
    request: Request,
    role: str = Depends(require_auth),
):
    try:
        view_pk = int(view_id)
    except ValueError:
        raise HTTPException(404, "View not found")

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
        if not _owns_page(page, user_id, auth_role):
            raise HTTPException(403, "Access denied")

        result = await conn.execute(
            "DELETE FROM page_views WHERE id = $1 AND page_id = $2",
            view_pk, page_id,
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
    page_id: PageId,
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
        tree = await page_tree.tree_ready(conn)
        drafts = await page_tree.perf_ready(conn)
        extra = ", deleted_at, parent_id" if tree else ""
        row = await conn.fetchrow(
            f"SELECT id, created_by{extra} FROM published_pages WHERE id = $1", page_id
        )
        if not row:
            raise HTTPException(404, "Page not found")
        if not _owns_page(row, user_id, auth_role):
            raise HTTPException(403, "Access denied")
        if page_tree.is_trashed(row):
            raise HTTPException(409, TRASHED_DETAIL)

        # Publishing copies the working copy to what the public sees; until
        # the next publish, autosaves and live edits stay a draft.
        snapshot = (
            ", published_content = CASE WHEN $1 THEN content ELSE published_content END"
            ", published_content_type = CASE WHEN $1 THEN content_type ELSE published_content_type END"
            ", published_title = CASE WHEN $1 THEN title ELSE published_title END"
            ", published_at_rev = CASE WHEN $1 THEN $2 ELSE published_at_rev END"
        ) if drafts else ""
        updated = await conn.fetchrow(
            f"""
            UPDATE published_pages
            SET is_published = $1,
                published_at = CASE WHEN $1 = TRUE AND published_at IS NULL THEN $2 ELSE published_at END,
                updated_at   = $2{snapshot}
            WHERE id = $3
            RETURNING *
            """,
            body.published,
            datetime.now(timezone.utc),
            page_id,
        )
    if page_tree.field(row, "parent_id"):
        await _invalidate_public_rows(row["parent_id"])
    await _invalidate_public_rows(page_id)
    return _page_dict(updated)


@router.get("/api/pages/{page_id}/analytics")
async def page_analytics(
    page_id: PageId,
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
        if not _owns_page(page, user_id, auth_role):
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


_INSIGHTS_SQL = """
WITH v AS (
    SELECT viewed_at, viewer_ip,
           CASE
               WHEN coalesce(user_agent, '') = '' THEN 'Unknown'
               WHEN user_agent ~* '(ipad|tablet)' THEN 'Tablet'
               WHEN user_agent ~* '(mobi|iphone|android)' THEN 'Mobile'
               ELSE 'Desktop'
           END AS device,
           coalesce(nullif(metadata->'geo'->>'country', ''), nullif(country, ''), 'Unknown') AS place
    FROM page_views WHERE page_id = $1
)
SELECT json_build_object(
    'total',    (SELECT count(*) FROM v),
    'unique',   (SELECT count(DISTINCT viewer_ip) FROM v),
    'last7',    (SELECT count(*) FROM v WHERE viewed_at >= now() - interval '7 days'),
    'prev7',    (SELECT count(*) FROM v WHERE viewed_at >= now() - interval '14 days'
                                          AND viewed_at <  now() - interval '7 days'),
    'daily',    (SELECT coalesce(json_agg(json_build_object('day', d, 'views', n) ORDER BY d), '[]')
                 FROM (SELECT (viewed_at AT TIME ZONE 'Asia/Kolkata')::date AS d, count(*) AS n
                       FROM v WHERE viewed_at >= now() - interval '30 days' GROUP BY 1) t),
    'devices',  (SELECT coalesce(json_agg(json_build_object('name', device, 'views', n) ORDER BY n DESC), '[]')
                 FROM (SELECT device, count(*) AS n FROM v GROUP BY 1) t),
    'countries',(SELECT coalesce(json_agg(json_build_object('name', place, 'views', n) ORDER BY n DESC), '[]')
                 FROM (SELECT place, count(*) AS n FROM v GROUP BY 1 ORDER BY 2 DESC LIMIT 6) t)
)
"""


@router.get("/api/pages/{page_id}/insights")
async def page_insights(page_id: PageId, request: Request, role: str = Depends(require_auth)):
    """Totals and breakdowns over every view of a page, for the insights
    charts. The analytics list only carries the latest rows, so charts drawn
    from it undercounted any page past its first hundred views."""
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")
    user_id = getattr(request.state, "auth_user_id", None)
    auth_role = getattr(request.state, "auth_role", role) or role
    async with pool.acquire() as conn:
        page = await conn.fetchrow("SELECT id, created_by FROM published_pages WHERE id = $1", page_id)
        if not page:
            raise HTTPException(404, "Page not found")
        if not _owns_page(page, user_id, auth_role):
            raise HTTPException(403, "Access denied")
        raw = await conn.fetchval(_INSIGHTS_SQL, page_id)
    data = json.loads(raw) if isinstance(raw, str) else raw
    for row in data.get("daily") or []:
        row["day"] = str(row["day"])
    return data


# ---------------------------------------------------------------------------
# Version history endpoints
# ---------------------------------------------------------------------------

@router.get("/api/pages/{page_id}/versions")
async def list_page_versions(
    page_id: PageId,
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
        if not _owns_page(page, user_id, auth_role):
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

        items = [dict(r) for r in rows]
        await _fill_word_counts(conn, items)

    for d in items:
        d["saved_at"] = _dt(d.get("saved_at"))
    return {"total": len(items), "items": items}


@router.get("/api/pages/{page_id}/versions/{version_id}")
async def get_page_version(
    page_id: PageId,
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
        if not _owns_page(page, user_id, auth_role):
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
    d.pop("asset_paths", None)
    if (d.get("word_count") or 0) < 0:
        d["word_count"] = _word_count(d.get("content"), d.get("content_type"))
    d["saved_at"] = _dt(d.get("saved_at"))
    if d.get("metadata"):
        d["metadata"] = _meta(d["metadata"])
    d["page_id"] = str(d["page_id"]) if d.get("page_id") else None
    return d


@router.post("/api/pages/{page_id}/versions/{version_id}/restore")
async def restore_page_version(
    page_id: PageId,
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
        if not _owns_page(page, user_id, auth_role):
            raise HTTPException(403, "Access denied")

        if page_tree.is_trashed(page):
            raise HTTPException(409, TRASHED_DETAIL)
        ver = await conn.fetchrow(
            "SELECT * FROM page_versions WHERE id = $1 AND page_id = $2",
            version_id, page_id,
        )
        if not ver:
            raise HTTPException(404, "Version not found")

        # Live editors are saved, then sent to re-sync onto the restored copy.
        if await collab.before_external_write(page_id, force=True):
            page = await conn.fetchrow("SELECT * FROM published_pages WHERE id = $1", page_id)

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
            _word_count(page["content"], page["content_type"]),
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

    if not row or not row["is_published"] or page_tree.is_trashed(row):
        raise HTTPException(404, "Page not found")
    if _is_expired(row):
        raise HTTPException(410, "Page has expired")

    import json as _json
    _no_cache = {"Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache"}

    row = _public_copy(row)
    if row["is_password_protected"]:
        return Response(
            content=_json.dumps({"requires_password": True, "title": row["title"], "id": str(row["id"]), "slug": row["slug"]}),
            media_type="application/json",
            headers=_no_cache,
        )

    # Sub-pages and the trail of published parents (empty before migration
    # 0004), and a database's rows: independent, so fetched side by side.
    family, rows = await asyncio.gather(page_tree.public_family(pool, row), _public_database_rows(pool, row))
    return Response(
        content=_json.dumps({**_public_page_dict(row, with_render_token=_source_protected(row)), **family, **rows}),
        media_type="application/json",
        headers=_no_cache,
    )


def _public_origin(request: Request) -> str:
    """The site visitors use, for the links inside a preview card."""
    for o in (settings.frontend_url or "").split(","):
        o = o.strip().rstrip("/")
        if o.startswith("http"):
            return o
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    return f"https://{host}" if host else ""


def _share_fields(row) -> dict:
    """What a link preview may say about a page. A protected or expired page
    gives away no more than its own password or expiry screen already does."""
    if not row or not row["is_published"] or page_tree.is_trashed(row):
        return {"title": "Page not found", "description": "", "badge": ""}
    if _is_expired(row):
        return {"title": "This link has expired", "description": "Ask the person who shared it for a new link.", "badge": ""}
    meta = _meta(row["metadata"])
    if row["is_password_protected"]:
        return {"title": row["title"] or "Protected page", "description": "Enter the password to view this page.", "badge": "Password protected"}
    description = (meta.get("description") or "").strip()
    if not description and row["content_type"] == page_doc.DOC_TYPE:
        # A block document with no written description is previewed by its
        # opening text.
        description = page_doc.doc_excerpt(row["content"])
    if not description and row["content_type"] == artifact.CONTENT_TYPE:
        # An artifact rarely gets a description typed in; its own document has one.
        description = artifact.describe(row["content"])
    return {"title": row["title"] or "Untitled page", "description": description, "badge": ""}


@router.get("/api/public/pages/{slug}/share", response_class=HTMLResponse)
async def public_share_card(slug: str, request: Request):
    """Link-preview document for crawlers (WhatsApp, LinkedIn, Slack...)."""
    pool = get_pool()
    row = None
    if pool:
        async with pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM published_pages WHERE slug = $1", slug)
    f = _share_fields(_public_copy(row) if row else row)
    origin = _public_origin(request)
    version = int(row["updated_at"].timestamp()) if row and row["updated_at"] else 0
    body = page_share.share_html(
        title=f["title"], description=f["description"],
        url=f"{origin}/p/{quote(slug)}",
        image=f"{origin}/p/{quote(slug)}/preview.png?v={version}",
        site_name="FinTrack Pages",
    )
    return HTMLResponse(body, headers={"Cache-Control": "public, max-age=300", "X-Robots-Tag": "noindex"})


@router.get("/api/public/pages/{slug}/og.png")
async def public_share_image(slug: str, request: Request):
    pool = get_pool()
    row = None
    if pool:
        async with pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM published_pages WHERE slug = $1", slug)
    f = _share_fields(_public_copy(row) if row else row)
    host = _public_origin(request).split("://", 1)[-1]
    version = row["updated_at"].timestamp() if row and row["updated_at"] else 0
    key = (slug, version, f["title"], f["description"], f["badge"])
    png = await asyncio.to_thread(
        page_share.card_png_cached, key,
        title=f["title"], description=f["description"], footer=host, badge=f["badge"],
    )
    return Response(png, media_type="image/png", headers={"Cache-Control": "public, max-age=3600"})


@router.get("/api/public/pages/preview/{token}", response_class=HTMLResponse)
async def public_render_preview(token: str):
    """Render whatever an author parked under this token. Declared before the
    slug route so `preview` is never mistaken for a page slug."""
    content = await _preview_get(token)
    if content is None:
        return notice_page(
            "Preview expired",
            "This preview has expired. Close the preview and open it again to see your latest changes.",
            status=404,
        )
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

    if not row or not row["is_published"] or page_tree.is_trashed(row):
        raise HTTPException(404, "Page not found")
    if _is_expired(row):
        raise HTTPException(410, "Page has expired")
    protected = _source_protected(row)
    if (row["is_password_protected"] or protected) and not _render_token_valid(slug, t):
        raise HTTPException(401, "This page is protected.")

    # A page with an expiry is never cached, so it stops on the minute it is
    # set to rather than living on in a cache for up to a minute more.
    cacheable = not (row["is_password_protected"] or protected or row["expires_at"])
    return HTMLResponse(
        content=page_render.build_document(_public_copy(row)["content"] or "", protect=protected),
        headers=page_render.render_headers(cacheable=cacheable),
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

    if not row or not row["is_published"] or page_tree.is_trashed(row):
        raise HTTPException(404, "Page not found")
    if _is_expired(row):
        raise HTTPException(410, "Page has expired")

    row = _public_copy(row)
    if not row["is_password_protected"]:
        return _public_page_dict(row, with_render_token=_source_protected(row))

    if _hash_password(body.password) != (row["password_hash"] or ""):
        raise HTTPException(401, "Incorrect password")

    # The renderer serves the document straight into an iframe and has no way
    # to be told a password, so proof of the password travels as a token.
    family, rows = await asyncio.gather(page_tree.public_family(pool, row), _public_database_rows(pool, row))
    return {**_public_page_dict(row, with_render_token=True), **family, **rows}


async def _public_database_rows(pool, row) -> dict:
    """A published database carries its rows (empty for any other page)."""
    from .databases import public_rows  # databases imports this module
    return await public_rows(pool, row)


@router.post("/api/public/pages/{slug}/view")
async def public_log_view(slug: str, body: LogViewBody, request: Request):
    pool = get_pool()
    if not pool:
        return {"ok": True}

    async with pool.acquire() as conn:
        trashed = ", deleted_at" if await page_tree.tree_ready(conn) else ""
        row = await conn.fetchrow(
            f"SELECT id, is_published{trashed} FROM published_pages WHERE slug = $1", slug
        )

    if not row or not row["is_published"] or page_tree.is_trashed(row):
        return {"ok": True}

    ip = client_ip(request)
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

def notice_page(title: str, message: str, status: int = 404) -> HTMLResponse:
    """A small self-contained HTML page for an iframe (an expired preview or
    embed link): a framed document has nowhere to show a JSON error."""
    from html import escape
    body = (
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        f"<title>{escape(title)}</title><style>"
        "body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#37352f;"
        "background:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh}"
        "main{max-width:420px;padding:24px;text-align:center}h1{font-size:18px;margin:0 0 8px}"
        "p{margin:0 0 16px;color:#6b6b6b}button{font:inherit;padding:6px 14px;border-radius:6px;"
        "border:1px solid #d3d3d0;background:#f7f7f5;cursor:pointer}"
        "@media (prefers-color-scheme:dark){body{background:#191919;color:#e3e3e1}p{color:#9b9b9b}"
        "button{background:#2a2a2a;border-color:#3a3a3a;color:inherit}}"
        "</style></head><body><main>"
        f"<h1>{escape(title)}</h1><p>{escape(message)}</p>"
        "<button onclick='location.reload()'>Reload</button>"
        "</main></body></html>"
    )
    return HTMLResponse(body, status_code=status, headers={
        "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
    })


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
    d.pop("asset_paths", None)
    _drafts_fields(d)
    if "parent_id" in d and d["parent_id"] is not None:
        d["parent_id"] = str(d["parent_id"])
    if isinstance(d.get("deleted_at"), datetime):
        d["deleted_at"] = d["deleted_at"].isoformat()
    return d


def _drafts_fields(d: dict) -> None:
    """has_unpublished_changes on every page response (False before 0006),
    published_at_rev as ISO; the published copy itself is left out."""
    if "has_unpublished_changes" not in d:
        d["has_unpublished_changes"] = bool(d.get("is_published") and d.get("draft_changed"))
    d["has_unpublished_changes"] = bool(d["has_unpublished_changes"])
    for k in _PUBLISHED_COLS:
        d.pop(k, None)
    if isinstance(d.get("published_at_rev"), datetime):
        d["published_at_rev"] = d["published_at_rev"].isoformat()


def _page_list_dict(row) -> dict:
    d = dict(row)
    _drafts_fields(d)
    d["id"] = str(d["id"])
    d["created_by"] = str(d["created_by"]) if d.get("created_by") else None
    d["created_at"] = _dt(d.get("created_at"))
    d["updated_at"] = _dt(d.get("updated_at"))
    d["published_at"] = _dt(d.get("published_at"))
    d["expires_at"] = _dt(d.get("expires_at"))
    d["metadata"] = _meta(d.get("metadata"))
    return d


# Settings that only matter to the author and say nothing a visitor needs.
_PRIVATE_META_KEYS = ("folder",)

# A protected page's render token is short-lived: long enough to load the page,
# too short to be worth passing around as a way to fetch its source.
PROTECTED_RENDER_TOKEN_TTL_SECONDS = 10 * 60


def _public_page_dict(row, with_render_token: bool = False) -> dict:
    meta = {k: v for k, v in _meta(row["metadata"]).items() if k not in _PRIVATE_META_KEYS}
    protected = bool(meta.get("protect_source"))
    d = {
        "id": str(row["id"]),
        "slug": row["slug"],
        "title": row["title"],
        "content_type": row["content_type"],
        # A protected web page or artifact is shown only through its render
        # URL, so its source is not handed out here as well.
        "content": "" if protected and artifact.is_rendered(row["content_type"]) else row["content"],
        "published_at": _dt(row["published_at"]),
        "expires_at": _dt(row["expires_at"]),
        "metadata": meta,
    }
    if with_render_token:
        ttl = PROTECTED_RENDER_TOKEN_TTL_SECONDS if protected and not row["is_password_protected"] else RENDER_TOKEN_TTL_SECONDS
        d["render_token"] = _render_token(row["slug"], ttl)
    return d
