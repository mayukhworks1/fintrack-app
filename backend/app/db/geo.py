"""
IP geolocation via ip-api.com (free, no key, 45 req/min for HTTP).

Fields captured:
  country, countryCode, regionName, city, isp,
  lat, lon, timezone, org   ← new in v2.4

Results are cached 24 h in Valkey so the same IP is only looked up once
per day.  Falls back to empty dict if the lookup fails or Valkey is down.
"""

import logging
import httpx
from .valkey import geo_get, geo_set

logger = logging.getLogger("fintrack.db.geo")

# All fields we want — comma-separated list.
# ip-api.com free tier allows up to 45 req/min; response is ~300 bytes.
_FIELDS = "status,country,countryCode,regionName,city,isp,lat,lon,timezone,org"
_API_URL = f"http://ip-api.com/json/{{ip}}?fields={_FIELDS}"
_TIMEOUT = 3.0   # seconds — fire-and-forget, don't slow down requests


_PRIVATE_PREFIXES = (
    "10.", "172.16.", "172.17.", "172.18.", "172.19.",
    "172.20.", "172.21.", "172.22.", "172.23.", "172.24.",
    "172.25.", "172.26.", "172.27.", "172.28.", "172.29.",
    "172.30.", "172.31.", "192.168.", "127.", "::1", "fc", "fd",
)


def _is_private(ip: str) -> bool:
    return ip in ("", "unknown") or any(ip.startswith(p) for p in _PRIVATE_PREFIXES)


async def lookup(ip: str) -> dict:
    """
    Return geolocation dict:
        {country, country_code, region, city, isp, lat, lon, timezone, org}
    Returns empty dict for private / loopback addresses or on any error.
    """
    if _is_private(ip):
        return {}

    # Check Valkey cache first
    cached = await geo_get(ip)
    if cached is not None:
        return cached

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(_API_URL.format(ip=ip))
        data = resp.json()
        if data.get("status") != "success":
            return {}
        geo = {
            "country":      data.get("country",     ""),
            "country_code": data.get("countryCode", ""),
            "region":       data.get("regionName",  ""),
            "city":         data.get("city",        ""),
            "isp":          data.get("isp",         ""),
            "lat":          data.get("lat"),          # float or None
            "lon":          data.get("lon"),          # float or None
            "timezone":     data.get("timezone",    ""),
            "org":          data.get("org",         ""),
        }
        # Cache for 24 h
        await geo_set(ip, geo)
        return geo
    except Exception as exc:
        logger.debug("geo.lookup(%s) failed: %s", ip, exc)
        return {}
