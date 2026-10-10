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
import math
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


# Hint fields the rest of this module reads as text, and the two it reads as
# objects. The header is client-controlled and unauthenticated: any other JSON
# type in these slots (a number, a list, a bare string for "ch") used to raise
# deep inside build_device_label or the batch insert and cost audit rows.
_HINT_TEXT_KEYS    = ("platform", "language", "locale", "timezone", "screen", "viewport", "gpu", "network")
_HINT_CH_TEXT_KEYS = ("platform", "platformVersion", "model", "arch", "bitness", "fullVersion")
_HINT_OBJECT_KEYS  = ("ch", "browserGeo")
_HINT_NUMBER_KEYS  = ("cores", "memoryGb")
_HINT_MAX_STR      = 500
# browserGeo numbers and the range a real navigator.geolocation fix stays in.
# A forged value outside it (lat 5000, accuracyM 1e300) is not a place, and
# failed the INTEGER accuracy_m / NUMERIC(9,6) lat-lon column it was bound to.
_HINT_GEO_RANGES   = {"lat": (-90, 90), "lon": (-180, 180), "accuracyM": (0, 2**31 - 1)}


def _clean_hint_value(value, depth: int = 0):
    """Strip NUL bytes (PostgreSQL text and JSONB both reject them), cap strings,
    and drop non-finite numbers (JSONB has no NaN/Infinity)."""
    if isinstance(value, str):
        return value.replace("\x00", "")[:_HINT_MAX_STR]
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        if depth >= 4:
            return None
        return {
            str(k).replace("\x00", "")[:100]: _clean_hint_value(v, depth + 1)
            for k, v in list(value.items())[:100]
        }
    if isinstance(value, list):
        if depth >= 4:
            return None
        return [_clean_hint_value(v, depth + 1) for v in value[:100]]
    return value


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _shape_hint(hint) -> dict:
    """Force the decoded hint into the shape the readers expect."""
    if not isinstance(hint, dict):
        return {}
    hint = _clean_hint_value(hint)
    for key in _HINT_OBJECT_KEYS:
        if key in hint and not isinstance(hint[key], dict):
            hint[key] = None
    for key in _HINT_TEXT_KEYS:
        if key in hint and not isinstance(hint[key], str):
            hint[key] = None
    for key in _HINT_NUMBER_KEYS:
        if key in hint and not _is_number(hint[key]):
            hint[key] = None
    ch = hint.get("ch")
    if isinstance(ch, dict):
        for key in _HINT_CH_TEXT_KEYS:
            if key in ch and not isinstance(ch[key], str):
                ch[key] = None
    geo = hint.get("browserGeo")
    if isinstance(geo, dict):
        for key, (lo, hi) in _HINT_GEO_RANGES.items():
            if key in geo and not (_is_number(geo[key]) and lo <= geo[key] <= hi):
                geo[key] = None
    return hint


def parse_client_hint(header_value: str) -> dict:
    """
    Decode the base64-encoded JSON device hint sent by the frontend.
    Returns a dict with extra device signals collected from JavaScript
    (UA Client Hints, GPU via WebGL, screen, timezone, RAM, cores, etc.).
    Returns an empty dict on any decode failure — never raises.
    The result is always a dict whose known fields have the expected types.
    """
    if not header_value:
        return {}
    try:
        import base64
        # Add padding if missing (some encoders strip it)
        padding = "=" * (-len(header_value) % 4)
        raw = base64.b64decode(header_value + padding, validate=False)
        return _shape_hint(json.loads(raw.decode("utf-8")) or {})
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
    hint = parse_client_hint(item.get("client_hint", "") or "")
    device_label = build_device_label(os_str, browser, device, hint)
    browser_geo = hint.get("browserGeo") or {}
    extra = dict(item.get("extra") or {})
    extra.update({
      "device_label": device_label or None,
      "device_model": ((hint.get("ch") or {}).get("model") or None),
      "platform_version": ((hint.get("ch") or {}).get("platformVersion") or None),
      "timezone": hint.get("timezone") or None,
      "language": hint.get("language") or hint.get("locale") or None,
      "network": hint.get("network") or None,
      "screen": hint.get("screen") or None,
      "viewport": hint.get("viewport") or None,
      "gpu": hint.get("gpu") or None,
      "cores": hint.get("cores") if isinstance(hint.get("cores"), int) else None,
      "memory_gb": hint.get("memoryGb") if isinstance(hint.get("memoryGb"), (int, float)) else None,
      "browser_geo": browser_geo if browser_geo else None,
      "geo_source": "browser" if browser_geo else "ip",
    })
    return {**item, "os_str": os_str, "browser": browser, "device": device, "geo": geo, "hint": hint, "extra": extra}


