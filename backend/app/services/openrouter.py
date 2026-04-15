import httpx
import json
import re
from ..config import settings

OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

SYSTEM_PROMPT = """You are FinTrackAI, an expert financial project management assistant.
You help analyze project data from the Fintrack table which tracks client projects.

The Fintrack table fields:
- Client: Birla Open Minds, Maitrimetal, BG
- Project Name: ZOHO, Pms, Innovine
- Project Start Date, Duration (Months), Resource Count
- Combined monthly salary of all the resources
- Amount Billed So far, Actual Profit, Profit percentage
- Target Revenue, Input cost so far, Total Overhead Cost
- Project Status: 🟢 Active, ✅ Completed, ⏸️ On Hold, 🔴 Cancelled
- Health (computed), Target Achieved, Revenue per Resource
- Resource contribution percentage

Rules:
- Always format currency in Indian Rupees (₹)
- Use lakhs/crores for large numbers (e.g. ₹2.5L, ₹1.2Cr)
- Be concise, specific, and data-driven
- When asked for comparisons, structure the response clearly
- For risk analysis, be direct about which projects are underperforming"""


def _make_headers():
    return {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://fintrack-app.vercel.app",
        "X-Title": "FinTrack AI",
    }


async def chat_with_ai(message: str, history: list[dict], context: str = "") -> str:
    if not settings.openrouter_api_key:
        raise ValueError("OPENROUTER_API_KEY is not configured. Add it to HF Space secrets.")

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if context:
        messages.append({"role": "system", "content": f"Live project data:\n{context}"})
    for h in history[-12:]:
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": message})

    async with httpx.AsyncClient() as http:
        r = await http.post(
            OPENROUTER_API_URL,
            headers=_make_headers(),
            json={
                "model": settings.openrouter_model,
                "messages": messages,
                "max_tokens": 1024,
                "temperature": 0.65,
            },
            timeout=60,
        )
        if r.status_code == 402:
            raise ValueError("OpenRouter quota exceeded — check your free tier limits at openrouter.ai")
        if r.status_code == 401:
            raise ValueError("Invalid OPENROUTER_API_KEY — check your HF Space secrets")
        r.raise_for_status()
        data = r.json()
        if "error" in data:
            raise ValueError(f"OpenRouter error: {data['error'].get('message', str(data['error']))}")
        return data["choices"][0]["message"]["content"]


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

    async with httpx.AsyncClient() as http:
        r = await http.post(
            OPENROUTER_API_URL,
            headers=_make_headers(),
            json={
                "model": settings.openrouter_model,
                "messages": [
                    {"role": "system", "content": "You are a JSON extraction assistant. Return only valid JSON with no markdown code blocks."},
                    {"role": "user", "content": prompt},
                ],
                "max_tokens": 512,
                "temperature": 0.05,
            },
            timeout=45,
        )
        r.raise_for_status()
        content = r.json()["choices"][0]["message"]["content"].strip()
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


async def analyze_project(project_fields: dict) -> str:
    if not settings.openrouter_api_key:
        raise ValueError("OPENROUTER_API_KEY is not configured.")

    # Format fields nicely
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
            lines.append(f"  {k}: ₹{float(v):,.0f}")
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

    return await chat_with_ai(prompt, [])


async def generate_report(summary: dict, records: list[dict]) -> str:
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

    return await chat_with_ai(prompt, [])
