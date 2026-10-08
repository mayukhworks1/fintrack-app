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

The ban check runs on EVERY request, so it must cost nothing: it reads an
in-process table and never awaits. Valkey is ~210 ms from the Space, and the
first version of this module asked it "is this IP banned?" before routing
each request — a flat 210 ms tax on every call in the app, including the
health probe. Valkey is now touched only on the probe path (strike counting,
and writing a ban so it survives a restart) and once at startup, when the
bans it holds are loaded back into memory. A legitimate request never waits
on it. The Valkey helpers fail open, so an outage can only pause banning.
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


def is_banned(ip: str) -> bool:
    """Memory only, by design — this runs before routing on every request."""
    if not ip:
        return False
    return _mem_is_banned(ip, time.time())


_BAN_KEY_PREFIX = "scanner:ban:"


async def load_bans_from_valkey() -> int:
    """Rehydrate the in-memory ban table from Valkey, once, at startup.

    Bans are written to Valkey with their TTL when issued, so a restart does
    not forgive a scanner mid-ban. This is the only read of those keys; the
    per-request check never leaves the process. Returns the number loaded.
    """
    client = vk.get_client()
    if client is None:
        return 0
    loaded = 0
    now = time.time()
    try:
        async for key in client.scan_iter(_BAN_KEY_PREFIX + "*", count=500):
            name = key.decode() if isinstance(key, bytes) else str(key)
            ip = name[len(_BAN_KEY_PREFIX):]
            if not ip:
                continue
            ttl = await client.ttl(name)
            if ttl is None or ttl <= 0:
                continue
            _mem_bans[ip] = now + float(ttl)
            _mem_bans.move_to_end(ip)
            loaded += 1
        _trim(_mem_bans)
    except Exception as exc:
        logger.debug("scanner trap: could not load bans from valkey (%s)", exc)
    return loaded


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