_AUDIT_INSERT_SQL = """
    INSERT INTO audit_log (
        role, token_hint,
        method, path, status, duration_ms, request_id,
        ip, user_agent, os, browser, device,
        country, country_code, region, city, isp,
        lat, lon, timezone, org,
        referer, body_size, query_params, resp_size,
        user_id, user_email, user_name,
        extra
    ) VALUES (
        $1,  $2,
        $3,  $4,  $5,  $6,  $7,
        $8,  $9,  $10, $11, $12,
        $13, $14, $15, $16, $17,
        $18, $19, $20, $21,
        $22, $23, $24, $25,
        $26::uuid, $27, $28,
        $29::jsonb
    )
"""


def _text(value, limit: int) -> str | None:
    """A text-column value: NUL bytes stripped (PostgreSQL rejects them in text,
    and uvicorn decodes a requested `/api/%00` into one), capped, '' → None."""
    if value is None:
        return None
    return str(value).replace("\x00", "")[:limit] or None


def _int_in_range(value, lo: int, hi: int) -> int | None:
    """An integer-column value, or None when it is not an int in [lo, hi] —
    e.g. a forged Content-Length beyond INTEGER range."""
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if lo <= value <= hi else None


def _finite(value) -> float | int | None:
    if not _is_number(value):
        return None
    return value if math.isfinite(value) else None


_INT4_MAX = 2**31 - 1


def _audit_record(item: dict) -> tuple:
    """Build the bind tuple for one audit row. Every client-controlled value is
    sanitised here so no single request can make the INSERT fail."""
    geo   = item.get("geo", {}) or {}
    extra = item.get("extra", {}) or {}
    bg    = extra.get("browser_geo", {}) or {}
    if not isinstance(geo, dict):
        geo = {}
    if not isinstance(bg, dict):
        bg = {}

    def _coord(d, key, fallback):
        v = _finite(d.get(key))
        return v if v is not None else fallback

    # Prefer browser geo over IP geo for lat/lon
    lat = _coord(bg, "lat", _coord(geo, "lat", None))
    lon = _coord(bg, "lon", _coord(geo, "lon", None))

    # Identity fields — populated for email-auth sessions
    raw_uid = extra.get("auth_user_id")
    user_id = None
    if raw_uid:
        try:
            import uuid as _uuid
            user_id = str(_uuid.UUID(str(raw_uid)))
        except Exception:
            user_id = None

    return (
        _text(item.get("role"), 20),
        _text(item.get("token_hint"), 20),
        _text(item.get("method"), 10) or "",
        _text(item.get("path"), 500) or "",
        _int_in_range(item.get("status"), -32768, 32767),
        _int_in_range(item.get("duration_ms"), -_INT4_MAX - 1, _INT4_MAX),
        _text(item.get("request_id"), 50),
        _text(item.get("ip"), 45),
        _text(item.get("user_agent"), 500),
        _text(item.get("os_str", "Unknown"), 100) or "Unknown",
        _text(item.get("browser", "Unknown"), 100) or "Unknown",
        _text(item.get("device", "desktop"), 20) or "desktop",
        _text(geo.get("country"), 80),
        _text(geo.get("country_code"), 4),
        _text(geo.get("region"), 100),
        _text(geo.get("city"), 100),
        _text(geo.get("isp"), 150),
        lat, lon,
        _text(geo.get("timezone"), 50),
        _text(geo.get("org"), 200),
        _text(item.get("referer"), 500),
        _int_in_range(item.get("body_size"), 0, _INT4_MAX),
        _text(item.get("query_params"), 500),
        _int_in_range(item.get("resp_size"), 0, _INT4_MAX),
        user_id,
        _text(extra.get("auth_user_email"), 320),
        _text(extra.get("auth_user_name"), 255),
        # JSONB — must be a JSON string. Its client-supplied parts come from
        # parse_client_hint, which already strips NULs and NaN/Infinity.
        json.dumps(extra, default=str),
    )


