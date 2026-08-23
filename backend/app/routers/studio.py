"""
Studio router — ask questions of your own documents.

Prefix: /api/studio

Access is gated by the existing permission matrix (`module.studio.*`) on top of
`require_auth`, matching how every other module in this app composes the two.
One deliberate difference: Studio refuses legacy password sessions outright.
`require_permission` waves those through for backwards compatibility, and this
module is new — nothing depends on that behaviour here, so it starts closed
rather than inheriting an exemption.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from ..db.postgres import get_pool
from ..services import ai_usage, storage, studio_ask, studio_docs
from .deps import require_auth, require_permission, owner_scope_email

logger = logging.getLogger("fintrack.studio")

router = APIRouter(prefix="/api/studio", tags=["studio"])


def _user_id(request: Request) -> str | None:
    return getattr(request.state, "auth_user_id", None)


def _require_email_auth(request: Request) -> None:
    """
    Studio is email-auth only.

    The shared permission dependency exempts legacy password sessions so older
    deployments keep working. A password holder therefore carries no user id,
    which means no ownership, no quota and no audit trail — none of which this
    module can do without.
    """
    if not getattr(request.state, "is_email_auth", False):
        raise HTTPException(403, "Studio requires a signed-in account.")


def _safe_name(name: str) -> str:
    stem = (name or "file").rsplit(".", 1)[0]
    slug = re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-")
    return slug[:40] or "file"


class AskBody(BaseModel):
    question: str
    document_ids: list[str] | None = None
    thread_id: str | None = None


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------

@router.get("/documents")
async def list_documents(
    request: Request,
    role: str = Depends(require_auth),
    _perm: str = Depends(require_permission("module.studio.view")),
):
    _require_email_auth(request)
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")

    # Scoped users see only what they uploaded. owner_scope_email returns None
    # for privileged roles, which is what widens this to everything.
    scope = owner_scope_email(request)
    rows = await pool.fetch(
        """
        SELECT id, title, filename, mime_type, byte_size, page_count, chunk_count,
               status, error, owner_email, created_at, ingested_at
          FROM studio_documents
         WHERE ($1::text IS NULL OR LOWER(owner_email) = LOWER($1))
         ORDER BY created_at DESC
         LIMIT 200
        """,
        scope,
    )
    return {
        "documents": [
            {
                "id": str(r["id"]),
                "title": r["title"],
                "filename": r["filename"],
                "mime_type": r["mime_type"],
                "byte_size": r["byte_size"],
                "page_count": r["page_count"],
                "chunk_count": r["chunk_count"],
                "status": r["status"],
                "error": r["error"],
                "owner_email": r["owner_email"],
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                "ingested_at": r["ingested_at"].isoformat() if r["ingested_at"] else None,
            }
            for r in rows
        ]
    }


@router.post("/documents")
async def upload_document(
    request: Request,
    file: UploadFile = File(...),
    role: str = Depends(require_auth),
    _perm: str = Depends(require_permission("module.studio.docs.manage")),
):
    """
    Store a document and start ingesting it.

    The response returns as soon as the file is stored — extraction, chunking
    and embedding run detached, because a large PDF takes longer than a request
    should. The row's `status` is how the client follows along.
    """
    _require_email_auth(request)
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")

    data = await file.read()
    if not data:
        raise HTTPException(400, "That file is empty.")
    if len(data) > studio_docs.MAX_UPLOAD_BYTES:
        raise HTTPException(
            413,
            f"Files must be under {studio_docs.MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
        )

    filename = file.filename or "document"
    content_type = (file.content_type or "").split(";")[0].strip()
    if not studio_docs.kind_for(filename, content_type):
        raise HTTPException(
            415, "Studio reads PDF, text, Markdown, CSV and JSON files."
        )

    ext = filename.rsplit(".", 1)[-1].lower()[:8] if "." in filename else "bin"
    path = (
        f"studio/{datetime.now(timezone.utc):%Y/%m}/"
        f"{secrets.token_hex(8)}-{_safe_name(filename)}.{ext}"
    )
    try:
        await storage.upload_bytes(data, path, content_type=content_type or "application/octet-stream")
    except Exception as exc:
        raise HTTPException(502, f"Could not store the file: {exc}")

    row = await pool.fetchrow(
        """
        INSERT INTO studio_documents
            (title, filename, storage_path, mime_type, byte_size, owner_email, created_by, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7::uuid, 'pending')
        RETURNING id, created_at
        """,
        filename.rsplit(".", 1)[0][:500], filename, path, content_type,
        len(data), getattr(request.state, "auth_user_email", None), _user_id(request),
    )

    document_id = str(row["id"])
    asyncio.create_task(studio_docs.ingest_document(document_id))

    return {
        "id": document_id,
        "filename": filename,
        "byte_size": len(data),
        "status": "pending",
        "created_at": row["created_at"].isoformat(),
    }


@router.get("/documents/{document_id}")
async def get_document(
    document_id: str,
    request: Request,
    role: str = Depends(require_auth),
    _perm: str = Depends(require_permission("module.studio.view")),
):
    """Poll target while a document ingests."""
    _require_email_auth(request)
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")

    scope = owner_scope_email(request)
    row = await pool.fetchrow(
        """
        SELECT id, title, filename, status, error, page_count, chunk_count, ingested_at
          FROM studio_documents
         WHERE id = $1::uuid
           AND ($2::text IS NULL OR LOWER(owner_email) = LOWER($2))
        """,
        document_id, scope,
    )
    if not row:
        raise HTTPException(404, "Document not found")
    return {
        "id": str(row["id"]),
        "title": row["title"],
        "filename": row["filename"],
        "status": row["status"],
        "error": row["error"],
        "page_count": row["page_count"],
        "chunk_count": row["chunk_count"],
        "ingested_at": row["ingested_at"].isoformat() if row["ingested_at"] else None,
    }


@router.delete("/documents/{document_id}")
async def delete_document(
    document_id: str,
    request: Request,
    role: str = Depends(require_auth),
    _perm: str = Depends(require_permission("module.studio.docs.manage")),
):
    _require_email_auth(request)
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")

    scope = owner_scope_email(request)
    row = await pool.fetchrow(
        """
        DELETE FROM studio_documents
         WHERE id = $1::uuid
           AND ($2::text IS NULL OR LOWER(owner_email) = LOWER($2))
        RETURNING storage_path
        """,
        document_id, scope,
    )
    if not row:
        raise HTTPException(404, "Document not found")

    # Chunks go with the row through ON DELETE CASCADE. The stored file is
    # best-effort: an orphaned blob costs storage, a failed delete costs the
    # user their action.
    if row["storage_path"]:
        try:
            await storage.delete_path(row["storage_path"])
        except Exception as exc:
            logger.warning("studio: storage delete failed for %s: %s", document_id, exc)

    return {"ok": True}


# ---------------------------------------------------------------------------
# Ask
# ---------------------------------------------------------------------------

@router.post("/ask")
async def ask(
    body: AskBody,
    request: Request,
    role: str = Depends(require_auth),
    _perm: str = Depends(require_permission("module.studio.ask")),
):
    """Answer a question from the corpus, with citations."""
    _require_email_auth(request)
    user_id = _user_id(request)

    quota = await ai_usage.quota_state(user_id, getattr(request.state, 'auth_role', None))
    if not quota["allowed"]:
        raise HTTPException(
            429,
            f"Daily AI limit reached ({quota['used']}/{quota['limit']} calls). "
            "It resets on a rolling 24-hour window.",
        )

    pool = get_pool()

    # Prior turns of this conversation, so a follow-up is answered in context
    # rather than in isolation. Loaded before the model call because the answer
    # depends on them.
    history: list[dict] = []
    if pool and body.thread_id:
        try:
            rows = await pool.fetch(
                """
                SELECT question, answer FROM studio_turns
                 WHERE thread_id = $1::uuid
                 ORDER BY created_at DESC LIMIT 3
                """,
                body.thread_id,
            )
            history = [dict(r) for r in reversed(rows)]
        except Exception as exc:
            logger.debug("studio: could not load thread history: %s", exc)

    try:
        result = await studio_ask.ask(body.question, body.document_ids or None, history)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        logger.exception("studio ask failed")
        raise HTTPException(502, f"Could not answer that: {exc}")

    if pool:
        try:
            thread_id = body.thread_id
            if not thread_id:
                thread_row = await pool.fetchrow(
                    """
                    INSERT INTO studio_threads (title, created_by, owner_email)
                    VALUES ($1, $2::uuid, $3) RETURNING id
                    """,
                    body.question[:200], user_id,
                    getattr(request.state, "auth_user_email", None),
                )
                thread_id = str(thread_row["id"])
            await pool.execute(
                """
                INSERT INTO studio_turns
                    (thread_id, question, answer, model, verdict, sources, latency_ms)
                VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7)
                """,
                thread_id, body.question, result["answer"], result["model"],
                result["verdict"],
                json.dumps(result["sources"]), result["latency_ms"],
            )
            await pool.execute(
                "UPDATE studio_threads SET updated_at = NOW() WHERE id = $1::uuid", thread_id
            )
            result["thread_id"] = thread_id
        except Exception as exc:
            # A question that was answered should not fail because the
            # transcript could not be written.
            logger.warning("studio: could not persist turn: %s", exc)

    result["quota"] = await ai_usage.quota_state(user_id, getattr(request.state, 'auth_role', None))
    return result


@router.get("/threads")
async def list_threads(
    request: Request,
    role: str = Depends(require_auth),
    _perm: str = Depends(require_permission("module.studio.view")),
):
    _require_email_auth(request)
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")

    scope = owner_scope_email(request)
    rows = await pool.fetch(
        """
        SELECT t.id, t.title, t.updated_at, t.created_at,
               COUNT(u.id) AS turns,
               MAX(u.created_at) AS last_asked
          FROM studio_threads t
          LEFT JOIN studio_turns u ON u.thread_id = t.id
         WHERE ($1::text IS NULL OR LOWER(t.owner_email) = LOWER($1))
         GROUP BY t.id
        HAVING COUNT(u.id) > 0
         ORDER BY t.updated_at DESC
         LIMIT 50
        """,
        scope,
    )
    return {
        "threads": [
            {
                "id": str(r["id"]),
                "title": r["title"],
                "turns": int(r["turns"]),
                "updated_at": (r["last_asked"] or r["updated_at"]).isoformat()
                              if (r["last_asked"] or r["updated_at"]) else None,
            }
            for r in rows
        ]
    }


@router.delete("/threads/{thread_id}")
async def delete_thread(
    thread_id: str,
    request: Request,
    role: str = Depends(require_auth),
    _perm: str = Depends(require_permission("module.studio.ask")),
):
    """
    Delete a conversation and its turns.

    Transcripts quote the contents of private documents, so history a user
    cannot clear is a liability rather than a feature. Turns go with the thread
    through ON DELETE CASCADE.
    """
    _require_email_auth(request)
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")

    scope = owner_scope_email(request)
    deleted = await pool.fetchval(
        """
        DELETE FROM studio_threads
         WHERE id = $1::uuid AND ($2::text IS NULL OR LOWER(owner_email) = LOWER($2))
        RETURNING id
        """,
        thread_id, scope,
    )
    if not deleted:
        raise HTTPException(404, "Conversation not found")
    return {"ok": True}


@router.get("/threads/{thread_id}")
async def get_thread(
    thread_id: str,
    request: Request,
    role: str = Depends(require_auth),
    _perm: str = Depends(require_permission("module.studio.view")),
):
    _require_email_auth(request)
    pool = get_pool()
    if not pool:
        raise HTTPException(503, "Database unavailable")

    scope = owner_scope_email(request)
    thread = await pool.fetchrow(
        """
        SELECT id, title FROM studio_threads
         WHERE id = $1::uuid AND ($2::text IS NULL OR LOWER(owner_email) = LOWER($2))
        """,
        thread_id, scope,
    )
    if not thread:
        raise HTTPException(404, "Conversation not found")

    rows = await pool.fetch(
        """
        SELECT question, answer, model, verdict, sources, latency_ms, created_at
          FROM studio_turns WHERE thread_id = $1::uuid ORDER BY created_at
        """,
        thread_id,
    )
    return {
        "id": str(thread["id"]),
        "title": thread["title"],
        "turns": [
            {
                "question": r["question"],
                "answer": r["answer"],
                "model": r["model"],
                "verdict": r["verdict"],
                "sources": r["sources"],
                "latency_ms": r["latency_ms"],
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            }
            for r in rows
        ],
    }


# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------

@router.get("/usage")
async def my_usage(
    request: Request,
    role: str = Depends(require_auth),
    _perm: str = Depends(require_permission("module.studio.view")),
):
    _require_email_auth(request)
    user_id = _user_id(request)
    return {
        "usage": await ai_usage.usage_for(user_id),
        "quota": await ai_usage.quota_state(user_id, getattr(request.state, 'auth_role', None)),
    }


@router.get("/usage/all")
async def all_usage(
    request: Request,
    hours: int = 24,
    role: str = Depends(require_auth),
    _perm: str = Depends(require_permission("module.admin.audit.view")),
):
    """Who is spending the AI budget. Gated on the existing audit permission."""
    _require_email_auth(request)
    return {"hours": hours, "users": await ai_usage.breakdown(hours=hours)}
