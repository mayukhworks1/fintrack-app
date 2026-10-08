"""
Round trips to stores ~210 ms away, and what the request path waits on.

Measured on production (X-Response-Time-Ms): /health/live, which touches no
database, took 214 ms on the server, and the whole of that was one Valkey
EXISTS the scanner trap ran before routing. The audit log put two-query
endpoints at a 440 ms floor with a p90 near 2.5 s — the floor is two trips
to Aiven, the p90 is a pooled connection that had expired and reconnected.

These pin the fixes by what they cost, not by what they are called:

  * the pool keepalive pings every idle connection, concurrently, releases
    them all, and never raises;
  * a cache miss asks Valkey once, and the write back does not block;
  * /health reports the round-trip times so the number is visible.
"""

import asyncio
import time

import pytest

import app.db.postgres as pg
import app.utils.cache as C


# ── pool keepalive ───────────────────────────────────────────────────────────

class _Conn:
    def __init__(self, delay=0.0, fail=False): self.delay, self.fail, self.pinged = delay, fail, 0
    async def execute(self, sql):
        await asyncio.sleep(self.delay)
        self.pinged += 1
        if self.fail:
            raise ConnectionError("dead")
        return "SELECT 1"


class _Pool:
    def __init__(self, conns):
        self.idle = list(conns)
        self.released = []
    def get_idle_size(self): return len(self.idle)
    async def acquire(self, timeout=None):
        if not self.idle:
            raise asyncio.TimeoutError()
        return self.idle.pop()
    async def release(self, c):
        self.released.append(c); self.idle.append(c)


class TestKeepalive:
    def test_pings_every_idle_connection_concurrently_and_releases_all(self):
        conns = [_Conn(delay=0.2) for _ in range(4)]
        pool = _Pool(conns)
        t0 = time.perf_counter()
        n = asyncio.run(pg.ping_idle_connections(pool))
        elapsed = time.perf_counter() - t0
        assert n == 4 and all(c.pinged == 1 for c in conns)
        assert elapsed < 0.5, f"pings ran serially: {elapsed:.2f}s"
        assert sorted(map(id, pool.released)) == sorted(map(id, conns))
        assert pool.get_idle_size() == 4                   # nothing leaked

    def test_a_dead_connection_is_counted_not_raised(self):
        conns = [_Conn(), _Conn(fail=True), _Conn()]
        pool = _Pool(conns)
        before = pg._keepalive_stats["failed"]
        assert asyncio.run(pg.ping_idle_connections(pool)) == 2
        assert pg._keepalive_stats["failed"] == before + 1
        assert pool.get_idle_size() == 3                   # still released

    def test_no_idle_connections_means_no_work(self):
        assert asyncio.run(pg.ping_idle_connections(_Pool([]))) == 0

    def test_start_is_a_no_op_without_a_pool_and_idempotent_with_one(self, monkeypatch):
        monkeypatch.setattr(pg, "_pool", None)
        monkeypatch.setattr(pg, "_keepalive_task", None)
        pg.start_keepalive()
        assert pg._keepalive_task is None
        async def run():
            monkeypatch.setattr(pg, "_pool", _Pool([]))
            pg.start_keepalive(); first = pg._keepalive_task
            pg.start_keepalive(); second = pg._keepalive_task
            await pg.stop_keepalive()
            return first, second
        first, second = asyncio.run(run())
        assert first is second and first.cancelled() or first.done()

    def test_the_ping_interval_is_well_inside_the_idle_lifetime(self):
        # Otherwise a connection can expire between pings and a request pays.
        assert pg._KEEPALIVE_INTERVAL_S * 3 <= pg._POOL_IDLE_LIFETIME_S

    def test_pool_stats_shape(self, monkeypatch):
        monkeypatch.setattr(pg, "_pool", None)
        s = pg.pool_stats()
        assert {"size", "idle", "min", "max", "keepalive_running", "keepalive"} <= set(s)


# ── cache: one remote read per miss, write-behind ────────────────────────────

class _FakeVk:
    def __init__(self): self.gets = 0; self.sets = 0; self.set_started = asyncio.Event()
    def get_client(self): return object()
    async def cache_get(self, key):
        self.gets += 1
        await asyncio.sleep(0.05)      # a far Valkey
        return None
    async def cache_set(self, key, value, ttl):
        self.set_started.set()
        await asyncio.sleep(0.2)       # slow write — must not be waited on
        self.sets += 1
    async def cache_bust(self, prefix): return 0


class TestCacheMissCost:
    def _run(self, monkeypatch):
        vk = _FakeVk()
        monkeypatch.setattr(C.TTLCache, "_vk", staticmethod(lambda: vk))
        c = C.TTLCache()
        async def loader():
            await asyncio.sleep(0.01)
            return {"v": 1}
        async def go():
            t0 = time.perf_counter()
            out = await c.get_or_set("k", ttl=5, loader=loader)
            return out, time.perf_counter() - t0
        return vk, asyncio.run(go())

    def test_a_miss_asks_valkey_once_not_twice(self, monkeypatch):
        vk, (out, _) = self._run(monkeypatch)
        assert out == {"v": 1}
        assert vk.gets == 1, "the re-check inside the lock asked Valkey a second time"

    def test_the_write_back_does_not_block_the_response(self, monkeypatch):
        vk, (out, elapsed) = self._run(monkeypatch)
        assert out == {"v": 1}
        assert elapsed < 0.15, f"response waited on the Valkey write: {elapsed:.2f}s"
        assert vk.set_started.is_set()                      # but it was issued


