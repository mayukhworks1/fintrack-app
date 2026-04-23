import httpx
import json
import re
from ..config import settings

OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

# Try primary model first, fall back to confirmed working models
FALLBACK_MODELS = [
    "nvidia/nemotron-3-super-120b-a12b:free",   # user's preferred
    "nvidia/llama-3.3-nemotron-super-49b-v1:free",
    "meta-llama/llama-3.1-8b-instruct:free",
    "mistralai/mistral-7b-instruct:free",
]

SYSTEM_PROMPT = """You are FinTrackAI, a sharp financial analyst for a project management company. You have live access to the full Fintrack database.

FORMATTING RULES — follow these strictly:
- Write in clean, plain prose. No markdown dashes or hyphens for lists.
- Use numbered lists (1. 2. 3.) when listing multiple items.
- Use section labels like "Overview:", "Risk:", "Recommendation:" on their own line in plain text — no ## or ** symbols.
- Never use asterisks, pound signs, or backticks.
- Currency always in ₹. Use shorthand for large numbers: ₹2.5L (lakhs), ₹1.2Cr (crores).
- Keep answers focused and direct. No filler phrases like "Certainly!" or "Great question!".
- If the data clearly shows a number, state it. Don't hedge unnecessarily.

The database tracks:
Client (Birla Open Minds, Maitrimetal, BG), Project Name (ZOHO, Pms, Innovine),
Amount Billed So far, Actual Profit, Profit %, Target Revenue, Input Cost,
Overhead Cost, Project Status, Health (🟢/🟡/🔴), Target Achieved, Resource Count, Duration."""


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
