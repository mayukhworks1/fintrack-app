"""
Fire-and-forget audit logger.

Every HTTP request (except health probes) is recorded in the PostgreSQL
`audit_log` table with:
  - role / token hint
  - method / path / status / duration
  - IP, user-agent, parsed OS / browser / device
  - country, region, city, ISP  (from ip-api.com via Valkey cache)
  - arbitrary extra JSONB

Usage
-----
    from ..db.audit import log_request
    asyncio.create_task(log_request(...))

All errors are swallowed — audit must never break the request path.
"""

import asyncio
import logging
import re
from typing import Optional

from .postgres import get_pool
from .geo import lookup as geo_lookup

logger = logging.getLogger("fintrack.db.audit")


# ── Tiny user-agent parser ──────────────────────────────────────────────────
# Deliberately lightweight — no heavy lib dependency.

_OS_PATTERNS = [
    (re.compile(r"Windows NT 10"),          "Windows 10"),
    (re.compile(r"Windows NT 11"),          "Windows 11"),
    (re.compile(r"Windows NT 6\.3"),        "Windows 8.1"),
    (re.compile(r"Windows NT 6\.2"),        "Windows 8"),
    (re.compile(r"Windows NT 6\.1"),        "Windows 7"),
    (re.compile(r"Windows"),                "Windows"),
    (re.compile(r"Android (\d+[\.\d]*)"),   "Android {0}"),
    (re.compile(r"iPhone.*?OS ([\d_]+)"),   "iOS {0}"),
    (re.compile(r"iPad.*?OS ([\d_]+)"),     "iPadOS {0}"),
    (re.compile(r"Mac OS X ([\d_]+)"),      "macOS {0}"),
    (re.compile(r"Linux"),                  "Linux"),
    (re.compile(r"CrOS"),                   "ChromeOS"),
]

_BROWSER_PATTERNS = [
    (re.compile(r"Edg/(\S+)"),              "Edge {0}"),
    (re.compile(r"OPR/(\S+)"),             "Opera {0}"),
    (re.compile(r"SamsungBrowser/(\S+)"),  "Samsung {0}"),
    (re.compile(r"Chrome/(\S+)"),          "Chrome {0}"),
    (re.compile(r"Firefox/(\S+)"),         "Firefox {0}"),
    (re.compile(r"Safari/(\S+)"),          "Safari"),
    (re.compile(r"curl/(\S+)"),            "curl {0}"),
    (re.compile(r"python-httpx/(\S+)"),    "httpx {0}"),
    (re.compile(r"python-requests/(\S+)"), "requests {0}"),
]

_MOBILE_UA = re.compile(r"Mobile|Android|iPhone|iPad", re.I)
_TABLET_UA = re.compile(r"iPad|Tablet", re.I)


def parse_ua(ua: str) -> tuple[str, str, str]:
    """Return (os, browser, device) — all strings, never None."""
    if not ua:
        return "Unknown", "Unknown", "Unknown"

    # OS
    os_str = "Unknown"
    for pattern, template in _OS_PATTERNS:
        m = pattern.search(ua)
        if m:
            if "{0}" in template and m.lastindex:
                os_str = template.format(m.group(1).replace("_", "."))
            else:
                os_str = template
            break

    # Browser
    browser_str = "Unknown"
    for pattern, template in _BROWSER_PATTERNS:
        m = pattern.search(ua)
        if m:
            if "{0}" in template and m.lastindex:
                ver = m.group(1).split(".")[0]   # major version only
                browser_str = template.format(ver)
            else:
                browser_str = template
            break

    # Device category
    if _TABLET_UA.search(ua):
        device = "tablet"
    elif _MOBILE_UA.search(ua):
        device = "mobile"
    else:
        device = "desktop"

    return os_str, browser_str, device


# ── Writer ──────────────────────────────────────────────────────────────────

async def log_request(
    *,
    role:        Optional[str],
    token_hint:  Optional[str],
    method:      str,
    path:        str,
    status:      int,
    duration_ms: int,
    request_id:  Optional[str],
    ip:          str,
    user_agent:  str,
    extra:       Optional[dict] = None,
) -> None:
    """
    Write one row to audit_log.  Designed to be called as a fire-and-forget
    asyncio task — all exceptions are caught and logged at DEBUG level.
    """
    pool = get_pool()
    if not pool:
        return

    try:
        os_str, browser, device = parse_ua(user_agent)
        geo = await geo_lookup(ip)

        await pool.execute(
            """
            INSERT INTO audit_log (
                role, token_hint,
                method, path, status, duration_ms, request_id,
                ip, user_agent, os, browser, device,
                country, country_code, region, city, isp,
                extra
            ) VALUES (
                $1, $2,
                $3, $4, $5, $6, $7,
                $8, $9, $10, $11, $12,
                $13, $14, $15, $16, $17,
                $18
            )
            """,
            role,
            token_hint,
            method[:10],
            path[:500],
            status,
            duration_ms,
            request_id,
            ip[:45] if ip else None,
            user_agent[:500] if user_agent else None,
            os_str[:100],
            browser[:100],
            device[:20],
            geo.get("country", "")[:80]       or None,
            geo.get("country_code", "")[:4]   or None,
            geo.get("region", "")[:100]       or None,
            geo.get("city", "")[:100]         or None,
            geo.get("isp", "")[:150]          or None,
            extra or {},
        )
    except Exception as exc:
        logger.debug("audit.log_request failed: %s", exc)
