"""
FinTrack AI service — every chat-completion call in the app passes through here.

Architecture
------------
1. Routes, not a hardcoded model list — which provider and model serve each AI
   task is set in Admin → AI gateway (services/ai_gateway.py). A call names its
   task, is admitted (switched on, under its limits), then tries the task's
   fallback chain in order, the global default chain last. Every attempt that reaches a provider is logged, failed
   ones included, streaming ones with their token counts.

2. Delimited-answer protocol — every prompt instructs the model to wrap
   its output in `===ANSWER===` ... `===END===` markers. We extract the
   payload between them. If a model ignores the protocol, fall back to
   the multi-layer reasoning stripper.

3. Reasoning stripper — three layers:
   a. XML tags (<think>, <reasoning>, <thought>)
   b. Structured-plan markers (Sentence 1:, Step 1:, Plan:, Output:, etc.)
   c. Heuristic meta-paragraph detection ("We need to…", "Let me…")

4. Resilient HTTP — the shared pooled client with retry, exponential
   back-off, where a retry cannot run the model twice (a connection that
   never opened, a 5xx), per-model error reporting, and a time budget for
   the whole route of a non-streamed call.
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
from typing import Any, Callable, NoReturn, Optional

import httpx
from ..utils.http import shared_client

from . import ai_gateway as gateway
from . import ai_usage

ANSWER_OPEN  = "===ANSWER==="
ANSWER_CLOSE = "===END==="

RESPONSE_MODE_INSTRUCTIONS = {
    "brief": "Keep the response concise and decision-first. Use at most 6 short bullets or short sections.",
    "detailed": "Give a clear structured answer with sections, supporting numbers, and concrete next steps.",
    "board": "Write in executive board style with Overview, Pressure Points, and Action lines. Optimise for leadership readability.",
}


# ── Routes ────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class ModelSpec:
    id: str
    leakage: int = 0       # 0 = clean, 5 = leaks heavily
    supports_reasoning_param: bool = False
    # Which API serves this model. Both speak the OpenAI chat-completions
    # shape, so only the URL, the key and a couple of vendor-only payload
    # fields differ.
    provider: str = "openrouter"
    attempt: int = 0       # 1-based position in the route, as tried
    # Which vendor extensions the provider's API takes ("openrouter", "groq"
    # or plain "openai"); see ai_gateway.ProviderState.flavor.
    flavor: str = ""
    timeout_s: int | None = None        # the step's own timeout, else the provider's
    skip_over_limit: bool = True        # skip the step once its provider/model limit is reached
    fallback: bool = False              # appended from the global default chain
    benched: str | None = None          # on the circuit breaker's bench: tried last
    max_output: int | None = None       # the catalogue's max output tokens
    request_limit: int | None = None    # the catalogue's per-request token limit (prompt + answer)


# How much reasoning a model is known to leak into its answer, by id fragment.
# The judge skips the leakiest models in its route.
_LEAKAGE_HINTS = (("nemotron", 5), ("deepseek-r1", 2), ("qwen3", 1))


def _leakage(model_id: str) -> int:
    low = model_id.lower()
    return next((score for hint, score in _LEAKAGE_HINTS if hint in low), 0)


def _spec(step: gateway.RouteStep) -> ModelSpec:
    entry = step.entry
    flavor = step.provider.flavor
    return ModelSpec(
        step.model,
        leakage=_leakage(step.model),
        # `reasoning` is an OpenRouter extension; Groq rejects unknown fields.
        supports_reasoning_param=flavor == "openrouter",
        provider=step.provider.key,
        attempt=step.attempt,
        flavor=flavor,
        timeout_s=step.timeout_s,
        skip_over_limit=step.skip_over_limit,
        fallback=step.fallback,
        benched=step.benched,
        max_output=entry.max_output_tokens if entry else None,
        request_limit=(entry.request_token_limit or entry.context_window) if entry else None,
    )


# A rough count: about four characters to a token, and a flat allowance for
# an attached image.
CHARS_PER_TOKEN = 4.0
_IMAGE_TOKENS = 1500


def estimate_tokens(messages: list[dict]) -> int:
    """Roughly how many tokens `messages` take, for sizing a request before
    it is sent."""
    chars, images = 0, 0
    for m in messages:
        content = m.get("content")
        if isinstance(content, str):
            chars += len(content)
        elif isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text":
                    chars += len(part.get("text") or "")
                elif isinstance(part, dict):
                    images += 1
    return int(chars / CHARS_PER_TOKEN) + 8 * len(messages) + images * _IMAGE_TOKENS


# The smallest answer budget worth sending a request for.
MIN_ANSWER_TOKENS = 256


def fit_budget(spec: ModelSpec, messages: list[dict], max_tokens: int) -> int | None:
    """
    `max_tokens` cut to what the model takes: its max output, and what is
    left of its per-request token limit once the prompt is counted. None when
    the prompt alone leaves too little room: the step is skipped rather than
    sent to be refused.
    """
    budget = max_tokens
    if spec.max_output:
        budget = min(budget, spec.max_output)
    if spec.request_limit:
        room = spec.request_limit - estimate_tokens(messages) - 64
        if room < min(MIN_ANSWER_TOKENS, budget):
            return None
        budget = min(budget, room)
    return budget


async def _ordered_models(task: str = "chat", *, vision: bool = False) -> list[ModelSpec]:
    """
    The task's route from Admin → AI gateway, in the order to try it. With
    `vision`, steps known to read images go first and the rest follow.
    """
    return [_spec(step) for step in await gateway.route_specs(task, vision=vision)]


async def _prompt_for(task: str, default: str) -> str:
    """The task's saved prompt override, else `default`."""
    return gateway.system_prompt(task, default, await gateway.get_config())


