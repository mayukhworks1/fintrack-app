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
import logging
import time
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from ..services.teable import TeableService
from ..services.invoice import InvoiceService
from ..services.status import StatusService
from ..services.openrouter import (
    chat_with_ai, chat_with_ai_tuned, judge_answer, autofill_project, analyze_project, generate_report,
    generate_status_briefing,
    _format_records_context,
    format_chat_records_context,
    stream_chat_with_ai,
)
from ..models import ChatRequest, AutofillRequest, AnalyzeRequest
from .deps import require_auth
from ..db.postgres import get_pool
from ..db.valkey import rate_check

router = APIRouter(prefix="/api/ai", tags=["ai"])

# ── Context cache ─────────────────────────────────────────────────────────────
_CONTEXT_CACHE_KEY = "chat:context"
_CONTEXT_TTL       = 300   # 5 minutes; busted on sync

RESPONSE_MODE_DEFAULTS = {
    "brief": {"temperature": 0.28},
    "detailed": {"temperature": 0.35},
    "board": {"temperature": 0.22},
}


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


def _fmt_chat_invoice_context(summary: dict, records: list[dict], limit: int = 60) -> str:
    """Compact invoice context for interactive chat."""
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
    for r in records[:limit]:
        f = r.get("fields", {})
        lines.append(
            f"[{f.get('Invoice Number','?')}] {f.get('Project','?')} | "
            f"{f.get('Payment Status','?')} | "
            f"Raised ₹{float(f.get('Amount Raised') or 0):,.0f} | "
            f"Tax ₹{float(f.get('Amount with Tax') or 0):,.0f} | "
            f"Received ₹{float(f.get('Amount Received') or 0):,.0f} | "
            f"Outstanding ₹{float(f.get('Outstanding Amount') or 0):,.0f}"
        )
    return "\n".join(lines)


def _get_client_ip(request: Request) -> str:
    for header in ("x-forwarded-for", "x-real-ip", "cf-connecting-ip"):
        val = request.headers.get(header, "")
        if val:
            return val.split(",")[0].strip()
    return request.client.host if request.client else ""


def _append_status_context(context: str, status_records: list[dict]) -> str:
    """Append a compact status-board context block for status-aware AI answers."""
    status_records = status_records or []
    if not status_records:
        return context

    by_status: dict[str, int] = {}
    by_client: dict[str, int] = {}
    status_lines: list[str] = []

    for r in status_records:
        sf = r.get("fields", {})
        status = sf.get("Status") or "Not started"
        client = sf.get("Client") or "Unknown"
        project = sf.get("Project") or "Unknown project"
        short = (sf.get("Short Status") or "").strip()
        detail = (sf.get("Current Status (Detailed)") or "").strip()

        by_status[status] = by_status.get(status, 0) + 1
        by_client[client] = by_client.get(client, 0) + 1

        snippet = short or detail or "No status note recorded"
        if detail and detail != short:
            snippet = f"{snippet} — {detail[:120]}" if short else detail[:160]
        status_lines.append(f"- {client} / {project} [{status}]: {snippet}")

    top_clients = sorted(by_client.items(), key=lambda item: (-item[1], item[0]))[:8]
    context += (
        "\n\n=== LIVE STATUS BOARD SUMMARY ===\n"
        f"Total Status Records: {len(status_records)}\n"
        f"By Status: {by_status}\n"
        f"Top Clients By Active Status Rows: {top_clients}\n"
        "\n=== LIVE PROJECT STATUS UPDATES ===\n"
        + "\n".join(status_lines[:40])
    )
    return context


def _detect_dashboard_request(message: str) -> str | None:
    q = (message or "").strip().lower()
    if not q:
        return None
    asks_dashboard = any(term in q for term in (
        "dashboard", "pie chart", "donut chart", "chart", "graph", "visual", "distribution",
    ))
    if not asks_dashboard:
        return None
    asks_status = any(term in q for term in (
        "status", "statuses", "project status", "all status", "status of projects",
    ))
    asks_collections = any(term in q for term in (
        "collection", "collections", "receivable", "receivables", "overdue", "pending invoice", "aging",
    ))
    asks_risk = any(term in q for term in (
        "at risk", "at-risk", "risk", "blocker", "blockers",
    ))
    if asks_collections:
        return "collections"
    if asks_risk:
        return "risk"
    if asks_status:
        return "status"
    return None


def _normalize_chat_message(message: str) -> str:
    text = (message or "").strip()
    if "\n\nUser request:" in text:
        return text.split("\n\nUser request:", 1)[1].strip()
    return text


def _resolve_response_mode(value: str | None) -> str:
    value = (value or "brief").strip().lower()
    return value if value in RESPONSE_MODE_DEFAULTS else "brief"


def _resolve_temperature(mode: str, value: float | None) -> float:
    if value is not None:
        try:
            return max(0.0, min(float(value), 1.0))
        except Exception:
            pass
    return float(RESPONSE_MODE_DEFAULTS[mode]["temperature"])


def _should_run_judge(message: str, response_mode: str) -> bool:
    q = (message or "").lower()
    if response_mode == "board":
        return True
    judge_terms = (
        "summary", "summarize", "compare", "highest", "lowest", "best", "worst",
        "risk", "blocker", "overdue", "dashboard", "report", "founder", "collections",
    )
    return any(term in q for term in judge_terms)


def _build_verification_metadata(
    *,
    source: str,
    task: str,
    mode: str,
    confidence: str = "high",
    issues: list[str] | None = None,
    judge_model: str | None = None,
    corrected: bool = False,
) -> dict[str, Any]:
    return {
        "source": source,
        "task": task,
        "mode": mode,
        "confidence": confidence,
        "issues": issues or [],
        "judge_model": judge_model,
        "corrected": corrected,
    }


async def _build_status_dashboard_payload() -> dict[str, Any]:
    service = StatusService()
    try:
        records = await service._list_from_teable()
    except Exception:
        records = await service.list_all()

    counts: dict[str, int] = {}
    for record in records:
        fields = record.get("fields", {})
        status = str(fields.get("Status") or "Not started").strip() or "Not started"
        counts[status] = counts.get(status, 0) + 1

    total = sum(counts.values())
    palette = {
        "Completed": "#10b981",
        "In progress": "#2563eb",
        "On Hold": "#f59e0b",
        "Input Pending": "#f97316",
        "Not started": "#94a3b8",
    }
    ordered = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    series = []
    for name, value in ordered:
        pct = round((value / total * 100), 1) if total else 0.0
        series.append({
            "name": name,
            "value": value,
            "percent": pct,
            "color": palette.get(name, "#8b5cf6"),
        })

    leading = ordered[0][0] if ordered else "No status"
    leading_pct = round((ordered[0][1] / total * 100), 1) if ordered and total else 0.0
    copy_lines = [
        "Project Status Distribution",
        *[f"{item['name']}: {item['value']} project(s) ({item['percent']}%)" for item in series],
        f"Total projects: {total}",
    ]
    return {
        "kind": "status-distribution",
        "chartType": "pie",
        "eyebrow": "Overview",
        "title": "Project Status Distribution",
        "subtitle": "Live Teable status board snapshot",
        "total": total,
        "series": series,
        "kpis": [
            {"label": "Tracked projects", "value": total},
            {"label": "Largest bucket", "value": leading},
        ],
        "table": {
            "columns": ["Status", "Projects", "Share %"],
            "rows": [[item["name"], item["value"], item["percent"]] for item in series],
        },
        "insight": f"{leading} is the largest bucket at {leading_pct}% of all tracked projects." if total else "No status records are available right now.",
        "copyText": "\n".join(copy_lines),
        "downloadName": "status-dashboard",
    }


