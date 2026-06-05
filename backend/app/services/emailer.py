"""Transactional email delivery.

Configured by environment variables so production can use Zoho SMTP without
committing credentials. The service returns structured delivery results instead
of raising secrets or SMTP internals into public API responses.
"""

from __future__ import annotations

import asyncio
import logging
import smtplib
import socket
from email.message import EmailMessage
from email.utils import formataddr
from typing import Iterable

from ..config import settings

logger = logging.getLogger("fintrack.email")


def is_email_configured() -> bool:
    return bool(
        settings.smtp_host
        and settings.smtp_username
        and settings.smtp_password
        and (settings.smtp_from_email or settings.smtp_username)
    )


def _send_sync(to: list[str], subject: str, text: str, html: str | None = None) -> None:
    if not is_email_configured():
        raise RuntimeError("SMTP is not configured")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((settings.smtp_from_name or "FinTrack", settings.smtp_from_email or settings.smtp_username or ""))
    msg["To"] = ", ".join(to)
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")

    if settings.smtp_use_ssl:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
            smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
            smtp.ehlo()
            if settings.smtp_use_tls:
                smtp.starttls()
                smtp.ehlo()
            smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(msg)


async def send_email(to: str | Iterable[str], subject: str, text: str, html: str | None = None) -> dict:
    recipients = [x.strip() for x in ([to] if isinstance(to, str) else list(to)) if x and x.strip()]
    if not recipients:
        return {"sent": False, "reason": "no_recipient"}
    if not is_email_configured():
        return {"sent": False, "reason": "smtp_not_configured"}
    try:
        await asyncio.to_thread(_send_sync, recipients, subject, text, html)
        return {"sent": True, "recipients": recipients}
    except smtplib.SMTPAuthenticationError as exc:
        logger.warning("Email authentication failed: %s", exc)
        return {"sent": False, "reason": "smtp_auth_failed"}
    except (smtplib.SMTPConnectError, smtplib.SMTPServerDisconnected, socket.timeout, TimeoutError) as exc:
        logger.warning("Email connection failed: %s", exc)
        return {"sent": False, "reason": "smtp_connection_failed"}
    except smtplib.SMTPRecipientsRefused as exc:
        logger.warning("Email recipient refused: %s", exc)
        return {"sent": False, "reason": "recipient_refused"}
    except smtplib.SMTPSenderRefused as exc:
        logger.warning("Email sender refused: %s", exc)
        return {"sent": False, "reason": "sender_refused"}
    except Exception as exc:
        logger.warning("Email delivery failed: %s", exc)
        return {"sent": False, "reason": "smtp_error"}


def app_origin_from_request(request) -> str:
    origin = request.headers.get("origin") or request.headers.get("referer") or ""
    if origin:
        parts = origin.split("/", 3)
        if len(parts) >= 3:
            return "/".join(parts[:3])
    if settings.frontend_url and settings.frontend_url != "*":
        return settings.frontend_url.rstrip("/")
    return ""