def _short(model_id: str) -> str:
    short = model_id.split("/")[-1].replace(":free", "")
    # "openrouter/free" routes to whichever free model is up; "free" alone
    # would name nothing.
    return model_id if short == "free" else short


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
def _total_tokens(usage: Any) -> int | None:
    """Prompt + answer tokens from a provider's usage block, or None."""
    if not isinstance(usage, dict):
        return None
    try:
        total = int(usage.get("prompt_tokens") or 0) + int(usage.get("completion_tokens") or 0)
    except (TypeError, ValueError):
        return None
    return total or None


def _token_split(usage: Any) -> tuple[int, int]:
    if not isinstance(usage, dict):
        return 0, 0
    try:
        return int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0)
    except (TypeError, ValueError):
        return 0, 0


def _meter(spec: ModelSpec, latency_ms: int, *, task: str, tokens: Any = None,
           ok: bool = True, error: str | None = None, http_status: int | None = None,
           requests: int = 1) -> None:
    """
    Record one model attempt in the call log and in the gateway's count of
    today's usage. `requests` is how many provider requests the attempt sent,
    retries included. Accounting must never be the reason a model call fails.
    """
    written = None
    try:
        tin, tout = _token_split(tokens)
        written = gateway.note_usage(task, spec.provider, _total_tokens(tokens) or 0, ok, calls=requests,
                                     model=spec.id, tokens_in=tin, tokens_out=tout)
    except Exception:
        pass
    try:
        ai_usage.record(
            model=spec.id,
            latency_ms=latency_ms,
            tokens=tokens if isinstance(tokens, dict) else None,
            ok=ok,
            error=error,
            task=task,
            provider=spec.provider,
            http_status=http_status,
            attempt=spec.attempt or None,
            requests=requests,
            on_written=written,
        )
    except Exception:
        pass


def _build_payload(spec: ModelSpec, messages: list[dict], **extra) -> dict[str, Any]:
    """
    One payload builder for every cascade loop.

    The `reasoning` field is an OpenRouter extension. Groq validates its request
    body strictly and rejects unknown fields, so sending it there would fail
    every Groq call — which is the whole reason this is centralised rather than
    repeated at each call site.
    """
    payload: dict[str, Any] = {"model": spec.id, "messages": messages, **extra}
    flavor = spec.flavor or spec.provider
    if spec.supports_reasoning_param and flavor == "openrouter":
        payload["reasoning"] = {"exclude": True}
    elif flavor == "groq" and "gpt-oss" in spec.id:
        # gpt-oss reasons before it answers and the reasoning counts against
        # max_tokens; at its default effort a short budget (the judge has 350)
        # can be spent before any answer is written.
        payload["reasoning_effort"] = "low"
    elif flavor == "gemini":
        model = spec.id[len("models/"):] if spec.id.startswith("models/") else spec.id
        payload["model"] = model
        # Gemini 2.5 and later think before answering, and the thinking counts
        # against max_tokens just as gpt-oss's does. Flash can switch it off;
        # Pro cannot, so it thinks at the lowest level. A model that refuses
        # the field has it dropped and the request resent (_OPTIONAL_FIELDS).
        if "flash" in model and "2.5" in model:
            payload["reasoning_effort"] = "none"
        elif "gemini" in model and not model.startswith(("gemini-1", "gemini-2.0")):
            payload["reasoning_effort"] = "low"
    return payload


def _provider_label(provider: str) -> str:
    cfg = gateway._config
    p = cfg.providers.get(provider) if cfg is not None else None
    if p is not None:
        return p.label
    pdef = gateway.PRESETS.get(provider)
    return pdef.label if pdef else provider


