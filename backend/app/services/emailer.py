"""Transactional email delivery.

Supports two backends, tried in order:
  1. Resend API  — if RESEND_API_KEY is set (works on HF Spaces, no SMTP ports needed)
  2. SMTP        — fallback for self-hosted / local use

HF Spaces blocks outbound SMTP ports (465/587), so Resend is the required
backend in production.
"""

from __future__ import annotations

import asyncio
import logging
import smtplib
import socket
import ssl
import traceback
from email.message import EmailMessage
from email.utils import formataddr
from typing import Iterable

from ..config import settings

logger = logging.getLogger("fintrack.email")


# ── Resend (HTTPS API) ────────────────────────────────────────────────────────

def _resend_key() -> str | None:
    return settings.resend_api_key or settings.resendapikey


def is_resend_configured() -> bool:
    return bool(_resend_key() and (settings.smtp_from_email or settings.smtp_username))


async def _send_via_resend(to: list[str], subject: str, text: str, html: str | None) -> None:
    import urllib.request, urllib.error, json
    from_addr = formataddr((settings.smtp_from_name or "FinTrack", settings.smtp_from_email or settings.smtp_username or ""))
    payload = {
        "from": from_addr,
        "to": to,
        "subject": subject,
        "text": text,
    }
    if html:
        payload["html"] = html

    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=data,
        headers={
            "Authorization": f"Bearer {_resend_key()}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read()
            logger.info("Resend delivered to %s: %s", to, body)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        raise RuntimeError(f"Resend HTTP {exc.code}: {body}") from exc


# ── SMTP (direct) ─────────────────────────────────────────────────────────────

def is_smtp_configured() -> bool:
    return bool(
        settings.smtp_host
        and settings.smtp_username
        and settings.smtp_password
        and (settings.smtp_from_email or settings.smtp_username)
    )


def is_email_configured() -> bool:
    return is_resend_configured() or is_smtp_configured()


def _send_smtp_sync(to: list[str], subject: str, text: str, html: str | None) -> None:
    logger.info(
        "Sending via SMTP %s:%s (ssl=%s tls=%s) from=%s to=%s",
        settings.smtp_host, settings.smtp_port,
        settings.smtp_use_ssl, settings.smtp_use_tls,
        settings.smtp_from_email or settings.smtp_username, to,
    )
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


# ── Public API ────────────────────────────────────────────────────────────────

async def send_email(to: str | Iterable[str], subject: str, text: str, html: str | None = None) -> dict:
    recipients = [x.strip() for x in ([to] if isinstance(to, str) else list(to)) if x and x.strip()]
    if not recipients:
        return {"sent": False, "reason": "no_recipient"}
    if not is_email_configured():
        return {"sent": False, "reason": "email_not_configured"}

    # Prefer Resend (works on HF Spaces); fall back to SMTP
    if is_resend_configured():
        try:
            await _send_via_resend(recipients, subject, text, html)
            return {"sent": True, "recipients": recipients, "backend": "resend"}
        except Exception as exc:
            logger.error("Resend delivery failed: %s\n%s", exc, traceback.format_exc())
            return {"sent": False, "reason": "resend_error", "detail": str(exc)}

    # SMTP fallback
    try:
        await asyncio.to_thread(_send_smtp_sync, recipients, subject, text, html)
        return {"sent": True, "recipients": recipients, "backend": "smtp"}
    except smtplib.SMTPAuthenticationError as exc:
        logger.error("SMTP auth failed: %s", exc)
        return {"sent": False, "reason": "smtp_auth_failed", "detail": str(exc)}
    except (smtplib.SMTPConnectError, smtplib.SMTPServerDisconnected, socket.timeout, TimeoutError) as exc:
        logger.error("SMTP connection failed: %s", exc)
        return {"sent": False, "reason": "smtp_connection_failed", "detail": str(exc)}
    except ssl.SSLError as exc:
        logger.error("SMTP SSL error: %s", exc)
        return {"sent": False, "reason": "ssl_error", "detail": str(exc)}
    except smtplib.SMTPException as exc:
        logger.error("SMTP error (%s): %s", type(exc).__name__, exc)
        return {"sent": False, "reason": f"smtp_{type(exc).__name__}", "detail": str(exc)}
    except Exception as exc:
        logger.error("Email delivery failed (%s): %s\n%s", type(exc).__name__, exc, traceback.format_exc())
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
