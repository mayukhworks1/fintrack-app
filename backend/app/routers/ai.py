import time
import asyncio
from fastapi import APIRouter, HTTPException
from ..services.teable import TeableService
from ..services.invoice import InvoiceService
from ..services.openrouter import (
    chat_with_ai, autofill_project, analyze_project, generate_report,
    _format_records_context, _try_chat,
)
from ..models import ChatRequest, AutofillRequest, AnalyzeRequest

router = APIRouter(prefix="/api/ai", tags=["ai"])

# In-memory cache for /executive-summary — model is slow, recompute every 5 min
_exec_cache: dict[str, tuple[float, dict]] = {}
_EXEC_TTL = 300  # seconds


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


@router.post("/chat")
async def ai_chat(body: ChatRequest):
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
        result = await chat_with_ai(body.message, history, context)
        return {"reply": result["content"], "model": result["model_short"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/autofill")
async def ai_autofill(body: AutofillRequest):
    """Describe a project in plain text, AI extracts structured fields."""
    try:
        fields = await autofill_project(body.description)
        return {"fields": fields}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analyze")
async def ai_analyze(body: AnalyzeRequest):
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


@router.get("/executive-summary")
async def executive_summary():
    """
    Generate a 2-3 sentence AI executive summary of the entire portfolio
    + invoice book. Designed for the top of the dashboard.
    Cached for 5 minutes to keep latency low and avoid rate-limiting.
    """
    # Cache check
    cached = _exec_cache.get("default")
    if cached and (time.time() - cached[0]) < _EXEC_TTL:
        return cached[1]

    try:
        teable  = TeableService()
        inv_svc = InvoiceService()

        (proj_sum, proj_records), (inv_sum, inv_records) = await asyncio.gather(
            asyncio.gather(teable.get_summary(), teable.get_all_records()),
            asyncio.gather(inv_svc.get_summary(), inv_svc.get_all_invoices()),
        )

        # Compact business snapshot — focused, no fluff
        margin_pct = (
            (proj_sum["total_profit"] / proj_sum["total_billed"] * 100)
            if proj_sum["total_billed"] > 0 else 0
        )
        snapshot = (
            f"BUSINESS SNAPSHOT (live):\n"
            f"- Total revenue billed: ₹{proj_sum['total_billed']:,.0f}\n"
            f"- Net profit: ₹{proj_sum['total_profit']:,.0f} ({margin_pct:.1f}% margin)\n"
            f"- Active projects: {proj_sum['total_projects']} "
            f"({proj_sum.get('target_achieved_count', 0)} hit target)\n"
            f"- Invoices total raised: ₹{inv_sum['total_raised']:,.0f}\n"
            f"- Outstanding receivables: ₹{inv_sum['total_outstanding']:,.0f}\n"
            f"- Collection rate: {inv_sum['collection_rate']:.1f}%\n"
            f"- Pending invoices: {inv_sum['by_status'].get('Pending', 0)}\n"
            f"- Overdue (>30 days): {len(inv_sum.get('overdue_invoices', []))}"
        )
        if inv_sum.get("overdue_invoices"):
            top = inv_sum["overdue_invoices"][0]
            snapshot += (
                f"\n- Oldest overdue: {top.get('invoice_no', '?')} "
                f"({top.get('project', '?')}) "
                f"₹{float(top.get('amount', 0)):,.0f} "
                f"aged {int(top.get('aging', 0))} days"
            )

        prompt = (
            "You are FinTrackAI — a sharp CXO advisor.\n\n"
            "Write a 3-sentence executive summary of the business based on the "
            "snapshot below. Each sentence must be punchy, specific, and "
            "actionable. Cite real numbers (use ₹ shorthand: ₹2.5L, ₹1.2Cr).\n\n"
            "Sentence 1: state overall health using revenue, margin, project count.\n"
            "Sentence 2: highlight the biggest risk OR opportunity (overdue, "
            "concentration, low margin project).\n"
            "Sentence 3: one concrete action the CXO should take this week.\n\n"
            "Rules:\n"
            "- Output ONLY the 3 sentences. No headings, no bullet points, no "
            "preamble like 'Here is' or 'Based on'.\n"
            "- No markdown. Plain prose.\n"
            "- Start the first sentence with the actual answer (not meta-text).\n\n"
            f"{snapshot}"
        )

        messages = [
            {"role": "system", "content":
             "You are a concise CXO advisor. Write only the requested output. "
             "Never explain your thinking. Never say 'Let me' or 'Based on'."},
            {"role": "user", "content": prompt},
        ]

        result = await _try_chat(messages, max_tokens=300, temperature=0.5)

        payload = {
            "summary":     result["content"].strip(),
            "model":       result["model_short"],
            "generated_at": time.time(),
            "metrics": {
                "total_billed":    proj_sum["total_billed"],
                "total_profit":    proj_sum["total_profit"],
                "margin_pct":      round(margin_pct, 2),
                "total_projects":  proj_sum["total_projects"],
                "total_raised":    inv_sum["total_raised"],
                "outstanding":     inv_sum["total_outstanding"],
                "collection_rate": inv_sum["collection_rate"],
                "overdue_count":   len(inv_sum.get("overdue_invoices", [])),
                "pending_count":   inv_sum["by_status"].get("Pending", 0),
            },
        }
        _exec_cache["default"] = (time.time(), payload)
        return payload

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/report")
async def ai_report():
    """Generate an executive report for the full portfolio."""
    try:
        teable = TeableService()
        summary, records = await teable.get_summary(), await teable.get_all_records()
        result = await generate_report(summary, records)
        return {"report": result["content"], "model": result["model_short"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