# ── /health reports what it costs ────────────────────────────────────────────

class TestHealthTimings:
    def test_health_reports_round_trip_times_and_pool(self, monkeypatch):
        monkeypatch.setenv("APP_SECRET", "x-local-test-secret-xxxxxxxxxxxx")
        import app.main as M
        import app.db.valkey as vk

        class P:
            async def fetchval(self, sql, *a):
                await asyncio.sleep(0.02); return 1
            async def fetchrow(self, sql, *a):
                return None
            def get_size(self): return 4
            def get_idle_size(self): return 3
            def get_min_size(self): return 4
            def get_max_size(self): return 10

        class V:
            async def ping(self):
                await asyncio.sleep(0.02); return True

        monkeypatch.setattr(pg, "_pool", P())
        monkeypatch.setattr(vk, "_client", V())
        from fastapi.testclient import TestClient
        body = TestClient(M.app).get("/health").json()
        assert body["pg_rtt_ms"] >= 20 and body["valkey_rtt_ms"] >= 20
        assert body["pool"]["size"] == 4 and body["pool"]["idle"] == 3
        assert "keepalive" in body["pool"]


# ── permissions: one cold read for a burst, seeded by /verify ────────────────

class TestPermissionReads:
    def test_a_burst_of_cold_reads_sends_one_query(self, monkeypatch):
        import app.routers.deps as deps
        deps.invalidate_permission_cache()
        calls = []
        class P:
            async def fetch(self, sql, *a):
                calls.append(sql)
                await asyncio.sleep(0.02)        # a far database; lets the burst overlap
                return [{"permission_key": "module.x", "from_role": True, "override": None}]
        monkeypatch.setattr(deps, "get_pool", lambda: P())
        async def burst():
            return await asyncio.gather(*(deps.get_effective_permissions("u1") for _ in range(4)))
        results = asyncio.run(burst())
        assert all(r == {"module.x"} for r in results)
        assert len(calls) == 1, f"{len(calls)} identical permission queries for one burst"
        deps.invalidate_permission_cache()

    def test_a_failed_shared_read_does_not_poison_waiters(self, monkeypatch):
        import app.routers.deps as deps
        deps.invalidate_permission_cache()
        n = {"calls": 0}
        class P:
            async def fetch(self, sql, *a):
                n["calls"] += 1
                await asyncio.sleep(0.01)
                if n["calls"] == 1:
                    raise RuntimeError("blip")
                return [{"permission_key": "module.y", "from_role": True, "override": None}]
        monkeypatch.setattr(deps, "get_pool", lambda: P())
        async def burst():
            return await asyncio.gather(*(deps.get_effective_permissions("u2") for _ in range(3)),
                                        return_exceptions=True)
        results = asyncio.run(burst())
        assert any(isinstance(r, RuntimeError) for r in results)          # the first saw the error
        assert any(r == {"module.y"} for r in results)                     # waiters retried on their own
        deps.invalidate_permission_cache()

    def test_verify_folds_permissions_into_its_one_statement(self, monkeypatch):
        import app.routers.deps as deps
        from app.routers import auth as A
        from app.routers.auth import make_token
        deps.invalidate_permission_cache()
        from datetime import datetime, timedelta, timezone
        calls = []
        class P:
            async def fetchrow(self, sql, *a):
                calls.append(("fetchrow", sql))
                assert "AS permissions" in sql
                return {"session_id": "s1", "user_id": "u3", "revoked_at": None,
                        "expires_at": datetime.now(timezone.utc) + timedelta(days=1), "expired": False,
                        "metadata": {}, "email": "u@x", "first_name": "U", "last_name": "X",
                        "full_name": "U X", "status": "active", "avatar_url": None,
                        "auth_role": "viewer", "permissions": ["module.b", "module.a"]}
            async def fetch(self, sql, *a):
                calls.append(("fetch", sql)); return []
        monkeypatch.setattr(pg, "_pool", P())
        out = asyncio.run(A.verify(authorization=f"Bearer {make_token('viewer')}"))
        assert out["permissions"] == ["module.a", "module.b"]
        assert [c[0] for c in calls] == ["fetchrow"], "permissions must not cost a second query"
        # and the next gated request finds the cache warm
        assert asyncio.run(deps.get_effective_permissions("u3")) == {"module.a", "module.b"}
        assert [c[0] for c in calls] == ["fetchrow"]
        deps.invalidate_permission_cache()


# ── admin stats: three aggregates, one wait ──────────────────────────────────

class TestAdminStats:
    def test_the_three_queries_run_concurrently(self, monkeypatch):
        import app.routers.admin as admin
        class P:
            async def fetchrow(self, sql, *a):
                await asyncio.sleep(0.15); return {"audit_total": 1}
            async def fetch(self, sql, *a):
                await asyncio.sleep(0.15); return []
        monkeypatch.setattr(admin, "get_pool", lambda: P())
        monkeypatch.setattr(admin, "_row_to_dict", lambda r: dict(r))
        t0 = time.perf_counter()
        out = asyncio.run(admin.admin_stats(_="admin"))
        elapsed = time.perf_counter() - t0
        assert out["audit_total"] == 1 and out["top_error_paths"] == [] and out["top_slow_paths"] == []
        assert elapsed < 0.3, f"queries ran in sequence: {elapsed:.2f}s"
