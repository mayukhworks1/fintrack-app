"""
The one place that decides which IP address a request came from.

Every per-IP control keys on this value: the login rate limit, the scanner-trap
ban, the mutation rate limits, and the IP written to audit_log, login_sessions,
record_history and the share-link access log. It used to be re-derived in a
dozen modules by taking the FIRST value of CF-Connecting-IP, X-Forwarded-For or
X-Real-IP, all of which the client sets freely on a directly reachable HF Space.
Rotating one of them gave every request a fresh rate-limit bucket, let anyone
get a victim's IP banned, and forged the IP in the audit trail.

Rules (settings in config.py):
  * CF-Connecting-IP and X-Real-IP are ignored unless TRUST_CF_CONNECTING_IP is
    true — set it only when the API is reachable solely through Cloudflare.
  * From X-Forwarded-For only the entry TRUSTED_PROXY_HOPS positions from the
    right is used: proxies APPEND, so the rightmost entry is the one our own
    reverse proxy wrote and everything to its left is client-supplied.
    0 ignores the header entirely.
  * Otherwise the socket peer (request.client.host).
A header value is used only if it parses as an IP address.
"""

from __future__ import annotations

import ipaddress

from ..config import settings


def _parse_ip(value: str) -> str:
    """Return `value` normalised as an IP address, or "" if it is not one.

    Tolerates the port suffixes some proxies add ("1.2.3.4:5678",
    "[2001:db8::1]:443"); anything else that is not an address is rejected.
    """
    value = (value or "").strip()
    if not value:
        return ""
    if value.startswith("["):
        end = value.find("]")
        if end == -1:
            return ""
        value = value[1:end]
    elif value.count(":") == 1:
        value = value.split(":", 1)[0]
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        return ""


def _forwarded_for(headers) -> list[str]:
    """Every X-Forwarded-For entry, left to right, across repeated headers."""
    getlist = getattr(headers, "getlist", None)
    raw = getlist("x-forwarded-for") if getlist else [headers.get("x-forwarded-for", "") or ""]
    return [part.strip() for line in raw for part in (line or "").split(",") if part.strip()]


def client_ip(request) -> str:
    """The client's IP address, or "" when nothing usable is known."""
    headers = request.headers

    if settings.trust_cf_connecting_ip:
        for header in ("cf-connecting-ip", "x-real-ip"):
            ip = _parse_ip(headers.get(header, "") or "")
            if ip:
                return ip

    hops = int(settings.trusted_proxy_hops or 0)
    if hops > 0:
        entries = _forwarded_for(headers)
        if len(entries) >= hops:
            ip = _parse_ip(entries[-hops])
            if ip:
                return ip

    client = getattr(request, "client", None)
    return (getattr(client, "host", "") or "") if client else ""
