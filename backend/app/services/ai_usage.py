"""
AI usage accounting — measured where the model calls actually happen.

The problem this replaces
────────────────────────
`ai_traces` was written from exactly one place: a single call site inside the
/api/ai/chat handler. Every other model call in the app — streaming chat, report
generation, invoice parsing, page generation, Studio questions — went
unrecorded. Anything reading that table therefore reported a number that had
almost nothing to do with real usage, and a per-user quota built on it would
never have fired.

Recording from the router layer cannot work: there are a dozen endpoints and
each one would have to remember to instrument itself, which is exactly the kind
of discipline that decays. So accounting moved down to `_try_chat`, the single
function every model call in this codebase passes through. Instrumenting it once
covers everything, including code written later that nobody remembers to wire up.

Attribution without threading arguments
───────────────────────────────────────
`_try_chat` has no idea which user it is serving, and passing a user id through
twenty call sites would be invasive and easy to forget. A contextvar carries it
instead: middleware binds the current request once, and any model call made
while handling that request picks it up automatically — including calls from
background tasks spawned inside the request, since contextvars propagate into
them.

Limits
──────
The AI providers' free tiers are rate-limited per *account*, not per user — so
one person's retry loop degrades the assistant for everyone. Limits come from
settings and can differ per role, because an admin running reports has a
different appetite from a viewer asking occasional questions. Nothing here is a
constant that needs a redeploy to change.
"""

from __future__ import annotations

import asyncio
import contextvars
import json
import logging
from dataclasses import dataclass
from typing import Callable

from ..config import settings
from ..db.postgres import get_pool

logger = logging.getLogger("fintrack.ai_usage")


# --- request context -------------------------------------------------------

@dataclass(frozen=True)
class CallContext:
    user_id: str | None = None
    endpoint: str = ""
    request_id: str | None = None
    session_id: str | None = None


_ctx: contextvars.ContextVar[CallContext] = contextvars.ContextVar(
    "ai_call_context", default=CallContext()
)


def bind(
    user_id: str | None = None,
    endpoint: str = "",
    request_id: str | None = None,
    session_id: str | None = None,
) -> None:
    """Attach the current request to any model call made while handling it."""
    _ctx.set(CallContext(user_id=user_id, endpoint=endpoint,
                         request_id=request_id, session_id=session_id))


def current() -> CallContext:
    return _ctx.get()


# --- recording -------------------------------------------------------------

_INSERT = """
    INSERT INTO ai_traces
      (endpoint, model, retrieval, latency_ms, prompt_tokens, answer_tokens,
       session_id, request_id, query_snippet, user_id, extra,
       task, provider, status, http_status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid,$11::jsonb,$12,$13,$14,$15)
"""

# The column set from before migration 0003. Used only when the new columns
# are missing, so accounting keeps working on a database the migration has not
# reached yet.
_INSERT_LEGACY = """
    INSERT INTO ai_traces
      (endpoint, model, retrieval, latency_ms, prompt_tokens, answer_tokens,
       session_id, request_id, query_snippet, user_id, extra)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid,$11::jsonb)
"""


def _undefined_column(exc: Exception) -> bool:
    return (getattr(exc, "sqlstate", None) == "42703"
            or type(exc).__name__ == "UndefinedColumnError")


def record(
    model: str | None,
    latency_ms: int,
    tokens: dict | None = None,
    retrieval: str | None = None,
    ok: bool = True,
    error: str | None = None,
    query: str | None = None,
    *,
    task: str | None = None,
    provider: str | None = None,
    status: str | None = None,
    http_status: int | None = None,
    attempt: int | None = None,
    requests: int | None = None,
    on_written: Callable[[], None] | None = None,
) -> None:
    """
    Record one model call. Fire-and-forget and never raises.

    Failed attempts are recorded too. A cascade that burns four models before
    one answers costs four calls against the account's rate limit, and a usage
    view that only counted the successful one would understate the load exactly
    when it matters most. For the same reason `requests` — the provider
    requests the attempt sent, when retries made it more than one — goes in
    extra, where the gateway's daily caps count it. `on_written` runs once the
    row is in.
    """
    pool = get_pool()
    if not pool:
        return
    ctx = current()
    prompt_tok = (tokens or {}).get("prompt_tokens")
    answer_tok = (tokens or {}).get("completion_tokens")
    status = status or ("ok" if ok else "failed")
    extra: dict = {"ok": bool(ok)}
    if not ok:
        extra["error"] = (error or "")[:200]
    if attempt:
        extra["attempt"] = int(attempt)
    if requests is not None and requests != 1:
        extra["requests"] = max(0, int(requests))
    if not (isinstance(http_status, int) and 100 <= http_status <= 599):
        http_status = None
    base = (
        (ctx.endpoint or "")[:60], (model or "")[:120] or None, retrieval,
        latency_ms, prompt_tok, answer_tok,
        ctx.session_id, ctx.request_id,
        (query or "")[:500] or None,
        ctx.user_id,
        json.dumps(extra),
    )

    async def _write() -> None:
        try:
            try:
                await pool.execute(_INSERT, *base, task[:40] if task else None,
                                   provider[:20] if provider else None, status[:12], http_status)
            except Exception as exc:
                # A refusal written in the old shape would read as a failed
                # call and count against the user's quota, so it is dropped.
                if not _undefined_column(exc) or status == "not_sent":
                    raise
                await pool.execute(_INSERT_LEGACY, *base)
        except Exception as exc:
            logger.debug("ai_usage.record failed: %s", exc)
            return
        if on_written is not None:
            try:
                on_written()
            except Exception:
                pass

    try:
        asyncio.get_running_loop().create_task(_write())
    except RuntimeError:
        # No loop (a sync context or shutdown) — accounting is not worth raising over.
        pass


