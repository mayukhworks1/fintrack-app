from fastapi import APIRouter, HTTPException
from ..services.teable import TeableService
from ..services.openrouter import (
    chat_with_ai, autofill_project, analyze_project, generate_report,
    _format_records_context
)
from ..models import ChatRequest, AutofillRequest, AnalyzeRequest

router = APIRouter(prefix="/api/ai", tags=["ai"])


@router.post("/chat")
async def ai_chat(body: ChatRequest):
    """Natural language chat about your Fintrack projects with full live data context."""
    try:
        teable = TeableService()
        # Fetch both summary AND full records for rich context
        summary, all_records = await teable.get_summary(), await teable.get_all_records()

        # Build rich context: summary + every individual project record
        summary_text = (
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
        records_text = _format_records_context(all_records)
        context = summary_text + "\n" + records_text

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