def _auth_or_quota_error(status: int) -> str | None:
    """
    Describe a provider-level failure, or None if the status is model-specific.

    401, 402 and 403 condemn every model behind that key, not just the one that
    was asked for. The caller skips the rest of that provider's steps and
    carries on with the next provider, so a dead key on one cannot strand a
    healthy other one.
    """
    if status == 401:
        return "key rejected (HTTP 401)"
    if status in (402, 403):
        return f"quota or permission exhausted (HTTP {status})"
    return None


def _error_message(err: Any) -> str:
    if isinstance(err, dict):
        return str(err.get("message") or err.get("code") or err)
    return str(err)


def _error_text(text: str, status: int) -> str:
    """A provider's error body as one readable line."""
    try:
        data = json.loads(text)
    except ValueError:
        data = None
    if isinstance(data, dict) and data.get("error"):
        message = _error_message(data["error"])
    else:
        message = (text or "").strip()
    return message[:120] or f"HTTP {status}"


def _message_text(data: dict) -> str:
    choices = data.get("choices")
    if isinstance(choices, list) and choices and isinstance(choices[0], dict):
        message = choices[0].get("message")
        if isinstance(message, dict) and isinstance(message.get("content"), str):
            return message["content"]
    return ""


# ── Streaming chunks ──────────────────────────────────────────────────
_SSE_DONE = object()

# After the answer's end marker, how long to keep reading for the usage chunk
# that providers send last.
_USAGE_GRACE_S = 2.0


def _sse_chunk(line: str) -> Any:
    """One line of a chat-completions stream: the parsed chunk, _SSE_DONE at
    the end marker, or None for anything else."""
    if not line or not line.startswith("data:"):
        return None
    data = line[5:].strip()
    if data == "[DONE]":
        return _SSE_DONE
    try:
        chunk = json.loads(data)
    except json.JSONDecodeError:
        return None
    return chunk if isinstance(chunk, dict) else None


def _chunk_text(chunk: dict) -> str:
    # The final usage chunk carries `choices: []`.
    choices = chunk.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        return ""
    delta = choices[0].get("delta")
    content = delta.get("content") if isinstance(delta, dict) else None
    return content if isinstance(content, str) else ""


def _chunk_usage(chunk: dict) -> dict | None:
    """Token usage from a stream chunk: OpenAI-style `usage`, or Groq's `x_groq.usage`."""
    usage = chunk.get("usage")
    if not isinstance(usage, dict):
        groq = chunk.get("x_groq")
        usage = groq.get("usage") if isinstance(groq, dict) else None
    return usage if isinstance(usage, dict) else None


# Shared client — connection pool is reused across requests (faster than
# spinning a new client per call). Timeouts are per provider, per request.
_http_client: Optional[httpx.AsyncClient] = None


def _client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = shared_client()
    return _http_client


# The request never reached the provider, so trying again cannot run the
# model a second time.
_NOT_SENT = (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout)

# How long a non-streamed call may spend on its whole route. The browser gives
# AI requests 90 s (AI_TIMEOUT_MS in services/api.js): ending the route before
# that hands the caller every attempt's error instead of a page that timed out
# while providers were still being called.
ROUTE_BUDGET_S = 80.0
# No step, and no retry, starts with less time than this left.
_MIN_STEP_S = 5.0


def _time_left(deadline: float | None) -> float | None:
    return None if deadline is None else deadline - time.monotonic()


def _has_time(deadline: float | None, wait: float = 0.0) -> bool:
    return deadline is None or deadline - time.monotonic() >= wait + _MIN_STEP_S


# Request fields a provider may not know. If one is refused by name, the same
# request goes once more without them rather than failing the step: an
# optional tuning field should never be the reason a model is unreachable.
_OPTIONAL_FIELDS = ("reasoning", "reasoning_effort", "stream_options")


def _without_refused_fields(payload: dict, status: int, body: str) -> dict | None:
    if status != 400 or not any(f in payload for f in _OPTIONAL_FIELDS):
        return None
    if not any(f in body for f in _OPTIONAL_FIELDS):
        return None
    return {k: v for k, v in payload.items() if k not in _OPTIONAL_FIELDS}