def record_not_sent(task: str | None, reason: str) -> None:
    """Log a call the gateway refused before any provider was contacted."""
    record(None, 0, ok=False, error=reason, task=task, status="not_sent")


# --- limits ----------------------------------------------------------------

def limit_for(role: str | None) -> int:
    """
    The daily call ceiling for a role.

    Read from settings on every call rather than captured at import, so raising
    a limit is an environment change and a restart — not a code change and a
    redeploy. A role with no explicit limit falls back to the default.
    """
    overrides = settings.ai_daily_limit_by_role or {}
    if role and role in overrides:
        try:
            return max(0, int(overrides[role]))
        except (TypeError, ValueError):
            pass
    return max(0, int(settings.ai_daily_call_limit))


# A question costs at least two calls (answer plus verification), and a cascade
# that has to fall through models costs more. Stopping with headroom left means
# a request that is accepted can finish.
RESERVE = 3

_SENT_ONLY = "AND (status IS NULL OR status <> 'not_sent')"


async def usage_for(user_id: str | None, hours: int = 24) -> dict:
    """Calls, tokens and average latency for one user over a rolling window."""
    pool = get_pool()
    if not pool or not user_id:
        return {"calls": 0, "prompt_tokens": 0, "answer_tokens": 0,
                "avg_latency_ms": 0, "failed": 0}

    sql = """
            SELECT COUNT(*)                            AS calls,
                   COALESCE(SUM(prompt_tokens), 0)     AS prompt_tokens,
                   COALESCE(SUM(answer_tokens), 0)     AS answer_tokens,
                   COALESCE(ROUND(AVG(latency_ms)), 0) AS avg_latency_ms,
                   COUNT(*) FILTER (WHERE extra->>'ok' = 'false') AS failed
              FROM ai_traces
             WHERE user_id = $1::uuid
               AND ts > NOW() - make_interval(hours => $2)
               {sent_only}
            """
    try:
        try:
            # A call the gateway refused never reached a provider and costs nothing.
            row = await pool.fetchrow(sql.format(sent_only=_SENT_ONLY), user_id, hours)
        except Exception as exc:
            if not _undefined_column(exc):
                raise
            row = await pool.fetchrow(sql.format(sent_only=""), user_id, hours)
    except Exception as exc:
        logger.debug("usage_for failed: %s", exc)
        return {"calls": 0, "prompt_tokens": 0, "answer_tokens": 0,
                "avg_latency_ms": 0, "failed": 0}

    return {
        "calls": int(row["calls"]),
        "prompt_tokens": int(row["prompt_tokens"]),
        "answer_tokens": int(row["answer_tokens"]),
        "avg_latency_ms": int(row["avg_latency_ms"]),
        "failed": int(row["failed"]),
    }


async def quota_state(user_id: str | None, role: str | None = None) -> dict:
    """
    Whether this user may make another AI call, and what is left.

    `metered` is part of the answer on purpose. A caller with no user id — a
    legacy password session — genuinely cannot be counted, and reporting a
    confident "0 of 200" for them would be a number the system never intends to
    enforce. The UI shows the difference rather than inventing certainty.
    """
    limit = limit_for(role)
    if not user_id:
        return {"allowed": True, "metered": False, "used": 0,
                "limit": limit, "remaining": limit}

    used = (await usage_for(user_id))["calls"]
    remaining = max(0, limit - used)
    return {
        "allowed": remaining > RESERVE,
        "metered": True,
        "used": used,
        "limit": limit,
        "remaining": remaining,
    }
