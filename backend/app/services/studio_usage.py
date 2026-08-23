"""
AI usage accounting and per-user quotas.

`ai_traces` has been written on every AI call since it was added and read by
nothing. Everything needed to meter usage is already in it — user, model,
tokens, latency, endpoint — so this module reads that table rather than adding
a parallel counter that could disagree with it.

Why a quota at all: every model in the cascade is on OpenRouter's free tier,
which is rate-limited per account, not per user. One person holding down a
retry button degrades the assistant for everyone. The daily cap is deliberately
generous — it exists to catch a runaway loop, not to ration normal work.
"""

from __future__ import annotations

import logging

from ..db.postgres import get_pool

logger = logging.getLogger("fintrack.studio.usage")

# Calls per user per rolling 24 hours, across every AI endpoint.
DAILY_CALL_LIMIT = 200

# A question costs two model calls (answer + judge), so the floor at which we
# stop accepting new questions leaves room to finish one in flight.
RESERVE = 2


async def usage_for(user_id: str | None, hours: int = 24) -> dict:
    """
    Calls, tokens and average latency for one user over a rolling window.

    An anonymous caller (legacy password session, no auth_users row) has no
    user_id to meter against and is reported as unlimited — see quota_state.
    """
    pool = get_pool()
    if not pool or not user_id:
        return {"calls": 0, "prompt_tokens": 0, "answer_tokens": 0, "avg_latency_ms": 0}

    row = await pool.fetchrow(
        """
        SELECT COUNT(*)                              AS calls,
               COALESCE(SUM(prompt_tokens), 0)       AS prompt_tokens,
               COALESCE(SUM(answer_tokens), 0)       AS answer_tokens,
               COALESCE(ROUND(AVG(latency_ms)), 0)   AS avg_latency_ms
          FROM ai_traces
         WHERE user_id = $1::uuid
           AND ts > NOW() - ($2 || ' hours')::interval
        """,
        user_id, str(hours),
    )
    return {
        "calls": int(row["calls"]),
        "prompt_tokens": int(row["prompt_tokens"]),
        "answer_tokens": int(row["answer_tokens"]),
        "avg_latency_ms": int(row["avg_latency_ms"]),
    }


async def quota_state(user_id: str | None) -> dict:
    """
    Whether this user may make another AI call, and how much headroom is left.

    Returns {allowed, used, limit, remaining}.
    """
    if not user_id:
        return {"allowed": True, "used": 0, "limit": DAILY_CALL_LIMIT, "remaining": DAILY_CALL_LIMIT}

    used = (await usage_for(user_id))["calls"]
    remaining = max(0, DAILY_CALL_LIMIT - used)
    return {
        "allowed": remaining > RESERVE,
        "used": used,
        "limit": DAILY_CALL_LIMIT,
        "remaining": remaining,
    }


async def breakdown(hours: int = 24, limit: int = 20) -> list[dict]:
    """Per-user totals for the admin view — who is actually spending the budget."""
    pool = get_pool()
    if not pool:
        return []
    rows = await pool.fetch(
        """
        SELECT t.user_id,
               u.email,
               u.full_name,
               COUNT(*)                            AS calls,
               COALESCE(SUM(t.prompt_tokens), 0)   AS prompt_tokens,
               COALESCE(SUM(t.answer_tokens), 0)   AS answer_tokens,
               COALESCE(ROUND(AVG(t.latency_ms)), 0) AS avg_latency_ms,
               MAX(t.ts)                           AS last_call
          FROM ai_traces t
          LEFT JOIN auth_users u ON u.id = t.user_id
         WHERE t.ts > NOW() - ($1 || ' hours')::interval
           AND t.user_id IS NOT NULL
         GROUP BY t.user_id, u.email, u.full_name
         ORDER BY calls DESC
         LIMIT $2
        """,
        str(hours), limit,
    )
    return [
        {
            "user_id": str(r["user_id"]),
            "email": r["email"] or "",
            "name": r["full_name"] or "",
            "calls": int(r["calls"]),
            "prompt_tokens": int(r["prompt_tokens"]),
            "answer_tokens": int(r["answer_tokens"]),
            "avg_latency_ms": int(r["avg_latency_ms"]),
            "last_call": r["last_call"].isoformat() if r["last_call"] else None,
        }
        for r in rows
    ]
