import httpx
from ..config import settings


OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

SYSTEM_PROMPT = """You are FinTrackAI, an expert financial project management assistant.
You help analyze project data from the Fintrack table which tracks client projects.

The Fintrack table has these fields:
- Client (Birla Open Minds, Maitrimetal, BG)
- Project Name (ZOHO, Pms, Innovine)
- Project Start Date, Duration (Months)
- Resource Count, Combined monthly salary of all the resources
- Amount Billed So far, Actual Profit, Profit percentage
- Target Revenue, Input cost so far, Total Overhead Cost
- Project Status (🟢 Active, ✅ Completed, ⏸️ On Hold, 🔴 Cancelled)
- Health (computed), Target Achieved, Revenue per Resource
- Resource contribution percentage

When given project data, analyze it clearly and concisely.
Be specific with numbers. Format currency in Indian Rupees (₹) when possible.
If asked to create/update projects, provide the exact field values in a structured JSON format.
Always be professional and insightful."""


async def chat_with_ai(message: str, history: list[dict], context: str = "") -> str:
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if context:
        messages.append({"role": "system", "content": f"Current project data context:\n{context}"})
    for h in history[-10:]:  # last 10 messages for context window
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": message})

    async with httpx.AsyncClient() as http:
        r = await http.post(
            OPENROUTER_API_URL,
            headers={
                "Authorization": f"Bearer {settings.openrouter_api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://fintrack-app.pages.dev",
                "X-Title": "FinTrack AI",
            },
            json={
                "model": settings.openrouter_model,
                "messages": messages,
                "max_tokens": 1024,
                "temperature": 0.7,
            },
            timeout=60,
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]


async def autofill_project(description: str) -> dict:
    prompt = f"""A user described a project as: "{description}"

Extract and return ONLY a JSON object with these fields (use null for missing info):
{{
  "client": "one of: Birla Open Minds, Maitrimetal, BG, or null",
  "project_name": "one of: ZOHO, Pms, Innovine, or null",
  "project_start_date": "ISO 8601 date or null",
  "duration_months": "number as string or null",
  "resource_count": "integer or null",
  "combined_monthly_salary": "number or null",
  "amount_billed": "number or null",
  "project_status": "one of: active, completed, on hold, cancelled, or null",
  "resource_contribution_pct": "number 0-100 or null"
}}

Return ONLY the JSON. No explanation."""

    async with httpx.AsyncClient() as http:
        r = await http.post(
            OPENROUTER_API_URL,
            headers={
                "Authorization": f"Bearer {settings.openrouter_api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://fintrack-app.pages.dev",
                "X-Title": "FinTrack AI",
            },
            json={
                "model": settings.openrouter_model,
                "messages": [
                    {"role": "system", "content": "You are a data extraction assistant. Return only valid JSON."},
                    {"role": "user", "content": prompt},
                ],
                "max_tokens": 512,
                "temperature": 0.1,
            },
            timeout=60,
        )
        r.raise_for_status()
        import json, re
        content = r.json()["choices"][0]["message"]["content"]
        # Extract JSON from response
        match = re.search(r'\{.*\}', content, re.DOTALL)
        if match:
            return json.loads(match.group())
        return {}


async def analyze_project(project_fields: dict) -> str:
    project_text = "\n".join(f"  {k}: {v}" for k, v in project_fields.items() if v is not None)
    prompt = f"""Analyze this Fintrack project and provide:
1. Overall health assessment
2. Key financial metrics interpretation
3. Risk factors (if any)
4. Specific recommendations to improve profitability
5. Whether the project is on track to meet targets

Project data:
{project_text}

Be concise, specific, and actionable."""

    return await chat_with_ai(prompt, [])


async def generate_report(summary: dict, records: list[dict]) -> str:
    projects_text = ""
    for r in records:
        f = r.get("fields", {})
        projects_text += f"\n- {f.get('Client')} / {f.get('Project Name')}: Status={f.get('Project Status')}, Billed=₹{f.get('Amount Billed So far', 0):,.0f}, Profit%={f.get('Profit percentage', 'N/A')}, Health={f.get('Health', 'N/A')}"

    prompt = f"""Generate a comprehensive executive report for the Fintrack portfolio:

SUMMARY STATS:
- Total Projects: {summary['total_projects']}
- Total Billed: ₹{summary['total_billed']:,.2f}
- Total Profit: ₹{summary['total_profit']:,.2f}
- Avg Profit %: {summary['avg_profit_pct']:.1f}%
- By Status: {summary['by_status']}
- By Client: {summary['by_client']}
- By Health: {summary['by_health']}

INDIVIDUAL PROJECTS:{projects_text}

Write a professional executive summary with:
1. Portfolio Overview
2. Financial Performance
3. Client-wise breakdown
4. Top performing & underperforming projects
5. Strategic recommendations
6. Action items

Format with clear sections and bullet points."""

    return await chat_with_ai(prompt, [])
