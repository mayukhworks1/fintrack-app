"""
Link previews for published pages.

WhatsApp, LinkedIn, Slack and the rest read a link's <meta property="og:*">
tags without running JavaScript, so the SPA's /p/:slug shell only ever showed
them the generic FinTrack card. The frontend host routes those crawlers here
instead (see frontend/vercel.json); people still get the SPA.

Two outputs: a tiny HTML document carrying the tags, and a 1200x630 card image
drawn from the page's own title and description.
"""

from __future__ import annotations

import html
import io
import os
import textwrap
from collections import OrderedDict
from functools import lru_cache

CARD_W, CARD_H = 1200, 630

_BG = (15, 15, 17)
_INK = (255, 255, 255)
_MUTE = (161, 164, 172)
_ACCENT = (37, 99, 235)
_ACCENT2 = (124, 58, 237)


@lru_cache(maxsize=8)
def _font(size: int, bold: bool = True):
    from PIL import ImageFont
    try:
        import reportlab
        path = os.path.join(os.path.dirname(reportlab.__file__), "fonts", "VeraBd.ttf" if bold else "Vera.ttf")
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default(size=size)


def _wrap(draw, text: str, font, width_px: int, max_lines: int) -> list[str]:
    """Greedy word wrap by measured width; the last line gets an ellipsis."""
    words = (text or "").split()
    lines: list[str] = []
    cur = ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if draw.textlength(trial, font=font) <= width_px:
            cur = trial
            continue
        if cur:
            lines.append(cur)
        cur = w
        if len(lines) == max_lines:
            break
    if cur and len(lines) < max_lines:
        lines.append(cur)
    consumed = " ".join(lines)
    if len(consumed) < len(" ".join(words)) and lines:
        last = lines[-1]
        while last and draw.textlength(last + "…", font=font) > width_px:
            last = last[:-1]
        lines[-1] = last.rstrip() + "…"
    return lines


def render_card_png(title: str, description: str = "", footer: str = "", badge: str = "") -> bytes:
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (CARD_W, CARD_H), _BG)
    d = ImageDraw.Draw(img)

    # Accent bar across the top, blue into violet.
    for x in range(CARD_W):
        t = x / CARD_W
        c = tuple(int(_ACCENT[i] + (_ACCENT2[i] - _ACCENT[i]) * t) for i in range(3))
        d.line([(x, 0), (x, 10)], fill=c)

    pad = 80
    width = CARD_W - pad * 2
    y = 96

    if badge:
        bf = _font(26)
        bw = int(d.textlength(badge, font=bf)) + 36
        d.rounded_rectangle([pad, y, pad + bw, y + 46], radius=23, fill=(39, 39, 45))
        d.text((pad + 18, y + 9), badge, font=bf, fill=_INK)
        y += 78

    tf = _font(64)
    for line in _wrap(d, title or "Untitled page", tf, width, 3 if not description else 2):
        d.text((pad, y), line, font=tf, fill=_INK)
        y += 80

    if description:
        y += 14
        df = _font(32, bold=False)
        for line in _wrap(d, description, df, width, 2):
            d.text((pad, y), line, font=df, fill=_MUTE)
            y += 46

    if footer:
        ff = _font(28)
        d.text((pad, CARD_H - 64 - 28), footer, font=ff, fill=_MUTE)

    out = io.BytesIO()
    img.save(out, format="PNG", optimize=True)
    return out.getvalue()


# Small in-process cache: a link pasted into a group chat is fetched by every
# member's client, and drawing the card is the only non-trivial work here.
_CARD_CACHE: "OrderedDict[tuple, bytes]" = OrderedDict()
_CARD_CACHE_MAX = 64


def card_png_cached(key: tuple, **kw) -> bytes:
    if key in _CARD_CACHE:
        _CARD_CACHE.move_to_end(key)
        return _CARD_CACHE[key]
    png = render_card_png(**kw)
    _CARD_CACHE[key] = png
    while len(_CARD_CACHE) > _CARD_CACHE_MAX:
        _CARD_CACHE.popitem(last=False)
    return png


def share_html(*, title: str, description: str, url: str, image: str, site_name: str) -> str:
    e = lambda s: html.escape(s or "", quote=True)  # noqa: E731
    desc = textwrap.shorten(description or "", width=200, placeholder="…")
    return (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        f"<title>{e(title)}</title>"
        f"<meta name=\"description\" content=\"{e(desc)}\">"
        f"<meta property=\"og:type\" content=\"website\">"
        f"<meta property=\"og:site_name\" content=\"{e(site_name)}\">"
        f"<meta property=\"og:title\" content=\"{e(title)}\">"
        f"<meta property=\"og:description\" content=\"{e(desc)}\">"
        f"<meta property=\"og:url\" content=\"{e(url)}\">"
        f"<meta property=\"og:image\" content=\"{e(image)}\">"
        "<meta property=\"og:image:type\" content=\"image/png\">"
        f"<meta property=\"og:image:width\" content=\"{CARD_W}\">"
        f"<meta property=\"og:image:height\" content=\"{CARD_H}\">"
        f"<meta property=\"og:image:alt\" content=\"{e(title)}\">"
        "<meta name=\"twitter:card\" content=\"summary_large_image\">"
        f"<meta name=\"twitter:title\" content=\"{e(title)}\">"
        f"<meta name=\"twitter:description\" content=\"{e(desc)}\">"
        f"<meta name=\"twitter:image\" content=\"{e(image)}\">"
        f"<link rel=\"canonical\" href=\"{e(url)}\">"
        f"</head><body><a href=\"{e(url)}\">{e(title)}</a></body></html>"
    )
