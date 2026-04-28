import httpx
import json
import re
from ..config import settings

OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

# Models ordered to prefer ones that DON'T dump chain-of-thought into the
# response body. Reasoning-heavy models (nemotron-super) are last because their
# raw reasoning leaks into output even with reasoning:exclude.
FALLBACK_MODELS = [
    "meta-llama/llama-3.3-70b-instruct:free",   # reliable, no reasoning leak
    "google/gemini-2.0-flash-exp:free",         # fast, clean prose
    "meta-llama/llama-3.1-8b-instruct:free",
    "mistralai/mistral-7b-instruct:free",
    "nvidia/llama-3.3-nemotron-super-49b-v1:free",
    "nvidia/nemotron-3-super-120b-a12b:free",   # last — known reasoning leakage
]

SYSTEM_PROMPT = """You are FinTrackAI, a sharp financial analyst for a project management company. You have live access to the full Fintrack database.

CRITICAL — RESPONSE FORMAT (non-negotiable):
- NEVER show your thinking, planning, or reasoning process in the response.
- NEVER write phrases like "Let me check…", "We need to…", "The user wants…", "Looking at the data…", "Let me parse…", "First I'll…", "Let me structure…".
- NEVER repeat or reference the data dump or the prompt back to the user.
- DO NOT acknowledge the question — just answer it directly.
- Start your response with the actual answer. The first character must be part of the user-facing answer, not meta-commentary.

FORMATTING RULES:
- Write in clean, plain prose. No markdown dashes or hyphens for lists.
- Use numbered lists (1. 2. 3.) when listing multiple items.
- Use section labels like "Overview:", "Risk:", "Recommendation:" on their own line in plain text — no ## or ** symbols.
- Never use asterisks, pound signs, or backticks.
- Currency always in ₹. Use shorthand for large numbers: ₹2.5L (lakhs), ₹1.2Cr (crores).
- Keep answers focused and direct. No filler phrases like "Certainly!" or "Great question!".
- If the data clearly shows a number, state it. Don't hedge unnecessarily.

The database tracks TWO separate tables:

Projects table: Client, Project Name (Innovine, PMS, Maitrimetal), Amount Billed So far,
Actual Profit, Profit %, Target Revenue, Input Cost, Overhead Cost, Project Status,
Health (🟢/🟡/🔴), Target Achieved, Resource Count, Duration.

Invoice Tracking table: Invoice Number, Project, Category, Description, Milestone,
Raised By, Raised Date, Cleared Date, Amount Raised, Amount with Tax (18% GST),
Amount Received, Payment Status (Paid/Pending/Cancelled), Outstanding Amount,
Days To Clear, Aging (days since raised), Speed (🟢 Fast/🟡 Normal/🔴 Slow),
Next Followup date. Use this table when the user asks about invoices, payments,
collection rate, outstanding amounts, or specific invoice numbers."""


_META_PATTERN = re.compile(
    r'^(okay[,\s]|alright[,\s]|let me |let us |let\'s |'
    r'i (should|need|will|can|must|have to|am going to)|'
    r'we (need|should|must|will|can|have)|'
    r'we\'?ll |we\'?re |'
    r'the user (is|wants|asked|has|likely)|'
    r'looking at |checking |scanning |reviewing |'
    r'first[,\s]|now[,\s]|so[,\s]|then[,\s]|'
    r'important (note|to|that)|must avoid|'
    r'i should present|let me structure|let me think|'
    r'likely (they|the user)|'
    r'(invoice|project|data) records?\b|'
    r'\bparse\b|here is|here\'?s the|'
    r'hmm[,\s]|wait[,\s])',
    re.IGNORECASE
)

# Lines that look like inline reasoning even mid-text
_REASONING_LINE = re.compile(
    r'^(let me |let\'?s |we need to |i need to |i should |'
    r'looking at|so the|so we|we have|so let|first,?|'
    r'wait,?|hmm,?|actually,?|but the user)',
    re.IGNORECASE
)


def _strip_reasoning(content: str) -> str:
    """
    Strip chain-of-thought reasoning from model output.

    Strategy:
    1. Remove <think>/<reasoning>/<thought> XML blocks (DeepSeek R1, Qwen3, Nemotron).
    2. If the response starts with raw reasoning paragraphs (no tags), find
       the LAST paragraph that looks like meta-reasoning and discard everything
       up to and including it — keeping only the actual answer that follows.
    3. As a last-resort safety net: if more than 30% of paragraphs match
       reasoning patterns, the whole response is suspect — try to extract just
       the trailing prose-looking section.
    """
    # 1. XML-tagged thinking blocks
    content = re.sub(r'<think(?:ing)?>.*?</think(?:ing)?>', '', content, flags=re.DOTALL | re.IGNORECASE)
    content = re.sub(r'<reasoning>.*?</reasoning>', '', content, flags=re.DOTALL | re.IGNORECASE)
    content = re.sub(r'<thought>.*?</thought>', '', content, flags=re.DOTALL | re.IGNORECASE)

    # 2. Walk paragraphs; find last meta paragraph
    paragraphs = re.split(r'\n{2,}', content.strip())
    last_meta = -1
    for idx, para in enumerate(paragraphs):
        s = para.strip()
        if not s:
            continue
        first_line = s.splitlines()[0].strip()
        # Match if the paragraph opens with a meta-phrase
        if _META_PATTERN.match(first_line):
            last_meta = idx
            continue
        # Also match if any line in a short paragraph is reasoning-like
        # (but only for paragraphs in the first half of the response)
        if idx < len(paragraphs) // 2:
            for line in s.splitlines()[:3]:
                if _REASONING_LINE.match(line.strip()):
                    last_meta = idx
                    break

    if last_meta >= 0 and last_meta < len(paragraphs) - 1:
        content = '\n\n'.join(paragraphs[last_meta + 1:])

    return content.strip()


