from __future__ import annotations

import asyncio
import json
import logging
import time

from ..db.postgres import get_pool
from .invoice import InvoiceService
from .web_invoice import WebInvoiceService

logger = logging.getLogger("fintrack.invoice_aging")

_REFRESH_INTERVAL = 3600  # 1 hour


async def _write_sync_log(source: str, total: int, updated: int, error: str | None, duration_ms: int, details: dict | None = None) -> None:
    pool = get_pool()
    if not pool:
        return
    try:
        await pool.execute(
            """
            INSERT INTO sync_log (source, total, created, updated, unchanged, duration_ms, error, details)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
            """,
            source,
            total,
            0,
            updated,
            max(total - updated, 0),
            duration_ms,
            error,
            json.dumps(details or {}),
        )
    except Exception as exc:
        logger.debug("aging sync_log write failed for %s: %s", source, exc)


async def _run_one(source: str, runner) -> None:
    started = time.time()
    try:
        result = await runner()
        duration_ms = int((time.time() - started) * 1000)
        await _write_sync_log(
            source,
            result.get("total", 0),
            result.get("updated", 0),
            None,
            duration_ms,
            {
                "updated_records": result.get("updated_records", []),
                "aging_mode": result.get("aging_mode"),
                "formula_dependency_ready": result.get("formula_dependency_ready"),
                "error": result.get("error"),
            },
        )
        logger.info("%s: total=%s updated=%s (%sms)", source, result.get("total", 0), result.get("updated", 0), duration_ms)
    except Exception as exc:
        duration_ms = int((time.time() - started) * 1000)
        await _write_sync_log(source, 0, 0, str(exc)[:500], duration_ms, {"updated_records": []})
        logger.warning("%s failed: %s", source, exc)


async def run_invoice_aging_refresh_cycle() -> None:
    await _run_one("invoices-aging-refresh", InvoiceService().touch_pending_aging_records)
    await _run_one("web-invoices-aging-refresh", WebInvoiceService().touch_pending_aging_records)


async def invoice_aging_refresh_loop() -> None:
    """Background loop — runs aging refresh every hour forever.

    Wrapped in a top-level try/except so a transient Teable error or DB
    hiccup cannot kill the loop permanently. On unexpected failure the loop
    sleeps for 5 minutes then retries.
    """
    await asyncio.sleep(15)
    while True:
        try:
            await run_invoice_aging_refresh_cycle()
        except Exception as exc:  # noqa: BLE001
            logger.error("invoice_aging_refresh_loop: unexpected top-level error: %s", exc, exc_info=True)
            await asyncio.sleep(300)  # back-off 5 min before retry
            continue
        try:
            await asyncio.sleep(_REFRESH_INTERVAL)
        except asyncio.CancelledError:
            logger.info("invoice_aging_refresh_loop: cancelled, exiting")
            return