async def _post_with_retries(payload: dict, *, provider: gateway.ProviderState, retries: int = 2,
                             deadline: float | None = None,
                             on_sent: Callable[[], None] | None = None) -> httpx.Response:
    """
    POST, with exponential back-off retries only where a retry cannot run the
    model twice: a connection that never opened, or a 5xx. A read timeout is a
    slow model, and asking again would only be slower, so it fails the step
    at once. `on_sent` is called for every request that reached the provider.
    With a `deadline` (time.monotonic()), each request's timeout is cut to the
    time left and no retry starts too close to it.
    """
    for attempt in range(retries + 1):
        wait = 0.6 * (2 ** attempt)
        retry = attempt < retries
        try:
            r = await _client().post(gateway.chat_url(provider), headers=gateway.headers_for(provider),
                                     json=payload,
                                     timeout=gateway.timeout_for(provider, _time_left(deadline)))
        except _NOT_SENT:
            if retry and _has_time(deadline, wait):
                await asyncio.sleep(wait)
                continue
            raise
        except Exception:
            if on_sent:
                on_sent()
            raise
        if on_sent:
            on_sent()
        lean = _without_refused_fields(payload, r.status_code, r.text)
        if lean is not None:
            payload = lean
            r = await _client().post(gateway.chat_url(provider), headers=gateway.headers_for(provider),
                                     json=payload,
                                     timeout=gateway.timeout_for(provider, _time_left(deadline)))
            if on_sent:
                on_sent()
        if r.status_code >= 500 and retry and _has_time(deadline, wait):
            await asyncio.sleep(wait)
            continue
        return r
    raise RuntimeError("Unreachable")


async def _stream_post_with_retries(payload: dict, *, provider: gateway.ProviderState, retries: int = 1,
                                    on_sent: Callable[[], None] | None = None) -> httpx.Response:
    """Open a streaming POST, with one short retry where a retry cannot run the
    model twice (see _post_with_retries)."""
    for attempt in range(retries + 1):
        wait = 0.6 * (2 ** attempt)
        retry = attempt < retries
        try:
            req = _client().build_request("POST", gateway.chat_url(provider),
                                          headers=gateway.headers_for(provider), json=payload,
                                          timeout=gateway.timeout_for(provider))
            resp = await _client().send(req, stream=True)
        except _NOT_SENT:
            if retry:
                await asyncio.sleep(wait)
                continue
            raise
        except Exception:
            if on_sent:
                on_sent()
            raise
        if on_sent:
            on_sent()
        if resp.status_code == 400 and any(f in payload for f in _OPTIONAL_FIELDS):
            body = (await resp.aread()).decode("utf-8", errors="ignore")
            lean = _without_refused_fields(payload, resp.status_code, body)
            if lean is not None:
                await resp.aclose()
                payload = lean
                req = _client().build_request("POST", gateway.chat_url(provider),
                                              headers=gateway.headers_for(provider), json=payload,
                                              timeout=gateway.timeout_for(provider))
                resp = await _client().send(req, stream=True)
                if on_sent:
                    on_sent()
        if resp.status_code >= 500 and retry:
            await resp.aclose()
            await asyncio.sleep(wait)
            continue
        return resp
    raise RuntimeError("Unreachable")


def _size_refusal(error: str) -> bool:
    e = error.lower()
    return any(w in e for w in ("too large", "per-request token limit", "413"))


def _too_large(error: str) -> bool:
    """A step that failed only because the request was over the model's size
    limit; a stalled free router alongside such steps counts the same, since
    the request would have been too big for the models that refused it."""
    e = error.lower()
    return any(w in e for w in ("too large", "per-request token limit", "413", "no response in"))


