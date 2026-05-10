"""
AI endpoints — chat, autofill, analyze, report.

Optimization architecture
─────────────────────────
  Context building (chat)
    OLD: 4 live Teable API calls on every chat request (~500–2000 ms)
    NEW: Read from PostgreSQL mirror + Valkey cache (~1–10 ms)

    Cache key : "chat:context"   TTL: 300 s (5 min)
    Bust on   : every successful Teable → PG sync (sync.py)

  Chat history
    Client can pass session_id to continue a server-side conversation.
    Backend loads the last N messages from chat_messages instead of
    relying on the client to send the full history payload each turn.
    Falls back to client-provided history if session_id has no PG rows.
"""
import asyncio
import json
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from ..services.teable import TeableService
from ..services.invoice import InvoiceService
from ..services.openrouter import (
    chat_with_ai, autofill_project, analyze_project, generate_report,
    _format_records_context,
)
from ..models import ChatRequest, AutofillRequest, AnalyzeRequest
from .deps import require_auth
from ..db.postgres import get_pool

router = APIRouter(prefix="/api/ai", tags=["ai"])

# ── Context cache ─────────────────────────────────────────────────────────────
_CONTEXT_CACHE_KEY = "chat:context"
_CONTEXT_TTL       = 300   # 5 minutes; busted on sync


def _fmt_invoice_context(summary: dict, records: list[dict]) -> str:
    """Build concise invoice context string for the AI."""
    lines = [
        "=== INVOICE TRACKING SUMMARY ===",
        f"Total Invoices: {summary['total_invoices']}",
        f"Total Raised (pre-tax): ₹{summary['total_raised']:,.0f}",
        f"Total with GST: ₹{summary['total_with_tax']:,.0f}",
        f"Total Received: ₹{summary['total_received']:,.0f}",
        f"Outstanding: ₹{summary['total_outstanding']:,.0f}",
        f"Collection Rate: {summary['collection_rate']:.1f}%",
        f"By Status: {summary['by_status']}",
        "",
        "=== LIVE INVOICE RECORDS ===",
    ]
    for r in records[:50]:
        f = r.get("fields", {})
        lines.append(
            f"[{f.get('Invoice Number','?')}] {f.get('Project','?')} | "
            f"{f.get('Category','?')} | {f.get('Payment Status','?')} | "
            f"Raised: ₹{float(f.get('Amount Raised') or 0):,.0f} | "
            f"Tax: ₹{float(f.get('Amount with Tax') or 0):,.0f} | "
            f"Received: ₹{float(f.get('Amount Received') or 0):,.0f} | "
            f"Outstanding: ₹{float(f.get('Outstanding Amount') or 0):,.0f} | "
            f"Raised: {f.get('Raised Date','?')} | "
            f"Aging: {f.get('Agening (Days)','0')} days"
        )
    return "\n".join(lines)


def _get_client_ip(request: Request) -> str:
    for header in ("x-forwarded-for", "x-real-ip", "cf-connecting-ip"):
        val = request.headers.get(header, "")
        if val:
            return val.split(",")[0].strip()
    return request.client.host if request.client else ""


# ── Context builder — PG mirror + Valkey cache ────────────────────────────────

