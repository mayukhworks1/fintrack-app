"""
FinTrack AI service — OpenRouter wiring.

Architecture
------------
1. Model registry (`MODELS`) — explicit metadata per model: clean? supports
   reasoning:exclude? reasoning leakage score. Selection prefers clean
   instruction-tuned models; reasoning-heavy models are last-resort.

2. Delimited-answer protocol — every prompt instructs the model to wrap
   its output in `===ANSWER===` ... `===END===` markers. We extract the
   payload between them. If a model ignores the protocol, fall back to
   the multi-layer reasoning stripper.

3. Reasoning stripper — three layers:
   a. XML tags (<think>, <reasoning>, <thought>)
   b. Structured-plan markers (Sentence 1:, Step 1:, Plan:, Output:, etc.)
   c. Heuristic meta-paragraph detection ("We need to…", "Let me…")

4. Resilient HTTP — single shared httpx.AsyncClient with retry on
   transient failures (timeout / connection / 5xx), exponential back-off,
   and per-model error reporting.
"""
from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass
from typing import Any, Optional

import httpx

from ..config import settings

OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
ANSWER_OPEN  = "===ANSWER==="
ANSWER_CLOSE = "===END==="


# ── Model registry ────────────────────────────────────────────────────
@dataclass(frozen=True)
class ModelSpec:
    id: str
    leakage: int           # 0 = clean, 5 = leaks heavily
    supports_reasoning_param: bool = False
    notes: str = ""


# Ordered preference list: clean instruction-tuned models first.
MODELS: list[ModelSpec] = [
    ModelSpec("meta-llama/llama-3.3-70b-instruct:free",          leakage=0),
    ModelSpec("google/gemini-2.0-flash-exp:free",                leakage=0),
    ModelSpec("meta-llama/llama-3.1-8b-instruct:free",           leakage=1),
    ModelSpec("mistralai/mistral-7b-instruct:free",              leakage=1),
    ModelSpec("nvidia/llama-3.3-nemotron-super-49b-v1:free",     leakage=3, supports_reasoning_param=True),
    ModelSpec("nvidia/nemotron-3-super-120b-a12b:free",          leakage=5, supports_reasoning_param=True,
              notes="Heavy reasoning leakage even with reasoning:exclude — last resort only"),
]


def _ordered_models() -> list[ModelSpec]:
    """Primary (from settings) first, then registry, dedup by id."""
    primary = settings.openrouter_model
    seen: set[str] = set()
    out: list[ModelSpec] = []
    if primary:
        # If user-configured primary is in registry, use its spec; else assume clean.
        match = next((m for m in MODELS if m.id == primary), None)
        if match:
            out.append(match); seen.add(primary)
        else:
            out.append(ModelSpec(primary, leakage=2)); seen.add(primary)
    for m in MODELS:
        if m.id not in seen:
            out.append(m); seen.add(m.id)
    return out


def _short(model_id: str) -> str:
    return model_id.split("/")[-1].replace(":free", "")


# ── System prompt — strict, explicit, single-purpose ──────────────────
SYSTEM_PROMPT = f"""You are FinTrackAI, a financial analyst for a project management company. You have live access to two tables:

PROJECTS — Client, Project Name (Innovine, PMS, Maitrimetal etc), Amount Billed, Actual Profit, Profit %, Target Revenue, Input/Overhead Cost, Status, Health, Resource Count, Duration.

INVOICES — Invoice Number, Project, Category, Description, Milestone, Raised By, Raised Date, Cleared Date, Amount Raised, Amount with Tax (18% GST), Amount Received, Payment Status (Paid/Pending/Cancelled), Outstanding Amount, Days To Clear, Aging, Speed, Next Followup.

OUTPUT PROTOCOL — strict:
1. Begin your response with the literal token: {ANSWER_OPEN}
2. Then write only the user-facing answer.
3. End with the literal token: {ANSWER_CLOSE}
4. Nothing outside the {ANSWER_OPEN}/{ANSWER_CLOSE} block. No preamble, no thinking, no plan, no commentary about the prompt.

ANSWER STYLE:
- Plain prose. No markdown headers (#, ##), no asterisk emphasis, no backticks.
- Numbered lists "1. 2. 3." when listing multiple items.
- Section labels like "Overview:", "Risk:", "Action:" on their own line.
- Currency in ₹ with Indian grouping (₹2,47,200) for accuracy. Only use shorthand (₹2.5L, ₹1.2Cr) when explicitly asked for an "executive summary".
- State numbers directly when the data shows them. Do not hedge.
- Never say "Let me", "We need to", "Looking at", "I'll", "Sentence 1:", "Step 1:", "Based on", "Here is", "First,", "Output:".

If the question is unclear, give the best concise answer you can with the data available — do not ask for clarification."""