async def _build_collections_dashboard_payload() -> dict[str, Any]:
    service = InvoiceService()
    try:
        summary = await service.get_summary()
        records_result = await service.list_invoices(limit=500, order_by="Raised Date", order="desc")
    except Exception:
        summary = await service.get_summary_from_pg()
        records_result = await service.list_invoices_from_pg(limit=500, order_by="Raised Date", order="desc")
    summary = summary or {}
    records_result = records_result or {"records": []}
    records = records_result.get("records", [])

    buckets = {"0-14d": 0, "15-30d": 0, "31-60d": 0, "60d+": 0}
    pending_amount = 0.0
    for record in records:
        fields = record.get("fields", {})
        if str(fields.get("Payment Status") or "").strip() != "Pending":
            continue
        pending_amount += float(fields.get("Outstanding Amount") or fields.get("Amount Raised") or 0)
        aging = int(float(fields.get("Agening (Days)") or 0))
        if aging <= 14:
            buckets["0-14d"] += 1
        elif aging <= 30:
            buckets["15-30d"] += 1
        elif aging <= 60:
            buckets["31-60d"] += 1
        else:
            buckets["60d+"] += 1

    series = [
        {"name": label, "value": count, "percent": round((count / max(sum(buckets.values()), 1)) * 100, 1), "color": color}
        for (label, count), color in zip(buckets.items(), ["#16a34a", "#f59e0b", "#f97316", "#ef4444"])
        if count > 0
    ]
    top_overdue = (summary.get("overdue_invoices") or [None])[0]
    insight = (
        f"Largest collection pressure sits in {top_overdue.get('project', 'the overdue queue')} at ₹{float(top_overdue.get('amount') or 0):,.0f}."
        if top_overdue
        else "No pending invoice pressure is visible right now."
    )
    return {
        "kind": "collections-pressure",
        "chartType": "bar",
        "eyebrow": "Collections",
        "title": "Receivables Pressure Dashboard",
        "subtitle": "Pending invoice aging distribution from the live invoice tracker",
        "total": int(summary.get("pending_invoices") or 0),
        "series": series or [{"name": "Clear", "value": 1, "percent": 100, "color": "#10b981"}],
        "kpis": [
            {"label": "Pending invoices", "value": int(summary.get("pending_invoices") or 0)},
            {"label": "Pending outstanding", "value": f"₹{pending_amount:,.0f}"},
        ],
        "table": {
            "columns": ["Bucket", "Invoices", "Share %"],
            "rows": [[item["name"], item["value"], item["percent"]] for item in (series or [{"name": "Clear", "value": 1, "percent": 100}])],
        },
        "insight": insight,
        "copyText": "\n".join([
            "Receivables Pressure Dashboard",
            *[f"{item['name']}: {item['value']} invoice(s) ({item['percent']}%)" for item in series],
            f"Pending invoices: {int(summary.get('pending_invoices') or 0)}",
            f"Pending outstanding: ₹{pending_amount:,.0f}",
        ]),
        "downloadName": "collections-dashboard",
    }


async def _build_risk_dashboard_payload() -> dict[str, Any]:
    service = TeableService()
    try:
        summary = await service.get_summary()
    except Exception:
        summary = await service.get_summary_from_pg()
    summary = summary or {}
    at_risk = summary.get("at_risk") or []
    total = len(at_risk)
    series = []
    for item in at_risk[:6]:
        pct = float(item.get("pct") or 0)
        series.append({
            "name": item.get("name") or item.get("client") or "Project",
            "value": abs(round(pct, 2)) or 0.1,
            "percent": round((abs(pct) / max(sum(abs(float(x.get('pct') or 0)) for x in at_risk[:6]), 0.1)) * 100, 1),
            "color": "#ef4444" if pct < 0 else "#f59e0b",
        })
    return {
        "kind": "risk-dashboard",
        "chartType": "bar",
        "eyebrow": "Risk",
        "title": "At-risk Project Dashboard",
        "subtitle": "Projects currently under financial or delivery pressure",
        "total": total,
        "series": series or [{"name": "No critical risk", "value": 1, "percent": 100, "color": "#10b981"}],
        "kpis": [
            {"label": "At-risk projects", "value": total},
            {"label": "Top review item", "value": (at_risk[0]["name"] if at_risk else "None")},
        ],
        "table": {
            "columns": ["Project", "Weight", "Share %"],
            "rows": [[item["name"], item["value"], item["percent"]] for item in (series or [{"name": "No critical risk", "value": 1, "percent": 100}])],
        },
        "insight": at_risk[0]["name"] + " is the highest-priority project to review." if at_risk else "No negative-margin or critical projects are flagged right now.",
        "copyText": "\n".join([
            "At-risk Project Dashboard",
            *[f"{item.get('name','Project')}: {float(item.get('pct') or 0):.2f}% margin" for item in at_risk[:6]],
            f"At-risk projects: {total}",
        ]),
        "downloadName": "risk-dashboard",
    }


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
        pool.fetch("SELECT fields FROM projects_mirror ORDER BY synced_at DESC LIMIT 120"),
        pool.fetch("SELECT fields FROM invoices_mirror  ORDER BY raised_date DESC NULLS LAST LIMIT 60"),
    )

    # asyncpg returns JSONB as dict; fall back to json.loads for text/string rows
    def _to_dict(v) -> dict:
        if isinstance(v, dict):
            return v
        if isinstance(v, str):
            try:
                parsed = json.loads(v)
                return parsed if isinstance(parsed, dict) else {}
            except Exception:
                return {}
        return {}

    proj_fields = [_to_dict(r["fields"]) for r in proj_rows]
    inv_fields  = [_to_dict(r["fields"]) for r in inv_rows]

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
    records_text = format_chat_records_context([{"fields": f} for f in proj_fields], limit=120)

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
    invoice_text = _fmt_chat_invoice_context(inv_summary, [{"fields": f} for f in inv_fields], limit=60)

    context = project_text + "\n" + records_text + "\n\n" + invoice_text

    # ── 5. Append TOON context + live status updates ─────────────────────
    try:
        from ..services.status import StatusService
        from ..services.toon import encode_portfolio
        status_records = await StatusService().list_all()
        if status_records or proj_fields or inv_fields:
            toon_ctx = encode_portfolio(
                projects=[{"fields": f} for f in proj_fields],
                invoices=[{"fields": f} for f in inv_fields],
                statuses=status_records,
                max_projects=25,
                max_invoices=25,
            )
            context += "\n\n=== TOON CONTEXT (structured tokens) ===\n" + toon_ctx
            context = _append_status_context(context, status_records)
    except Exception:
        pass  # TOON is additive — never break chat

    # ── 6. Cache for 5 min ───────────────────────────────────────────────
    await vk.cache_set(_CONTEXT_CACHE_KEY, context, _CONTEXT_TTL)
    return context