async def _build_context_pg(pool) -> str:
    """
    Build the AI system context from PostgreSQL mirror tables.

    Performance:
      Cache hit (Valkey) : ~1 ms    ← most requests land here
      Cache miss (PG)    : ~10 ms   ← one query, then cached for 5 min
      Old path (Teable)  : 500–2000 ms per request  ← eliminated

    asyncpg automatically deserialises JSONB columns to Python dicts —
    no json.loads needed on the fields column.
    """
    from ..db import valkey as vk

    # ── 1. Try Valkey cache ──────────────────────────────────────────────
    cached = await vk.cache_get(_CONTEXT_CACHE_KEY)
    if cached and isinstance(cached, str):
        return cached

    # ── 2. Build from PG mirrors ─────────────────────────────────────────
    proj_rows, inv_rows = await asyncio.gather(
        pool.fetch("SELECT fields FROM projects_mirror ORDER BY synced_at DESC LIMIT 300"),
        pool.fetch("SELECT fields FROM invoices_mirror  ORDER BY raised_date DESC NULLS LAST LIMIT 100"),
    )

    # asyncpg returns JSONB as dict directly
    proj_fields = [dict(r["fields"]) for r in proj_rows]
    inv_fields  = [dict(r["fields"]) for r in inv_rows]

    # ── 3. Compute project summary ───────────────────────────────────────
    def _safe_float(v):
        try: return float(v) if v not in (None, "") else 0.0
        except (TypeError, ValueError): return 0.0

    total_billed  = sum(_safe_float(f.get("Amount Billed So far")) for f in proj_fields)
    total_profit  = sum(_safe_float(f.get("Actual Profit"))         for f in proj_fields)
    avg_profit    = (sum(_safe_float(f.get("Profit percentage")) for f in proj_fields)
                     / len(proj_fields)) if proj_fields else 0.0
    by_status: dict = {}
    by_client: dict = {}
    by_health: dict = {}
    for f in proj_fields:
        s = f.get("Project Status", "Unknown"); by_status[s] = by_status.get(s, 0) + 1
        c = f.get("Client", "Unknown");         by_client[c] = by_client.get(c, 0) + 1
        h = f.get("Health", "Unknown");         by_health[h] = by_health.get(h, 0) + 1

    project_text = (
        "=== PORTFOLIO SUMMARY ===\n"
        f"Total Projects: {len(proj_fields)}\n"
        f"Total Billed: ₹{total_billed:,.0f}\n"
        f"Total Profit: ₹{total_profit:,.0f}\n"
        f"Avg Profit %: {avg_profit:.2f}%\n"
        f"By Status: {by_status}\n"
        f"By Client: {by_client}\n"
        f"By Health: {by_health}\n"
    )
    records_text = _format_records_context([{"fields": f} for f in proj_fields])

    # ── 4. Compute invoice summary ───────────────────────────────────────
    total_raised   = sum(_safe_float(f.get("Amount Raised"))    for f in inv_fields)
    total_with_tax = sum(_safe_float(f.get("Amount with Tax"))  for f in inv_fields)
    total_received = sum(_safe_float(f.get("Amount Received"))  for f in inv_fields)
    outstanding    = total_with_tax - total_received
    coll_rate      = (total_received / total_with_tax * 100) if total_with_tax > 0 else 0.0
    inv_by_status: dict = {}
    for f in inv_fields:
        s = f.get("Payment Status", "Unknown")
        inv_by_status[s] = inv_by_status.get(s, 0) + 1

    inv_summary = {
        "total_invoices":    len(inv_fields),
        "total_raised":      total_raised,
        "total_with_tax":    total_with_tax,
        "total_received":    total_received,
        "total_outstanding": outstanding,
        "collection_rate":   coll_rate,
        "by_status":         inv_by_status,
    }
    invoice_text = _fmt_invoice_context(inv_summary, [{"fields": f} for f in inv_fields])

    context = project_text + "\n" + records_text + "\n\n" + invoice_text

    # ── 5. Cache for 5 min ───────────────────────────────────────────────
    await vk.cache_set(_CONTEXT_CACHE_KEY, context, _CONTEXT_TTL)
    return context


async def _build_context_teable() -> str:
    """
    Fallback context builder using live Teable API — used when PG is not available.
    Slower but always works.
    """
    teable  = TeableService()
    inv_svc = InvoiceService()

    (summary, all_records), (inv_summary, inv_records) = await asyncio.gather(
        asyncio.gather(teable.get_summary(), teable.get_all_records()),
        asyncio.gather(inv_svc.get_summary(), inv_svc.get_all_invoices()),
    )

    project_text = (
        "=== PORTFOLIO SUMMARY ===\n"
        f"Total Projects: {summary['total_projects']}\n"
        f"Total Billed: ₹{summary['total_billed']:,.0f}\n"
        f"Total Profit: ₹{summary['total_profit']:,.0f}\n"
        f"Avg Profit %: {summary['avg_profit_pct']:.2f}%\n"
        f"By Status: {summary['by_status']}\n"
        f"By Client: {summary['by_client']}\n"
        f"By Health: {summary['by_health']}\n"
        f"Targets Achieved: {summary.get('target_achieved_count', 0)}/{summary['total_projects']}\n"
    )
    records_text = _format_records_context(all_records)
    invoice_text = _fmt_invoice_context(inv_summary, inv_records)
    return project_text + "\n" + records_text + "\n\n" + invoice_text


# ── Chat session persistence helpers ─────────────────────────────────────────

async def _ensure_session(pool, session_id: Optional[str], role: str, request: Request) -> str:
    """Return existing session UUID or create a new one."""
    if not pool:
        return session_id or ""

    from ..db.audit import parse_ua
    from ..db.geo import lookup as geo_lookup

    ip = _get_client_ip(request)
    ua = request.headers.get("user-agent", "")
    os_str, browser, _ = parse_ua(ua)

    if session_id:
        existing = await pool.fetchval(
            "SELECT id FROM chat_sessions WHERE id = $1", session_id,
        )
        if existing:
            await pool.execute(
                "UPDATE chat_sessions SET last_at = NOW() WHERE id = $1", session_id,
            )
            return session_id

    geo   = await geo_lookup(ip)
    new_id = await pool.fetchval(
        """
        INSERT INTO chat_sessions (role, ip, country, city, os, browser)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
        """,
        role,
        ip[:45]  if ip else None,
        geo.get("country", "")[:80]  or None,
        geo.get("city",    "")[:100] or None,
        os_str[:100],
        browser[:100],
    )
    return str(new_id)


