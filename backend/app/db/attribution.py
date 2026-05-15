"""
Record-mutation attribution — actor context capture for record_history.

When a user mutates a record via the HTTP API, this module captures who/what/
where (role, IP, geo, OS, browser, device, path/method) and parks it briefly
in Valkey under `attrib:{teable_id}`.  The background Teable→PG sync loop
later pops that attribution and writes a fully-attributed row into the
`record_history` audit table.

Public API
──────────
build_actor_context(request, role, teable_id=None)  → dict
    Extract actor metadata from a FastAPI Request.  Pure / synchronous.

record_user_attribution(request, role, teable_id)
    Fire-and-forget: build context + push to Valkey.  Called by mutation
    endpoints (create / update / delete) right before they hit Teable.

pop_attribution(teable_id)  → dict | None
    Atomic GET-and-DEL.  Called by sync.upsert_record / mark_deleted.

empty_actor()  → dict
    The zero-value actor row (all sync_source='sync', None elsewhere) used
    when no attribution was found.

Why Valkey instead of passing context through service classes?
────────────────────────────────────────────────────────────────
The sync loop is decoupled from the request lifecycle — it polls Teable on
a fixed interval and writes whatever diffs it finds, with no knowledge of
which user triggered the upstream change.  A short-lived Valkey bridge is
the simplest correct way to attach actor context without entangling the
mutation handlers with the sync internals.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import Request

from . import valkey as vk
from .audit import parse_ua
from .geo import lookup as geo_lookup

logger = logging.getLogger("fintrack.db.attribution")


def _get_client_ip(request: Request) -> str:
    """Extract the real client IP from common proxy headers."""
    for header in ("x-forwarded-for", "x-real-ip", "cf-connecting-ip"):
        v = request.headers.get(header, "")
        if v:
            return v.split(",")[0].strip()
    return request.client.host if request.client else ""


def empty_actor() -> dict:
    """The 'no actor data' row — every key present so SQL bind is uniform."""
    return {
        "change_source":    "sync",
        "actor_role":       None,
        "actor_ip":         None,
        "actor_country":    None,
        "actor_city":       None,
        "actor_region":     None,
        "actor_isp":        None,
        "actor_lat":        None,
        "actor_lon":        None,
        "actor_os":         None,
        "actor_browser":    None,
        "actor_device":     None,
        "actor_user_agent": None,
        "actor_session_id": None,
        "actor_path":       None,
        "actor_method":     None,
    }


async def build_actor_context(
    request: Request,
    role: Optional[str],
    teable_id: Optional[str] = None,
) -> dict:
    """
    Build a full actor-attribution dict from a FastAPI Request.
    Geolocation is async (Valkey-cached, ~1 ms for repeat IPs).
    """
    ua = request.headers.get("user-agent", "") or ""
    ip = _get_client_ip(request)
    os_str, browser, device = parse_ua(ua)
    geo: dict = {}
    try:
        geo = await geo_lookup(ip) or {}
    except Exception as exc:
        logger.debug("geo_lookup(%s) failed: %s", ip, exc)

    # Session id may be set by future per-user session tracking; for now we
    # try a few likely header / state locations and fall back to None.
    session_id = (
        getattr(request.state, "session_id", None)
        or request.headers.get("x-session-id")
        or None
    )

    return {
        "change_source":    "user",
        "actor_role":       (role or "")[:20] or None,
        "actor_ip":         (ip or "")[:45] or None,
        "actor_country":    (geo.get("country") or "")[:80] or None,
        "actor_city":       (geo.get("city") or "")[:100] or None,
        "actor_region":     (geo.get("region") or "")[:100] or None,
        "actor_isp":        (geo.get("isp") or geo.get("org") or "")[:150] or None,
        "actor_lat":        geo.get("lat"),
        "actor_lon":        geo.get("lon"),
        "actor_os":         os_str[:100] or None,
        "actor_browser":    browser[:100] or None,
        "actor_device":     (device or "")[:20] or None,
        "actor_user_agent": ua[:1000] or None,
        "actor_session_id": session_id,
        "actor_path":       request.url.path[:200] if request.url else None,
        "actor_method":     (request.method or "")[:10] or None,
    }


async def record_user_attribution(
    request: Request,
    role: Optional[str],
    teable_id: str,
) -> None:
    """
    Fire-and-forget: capture actor context and push to Valkey for the next
    sync of `teable_id`.  Never raises — attribution loss is preferable to
    a mutation failure.
    """
    if not teable_id:
        return
    try:
        actor = await build_actor_context(request, role, teable_id)
        await vk.attribution_set(teable_id, actor, ttl=120)
    except Exception as exc:
        logger.debug("record_user_attribution(%s) failed: %s", teable_id, exc)


async def pop_attribution(teable_id: str) -> dict:
    """
    Pop the attribution for `teable_id` from Valkey.
    Always returns a dict (empty_actor() if nothing was found) so callers
    can pass it straight into the SQL bind list without None checks.
    """
    if not teable_id:
        return empty_actor()
    actor = await vk.attribution_pop(teable_id)
    if not actor or not isinstance(actor, dict):
        return empty_actor()
    # Defensive merge — guarantee all keys are present even if the cached
    # entry was written by an older code version.
    merged = empty_actor()
    merged.update(actor)
    return merged
