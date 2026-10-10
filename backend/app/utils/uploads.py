"""
Size limits for multipart uploads.

Two layers, because neither is enough alone:

* UploadSizeLimitMiddleware refuses a multipart body larger than the global
  cap (settings.max_upload_bytes) before any route sees it: from the
  Content-Length header when the client sends one, and by counting bytes as
  they arrive when it does not. Without it Starlette spools the whole body,
  however large, to a temporary file before the route runs.

* read_upload() is what each upload route uses instead of `await file.read()`.
  It applies the route's own limit and reads in chunks, so an oversized file is
  never loaded into memory whole. The API is a single process: an out-of-memory
  kill takes every user's session and the background sync down with it.
"""

from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, UploadFile
from fastapi.responses import JSONResponse

from ..config import settings

_READ_CHUNK = 1024 * 1024

# Multipart framing (boundaries, part headers, small form fields) rides on top
# of the file, so a body slightly over the cap can still carry a file under it.
# The middleware allows for it; the route's exact check is on the file itself.
MULTIPART_OVERHEAD_BYTES = 64 * 1024

# How much of an oversized body is read and thrown away before answering. A
# browser that is still sending when the server answers and closes often shows
# a network error instead of the 413, so a modestly oversized file is drained to
# get a readable answer. Past this the connection is simply cut short.
_DRAIN_LIMIT_BYTES = 64 * 1024 * 1024


def upload_limit(route_limit: Optional[int] = None) -> int:
    """The byte limit for a route: the global cap, or the route's own if smaller."""
    cap = settings.max_upload_bytes
    return min(cap, route_limit) if route_limit else cap


def _too_large_message(limit: int) -> str:
    return f"File too large (max {limit / (1024 * 1024):g} MB)"


def too_large(limit: int) -> HTTPException:
    return HTTPException(status_code=413, detail=_too_large_message(limit))


async def read_upload(file: UploadFile, limit: int) -> bytes:
    """Read an uploaded file, refusing it with 413 once it passes `limit` bytes."""
    # Starlette counts the bytes as it spools the part, so an oversized file is
    # usually refused here without reading any of it.
    if file.size is not None and file.size > limit:
        raise too_large(limit)
    data = bytearray()
    while True:
        chunk = await file.read(_READ_CHUNK)
        if not chunk:
            break
        data += chunk
        if len(data) > limit:
            raise too_large(limit)
    return bytes(data)


def _header(scope, name: bytes) -> Optional[bytes]:
    for key, value in scope.get("headers") or ():
        if key.lower() == name:
            return value
    return None


async def _drain(receive, seen: int = 0) -> None:
    """Read and discard the rest of the request body, up to _DRAIN_LIMIT_BYTES."""
    while seen < _DRAIN_LIMIT_BYTES:
        message = await receive()
        if message["type"] != "http.request":
            return
        seen += len(message.get("body", b""))
        if not message.get("more_body", False):
            return


class UploadSizeLimitMiddleware:
    """Refuse a multipart body over the global upload cap before it is spooled.

    Pure ASGI rather than @app.middleware("http"): it has to see the body as it
    streams in, before FastAPI parses the form.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        content_type = _header(scope, b"content-type") if scope["type"] == "http" else None
        if not content_type or not content_type.lower().startswith(b"multipart/form-data"):
            await self.app(scope, receive, send)
            return

        cap = settings.max_upload_bytes
        limit = cap + MULTIPART_OVERHEAD_BYTES
        try:
            length = int(_header(scope, b"content-length") or b"")
        except ValueError:
            length = None
        if length is not None and length > limit:
            await _drain(receive)
            # Same envelope as main.http_exception_handler, which this response
            # never passes through.
            state = scope.get("state") or {}
            response = JSONResponse(
                status_code=413,
                content={
                    "error": {
                        "code":       413,
                        "type":       "HTTPException",
                        "message":    _too_large_message(cap),
                        "request_id": state.get("request_id") if isinstance(state, dict) else None,
                    }
                },
            )
            await response(scope, receive, send)
            return

        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    if message.get("more_body", False):
                        await _drain(receive, received)
                    # Raised inside the route's form parsing. FastAPI re-raises an
                    # HTTPException from there, so the client gets the 413.
                    raise too_large(cap)
            return message

        await self.app(scope, limited_receive, send)
