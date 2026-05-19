"""
TOON — Token Oriented Object Notation
======================================
Serialises FinTrack entities (projects, invoices, status updates) into a
compact, consistently-structured token format that the AI can parse reliably.

Token shape
-----------
  [TYPE|key:value|key:value|...]

Example tokens
--------------
  [PROJECT|client:Birla Open Minds|name:PMS Phase 1.1|status:🟢 Active|health:🟢|billed:150000|margin:35.2|risk:LOW]
  [INVOICE|num:INV-2024-001|project:PMS Phase 1.1|client:Birla Open Minds|raised:50000|received:50000|outstanding:0|status:Received|aging:0d]
  [STATUS|client:Birla Open Minds|project:PMS Phase 1.1|short:UAT in progress|detail:Client reviewing deliverables. Signoff expected by May 25.]

Design principles
-----------------
* Pipe-delimited key:value — cheap for LLMs to parse, no JSON overhead.
* Each type has a fixed canonical field order so the AI builds reliable priors.
* Values are never quoted unless they contain a pipe character (escaped as \\|).
* Numeric values are raw numbers — callers add ₹ / % prefixes in prose.
* A complete portfolio context is a newline-joined block of TOON tokens,
  optionally wrapped in a plain-text preamble for the section.
"""

from __future__ import annotations

from typing import Any


# ── helpers ────────────────────────────────────────────────────────────────

def _sf(v: Any, default: float = 0.0) -> float:
    """Safe float cast."""
    try:
        return float(v) if v not in (None, "", "N/A") else default
    except (TypeError, ValueError):
        return default


def _esc(v: str) -> str:
    """Escape pipe characters inside a value so tokens stay parseable."""
    return str(v).replace("|", "\\|").strip()


def _tok(type_: str, **fields: Any) -> str:
    """Build a single TOON token string."""
    parts = [type_] + [f"{k}:{_esc(v)}" for k, v in fields.items() if v not in (None, "", "N/A")]
    return "[" + "|".join(parts) + "]"


# ── project token ──────────────────────────────────────────────────────────

def encode_project(record: dict) -> str:
    """
    Encode a single project Teable/PG record as a TOON token.

    Fields emitted (in order):
      client, name, status, health, billed, input_cost, overhead, profit,
      margin (%), target, target_achieved, resources, risk
    """
    f = record.get("fields", record)  # works for both {"fields":{}} and flat dict

    client   = f.get("Client") or f.get("client") or "?"
    name     = f.get("Project Name") or f.get("project_name") or "?"
    status   = f.get("Project Status") or f.get("project_status") or "?"
    health   = f.get("Health") or f.get("health") or "?"
    billed   = _sf(f.get("Amount Billed So far") or f.get("amount_billed"))
    inp_cost = _sf(f.get("Input cost so far") or f.get("input_cost_so_far"))
    overhead = _sf(f.get("Total Overhead Cost") or f.get("total_overhead_cost"))
    profit   = _sf(f.get("Actual Profit") or f.get("actual_profit"))
    margin   = _sf(f.get("Profit percentage") or f.get("profit_percentage"))
    target   = _sf(f.get("Target Revenue") or f.get("target_revenue"))
    achieved = f.get("Target Achieved ") or f.get("target_achieved") or False
    resources = f.get("Resource Count") or f.get("resource_count") or 0

    risk = "HIGH" if margin < 0 else ("MEDIUM" if margin < 15 else "LOW")

    return _tok(
        "PROJECT",
        client=client,
        name=name,
        status=status,
        health=health,
        billed=round(billed, 0),
        input_cost=round(inp_cost, 0),
        overhead=round(overhead, 0),
        profit=round(profit, 0),
        margin=round(margin, 2),
        target=round(target, 0),
        target_achieved="YES" if achieved else "NO",
        resources=resources,
        risk=risk,
    )


# ── invoice token ──────────────────────────────────────────────────────────

