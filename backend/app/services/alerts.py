"""
Alerting: turn a silent failure into a message someone actually sees.

Until now the app could lose its sync loop, run out of database connections,
or start answering 500s, and the only trace was a log line nobody is paged to
read. Recovery was a manual /api/admin/watchdog call that depended on someone
noticing stale data first.

Five signals are evaluated once a minute:

  task_dead:<name>  a background loop (sync, aging, duration, embedding) has
                    exited with an exception — critical
  sync_stale        no successful incremental sync for alert_sync_stale_seconds
                    (or never, once past a grace period) — catches a loop that
                    is alive but failing every pass — critical
  postgres_down     POSTGRES_URL is set but there is no pool — critical
  pool_exhausted    every connection busy on N consecutive checks; a single
                    busy sample is normal under load and must not page — warning
  error_rate        5xx responses in the last window at or above the
                    threshold, counted by the request middleware on both the
                    normal and the unhandled-exception path — warning

Delivery is a Slack-compatible JSON webhook and/or email through the existing
Brevo integration (HF Spaces block SMTP). Either or both may be set; with
neither, the monitor logs once at startup and exits rather than idling.

Each alert key is deduplicated for alert_cooldown_seconds through Valkey's
set_nx, falling back to an in-memory table when Valkey is unavailable — the
one time an alerting system must not go quiet is when infrastructure is
failing. When a condition clears, one recovery notice is sent and the
cooldown is released so a relapse pages again.

Nothing here raises into the monitor loop: send_email already returns a
result dict instead of raising, the webhook call is wrapped, and the loop
body is wrapped. A crashed alerter is the failure this module exists to
prevent.
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from ..config import settings
from ..db import postgres, valkey as vk
from ..utils.http import shared_client

logger = logging.getLogger("fintrack.alerts")

_started_at: float = time.time()


# ── 5xx counter, fed by the request middleware ───────────────────────────────

_server_errors: deque[float] = deque()


def record_server_error() -> None:
    """Called by the middleware for any 5xx or unhandled exception."""
    _server_errors.append(time.time())


def server_errors_in_window(window_seconds: float) -> int:
    cutoff = time.time() - window_seconds
    while _server_errors and _server_errors[0] < cutoff:
        _server_errors.popleft()
    return len(_server_errors)


# ── background-task registry ─────────────────────────────────────────────────
# main.py owns the task handles and registers a provider; importing main from
# here would be circular.

_tasks_provider: Optional[Callable[[], dict[str, Optional[asyncio.Task]]]] = None


def register_tasks(provider: Callable[[], dict[str, Optional[asyncio.Task]]]) -> None:
    global _tasks_provider
    _tasks_provider = provider


# ── evaluation ───────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Alert:
    key: str
    severity: str      # "critical" | "warning" | "info"
    title: str
    detail: str


_pool_exhausted_streak: int = 0


async def evaluate() -> list[Alert]:
    """Return every condition currently firing. Pure read; sends nothing."""
    global _pool_exhausted_streak
    alerts: list[Alert] = []
    now = time.time()

    # Dead loops. A cancelled task is a shutdown, not a failure.
    if _tasks_provider is not None:
        try:
            for name, task in _tasks_provider().items():
                if task is None or not task.done() or task.cancelled():
                    continue
                exc = task.exception()
                alerts.append(Alert(
                    f"task_dead:{name}", "critical",
                    f"Background task '{name}' has died",
                    f"{type(exc).__name__}: {exc}" if exc else "exited without an exception",
                ))
        except Exception as exc:  # a broken provider must not stop the other checks
            logger.warning("alerts: task provider failed: %s", exc)

    # Sync staleness — in-process timestamps, no DB round trip.
    if settings.postgres_url and (settings.teable_api_token or settings.teable_web_api_token):
        try:
            from ..db import sync as sync_mod
            last = float(getattr(sync_mod, "_last_incremental_at", 0.0) or 0.0)
            stale_after = float(settings.alert_sync_stale_seconds)
            if last <= 0.0:
                if now - _started_at > 2 * stale_after:
                    alerts.append(Alert(
                        "sync_stale", "critical", "Teable sync has never completed",
                        f"No successful sync in {int(now - _started_at)}s since start.",
                    ))
            elif now - last > stale_after:
                alerts.append(Alert(
                    "sync_stale", "critical", "Teable sync is stale",
                    f"Last successful incremental sync {int(now - last)}s ago "
                    f"(threshold {int(stale_after)}s). The mirror is drifting from Teable.",
                ))
        except Exception as exc:
            logger.warning("alerts: sync check failed: %s", exc)

    # Postgres.
    pool = postgres.get_pool()
    if settings.postgres_url and pool is None:
        alerts.append(Alert(
            "postgres_down", "critical", "PostgreSQL is unavailable",
            postgres.get_init_error() or "pool is None",
        ))

    # Pool exhaustion — require a streak so one busy sample does not page.
    if pool is not None:
        try:
            size, idle, mx = pool.get_size(), pool.get_idle_size(), pool.get_max_size()
            if idle == 0 and size >= mx:
                _pool_exhausted_streak += 1
            else:
                _pool_exhausted_streak = 0
            if _pool_exhausted_streak >= int(settings.alert_pool_exhausted_checks):
                alerts.append(Alert(
                    "pool_exhausted", "warning", "Database pool exhausted",
                    f"All {mx} connections busy on {_pool_exhausted_streak} consecutive checks. "
                    "Requests are queueing on connection acquire.",
                ))
        except Exception as exc:
            logger.warning("alerts: pool check failed: %s", exc)

    # Error rate.
    n = server_errors_in_window(float(settings.alert_error_rate_window_seconds))
    if n >= int(settings.alert_error_rate_threshold):
        alerts.append(Alert(
            "error_rate", "warning", "Server error rate is elevated",
            f"{n} responses of 5xx (or unhandled exceptions) in the last "
            f"{int(settings.alert_error_rate_window_seconds)}s.",
        ))

    return alerts


# ── dedup / cooldown ─────────────────────────────────────────────────────────

_mem_cooldown: dict[str, float] = {}


async def _acquire_cooldown(key: str, ttl: int) -> bool:
    """True if this key may send now. Valkey first; in-memory when it is down."""
    try:
        if vk.get_client() is not None:
            return await vk.set_nx(f"alert:{key}", "1", ttl=ttl)
    except Exception as exc:
        logger.warning("alerts: valkey cooldown unavailable (%s); using memory", exc)
    now = time.time()
    if now < _mem_cooldown.get(key, 0.0):
        return False
    _mem_cooldown[key] = now + ttl
    return True


async def _release_cooldown(key: str) -> None:
    """Let a recovered condition page again immediately if it relapses."""
    _mem_cooldown.pop(key, None)
    try:
        client = vk.get_client()
        if client is not None:
            await client.delete(f"alert:{key}")
    except Exception:
        pass


# ── delivery ─────────────────────────────────────────────────────────────────

def is_configured() -> bool:
    return bool(settings.alert_webhook_url or settings.alert_email_to)


def _render(alert: Alert, recovered: bool) -> tuple[str, str]:
    tag = "RECOVERED" if recovered else alert.severity.upper()
    subject = f"[FinTrack {tag}] {alert.title}"
    body = f"{subject}\n\n{alert.detail}\n\nkey: {alert.key}\nat: {datetime.now(timezone.utc).isoformat()}"
    return subject, body


async def deliver(alert: Alert, *, recovered: bool = False) -> dict[str, Any]:
    """Send to every configured channel. Never raises; reports per-channel."""
    subject, body = _render(alert, recovered)
    results: dict[str, Any] = {}

    if settings.alert_webhook_url:
        try:
            async with shared_client(timeout=10) as client:
                r = await client.post(settings.alert_webhook_url, json={
                    "text": body,                      # Slack / Discord / generic
                    "title": alert.title,
                    "severity": "info" if recovered else alert.severity,
                    "detail": alert.detail,
                    "key": alert.key,
                    "recovered": recovered,
                    "service": "fintrack-api",
                    "time": datetime.now(timezone.utc).isoformat(),
                })
            results["webhook"] = r.status_code < 300
            if r.status_code >= 300:
                logger.warning("alerts: webhook returned %s", r.status_code)
        except Exception as exc:
            results["webhook"] = False
            logger.warning("alerts: webhook delivery failed: %s", exc)

    if settings.alert_email_to:
        try:
            from .emailer import send_email
            res = await send_email(settings.alert_email_to, subject, body)
            results["email"] = bool(res.get("sent"))
            if not res.get("sent"):
                logger.warning("alerts: email not sent: %s", res.get("reason"))
        except Exception as exc:
            results["email"] = False
            logger.warning("alerts: email delivery failed: %s", exc)

    return results


# ── one check, and the loop ──────────────────────────────────────────────────

_active: dict[str, Alert] = {}
_last_check_at: float = 0.0
_last_check: dict[str, Any] = {}


async def check_once() -> dict[str, Any]:
    """Evaluate, send what is new, send recoveries, update state."""
    global _last_check_at, _last_check
    firing = {a.key: a for a in await evaluate()}
    sent: list[str] = []
    recovered: list[str] = []

    for key, alert in firing.items():
        if await _acquire_cooldown(key, int(settings.alert_cooldown_seconds)):
            await deliver(alert)
            sent.append(key)

    for key in list(_active):
        if key not in firing:
            alert = _active.pop(key)
            await _release_cooldown(key)
            if await _acquire_cooldown(f"recovered:{key}", int(settings.alert_cooldown_seconds)):
                await deliver(alert, recovered=True)
                recovered.append(key)

    _active.update(firing)
    _last_check_at = time.time()
    _last_check = {"firing": sorted(firing), "sent": sent, "recovered": recovered}
    return _last_check


async def send_test_alert() -> dict[str, Any]:
    """Fire a real message through every configured channel — proves delivery."""
    alert = Alert("test", "info", "FinTrack test alert",
                  "Alert delivery is working. This was sent on request from the admin panel.")
    return {"configured": is_configured(), "delivery": await deliver(alert)}


def state() -> dict[str, Any]:
    """For /health: what is configured, what is firing, when we last looked."""
    return {
        "configured":    is_configured(),
        "webhook":       bool(settings.alert_webhook_url),
        "email":         bool(settings.alert_email_to),
        "active":        sorted(_active),
        "last_check_at": _last_check_at or None,
        "errors_in_window": server_errors_in_window(float(settings.alert_error_rate_window_seconds)),
    }


async def alert_monitor_loop() -> None:
    if not is_configured():
        logger.warning("alerting disabled — set ALERT_WEBHOOK_URL and/or ALERT_EMAIL_TO to enable")
        return
    logger.info("alert monitor started (every %ss, cooldown %ss)",
                settings.alert_check_interval_seconds, settings.alert_cooldown_seconds)
    await asyncio.sleep(30)   # let the other loops settle before judging them
    while True:
        try:
            await check_once()
        except Exception as exc:   # the alerter must outlive the thing it watches
            logger.error("alert monitor check failed: %s", exc)
        await asyncio.sleep(int(settings.alert_check_interval_seconds))
