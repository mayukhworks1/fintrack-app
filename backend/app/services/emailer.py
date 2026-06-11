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


def email_wrap_html(title: str, preheader: str, body_html: str, to_email: str = "") -> str:
    """Wrap inner HTML in a fully-formed, inbox-friendly email document.

    Uses a table-based layout (required by Outlook/Gmail), includes DOCTYPE,
    charset meta, preheader text, and a plain footer — all of which reduce the
    chance of spam/newsletter classification.
    """
    from_name = settings.smtp_from_name or "FinTrack"
    footer_addr = "Works Media and Allied Services LLP &bull; Mumbai, India"
    recipient_line = f"This transactional email was sent to {to_email}." if to_email else "This is a transactional email."

    # Preheader is hidden text shown as preview in inbox — keeps it out of spam
    preheader_escaped = preheader.replace("<", "&lt;").replace(">", "&gt;")

    return f"""<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>{title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;-webkit-text-size-adjust:100%;mso-line-height-rule:exactly">
  <!--[if !vml]><!--><span style="display:none;font-size:1px;color:#f3f4f6;max-height:0;max-width:0;opacity:0;overflow:hidden">{preheader_escaped}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</span><!--<![endif]-->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background-color:#f3f4f6">
    <tr>
      <td align="center" style="padding:40px 16px">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width:520px">
          <!-- Brand header -->
          <tr>
            <td style="background:#0f172a;padding:22px 32px;border-radius:8px 8px 0 0">
              <span style="font-size:20px;font-weight:700;color:#ffffff;font-family:Inter,Arial,sans-serif;letter-spacing:-0.3px">{from_name}</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:32px 32px 24px;color:#111827;font-size:15px;line-height:1.65;font-family:Inter,Arial,sans-serif">
              {body_html}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:20px 32px;border-top:1px solid #e5e7eb;border-radius:0 0 8px 8px">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;font-family:Inter,Arial,sans-serif">
                {recipient_line}<br>
                {footer_addr}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


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
            # List-Unsubscribe is required by Gmail/Yahoo for deliverability (2024 rules).
            # Even for transactional email it signals good sender hygiene.
            "List-Unsubscribe":      f"<mailto:{from_email}?subject=unsubscribe>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            "X-Entity-Ref-ID":       "fintrack-transactional",
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
    if settings.frontend_url and settings.frontend_url not in ("*", ""):
        return settings.frontend_url.rstrip("/")
    origin = request.headers.get("origin") or request.headers.get("referer") or ""
    if origin:
        parts = origin.split("/", 3)
        if len(parts) >= 3:
            return "/".join(parts[:3])
    return ""
