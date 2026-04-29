"""
TTL cache + in-flight request coalescing.

Single source of truth for in-process caching across services.
Replaces the ad-hoc {key: (timestamp, value)} dicts that were sprinkled
through invoice.py, teable.py, and ai.py.

Features:
- Namespaced keys (so cache_bust("invoice") only nukes invoice keys)
- Per-entry TTL (seconds)
- Async-safe in-flight coalescing: concurrent calls for the same key
  share one upstream request (avoids dog-piling Teable/OpenRouter)
- Stats accessor for /health diagnostics

Usage:
    from .utils.cache import TTLCache

    cache = TTLCache()
    data  = await cache.get_or_set(
        "invoice:list:Paid",
        ttl=15,
        loader=lambda: svc.list_invoices(status="Paid"),
    )
    cache.bust(prefix="invoice")
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
    """In-process TTL cache with async coalescing."""

    def __init__(self) -> None:
        self._store:  dict[str, _Entry]              = {}
        self._locks:  dict[str, asyncio.Lock]        = {}
        self._inflight: dict[str, asyncio.Future]    = {}
        self._hits = 0
        self._misses = 0

    # ── Sync API ──
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
            return n
        keys = [k for k in self._store if k.startswith(prefix)]
        for k in keys:
            del self._store[k]
        return len(keys)

    # ── Async coalesced loader ──
    async def get_or_set(
        self,
        key: str,
        ttl: float,
        loader: Callable[[], Awaitable[Any]],
    ) -> Any:
        """
        If the key is fresh, return cached value.
        If not, call `loader` exactly once even under concurrent access —
        all other waiters get the same result.
        """
        cached = self.get(key)
        if cached is not None:
            return cached

        # Coalesce: piggy-back on an in-flight request for the same key
        existing = self._inflight.get(key)
        if existing is not None:
            return await existing

        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            # Re-check after acquiring lock (might have been populated)
            cached = self.get(key)
            if cached is not None:
                return cached

            fut: asyncio.Future = asyncio.get_event_loop().create_future()
            self._inflight[key] = fut
            try:
                result = await loader()
                self.set(key, result, ttl)
                fut.set_result(result)
                return result
            except Exception as e:
                fut.set_exception(e)
                raise
            finally:
                self._inflight.pop(key, None)

    # ── Diagnostics ──
    def stats(self) -> dict:
        total = self._hits + self._misses
        return {
            "size":   len(self._store),
            "hits":   self._hits,
            "misses": self._misses,
            "hit_rate": round(self._hits / total, 3) if total else 0.0,
            "inflight": len(self._inflight),
        }


# ── Module-level singleton ───────────────────────────────────────────
# All services share this one cache so /admin/cache and /health
# can report a single coherent view.
cache = TTLCache()
