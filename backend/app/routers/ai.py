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


def _format_invoice_context(summary: dict, records: list[dict]) -> str:
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
    for r in records[:50]:   # cap at 50 to keep context size sane
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


# ── Chat session persistence helpers ────────────────────────────────────────

async def _ensure_session(
    pool,
    session_id: Optional[str],
    role: str,
    request: Request,
) -> str:
    """
    Return an existing session UUID or create a new one.
    Updates last_at and msg_count on every call.
    """
    if not pool:
        return session_id or ""

    from ..db.audit import parse_ua
    from ..db.geo import lookup as geo_lookup

    ip = _get_client_ip(request)
    ua = request.headers.get("user-agent", "")
    os_str, browser, _ = parse_ua(ua)

    if session_id:
        # Touch the session (bump last_at; msg_count incremented separately)
        existing = await pool.fetchval(
            "SELECT id FROM chat_sessions WHERE id = $1",
            session_id,
        )
        if existing:
            await pool.execute(
                "UPDATE chat_sessions SET last_at = NOW() WHERE id = $1",
                session_id,
            )
            return session_id

    # Create new session
    geo = await geo_lookup(ip)
    new_id = await pool.fetchval(
        """
        INSERT INTO chat_sessions (role, ip, country, city, os, browser)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
        """,
        role,
        ip[:45] if ip else None,
        geo.get("country", "")[:80] or None,
        geo.get("city", "")[:100] or None,
        os_str[:100],
        browser[:100],
    )
    return str(new_id)


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
                    """
                    INSERT INTO chat_messages (session_id, role, content)
                    VALUES ($1, 'user', $2)
                    """,
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
                    """
                    UPDATE chat_sessions
                    SET msg_count = msg_count + 2, last_at = NOW()
                    WHERE id = $1
                    """,
                    session_id,
                )
    except Exception as exc:
        import logging
        logging.getLogger("fintrack.ai").debug("Failed to save chat messages: %s", exc)


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/chat")
async def ai_chat(body: ChatRequest, request: Request, role: str = Depends(require_auth)):
    """Natural language chat about projects + invoices with full live data context."""
    try:
        teable  = TeableService()
        inv_svc = InvoiceService()

        # Fetch project + invoice data concurrently
        (summary, all_records), (inv_summary, inv_records) = await asyncio.gather(
            asyncio.gather(teable.get_summary(), teable.get_all_records()),
            asyncio.gather(inv_svc.get_summary(), inv_svc.get_all_invoices()),
        )

        # Build project context
        project_text = (
            f"=== PORTFOLIO SUMMARY ===\n"
            f"Total Projects: {summary['total_projects']}\n"
            f"Total Billed: ₹{summary['total_billed']:,.0f}\n"
            f"Total Profit: ₹{summary['total_profit']:,.0f}\n"
            f"Avg Profit %: {summary['avg_profit_pct']:.2f}%\n"
            f"By Status: {summary['by_status']}\n"
            f"By Client: {summary['by_client']}\n"
            f"By Health: {summary['by_health']}\n"
            f"Targets Achieved: {summary.get('target_achieved_count', 0)}/{summary['total_projects']}\n"
        )
        records_text  = _format_records_context(all_records)
        invoice_text  = _format_invoice_context(inv_summary, inv_records)
        context = project_text + "\n" + records_text + "\n\n" + invoice_text

        history = [{"role": m.role, "content": m.content} for m in body.history]

        t0 = time.time()
        result = await chat_with_ai(body.message, history, context)
        duration_ms = int((time.time() - t0) * 1000)

        # ── Persist conversation (fire-and-forget) ───────────────────────
        pool = get_pool()
        session_id = getattr(body, "session_id", None)
        if pool:
            session_id = await _ensure_session(pool, session_id, role, request)
            asyncio.create_task(_save_messages(
                pool,
                session_id,
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
