"""
Vector embedding service — pgvector + OpenRouter embeddings.

Architecture
────────────
1. Records (invoices, projects) are embedded in the background after each
   Teable sync using OpenRouter's text-embedding-3-small model.
2. Embeddings are stored in the record_embeddings table (vector column).
3. ai_retrieval.py runs hybrid search: lexical (always) + vector (when
   pgvector is available and the query embedding succeeds).

Graceful degradation
────────────────────
If pgvector is not installed in the Aiven PG instance, or if the OpenRouter
embedding API fails, the system falls back cleanly to lexical-only search.
Set PGVECTOR_ENABLED=false in env to skip all vector ops.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

import httpx

from ..config import settings
from ..db.postgres import get_pool

logger = logging.getLogger("fintrack.embeddings")

EMBED_MODEL   = "openai/text-embedding-3-small"
EMBED_DIM     = 1536
EMBED_API_URL = "https://openrouter.ai/api/v1/embeddings"
BATCH_DELAY   = 0.25   # seconds between embedding API calls (rate limit courtesy)

# Module-level cache so we don't re-check the DB on every request
_pgvector_ok: Optional[bool] = None


async def is_pgvector_available() -> bool:
    global _pgvector_ok
    if _pgvector_ok is not None:
        return _pgvector_ok
    pool = get_pool()
    if not pool:
        _pgvector_ok = False
        return False
    try:
        await pool.fetchval("SELECT '[1,2,3]'::vector(3) IS NOT NULL")
        _pgvector_ok = True
    except Exception:
        _pgvector_ok = False
        logger.info("pgvector not available — using lexical search only")
    return _pgvector_ok


async def get_embedding(text: str) -> Optional[list[float]]:
    """Call OpenRouter embeddings API; returns float list or None on failure."""
    if not settings.openrouter_api_key:
        return None
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                EMBED_API_URL,
                headers={"Authorization": f"Bearer {settings.openrouter_api_key}"},
                json={"model": EMBED_MODEL, "input": text[:8000]},
            )
            r.raise_for_status()
            return r.json()["data"][0]["embedding"]
    except Exception as exc:
        logger.debug("Embedding API failed: %s", exc)
        return None


def _vec_literal(v: list[float]) -> str:
    """Convert a float list to the '[1.0,2.0,...]' string pgvector expects."""
    return "[" + ",".join(f"{x:.8f}" for x in v) + "]"


async def upsert_embedding(record_id: str, table_name: str, content: str) -> bool:
    """Embed a single record and persist to record_embeddings. Returns success."""
    if not await is_pgvector_available():
        return False
    pool = get_pool()
    if not pool:
        return False

    vec = await get_embedding(content)
    if not vec:
        return False

    try:
        await pool.execute(
            """
            INSERT INTO record_embeddings (record_id, table_name, content, embedding)
            VALUES ($1, $2, $3, $4::vector)
            ON CONFLICT (record_id, table_name) DO UPDATE
            SET content = EXCLUDED.content,
                embedding = EXCLUDED.embedding,
                updated_at = NOW()
            """,
            record_id, table_name, content, _vec_literal(vec),
        )
        return True
    except Exception as exc:
        logger.warning("upsert_embedding failed (%s/%s): %s", table_name, record_id, exc)
        return False


async def search_similar(
    query: str,
    table_name: str,
    limit: int = 8,
    min_similarity: float = 0.4,
) -> list[dict]:
    """
    Vector similarity search over record_embeddings.
    Returns list of {record_id, content, similarity} sorted by similarity desc.
    Falls back to [] if pgvector unavailable or embedding fails.
    """
    if not await is_pgvector_available():
        return []
    pool = get_pool()
    if not pool:
        return []

    vec = await get_embedding(query)
    if not vec:
        return []

    try:
        rows = await pool.fetch(
            """
            SELECT
                record_id,
                table_name,
                content,
                1 - (embedding <=> $1::vector) AS similarity
            FROM record_embeddings
            WHERE table_name = $2
              AND embedding IS NOT NULL
              AND 1 - (embedding <=> $1::vector) >= $3
            ORDER BY embedding <=> $1::vector
            LIMIT $4
            """,
            _vec_literal(vec), table_name, min_similarity, limit,
        )
        return [dict(r) for r in rows]
    except Exception as exc:
        logger.warning("Vector search failed: %s", exc)
        return []


async def build_financial_text(record: dict, record_type: str) -> str:
    """Serialize an invoice or project record into embeddable text."""
    parts: list[str] = []
    if record_type == "invoice":
        f = record.get("fields", record)
        parts = [
            f"Invoice {f.get('Invoice Number', '')}",
            f"Client: {f.get('Client Name', f.get('Client', ''))}",
            f"Project: {f.get('Project', '')}",
            f"Amount: {f.get('Amount Raised', '')}",
            f"Status: {f.get('Payment Status', '')}",
            f"Category: {f.get('Category', '')}",
            f"Milestone: {f.get('Milestone', '')}",
            f"Description: {f.get('Description', '')}",
            f"Raised By: {f.get('Raised By', '')}",
        ]
    elif record_type == "project":
        parts = [
            f"Project: {record.get('project_name', '')}",
            f"Client: {record.get('client', '')}",
            f"Status: {record.get('status', '')}",
            f"Billed: {record.get('amount_billed', '')}",
            f"Profit: {record.get('actual_profit', '')}",
        ]
    return " | ".join(p for p in parts if p.split(": ", 1)[-1].strip())


async def embed_all_records_bg() -> None:
    """
    Background task: embed any records in the PG mirrors that haven't been
    embedded yet. Runs once at startup and can be called after a full sync.
    """
    if not await is_pgvector_available():
        return
    if not settings.openrouter_api_key:
        return

    pool = get_pool()
    if not pool:
        return

    # Invoices not yet embedded
    try:
        rows = await pool.fetch(
            """
            SELECT teable_id, fields
            FROM invoices_mirror i
            WHERE deleted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM record_embeddings r
                WHERE r.record_id = i.teable_id AND r.table_name = 'invoices'
              )
            LIMIT 200
            """
        )
        for row in rows:
            fields = row["fields"] or {}
            content = await build_financial_text({"fields": fields}, "invoice")
            await upsert_embedding(row["teable_id"], "invoices", content)
            await asyncio.sleep(BATCH_DELAY)
        if rows:
            logger.info("Embedded %d invoice records", len(rows))
    except Exception as exc:
        logger.warning("embed_all_records_bg invoices error: %s", exc)

    # Projects not yet embedded
    try:
        rows = await pool.fetch(
            """
            SELECT teable_id, project_name, client, status, amount_billed, actual_profit
            FROM projects_mirror p
            WHERE deleted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM record_embeddings r
                WHERE r.record_id = p.teable_id AND r.table_name = 'projects'
              )
            LIMIT 200
            """
        )
        for row in rows:
            content = await build_financial_text(dict(row), "project")
            await upsert_embedding(row["teable_id"], "projects", content)
            await asyncio.sleep(BATCH_DELAY)
        if rows:
            logger.info("Embedded %d project records", len(rows))
    except Exception as exc:
        logger.warning("embed_all_records_bg projects error: %s", exc)