def _make_headers():
    return {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://fintrack-app-beta.vercel.app",
        "X-Title": "FinTrack AI",
    }


def _format_records_context(records: list[dict]) -> str:
    """Format all project records as structured context for the AI."""
    if not records:
        return "No project records found."

    lines = ["=== LIVE PROJECT DATA ===\n"]
    currency_fields = {
        'Amount Billed So far', 'Actual Profit', 'Target Revenue',
        'Input cost so far', 'Total Overhead Cost',
        'Combined monthly salary of all the resources', 'Revenue per Resource',
    }

    for i, rec in enumerate(records, 1):
        f = rec.get("fields", {})
        lines.append(f"[Project {i}] {f.get('Client', '?')} / {f.get('Project Name', '?')}")
        lines.append(f"  Status: {f.get('Project Status', 'N/A')}")
        lines.append(f"  Health: {f.get('Health', 'N/A')}")
        lines.append(f"  Duration: {f.get('Duration (Months)', 'N/A')} months")
        lines.append(f"  Resources: {f.get('Resource Count', 'N/A')}")
        lines.append(f"  Target Achieved: {f.get('Target Achieved', 'N/A')}")

        for field in ['Amount Billed So far', 'Target Revenue', 'Actual Profit',
                      'Input cost so far', 'Total Overhead Cost',
                      'Combined monthly salary of all the resources']:
            val = f.get(field)
            if val is not None:
                try:
                    lines.append(f"  {field}: ₹{float(val):,.0f}")
                except (ValueError, TypeError):
                    lines.append(f"  {field}: {val}")

        pct = f.get('Profit percentage')
        if pct is not None:
            lines.append(f"  Profit %: {float(pct):.2f}%")

        contrib = f.get('Resource contribution percentage')
        if contrib is not None:
            lines.append(f"  Resource Contribution: {contrib}%")

        lines.append("")  # blank line between projects

    return "\n".join(lines)


def _short_model_name(model_id: str) -> str:
    """Strip provider prefix and :free suffix for UI display."""
    return model_id.split("/")[-1].replace(":free", "")


async def _try_chat(messages: list[dict], max_tokens: int = 1024, temperature: float = 0.65) -> dict:
    """Try each model in FALLBACK_MODELS until one succeeds.

    Returns {"content": str, "model": str, "model_short": str}.
    Raises ValueError on hard failure (quota/auth) or after exhausting all models.
    """
    primary = settings.openrouter_model
    # Deduplicate preserving order — primary first, then fallbacks
    seen = set()
    ordered = []
    for m in [primary] + FALLBACK_MODELS:
        if m and m not in seen:
            seen.add(m)
            ordered.append(m)

    errors: list[str] = []
    async with httpx.AsyncClient() as http:
        for model in ordered:
            try:
                r = await http.post(
                    OPENROUTER_API_URL,
                    headers=_make_headers(),
                    json={
                        "model": model,
                        "messages": messages,
                        "max_tokens": max_tokens,
                        "temperature": temperature,
                        # Belt & suspenders: ask the API to drop reasoning from
                        # the response. Models that don't support this just
                        # ignore the field.
                        "reasoning": {"exclude": True},
                    },
                    timeout=60,
                )
                if r.status_code == 402:
                    raise ValueError("OpenRouter quota exceeded — check your free tier limits at openrouter.ai")
                if r.status_code == 401:
                    raise ValueError("Invalid OPENROUTER_API_KEY — check your HF Space secrets")
                if r.status_code == 429:
                    errors.append(f"{_short_model_name(model)}: rate-limited")
                    continue
                if r.status_code >= 400:
                    try:
                        data = r.json()
                        err = data.get("error", {})
                        err_msg = err.get("message", r.text) if isinstance(err, dict) else str(err)
                    except Exception:
                        err_msg = r.text[:200]
                    # Model-specific error → try next
                    if r.status_code in (400, 404, 422) or "model" in err_msg.lower():
                        errors.append(f"{_short_model_name(model)}: {err_msg[:120]}")
                        continue
                    raise ValueError(f"OpenRouter error ({r.status_code}): {err_msg}")

                data = r.json()
                if "error" in data:
                    err = data["error"]
                    err_msg = err.get("message", str(err)) if isinstance(err, dict) else str(err)
                    if "model" in err_msg.lower() or "not found" in err_msg.lower():
                        errors.append(f"{_short_model_name(model)}: {err_msg[:120]}")
                        continue
                    raise ValueError(f"OpenRouter error: {err_msg}")

                content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                if content and content.strip():
                    content = _strip_reasoning(content)
                    if content.strip():
                        return {
                            "content": content,
                            "model": model,
                            "model_short": _short_model_name(model),
                        }
                errors.append(f"{_short_model_name(model)}: empty response")

            except (httpx.TimeoutException, httpx.ConnectError) as e:
                errors.append(f"{_short_model_name(model)}: timeout/network")
                continue
            except ValueError:
                raise
            except Exception as e:
                errors.append(f"{_short_model_name(model)}: {str(e)[:100]}")
                continue

    raise ValueError(
        "All AI models are unavailable right now. Tried: "
        + "; ".join(errors) if errors else "No models configured."
    )


