"""Transactional email delivery via Brevo API (HTTPS).

SMTP ports are blocked on HF Spaces — Brevo is the only working backend.
Required secrets: BREVOAPIKEY, SMTP_FROM_EMAIL (sender address), SMTP_FROM_NAME (optional).
"""

from __future__ import annotations

import logging
import traceback
from typing import Iterable

import httpx

from ..config import settings

logger = logging.getLogger("fintrack.email")


def is_email_configured() -> bool:
    return bool(settings.brevoapikey and (settings.smtp_from_email or settings.smtp_username))


async def send_email(to: str | Iterable[str], subject: str, text: str, html: str | None = None) -> dict:
    recipients = [x.strip() for x in ([to] if isinstance(to, str) else list(to)) if x and x.strip()]
    if not recipients:
        return {"sent": False, "reason": "no_recipient"}
    if not is_email_configured():
        return {"sent": False, "reason": "email_not_configured"}

    from_email = settings.smtp_from_email or settings.smtp_username or ""
    from_name  = settings.smtp_from_name or "FinTrack"

    payload: dict = {
        "sender":      {"name": from_name, "email": from_email},
        "to":          [{"email": addr} for addr in recipients],
        "subject":     subject,
        "textContent": text,
        "headers": {
            "X-Priority": "1",
            "X-Mailer":   "FinTrack",
            "X-Category": "transactional",
        },
        "tags": ["transactional"],
    }
    if html:
        payload["htmlContent"] = html

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://api.brevo.com/v3/smtp/email",
                json=payload,
                headers={
                    "api-key":      settings.brevoapikey,
                    "Content-Type": "application/json",
                    "Accept":       "application/json",
                },
            )
        if resp.is_success:
            logger.info("Brevo delivered to %s", recipients)
            return {"sent": True, "recipients": recipients, "backend": "brevo"}
        # Surface the full Brevo error so admins can diagnose
        body = resp.text
        logger.error("Brevo HTTP %s: %s", resp.status_code, body)
        return {
            "sent":   False,
            "reason": "brevo_error",
            "detail": f"HTTP {resp.status_code}: {body}",
        }
    except Exception as exc:
        logger.error("Brevo delivery failed (%s): %s\n%s", type(exc).__name__, exc, traceback.format_exc())
        return {"sent": False, "reason": type(exc).__name__, "detail": str(exc)}


def app_origin_from_request(request) -> str:
    # Always prefer the configured frontend URL — request Origin/Referer headers
    # can point to third-party domains (e.g. accounts.google.com during OAuth).
    if settings.frontend_url and settings.frontend_url not in ("*", ""):
        return settings.frontend_url.rstrip("/")
    # Only fall back to request headers when frontend_url is not configured.
    origin = request.headers.get("origin") or request.headers.get("referer") or ""
    if origin:
        parts = origin.split("/", 3)
        if len(parts) >= 3:
            return "/".join(parts[:3])
    return ""