# asyncpg errors that mean the database, not the row, is the problem.
_DB_UNREACHABLE_ERRORS = {"PostgresConnectionError", "CannotConnectNowError", "TooManyConnectionsError"}


def _is_connection_error(exc: Exception) -> bool:
    """True when the database is unreachable, as opposed to one row being bad.

    asyncpg's classes are matched by name, so this never imports anything or
    raises: it runs inside the insert's own error handling.
    """
    if isinstance(exc, (OSError, asyncio.TimeoutError)):
        return True
    names = {c.__name__ for c in type(exc).__mro__ if c.__module__.startswith("asyncpg")}
    if names & _DB_UNREACHABLE_ERRORS:
        return True
    # InterfaceError covers "pool is closing" and the like; its DataError
    # subclass (also a ValueError) is a per-row encoding failure.
    return "InterfaceError" in names and not isinstance(exc, ValueError)


async def _batch_insert_audit(pool, items: list[dict]) -> None:
    """
    Bulk-insert N audit rows in one executemany call.
    This is ~N× faster than individual pool.execute calls and reduces
    connection-pool contention under load.

    executemany is atomic, so one bad row used to discard the whole batch —
    up to 100 rows of every concurrent user's activity. Rows are sanitised
    first, and if the batch still fails each row is retried on its own —
    unless the database itself is unreachable, when retrying cannot help.
    """
    if not items or not pool:
        return
    records = []
    for item in items:
        try:
            records.append(_audit_record(item))
        except Exception as exc:
            logger.warning("audit row skipped (could not build bind values): %s", exc)
    if not records:
        return
    try:
        await pool.executemany(_AUDIT_INSERT_SQL, records)
        return
    except Exception as exc:
        if _is_connection_error(exc):
            # Every single-row retry would fail the same way, each after its
            # own connect timeout and with its own warning line.
            logger.warning("audit batch insert failed (%d rows): %s", len(records), exc)
            return
        logger.warning("audit batch insert failed (%d rows), retrying row by row: %s", len(records), exc)

    failed = 0
    for i, record in enumerate(records):
        try:
            await pool.execute(_AUDIT_INSERT_SQL, *record)
        except Exception as exc:
            if _is_connection_error(exc):
                failed += len(records) - i
                logger.warning("audit row insert failed, database unreachable: %s", exc)
                break
            failed += 1
            logger.warning("audit row insert failed: %s", exc)
    if failed:
        logger.warning("audit fallback: %d of %d rows could not be inserted", failed, len(records))


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
        if len(good) < len(enriched):
            first_err = next(e for e in enriched if not isinstance(e, dict))
            logger.warning("audit: %d row(s) dropped, enrichment failed: %r",
                           len(enriched) - len(good), first_err)

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
    client_hint: str = "",
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
        hint = parse_client_hint(client_hint or "")
        ch = hint.get("ch") or {}
        device_label = build_device_label(os_str, browser, device, hint)
        browser_geo = hint.get("browserGeo") or {}
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl_secs)

        await pool.execute(
            """
            INSERT INTO login_sessions (
                token_hint, role, expires_at,
                ip, user_agent, os, browser, device,
                country, country_code, city, region, isp, lat, lon, timezone,
                device_label, device_model, platform_version
            ) VALUES (
                $1, $2, $3,
                $4, $5, $6, $7, $8,
                $9, $10, $11, $12, $13, $14, $15, $16,
                $17, $18, $19
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
            geo.get("region", "")[:100]     or None,
            (geo.get("isp") or geo.get("org") or "")[:150] or None,
            browser_geo.get("lat") if isinstance(browser_geo.get("lat"), (int, float)) else (geo.get("lat") if isinstance(geo.get("lat"), (int, float)) else None),
            browser_geo.get("lon") if isinstance(browser_geo.get("lon"), (int, float)) else (geo.get("lon") if isinstance(geo.get("lon"), (int, float)) else None),
            (hint.get("timezone") or geo.get("timezone") or "")[:60] or None,
            (device_label or "")[:255] or None,
            (ch.get("model") or "")[:120] or None,
            (ch.get("platformVersion") or "")[:40] or None,
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

    # Rate-limit via Valkey — skip DB write if we just did one < 5 min ago.
    # set_nx returns False if the key already existed → we already touched recently.
    try:
        from .valkey import set_nx
        key = f"session_touch:{token_hint}"
        if not await set_nx(key, "1", ttl=300):
            return   # rate-limit hit — skip DB write
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