# ── Output extraction ─────────────────────────────────────────────────
_ANSWER_RE = re.compile(
    rf'{re.escape(ANSWER_OPEN)}\s*(.*?)\s*(?:{re.escape(ANSWER_CLOSE)}|$)',
    re.DOTALL,
)

# Plan/structure markers that signify the model is exposing its scaffolding.
_PLAN_LINE_RE = re.compile(
    r'^\s*('
    r'sentence\s*\d+\s*[:.]|'                      # "Sentence 1:" "Sentence1:"
    r'sentence\s*one\b|sentence\s*two\b|sentence\s*three\b|'
    r'step\s*\d+\s*[:.]|'                          # "Step 1:"
    r'plan\s*[:.]|outline\s*[:.]|approach\s*[:.]|'
    r'output\s*[:.]|answer\s*[:.]|response\s*[:.]|'
    r'analysis\s*[:.]|reasoning\s*[:.]|thinking\s*[:.]'
    r')',
    re.IGNORECASE,
)

# Paragraph-leading meta phrases.
_META_PARA_RE = re.compile(
    r'^\s*('
    r'okay[,.\s]|alright[,.\s]|let me\b|let us\b|let\'?s\b|'
    r'i (should|need|will|can|must|have to|am going to|\'m)\b|'
    r'we (need|should|must|will|can|have|are|\'re|\'ll)\b|'
    r'the user (is|wants|asked|has|likely|probably)\b|'
    r'looking at\b|checking\b|scanning\b|reviewing\b|examining\b|'
    r'first[,.\s]|now[,.\s]|so[,.\s]|then[,.\s]|next[,.\s]|'
    r'based on\b|given the\b|from the\b|'
    r'important (note|to|that)\b|must avoid\b|'
    r'i should present\b|let me structure\b|let me think\b|let me check\b|let me parse\b|'
    r'likely (they|the user)\b|'
    r'(invoice|project|data) records?\b|'
    r'\bparse\b|here is\b|here\'?s the\b|'
    r'hmm[,.\s]|wait[,.\s]|actually[,.\s]'
    r')',
    re.IGNORECASE,
)


def _extract_answer(content: str) -> str:
    """Pull just the user-facing answer out of the raw model response."""
    if not content:
        return ""

    # Layer 1 — XML tag stripping (in case the model used <think>)
    cleaned = re.sub(r'<think(?:ing)?>.*?</think(?:ing)?>', '', content,
                     flags=re.DOTALL | re.IGNORECASE)
    cleaned = re.sub(r'<reasoning>.*?</reasoning>', '', cleaned,
                     flags=re.DOTALL | re.IGNORECASE)
    cleaned = re.sub(r'<thought>.*?</thought>', '', cleaned,
                     flags=re.DOTALL | re.IGNORECASE)

    # Layer 2 — delimited answer block (preferred path)
    m = _ANSWER_RE.search(cleaned)
    if m:
        inner = m.group(1).strip()
        if inner:
            # Defensive: strip any plan/meta lines that snuck inside the block
            return _drop_plan_lines(inner)

    # Layer 3 — no markers; aggressive heuristic clean
    return _heuristic_strip(cleaned)


def _drop_plan_lines(text: str) -> str:
    """Remove any line that looks like a plan/scaffolding marker."""
    out = []
    for ln in text.splitlines():
        if _PLAN_LINE_RE.match(ln):
            continue
        out.append(ln)
    return "\n".join(out).strip()


