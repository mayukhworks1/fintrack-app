"""
Artifacts addressed by page id, for embedding inside other pages.

A published artifact is served at /api/public/pages/{slug}/render like any Web
Page. An artifact embedded in a document the author is still editing may not
be published yet, and the embed should not break when the artifact's slug is
renamed, so it is addressed by id instead — with a short-lived token that only
someone allowed to open the page can mint. The document comes out of the same
renderer under the same sandbox and policy as every other page.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse

from ..db.postgres import get_pool
from ..services import artifact, page_render
from . import pages as P
from .deps import require_auth

router = APIRouter()

# Long enough for an editing session; an embed asks for a new one on reload.
EMBED_TOKEN_TTL_SECONDS = 60 * 60


def _scope(page_id: str) -> str:
    # A separate scope from the slug tokens, so an unlock token for a published
    # page can never stand in for an embed token, nor the other way round.
    return f"embed:{page_id}"


@router.post("/api/pages/{page_id}/artifact-token")
async def mint_artifact_token(
    page_id: P.PageId,
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
            "SELECT id, created_by, content_type FROM published_pages WHERE id = $1", page_id
        )
    if not row:
        raise HTTPException(404, "Page not found")
    if not P._owns_page(row, user_id, auth_role):
        raise HTTPException(403, "Access denied")
    if not artifact.is_rendered(row["content_type"]):
        raise HTTPException(400, "Only artifacts and web pages can be embedded.")
    return {
        "token": P._render_token(_scope(page_id), EMBED_TOKEN_TTL_SECONDS),
        "expires_in": EMBED_TOKEN_TTL_SECONDS,
    }


@router.get("/api/public/pages/by-id/{page_id}/render", response_class=HTMLResponse)
async def render_artifact_by_id(page_id: P.PageId, t: str | None = None):
    if not P._render_token_valid(_scope(page_id), t):
        # Shown inside the embedding iframe: a page, not a JSON error.
        return P.notice_page("Embed link expired",
                             "This embed link has expired. Reload the page to show it again.", status=401)
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM published_pages WHERE id = $1", page_id)
    if not row or not artifact.is_rendered(row["content_type"]):
        raise HTTPException(404, "Page not found")
    return HTMLResponse(
        content=page_render.build_document(row["content"] or "", protect=P._source_protected(row)),
        headers={**page_render.render_headers(cacheable=False), "X-Robots-Tag": "noindex, nofollow"},
    )
