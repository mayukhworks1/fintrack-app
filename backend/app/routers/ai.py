from fastapi import APIRouter, HTTPException
from ..services.teable import TeableService
from ..services.openrouter import chat_with_ai, autofill_project, analyze_project, generate_report
from ..models import ChatRequest, AutofillRequest, AnalyzeRequest

router = APIRouter(prefix="/api/ai", tags=["ai"])


@router.post("/chat")
async def ai_chat(body: ChatRequest):
    """Natural language chat about your Fintrack projects."""
    try:
        teable = TeableService()
        # Fetch live summary as context
        summary = await teable.get_summary()
        context = (
            f"Live data: {summary['total_projects']} projects, "
            f"₹{summary['total_billed']:,.0f} total billed, "
            f"₹{summary['total_profit']:,.0f} total profit, "
            f"{summary['avg_profit_pct']:.1f}% avg profit. "
            f"By status: {summary['by_status']}. "
            f"By client: {summary['by_client']}. "
            f"By health: {summary['by_health']}."
        )
        history = [{"role": m.role, "content": m.content} for m in body.history]
        reply = await chat_with_ai(body.message, history, context)
        return {"reply": reply}
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
        analysis = await analyze_project(record.get("fields", {}))
        return {"analysis": analysis, "record_id": body.record_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/report")
async def ai_report():
    """Generate an executive report for the full portfolio."""
    try:
        teable = TeableService()
        summary, records = await teable.get_summary(), await teable.get_all_records()
        report = await generate_report(summary, records)
        return {"report": report}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
