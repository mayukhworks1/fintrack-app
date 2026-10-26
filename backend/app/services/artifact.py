"""
Artifacts: small, self-contained web apps kept as pages.

An artifact is stored and served exactly like a Web Page (content_type "html"):
the same render URL, the same sandbox, the same Content-Security-Policy — see
services/page_render.py. What differs is what it is for. A Web Page is
something to read; an artifact is something to use — a calculator, a form, a
small dashboard. So it gets its own generation brief, and its link preview is
taken from the document itself when the author has not written one.
"""

from __future__ import annotations

import html as _html
import re

CONTENT_TYPE = "artifact"

# Content types served through the HTML renderer.
RENDERED_TYPES = ("html", CONTENT_TYPE)

# Script and style hosts an artifact may load from. The renderer's policy is
# broader than this; the brief is narrower on purpose, so a generated artifact
# depends on a handful of long-lived public CDNs and nothing else.
CDN_ALLOWLIST = (
    "https://cdnjs.cloudflare.com",
    "https://cdn.jsdelivr.net",
    "https://unpkg.com",
    "https://fonts.googleapis.com",
    "https://fonts.gstatic.com",
)


def is_rendered(content_type: str | None) -> bool:
    """True for every type the HTML renderer serves."""
    return (content_type or "") in RENDERED_TYPES


ARTIFACT_RULES = f"""You build small, self-contained interactive web apps ("artifacts"):
calculators, converters, trackers, forms, timers and compact dashboards.

THE ENVIRONMENT — the artifact is ONE HTML file served as its own document in a
sandboxed iframe with an opaque origin.
- Put everything in that one file: one <style> in <head>, one <script> before
  </body>. No relative URLs, no build step, no modules loaded from disk.
- NO network calls. Never use fetch, XMLHttpRequest, WebSocket, EventSource or
  sendBeacon, and never post a form anywhere. Everything the app needs is in
  the file or typed in by the person using it.
- External code only when it truly helps, and only from these CDNs, pinned to an
  exact version: {", ".join(CDN_ALLOWLIST)}. Prefer plain JavaScript and inline
  <svg> for charts and icons.
- State lives in localStorage only, behind try/catch, under one key prefixed
  with the app's name. The app must work (with defaults) when storage is empty
  or unavailable. Never use cookies or IndexedDB.
- No alert(), confirm() or prompt() for normal flow — show messages in the page.

WHAT GOOD LOOKS LIKE
- It works on first load with sensible example values already filled in, and
  every result updates as the inputs change.
- Indian conventions by default: rupee amounts formatted with
  Intl.NumberFormat('en-IN', {{style:'currency', currency:'INR'}}) (₹1,23,456.00),
  dates as DD MMM YYYY, GST and TDS terminology where relevant.
- Accessible: every input has a visible <label for>, buttons are <button>,
  results live in an element with aria-live="polite", colour is never the only
  signal, focus-visible outlines on everything interactive, contrast 4.5:1.
- Responsive: usable at 360px wide with no sideways scrolling. Use CSS grid or
  flex with minmax(0, 1fr) and min-width:0; no fixed pixel widths on containers.
- Light and dark: define colours as CSS custom properties on :root and redefine
  them inside @media (prefers-color-scheme: dark). Set color-scheme: light dark.
- Validate input. Never show NaN, Infinity or undefined — show a short hint.
- Include <!DOCTYPE html>, <meta charset="utf-8">, a viewport meta tag, a
  specific <title> and a one-sentence <meta name="description">.
- Keep it compact: finishing the file matters more than decoration. A file cut
  off mid-script does nothing at all.

OUTPUT FORMAT:
Return only the HTML document, <!DOCTYPE html> through </html>. No commentary,
no markdown code fences."""

# Appended to the search/replace brief when an artifact is being refined, so a
# revision keeps to the same constraints as the first build.
REVISION_NOTE = (
    "This document is an interactive artifact: a single self-contained HTML file "
    "in a sandboxed frame. Keep it that way: no network calls (fetch, XHR, "
    "WebSocket), external code only from "
    + ", ".join(CDN_ALLOWLIST)
    + ", state in localStorage only behind try/catch, labelled accessible inputs, "
    "responsive at 360px, and colours that work in both light and dark."
)


# --- link preview text --------------------------------------------------------

_META_DESC = re.compile(
    r"<meta\b[^>]*\bname\s*=\s*[\"']description[\"'][^>]*>", re.IGNORECASE
)
_CONTENT_ATTR = re.compile(r"\bcontent\s*=\s*(\"([^\"]*)\"|'([^']*)')", re.IGNORECASE)
_TITLE = re.compile(r"<title[^>]*>(.*?)</title\s*>", re.IGNORECASE | re.DOTALL)
_TAGS = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")

MAX_DESCRIPTION_CHARS = 200


def _clean(text: str) -> str:
    text = _html.unescape(_TAGS.sub(" ", text or ""))
    text = _SPACE.sub(" ", text).strip()
    if len(text) > MAX_DESCRIPTION_CHARS:
        text = text[: MAX_DESCRIPTION_CHARS - 1].rstrip() + "…"
    return text


def describe(content: str | None) -> str:
    """
    A one-line description of an artifact for its link preview: the document's
    own meta description, else its <title>, else nothing.
    """
    doc = content or ""
    for tag in _META_DESC.findall(doc):
        m = _CONTENT_ATTR.search(tag)
        if m:
            text = _clean(m.group(2) if m.group(2) is not None else m.group(3))
            if text:
                return text
    m = _TITLE.search(doc)
    return _clean(m.group(1)) if m else ""
