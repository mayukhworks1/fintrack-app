"""
Valkey (Redis-compatible) client — Aiven SSL (`rediss://`).

Public helpers
--------------
init_client()          — call once at startup
close_client()         — call at shutdown
get_client()           — returns the redis.asyncio.Redis instance (or None)

cache_get(key)         — returns deserialized value or None
cache_set(key, value, ttl)  — serialise + store with TTL (seconds)
cache_bust(prefix)     — delete all keys starting with prefix

geo_get(ip)            — return cached geolocation dict or None
geo_set(ip, data)      — store geolocation dict for 24 h

rate_check(ip, limit, window_sec)
                       — sliding-window rate limiter using a Sorted Set;
                         returns (allowed: bool, remaining: int)
"""

from __future__ import annotations

import json
import logging
import time

logger = logging.getLogger("fintrack.db.valkey")

try:
    import redis.asyncio as aioredis
    _REDIS_AVAILABLE = True
except ImportError:
    _REDIS_AVAILABLE = False
    logger.warning("redis package not installed — Valkey features disabled")

_client: "aioredis.Redis | None" = None  # type: ignore[name-defined]

_GEO_TTL    = 24 * 3600   # 24 h for IP geo cache
_KEY_SEP    = ":"

# Key prefixes — all Valkey keys follow  prefix:discriminator  convention
KEY_GEO        = "geo"          # geo:{ip}
KEY_ATTRIB     = "attrib"       # attrib:{teable_id}
KEY_RATELIMIT  = "ratelimit"    # ratelimit:{ip}
KEY_SESSION    = "session_touch"# session_touch:{token_hint}
KEY_CACHE      = "cache"        # cache:{name}  (generic app cache)


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

async def init_client(valkey_url: str) -> None:
    global _client
    if not _REDIS_AVAILABLE:
        return
    if not valkey_url:
        logger.warning("VALKEY_URL not set — Valkey features disabled")
        return
    try:
        _client = aioredis.from_url(
            valkey_url,
            decode_responses=False,   # keep bytes; we handle JSON ourselves
            socket_connect_timeout=5,
            socket_timeout=5,
            health_check_interval=30,
        )
        await _client.ping()
        logger.info("Valkey connected")
    except Exception as exc:
        logger.error("Valkey init failed: %s", exc)
        _client = None


async def close_client() -> None:
    global _client
    if _client:
        await _client.aclose()
        _client = None


def get_client():
    return _client


# ---------------------------------------------------------------------------
# Serialisation helpers
# ---------------------------------------------------------------------------

def _encode(value) -> bytes:
    return json.dumps(value, default=str).encode()


def _decode(raw: bytes):
    return json.loads(raw)


# ---------------------------------------------------------------------------
# Generic cache helpers
# ---------------------------------------------------------------------------

async def cache_get(key: str):
    """Return decoded value or None."""
    if not _client:
        return None
    try:
        raw = await _client.get(key)
        return _decode(raw) if raw is not None else None
    except Exception as exc:
        logger.debug("cache_get(%s) error: %s", key, exc)
        return None


async def cache_set(key: str, value, ttl: int) -> None:
    """Store value with TTL (seconds). Silently no-ops if Valkey is down."""
    if not _client:
        return
    try:
        await _client.set(key, _encode(value), ex=ttl)
    except Exception as exc:
        logger.debug("cache_set(%s) error: %s", key, exc)


async def cache_bust(prefix: str) -> int:
    """
    Delete all keys starting with `prefix*`.
    Uses SCAN + pipelined DELETE to avoid blocking; safe on large keyspaces.
    Returns the number of keys deleted.
    """
    if not _client:
        return 0
    try:
        pattern = f"{prefix}*" if not prefix.endswith("*") else prefix
        keys: list = []
        async for key in _client.scan_iter(pattern, count=200):
            keys.append(key)
        if not keys:
            return 0
        # Delete in one pipeline round-trip instead of N individual calls
        pipe = _client.pipeline()
        for k in keys:
            pipe.delete(k)
        await pipe.execute()
        return len(keys)
    except Exception as exc:
        logger.debug("cache_bust(%s) error: %s", prefix, exc)
        return 0


