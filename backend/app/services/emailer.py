"""Transactional email delivery via Brevo API (HTTPS).

SMTP ports are blocked on HF Spaces — Brevo is the only working backend.
Required secrets: BREVOAPIKEY, SMTP_FROM_EMAIL (sender address), SMTP_FROM_NAME (optional).
"""

from __future__ import annotations

import logging
import traceback
import urllib.error
import urllib.request
import json
from typing import Iterable

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
    from_name = settings.smtp_from_name or "FinTrack"
    payload: dict = {
        "sender": {"name": from_name, "email": from_email},
        "to": [{"email": addr} for addr in recipients],
        "subject": subject,
        "textContent": text,
        "headers": {
            "X-Priority": "1",
            "X-Mailer": "FinTrack",
            "X-Category": "transactional",
        },
        "tags": ["transactional"],
    }
    if html:
        payload["htmlContent"] = html

    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        "https://api.brevo.com/v3/smtp/email",
        data=data,
        headers={
            "api-key": settings.brevoapikey,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
            logger.info("Brevo delivered to %s", recipients)
            return {"sent": True, "recipients": recipients, "backend": "brevo"}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        logger.error("Brevo HTTP %s: %s", exc.code, body)
        return {"sent": False, "reason": "brevo_error", "detail": f"HTTP {exc.code}: {body}"}
    except Exception as exc:
        logger.error("Brevo delivery failed (%s): %s\n%s", type(exc).__name__, exc, traceback.format_exc())
        return {"sent": False, "reason": type(exc).__name__, "detail": str(exc)}


def app_origin_from_request(request) -> str:
    origin = request.headers.get("origin") or request.headers.get("referer") or ""
    if origin:
        parts = origin.split("/", 3)
        if len(parts) >= 3:
            return "/".join(parts[:3])
    if settings.frontend_url and settings.frontend_url != "*":
        return settings.frontend_url.rstrip("/")
    return ""
