from __future__ import annotations

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


async def build_retrieval_pack(pool, query: str, history: list[dict] | None = None) -> dict[str, Any]:
    """
    Lightweight hybrid retrieval over mirrored portfolio data.

    This is intentionally lexical / structured first:
    - safe
    - explainable
    - deterministic
    - no external embedding dependency
    """
    if not pool:
        return {"terms": [], "sources": {}, "context_block": "", "summary": {}}

    terms = _extract_terms(query, history)
    if not terms:
        return {"terms": [], "sources": {}, "context_block": "", "summary": {}}

    patterns = [f"%{term}%" for term in terms]

    project_rows = await pool.fetch(
        """
        SELECT
            teable_id,
            client,
            project_name,
            status,
            amount_billed,
            actual_profit,
            modified_time
        FROM projects_mirror
        WHERE deleted_at IS NULL
          AND (
            lower(COALESCE(client, '')) LIKE ANY($1::text[])
            OR lower(COALESCE(project_name, '')) LIKE ANY($1::text[])
            OR lower(COALESCE(status, '')) LIKE ANY($1::text[])
            OR lower(fields::text) LIKE ANY($1::text[])
          )
        ORDER BY modified_time DESC NULLS LAST
        LIMIT 6
        """,
        patterns,
    )

    invoice_rows = await pool.fetch(
        """
        SELECT
            teable_id,
            invoice_number,
            project,
            category,
            payment_status,
            amount_raised,
            amount_with_tax,
            amount_received,
            raised_date
        FROM invoices_mirror
        WHERE deleted_at IS NULL
          AND (
            lower(COALESCE(invoice_number, '')) LIKE ANY($1::text[])
            OR lower(COALESCE(project, '')) LIKE ANY($1::text[])
            OR lower(COALESCE(category, '')) LIKE ANY($1::text[])
            OR lower(COALESCE(payment_status, '')) LIKE ANY($1::text[])
            OR lower(fields::text) LIKE ANY($1::text[])
          )
        ORDER BY raised_date DESC NULLS LAST
        LIMIT 6
        """,
        patterns,
    )

    status_rows = await pool.fetch(
        """
        SELECT
            teable_id,
            client,
            project,
            status,
            short_status,
            detail_status,
            modified_time
        FROM status_mirror
        WHERE deleted_at IS NULL
          AND (
            lower(COALESCE(client, '')) LIKE ANY($1::text[])
            OR lower(COALESCE(project, '')) LIKE ANY($1::text[])
            OR lower(COALESCE(status, '')) LIKE ANY($1::text[])
            OR lower(COALESCE(short_status, '')) LIKE ANY($1::text[])
            OR lower(COALESCE(detail_status, '')) LIKE ANY($1::text[])
            OR lower(fields::text) LIKE ANY($1::text[])
          )
        ORDER BY modified_time DESC NULLS LAST
        LIMIT 8
        """,
        patterns,
    )

    sync_row = await pool.fetchrow(
        """
        SELECT source, synced_at, error
        FROM sync_log
        ORDER BY synced_at DESC NULLS LAST
        LIMIT 1
        """
    )

    lines: list[str] = []
    if project_rows:
        lines.append("=== RETRIEVED PROJECT EVIDENCE ===")
        for row in project_rows:
            lines.append(
                f"- {row['client'] or 'Unknown'} / {row['project_name'] or 'Unknown'} | "
                f"Status: {row['status'] or '—'} | "
                f"Billed: ₹{float(row['amount_billed'] or 0):,.0f} | "
                f"Profit: ₹{float(row['actual_profit'] or 0):,.0f}"
            )

    if invoice_rows:
        lines.append("")
        lines.append("=== RETRIEVED INVOICE EVIDENCE ===")
        for row in invoice_rows:
            lines.append(
                f"- {row['invoice_number'] or '—'} | {row['project'] or 'Unknown'} | "
                f"{row['payment_status'] or '—'} | "
                f"Raised: ₹{float(row['amount_raised'] or 0):,.0f} | "
                f"Received: ₹{float(row['amount_received'] or 0):,.0f}"
            )

    if status_rows:
        lines.append("")
        lines.append("=== RETRIEVED STATUS EVIDENCE ===")
        for row in status_rows:
            headline = row["short_status"] or row["detail_status"] or "—"
            lines.append(
                f"- {row['client'] or 'Unknown'} / {row['project'] or 'Unknown'} "
                f"[{row['status'] or 'Not started'}]: {headline}"
            )

    if sync_row:
        lines.append("")
        lines.append("=== MIRROR FRESHNESS ===")
        lines.append(
            f"- Last sync source: {sync_row['source'] or 'unknown'} | "
            f"At: {sync_row['synced_at']} | "
            f"Error: {sync_row['error'] or 'none'}"
        )

    return {
        "terms": terms,
        "sources": {
            "projects": [dict(row) for row in project_rows],
            "invoices": [dict(row) for row in invoice_rows],
            "statuses": [dict(row) for row in status_rows],
        },
        "summary": {
            "projects": len(project_rows),
            "invoices": len(invoice_rows),
            "statuses": len(status_rows),
            "terms": terms,
        },
        "context_block": "\n".join(lines).strip(),
    }