def _heuristic_strip(content: str) -> str:
    """
    No answer markers found. Walk paragraphs; keep only those AFTER the
    last meta/plan paragraph. If the whole response looks meta, return
    the last paragraph as a best-effort answer.
    """
    text = content.strip()
    if not text:
        return ""

    paragraphs = re.split(r'\n{2,}', text)
    last_meta_idx = -1

    for idx, para in enumerate(paragraphs):
        s = para.strip()
        if not s:
            continue
        first_line = s.splitlines()[0].strip()
        # plan-style lines OR meta-paragraph openers
        if _PLAN_LINE_RE.match(first_line) or _META_PARA_RE.match(first_line):
            last_meta_idx = idx
            continue
        # Mid-paragraph plan markers anywhere in the first 3 lines (early section only)
        if idx < len(paragraphs) // 2:
            for line in s.splitlines()[:3]:
                if _PLAN_LINE_RE.match(line.strip()) or _META_PARA_RE.match(line.strip()):
                    last_meta_idx = idx
                    break

    if last_meta_idx >= 0 and last_meta_idx < len(paragraphs) - 1:
        kept = '\n\n'.join(paragraphs[last_meta_idx + 1:])
    else:
        kept = text

    # Final pass — strip any remaining plan-style lines from kept text
    kept = _drop_plan_lines(kept)

    # Final pass — strip leading "Output:" / "Answer:" preambles
    kept = re.sub(r'^\s*(output|answer|response)\s*[:.\-]\s*', '',
                  kept, flags=re.IGNORECASE)

    return kept.strip()


# ── HTTP layer ────────────────────────────────────────────────────────
def _make_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://fintrack-app-beta.vercel.app",
        "X-Title": "FinTrack AI",
    }


# Shared client — connection pool is reused across requests (faster than
# spinning a new client per call).
_http_client: Optional[httpx.AsyncClient] = None