class _Cascade:
    """
    One walk down a task's route: which steps can be tried, what each attempt
    cost, and the error to raise when none of them answered.

    Every attempt that reaches a provider is metered, failed ones included. A
    route that burns three models before one answers costs three calls against
    the provider's rate limit, and a log that counted only the answer would
    understate the load exactly when it matters most. A step whose provider is
    off, has no key, whose model is switched off in the catalogue, or whose
    provider or model limit is reached (unless the step says to try it
    anyway) is skipped without a log row; if that leaves nothing contacted at
    all, the call is refused as not_sent. Every outcome feeds the circuit
    breaker, which moves a provider or model that keeps failing to the end of
    every chain for a few minutes.
    """

    def __init__(self, task: str, attempts: list | None = None):
        self.task = task
        self.attempts = attempts
        self.errors: list[str] = []
        self.contacted = False
        # Providers whose key is dead or out of quota. Every later step behind
        # the same key is skipped rather than re-attempted.
        self.dead: set[str] = set()
        # Requests the current step sent that reached its provider.
        self.requests = 0

    async def provider_for(self, spec: ModelSpec) -> gateway.ProviderState | None:
        """The provider to call for `spec`, or None when the step is skipped."""
        self.requests = 0
        if spec.provider in self.dead:
            self.skip(spec, "skipped: key rejected on an earlier step", report=False)
            return None
        cfg = await gateway.get_config()
        p = cfg.providers.get(spec.provider)
        reason = gateway.step_problem(cfg, p, spec.id)
        if reason is None and spec.skip_over_limit:
            reason = await gateway.step_blocked(p.key, spec.id)
        if reason is None:
            return gateway.with_step_timeout(p, spec.timeout_s)
        self.skip(spec, reason)
        return None

    def sent(self) -> None:
        self.requests += 1

    def skip(self, spec: ModelSpec, reason: str, *, report: bool = True) -> None:
        """A step that was never sent. `report` names it in the final error."""
        self._note(spec, ok=False, ms=0, error=reason, skipped=True, report=report)

    def failed(self, spec: ModelSpec, started: float, error: str, *,
               http_status: int | None = None, tokens: Any = None) -> None:
        self._record(spec, started, ok=False, error=error or "failed",
                     http_status=http_status, tokens=tokens)
        _breaker_failed(spec, error, http_status)

    def succeeded(self, spec: ModelSpec, started: float, *,
                  http_status: int | None = None, tokens: Any = None) -> None:
        self._record(spec, started, ok=True, http_status=http_status, tokens=tokens)
        try:
            gateway.breaker_note(spec.provider, spec.id, ok=True)
        except Exception:
            pass

    def too_large(self, spec: ModelSpec) -> None:
        """A step whose prompt alone is over the model's per-request limit."""
        self.skip(spec, "request larger than the model's per-request token limit")

    def _record(self, spec, started, *, ok, error=None, http_status=None, tokens=None) -> None:
        self.contacted = True
        ms = int((time.time() - started) * 1000)
        _meter(spec, ms, task=self.task, tokens=tokens, ok=ok, error=error, http_status=http_status,
               requests=max(1, self.requests))
        self._note(spec, ok=ok, ms=ms, error=error)

    def _note(self, spec: ModelSpec, *, ok: bool, ms: int, error: str | None,
              skipped: bool = False, report: bool = True) -> None:
        if not ok and report:
            self.errors.append(f"{_short(spec.id)} ({_provider_label(spec.provider)}): {(error or '')[:120]}")
        if self.attempts is not None:
            self.attempts.append({"provider": spec.provider, "model": spec.id, "ok": ok,
                                  "ms": ms, "error": None if ok else error, "skipped": skipped,
                                  "fallback": spec.fallback, "benched": bool(spec.benched)})

    def give_up(self) -> NoReturn:
        if not self.contacted:
            gateway.refuse(self.task, gateway.no_provider_message(self.task))
        if any(_size_refusal(e) for e in self.errors) and all(_too_large(e) for e in self.errors):
            raise ValueError(
                "This request is too big for every AI model set up for it. Add a model with a "
                "larger limit (Google Gemini works well) in Admin → AI gateway → Providers, "
                "then try again. Tried: " + "; ".join(self.errors))
        raise ValueError("All AI models are unavailable right now. Tried: " + "; ".join(self.errors))


# Failures that say nothing about the provider or the model.
_NOT_THEIR_FAULT = ("client disconnected", "out of time")


def _breaker_failed(spec: ModelSpec, error: str | None, http_status: int | None) -> None:
    """Count a failed attempt on the circuit breaker. The provider is blamed
    for a network failure, a 5xx or a refused key; anything else (a 429, an
    unusable answer, a refusal of this model) counts against the model only."""
    text = (error or "").lower()
    if any(word in text for word in _NOT_THEIR_FAULT):
        return
    provider_fault = (http_status is None and ("timeout" in text or "network" in text)) \
        or (http_status is not None and (http_status >= 500 or http_status in (401, 402, 403)))
    try:
        gateway.breaker_note(spec.provider, spec.id, ok=False, provider_fault=provider_fault, error=error)
    except Exception:
        pass


