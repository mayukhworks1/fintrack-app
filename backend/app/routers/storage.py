"""
File storage proxy — serves profile pictures from the private HF dataset.

All endpoints require authentication so the private dataset stays private.
Only profiles/ is served: Studio documents are owner-scoped by their own
routes, and page assets have a public route of their own.
"""
from __future__ import annotations

from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from ..config import settings

from .deps import require_auth
from ..services.storage import read_bytes, MIME_FOR_EXT

router = APIRouter(prefix="/api/storage", tags=["storage"])

_SERVED_PREFIX = "profiles/"   # avatars, the only files this route links to


@router.get("/file/{path:path}")
async def proxy_file(path: str, _role: str = Depends(require_auth)):
    """
    Stream a file from the HF dataset storage. Path is the repo-relative path,
    e.g. /api/storage/file/profiles/{user_id}/avatar.jpg
    """
    if ".." in path or path.startswith("/"):
        raise HTTPException(400, "Invalid path")
    if not path.startswith(_SERVED_PREFIX):
        raise HTTPException(404, "File not found")

    data = await read_bytes(path)
    if data is None:
        raise HTTPException(404, "File not found")

    ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
    content_type = MIME_FOR_EXT.get(ext, "application/octet-stream")

    return Response(
        content=data,
        media_type=content_type,
        headers={
            "Cache-Control": "private, max-age=86400",
            "Content-Length": str(len(data)),
            "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
            "X-Content-Type-Options": "nosniff",
        },
    )


# ---------------------------------------------------------------------------
# Attachment relay: lets the in-app viewer read a Teable attachment (a PDF on
# an invoice) without depending on the storage host's CORS. Signed-in users
# only, Teable hosts only, no redirects off those hosts, size-capped.
# ---------------------------------------------------------------------------

_REMOTE_MAX_BYTES = 30 * 1024 * 1024
_REMOTE_TIMEOUT = httpx.Timeout(20.0, connect=8.0)
_TEABLE_SUFFIXES = (".teable.ai", ".teable.io", ".teable.cn")


def remote_host_allowed(url: str) -> bool:
    try:
        u = urlparse(url)
    except ValueError:
        return False
    if u.scheme != "https" or not u.hostname or u.username or u.password:
        return False
    if u.port not in (None, 443):
        return False
    host = u.hostname.lower()
    base = (urlparse(settings.teable_base_url).hostname or "").lower()
    if base and host == base:
        return True
    return any(host == s[1:] or host.endswith(s) for s in _TEABLE_SUFFIXES)


@router.get("/remote")
async def relay_remote_file(url: str = Query(..., max_length=4096),
                            _role: str = Depends(require_auth)):
    """Fetch an attachment from Teable storage for the in-app document viewer."""
    if not remote_host_allowed(url):
        raise HTTPException(400, "That file host is not allowed")
    async with httpx.AsyncClient(timeout=_REMOTE_TIMEOUT, follow_redirects=False) as client:
        target = url
        for _ in range(3):
            resp = await client.get(target)
            if resp.status_code in (301, 302, 303, 307, 308):
                nxt = str(resp.next_request.url) if resp.next_request else ""
                if not remote_host_allowed(nxt):
                    raise HTTPException(502, "The file host redirected somewhere not allowed")
                target = nxt
                continue
            break
        else:
            raise HTTPException(502, "Too many redirects")
    if resp.status_code != 200:
        raise HTTPException(502 if resp.status_code >= 500 else 404, "Could not fetch the file")
    data = resp.content
    if len(data) > _REMOTE_MAX_BYTES:
        raise HTTPException(413, "File is too large to preview")
    media = (resp.headers.get("content-type") or "application/octet-stream").split(";")[0].strip()
    return Response(
        content=data,
        media_type=media,
        headers={
            "Cache-Control": "private, max-age=600",
            "X-Content-Type-Options": "nosniff",
            **({} if media == "application/pdf" else {
                "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
            }),
            "Content-Disposition": "inline",
        },
    )