# ---------------------------------------------------------------------------
# Generic helpers — set_nx, exists, get_or_none with explicit TTL
# ---------------------------------------------------------------------------

async def set_nx(key: str, value: str, ttl: int) -> bool:
    """
    SET key value EX ttl NX — set only if key does not already exist.
    Returns True if the key was set, False if it already existed.
    Always returns True (allow) when Valkey is unavailable.
    """
    if not _client:
        return True
    try:
        result = await _client.set(key, value.encode(), ex=ttl, nx=True)
        return result is not None   # None means key already existed
    except Exception as exc:
        logger.debug("set_nx(%s) error: %s", key, exc)
        return True   # fail open


async def key_exists(key: str) -> bool:
    """Return True if key exists, False otherwise (including when Valkey is down)."""
    if not _client:
        return False
    try:
        return bool(await _client.exists(key))
    except Exception:
        return False


# ---------------------------------------------------------------------------
# IP geolocation cache (24 h)
# ---------------------------------------------------------------------------

def _geo_key(ip: str) -> str:
    return f"geo:{ip}"


async def geo_get(ip: str) -> dict | None:
    return await cache_get(_geo_key(ip))


async def geo_set(ip: str, data: dict) -> None:
    await cache_set(_geo_key(ip), data, _GEO_TTL)


# ---------------------------------------------------------------------------
# Record-mutation attribution (actor context handoff)
# ---------------------------------------------------------------------------
#
# When a user mutates a record via the API, the request handler captures the
# actor context (role, IP, geo, OS, browser, etc.) and stores it briefly in
# Valkey under  attrib:{teable_id}.  The background Teable→PG sync loop then
# pops that attribution when it discovers the corresponding change and writes
# a fully-attributed row to record_history.
#
# TTL is short (default 120 s) because if the sync hasn't run within 2 min the
# attribution is stale and we'd rather record "sync" than misattribute.

_ATTRIB_TTL = 360  # seconds — must outlive the full-sync interval (300 s) with margin


async def attribution_set(teable_id: str, actor: dict, ttl: int = _ATTRIB_TTL) -> None:
    """Store actor context for the next sync of this record. Silently no-ops if Valkey is down."""
    if not _client or not teable_id:
        return
    try:
        await _client.set(f"attrib:{teable_id}", _encode(actor), ex=ttl)
    except Exception as exc:
        logger.debug("attribution_set(%s) error: %s", teable_id, exc)


async def attribution_pop(teable_id: str) -> dict | None:
    """
    Atomically GET-then-DEL the actor attribution for a record.
    Returns the decoded actor dict, or None if not present / Valkey down.
    """
    if not _client or not teable_id:
        return None
    try:
        key = f"attrib:{teable_id}"
        pipe = _client.pipeline()
        pipe.get(key)
        pipe.delete(key)
        results = await pipe.execute()
        raw = results[0]
        return _decode(raw) if raw else None
    except Exception as exc:
        logger.debug("attribution_pop(%s) error: %s", teable_id, exc)
        return None


# ---------------------------------------------------------------------------
# Sliding-window rate limiter  (Sorted Set approach)
# ---------------------------------------------------------------------------

async def rate_check(ip: str, limit: int = 60, window_sec: int = 60, bucket: str = "ratelimit") -> tuple[bool, int]:
    """
    Sliding-window rate limiter.
    - key   : {bucket}:{ip}   (bucket lets auth/AI/etc. have independent budgets)
    - score : current epoch-ms (float)
    - Returns (allowed, remaining) — safe to call even if Valkey is down.
    """
    if not _client:
        return True, limit   # fail open

    key  = f"{bucket}:{ip}"
    now  = time.time()
    pipe = _client.pipeline()

    try:
        # Remove entries outside the window
        pipe.zremrangebyscore(key, 0, now - window_sec)
        # Add this request
        pipe.zadd(key, {str(now): now})
        # Count entries in window
        pipe.zcard(key)
        # Expire the key slightly beyond the window
        pipe.expire(key, window_sec + 10)
        results = await pipe.execute()
        count = results[2]   # zcard result
        allowed   = count <= limit
        remaining = max(0, limit - count)
        return allowed, remaining
    except Exception as exc:
        logger.debug("rate_check(%s) error: %s", ip, exc)
        return True, limit   # fail open
