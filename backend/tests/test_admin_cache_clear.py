"""Clear cache drops saved data and leaves security state alone."""
import asyncio

from app.routers import admin
from app.utils.cache import cache


def test_clear_cache_drops_data_copies_only(monkeypatch):
    cache.set("invoice:list:all", [1], ttl=60)
    cache.set("project:summary", {"a": 1}, ttl=60)
    cache.set("chat:context", "ctx", ttl=60)
    cache.set("ratelimit:1.2.3.4", 5, ttl=60)        # security state: kept
    out = asyncio.run(admin.admin_clear_cache(request=None, _="x", _perm="x"))
    assert out["ok"] and out["cleared_local"] >= 3
    assert cache.get("invoice:list:all") is None and cache.get("project:summary") is None
    assert cache.get("chat:context") is None
    assert cache.get("ratelimit:1.2.3.4") == 5
