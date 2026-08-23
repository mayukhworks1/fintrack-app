"""
What every authenticated request costs before the handler runs.

The reported symptom was that CRUD felt laggy and unresponsive across the app.
The cause was not any one endpoint: the shared auth dependency made three
sequential Postgres round trips on every request, and the permission gate a
fourth — so a one-row delete waited on five round trips to a remote database,
four of them overhead. These tests pin the count so it cannot drift back.
"""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.db import postgres as pg
from app.routers import deps
from app.routers.auth import make_token

SESSION_ID = uuid.uuid4()
USER_ID = uuid.uuid4()


class CountingPool:
    """Records every statement, so round trips can be counted rather than guessed."""

    def __init__(self, permissions=()):
        self.calls: list[str] = []
        self._permissions = permissions

    async def fetchrow(self, sql, *args):
        self.calls.append(sql)
        if "auth_sessions s" in sql:
            return {
                "session_id": SESSION_ID, "user_id": USER_ID,
                "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
                "revoked_at": None, "metadata": {}, "email": "u@example.com",
                "first_name": "U", "last_name": "X", "full_name": "U X",
                "status": "active", "teable_email": None, "auth_role": "viewer",
            }
        return None

    async def fetchval(self, sql, *args):
        self.calls.append(sql)
        return None

    async def fetch(self, sql, *args):
        self.calls.append(sql)
        return [{"permission_key": k, "from_role": True, "override": None}
                for k in self._permissions]

    async def execute(self, sql, *args):
        self.calls.append(sql)
        return "OK"


class FakeRequest:
    """Only the surface the auth dependency actually touches."""

    def __init__(self):
        self.state = type("S", (), {})()
        self.state.request_id = "test"
        self.url = type("U", (), {"path": "/api/studio/threads/x"})()


@pytest.fixture(autouse=True)
def _clean_caches():
    deps.invalidate_permission_cache()
    yield
    deps.invalidate_permission_cache()


@pytest.fixture
def pool(monkeypatch):
    p = CountingPool(permissions=("module.studio.ask",))
    monkeypatch.setattr(pg, "_pool", p)
    # spawn() with no running loop closes the coroutine and returns None, which
    # is what keeps the background session touch out of these counts.
    return p


class TestAuthCost:
    @staticmethod
    def _cost_of_authenticating(pool) -> list[str]:
        """
        The statements the request actually waits on.

        Sampled the instant require_auth returns and before any further await,
        so a task spawned during it has not been scheduled yet — which is
        exactly the distinction that matters. Work moved off the request path
        still runs; the response no longer blocks on it.
        """
        async def run():
            await deps.require_auth(FakeRequest(), make_token("viewer"))
            return list(pool.calls)
        return asyncio.run(run())

    def test_authenticating_costs_one_round_trip(self, pool):
        """
        Was three: the session lookup, then `SELECT $1::timestamptz <= NOW()`
        to compare two timestamps already in hand, then a last_seen_at write.
        Only the lookup answers a question the request needs answered.
        """
        awaited = self._cost_of_authenticating(pool)
        assert len(awaited) == 1
        assert "auth_sessions s" in awaited[0]

    def test_the_expiry_check_no_longer_asks_the_database(self, pool):
        awaited = self._cost_of_authenticating(pool)
        assert not any("timestamptz <= NOW()" in c for c in awaited)

    def test_last_seen_is_not_written_on_the_request_path(self, pool):
        awaited = self._cost_of_authenticating(pool)
        assert not any("UPDATE auth_sessions" in c for c in awaited)

    def test_an_expired_session_is_still_rejected(self, monkeypatch):
        """The round trip went away; the check it performed did not."""
        class Expired(CountingPool):
            async def fetchrow(self, sql, *args):
                row = await super().fetchrow(sql, *args)
                if row:
                    row["expires_at"] = datetime.now(timezone.utc) - timedelta(seconds=1)
                return row

        monkeypatch.setattr(pg, "_pool", Expired())
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            asyncio.run(deps.require_auth(FakeRequest(), make_token("viewer")))
        assert exc.value.status_code == 401

    def test_a_revoked_session_is_still_rejected(self, monkeypatch):
        class Revoked(CountingPool):
            async def fetchrow(self, sql, *args):
                row = await super().fetchrow(sql, *args)
                if row:
                    row["revoked_at"] = datetime.now(timezone.utc)
                return row

        monkeypatch.setattr(pg, "_pool", Revoked())
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            asyncio.run(deps.require_auth(FakeRequest(), make_token("viewer")))
        assert exc.value.status_code == 401


class TestPermissionCache:
    def test_the_second_request_does_not_reread_the_matrix(self, pool):
        async def two_requests():
            first = await deps.get_effective_permissions(str(USER_ID))
            n = len(pool.calls)
            second = await deps.get_effective_permissions(str(USER_ID))
            return first, second, n, len(pool.calls)

        first, second, after_one, after_two = asyncio.run(two_requests())
        assert first == second == {"module.studio.ask"}
        assert after_one == 1
        assert after_two == 1, "the second read should have been served from cache"

    def test_an_admin_edit_takes_effect_immediately(self, pool):
        """A cache nobody can invalidate is a permission bug waiting to happen."""
        async def edit_then_read():
            await deps.get_effective_permissions(str(USER_ID))
            deps.invalidate_permission_cache(str(USER_ID))
            before = len(pool.calls)
            await deps.get_effective_permissions(str(USER_ID))
            return before, len(pool.calls)

        before, after = asyncio.run(edit_then_read())
        assert after == before + 1

    def test_fresh_bypasses_the_cache(self, pool):
        async def read_twice():
            await deps.get_effective_permissions(str(USER_ID))
            before = len(pool.calls)
            await deps.get_effective_permissions(str(USER_ID), fresh=True)
            return before, len(pool.calls)

        before, after = asyncio.run(read_twice())
        assert after == before + 1

    def test_one_user_never_sees_another_users_permissions(self, pool):
        async def two_users():
            a = await deps.get_effective_permissions(str(uuid.uuid4()))
            b = await deps.get_effective_permissions(str(uuid.uuid4()))
            return a, b, len(pool.calls)

        a, b, calls = asyncio.run(two_users())
        assert calls == 2, "distinct users must not share a cache entry"
        assert a == b == {"module.studio.ask"}

    def test_no_user_id_grants_nothing(self, pool):
        assert asyncio.run(deps.get_effective_permissions(None)) == set()
        assert pool.calls == []
