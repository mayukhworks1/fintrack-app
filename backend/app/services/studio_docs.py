"""
Document ingestion for Studio.

Turns an uploaded file into retrievable, citable chunks:

    upload → extract text (per page) → chunk → embed → studio_doc_chunks

Two decisions worth stating, because both are load-bearing:

1. Page numbers travel with every chunk. An answer that cannot say *where* it
   read something is not much better than a guess, and page-level provenance is
   the cheapest form of "where" a PDF can give us.

2. Ingestion state lives in the row, not in memory. The API runs on a Hugging
   Face Space that sleeps when idle, so a job holding progress in a local
   variable loses it. A document is 'pending' until its chunks are committed,
   which also means a half-finished ingest is visible rather than silent.
"""

from __future__ import annotations

import logging
import re
from typing import Iterable

from ..db.postgres import get_pool
from . import embeddings, storage

logger = logging.getLogger("fintrack.studio.docs")

# Roughly 900 tokens of English at ~4 chars per token. Large enough to keep a
# clause intact, small enough that several chunks fit in a free model's context
# alongside the question and the answer.
CHUNK_CHARS = 3600
CHUNK_OVERLAP = 400

MAX_UPLOAD_BYTES = 15 * 1024 * 1024
MAX_CHUNKS_PER_DOC = 400

SUPPORTED_MIME = {
    "application/pdf": "pdf",
    "text/plain": "text",
    "text/markdown": "text",
    "text/csv": "text",
    "application/json": "text",
}

SUPPORTED_EXT = {
    "pdf": "pdf",
    "txt": "text", "md": "text", "markdown": "text",
    "csv": "text", "json": "text", "log": "text",
}


def kind_for(filename: str, mime_type: str) -> str | None:
    """What extractor to use, or None if the file is not something we can read."""
    if mime_type in SUPPORTED_MIME:
        return SUPPORTED_MIME[mime_type]
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return SUPPORTED_EXT.get(ext)


# --- extraction ------------------------------------------------------------

_WS = re.compile(r"[ \t ]+")
_BLANKS = re.compile(r"\n{3,}")


