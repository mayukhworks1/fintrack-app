"""
File storage proxy — serves files from the private HF dataset.

All endpoints require authentication so the private dataset stays private.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from .deps import require_auth
from ..services.storage import read_bytes, MIME_FOR_EXT

router = APIRouter(prefix="/api/storage", tags=["storage"])


@router.get("/file/{path:path}")
async def proxy_file(path: str, _role: str = Depends(require_auth)):
    """
    Stream a file from the HF dataset storage. Path is the repo-relative path,
    e.g. /api/storage/file/profiles/{user_id}/avatar.jpg
    """
    if ".." in path or path.startswith("/"):
        raise HTTPException(400, "Invalid path")

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
        },
    )