def _client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(60.0, connect=10.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _http_client


async def _post_with_retries(payload: dict, retries: int = 2) -> httpx.Response:
    """POST with exponential back-off on transient failures only."""
    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            r = await _client().post(OPENROUTER_API_URL, headers=_make_headers(), json=payload)
            # 5xx → retry; everything else → return for caller to inspect
            if r.status_code >= 500 and attempt < retries:
                await asyncio.sleep(0.6 * (2 ** attempt))
                continue
            return r
        except (httpx.TimeoutException, httpx.ConnectError) as e:
            last_err = e
            if attempt < retries:
                await asyncio.sleep(0.6 * (2 ** attempt))
                continue
            raise
    if last_err:
        raise last_err
    raise RuntimeError("Unreachable")


# ── Core chat orchestrator ────────────────────────────────────────────
async def _try_chat(
    messages: list[dict],
    max_tokens: int = 1024,
    temperature: float = 0.5,
    extract: bool = True,
) -> dict:
    """
    Try each model in order until one returns usable content.

    Returns {"content": str, "model": str, "model_short": str}.
    Raises ValueError on hard failure (auth/quota) or after exhausting all models.
    """
    if not settings.openrouter_api_key:
        raise ValueError("OPENROUTER_API_KEY is not configured. Add it to HF Space secrets.")

    errors: list[str] = []

    for spec in _ordered_models():
        try:
            payload: dict[str, Any] = {
                "model": spec.id,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
            }
            if spec.supports_reasoning_param:
                payload["reasoning"] = {"exclude": True}

            r = await _post_with_retries(payload)

            if r.status_code == 401:
                raise ValueError("Invalid OPENROUTER_API_KEY — check your HF Space secrets")
            if r.status_code == 402:
                raise ValueError("OpenRouter quota exceeded — check free-tier limits")
            if r.status_code == 429:
                errors.append(f"{_short(spec.id)}: rate-limited")
                continue
            if r.status_code >= 400:
                try:
                    data = r.json()
                    err = data.get("error", {})
                    err_msg = err.get("message", r.text) if isinstance(err, dict) else str(err)
                except Exception:
                    err_msg = r.text[:200]
                # Model-specific → try next
                if r.status_code in (400, 404, 422) or "model" in err_msg.lower():
                    errors.append(f"{_short(spec.id)}: {err_msg[:120]}")
                    continue
                raise ValueError(f"OpenRouter error ({r.status_code}): {err_msg}")

            data = r.json()
            if "error" in data:
                err = data["error"]
                err_msg = err.get("message", str(err)) if isinstance(err, dict) else str(err)
                if "model" in err_msg.lower() or "not found" in err_msg.lower():
                    errors.append(f"{_short(spec.id)}: {err_msg[:120]}")
                    continue
                raise ValueError(f"OpenRouter error: {err_msg}")

            raw = data.get("choices", [{}])[0].get("message", {}).get("content", "") or ""
            if not raw.strip():
                errors.append(f"{_short(spec.id)}: empty response")
                continue

            content = _extract_answer(raw) if extract else raw.strip()
            if not content:
                errors.append(f"{_short(spec.id)}: response had no extractable answer")
                continue

            return {"content": content, "model": spec.id, "model_short": _short(spec.id)}

        except (httpx.TimeoutException, httpx.ConnectError):
            errors.append(f"{_short(spec.id)}: timeout/network")
            continue
        except ValueError:
            raise
        except Exception as e:
            errors.append(f"{_short(spec.id)}: {str(e)[:100]}")
            continue

    raise ValueError(
        ("All AI models are unavailable right now. Tried: " + "; ".join(errors))
        if errors else "No models configured."
    )


# Backwards-compat alias used elsewhere
_strip_reasoning = _extract_answer


# ── Context formatters ────────────────────────────────────────────────
_PROJECT_CURRENCY_FIELDS = {
    'Amount Billed So far', 'Actual Profit', 'Target Revenue',
    'Input cost so far', 'Total Overhead Cost',
    'Combined monthly salary of all the resources', 'Revenue per Resource',
}


def _format_records_context(records: list[dict]) -> str:
    if not records:
        return "No project records found."
    lines = ["=== LIVE PROJECT DATA ==="]
    for i, rec in enumerate(records, 1):
        f = rec.get("fields", {})
        lines.append(f"[Project {i}] {f.get('Client', '?')} / {f.get('Project Name', '?')}")
        lines.append(f"  Status: {f.get('Project Status', 'N/A')}")
        lines.append(f"  Health: {f.get('Health', 'N/A')}")
        lines.append(f"  Duration: {f.get('Duration (Months)', 'N/A')} months")
        lines.append(f"  Resources: {f.get('Resource Count', 'N/A')}")
        lines.append(f"  Target Achieved: {f.get('Target Achieved', 'N/A')}")
        for field in ('Amount Billed So far', 'Target Revenue', 'Actual Profit',
                      'Input cost so far', 'Total Overhead Cost',
                      'Combined monthly salary of all the resources'):
            val = f.get(field)
            if val is not None:
                try:
                    lines.append(f"  {field}: ₹{float(val):,.0f}")
                except (ValueError, TypeError):
                    lines.append(f"  {field}: {val}")
        pct = f.get('Profit percentage')
        if pct is not None:
            try: lines.append(f"  Profit %: {float(pct):.2f}%")
            except (ValueError, TypeError): pass
        contrib = f.get('Resource contribution percentage')
        if contrib is not None:
            lines.append(f"  Resource Contribution: {contrib}%")
        lines.append("")
    return "\n".join(lines)


# ── Public API ────────────────────────────────────────────────────────
async def chat_with_ai(message: str, history: list[dict], context: str = "") -> dict:
    """Chat with full DB context. Returns extracted user-facing content."""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if context:
        messages.append({"role": "system", "content": context})
    for h in history[-12:]:
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": message})
    return await _try_chat(messages, max_tokens=1024, temperature=0.5)


async def autofill_project(description: str) -> dict:
    """Extract structured project fields from free-text description."""
    if not settings.openrouter_api_key:
        raise ValueError("OPENROUTER_API_KEY is not configured.")

    prompt = (
        f'Extract project fields from: "{description}"\n\n'
        f'Output exactly this JSON object inside the {ANSWER_OPEN} / {ANSWER_CLOSE} markers '
        f'(no markdown, no commentary):\n'
        '{\n'
        '  "client": "Birla Open Minds | Maitrimetal | BG | null",\n'
        '  "project_name": "ZOHO | Pms | Innovine | null",\n'
        '  "project_start_date": "YYYY-MM-DD | null",\n'
        '  "duration_months": number_or_null,\n'
        '  "resource_count": integer_or_null,\n'
        '  "combined_monthly_salary": number_or_null,\n'
        '  "amount_billed": number_or_null,\n'
        '  "project_status": "🟢 Active | ✅ Completed | ⏸️ On Hold | 🔴 Cancelled | null",\n'
        '  "resource_contribution_pct": number_0_to_100_or_null\n'
        '}'
    )
    messages = [
        {"role": "system", "content":
            "You are a JSON extraction assistant. Output ONLY the JSON object inside "
            f"{ANSWER_OPEN} / {ANSWER_CLOSE} markers. No prose, no markdown, no commentary."},
        {"role": "user", "content": prompt},
    ]
    result = await _try_chat(messages, max_tokens=512, temperature=0.05)
    content = result["content"].strip()
    # Defensive markdown fence stripping
    content = re.sub(r'^```(?:json)?\s*', '', content)
    content = re.sub(r'\s*```$', '', content)
    match = re.search(r'\{.*\}', content, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return {}


async def analyze_project(project_fields: dict) -> dict:
    """Deep AI analysis of one project."""
    lines = []
    for k, v in project_fields.items():
        if v is None:
            continue
        if k in _PROJECT_CURRENCY_FIELDS:
            try:
                lines.append(f"  {k}: ₹{float(v):,.0f}")
            except (ValueError, TypeError):
                lines.append(f"  {k}: {v}")
        else:
            lines.append(f"  {k}: {v}")

    prompt = (
        f"Analyze this project and produce a concise actionable assessment.\n\n"
        f"PROJECT DATA:\n{chr(10).join(lines)}\n\n"
        f"Structure with these section labels (each on its own line):\n"
        f"Health Summary:\nKey Financial Metrics:\nRisks:\nRecommendations:\nTarget Status:"
    )
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ]
    return await _try_chat(messages, max_tokens=1024, temperature=0.5)


async def generate_report(summary: dict, records: list[dict]) -> dict:
    """Full executive report for the portfolio."""
    project_lines = []
    for r in records:
        f = r.get("fields", {})
        billed = float(f.get('Amount Billed So far') or 0)
        profit = float(f.get('Profit percentage') or 0)
        project_lines.append(
            f"  • {f.get('Client')} / {f.get('Project Name')}: "
            f"Status={f.get('Project Status')}, "
            f"Billed=₹{billed:,.0f}, "
            f"Profit={profit:.1f}%, "
            f"Health={f.get('Health', 'N/A')}"
        )

    prompt = (
        "Write a professional executive report for the FinTrack portfolio.\n\n"
        f"PORTFOLIO SUMMARY:\n"
        f"  Total Projects: {summary['total_projects']}\n"
        f"  Total Billed: ₹{summary['total_billed']:,.0f}\n"
        f"  Total Profit: ₹{summary['total_profit']:,.0f}\n"
        f"  Avg Profit %: {summary['avg_profit_pct']:.1f}%\n"
        f"  By Status: {summary['by_status']}\n"
        f"  By Client: {summary['by_client']}\n"
        f"  By Health: {summary['by_health']}\n\n"
        f"PROJECTS:\n" + "\n".join(project_lines) + "\n\n"
        "Use these section labels (each on its own line, plain text):\n"
        "Portfolio Overview:\nFinancial Performance:\nClient Breakdown:\nProject Health:\n"
        "Recommendations:\nAction Items:\n\n"
        "Be specific with numbers, executive-level tone, no preamble."
    )
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ]
    return await _try_chat(messages, max_tokens=2048, temperature=0.5)
