"""
TTL cache + in-flight request coalescing.

Backing store priority:
  1. Valkey (Aiven)  — persistent, shared across restarts / replicas
  2. In-process dict — fallback when Valkey is unavailable

Public API is identical to the original TTLCache; existing call-sites need
no changes.  The module-level `cache` singleton is what all services import.
"""
from __future__ import annotations
import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional


@dataclass
class _Entry:
    expires_at: float
    value: Any


class TTLCache:
    """
    In-process TTL cache with async coalescing.

    When Valkey is available (the `db.valkey` module is initialised),
    get/set operations are mirrored to Valkey so the cache survives
    container restarts and is shared across any replicas.
    """

    def __init__(self) -> None:
        self._store:    dict[str, _Entry]           = {}
        self._locks:    dict[str, asyncio.Lock]     = {}
        self._inflight: dict[str, asyncio.Future]   = {}
        self._hits   = 0
        self._misses = 0

    # ── Valkey helpers (gracefully absent if not configured) ────────────

    @staticmethod
    def _vk():
        """Return the valkey module if initialised, else None."""
        try:
            from ..db import valkey as _vk
            return _vk if _vk.get_client() else None
        except Exception:
            return None

    # ── Sync API (in-process only) ──────────────────────────────────────

    def get(self, key: str) -> Optional[Any]:
        e = self._store.get(key)
        if not e:
            self._misses += 1
            return None
        if time.time() >= e.expires_at:
            del self._store[key]
            self._misses += 1
            return None
        self._hits += 1
        return e.value

    def set(self, key: str, value: Any, ttl: float) -> None:
        self._store[key] = _Entry(expires_at=time.time() + ttl, value=value)

    def bust(self, prefix: str = "") -> int:
        """Drop every entry whose key starts with `prefix`. Returns count purged."""
        if not prefix:
            n = len(self._store)
            self._store.clear()
            # Also bust Valkey
            vk = self._vk()
            if vk:
                try:
                    asyncio.get_running_loop().create_task(vk.cache_bust(prefix))
                except RuntimeError:
                    pass
            return n
        keys = [k for k in self._store if k.startswith(prefix)]
        for k in keys:
            del self._store[k]
        # Also schedule async bust in Valkey (fire-and-forget)
        vk = self._vk()
        if vk:
            try:
                asyncio.get_running_loop().create_task(vk.cache_bust(prefix))
            except RuntimeError:
                pass
        return len(keys)

    # ── Async coalesced loader (Valkey-aware) ───────────────────────────

    async def get_or_set(
        self,
        key: str,
        ttl: float,
        loader: Callable[[], Awaitable[Any]],
    ) -> Any:
        """
        1. Check in-process store.
        2. Check Valkey.
        3. Call loader(), populate both stores.
        Concurrent calls for the same key share one upstream request.
        """
        # Fast path: in-process hit
        cached = self.get(key)
        if cached is not None:
            return cached

        # Valkey hit (async)
        vk = self._vk()
        if vk:
            remote = await vk.cache_get(key)
            if remote is not None:
                self.set(key, remote, ttl)      # warm local store
                self._hits += 1
                return remote

        # Coalesce: piggy-back on an in-flight request for the same key
        existing = self._inflight.get(key)
        if existing is not None:
            try:
                return await asyncio.wait_for(asyncio.shield(existing), timeout=60.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass   # Fall through and run our own loader

        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            # Re-check after acquiring lock
            cached = self.get(key)
            if cached is not None:
                return cached
            if vk:
                remote = await vk.cache_get(key)
                if remote is not None:
                    self.set(key, remote, ttl)
                    self._hits += 1
                    return remote

            fut: asyncio.Future = asyncio.get_running_loop().create_future()
            self._inflight[key] = fut
            try:
                # 60-second hard timeout — prevents a hung loader blocking indefinitely
                result = await asyncio.wait_for(loader(), timeout=60.0)
                self.set(key, result, ttl)
                if vk:
                    await vk.cache_set(key, result, int(ttl))
                fut.set_result(result)
                return result
            except Exception as e:
                fut.set_exception(e)
                raise
            finally:
                self._inflight.pop(key, None)

    # ── Diagnostics ─────────────────────────────────────────────────────

    def stats(self) -> dict:
        total = self._hits + self._misses
        vk    = self._vk()
        return {
            "size":     len(self._store),
            "hits":     self._hits,
            "misses":   self._misses,
            "hit_rate": round(self._hits / total, 3) if total else 0.0,
            "inflight": len(self._inflight),
            "valkey":   "connected" if vk else "unavailable",
        }


# ── Module-level singleton ───────────────────────────────────────────────────
# All services share this one cache so /health can report a coherent view.
cache = TTLCache()