# ── Core chat orchestrator ────────────────────────────────────────────
async def _try_chat(
    messages: list[dict],
    max_tokens: int = 1024,
    temperature: float = 0.5,
    extract: bool = True,
    models: list[ModelSpec] | None = None,
    *,
    task: str = "chat",
    bypass_enabled: bool = False,
    attempts: list | None = None,
    budget_s: float = ROUTE_BUDGET_S,
) -> dict:
    """
    Try each step of the task's route until one returns usable content.

    Returns {"content", "model", "model_short", "provider"}. Raises
    GatewayRefused (a ValueError) when the call is not admitted, and a
    ValueError naming every attempt when no model answered. `models` replaces
    the route; `bypass_enabled` runs a switched-off task (the admin Test button
    only); `attempts`, when given, receives {"provider", "model", "ok", "ms",
    "error", "skipped"} for every step tried or skipped. The whole route gets
    `budget_s` seconds: each request's timeout is cut to the time left, and
    steps that would start too late are skipped as out of time.
    """
    await gateway.admit(task, bypass_enabled=bypass_enabled)
    cascade = _Cascade(task, attempts)
    deadline = time.monotonic() + budget_s

    for spec in (models if models is not None else await _ordered_models(task)):
        if not _has_time(deadline):
            cascade.skip(spec, "not tried: out of time")
            continue
        p = await cascade.provider_for(spec)
        if p is None:
            continue
        budget = fit_budget(spec, messages, max_tokens)
        if budget is None:
            cascade.too_large(spec)
            continue
        started = time.time()
        status: int | None = None
        usage: dict | None = None
        try:
            payload = _build_payload(
                spec, messages, max_tokens=budget, temperature=temperature,
            )

            r = await _post_with_retries(payload, provider=p, deadline=deadline, on_sent=cascade.sent)
            status = r.status_code

            provider_dead = _auth_or_quota_error(status)
            if provider_dead:
                cascade.dead.add(spec.provider)
                cascade.failed(spec, started, provider_dead, http_status=status)
                continue
            if status == 429:
                if not _has_time(deadline, 1.2):
                    cascade.failed(spec, started, "rate-limited", http_status=status)
                    continue
                # One short backoff retry before skipping to the next model
                await asyncio.sleep(1.2)
                status = None
                r = await _post_with_retries(payload, provider=p, retries=1, deadline=deadline,
                                             on_sent=cascade.sent)
                status = r.status_code
                if status == 429:
                    cascade.failed(spec, started, "rate-limited", http_status=status)
                    continue
            if status >= 400:
                # Any error here condemns this model, not the run. Aborting
                # would strand a healthy fallback behind a single bad response;
                # the collected errors still name every failure in the final
                # message, so nothing is hidden.
                cascade.failed(spec, started, _error_text(r.text, status), http_status=status)
                continue

            try:
                data = r.json()
            except ValueError:
                data = None
            if not isinstance(data, dict):
                cascade.failed(spec, started, "answered without a JSON body", http_status=status)
                continue
            if isinstance(data.get("usage"), dict):
                usage = data["usage"]
            if "error" in data:
                cascade.failed(spec, started, _error_message(data["error"]),
                               http_status=status, tokens=usage)
                continue

            raw = _message_text(data)
            if not raw.strip():
                cascade.failed(spec, started, "empty response", http_status=status, tokens=usage)
                continue

            content = _extract_answer(raw) if extract else raw.strip()
            if not content:
                cascade.failed(spec, started, "response had no extractable answer",
                               http_status=status, tokens=usage)
                continue

            cascade.succeeded(spec, started, http_status=status, tokens=usage)
            return {"content": content, "model": spec.id, "model_short": _short(spec.id),
                    "provider": spec.provider}

        except (httpx.TimeoutException, httpx.ConnectError):
            cascade.failed(spec, started, "timeout/network", http_status=status, tokens=usage)
        except Exception as e:
            cascade.failed(spec, started, _failure_text(e, p), http_status=status, tokens=usage)

    cascade.give_up()


def _failure_text(exc: Exception, p: gateway.ProviderState) -> str:
    """An unexpected error as an attempt's error text. The HTTP library's own
    messages can quote the request's headers, key included, so it is masked."""
    return gateway.redact(str(exc), p)[:100] or type(exc).__name__