def encode_invoice(record: dict) -> str:
    """
    Encode a single invoice Teable/PG record as a TOON token.

    Fields emitted (in order):
      num, project, client, raised, tax, received, outstanding,
      status, aging_days, raised_date
    """
    f = record.get("fields", record)

    num        = f.get("Invoice Number") or f.get("invoice_number") or "?"
    project    = f.get("Project") or f.get("project") or "?"
    client     = f.get("Client") or f.get("client") or "?"
    raised     = _sf(f.get("Amount Raised") or f.get("amount_raised"))
    tax        = _sf(f.get("Amount with Tax") or f.get("amount_with_tax"))
    received   = _sf(f.get("Amount Received") or f.get("amount_received"))
    outstanding = _sf(f.get("Outstanding Amount") or f.get("outstanding_amount"))
    status     = f.get("Payment Status") or f.get("payment_status") or "?"
    aging      = f.get("Agening (Days)") or f.get("aging_days") or 0
    raised_dt  = f.get("Raised Date") or f.get("raised_date") or "?"

    return _tok(
        "INVOICE",
        num=num,
        project=project,
        client=client,
        raised=round(raised, 0),
        tax=round(tax, 0),
        received=round(received, 0),
        outstanding=round(outstanding, 0),
        status=status,
        aging=f"{aging}d",
        raised_date=raised_dt,
    )


# ── status token ───────────────────────────────────────────────────────────

def encode_status(record: dict) -> str:
    """
    Encode a Current Status table record as a TOON token.

    Fields emitted (in order):
      client, project, short, detail
    """
    f = record.get("fields", record)

    client  = f.get("Client") or "?"
    project = f.get("Project") or "?"
    short   = f.get("Short Status") or ""
    detail  = f.get("Current Status (Detailed)") or ""

    # Truncate detail to 300 chars to keep tokens compact
    if len(detail) > 300:
        detail = detail[:297] + "..."

    return _tok(
        "STATUS",
        client=client,
        project=project,
        short=short,
        detail=detail,
    )


# ── portfolio context block ────────────────────────────────────────────────

def encode_portfolio(
    projects: list[dict],
    invoices: list[dict],
    statuses: list[dict],
    *,
    max_projects: int = 60,
    max_invoices: int = 80,
) -> str:
    """
    Build a full TOON context block suitable for injection into an AI prompt.

    Projects are sorted: at-risk first (margin < 0), then by billed desc.
    Invoices are sorted: highest outstanding first.
    Status updates are sorted: by client + project for easy cross-referencing.

    Returns a multi-line string of TOON tokens grouped by type with headers.
    """
    # ── sort + cap projects ───────────────────────────────────────────────
    def _proj_sort(r: dict) -> tuple:
        f = r.get("fields", r)
        margin = _sf(f.get("Profit percentage") or f.get("profit_percentage"))
        billed = _sf(f.get("Amount Billed So far") or f.get("amount_billed"))
        return (0 if margin < 0 else 1, -billed)

    sorted_projects = sorted(projects, key=_proj_sort)[:max_projects]

    # ── sort + cap invoices ───────────────────────────────────────────────
    def _inv_sort(r: dict) -> float:
        f = r.get("fields", r)
        return -_sf(f.get("Outstanding Amount") or f.get("outstanding_amount"))

    sorted_invoices = sorted(invoices, key=_inv_sort)[:max_invoices]

    # ── sort status updates ───────────────────────────────────────────────
    def _status_sort(r: dict) -> str:
        f = r.get("fields", r)
        return f"{f.get('Client','')}{f.get('Project','')}".lower()

    sorted_statuses = sorted(statuses, key=_status_sort)

    lines: list[str] = []

    # Projects block
    if sorted_projects:
        lines.append("### TOON:PROJECTS ###")
        lines.extend(encode_project(r) for r in sorted_projects)

    # Status block
    if sorted_statuses:
        lines.append("")
        lines.append("### TOON:STATUS_UPDATES ###")
        lines.extend(encode_status(r) for r in sorted_statuses)

    # Invoices block
    if sorted_invoices:
        lines.append("")
        lines.append("### TOON:INVOICES ###")
        lines.extend(encode_invoice(r) for r in sorted_invoices)

    return "\n".join(lines)
