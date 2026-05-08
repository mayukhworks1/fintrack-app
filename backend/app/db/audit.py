"""
Audit + session logger.

log_request()  — fire-and-forget: one row per HTTP request in audit_log
log_login()    — called on successful login: one row in login_sessions
touch_session() — fire-and-forget: bump last_seen_at + request_count
                  rate-limited to once per 5 min per token via Valkey

CRITICAL NOTE on asyncpg + JSONB
─────────────────────────────────
asyncpg does NOT automatically serialize Python dicts to JSONB.
Every JSONB parameter must be:
  - passed as json.dumps(value)   ← Python str containing valid JSON
  - bound with $N::jsonb cast     ← tells PostgreSQL to parse it
Failing to do this raises asyncpg.exceptions.DataError which is
silently swallowed, causing rows to never be inserted.
"""

import json
import logging
import re
import time
from datetime import datetime, timezone, timedelta
from typing import Optional

from .postgres import get_pool
from .geo import lookup as geo_lookup

logger = logging.getLogger("fintrack.db.audit")

# ── Tiny user-agent parser ──────────────────────────────────────────────────

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


# ── Audit log writer ─────────────────────────────────────────────────────────

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
    Write one row to audit_log.
    Fire-and-forget from middleware — all exceptions caught silently.

    New in v2.3: referer, body_size, query_params, resp_size columns.
    Uses ALTER TABLE ADD COLUMN IF NOT EXISTS in schema so the INSERT
    always works even on databases created before these columns existed.
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
                referer, body_size, query_params, resp_size,
                extra
            ) VALUES (
                $1,  $2,
                $3,  $4,  $5,  $6,  $7,
                $8,  $9,  $10, $11, $12,
                $13, $14, $15, $16, $17,
                $18, $19, $20, $21,
                $22::jsonb
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
            (referer or "")[:500]    or None,
            body_size,
            (query_params or "")[:500] or None,
            resp_size,
            json.dumps(extra or {}),   # ← JSONB: must be JSON string + ::jsonb cast
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

    # Rate-limit using Valkey (fail open if Valkey is down)
    try:
        from .valkey import get_client as _vk
        vk = _vk()
        if vk:
            key = f"session_touch:{token_hint}"
            if await vk.exists(key):
                return          # updated recently — skip this round
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