async def stream_chat_with_ai(
    message: str,
    history: list[dict],
    context: str = "",
    response_mode: str = "brief",
    temperature: float | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """
    Stream chat deltas as {"type": "delta", "delta": "..."} events and finish
    with {"type": "done", "content", "model", "model_short", "tokens_used"};
    `tokens_used` is prompt + answer tokens when the provider reported them.
    """
    await gateway.admit("chat")

    messages = [{"role": "system", "content": await _prompt_for("chat", SYSTEM_PROMPT)}]
    mode_instruction = RESPONSE_MODE_INSTRUCTIONS.get(response_mode or "brief")
    if mode_instruction:
        messages.append({"role": "system", "content": mode_instruction})
    if context:
        messages.append({"role": "system", "content": context})
    for h in history[-12:]:
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": message})

    cascade = _Cascade("chat")

    for spec in await _ordered_models("chat"):
        p = await cascade.provider_for(spec)
        if p is None:
            continue
        budget = fit_budget(spec, messages, 1024)
        if budget is None:
            cascade.too_large(spec)
            continue
        started = time.time()
        resp: httpx.Response | None = None
        status: int | None = None
        usage: dict | None = None
        settled = False
        try:
            payload = _build_payload(
                spec, messages, max_tokens=budget,
                temperature=0.5 if temperature is None else temperature,
                stream=True, stream_options={"include_usage": True},
            )

            resp = await _stream_post_with_retries(payload, provider=p, on_sent=cascade.sent)
            status = resp.status_code

            provider_dead = _auth_or_quota_error(status)
            if provider_dead:
                cascade.dead.add(spec.provider)
                cascade.failed(spec, started, provider_dead, http_status=status)
                continue
            if status >= 400:
                body = await resp.aread()
                cascade.failed(spec, started, _error_text(body.decode("utf-8", errors="ignore"), status),
                               http_status=status)
                continue

            full_raw = ""
            emitted = ""
            opened = False
            closed_at: float | None = None

            try:
                async for line in resp.aiter_lines():
                    chunk = _sse_chunk(line)
                    if chunk is _SSE_DONE:
                        break
                    if chunk is None:
                        continue
                    usage = _chunk_usage(chunk) or usage
                    if closed_at is not None:
                        # The answer is complete; read on only for the usage chunk.
                        if time.monotonic() - closed_at > _USAGE_GRACE_S:
                            break
                        continue
                    if "error" in chunk:
                        raise RuntimeError(_error_message(chunk["error"])[:100])

                    delta = _chunk_text(chunk)
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
                        closed_at = time.monotonic()

                    if len(full_raw) > len(emitted):
                        piece = full_raw[len(emitted):]
                        emitted = full_raw
                        if piece:
                            yield {"type": "delta", "delta": piece}
            except httpx.TransportError:
                # Past the end marker only the usage chunk is lost; the answer
                # itself arrived whole.
                if closed_at is None:
                    raise

            final_content = _extract_answer(full_raw if opened else full_raw or emitted).strip()
            if not final_content:
                cascade.failed(spec, started, "response had no extractable answer",
                               http_status=status, tokens=usage)
                continue

            cascade.succeeded(spec, started, http_status=status, tokens=usage)
            settled = True

            if final_content != emitted:
                tail = final_content[len(emitted):]
                if tail:
                    yield {"type": "delta", "delta": tail}

            yield {
                "type": "done",
                "content": final_content,
                "model": spec.id,
                "model_short": _short(spec.id),
                "tokens_used": _total_tokens(usage),
            }
            return

        except (httpx.TimeoutException, httpx.ConnectError):
            cascade.failed(spec, started, "timeout/network", http_status=status, tokens=usage)
        except (GeneratorExit, asyncio.CancelledError):
            # The reader went away mid-answer; the provider still served it.
            if not settled:
                cascade.failed(spec, started, "stopped: the client disconnected",
                               http_status=status, tokens=usage)
            raise
        except Exception as e:
            cascade.failed(spec, started, _failure_text(e, p), http_status=status, tokens=usage)
        finally:
            if resp is not None:
                try:
                    await resp.aclose()
                except Exception:
                    pass

    cascade.give_up()


# ── Context formatters ────────────────────────────────────────────────
_PROJECT_CURRENCY_FIELDS = {
    'Amount Billed So far', 'Actual Profit', 'Target Revenue',
    'Input cost so far', 'Total Overhead Cost',
    'Combined monthly salary of all the resources', 'Revenue per Resource',
}


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
                margin_display = raw * 100 if -2.0 < raw < 2.0 else raw
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
_JUDGE_SYSTEM = (
    "You are FinTrackAI Judge. Verify whether the draft answer is grounded in the supplied portfolio context. "
    "Return ONLY compact JSON with keys verdict, confidence, issues, corrected_answer. "
    "verdict must be 'pass' or 'soft-fail'. confidence must be 'high', 'medium', or 'low'. "
    "Use soft-fail if the draft invents figures, contradicts the context, or misses the requested output style. "
    "If soft-fail, provide a corrected_answer grounded strictly in context. Keep issues short."
)


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
    payload = json.dumps({
        "question": message,
        "draft_answer": answer,
        "context": judge_context,
    }, ensure_ascii=False)
    result = await _try_chat(
        [
            {"role": "system", "content": await _prompt_for("judge", _JUDGE_SYSTEM)},
            {"role": "user", "content": payload},
        ],
        max_tokens=350,
        temperature=0.0,
        extract=False,
        models=[m for m in await _ordered_models("judge") if m.leakage <= 2][:4] or None,
        task="judge",
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


_AUTOFILL_SYSTEM = (
    "You are a JSON extraction assistant. Output ONLY the JSON object inside "
    f"{ANSWER_OPEN} / {ANSWER_CLOSE} markers. No prose, no markdown, no commentary."
)


async def autofill_project(description: str) -> dict:
    """Extract structured project fields from free-text description."""
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
        {"role": "system", "content": await _prompt_for("project_autofill", _AUTOFILL_SYSTEM)},
        {"role": "user", "content": prompt},
    ]
    result = await _try_chat(messages, max_tokens=512, temperature=0.05, task="project_autofill")
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
        {"role": "system", "content": await _prompt_for("project_analysis", SYSTEM_PROMPT)},
        {"role": "user", "content": prompt},
    ]
    return await _try_chat(messages, max_tokens=1024, temperature=0.5, task="project_analysis")


# Invoice text is read for the regex pre-pass and the first 3,000 characters of
# the prompt. A real invoice is a few thousand characters; anything past this
# bound is ignored rather than handed to the regexes.
_MAX_INVOICE_TEXT_CHARS = 20_000
# Pages are not read past this many seconds. A page of drawing operators yields
# no text, so the character cap never stops it, and parsing one is slow. A real
# invoice extracts in well under a second.
_MAX_INVOICE_EXTRACT_SECONDS = 15