async def _load_session_history(pool, session_id: str, limit: int = 12) -> list[dict]:
    """
    Load the last `limit` message-pairs from chat_messages for a session.
    Returns list of {"role": "user"|"assistant", "content": str} in
    chronological order, ready for the OpenRouter messages array.
    """
    try:
        rows = await pool.fetch(
            """
            SELECT role, content
            FROM chat_messages
            WHERE session_id = $1
            ORDER BY ts DESC
            LIMIT $2
            """,
            session_id,
            limit * 2,   # pairs of user + assistant
        )
        # Rows come back newest-first — reverse for chronological order
        return [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]
    except Exception:
        return []


async def _save_messages(
    pool,
    session_id: str,
    user_message: str,
    assistant_reply: str,
    model: str,
    tokens_used: Optional[int],
    duration_ms: int,
) -> None:
    """Persist user + assistant turns and update session msg_count."""
    if not pool or not session_id:
        return
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    "INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'user', $2)",
                    session_id, user_message,
                )
                await conn.execute(
                    """
                    INSERT INTO chat_messages
                        (session_id, role, content, model, tokens_used, duration_ms)
                    VALUES ($1, 'assistant', $2, $3, $4, $5)
                    """,
                    session_id, assistant_reply, model, tokens_used, duration_ms,
                )
                await conn.execute(
                    "UPDATE chat_sessions SET msg_count = msg_count + 2, last_at = NOW() WHERE id = $1",
                    session_id,
                )
    except Exception as exc:
        import logging
        logging.getLogger("fintrack.ai").debug("Failed to save chat messages: %s", exc)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/chat")
async def ai_chat(body: ChatRequest, request: Request, role: str = Depends(require_auth)):
    """
    Natural language chat about projects + invoices.

    Context source (priority order):
      1. Valkey cache  — sub-millisecond, valid for 5 min after last sync
      2. PG mirror     — ~10 ms, used when cache is cold/expired
      3. Live Teable   — ~1 s fallback when PG is unavailable

    Chat history source (priority order):
      1. Server-side   — last 12 messages from chat_messages (if session_id given)
      2. Client-sent   — body.history (backward-compat / no PG)
    """
    try:
        pool       = get_pool()
        session_id = body.session_id

        # ── Context: PG mirror + Valkey cache (fast) ──────────────────────
        if pool:
            context = await _build_context_pg(pool)
        else:
            context = await _build_context_teable()

        # ── Session management ────────────────────────────────────────────
        if pool:
            session_id = await _ensure_session(pool, session_id, role, request)

        # ── History: server-side (PG) preferred over client-sent ─────────
        history: list[dict] = []
        if pool and session_id:
            history = await _load_session_history(pool, session_id, limit=12)
        if not history:
            # Fallback: client-provided history (backward compat / no PG)
            history = [{"role": m.role, "content": m.content} for m in body.history]

        # ── AI call ───────────────────────────────────────────────────────
        t0 = time.time()
        result = await chat_with_ai(body.message, history, context)
        duration_ms = int((time.time() - t0) * 1000)

        # ── Persist turn (fire-and-forget) ────────────────────────────────
        if pool and session_id:
            asyncio.create_task(_save_messages(
                pool, session_id,
                body.message,
                result["content"],
                result.get("model", ""),
                result.get("tokens_used"),
                duration_ms,
            ))

        resp = {"reply": result["content"], "model": result["model_short"]}
        if session_id:
            resp["session_id"] = session_id
        return resp

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/autofill")
async def ai_autofill(body: AutofillRequest, _role: str = Depends(require_auth)):
    """Describe a project in plain text, AI extracts structured fields."""
    try:
        fields = await autofill_project(body.description)
        return {"fields": fields}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analyze")
async def ai_analyze(body: AnalyzeRequest, _role: str = Depends(require_auth)):
    """Deep AI analysis of a specific project."""
    try:
        teable = TeableService()
        record = await teable.get_record(body.record_id)
        result = await analyze_project(record.get("fields", {}))
        return {
            "analysis": result["content"],
            "model": result["model_short"],
            "record_id": body.record_id,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/report")
async def ai_report(_role: str = Depends(require_auth)):
    """Generate an executive report for the full portfolio."""
    try:
        teable = TeableService()
        summary, records = await teable.get_summary(), await teable.get_all_records()
        result = await generate_report(summary, records)
        return {"report": result["content"], "model": result["model_short"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
