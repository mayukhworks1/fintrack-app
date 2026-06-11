"""
Hybrid retrieval for the AI assistant.

Strategy (in order):
  1. Lexical search — always runs, ~1 ms, no external dep
  2. Vector search — runs when pgvector is available and OpenRouter key is set
                     adds semantically related records that keyword search misses
  3. Merge + dedupe — lexical and vector results merged by record_id
  4. Context block built from merged results, tagged with retrieval method
"""
from __future__ import annotations

import asyncio
import re
from typing import Any


_STOPWORDS = {
    "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with", "show",
    "make", "please", "give", "from", "into", "this", "that", "these", "those",
    "what", "which", "who", "how", "why", "when", "where", "about", "all", "any",
    "dashboard", "report", "summary", "proper", "visual", "chart", "graph",
}


def _extract_terms(query: str, history: list[dict] | None = None, limit: int = 10) -> list[str]:
    text = (query or "").lower()
    if history:
        recent = " ".join(str(item.get("content") or "") for item in history[-4:])
        text = f"{recent.lower()} {text}"
    words = re.findall(r"[a-z0-9][a-z0-9+.-]{1,}", text)
    seen: set[str] = set()
    terms: list[str] = []
    for word in words:
        if word in _STOPWORDS or len(word) < 3:
            continue
        if word not in seen:
            seen.add(word)
            terms.append(word)
        if len(terms) >= limit:
            break
    return terms


async def _lexical_search(pool, terms: list[str]) -> tuple[list, list, list]:
    """Keyword-match projects, invoices, and status records. Returns (projects, invoices, statuses)."""
    patterns = [f"%{t}%" for t in terms]

    project_rows, invoice_rows, status_rows = await asyncio.gather(
        pool.fetch(
            """
            SELECT teable_id, client, project_name, status,
                   amount_billed, actual_profit, modified_time
            FROM projects_mirror
            WHERE deleted_at IS NULL AND (
                lower(COALESCE(client, '')) LIKE ANY($1::text[])
                OR lower(COALESCE(project_name, '')) LIKE ANY($1::text[])
                OR lower(COALESCE(status, '')) LIKE ANY($1::text[])
                OR lower(fields::text) LIKE ANY($1::text[])
            )
            ORDER BY modified_time DESC NULLS LAST LIMIT 8
            """,
            patterns,
        ),
        pool.fetch(
            """
            SELECT teable_id, invoice_number, project, category,
                   payment_status, amount_raised, amount_with_tax,
                   amount_received, raised_date
            FROM invoices_mirror
            WHERE deleted_at IS NULL AND (
                lower(COALESCE(invoice_number, '')) LIKE ANY($1::text[])
                OR lower(COALESCE(project, '')) LIKE ANY($1::text[])
                OR lower(COALESCE(category, '')) LIKE ANY($1::text[])
                OR lower(COALESCE(payment_status, '')) LIKE ANY($1::text[])
                OR lower(fields::text) LIKE ANY($1::text[])
            )
            ORDER BY raised_date DESC NULLS LAST LIMIT 8
            """,
            patterns,
        ),
        pool.fetch(
            """
            SELECT teable_id, client, project, status,
                   short_status, detail_status, modified_time
            FROM status_mirror
            WHERE deleted_at IS NULL AND (
                lower(COALESCE(client, '')) LIKE ANY($1::text[])
                OR lower(COALESCE(project, '')) LIKE ANY($1::text[])
                OR lower(COALESCE(status, '')) LIKE ANY($1::text[])
                OR lower(COALESCE(short_status, '')) LIKE ANY($1::text[])
                OR lower(COALESCE(detail_status, '')) LIKE ANY($1::text[])
                OR lower(fields::text) LIKE ANY($1::text[])
            )
            ORDER BY modified_time DESC NULLS LAST LIMIT 8
            """,
            patterns,
        ),
    )
    return list(project_rows), list(invoice_rows), list(status_rows)


async def _vector_search(pool, query: str) -> tuple[list, list]:
    """
    Semantic similarity search using pgvector. Returns (extra_projects, extra_invoices).
    Falls back to ([], []) silently if pgvector unavailable or embedding fails.
    """
    try:
        from .embeddings import search_similar, is_pgvector_available
        if not await is_pgvector_available():
            return [], []

        proj_hits, inv_hits = await asyncio.gather(
            search_similar(query, "projects", limit=6),
            search_similar(query, "invoices",  limit=6),
        )

        # Fetch full rows for vector-matched record IDs from PG mirrors
        extra_projects: list = []
        if proj_hits:
            ids = [h["record_id"] for h in proj_hits]
            rows = await pool.fetch(
                """
                SELECT teable_id, client, project_name, status,
                       amount_billed, actual_profit, modified_time
                FROM projects_mirror
                WHERE teable_id = ANY($1) AND deleted_at IS NULL
                """,
                ids,
            )
            extra_projects = list(rows)

        extra_invoices: list = []
        if inv_hits:
            ids = [h["record_id"] for h in inv_hits]
            rows = await pool.fetch(
                """
                SELECT teable_id, invoice_number, project, category,
                       payment_status, amount_raised, amount_with_tax,
                       amount_received, raised_date
                FROM invoices_mirror
                WHERE teable_id = ANY($1) AND deleted_at IS NULL
                """,
                ids,
            )
            extra_invoices = list(rows)

        return extra_projects, extra_invoices

    except Exception:
        return [], []