def _extract_pdf_text(content: bytes) -> str:
    """Extract plain text from a PDF byte-string. Returns '' on failure or scanned PDF.

    Synchronous and CPU-bound (pypdf is pure Python): parse_invoice_document
    runs it through asyncio.to_thread.
    """
    try:
        from pypdf import PdfReader  # type: ignore
        reader = PdfReader(io.BytesIO(content))
        parts: list[str] = []
        size = 0
        deadline = time.monotonic() + _MAX_INVOICE_EXTRACT_SECONDS
        for page in reader.pages[:8]:  # cap at 8 pages
            if time.monotonic() > deadline:
                break
            t = page.extract_text()
            if t:
                parts.append(t)
                size += len(t)
                if size >= _MAX_INVOICE_TEXT_CHARS:
                    break
        return "\n\n".join(parts).strip()[:_MAX_INVOICE_TEXT_CHARS]
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
    # (?<!\d) starts \d+ only at the head of a digit run. Without it the engine
    # retried from every digit inside a long run, which is quadratic: a PDF
    # holding a 16k-digit table cell took seconds. The matches are unchanged,
    # because a match starting mid-run also exists from the head of that run.
    m = re.search(r'(?<!\d)\d+\s+([A-Za-z ]+(?:Development|Design|Marketing|SEO|Content|Maintenance|Support)[^\n]*)\n(.+?)(?:\n\d{6}|\n\d+\s+\d)',
                  text, re.DOTALL | re.IGNORECASE)
    if not m:
        m = re.search(r'(?<!\d)\d+\s+(.{10,80})\n(.{10,120})', text)
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
    is_image = mime_type.startswith("image/")
    is_pdf   = "pdf" in mime_type.lower() or filename.lower().endswith(".pdf")

    regex_fields: dict = {}
    messages: list[dict] = []
    specs: list[ModelSpec] | None = None
    system = await _prompt_for("invoice_parse", _INVOICE_EXTRACT_SYSTEM)

    prompt_text = (
        "Extract all invoice fields you can find. Apply the format rules from the system prompt strictly.\n\n"
        f"Return EXACTLY this JSON schema inside ===ANSWER=== / ===END=== markers — no markdown, no prose:\n{_INVOICE_SCHEMA}"
    )

    if is_image:
        b64 = base64.b64encode(content).decode()
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": [
                {"type": "text",      "text": prompt_text},
                {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64}"}},
            ]},
        ]
        # Models known to read images go first; the rest still follow.
        specs = await _ordered_models("invoice_parse", vision=True)

    elif is_pdf:
        # pypdf is pure Python and slow on large pages: off the loop, other
        # requests are still served while it runs. The regex pass gets a
        # thread too, and its input is bounded by _MAX_INVOICE_TEXT_CHARS.
        text = await asyncio.to_thread(_extract_pdf_text, content)
        if not text:
            raise ValueError(
                "Could not extract text from this PDF — it may be a scanned/image-only PDF. "
                "Try uploading a PNG or JPG screenshot of the invoice instead."
            )

        # Pre-extract with regex (fast, reliable for known format)
        regex_fields = await asyncio.to_thread(_regex_extract_invoice, text)

        # Build a structured context block for the AI so it doesn't need to parse layout
        context_lines = ["RAW INVOICE TEXT (may be in draw-order, not reading order):"]
        context_lines.append(text[:3000])
        if regex_fields:
            context_lines.append("\nPRE-EXTRACTED HINTS (already parsed from text — verify and use):")
            for k, v in regex_fields.items():
                if not k.startswith("_"):
                    context_lines.append(f"  {k}: {v}")

        messages = [
            {"role": "system", "content": system},
            {"role": "user",   "content": "\n".join(context_lines) + "\n\n" + prompt_text},
        ]

    else:
        raise ValueError(f"Unsupported file type '{mime_type}'. Upload a PDF, PNG, or JPG.")

    result = await _try_chat(messages, max_tokens=700, temperature=0.05, models=specs,
                             task="invoice_parse")
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
        {"role": "system", "content": await _prompt_for("status_update", _AI_UPDATE_SYSTEM)},
        {"role": "user",   "content": prompt},
    ]
    return await _try_chat(messages, max_tokens=1500, temperature=0.4, extract=False,
                           task="status_update")


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
        {"role": "system", "content": await _prompt_for("status_briefing", _STATUS_BRIEFING_SYSTEM)},
        {"role": "user",   "content": prompt},
    ]
    result = await _try_chat(messages, max_tokens=2000, temperature=0.3, extract=False,
                             task="status_briefing")
    raw = result.get("content", "")
    result["content"] = _clean_report_output(raw)
    return result
