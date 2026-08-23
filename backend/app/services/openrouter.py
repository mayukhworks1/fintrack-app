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
import base64
import io
import json
import re
import time
from dataclasses import dataclass
from typing import AsyncIterator
from typing import Any, Optional

import httpx
from ..utils.http import shared_client

from ..config import settings

OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
ANSWER_OPEN  = "===ANSWER==="
ANSWER_CLOSE = "===END==="

RESPONSE_MODE_INSTRUCTIONS = {
    "brief": "Keep the response concise and decision-first. Use at most 6 short bullets or short sections.",
    "detailed": "Give a clear structured answer with sections, supporting numbers, and concrete next steps.",
    "board": "Write in executive board style with Overview, Pressure Points, and Action lines. Optimise for leadership readability.",
}


# ── Model registry ────────────────────────────────────────────────────
@dataclass(frozen=True)
class ModelSpec:
    id: str
    leakage: int           # 0 = clean, 5 = leaks heavily
    supports_reasoning_param: bool = False
    notes: str = ""


# Ordered preference list — regularly pruned to only include models with
# live endpoints on OpenRouter free tier. Remove any model that starts
# returning "No endpoints found" and replace with a working alternative.
MODELS: list[ModelSpec] = [
    # ── Tier 1: large, clean, reliably available ──────────────────────
    ModelSpec("meta-llama/llama-4-scout:free",                   leakage=0,
              notes="Fast, vision-capable"),
    ModelSpec("meta-llama/llama-4-maverick:free",                leakage=0,
              notes="128K ctx, vision-capable"),
    ModelSpec("meta-llama/llama-3.3-70b-instruct:free",          leakage=0),
    ModelSpec("deepseek/deepseek-chat-v3-0324:free",             leakage=0),
    ModelSpec("google/gemini-2.5-pro-exp-03-25:free",            leakage=0,
              notes="Vision-capable, generous context"),
    # ── Tier 2: good but sometimes busy ──────────────────────────────
    ModelSpec("qwen/qwen3-235b-a22b:free",                       leakage=1),
    ModelSpec("qwen/qwen3-30b-a3b:free",                         leakage=0),
    ModelSpec("qwen/qwen2.5-vl-72b-instruct:free",               leakage=0,
              notes="Vision-capable"),
    ModelSpec("deepseek/deepseek-r1:free",                       leakage=2,
              notes="Reasoning model — may include <think> blocks"),
    ModelSpec("microsoft/phi-4:free",                            leakage=0),
    ModelSpec("mistralai/mistral-small-3.1-24b-instruct:free",   leakage=0),
    # ── Tier 3: last resort ───────────────────────────────────────────
    ModelSpec("nvidia/nemotron-3-super-120b-a12b:free",          leakage=5,
              supports_reasoning_param=True,
              notes="Heavy reasoning leakage — last resort only"),
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


# ── Vision-capable models (support image_url content blocks) ──────────
VISION_MODEL_IDS = {
    "meta-llama/llama-4-maverick:free",
    "meta-llama/llama-4-scout:free",
    "google/gemini-2.5-pro-exp-03-25:free",
    "qwen/qwen2.5-vl-72b-instruct:free",
    # Legacy — kept in case they come back
    "google/gemini-2.0-flash-exp:free",
    "meta-llama/llama-3.2-90b-vision-instruct:free",
    "qwen/qwen-2-vl-7b-instruct:free",
}

def _vision_models_first() -> list[ModelSpec]:
    """Return model list with vision-capable models at the front."""
    ordered = _ordered_models()
    vision  = [m for m in ordered if m.id in VISION_MODEL_IDS]
    others  = [m for m in ordered if m.id not in VISION_MODEL_IDS]
    return vision + others


# ── System prompt — strict, explicit, single-purpose ──────────────────
SYSTEM_PROMPT = f"""You are FinTrackAI, a financial and delivery analyst for a project management company. You have live access to three tables:

PROJECTS — Client, Project Name (Innovine, PMS, Maitrimetal etc), Amount Billed, Actual Profit, Profit %, Target Revenue, Input/Overhead Cost, Status, Health, Resource Count, Duration.

INVOICES — Invoice Number, Project, Category, Description, Milestone, Raised By, Raised Date, Cleared Date, Amount Raised, Amount with Tax (18% GST), Amount Received, Payment Status (Paid/Pending/Cancelled), Outstanding Amount, Days To Clear, Aging, Speed, Next Followup.

CURRENT STATUS — Client, Project, Status, Short Status, Current Status (Detailed), and last modified time. Treat this as the live delivery-truth table for what is happening right now across the portfolio.

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
- When the user asks about blockers, delivery, holds, pending inputs, client delays, or "status board", prioritise CURRENT STATUS over generic project assumptions.
- Never say "Let me", "We need to", "Looking at", "I'll", "Sentence 1:", "Step 1:", "Based on", "Here is", "First,", "Output:".

GROUNDING RULES — always follow:
- All figures you cite must appear in the provided portfolio context. Never invent or interpolate numbers.
- The context block begins with "Data last synced: <timestamp>". Mention it only when the user asks about data currency or when the sync is older than 30 minutes.
- If the context block is missing financial data entirely (no projects, no invoices), say "No portfolio data is available right now" — do not fabricate figures.

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
def _meter(model: str, started: float, tokens: dict | None = None,
           ok: bool = True, error: str | None = None) -> None:
    """
    Record one model attempt.

    Imported lazily to keep this module free of a database dependency: the
    OpenRouter client is used by tests and scripts that never open a pool, and
    accounting must never be the reason a model call fails.
    """
    try:
        from . import ai_usage
        ai_usage.record(
            model=model,
            latency_ms=int((time.time() - started) * 1000),
            tokens=tokens if isinstance(tokens, dict) else None,
            ok=ok,
            error=error,
        )
    except Exception:
        pass


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
        _http_client = shared_client(
            timeout=httpx.Timeout(180.0, connect=10.0),
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


async def _stream_post_with_retries(payload: dict, retries: int = 1) -> httpx.Response:
    """Open a streaming POST with one short retry on transient failures."""
    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            req = _client().build_request("POST", OPENROUTER_API_URL, headers=_make_headers(), json=payload)
            resp = await _client().send(req, stream=True)
            if resp.status_code >= 500 and attempt < retries:
                await resp.aclose()
                await asyncio.sleep(0.6 * (2 ** attempt))
                continue
            return resp
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
    models: list[ModelSpec] | None = None,
) -> dict:
    """
    Try each model in order until one returns usable content.

    Returns {"content": str, "model": str, "model_short": str}.
    Raises ValueError on hard failure (auth/quota) or after exhausting all models.
    """
    if not settings.openrouter_api_key:
        raise ValueError("OPENROUTER_API_KEY is not configured. Add it to HF Space secrets.")

    errors: list[str] = []

    for spec in (models if models is not None else _ordered_models()):
        attempt_started = time.time()
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
                # One short backoff retry before skipping to the next model
                await asyncio.sleep(1.2)
                r2 = await _post_with_retries(payload, retries=1)
                if r2.status_code == 429:
                    errors.append(f"{_short(spec.id)}: rate-limited")
                    continue
                r = r2  # use the retried response below
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
                _meter(spec.id, attempt_started, ok=False,
                       error="response had no extractable answer")
                errors.append(f"{_short(spec.id)}: response had no extractable answer")
                continue

            _meter(spec.id, attempt_started, tokens=data.get("usage"), ok=True)
            return {"content": content, "model": spec.id, "model_short": _short(spec.id)}

        except (httpx.TimeoutException, httpx.ConnectError):
            _meter(spec.id, attempt_started, ok=False, error="timeout/network")
            errors.append(f"{_short(spec.id)}: timeout/network")
            continue
        except ValueError:
            raise
        except Exception as e:
            _meter(spec.id, attempt_started, ok=False, error=str(e))
            errors.append(f"{_short(spec.id)}: {str(e)[:100]}")
            continue

    raise ValueError(
        ("All AI models are unavailable right now. Tried: " + "; ".join(errors))
        if errors else "No models configured."
    )


async def stream_chat_with_ai(
    message: str,
    history: list[dict],
    context: str = "",
    response_mode: str = "brief",
    temperature: float | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """
    Stream chat deltas as {"type": "delta", "delta": "..."} events and finish
    with {"type": "done", "content": "...", "model": "...", "model_short": "..."}.
    """
    if not settings.openrouter_api_key:
        raise ValueError("OPENROUTER_API_KEY is not configured. Add it to HF Space secrets.")

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    mode_instruction = RESPONSE_MODE_INSTRUCTIONS.get(response_mode or "brief")
    if mode_instruction:
        messages.append({"role": "system", "content": mode_instruction})
    if context:
        messages.append({"role": "system", "content": context})
    for h in history[-12:]:
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": message})

    errors: list[str] = []

    for spec in _ordered_models():
        resp: httpx.Response | None = None
        try:
            payload: dict[str, Any] = {
                "model": spec.id,
                "messages": messages,
                "max_tokens": 1024,
                "temperature": 0.5 if temperature is None else temperature,
                "stream": True,
            }
            if spec.supports_reasoning_param:
                payload["reasoning"] = {"exclude": True}

            resp = await _stream_post_with_retries(payload)

            if resp.status_code == 401:
                raise ValueError("Invalid OPENROUTER_API_KEY — check your HF Space secrets")
            if resp.status_code == 402:
                raise ValueError("OpenRouter quota exceeded — check free-tier limits")
            if resp.status_code >= 400:
                body = await resp.aread()
                text = body.decode("utf-8", errors="ignore")[:200]
                if resp.status_code in (400, 404, 422, 429) or "model" in text.lower():
                    errors.append(f"{_short(spec.id)}: {text or ('HTTP ' + str(resp.status_code))}")
                    await resp.aclose()
                    continue
                raise ValueError(f"OpenRouter error ({resp.status_code}): {text}")

            full_raw = ""
            emitted = ""
            opened = False
            closed = False

            async for line in resp.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    payload = json.loads(data)
                except json.JSONDecodeError:
                    continue

                delta = (
                    payload.get("choices", [{}])[0]
                    .get("delta", {})
                    .get("content", "")
                ) or ""
                if not delta:
                    continue

                full_raw += delta

                if not opened:
                    idx = full_raw.find(ANSWER_OPEN)
                    if idx == -1:
                        continue
                    opened = True
                    full_raw = full_raw[idx + len(ANSWER_OPEN):]

                if ANSWER_CLOSE in full_raw:
                    full_raw = full_raw.split(ANSWER_CLOSE, 1)[0]
                    closed = True

                if len(full_raw) > len(emitted):
                    chunk = full_raw[len(emitted):]
                    emitted = full_raw
                    if chunk:
                        yield {"type": "delta", "delta": chunk}

                if closed:
                    break

            final_content = _extract_answer(full_raw if opened else full_raw or emitted).strip()
            if not final_content:
                errors.append(f"{_short(spec.id)}: response had no extractable answer")
                await resp.aclose()
                continue

            if final_content != emitted:
                tail = final_content[len(emitted):]
                if tail:
                    yield {"type": "delta", "delta": tail}

            yield {
                "type": "done",
                "content": final_content,
                "model": spec.id,
                "model_short": _short(spec.id),
            }
            await resp.aclose()
            return

        except (httpx.TimeoutException, httpx.ConnectError):
            errors.append(f"{_short(spec.id)}: timeout/network")
            if resp is not None:
                await resp.aclose()
            continue
        except ValueError:
            if resp is not None:
                await resp.aclose()
            raise
        except Exception as e:
            errors.append(f"{_short(spec.id)}: {str(e)[:100]}")
            if resp is not None:
                await resp.aclose()
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
            try:
                raw = float(pct)
                # Teable stores profit % as a decimal fraction (0.4479 = 44.79%)
                pct_display = raw * 100 if 0 < raw < 2.0 else raw
                lines.append(f"  Profit %: {pct_display:.2f}%")
            except (ValueError, TypeError): pass
        contrib = f.get('Resource contribution percentage')
        if contrib is not None:
            lines.append(f"  Resource Contribution: {contrib}%")
        lines.append("")
    return "\n".join(lines)


def format_chat_records_context(records: list[dict], limit: int = 120) -> str:
    """Compact one-line-per-project context for chat to keep prompts fast."""
    if not records:
        return "No project records found."
    lines = ["=== LIVE PROJECT DATA ==="]
    for i, rec in enumerate(records[:limit], 1):
        f = rec.get("fields", {})
        billed = f.get("Amount Billed So far")
        profit = f.get("Actual Profit")
        margin = f.get("Profit percentage")
        target = f.get("Target Revenue")
        parts = [
            f"[Project {i}] {f.get('Client', '?')} / {f.get('Project Name', '?')}",
            f"Status {f.get('Project Status', 'N/A')}",
            f"Health {f.get('Health', 'N/A')}",
        ]
        if billed not in (None, ""):
            try: parts.append(f"Billed ₹{float(billed):,.0f}")
            except (ValueError, TypeError): pass
        if profit not in (None, ""):
            try: parts.append(f"Profit ₹{float(profit):,.0f}")
            except (ValueError, TypeError): pass
        if margin not in (None, ""):
            try:
                raw = float(margin)
                margin_display = raw * 100 if 0 < raw < 2.0 else raw
                parts.append(f"Margin {margin_display:.1f}%")
            except (ValueError, TypeError): pass
        if target not in (None, ""):
            try: parts.append(f"Target ₹{float(target):,.0f}")
            except (ValueError, TypeError): pass
        if f.get("Target Achieved") not in (None, ""):
            parts.append(f"Target Achieved {f.get('Target Achieved')}")
        lines.append(" | ".join(parts))
    return "\n".join(lines)


# ── Public API ────────────────────────────────────────────────────────
async def chat_with_ai(message: str, history: list[dict], context: str = "") -> dict:
    """Chat with full DB context. Returns extracted user-facing content."""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.append({"role": "system", "content": RESPONSE_MODE_INSTRUCTIONS["brief"]})
    if context:
        messages.append({"role": "system", "content": context})
    for h in history[-12:]:
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": message})
    return await _try_chat(messages, max_tokens=1024, temperature=0.5)


async def chat_with_ai_tuned(
    message: str,
    history: list[dict],
    context: str = "",
    response_mode: str = "brief",
    temperature: float | None = None,
) -> dict:
    """Chat with explicit response-mode and temperature controls."""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    mode_instruction = RESPONSE_MODE_INSTRUCTIONS.get(response_mode or "brief")
    if mode_instruction:
        messages.append({"role": "system", "content": mode_instruction})
    if context:
        messages.append({"role": "system", "content": context})
    for h in history[-12:]:
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": message})
    max_tokens = 1300 if response_mode == "board" else 1024
    final_temp = 0.4 if temperature is None else temperature
    return await _try_chat(messages, max_tokens=max_tokens, temperature=final_temp)


async def judge_answer(
    message: str,
    answer: str,
    context: str = "",
) -> dict[str, Any]:
    """
    LLM-as-judge pass for analytical answers. Uses a low-temperature JSON check
    and can suggest a corrected answer when the first draft overclaims.
    """
    judge_context = context[:14000] if context else ""
    prompt = (
        "You are FinTrackAI Judge. Verify whether the draft answer is grounded in the supplied portfolio context. "
        "Return ONLY compact JSON with keys verdict, confidence, issues, corrected_answer. "
        "verdict must be 'pass' or 'soft-fail'. confidence must be 'high', 'medium', or 'low'. "
        "Use soft-fail if the draft invents figures, contradicts the context, or misses the requested output style. "
        "If soft-fail, provide a corrected_answer grounded strictly in context. Keep issues short."
    )
    payload = json.dumps({
        "question": message,
        "draft_answer": answer,
        "context": judge_context,
    }, ensure_ascii=False)
    result = await _try_chat(
        [
            {"role": "system", "content": prompt},
            {"role": "user", "content": payload},
        ],
        max_tokens=350,
        temperature=0.0,
        extract=False,
        models=[m for m in _ordered_models() if m.leakage <= 2][:4] or None,
    )
    raw = result.get("content", "").strip()
    try:
        start = raw.find("{")
        end = raw.rfind("}")
        parsed = json.loads(raw[start:end + 1] if start != -1 and end != -1 else raw)
        if isinstance(parsed, dict):
            return {
                "verdict": parsed.get("verdict") or "pass",
                "confidence": parsed.get("confidence") or "medium",
                "issues": parsed.get("issues") if isinstance(parsed.get("issues"), list) else [],
                "corrected_answer": parsed.get("corrected_answer") or "",
                "model": result.get("model_short") or result.get("model"),
            }
    except Exception:
        pass
    return {
        "verdict": "pass",
        "confidence": "medium",
        "issues": [],
        "corrected_answer": "",
        "model": result.get("model_short") or result.get("model"),
    }


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


def _extract_pdf_text(content: bytes) -> str:
    """Extract plain text from a PDF byte-string. Returns '' on failure or scanned PDF."""
    try:
        from pypdf import PdfReader  # type: ignore
        reader = PdfReader(io.BytesIO(content))
        parts: list[str] = []
        for page in reader.pages[:8]:  # cap at 8 pages
            t = page.extract_text()
            if t:
                parts.append(t)
        return "\n\n".join(parts).strip()
    except Exception:
        return ""


def _parse_indian_amount(s: str) -> float | None:
    """Convert Indian-format amount string to float: '1,60,000.00' → 160000.0"""
    try:
        return float(s.replace(",", "").strip())
    except (ValueError, AttributeError):
        return None


def _parse_indian_date(s: str) -> str | None:
    """Convert DD/MM/YYYY → YYYY-MM-DD. Returns None if parsing fails."""
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", s.strip())
    if m:
        return f"{m.group(3)}-{m.group(2).zfill(2)}-{m.group(1).zfill(2)}"
    return None


def _regex_extract_invoice(text: str) -> dict:
    """
    Fast regex-based extraction for TheWorks invoice format (and similar Indian tax invoices).
    Returns partial dict — AI fills any gaps. Keys use the same snake_case as InvoiceFields.
    """
    out: dict = {}

    # ── Invoice number ──────────────────────────────────────────────────────
    # Matches:  # WM/26-27/049  or  Invoice No: WM/26-27/049  or  No. WM-2526-001
    m = re.search(r'(?:^|\s)#\s*(WM/[\d/\-]+)', text)
    if not m:
        m = re.search(r'(?:invoice\s*(?:no|number|#)\s*[:\.]?\s*)([A-Z]{1,4}[/\-]\d[\d/\-]+)',
                      text, re.IGNORECASE)
    if m:
        out["invoice_number"] = m.group(1).strip()

    # ── Dates ───────────────────────────────────────────────────────────────
    # "Invoice Date : 30/04/2026" or "Invoice Date: 30/04/2026"
    m = re.search(r'Invoice\s*Date\s*[:\-]\s*(\d{1,2}/\d{1,2}/\d{4})', text, re.IGNORECASE)
    if m:
        d = _parse_indian_date(m.group(1))
        if d:
            out["raised_date"] = d

    # "Due Date : 15/05/2026" → use as next_followup hint if no followup set
    m = re.search(r'Due\s*Date\s*[:\-]\s*(\d{1,2}/\d{1,2}/\d{4})', text, re.IGNORECASE)
    if m:
        d = _parse_indian_date(m.group(1))
        if d:
            out["_due_date"] = d   # internal hint for the caller to map to next_followup

    # "Payment Date" or "Paid On"
    for pat in [r'(?:Payment|Paid|Cleared)\s*(?:Date|On)\s*[:\-]\s*(\d{1,2}/\d{1,2}/\d{4})',
                r'(\d{1,2}/\d{1,2}/\d{4})\s*(?:cleared|paid)']:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            d = _parse_indian_date(m.group(1))
            if d:
                out["cleared_date"] = d
                break

    # ── Amounts ─────────────────────────────────────────────────────────────
    # Sub Total (base, before GST)
    m = re.search(r'Sub\s*Total\s+([\d,]+\.\d{2})', text, re.IGNORECASE)
    if m:
        v = _parse_indian_amount(m.group(1))
        if v is not None:
            out["amount_raised"] = v

    # Total (after tax) — pick the largest "Total" line to avoid sub-items
    totals = re.findall(r'\bTotal\s+([\d,]+\.\d{2})', text, re.IGNORECASE)
    if totals:
        vals = [_parse_indian_amount(t) for t in totals if _parse_indian_amount(t) is not None]
        if vals:
            out["amount_with_tax"] = max(vals)  # largest Total = grand total

    # If no Sub Total found, infer base from total / 1.18 (18% GST)
    if "amount_with_tax" in out and "amount_raised" not in out:
        out["amount_raised"] = round(out["amount_with_tax"] / 1.18, 2)

    # ── Client / Project (Bill To section) ─────────────────────────────────
    m = re.search(r'Bill\s*To\s*\n(.+?)(?:\n(?:GSTIN|Place|GST|\d{6})|$)',
                  text, re.DOTALL | re.IGNORECASE)
    if m:
        client = m.group(1).strip().splitlines()[0].strip()
        if len(client) > 3:
            out["project"] = client

    # ── Description (first line-item description) ──────────────────────────
    # Format:  1  Website Development\nSome description\n998314  Amount
    m = re.search(r'\d+\s+([A-Za-z ]+(?:Development|Design|Marketing|SEO|Content|Maintenance|Support)[^\n]*)\n(.+?)(?:\n\d{6}|\n\d+\s+\d)',
                  text, re.DOTALL | re.IGNORECASE)
    if not m:
        m = re.search(r'\d+\s+(.{10,80})\n(.{10,120})', text)
    if m:
        service_type = m.group(1).strip()
        detail = m.group(2).strip()[:120]
        out["description"] = f"{service_type} – {detail}" if detail else service_type

    return out


# ── AI prompt (explicit about Indian invoice conventions) ─────────────
_INVOICE_EXTRACT_SYSTEM = """\
You are an invoice data extractor for TheWorks (Works Media and Allied Services LLP), an Indian digital agency.
Extract invoice fields from the document text or image provided.

CRITICAL FORMAT RULES — these are non-negotiable:
1. DATES: Indian invoices use DD/MM/YYYY. Convert to ISO YYYY-MM-DD.
   Example: "30/04/2026" → "2026-04-30", "15/05/2026" → "2026-05-15"
2. AMOUNTS: Indian lakh notation uses extra commas. Strip ALL commas, then parse.
   Example: "1,60,000.00" → 160000, "14,400.00" → 14400
3. INVOICE NUMBER: appears after "#" symbol. Strip the "#".
   Example: "# WM/26-27/049" → "WM/26-27/049"
4. BASE AMOUNT: labeled "Sub Total" — this is amount BEFORE GST/tax → amount_raised
5. GRAND TOTAL: labeled "Total" (largest total line) — amount WITH GST → amount_with_tax
6. CLIENT NAME: found in the "Bill To" section → use as project field
7. PDF text may be jumbled (rendered in draw-order not read-order) — find fields wherever they appear

Return ONLY valid JSON inside ===ANSWER=== / ===END=== markers. No prose outside.
"""

_INVOICE_SCHEMA = """{
  "invoice_number": "e.g. WM/26-27/049 — strip # prefix, or null",
  "project": "client company name from Bill To section, or null",
  "description": "service type and description (first line item), or null",
  "raised_date": "Invoice Date as YYYY-MM-DD (convert from DD/MM/YYYY), or null",
  "cleared_date": "payment cleared date as YYYY-MM-DD, or null",
  "amount_raised": sub_total_before_gst_as_plain_number_or_null,
  "amount_with_tax": grand_total_including_gst_as_plain_number_or_null,
  "amount_received": amount_already_received_as_plain_number_or_null,
  "payment_status": "Paid if paid, Pending if unpaid, or null",
  "milestone": "project phase e.g. April 2026 50%, Advance, or null",
  "raised_by": "issuer person name if mentioned, or null",
  "remark": "due date or payment terms if relevant, or null"
}"""


async def parse_invoice_document(content: bytes, filename: str, mime_type: str) -> dict:
    """
    Parse an invoice file (image or PDF) and return extracted form fields.

    For PDFs:   pypdf text extraction + regex pre-pass + AI gap-fill
    For images: base64 to vision model

    Returns a dict matching InvoiceFields keys (snake_case, nulls omitted).
    """
    if not settings.openrouter_api_key:
        raise ValueError("OPENROUTER_API_KEY is not configured.")

    is_image = mime_type.startswith("image/")
    is_pdf   = "pdf" in mime_type.lower() or filename.lower().endswith(".pdf")

    regex_fields: dict = {}
    messages: list[dict] = []
    specs: list[ModelSpec] = []

    prompt_text = (
        "Extract all invoice fields you can find. Apply the format rules from the system prompt strictly.\n\n"
        f"Return EXACTLY this JSON schema inside ===ANSWER=== / ===END=== markers — no markdown, no prose:\n{_INVOICE_SCHEMA}"
    )

    if is_image:
        b64 = base64.b64encode(content).decode()
        messages = [
            {"role": "system", "content": _INVOICE_EXTRACT_SYSTEM},
            {"role": "user", "content": [
                {"type": "text",      "text": prompt_text},
                {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64}"}},
            ]},
        ]
        specs = _vision_models_first()

    elif is_pdf:
        text = _extract_pdf_text(content)
        if not text:
            raise ValueError(
                "Could not extract text from this PDF — it may be a scanned/image-only PDF. "
                "Try uploading a PNG or JPG screenshot of the invoice instead."
            )

        # Pre-extract with regex (fast, reliable for known format)
        regex_fields = _regex_extract_invoice(text)

        # Build a structured context block for the AI so it doesn't need to parse layout
        context_lines = ["RAW INVOICE TEXT (may be in draw-order, not reading order):"]
        context_lines.append(text[:3000])
        if regex_fields:
            context_lines.append("\nPRE-EXTRACTED HINTS (already parsed from text — verify and use):")
            for k, v in regex_fields.items():
                if not k.startswith("_"):
                    context_lines.append(f"  {k}: {v}")

        messages = [
            {"role": "system", "content": _INVOICE_EXTRACT_SYSTEM},
            {"role": "user",   "content": "\n".join(context_lines) + "\n\n" + prompt_text},
        ]
        specs = _ordered_models()

    else:
        raise ValueError(f"Unsupported file type '{mime_type}'. Upload a PDF, PNG, or JPG.")

    result = await _try_chat(messages, max_tokens=700, temperature=0.05, models=specs)
    raw    = result["content"].strip()

    # Strip markdown fences if the model wrapped the JSON
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)

    match = re.search(r"\{.*\}", raw, re.DOTALL)
    parsed: dict = {}
    if match:
        try:
            parsed = json.loads(match.group())
        except json.JSONDecodeError:
            pass

    # Normalise: drop nulls, coerce numbers
    clean: dict = {}
    for k, v in parsed.items():
        if v is None or v == "null" or v == "":
            continue
        if k in ("amount_raised", "amount_with_tax", "amount_received"):
            try:
                clean[k] = float(str(v).replace(",", "").replace("₹", "").strip())
            except (ValueError, TypeError):
                pass
        else:
            clean[k] = str(v).strip() if not isinstance(v, (int, float)) else v

    # Merge regex pre-extracted fields — regex is more reliable than AI for
    # known numeric/date/invoice-number patterns in this invoice format.
    # Numeric & date fields: regex always wins (it explicitly parsed Sub Total, DD/MM/YYYY, etc.)
    # Text fields (project, invoice_number, description): regex fills only if AI missed it.
    REGEX_AUTHORITATIVE = {"amount_raised", "amount_with_tax", "raised_date", "invoice_number"}
    for k, v in regex_fields.items():
        if k.startswith("_"):
            continue  # skip internal hints like _due_date
        if k in REGEX_AUTHORITATIVE or k not in clean:
            clean[k] = v

    # Map _due_date hint → remark field (e.g. "Due: 2026-05-15") if not already set
    if "_due_date" in regex_fields and not clean.get("remark"):
        clean["remark"] = f"Due: {regex_fields['_due_date']}"

    return clean


_REPORT_SYSTEM_PROMPT = """You are FinTrackAI, a senior financial analyst writing an executive board report.

You will receive structured portfolio data and must produce a complete, honest, detailed report.

CRITICAL FORMATTING RULES — non-negotiable:
- Output ONLY the formatted report. No reasoning, no planning, no working notes, no preamble.
- Start your output IMMEDIATELY with ===ANSWER=== on its own line.
- End your output with ===END=== on its own line.
- Between those markers: the complete report and nothing else.
- Use every data point given. Do not omit, vague-ify, or approximate any number.
- Name specific projects, clients, and invoices — never use "a project" or "some clients".
- Use ₹ with Indian grouping (₹2,47,200). Shorthand only if space is tight.
- Structure using section headers like "Portfolio Overview:" on their own line, followed by bullet points.
- Bullet points start with "- " on a new line.
- Be direct and decisive. No filler, no "Based on the data...", no thinking out loud.
- If collection rate < 80%, call it critical explicitly.
- Negative-margin projects must be named and flagged as losses.
"""


async def generate_report(
    summary: dict,
    records: list[dict],
    invoice_summary: dict | None = None,
    invoice_records: list[dict] | None = None,
    status_records: list[dict] | None = None,
) -> dict:
    """
    Full executive report for the portfolio.

    Produces a detailed, honest report covering every material data point:
    project P&L, per-client breakdown, at-risk projects, invoice aging,
    collection health, and concrete action items.
    """

    def _sf(v) -> float:
        try:
            return float(v) if v not in (None, "") else 0.0
        except (TypeError, ValueError):
            return 0.0

    # ── 1. Project lines — capped to keep prompt within context limits ─────
    # Sort: at-risk first (negative profit %), then by billed amount descending.
    # We include full stats for all of them but cap total lines at 60 to avoid
    # 500 context-overflow errors from OpenRouter on large portfolios.
    def _sort_key(r):
        f = r.get("fields", {})
        pct = _sf(f.get("Profit percentage"))
        billed = _sf(f.get("Amount Billed So far"))
        return (0 if pct < 0 else 1, -billed)

    sorted_records = sorted(records, key=_sort_key)
    capped = sorted_records[:60]
    omitted = len(records) - len(capped)

    project_lines = []
    for r in capped:
        f = r.get("fields", {})
        billed     = _sf(f.get("Amount Billed So far"))
        profit_abs = _sf(f.get("Actual Profit"))
        profit_pct = _sf(f.get("Profit percentage"))
        inp_cost   = _sf(f.get("Input Cost"))
        overhead   = _sf(f.get("Overhead Cost"))
        target     = "YES" if f.get("Target Achieved ") else "no"
        project_lines.append(
            f"- {f.get('Client','?')} / {f.get('Project Name','?')}: "
            f"Status={f.get('Project Status','?')}, Health={f.get('Health','N/A')}, "
            f"Billed=₹{billed:,.0f}, Profit=₹{profit_abs:,.0f} ({profit_pct:.1f}%), "
            f"InputCost=₹{inp_cost:,.0f}, Overhead=₹{overhead:,.0f}, TargetAchieved={target}"
        )
    if omitted > 0:
        project_lines.append(
            f"  [+ {omitted} more projects not shown — their totals ARE included in the summary above]"
        )

    # ── 2. At-risk callout ─────────────────────────────────────────────────
    at_risk = summary.get("at_risk", [])
    at_risk_block = ""
    if at_risk:
        lines = [
            f"- {p['name']}: Profit={p['pct']}%, Health={p['health']}, "
            f"Status={p['status']}, Billed=₹{p.get('billed', 0):,.0f}"
            for p in at_risk
        ]
        at_risk_block = "\nAT-RISK PROJECTS (" + str(len(at_risk)) + " flagged):\n" + "\n".join(lines) + "\n"
    else:
        at_risk_block = "\nAT-RISK PROJECTS: None — all projects are within healthy margins.\n"

    # ── 3. Per-client P&L ─────────────────────────────────────────────────
    client_billed = summary.get("client_billed", {})
    client_profit = summary.get("client_profit", {})
    client_lines  = []
    for cl in sorted(client_billed.keys(), key=lambda c: -client_billed[c]):
        b   = client_billed.get(cl, 0.0)
        p   = client_profit.get(cl, 0.0)
        pct = (p / b * 100) if b > 0 else 0.0
        client_lines.append(f"- {cl}: Billed=₹{b:,.0f}, Profit=₹{p:,.0f} ({pct:.1f}%)")

    # ── 4. Invoice blocks ──────────────────────────────────────────────────
    invoice_block    = ""
    pending_block    = ""
    bp_block         = ""

    if invoice_summary:
        bsa    = invoice_summary.get("by_status_amounts", {})
        active = invoice_summary.get("active_invoices", invoice_summary.get("total_invoices", 0))
        coll   = invoice_summary.get("collection_rate", 0)
        coll_flag = " [CRITICAL — BELOW 80%]" if coll < 80 else ""

        invoice_block = (
            "\nINVOICE SUMMARY:\n"
            f"- Total: {invoice_summary.get('total_invoices', 0)} invoices "
            f"(Active: {active}, Cancelled: {invoice_summary.get('by_status', {}).get('Cancelled', 0)})\n"
            f"- Raised (pre-GST): ₹{invoice_summary.get('total_raised', 0):,.0f}\n"
            f"- With Tax (18% GST): ₹{invoice_summary.get('total_with_tax', 0):,.0f}\n"
            f"- Collected: ₹{invoice_summary.get('total_received', 0):,.0f}\n"
            f"- Outstanding: ₹{invoice_summary.get('total_outstanding', 0):,.0f}\n"
            f"- Collection Rate: {coll:.1f}%{coll_flag}\n"
            f"- By status (₹): { {k: f'₹{v:,.0f}' for k, v in bsa.items()} }\n"
        )

        pending = invoice_summary.get("pending_invoices", [])
        if pending:
            lines = []
            for inv in pending:
                fdate = str(inv.get("raised_date", "") or "")[:10] or "?"
                lines.append(
                    f"- [{inv.get('invoice_no','?')}] {inv.get('project','?')}: "
                    f"₹{_sf(inv.get('amount')):,.0f}, Raised={fdate}, "
                    f"Aging={int(inv.get('aging', 0))}d, "
                    f"Followup={inv.get('followup') or 'NOT SET'}"
                )
            pending_block = (
                f"\nPENDING INVOICES — {len(pending)} total (sorted oldest first):\n"
                + "\n".join(lines) + "\n"
            )

        bp = invoice_summary.get("by_project", {})
        if bp:
            lines = [
                f"- {proj}: Raised=₹{pd.get('raised',0):,.0f}, "
                f"Received=₹{pd.get('received',0):,.0f}, "
                f"Outstanding=₹{pd.get('outstanding',0):,.0f} "
                f"({pd.get('count',0)} invoices)"
                for proj, pd in sorted(bp.items(), key=lambda x: -x[1].get("outstanding", 0))
            ]
            bp_block = "\nINVOICE BREAKDOWN BY PROJECT:\n" + "\n".join(lines) + "\n"

    # ── 5. Assemble prompt ─────────────────────────────────────────────────
    best  = summary.get("best_project")  or {}
    worst = summary.get("worst_project") or {}
    today = __import__("datetime").date.today().isoformat()

    # ── TOON context block ─────────────────────────────────────────────────
    # Structured token representation of all entities for reliable AI parsing.
    toon_block = ""
    try:
        from .toon import encode_portfolio
        toon_block = "\n\nTOON CONTEXT (structured tokens — use these for exact figures):\n" + encode_portfolio(
            projects=capped,
            invoices=invoice_records or [],
            statuses=status_records or [],
            max_projects=60,
            max_invoices=80,
        ) + "\n"
    except Exception:
        pass  # TOON is additive — never block the report

    # ── Status updates block ───────────────────────────────────────────────
    status_block = ""
    if status_records:
        lines = []
        for r in status_records:
            f = r.get("fields", {})
            client  = f.get("Client", "?")
            project = f.get("Project", "?")
            short   = f.get("Short Status", "")
            detail  = f.get("Current Status (Detailed)", "")
            entry   = f"- {client} / {project}"
            if short:
                entry += f": {short}"
            if detail and detail.strip() != short.strip():
                entry += f" — {detail[:200]}"
            lines.append(entry)
        status_block = f"\nLIVE PROJECT STATUS UPDATES ({len(status_records)} entries):\n" + "\n".join(lines) + "\n"

    prompt = (
        f"Write a complete executive board report dated {today}.\n"
        f"Use ALL numbers below exactly as given. No approximation.\n\n"

        f"PORTFOLIO SUMMARY:\n"
        f"- Projects: {summary['total_projects']} total, "
        f"{summary.get('target_achieved_count', 0)} hit target\n"
        f"- Revenue Billed: ₹{summary['total_billed']:,.0f}\n"
        f"- Actual Profit: ₹{summary['total_profit']:,.0f} "
        f"(avg margin {summary['avg_profit_pct']:.1f}%)\n"
        f"- Input Cost: ₹{summary.get('total_input_cost', 0):,.0f} | "
        f"Overhead: ₹{summary.get('total_overhead', 0):,.0f} | "
        f"Total Cost Base: ₹{summary.get('total_cost', 0):,.0f}\n"
        f"- Best margin: {best.get('name','N/A')} at {best.get('pct','N/A')}%\n"
        f"- Worst margin: {worst.get('name','N/A')} at {worst.get('pct','N/A')}%\n"
        f"- By status: {summary['by_status']}\n"
        f"- By health: {summary['by_health']}\n\n"

        f"PER-CLIENT P&L:\n"
        + ("\n".join(client_lines) if client_lines else "- (no client data)") + "\n"

        + at_risk_block
        + invoice_block
        + pending_block
        + bp_block
        + status_block

        + f"\nPROJECT DETAIL (top {len(capped)} by priority):\n"
        + "\n".join(project_lines) + "\n"
        + toon_block + "\n"

        "Now write the full report using these sections in order:\n\n"
        "Portfolio Overview:\n"
        "Financial Performance:\n"
        "Per-Client Breakdown:\n"
        + ("Cash Flow & Collections:\n" if invoice_summary else "")
        + ("Current Project Status:\n" if status_records else "")
        + "Project Health Analysis:\n"
        "Risks & Concerns:\n"
        "Recommendations:\n"
        "Action Items This Week:\n\n"
        "Each section: write the section label exactly as shown above (e.g. 'Portfolio Overview:') "
        "on its own line, then bullet points starting with '- '. "
        "Name every at-risk project and every pending invoice explicitly. "
        "For Current Project Status: include each project's short status and any critical detail. "
        "No filler sentences. No preamble before the first section."
    )

    # Remind the user turn to use the markers (belt-and-suspenders for models
    # that ignore system-prompt-only instructions when generating long text).
    prompt += (
        "\n\nIMPORTANT: Output ONLY the report. "
        "Wrap it in ===ANSWER=== ... ===END=== markers. "
        "Do NOT include any reasoning, planning, or working notes."
    )

    messages = [
        {"role": "system", "content": _REPORT_SYSTEM_PROMPT},
        {"role": "user",   "content": prompt},
    ]
    result = await _try_chat(messages, max_tokens=4096, temperature=0.4, extract=False)
    raw = result.get("content", "")
    result["content"] = _clean_report_output(raw)
    return result


def _clean_report_output(text: str) -> str:
    """
    Post-process the raw report output:
    1. Extract between ===ANSWER=== / ===END=== markers (handles reasoning model leakage).
    2. Fall back to heuristic preamble stripper if markers absent.
    """
    if not text:
        return text

    # ── 1. Try ANSWER markers ────────────────────────────────────────────────
    if ANSWER_OPEN in text:
        start = text.index(ANSWER_OPEN) + len(ANSWER_OPEN)
        end   = text.index(ANSWER_CLOSE, start) if ANSWER_CLOSE in text[start:] else len(text)
        cleaned = text[start:end].strip()
        if len(cleaned) > 200:            # sanity: must have real content
            return cleaned

    # ── 2. Heuristic: find first real section header ─────────────────────────
    # Reasoning models leak chain-of-thought before the first real header.
    # We find the first line that looks like a report section and discard all
    # lines above it.
    lines = text.split("\n")
    _SECTION_STARTERS = (
        "# ", "## ", "### ",
        "**portfolio", "**executive", "**board", "**invoice",
        "**project", "**at-risk", "**summary", "**financial",
        "portfolio overview", "executive report", "executive summary",
        "board report", "invoice summary", "project detail",
        "at-risk projects", "financial summary",
    )
    for i, line in enumerate(lines):
        stripped = line.strip().lower()
        if not stripped:
            continue
        if any(stripped.startswith(s) for s in _SECTION_STARTERS):
            # Only strip if reasoning is actually present (at least 3 lines before)
            if i >= 3:
                return "\n".join(lines[i:]).strip()
            break

    return text.strip()


_AI_UPDATE_SYSTEM = (
    "You are a project status writer for a software agency. "
    "Your job is to produce a clear, factual, well-structured status update for a manager. "
    "Be honest, specific, and concise. Use plain prose — no fluff, no generic filler. "
    "Group by project if multiple are selected. "
    "Use markdown: ## for project headings, bullet points for key points. "
    "End with a 'Summary' section with 2–3 sentences of overall portfolio health."
)


async def ai_status_update(
    records: list[dict],
    extra_context: str = "",
) -> dict:
    """
    Generate an AI-written status update narrative for the given status records.

    records: list of {"id":..., "fields": {"Client":..., "Project":...,
              "Short Status":..., "Current Status (Detailed)":...}}
    extra_context: optional additional instruction from the user.
    """
    if not records:
        raise ValueError("No records provided for AI update")

    lines: list[str] = ["Selected project status records:"]
    for r in records:
        f = r.get("fields", {})
        client  = f.get("Client", "Unknown")
        project = f.get("Project", "Unknown")
        short   = f.get("Short Status") or ""
        detail  = f.get("Current Status (Detailed)") or ""
        lines.append(f"\n### {client} — {project}")
        if short:
            lines.append(f"  Status: {short}")
        if detail and detail.strip() != short.strip():
            lines.append(f"  Detail: {detail[:800]}")

    body = "\n".join(lines)
    if extra_context:
        body += f"\n\nAdditional context from user: {extra_context[:300]}"

    prompt = (
        f"{body}\n\n"
        "Write a professional status update report covering the projects above. "
        "Be honest and specific. Flag any blockers or risks clearly. "
        "Format: markdown with ## per project, bullets for key points, "
        "then a final ## Summary section."
    )

    messages = [
        {"role": "system", "content": _AI_UPDATE_SYSTEM},
        {"role": "user",   "content": prompt},
    ]
    return await _try_chat(messages, max_tokens=1500, temperature=0.4, extract=False)


# ── Status Briefing ───────────────────────────────────────────────────────────

_STATUS_BRIEFING_SYSTEM = """You are FinTrackAI, a project delivery analyst.
Your job: write a concise Status Briefing — a focused update on what is happening
across active projects right now. This is NOT a financial report.

RULES:
- Output ONLY the report, wrapped in ===ANSWER=== ... ===END=== markers.
- Focus exclusively on project delivery status, blockers, and next steps.
- Do NOT discuss revenue, invoices, or financial metrics.
- Group projects by their status category (In progress / On Hold / Input Pending / Not started / Completed).
- Each entry: project name, one-line status headline, and if blocked — say why.
- End with a 3-bullet "Key Actions" section.
- Be direct. No filler. No preamble.
"""


async def generate_status_briefing(
    status_records: list[dict],
) -> dict:
    """
    Generate a concise Status Briefing focused on project delivery status.
    No financial data — this is the manager-facing 'what's happening' view.
    """
    if not status_records:
        raise ValueError("No status records provided for briefing")

    today = __import__("datetime").date.today().isoformat()

    # Group by Status field
    grouped: dict[str, list] = {}
    for r in status_records:
        f = r.get("fields", {})
        status = f.get("Status") or "Not started"
        grouped.setdefault(status, []).append(r)

    # Build the prompt data
    lines = [f"Status Briefing as of {today}. {len(status_records)} projects total.\n"]

    status_order = ["In progress", "Input Pending", "On Hold", "Not started", "Completed"]
    for cat in status_order:
        recs = grouped.get(cat, [])
        if not recs:
            continue
        lines.append(f"\n{cat.upper()} ({len(recs)} projects):")
        for r in recs:
            f = r.get("fields", {})
            client  = f.get("Client", "?")
            project = f.get("Project", "?")
            short   = f.get("Short Status") or ""
            detail  = f.get("Current Status (Detailed)") or ""
            entry = f"- {client} / {project}"
            if short:
                entry += f": {short}"
            if detail and detail.strip() != short.strip():
                entry += f" | {detail[:300]}"
            lines.append(entry)

    # Any statuses not in the order list
    for cat, recs in grouped.items():
        if cat not in status_order:
            lines.append(f"\n{cat.upper()} ({len(recs)} projects):")
            for r in recs:
                f = r.get("fields", {})
                lines.append(f"- {f.get('Client','?')} / {f.get('Project','?')}: {f.get('Short Status','')}")

    prompt = "\n".join(lines) + (
        "\n\nWrite the Status Briefing now. Group by status category. "
        "Flag any blocked or on-hold projects clearly. "
        "End with 'Key Actions:' — 3 bullet points.\n\n"
        "IMPORTANT: Start with ===ANSWER=== and end with ===END==="
    )

    messages = [
        {"role": "system", "content": _STATUS_BRIEFING_SYSTEM},
        {"role": "user",   "content": prompt},
    ]
    result = await _try_chat(messages, max_tokens=2000, temperature=0.3, extract=False)
    raw = result.get("content", "")
    result["content"] = _clean_report_output(raw)
    return result
