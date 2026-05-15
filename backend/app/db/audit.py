"""
Audit + session logger — async fire-and-forget architecture.

Public API
──────────
enqueue_audit(**kwargs)
    Synchronous, non-blocking.  Drop in audit_log event — the middleware
    calls this and the response is returned immediately.  If the queue is
    full (backpressure / PG down) the entry is silently dropped — the app
    must never block an HTTP response just to write a log row.

audit_worker()
    Background coroutine — drain the queue in batches.  Concurrently
    geo-enriches each item via Valkey-cached ip→geo lookups, then
    bulk-inserts via executemany.  Batch size is up to 100 rows; flush
    interval is 500 ms so rows appear in the table within < 1 s.

log_login(**kwargs)
    Direct (awaited) write on successful login — called once per session,
    no need to batch.

touch_session(token_hint)
    Rate-limited session heartbeat — Valkey prevents redundant DB writes.

CRITICAL — asyncpg + JSONB
──────────────────────────
Every JSONB column must be passed as json.dumps(value) and bound with
a $N::jsonb SQL cast.  A raw Python dict raises DataError which asyncpg
swallows silently — the row is never inserted.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from datetime import datetime, timezone, timedelta
from typing import Optional

from .postgres import get_pool
from .geo import lookup as geo_lookup

logger = logging.getLogger("fintrack.db.audit")


# ── User-agent parser ─────────────────────────────────────────────────────────

_OS_PATTERNS = [
    (re.compile(r"Windows NT 10"),        "Windows 10"),
    (re.compile(r"Windows NT 11"),        "Windows 11"),
    (re.compile(r"Windows NT 6\.3"),      "Windows 8.1"),
    (re.compile(r"Windows NT 6\.2"),      "Windows 8"),
    (re.compile(r"Windows NT 6\.1"),      "Windows 7"),
    (re.compile(r"Windows"),              "Windows"),
    (re.compile(r"Android ([\d.]+)"),     "Android {0}"),
    (re.compile(r"iPhone.*?OS ([\d_]+)"), "iOS {0}"),
    (re.compile(r"iPad.*?OS ([\d_]+)"),   "iPadOS {0}"),
    (re.compile(r"Mac OS X ([\d_]+)"),    "macOS {0}"),
    (re.compile(r"CrOS"),                 "ChromeOS"),
    (re.compile(r"Linux"),                "Linux"),
]

_BROWSER_PATTERNS = [
    (re.compile(r"Edg/([\d.]+)"),            "Edge {0}"),
    (re.compile(r"OPR/([\d.]+)"),            "Opera {0}"),
    (re.compile(r"SamsungBrowser/([\d.]+)"), "Samsung {0}"),
    (re.compile(r"Chrome/([\d.]+)"),         "Chrome {0}"),
    (re.compile(r"Firefox/([\d.]+)"),        "Firefox {0}"),
    (re.compile(r"Safari/([\d.]+)"),         "Safari"),
    (re.compile(r"curl/([\d.]+)"),           "curl {0}"),
    (re.compile(r"python-httpx/([\d.]+)"),   "httpx {0}"),
    (re.compile(r"python-requests/([\d.]+)"),"requests {0}"),
]

_MOBILE_UA = re.compile(r"Mobile|Android|iPhone|iPad", re.I)
_TABLET_UA = re.compile(r"iPad|Tablet", re.I)


def parse_client_hint(header_value: str) -> dict:
    """
    Decode the base64-encoded JSON device hint sent by the frontend.
    Returns a dict with extra device signals collected from JavaScript
    (UA Client Hints, GPU via WebGL, screen, timezone, RAM, cores, etc.).
    Returns an empty dict on any decode failure — never raises.
    """
    if not header_value:
        return {}
    try:
        import base64
        # Add padding if missing (some encoders strip it)
        padding = "=" * (-len(header_value) % 4)
        raw = base64.b64decode(header_value + padding, validate=False)
        return json.loads(raw.decode("utf-8")) or {}
    except Exception:
        return {}


def build_device_label(
    os_str: str,
    browser: str,
    device: str,
    hint: dict | None = None,
) -> str:
    """
    Build a human-readable device label by combining UA-parsed OS/browser
    with the rich client hint payload.

    Examples:
      "iPhone 15 Pro · iOS 17.5 · Safari · Asia/Kolkata"
      "MacBook · macOS 14.5 (arm64) · 8 cores · Apple M2 Pro · Chrome 131"
      "Windows 11 PC · 16 cores · 32GB · GeForce RTX 3080 · Chrome 131"
      "Android · Chrome 131 · 1080×2400 (Mobile)"   ← when no hint available
    """
    hint = hint or {}
    ch = hint.get("ch") or {}

    parts: list[str] = []

    # ── Primary device descriptor ──
    model = ch.get("model")
    if model:
        parts.append(str(model))                                # "iPhone 15 Pro"
    elif device == "mobile":
        parts.append("Mobile")
    elif device == "tablet":
        parts.append("Tablet")
    else:
        # Desktop — try to give it a friendly tag
        if "macOS" in os_str or "Mac" in (hint.get("platform") or ""):
            parts.append("Mac")
        elif "Windows" in os_str:
            parts.append("Windows PC")
        elif "ChromeOS" in os_str:
            parts.append("Chromebook")
        elif "Linux" in os_str:
            parts.append("Linux PC")
        else:
            parts.append("Desktop")

    # ── OS + version ──
    os_part = os_str
    plat_ver = ch.get("platformVersion")
    if plat_ver and plat_ver not in os_str:
        # macOS Client Hints reports as "14.5.0" — collapse trailing .0
        plat_ver = str(plat_ver).rstrip(".0") if str(plat_ver).endswith(".0") else plat_ver
        os_part = f"{os_str} {plat_ver}".strip()

    # Architecture + bitness in parens, e.g. "(arm64)" or "(x64)"
    arch    = ch.get("arch")
    bitness = ch.get("bitness")
    arch_part = ""
    if arch:
        arch_part = arch
        if bitness and bitness not in arch:
            arch_part = f"{arch}{bitness}"
        os_part = f"{os_part} ({arch_part})" if arch_part else os_part

    if os_part and os_part != parts[0]:
        parts.append(os_part)

    # ── Hardware specs (desktop only — too noisy for mobile) ──
    if device == "desktop":
        cores = hint.get("cores")
        if cores:
            parts.append(f"{cores} cores")
        mem = hint.get("memoryGb")
        if mem:
            parts.append(f"{mem}GB")
        gpu = hint.get("gpu")
        if gpu:
            # Strip noisy prefixes
            gpu_clean = (gpu
                         .replace("Direct3D11 vs_5_0 ps_5_0", "")
                         .replace("OpenGL ES", "")
                         .strip())
            if len(gpu_clean) > 60:
                gpu_clean = gpu_clean[:57] + "…"
            parts.append(gpu_clean)

    # ── Browser ──
    if browser and browser != "Unknown":
        parts.append(browser)

    # ── Timezone (concise tail) ──
    tz = hint.get("timezone")
    if tz:
        parts.append(tz)

    return " · ".join(p for p in parts if p)


def parse_ua(ua: str) -> tuple[str, str, str]:
    """Return (os, browser, device). Never raises, never returns None."""
    if not ua:
        return "Unknown", "Unknown", "desktop"

    os_str = "Unknown"
    for pat, tpl in _OS_PATTERNS:
        m = pat.search(ua)
        if m:
            os_str = tpl.format(m.group(1).replace("_", ".")) if "{0}" in tpl and m.lastindex else tpl
            break

    browser_str = "Unknown"
    for pat, tpl in _BROWSER_PATTERNS:
        m = pat.search(ua)
        if m:
            if "{0}" in tpl and m.lastindex:
                ver = m.group(1).split(".")[0]
                browser_str = tpl.format(ver)
            else:
                browser_str = tpl
            break

    if _TABLET_UA.search(ua):
        device = "tablet"
    elif _MOBILE_UA.search(ua):
        device = "mobile"
    else:
        device = "desktop"

    return os_str, browser_str, device


# ── Async audit queue ─────────────────────────────────────────────────────────
# Non-blocking producer (called from every HTTP response middleware).
# Bounded at _QUEUE_MAX so we never accumulate unlimited memory under load.

_QUEUE_MAX = 2000
_BATCH_MAX  = 100     # rows per executemany call
_FLUSH_INTERVAL = 0.5  # seconds to wait before flush if queue is quiet

_audit_queue: asyncio.Queue | None = None


def init_audit_queue() -> asyncio.Queue:
    """Create the shared queue.  Call once at startup from lifespan."""
    global _audit_queue
    _audit_queue = asyncio.Queue(maxsize=_QUEUE_MAX)
    logger.info("Audit queue initialised (maxsize=%d)", _QUEUE_MAX)
    return _audit_queue


def enqueue_audit(**kwargs) -> None:
    """
    Synchronous, non-blocking.  Safe to call from async middleware without
    await.  Drops silently if queue is full — HTTP response is never delayed.
    """
    if _audit_queue is None:
        return
    try:
        _audit_queue.put_nowait(kwargs)
    except asyncio.QueueFull:
        # Intentional load shedding.  Under extreme traffic bursts or PG
        # unavailability we prefer losing some log rows over blocking requests.
        pass


async def _enrich_one(item: dict) -> dict:
    """
    Resolve OS / browser / device / geo for one queued audit item.
    Geo lookups hit Valkey cache (24 h TTL) so new IPs pay the network cost
    only once.
    """
    ua  = item.get("user_agent", "") or ""
    ip  = item.get("ip", "") or ""
    os_str, browser, device = parse_ua(ua)
    geo = await geo_lookup(ip)
    return {**item, "os_str": os_str, "browser": browser, "device": device, "geo": geo}


async def _batch_insert_audit(pool, items: list[dict]) -> None:
    """
    Bulk-insert N audit rows in one executemany call.
    This is ~N× faster than individual pool.execute calls and reduces
    connection-pool contention under load.
    """
    if not items or not pool:
        return
    try:
        records = []
        for item in items:
            geo = item.get("geo", {}) or {}
            records.append((
                item.get("role"),
                (item.get("token_hint") or "")[:20] or None,
                (item.get("method")     or "")[:10],
                (item.get("path")       or "")[:500],
                item.get("status"),
                item.get("duration_ms"),
                (item.get("request_id") or "")[:50]  or None,
                (item.get("ip")         or "")[:45]  or None,
                (item.get("user_agent") or "")[:500] or None,
                item.get("os_str",  "Unknown")[:100],
                item.get("browser", "Unknown")[:100],
                item.get("device",  "desktop")[:20],
                geo.get("country",      "")[:80]  or None,
                geo.get("country_code", "")[:4]   or None,
                geo.get("region",       "")[:100] or None,
                geo.get("city",         "")[:100] or None,
                geo.get("isp",          "")[:150] or None,
                # Extended geo — coordinates, timezone, org (v2.4)
                geo.get("lat")  if isinstance(geo.get("lat"),  (int, float)) else None,
                geo.get("lon")  if isinstance(geo.get("lon"),  (int, float)) else None,
                (geo.get("timezone") or "")[:50]  or None,
                (geo.get("org")      or "")[:200] or None,
                (item.get("referer")      or "")[:500] or None,
                item.get("body_size"),
                (item.get("query_params") or "")[:500] or None,
                item.get("resp_size"),
                json.dumps(item.get("extra") or {}),   # JSONB — must be JSON string
            ))

        await pool.executemany(
            """
            INSERT INTO audit_log (
                role, token_hint,
                method, path, status, duration_ms, request_id,
                ip, user_agent, os, browser, device,
                country, country_code, region, city, isp,
                lat, lon, timezone, org,
                referer, body_size, query_params, resp_size,
                extra
            ) VALUES (
                $1,  $2,
                $3,  $4,  $5,  $6,  $7,
                $8,  $9,  $10, $11, $12,
                $13, $14, $15, $16, $17,
                $18, $19, $20, $21,
                $22, $23, $24, $25,
                $26::jsonb
            )
            """,
            records,
        )
    except Exception as exc:
        logger.warning("audit batch insert failed (%d rows): %s", len(items), exc)


async def audit_worker() -> None:
    """
    Background coroutine — must be launched as an asyncio Task at startup.

    Loop:
      1. Block up to _FLUSH_INTERVAL seconds for the first item.
      2. Drain up to _BATCH_MAX additional items without blocking.
      3. Geo-enrich the batch concurrently (Valkey cache makes most <1 ms).
      4. Bulk-INSERT via executemany.
      5. Repeat.

    Handles CancelledError cleanly so the shutdown lifespan can cancel it
    and flush whatever remains in the queue.
    """
    logger.info("Audit worker started")
    while True:
        batch: list[dict] = []
        try:
            # Wait for at least one item
            first = await asyncio.wait_for(
                _audit_queue.get(), timeout=_FLUSH_INTERVAL  # type: ignore[union-attr]
            )
            batch.append(first)
            # Drain remaining without waiting
            while len(batch) < _BATCH_MAX:
                try:
                    batch.append(_audit_queue.get_nowait())  # type: ignore[union-attr]
                except asyncio.QueueEmpty:
                    break
        except asyncio.TimeoutError:
            continue   # Nothing arrived in the flush window — just loop
        except asyncio.CancelledError:
            break      # Clean shutdown
        except Exception:
            continue

        if not batch:
            continue

        # Geo-enrich concurrently — Valkey cache makes repeated IPs ~instant
        enriched = await asyncio.gather(
            *[_enrich_one(item) for item in batch],
            return_exceptions=True,
        )
        good = [e for e in enriched if isinstance(e, dict)]

        pool = get_pool()
        if good and pool:
            await _batch_insert_audit(pool, good)


# ── Direct writer for login events (not batched — called once per login) ──────

async def log_request(
    *,
    role:         Optional[str],
    token_hint:   Optional[str],
    method:       str,
    path:         str,
    status:       int,
    duration_ms:  int,
    request_id:   Optional[str],
    ip:           str,
    user_agent:   str,
    referer:      Optional[str] = None,
    body_size:    Optional[int] = None,
    query_params: Optional[str] = None,
    resp_size:    Optional[int] = None,
    extra:        Optional[dict] = None,
) -> None:
    """
    Direct (awaited) audit log write.
    Kept for backward-compat — the middleware now uses enqueue_audit() instead.
    Use this for non-HTTP events that must not be dropped.
    """
    pool = get_pool()
    if not pool:
        return

    try:
        os_str, browser, device = parse_ua(user_agent or "")
        geo = await geo_lookup(ip or "")

        await pool.execute(
            """
            INSERT INTO audit_log (
                role, token_hint,
                method, path, status, duration_ms, request_id,
                ip, user_agent, os, browser, device,
                country, country_code, region, city, isp,
                lat, lon, timezone, org,
                referer, body_size, query_params, resp_size,
                extra
            ) VALUES (
                $1,  $2,
                $3,  $4,  $5,  $6,  $7,
                $8,  $9,  $10, $11, $12,
                $13, $14, $15, $16, $17,
                $18, $19, $20, $21,
                $22, $23, $24, $25,
                $26::jsonb
            )
            """,
            role,
            (token_hint or "")[:20] or None,
            (method or "")[:10],
            (path or "")[:500],
            status,
            duration_ms,
            (request_id or "")[:50] or None,
            (ip or "")[:45]           or None,
            (user_agent or "")[:500]  or None,
            os_str[:100],
            browser[:100],
            device[:20],
            geo.get("country",      "")[:80]  or None,
            geo.get("country_code", "")[:4]   or None,
            geo.get("region",       "")[:100] or None,
            geo.get("city",         "")[:100] or None,
            geo.get("isp",          "")[:150] or None,
            geo.get("lat") if isinstance(geo.get("lat"), (int, float)) else None,
            geo.get("lon") if isinstance(geo.get("lon"), (int, float)) else None,
            (geo.get("timezone") or "")[:50]  or None,
            (geo.get("org")      or "")[:200] or None,
            (referer or "")[:500]    or None,
            body_size,
            (query_params or "")[:500] or None,
            resp_size,
            json.dumps(extra or {}),
        )
    except Exception as exc:
        logger.warning("audit.log_request failed: %s", exc)


# ── Login session writer ──────────────────────────────────────────────────────

async def log_login(
    *,
    role:       str,
    token_hint: str,
    ip:         str,
    user_agent: str,
    ttl_secs:   int,
) -> None:
    """
    Record a new login in login_sessions.
    Called once on successful /api/auth/login.
    """
    pool = get_pool()
    if not pool:
        return

    try:
        os_str, browser, device = parse_ua(user_agent or "")
        geo = await geo_lookup(ip or "")
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl_secs)

        await pool.execute(
            """
            INSERT INTO login_sessions (
                token_hint, role, expires_at,
                ip, user_agent, os, browser, device,
                country, country_code, city
            ) VALUES (
                $1, $2, $3,
                $4, $5, $6, $7, $8,
                $9, $10, $11
            )
            """,
            token_hint[:20],
            role,
            expires_at,
            (ip or "")[:45]          or None,
            (user_agent or "")[:500] or None,
            os_str[:100],
            browser[:100],
            device[:20],
            geo.get("country", "")[:80]     or None,
            geo.get("country_code", "")[:4] or None,
            geo.get("city", "")[:100]       or None,
        )
    except Exception as exc:
        logger.warning("audit.log_login failed: %s", exc)


# ── Session activity tracker ─────────────────────────────────────────────────

async def touch_session(token_hint: str) -> None:
    """
    Bump last_seen_at + request_count for this session.
    Rate-limited to once per 5 min per token_hint via Valkey.
    Safe to call as fire-and-forget on every authenticated request.
    """
    if not token_hint:
        return

    # Rate-limit via Valkey — skip DB write if we just did one < 5 min ago
    try:
        from .valkey import get_client as _vk
        vk = _vk()
        if vk:
            key = f"session_touch:{token_hint}"
            if await vk.exists(key):
                return
            await vk.set(key, "1", ex=300)
    except Exception:
        pass   # Valkey unavailable — still proceed to DB update

    pool = get_pool()
    if not pool:
        return

    try:
        await pool.execute(
            """
            UPDATE login_sessions
               SET last_seen_at  = NOW(),
                   request_count = request_count + 1,
                   is_active     = (expires_at > NOW())
             WHERE token_hint = $1
            """,
            token_hint[:20],
        )
    except Exception as exc:
        logger.debug("touch_session failed: %s", exc)