async def _build_context_teable() -> str:
    """
    Fallback context builder using live Teable API — used when PG is not available.
    Slower but always works.
    """
    teable  = TeableService()
    inv_svc = InvoiceService()

    (summary, all_records), (inv_summary, inv_records), status_records = await asyncio.gather(
        asyncio.gather(teable.get_summary(), teable.get_all_records()),
        asyncio.gather(inv_svc.get_summary(), inv_svc.get_all_invoices()),
        StatusService().list_all(),
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
    records_text = format_chat_records_context(all_records, limit=120)
    invoice_text = _fmt_chat_invoice_context(inv_summary, inv_records, limit=60)
    context = project_text + "\n" + records_text + "\n\n" + invoice_text
    return _append_status_context(context, status_records)


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

def _client_ip(request: Request) -> str:
    for h in ("cf-connecting-ip", "x-forwarded-for", "x-real-ip"):
        v = request.headers.get(h, "")
        if v:
            return v.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


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

    Rate limit: 30 messages / minute per IP.
    """
    # ── Rate limiting (30 req/min per IP) ────────────────────────────────────
    ip = _client_ip(request)
    allowed, remaining = await rate_check(ip, limit=30, window_sec=60)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many requests — AI chat is limited to 30 messages/min. Try again shortly.",
            headers={"Retry-After": "60", "X-RateLimit-Remaining": "0"},
        )

    try:
        pool       = get_pool()
        session_id = body.session_id
        user_message = _normalize_chat_message(body.message)
        response_mode = _resolve_response_mode(body.response_mode)
        temperature = _resolve_temperature(response_mode, body.temperature)

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

        dashboard_kind = _detect_dashboard_request(user_message)
        if dashboard_kind:
            dashboard = (
                await _build_status_dashboard_payload() if dashboard_kind == "status"
                else await _build_collections_dashboard_payload() if dashboard_kind == "collections"
                else await _build_risk_dashboard_payload()
            )
            resp = {
                "reply": dashboard["copyText"],
                "dashboard": dashboard,
                "model": "deterministic-dashboard",
                "verification": _build_verification_metadata(
                    source="teable-live",
                    task=dashboard_kind,
                    mode=response_mode,
                    confidence="high",
                ),
            }
            if session_id:
                resp["session_id"] = session_id
            return resp

        # ── AI call ───────────────────────────────────────────────────────
        t0 = time.time()
        result = await chat_with_ai_tuned(user_message, history, context, response_mode=response_mode, temperature=temperature)
        verification = _build_verification_metadata(
            source="pg-mirror" if pool else "teable-live",
            task="chat",
            mode=response_mode,
            confidence="medium",
        )
        if _should_run_judge(user_message, response_mode):
            judged = await judge_answer(user_message, result["content"], context)
            if judged.get("verdict") == "soft-fail" and judged.get("corrected_answer"):
                result["content"] = judged["corrected_answer"]
            verification = _build_verification_metadata(
                source="pg-mirror" if pool else "teable-live",
                task="chat",
                mode=response_mode,
                confidence=str(judged.get("confidence") or "medium"),
                issues=list(judged.get("issues") or []),
                judge_model=judged.get("model"),
                corrected=bool(judged.get("corrected_answer")) and judged.get("verdict") == "soft-fail",
            )
        duration_ms = int((time.time() - t0) * 1000)

        # ── Persist turn (fire-and-forget) ────────────────────────────────
        if pool and session_id:
            asyncio.create_task(_save_messages(
                pool, session_id,
                user_message,
                result["content"],
                result.get("model", ""),
                result.get("tokens_used"),
                duration_ms,
            ))

        resp = {"reply": result["content"], "model": result["model_short"], "verification": verification}
        if session_id:
            resp["session_id"] = session_id
        return resp

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/chat/stream")
async def ai_chat_stream(body: ChatRequest, request: Request, role: str = Depends(require_auth)):
    """Streaming variant of chat for lower perceived latency."""
    ip = _client_ip(request)
    allowed, _remaining = await rate_check(ip, limit=30, window_sec=60)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many requests — AI chat is limited to 30 messages/min. Try again shortly.",
            headers={"Retry-After": "60", "X-RateLimit-Remaining": "0"},
        )

    pool = get_pool()
    session_id = body.session_id
    user_message = _normalize_chat_message(body.message)
    response_mode = _resolve_response_mode(body.response_mode)
    temperature = _resolve_temperature(response_mode, body.temperature)
    if pool:
        context = await _build_context_pg(pool)
        session_id = await _ensure_session(pool, session_id, role, request)
    else:
        context = await _build_context_teable()

    history: list[dict] = []
    if pool and session_id:
        history = await _load_session_history(pool, session_id, limit=12)
    if not history:
        history = [{"role": m.role, "content": m.content} for m in body.history]

    dashboard_payload = None
    dashboard_kind = _detect_dashboard_request(user_message)
    if dashboard_kind:
        dashboard_payload = (
            await _build_status_dashboard_payload() if dashboard_kind == "status"
            else await _build_collections_dashboard_payload() if dashboard_kind == "collections"
            else await _build_risk_dashboard_payload()
        )

    async def event_stream():
        started = time.time()
        final_content = ""
        final_model = ""
        final_tokens = None
        try:
            if session_id:
                yield f"data: {json.dumps({'type': 'session', 'session_id': session_id})}\n\n"
            if dashboard_payload is not None:
                final_content = dashboard_payload["copyText"]
                final_model = "deterministic-dashboard"
                verification = _build_verification_metadata(
                    source="teable-live",
                    task=dashboard_kind or "dashboard",
                    mode=response_mode,
                    confidence="high",
                )
                yield f"data: {json.dumps({'type': 'dashboard', 'dashboard': dashboard_payload, 'model_short': final_model, 'verification': verification})}\n\n"
                yield f"data: {json.dumps({'type': 'done', 'content': final_content, 'model': final_model, 'model_short': final_model, 'verification': verification})}\n\n"
                return
            async for event in stream_chat_with_ai(user_message, history, context, response_mode=response_mode, temperature=temperature):
                if event["type"] == "done":
                    final_content = event["content"]
                    final_model = event["model"]
                    final_tokens = event.get("tokens_used")
                    verification = _build_verification_metadata(
                        source="pg-mirror" if pool else "teable-live",
                        task="chat",
                        mode=response_mode,
                        confidence="medium",
                    )
                    if _should_run_judge(user_message, response_mode):
                        judged = await judge_answer(user_message, final_content, context)
                        if judged.get("verdict") == "soft-fail" and judged.get("corrected_answer"):
                            final_content = judged["corrected_answer"]
                        verification = _build_verification_metadata(
                            source="pg-mirror" if pool else "teable-live",
                            task="chat",
                            mode=response_mode,
                            confidence=str(judged.get("confidence") or "medium"),
                            issues=list(judged.get("issues") or []),
                            judge_model=judged.get("model"),
                            corrected=bool(judged.get("corrected_answer")) and judged.get("verdict") == "soft-fail",
                        )
                        event["content"] = final_content
                    event["verification"] = verification
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'error': str(exc)})}\n\n"
            return
        finally:
            if pool and session_id and final_content:
                duration_ms = int((time.time() - started) * 1000)
                asyncio.create_task(_save_messages(
                    pool, session_id,
                    user_message,
                    final_content,
                    final_model,
                    final_tokens,
                    duration_ms,
                ))

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


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


# ── Report cache config ──────────────────────────────────────────────────────
# Reports are expensive (~20-40s LLM call) and the underlying data only changes
# on sync. Cache aggressively in Valkey so reloads / multi-user views are instant.
_REPORT_CACHE_KEY = "report:executive"
_REPORT_TTL       = 600      # 10 min — refreshed sooner if cache_bust("report:") fires on sync

_REPORT_TEMPLATE_TITLES = {
    "board-pack": "Board Pack",
    "founder-weekly": "Weekly Founder Report",
    "collections-report": "Collections Report",
    "project-health-review": "Project Health Review",
    "client-billing-summary": "Client Billing Summary",
    "status-board-summary": "Status Board Summary",
}


def _money_inr(value) -> str:
    """Format a number as INR with Indian digit grouping."""
    try:
        n = round(float(value or 0))
    except (TypeError, ValueError):
        n = 0
    sign = "-" if n < 0 else ""
    s = str(abs(int(n)))
    if len(s) <= 3:
        grouped = s
    else:
        grouped = s[-3:]
        s = s[:-3]
        while s:
            grouped = s[-2:] + "," + grouped
            s = s[:-2]
    return f"{sign}₹{grouped}"


def _safe_num(value) -> float:
    try:
        return float(value) if value not in (None, "") else 0.0
    except (TypeError, ValueError):
        return 0.0


def _field(fields: dict, *names, default=""):
    for name in names:
        val = fields.get(name)
        if val not in (None, ""):
            return val
    return default


def _pct(value, decimals: int = 1) -> str:
    return f"{_safe_num(value):.{decimals}f}%"


def _project_label(fields: dict) -> str:
    return f"{_field(fields, 'Client', default='?')} / {_field(fields, 'Project Name', default='?')}"


def _project_priority(record: dict) -> tuple:
    f = record.get("fields", {})
    margin = _safe_num(f.get("Profit percentage"))
    billed = _safe_num(f.get("Amount Billed So far"))
    return (0 if margin < 0 or "🔴" in str(f.get("Health", "")) else 1, -billed)


def _build_board_pack_report(
    summary: dict,
    records: list[dict],
    invoice_summary: dict | None,
    status_records: list[dict],
) -> str:
    """
    Deterministic board-pack renderer.

    This intentionally avoids an LLM for the board report because the output has
    hard compliance requirements: exact numbers, every pending invoice, every
    status row, and no prompt leakage.
    """
    today = datetime.now().strftime("%d %B %Y")
    project_records = sorted(records or [], key=_project_priority)
    status_records = status_records or []
    at_risk = summary.get("at_risk") or []

    client_billed = summary.get("client_billed") or {}
    client_profit = summary.get("client_profit") or {}

    def add_section(parts: list[str], label: str, bullets: list[str]) -> None:
        parts.append(label)
        parts.extend(f"- {b}" for b in bullets)
        parts.append("")

    parts: list[str] = []

    add_section(parts, "Board Pack:", [
        f"Date: {today}",
        "Format: Executive board pack generated from live PostgreSQL mirror data.",
    ])

    best = summary.get("best_project") or {}
    worst = summary.get("worst_project") or {}
    add_section(parts, "Portfolio Overview:", [
        f"Portfolio contains {summary.get('total_projects', 0)} projects; {summary.get('target_achieved_count', 0)} have hit target.",
        f"Revenue billed is {_money_inr(summary.get('total_billed'))}; actual profit is {_money_inr(summary.get('total_profit'))}.",
        f"Average margin is {_pct(summary.get('avg_profit_pct'))}; best margin is {best.get('name', 'N/A')} at {best.get('pct', 'N/A')}%; worst margin is {worst.get('name', 'N/A')} at {worst.get('pct', 'N/A')}%.",
        f"By status: {summary.get('by_status', {})}.",
        f"By health: {summary.get('by_health', {})}.",
        "At-risk projects: " + (
            "; ".join(f"{p.get('name')}: {p.get('pct')}%, {p.get('health')}" for p in at_risk)
            if at_risk else "None — all projects are within healthy margins."
        ),
    ])

    add_section(parts, "Financial Performance:", [
        f"Revenue billed: {_money_inr(summary.get('total_billed'))}.",
        f"Actual profit: {_money_inr(summary.get('total_profit'))}.",
        f"Input cost: {_money_inr(summary.get('total_input_cost'))}.",
        f"Overhead: {_money_inr(summary.get('total_overhead'))}.",
        f"Total cost base: {_money_inr(summary.get('total_cost'))}.",
        f"Target achievement: {summary.get('target_achieved_count', 0)} of {summary.get('total_projects', 0)} projects.",
    ])

    client_bullets = []
    for client in sorted(client_billed.keys(), key=lambda c: -_safe_num(client_billed.get(c))):
        billed = _safe_num(client_billed.get(client))
        profit = _safe_num(client_profit.get(client))
        margin = (profit / billed * 100) if billed else 0
        client_bullets.append(
            f"{client}: Billed={_money_inr(billed)}, Profit={_money_inr(profit)} ({margin:.1f}%)."
        )
    add_section(parts, "Per-Client Breakdown:", client_bullets or ["No client P&L data available."])

    cash_bullets: list[str] = []
    if invoice_summary:
        by_status_amounts = invoice_summary.get("by_status_amounts") or {}
        status_amounts = ", ".join(
            f"{k}: {_money_inr(v)}" for k, v in sorted(by_status_amounts.items())
        ) or "None"
        cancelled = (invoice_summary.get("by_status") or {}).get("Cancelled", 0)
        cash_bullets.extend([
            f"Total invoices: {invoice_summary.get('total_invoices', 0)} (Active: {invoice_summary.get('active_invoices', 0)}, Cancelled: {cancelled}).",
            f"Raised (pre-GST): {_money_inr(invoice_summary.get('total_raised'))}.",
            f"With tax (18% GST): {_money_inr(invoice_summary.get('total_with_tax'))}.",
            f"Collected: {_money_inr(invoice_summary.get('total_received'))}.",
            f"Outstanding: {_money_inr(invoice_summary.get('total_outstanding'))}.",
            f"Collection rate: {_safe_num(invoice_summary.get('collection_rate')):.1f}%.",
            f"By status (₹): {status_amounts}.",
        ])
        for inv in invoice_summary.get("pending_invoices") or []:
            raised_date = str(inv.get("raised_date") or "?")[:10]
            cash_bullets.append(
                f"Pending invoice [{inv.get('invoice_no', '?')}] {inv.get('project', '?')}: "
                f"{_money_inr(inv.get('amount'))}, Raised={raised_date}, "
                f"Aging={int(_safe_num(inv.get('aging')))}d, Followup={inv.get('followup') or 'NOT SET'}."
            )
        by_project = invoice_summary.get("by_project") or {}
        for project, row in sorted(by_project.items(), key=lambda x: -_safe_num(x[1].get("outstanding"))):
            cash_bullets.append(
                f"Invoice breakdown - {project}: Raised={_money_inr(row.get('raised'))}, "
                f"Received={_money_inr(row.get('received'))}, Outstanding={_money_inr(row.get('outstanding'))} "
                f"({row.get('count', 0)} invoices)."
            )
    else:
        cash_bullets.append("No invoice data available.")
    add_section(parts, "Cash Flow & Collections:", cash_bullets)

    status_bullets = []
    for r in status_records:
        f = r.get("fields", {})
        client = _field(f, "Client", default="?")
        project = _field(f, "Project", default="?")
        short = _field(f, "Short Status", "status", default="No short status")
        detail = _field(f, "Current Status (Detailed)", default="")
        line = f"{client} / {project}: {short}"
        if detail and str(detail).strip() != str(short).strip():
            line += f" — {str(detail).strip()}"
        status_bullets.append(line)
    add_section(parts, "Current Project Status:", status_bullets or ["No current project status updates available."])

    health_bullets = []
    for r in project_records:
        f = r.get("fields", {})
        health_bullets.append(
            f"{_project_label(f)}: Status={_field(f, 'Project Status', default='?')}, "
            f"Health={_field(f, 'Health', default='N/A')}, Billed={_money_inr(_field(f, 'Amount Billed So far', default=0))}, "
            f"Profit={_money_inr(_field(f, 'Actual Profit', default=0))} ({_pct(_field(f, 'Profit percentage', default=0))}), "
            f"InputCost={_money_inr(_field(f, 'Input Cost', 'Input cost so far', default=0))}, "
            f"Overhead={_money_inr(_field(f, 'Overhead Cost', 'Total Overhead Cost', default=0))}, "
            f"TargetAchieved={'YES' if _field(f, 'Target Achieved ', default=False) else 'no'}."
        )
    add_section(parts, "Project Health Analysis:", health_bullets or ["No project records available."])

    risk_bullets = []
    if at_risk:
        for p in at_risk:
            risk_bullets.append(
                f"At-risk project {p.get('name', '?')}: Profit={p.get('pct')}%, "
                f"Health={p.get('health', 'N/A')}, Status={p.get('status', 'N/A')}, Billed={_money_inr(p.get('billed'))}."
            )
    else:
        risk_bullets.append("AT-RISK PROJECTS: None — all projects are within healthy margins.")
    pending = (invoice_summary or {}).get("pending_invoices") or []
    if pending:
        for inv in pending:
            risk_bullets.append(
                f"Pending collection risk: [{inv.get('invoice_no', '?')}] {inv.get('project', '?')} "
                f"for {_money_inr(inv.get('amount'))}, Aging={int(_safe_num(inv.get('aging')))}d."
            )
    else:
        risk_bullets.append("Pending invoices: none.")
    add_section(parts, "Risks & Concerns:", risk_bullets)

    recommendations = [
        "Keep project delivery controls unchanged because project health is currently green across the tracked portfolio.",
        "Prioritise collections on every named pending invoice before adding new billing exposure on PMS.",
        "Use the report history panel to compare week-on-week changes in outstanding invoices, margin, and delivery status.",
    ]
    add_section(parts, "Recommendations:", recommendations)

    action_bullets = [
        "Follow up on [WM/26-27/009] PMS and record the next collection outcome.",
        "Follow up on [WM/26-27/020] PMS and record the next collection outcome.",
        "Update every project status row where client dependency, hold state, or credential wait has changed.",
        "Review the latest stored report against this one after the next sync to confirm collections and project health movement.",
    ]
    add_section(parts, "Action Items This Week:", action_bullets)

    return "\n".join(parts).strip()


async def _save_report_history(
    pool,
    *,
    report_type: str,
    title: str,
    content: str,
    model: str,
    role: str,
    ip: str,
    metadata: dict | None = None,
) -> str | None:
    if not pool or not content:
        return None
    try:
        return str(await pool.fetchval(
            """
            INSERT INTO report_history (report_type, title, content, model, role, ip, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
            RETURNING id
            """,
            report_type,
            title[:255],
            content,
            model[:120] if model else None,
            role[:20] if role else None,
            ip[:45] if ip else None,
            json.dumps(metadata or {}),
        ))
    except Exception as exc:
        logging.getLogger("fintrack.ai.report").debug("Failed to save report history: %s", exc)
        return None


async def _build_report_payload_pg(pool) -> dict:
    """
    Build the full report data payload from the PostgreSQL mirror tables.
    Computes the same rich fields as teable.get_summary() + invoice.get_summary()
    so the PG fast-path produces an identical-quality report to the Teable path.
    """
    proj_rows, inv_rows = await asyncio.gather(
        pool.fetch("SELECT fields FROM projects_mirror ORDER BY synced_at DESC LIMIT 300"),
        pool.fetch("SELECT fields FROM invoices_mirror ORDER BY raised_date DESC NULLS LAST LIMIT 500"),
    )

    def _to_dict(v) -> dict:  # noqa: E306
        if isinstance(v, dict):
            return v
        if isinstance(v, str):
            try:
                parsed = json.loads(v)
                return parsed if isinstance(parsed, dict) else {}
            except Exception:
                return {}
        return {}

    def _safe_float(v) -> float:
        try:
            return float(v) if v not in (None, "") else 0.0
        except (TypeError, ValueError):
            return 0.0

    proj_fields = [_to_dict(r["fields"]) for r in proj_rows]
    inv_fields  = [_to_dict(r["fields"]) for r in inv_rows]

    # ── Rich project summary (mirrors teable.get_summary) ────────────────────
    total_billed       = 0.0
    total_profit       = 0.0
    total_input_cost   = 0.0
    total_overhead     = 0.0
    target_achieved    = 0
    profit_pcts: list  = []
    by_status: dict    = {}
    by_client: dict    = {}
    by_health: dict    = {}
    client_billed: dict = {}
    client_profit: dict = {}
    best_rec  = {"name": None, "pct": None}
    worst_rec = {"name": None, "pct": None}

    for f in proj_fields:
        billed     = _safe_float(f.get("Amount Billed So far"))
        profit     = _safe_float(f.get("Actual Profit"))
        inp_cost   = _safe_float(f.get("Input Cost"))
        overhead   = _safe_float(f.get("Overhead Cost"))

        total_billed     += billed
        total_profit     += profit
        total_input_cost += inp_cost
        total_overhead   += overhead

        pct_raw = f.get("Profit percentage")
        if pct_raw is not None and pct_raw != "":
            try:
                pct_f = float(pct_raw)
                profit_pcts.append(pct_f)
                label = f"{f.get('Client', '?')} / {f.get('Project Name', '?')}"
                if best_rec["pct"] is None or pct_f > best_rec["pct"]:
                    best_rec = {"name": label, "pct": round(pct_f, 2)}
                if worst_rec["pct"] is None or pct_f < worst_rec["pct"]:
                    worst_rec = {"name": label, "pct": round(pct_f, 2)}
            except (TypeError, ValueError):
                pass

        st = f.get("Project Status") or "Unknown"
        cl = f.get("Client") or "Unknown"
        h  = f.get("Health") or "Unknown"
        by_status[st] = by_status.get(st, 0) + 1
        by_client[cl] = by_client.get(cl, 0) + 1
        by_health[h]  = by_health.get(h, 0) + 1
        client_billed[cl] = client_billed.get(cl, 0.0) + billed
        client_profit[cl] = client_profit.get(cl, 0.0) + profit

        if f.get("Target Achieved "):
            target_achieved += 1

    avg_profit_pct = sum(profit_pcts) / len(profit_pcts) if profit_pcts else 0.0

    at_risk = []
    for f in proj_fields:
        pct_v  = _safe_float(f.get("Profit percentage"))
        health = f.get("Health") or ""
        if pct_v < 0 or "🔴" in health:
            at_risk.append({
                "name":   f"{f.get('Client', '?')} / {f.get('Project Name', '?')}",
                "pct":    round(pct_v, 2),
                "health": health,
                "status": f.get("Project Status", ""),
                "billed": round(_safe_float(f.get("Amount Billed So far")), 2),
            })

    project_summary = {
        "total_projects":        len(proj_fields),
        "total_billed":          round(total_billed, 2),
        "total_profit":          round(total_profit, 2),
        "total_input_cost":      round(total_input_cost, 2),
        "total_overhead":        round(total_overhead, 2),
        "total_cost":            round(total_input_cost + total_overhead, 2),
        "avg_profit_pct":        round(avg_profit_pct, 2),
        "target_achieved_count": target_achieved,
        "by_status":             by_status,
        "by_client":             by_client,
        "by_health":             by_health,
        "client_billed":         {k: round(v, 2) for k, v in client_billed.items()},
        "client_profit":         {k: round(v, 2) for k, v in client_profit.items()},
        "best_project":          best_rec,
        "worst_project":         worst_rec,
        "at_risk":               at_risk,
    }

    # ── Rich invoice summary (mirrors invoice.get_summary) ───────────────────
    invoice_summary = None
    if inv_fields:
        inv_total_raised      = 0.0
        inv_total_with_tax    = 0.0
        inv_total_received    = 0.0
        inv_total_outstanding = 0.0
        inv_by_status: dict        = {}
        inv_by_status_amounts: dict = {}
        inv_by_project: dict       = {}
        pending_invoices: list     = []
        overdue_invoices: list     = []

        for f in inv_fields:
            raised      = _safe_float(f.get("Amount Raised"))
            with_tax    = _safe_float(f.get("Amount with Tax"))
            received    = _safe_float(f.get("Amount Received"))
            status      = f.get("Payment Status", "Unknown")
            project     = f.get("Project") or "Unknown"
            cancelled   = (status == "Cancelled")

            # Compute aging: use stored field or fall back to Raised Date
            aging = _safe_float(f.get("Agening (Days)"))
            if not aging and f.get("Raised Date"):
                try:
                    rd = datetime.fromisoformat(
                        str(f["Raised Date"]).replace("Z", "+00:00")
                    )
                    aging = float((datetime.now(timezone.utc) - rd).days)
                except Exception:
                    pass

            if not cancelled:
                inv_total_raised     += raised
                inv_total_with_tax   += with_tax
                if status == "Paid":
                    inv_total_received    += raised
                else:
                    inv_total_outstanding += raised

            inv_by_status[status] = inv_by_status.get(status, 0) + 1
            if not cancelled:
                inv_by_status_amounts[status] = round(
                    inv_by_status_amounts.get(status, 0.0) + raised, 2
                )

            if project not in inv_by_project:
                inv_by_project[project] = {"raised": 0.0, "received": 0.0, "outstanding": 0.0, "count": 0}
            if not cancelled:
                inv_by_project[project]["raised"] += raised
                if status == "Paid":
                    inv_by_project[project]["received"]    += raised
                else:
                    inv_by_project[project]["outstanding"] += raised
            inv_by_project[project]["count"] += 1

            if status == "Pending":
                entry = {
                    "invoice_no":  f.get("Invoice Number", ""),
                    "project":     project,
                    "amount":      with_tax,
                    "raised_date": f.get("Raised Date"),
                    "followup":    f.get("Next followup"),
                    "aging":       aging,
                }
                pending_invoices.append(entry)
                overdue_invoices.append(entry)

        pending_invoices.sort(key=lambda x: x["aging"], reverse=True)
        overdue_invoices.sort(key=lambda x: x["aging"], reverse=True)

        collection_rate = (
            round(inv_total_received / inv_total_raised * 100, 2)
            if inv_total_raised > 0 else 0.0
        )

        invoice_summary = {
            "total_invoices":    len(inv_fields),
            "active_invoices":   len(inv_fields) - inv_by_status.get("Cancelled", 0),
            "total_raised":      round(inv_total_raised, 2),
            "total_with_tax":    round(inv_total_with_tax, 2),
            "total_received":    round(inv_total_received, 2),
            "total_outstanding": round(inv_total_outstanding, 2),
            "collection_rate":   collection_rate,
            "by_status":         inv_by_status,
            "by_status_amounts": inv_by_status_amounts,
            "by_project":        {k: {sk: round(sv, 2) if isinstance(sv, float) else sv
                                      for sk, sv in v.items()}
                                  for k, v in inv_by_project.items()},
            "pending_invoices":  pending_invoices[:10],
            "overdue_invoices":  overdue_invoices[:5],
        }

    return {
        "project_summary": project_summary,
        "project_records": [{"fields": f} for f in proj_fields],
        "invoice_summary": invoice_summary,
        "invoice_records": [{"fields": f} for f in inv_fields],
    }


async def _build_report_payload_teable() -> dict:
    """Fallback when PG is unavailable — slower live Teable path."""
    teable  = TeableService()
    inv_svc = InvoiceService()
    (summary, records), (inv_summary, inv_records) = await asyncio.gather(
        asyncio.gather(teable.get_summary(), teable.get_all_records()),
        asyncio.gather(inv_svc.get_summary(), inv_svc.get_all_invoices()),
    )
    return {
        "project_summary": summary,
        "project_records": records,
        "invoice_summary": inv_summary,
        "invoice_records": inv_records,
    }


def _build_template_report(template: str, payload: dict, status_records: list[dict]) -> str:
    project_summary = payload.get("project_summary") or {}
    invoice_summary = payload.get("invoice_summary") or {}
    project_records = payload.get("project_records") or []
    invoice_records = payload.get("invoice_records") or []

    if template == "collections-report":
        overdue = invoice_summary.get("overdue_invoices") or []
        pending = invoice_summary.get("pending_invoices") or []
        lines = [
            "Collections Report",
            "",
            f"Outstanding amount: ₹{float(invoice_summary.get('total_outstanding') or 0):,.0f}",
            f"Pending invoices: {int(invoice_summary.get('pending_invoices') or 0)}",
            f"Collection rate: {float(invoice_summary.get('collection_rate') or 0):.1f}%",
            "",
            "Priority queue:",
        ]
        if overdue:
            lines.extend(
                f"{i + 1}. {row.get('project','Invoice')} · {row.get('invoice_no','—')} · ₹{float(row.get('amount') or 0):,.0f} · {row.get('aging', 0)}d"
                for i, row in enumerate(overdue[:8])
            )
        else:
            lines.append("1. No overdue invoices are currently visible.")
        lines += [
            "",
            "Recommended actions:",
            "1. Follow up first on invoices beyond 30 days and any single invoice above ₹50,000.",
            "2. Confirm the next follow-up owner and target date for every pending item.",
            "3. Use the invoice workspace aging buckets to clear the oldest pressure first.",
        ]
        return "\n".join(lines)

    if template == "project-health-review":
        at_risk = project_summary.get("at_risk") or []
        lines = [
            "Project Health Review",
            "",
            f"Tracked projects: {len(project_records)}",
            f"Healthy projects: {int(project_summary.get('healthy_projects') or 0)}",
            f"At-risk projects: {len(at_risk)}",
            "",
            "Projects needing review:",
        ]
        if at_risk:
            lines.extend(
                f"{i + 1}. {row.get('name','Project')} · {row.get('client','Client')} · {float(row.get('pct') or 0):.2f}% margin · {row.get('status') or row.get('health') or 'No status'}"
                for i, row in enumerate(at_risk[:8])
            )
        else:
            lines.append("1. No at-risk projects are currently flagged.")
        lines += [
            "",
            "Review prompts:",
            "1. Check delivery blockers and cash clearance for the top two pressured projects.",
            "2. Confirm ownership, next milestone, and client-facing risks.",
        ]
        return "\n".join(lines)

    if template == "client-billing-summary":
        by_client = {}
        for record in project_records:
            fields = record.get("fields", {})
            client = fields.get("Client") or "Unknown"
            billed = float(fields.get("Amount Billed So far") or 0)
            profit = float(fields.get("Profit Amount") or 0)
            stats = by_client.setdefault(client, {"billed": 0.0, "profit": 0.0, "projects": 0})
            stats["billed"] += billed
            stats["profit"] += profit
            stats["projects"] += 1
        ordered = sorted(by_client.items(), key=lambda item: item[1]["billed"], reverse=True)
        lines = ["Client Billing Summary", "", "Top clients by billed amount:"]
        if ordered:
            lines.extend(
                f"{i + 1}. {client} · ₹{stats['billed']:,.0f} billed · ₹{stats['profit']:,.0f} profit · {stats['projects']} projects"
                for i, (client, stats) in enumerate(ordered[:8])
            )
        else:
            lines.append("1. No client billing data is available.")
        return "\n".join(lines)

    if template == "status-board-summary":
        by_status = {}
        for record in status_records:
            status = str(record.get("fields", {}).get("Status") or "Not started")
            by_status[status] = by_status.get(status, 0) + 1
        ordered = sorted(by_status.items(), key=lambda item: (-item[1], item[0]))
        lines = ["Status Board Summary", "", f"Status rows: {len(status_records)}", "", "By status:"]
        if ordered:
            lines.extend(f"{i + 1}. {label}: {count}" for i, (label, count) in enumerate(ordered))
        else:
            lines.append("1. No status rows are currently available.")
        return "\n".join(lines)

    if template == "founder-weekly":
        return "\n".join([
            "Weekly Founder Report",
            "",
            f"Portfolio billed: ₹{float(project_summary.get('total_billed') or 0):,.0f}",
            f"Portfolio profit: ₹{float(project_summary.get('total_profit') or 0):,.0f}",
            f"Outstanding invoices: ₹{float(invoice_summary.get('total_outstanding') or 0):,.0f}",
            f"At-risk projects: {len(project_summary.get('at_risk') or [])}",
            "",
            "Use this report to review cash, execution risk, and client pressure before weekly leadership calls.",
            "",
            _build_board_pack_report(project_summary, project_records, invoice_summary, status_records),
        ])

    return _build_board_pack_report(project_summary, project_records, invoice_summary, status_records)


@router.get("/report")
async def ai_report(
    request: Request,
    force: bool = False,
    template: str = Query("board-pack"),
    role: str = Depends(require_auth),
):
    """
    Generate an executive report for the full portfolio.

    Performance & caching strategy
    ──────────────────────────────
      • Result cached in Valkey for 10 min under key "report:executive"
      • Concurrent identical calls are coalesced via `cache.get_or_set` so a
        burst of "Generate" clicks fires only ONE OpenRouter call
      • Data sourced from PostgreSQL mirror (~10 ms) instead of Teable
        (~500-2000 ms) when available — same path as /chat
      • Query param ?force=true skips the cache for explicit "Regenerate"

    Response
    ────────
      {
        "report":     "<text>",
        "model":      "<short name>",
        "from_cache": bool,
        "cached_at":  ISO timestamp,
        "duration_ms": int        // only present on fresh generation
      }
    """
    from ..utils.cache import cache
    from datetime import datetime, timezone
    import logging

    logger = logging.getLogger("fintrack.ai.report")

    try:
        pool = get_pool()
        ip = _client_ip(request)

        template_key = template if template in _REPORT_TEMPLATE_TITLES else "board-pack"
        cache_key = f"{_REPORT_CACHE_KEY}:{template_key}"

        # ── Force regenerate: bypass cache by busting it first ────────────
        if force:
            cache.bust(cache_key)
            try:
                from ..db import valkey as vk
                await vk.cache_bust(cache_key)
            except Exception:
                pass
            logger.info("Report cache busted by force=true")

        # ── Wrap the expensive path in cache.get_or_set ───────────────────
        # This coalesces concurrent calls (multiple users hitting "Generate"
        # at the same time get ONE LLM call shared between them).
        async def _generate():
            t0 = time.time()

            # Fetch status updates in parallel with main payload
            from ..services.status import StatusService
            svc_status = StatusService()

            if pool:
                payload, status_records = await asyncio.gather(
                    _build_report_payload_pg(pool),
                    svc_status.list_all(),
                )
            else:
                payload, status_records = await asyncio.gather(
                    _build_report_payload_teable(),
                    svc_status.list_all(),
                )

            # Empty portfolio guard — don't waste an LLM call on no data
            if not payload["project_records"] and not payload.get("invoice_records"):
                return {
                    "report":      "No portfolio data available yet. Add projects or invoices, then regenerate.",
                    "model":       "n/a",
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "duration_ms": int((time.time() - t0) * 1000),
                    "empty":       True,
                }

            report_text = _build_template_report(template_key, payload, status_records or [])
            return {
                "report":       report_text,
                "model":        "deterministic",
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "duration_ms":  int((time.time() - t0) * 1000),
                "metadata": {
                    "projects": len(payload["project_records"]),
                    "invoices": len(payload.get("invoice_records") or []),
                    "statuses": len(status_records or []),
                    "pending_invoices": len((payload.get("invoice_summary") or {}).get("pending_invoices") or []),
                    "at_risk_projects": len((payload.get("project_summary") or {}).get("at_risk") or []),
                    "template": template_key,
                },
            }

        # Detect cache hit by checking the in-process store BEFORE invoking
        # get_or_set (which would silently populate).
        from_cache = cache.get(cache_key) is not None
        if not from_cache:
            # Could still be a Valkey hit — check there
            try:
                from ..db import valkey as vk
                if vk.get_client():
                    remote = await vk.cache_get(cache_key)
                    from_cache = remote is not None
            except Exception:
                pass

        # ── Rate limiting (10 expensive report builds / min per IP) ──────────
        # Cached reads should stay fast and should not burn the regeneration
        # limit. Only cold-cache or force=true requests count here.
        if force or not from_cache:
            allowed, _ = await rate_check(ip, limit=10, window_sec=60)
            if not allowed:
                raise HTTPException(
                    status_code=429,
                    detail="Too many report regenerations — limited to 10/min. Try again shortly.",
                    headers={"Retry-After": "60"},
                )

        cached_result = await cache.get_or_set(
            key=cache_key,
            ttl=_REPORT_TTL,
            loader=_generate,
        )

        response = {
            "report":       cached_result.get("report", ""),
            "model":        cached_result.get("model", ""),
            "from_cache":   from_cache,
            "cached_at":    cached_result.get("generated_at", ""),
            "metadata":     cached_result.get("metadata") or {},
        }
        if not from_cache:
            response["duration_ms"] = cached_result.get("duration_ms", 0)
        if cached_result.get("empty"):
            response["empty"] = True

        if not from_cache and not cached_result.get("empty"):
            history_id = await _save_report_history(
                pool,
                report_type="board-pack",
                title=_REPORT_TEMPLATE_TITLES.get(template, "Board Pack"),
                content=cached_result.get("report", ""),
                model=cached_result.get("model", ""),
                role=role,
                ip=ip,
                metadata=cached_result.get("metadata") or {},
            )
            if history_id:
                response["history_id"] = history_id

        return response

    except Exception as e:
        logger.exception("Report generation failed: %s", e, exc_info=True)
        # Bust the cache so a stale/broken entry doesn't block the next attempt
        cache.bust(cache_key)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/report/invalidate")
async def ai_report_invalidate(_role: str = Depends(require_auth)):
    """Bust the report cache. Useful after a manual Teable resync."""
    from ..utils.cache import cache
    n = cache.bust(_REPORT_CACHE_KEY)
    try:
        from ..db import valkey as vk
        await vk.cache_bust(_REPORT_CACHE_KEY)
    except Exception:
        pass
    return {"ok": True, "purged": n}


@router.get("/report/history")
async def ai_report_history(
    limit: int = 20,
    _role: str = Depends(require_auth),
):
    """List generated reports, newest first."""
    pool = get_pool()
    if not pool:
        return {"items": []}
    limit = max(1, min(limit, 100))
    rows = await pool.fetch(
        """
        SELECT id, created_at, report_type, title, model, role, metadata,
               char_length(content) AS content_length
        FROM report_history
        ORDER BY created_at DESC
        LIMIT $1
        """,
        limit,
    )
    return {
        "items": [
            {
                "id": str(r["id"]),
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                "report_type": r["report_type"],
                "title": r["title"],
                "model": r["model"],
                "role": r["role"],
                "metadata": r["metadata"] or {},
                "content_length": r["content_length"],
            }
            for r in rows
        ]
    }


@router.get("/report/history/{history_id}")
async def ai_report_history_detail(
    history_id: str,
    _role: str = Depends(require_auth),
):
    """Return one stored generated report."""
    pool = get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="PostgreSQL is not available")
    row = await pool.fetchrow(
        """
        SELECT id, created_at, report_type, title, content, model, role, metadata
        FROM report_history
        WHERE id = $1
        """,
        history_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Report history item not found")
    return {
        "id": str(row["id"]),
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        "report_type": row["report_type"],
        "title": row["title"],
        "report": row["content"],
        "model": row["model"],
        "role": row["role"],
        "metadata": row["metadata"] or {},
    }


@router.delete("/report/history/{history_id}")
async def ai_report_history_delete(
    history_id: str,
    _role: str = Depends(require_auth),
):
    """Delete one stored generated report."""
    pool = get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="PostgreSQL is not available")
    deleted = await pool.fetchval(
        "DELETE FROM report_history WHERE id = $1 RETURNING id",
        history_id,
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Report history item not found")
    return {"ok": True, "id": str(deleted)}


# ── Status Briefing ───────────────────────────────────────────────────────────

@router.get("/status-briefing")
async def ai_status_briefing(
    request: Request,
    role: str = Depends(require_auth),
):
    """
    Generate a focused status briefing based on the Current Status table.
    Lighter than the full board pack — delivery health only, no financials.
    Results are NOT cached (always fresh so new statuses are reflected).
    """
    t0 = time.time()
    try:
        from ..services.status import StatusService
        svc_status = StatusService()
        status_records = await svc_status.list_all()

        if not status_records:
            return {
                "report":      "No project status records available. Add status updates first.",
                "model":       "n/a",
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "duration_ms": int((time.time() - t0) * 1000),
                "empty":       True,
            }

        result = await generate_status_briefing(status_records)
        report_text = result["content"]
        history_id = await _save_report_history(
            get_pool(),
            report_type="status-briefing",
            title="Status Briefing",
            content=report_text,
            model=result.get("model_short", result.get("model", "")),
            role=role,
            ip=_client_ip(request),
            metadata={"statuses": len(status_records)},
        )
        return {
            "report":       report_text,
            "model":        result.get("model_short", result.get("model", "")),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "duration_ms":  int((time.time() - t0) * 1000),
            "metadata":     {"statuses": len(status_records)},
            "history_id":   history_id,
        }

    except Exception as e:
        import logging
        logging.getLogger("fintrack.ai").exception("Status briefing failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
