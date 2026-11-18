"""Login is limited per account as well as per IP (routers/auth.py)."""
import asyncio

import pytest
from fastapi import HTTPException

import app.routers.auth as A


def test_per_account_budget_blocks_spread_out_guessing(monkeypatch):
    seen = {}

    async def fake_rate_check(key, limit=60, window_sec=60, bucket="ratelimit"):
        seen[(bucket, key)] = seen.get((bucket, key), 0) + 1
        return seen[(bucket, key)] <= limit, 0
    import app.db.valkey as V
    monkeypatch.setattr(V, "rate_check", fake_rate_check)

    async def attempt(email):
        await A._target_rate_limit(email, limit=10, window_sec=900, bucket="authacct")

    for _ in range(10):
        asyncio.run(attempt("Owner@Example.com "))
    with pytest.raises(HTTPException) as e:
        asyncio.run(attempt("owner@example.com"))   # same account, other spelling
    assert e.value.status_code == 429
    asyncio.run(attempt("someone.else@example.com"))   # other accounts unaffected
    assert all(len(k) == 32 for _, k in seen)          # the email is never the key itself
