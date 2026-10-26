"""
JSON responses for large lists, with an ETag.

FastAPI's default path runs every value of a returned list through
jsonable_encoder before serialising it, which cost ~670 ms of event-loop time
for the pages list at 14k rows. The routes using this build plain dicts of
str / int / float / bool / None (datetimes already isoformat()ed), so a single
json.dumps is enough; default=str is only a safety net.

The ETag is a hash of the body. A client that sends it back in If-None-Match
gets a bodiless 304, so the polling page list and the sidebar tree cost one
query and no transfer when nothing changed. Browsers do this on their own for
fetch() once a response carries an ETag and `Cache-Control: no-cache`.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from fastapi.responses import Response


def dumps(payload: Any) -> bytes:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False, default=str).encode("utf-8")


def etag_of(body: bytes) -> str:
    return '"' + hashlib.blake2b(body, digest_size=16).hexdigest() + '"'


def _matches(header: str | None, etag: str) -> bool:
    if not header:
        return False
    if header.strip() == "*":
        return True
    bare = etag.strip('"')
    for tag in header.split(","):
        t = tag.strip()
        if t.startswith("W/"):
            t = t[2:]
        if t.strip('"') == bare:
            return True
    return False


def json_response(request: Any, payload: Any, *, etag: bool = True, headers: dict | None = None) -> Response:
    """A JSON Response for payload; a 304 when the client already holds it."""
    body = dumps(payload)
    out = dict(headers or {})
    if etag:
        tag = etag_of(body)
        out["ETag"] = tag
        # Revalidate every time, never store in a shared cache; vary by caller.
        out.setdefault("Cache-Control", "private, no-cache")
        out["Vary"] = "Authorization"
        hdrs = getattr(request, "headers", None) or {}
        try:
            inm = hdrs.get("if-none-match") or hdrs.get("If-None-Match")
        except Exception:
            inm = None
        if _matches(inm, tag):
            return Response(status_code=304, headers=out)
    return Response(content=body, media_type="application/json", headers=out)


def body_of(response: Any) -> Any:
    """Decode a Response built here (for callers and tests that want data)."""
    if isinstance(response, Response):
        return json.loads(response.body) if response.body else None
    return response