async def chat_with_ai(message: str, history: list[dict], context: str = "") -> dict:
    """Returns {"content": str, "model": str, "model_short": str}."""
    if not settings.openrouter_api_key:
        raise ValueError("OPENROUTER_API_KEY is not configured. Add it to HF Space secrets.")

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if context:
        messages.append({"role": "system", "content": context})
    for h in history[-12:]:
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": message})

    return await _try_chat(messages, max_tokens=1024, temperature=0.65)


async def autofill_project(description: str) -> dict:
    if not settings.openrouter_api_key:
        raise ValueError("OPENROUTER_API_KEY is not configured.")

    prompt = f"""Extract project fields from this description: "{description}"

Return ONLY a valid JSON object (no explanation, no markdown):
{{
  "client": "one of: Birla Open Minds, Maitrimetal, BG — or null",
  "project_name": "one of: ZOHO, Pms, Innovine — or null",
  "project_start_date": "YYYY-MM-DD or null",
  "duration_months": number_or_null,
  "resource_count": integer_or_null,
  "combined_monthly_salary": number_or_null,
  "amount_billed": number_or_null,
  "project_status": "one of: 🟢 Active, ✅ Completed, ⏸️ On Hold, 🔴 Cancelled — or null",
  "resource_contribution_pct": number_0_to_100_or_null
}}"""

    messages = [
        {"role": "system", "content": "You are a JSON extraction assistant. Return only valid JSON with no markdown code blocks."},
        {"role": "user", "content": prompt},
    ]

    result = await _try_chat(messages, max_tokens=512, temperature=0.05)
    content = result["content"].strip()
    # Strip markdown code blocks if model added them
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
    if not settings.openrouter_api_key:
        raise ValueError("OPENROUTER_API_KEY is not configured.")

    lines = []
    currency_fields = {
        'Amount Billed So far', 'Actual Profit', 'Target Revenue',
        'Input cost so far', 'Total Overhead Cost', 'Combined monthly salary of all the resources',
        'Revenue per Resource',
    }
    for k, v in project_fields.items():
        if v is None:
            continue
        if k in currency_fields:
            try:
                lines.append(f"  {k}: ₹{float(v):,.0f}")
            except (ValueError, TypeError):
                lines.append(f"  {k}: {v}")
        else:
            lines.append(f"  {k}: {v}")

    prompt = f"""Analyze this project and provide a concise, actionable assessment:

{chr(10).join(lines)}

Structure your response as:
1. **Health Summary** (1-2 sentences)
2. **Key Financial Metrics** (interpret the numbers)
3. **Risks** (if any — be specific)
4. **Recommendations** (2-3 actionable items)
5. **Target Status** (on/off track and why)"""

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ]
    return await _try_chat(messages, max_tokens=1024, temperature=0.65)


async def generate_report(summary: dict, records: list[dict]) -> dict:
    if not settings.openrouter_api_key:
        raise ValueError("OPENROUTER_API_KEY is not configured.")

    projects_text = ""
    for r in records:
        f = r.get("fields", {})
        billed = float(f.get('Amount Billed So far') or 0)
        profit = float(f.get('Profit percentage') or 0)
        projects_text += (
            f"\n• {f.get('Client')} / {f.get('Project Name')}: "
            f"Status={f.get('Project Status')}, "
            f"Billed=₹{billed:,.0f}, "
            f"Profit={profit:.1f}%, "
            f"Health={f.get('Health', 'N/A')}"
        )

    prompt = f"""Write a professional executive report for the Fintrack portfolio:

PORTFOLIO SUMMARY:
- Total Projects: {summary['total_projects']}
- Total Billed: ₹{summary['total_billed']:,.0f}
- Total Profit: ₹{summary['total_profit']:,.0f}
- Avg Profit %: {summary['avg_profit_pct']:.1f}%
- By Status: {summary['by_status']}
- By Client: {summary['by_client']}
- By Health: {summary['by_health']}

PROJECTS:{projects_text}

Write with these sections:
## Portfolio Overview
## Financial Performance
## Client Breakdown
## Project Health
## Recommendations
## Action Items

Use bullet points, be specific with numbers, and keep it executive-level."""

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ]
    return await _try_chat(messages, max_tokens=2048, temperature=0.65)
