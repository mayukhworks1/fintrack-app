"""
Scanner trap: answer vulnerability probes before routing, and ban repeaters.

The audit log for the last 46 days held 515 requests for /.env, /.env.local,
/file=../../.env, /mcp, /api/predict and friends — 232 for /mcp alone — from
54 IPs, all anonymous, all answered 404. Nothing was exposed. What they did do
was inflate the dashboard's 4xx rate to ~16% and bury real traffic in the
audit log. This module makes that noise stop at the door.

Behaviour, per request, in the middleware before call_next:

  banned IP      -> 403 immediately, nothing routed
  probe path     -> 404 immediately, strike recorded; strikes within the
                    window past the threshold -> ban for scanner_ban_seconds
  anything else  -> untouched

The path list is deliberately conservative: file-disclosure and traversal
patterns, well-known CMS/admin probes, and paths this app has never served.
A legitimate route must never match — a false positive here is a user locked
out for an hour — so nothing resembling a real API path is included.

Strikes and bans live in Valkey (shared across workers, survive restarts) with
a bounded in-memory fallback so the trap keeps working when Valkey is down.
Both Valkey helpers fail open on their own, so a Valkey outage can never block
legitimate traffic; it can only pause banning.
"""
from __future__ import annotations

import logging
import re
import time
from collections import OrderedDict
from typing import Any

from ..config import settings
from ..db import valkey as vk

logger = logging.getLogger("fintrack.scanner_trap")

# Compiled once. Patterns match the request path only (no query string), and
# are anchored at segment boundaries where a bare substring would be too broad.
_PROBE_PATTERNS = [
    r"(^|/)\.env(\.|$)",                  # /.env, /.env.local, /.env.production
    r"/\.\./|/\.\.$|\.\./\.env",          # traversal
    r"^/file=",                            # /file=../.env scanner idiom
    r"^/mcp(/|$)",                         # Model Context Protocol probes
    r"(^|/)\.git(/|$)",
    r"(^|/)\.aws(/|$)|(^|/)\.ssh(/|$)",
    r"/etc/passwd",
    r"/wp-(admin|login|content|includes)|/xmlrpc\.php",
    r"/phpmyadmin|/pma(/|$)",
    r"/actuator(/|$)",
    r"/cgi-bin/",
    r"\.php$",
    r"^/api/predict(/|$)|^/api/config(/|$)",   # probed 70x; never routes here
    r"/secrets\.toml|/backup/\.env|/config/\.env|^/root/",
]
_PROBE_RE = re.compile("|".join(f"(?:{p})" for p in _PROBE_PATTERNS), re.IGNORECASE)


def is_probe(path: str) -> bool:
    return bool(_PROBE_RE.search(path or ""))


# ── in-memory fallback (bounded) ─────────────────────────────────────────────

_MAX_TRACKED = 2000
_mem_strikes: "OrderedDict[str, list[float]]" = OrderedDict()
_mem_bans: "OrderedDict[str, float]" = OrderedDict()


def _trim(d: OrderedDict) -> None:
    while len(d) > _MAX_TRACKED:
        d.popitem(last=False)


def _mem_is_banned(ip: str, now: float) -> bool:
    until = _mem_bans.get(ip)
    if until is None:
        return False
    if now >= until:
        _mem_bans.pop(ip, None)
        return False
    return True


def _mem_strike(ip: str, now: float) -> int:
    window = float(settings.scanner_window_seconds)
    hits = [t for t in _mem_strikes.get(ip, []) if now - t < window]
    hits.append(now)
    _mem_strikes[ip] = hits
    _mem_strikes.move_to_end(ip)
    _trim(_mem_strikes)
    return len(hits)


def _mem_ban(ip: str, now: float) -> None:
    _mem_bans[ip] = now + float(settings.scanner_ban_seconds)
    _mem_bans.move_to_end(ip)
    _trim(_mem_bans)


# ── decisions ────────────────────────────────────────────────────────────────

_stats: dict[str, int] = {"probes": 0, "bans": 0, "blocked": 0}


async def is_banned(ip: str) -> bool:
    if not ip:
        return False
    now = time.time()
    if _mem_is_banned(ip, now):
        return True
    try:
        if vk.get_client() is not None:
            return await vk.key_exists(f"scanner:ban:{ip}")
    except Exception:
        pass
    return False


async def record_probe(ip: str) -> bool:
    """Record a strike for `ip`; returns True if this strike triggered a ban."""
    _stats["probes"] += 1
    if not ip:
        return False
    now = time.time()
    threshold = int(settings.scanner_strikes)

    if vk.get_client() is not None:
        try:
            allowed, _remaining = await vk.rate_check(
                ip, limit=threshold - 1, window_sec=int(settings.scanner_window_seconds), bucket="scanner",
            )
            if not allowed:
                await vk.set_nx(f"scanner:ban:{ip}", "1", ttl=int(settings.scanner_ban_seconds))
                _mem_ban(ip, now)                # mirror, so a Valkey blip mid-ban holds
                _stats["bans"] += 1
                logger.warning("scanner trap: banned %s for %ss after repeated probes",
                               ip, settings.scanner_ban_seconds)
                return True
            return False
        except Exception as exc:
            logger.debug("scanner trap: valkey unavailable (%s); using memory", exc)

    if _mem_strike(ip, now) >= threshold:
        _mem_ban(ip, now)
        _stats["bans"] += 1
        logger.warning("scanner trap: banned %s for %ss after repeated probes (memory)",
                       ip, settings.scanner_ban_seconds)
        return True
    return False


def note_blocked() -> None:
    _stats["blocked"] += 1


def state() -> dict[str, Any]:
    """For /health."""
    return {
        "enabled":   bool(settings.scanner_trap_enabled),
        "probes":    _stats["probes"],
        "bans":      _stats["bans"],
        "blocked":   _stats["blocked"],
        "mem_banned": sum(1 for u in _mem_bans.values() if u > time.time()),
    }