def _merge_dedup(primary: list, extra: list, id_field: str = "teable_id", limit: int = 10) -> tuple[list, int]:
    """Merge two row lists, deduplicating by id_field. Returns (merged, extra_added_count)."""
    seen = {row[id_field] for row in primary}
    added = 0
    merged = list(primary)
    for row in extra:
        if row[id_field] not in seen:
            seen.add(row[id_field])
            merged.append(row)
            added += 1
    return merged[:limit], added


async def build_retrieval_pack(pool, query: str, history: list[dict] | None = None) -> dict[str, Any]:
    """
    Hybrid retrieval: lexical search + optional vector similarity.

    Returns dict with:
      terms, sources, summary, context_block, retrieval_method
    """
    if not pool:
        return {"terms": [], "sources": {}, "context_block": "", "summary": {}, "retrieval_method": "none"}

    terms = _extract_terms(query, history)

    # Run lexical and vector searches concurrently
    lexical_task = _lexical_search(pool, terms) if terms else asyncio.coroutine(lambda: ([], [], []))()
    vector_task  = _vector_search(pool, query)

    (lex_proj, lex_inv, lex_status), (vec_proj, vec_inv) = await asyncio.gather(
        _lexical_search(pool, terms) if terms else asyncio.sleep(0, result=([], [], [])),
        _vector_search(pool, query),
    )

    proj_merged, proj_vec_added = _merge_dedup(lex_proj, vec_proj, "teable_id", limit=10)
    inv_merged,  inv_vec_added  = _merge_dedup(lex_inv,  vec_inv,  "teable_id", limit=10)

    # Determine what retrieval method was used
    any_vector = (proj_vec_added + inv_vec_added) > 0
    has_lexical = bool(lex_proj or lex_inv or lex_status)
    if any_vector and has_lexical:
        retrieval_method = "hybrid"
    elif any_vector:
        retrieval_method = "vector"
    elif has_lexical:
        retrieval_method = "lexical"
    else:
        retrieval_method = "none"

    sync_row = await pool.fetchrow(
        "SELECT source, synced_at, error FROM sync_log ORDER BY synced_at DESC NULLS LAST LIMIT 1"
    )

    lines: list[str] = []
    if proj_merged:
        lines.append("=== RETRIEVED PROJECT EVIDENCE ===")
        for row in proj_merged:
            lines.append(
                f"- {row['client'] or 'Unknown'} / {row['project_name'] or 'Unknown'} | "
                f"Status: {row['status'] or '—'} | "
                f"Billed: ₹{float(row['amount_billed'] or 0):,.0f} | "
                f"Profit: ₹{float(row['actual_profit'] or 0):,.0f}"
            )

    if inv_merged:
        lines.append("")
        lines.append("=== RETRIEVED INVOICE EVIDENCE ===")
        for row in inv_merged:
            lines.append(
                f"- {row['invoice_number'] or '—'} | {row['project'] or 'Unknown'} | "
                f"{row['payment_status'] or '—'} | "
                f"Raised: ₹{float(row['amount_raised'] or 0):,.0f} | "
                f"Received: ₹{float(row['amount_received'] or 0):,.0f}"
            )

    if lex_status:
        lines.append("")
        lines.append("=== RETRIEVED STATUS EVIDENCE ===")
        for row in lex_status:
            headline = row["short_status"] or row["detail_status"] or "—"
            lines.append(
                f"- {row['client'] or 'Unknown'} / {row['project'] or 'Unknown'} "
                f"[{row['status'] or 'Not started'}]: {headline}"
            )

    if sync_row:
        lines.append("")
        lines.append("=== MIRROR FRESHNESS ===")
        lines.append(
            f"- Last sync: {sync_row['source'] or 'unknown'} | "
            f"At: {sync_row['synced_at']} | "
            f"Error: {sync_row['error'] or 'none'}"
        )

    return {
        "terms":            terms,
        "retrieval_method": retrieval_method,
        "sources": {
            "projects": [dict(r) for r in proj_merged],
            "invoices": [dict(r) for r in inv_merged],
            "statuses": [dict(r) for r in lex_status],
        },
        "summary": {
            "projects":         len(proj_merged),
            "invoices":         len(inv_merged),
            "statuses":         len(lex_status),
            "terms":            terms,
            "vector_augmented": any_vector,
        },
        "context_block": "\n".join(lines).strip(),
    }