def _tidy(text: str) -> str:
    """Collapse the whitespace PDF extraction leaves behind."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _WS.sub(" ", text)
    text = _BLANKS.sub("\n\n", text)
    return text.strip()


def extract_pages(data: bytes, kind: str) -> list[str]:
    """
    Return one string per page. A plain-text file is a single page — it has no
    pagination to report, and inventing one would make citations lie.
    """
    if kind == "pdf":
        from io import BytesIO
        from pypdf import PdfReader

        reader = PdfReader(BytesIO(data))
        return [_tidy(page.extract_text() or "") for page in reader.pages]

    # UTF-16 is tried only behind its BOM. Without that check it wins on almost
    # any even-length byte string — decoding "café terms" into CJK mojibake
    # rather than raising — and the file is silently ingested as nonsense.
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        try:
            return [_tidy(data.decode("utf-16"))]
        except UnicodeDecodeError:
            pass
    for encoding in ("utf-8-sig", "utf-8"):
        try:
            return [_tidy(data.decode(encoding))]
        except UnicodeDecodeError:
            continue
    # latin-1 maps every byte to a character, so it cannot fail — a last resort
    # that keeps the words readable even when the encoding was never declared.
    return [_tidy(data.decode("latin-1"))]


# --- chunking --------------------------------------------------------------

def chunk_pages(pages: Iterable[str]) -> list[dict]:
    """
    Split pages into overlapping chunks, preferring to break at a paragraph and
    then at a sentence. A chunk cut mid-sentence retrieves badly and reads worse
    when quoted back, so the break point is worth the extra work.

    The overlap means a passage spanning a boundary still appears whole in one
    of the two chunks.
    """
    out: list[dict] = []
    for page_no, text in enumerate(pages, start=1):
        if not text.strip():
            continue
        start = 0
        while start < len(text):
            end = min(start + CHUNK_CHARS, len(text))
            if end < len(text):
                window = text[start:end]
                # Prefer a paragraph break in the last third of the window.
                cut = window.rfind("\n\n", int(CHUNK_CHARS * 0.6))
                if cut == -1:
                    cut = window.rfind(". ", int(CHUNK_CHARS * 0.6))
                    if cut != -1:
                        cut += 1
                if cut != -1:
                    end = start + cut
            body = text[start:end].strip()
            if body:
                out.append({
                    "page_number": page_no,
                    "content": body,
                    "token_est": max(1, len(body) // 4),
                })
            if end >= len(text):
                break
            start = max(end - CHUNK_OVERLAP, start + 1)
    return out[:MAX_CHUNKS_PER_DOC]


# --- ingestion -------------------------------------------------------------

async def _has_column(pool, table: str, column: str) -> bool:
    """
    Optional columns are created behind exception guards, so they may not exist.
    Checking beforehand is not optional politeness: asyncpg aborts a transaction
    on its first failed statement, so discovering the absence mid-insert would
    poison every remaining row.
    """
    try:
        return bool(await pool.fetchval(
            """
            SELECT 1 FROM information_schema.columns
             WHERE table_name = $1 AND column_name = $2
            """,
            table, column,
        ))
    except Exception:
        return False


async def ingest_document(document_id: str) -> None:
    """
    Read the stored file, chunk it, embed each chunk, and mark the row ready.

    Runs detached from the request. Every failure path writes the reason onto
    the document row — an ingest that dies quietly leaves an author staring at a
    document that never becomes searchable and no way to find out why.
    """
    pool = get_pool()
    if not pool:
        return

    row = await pool.fetchrow(
        "SELECT id, filename, storage_path, mime_type FROM studio_documents WHERE id = $1::uuid",
        document_id,
    )
    if not row:
        return

    async def fail(reason: str) -> None:
        await pool.execute(
            "UPDATE studio_documents SET status = 'failed', error = $2 WHERE id = $1::uuid",
            document_id, reason[:500],
        )
        logger.warning("studio ingest failed (%s): %s", document_id, reason)

    try:
        data = await storage.read_bytes(row["storage_path"])
        if not data:
            return await fail("The uploaded file could not be read back from storage.")

        kind = kind_for(row["filename"] or "", row["mime_type"] or "")
        if not kind:
            return await fail("This file type cannot be read as text.")

        pages = extract_pages(data, kind)
        chunks = chunk_pages(pages)
        if not chunks:
            return await fail(
                "No text could be extracted. A scanned PDF needs OCR before it can be searched."
            )

        # Embeddings are best-effort per chunk: the embedding API can fail or
        # rate-limit partway through, and a chunk with no vector is still found
        # by full-text search — so partial success beats failure.
        #
        # They are stored as a plain float array, which needs no extension. That
        # is what lets semantic re-ranking work on a Postgres without pgvector;
        # the vector column is written too when the extension happens to exist.
        raw_vectors: list[list[float] | None] = []
        for chunk in chunks:
            raw_vectors.append(await embeddings.get_embedding(chunk["content"]))

        has_pgvector = await embeddings.is_pgvector_available()

        # Checked before the transaction opens, not caught inside it: asyncpg
        # aborts a transaction on the first failed statement, so a try/except
        # around the INSERT would poison every row after it.
        has_vec_column = await _has_column(pool, "studio_doc_chunks", "embedding_vec")

        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    "DELETE FROM studio_doc_chunks WHERE document_id = $1::uuid", document_id
                )
                for index, (chunk, vec) in enumerate(zip(chunks, raw_vectors)):
                    if has_vec_column:
                        row_id = await conn.fetchval(
                            """
                            INSERT INTO studio_doc_chunks
                                (document_id, chunk_index, page_number, content, token_est, embedding_vec)
                            VALUES ($1::uuid, $2, $3, $4, $5, $6::float8[])
                            RETURNING id
                            """,
                            document_id, index, chunk["page_number"],
                            chunk["content"], chunk["token_est"], vec,
                        )
                    else:
                        row_id = await conn.fetchval(
                            """
                            INSERT INTO studio_doc_chunks
                                (document_id, chunk_index, page_number, content, token_est)
                            VALUES ($1::uuid, $2, $3, $4, $5)
                            RETURNING id
                            """,
                            document_id, index, chunk["page_number"],
                            chunk["content"], chunk["token_est"],
                        )
                    if vec and has_pgvector:
                        try:
                            await conn.execute(
                                "UPDATE studio_doc_chunks SET embedding = $2::vector WHERE id = $1",
                                row_id, embeddings._vec_literal(vec),
                            )
                        except Exception:
                            # The float array is already stored and is what
                            # retrieval actually uses, so a pgvector write that
                            # fails costs nothing worth aborting the ingest for.
                            pass
                await conn.execute(
                    """
                    UPDATE studio_documents
                       SET status = 'ready', error = NULL, page_count = $2,
                           chunk_count = $3, ingested_at = NOW()
                     WHERE id = $1::uuid
                    """,
                    document_id, len(pages), len(chunks),
                )

        embedded = sum(1 for v in raw_vectors if v is not None)
        logger.info(
            "studio ingest ready (%s): %d pages, %d chunks, %d embedded",
            document_id, len(pages), len(chunks), embedded,
        )
    except Exception as exc:
        await fail(f"{type(exc).__name__}: {exc}")
