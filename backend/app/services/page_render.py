"""
Renders an author-written page into a real, standalone HTML document.

Why the API serves this document instead of the browser assembling it
--------------------------------------------------------------------
Published pages used to be handed to the SPA as a string and dropped into an
iframe's `srcdoc`. A srcdoc document is a *local scheme* document: it inherits
the embedder's Content-Security-Policy rather than carrying one of its own. The
app's policy is `script-src 'self'` with no 'unsafe-inline', so every script
inside an author's page was blocked — along with external stylesheets and web
fonts.

On a page of prose that was invisible. On anything built the way real landing
pages are built it was fatal, because of one near-universal idiom:

    .rv    { opacity: 0; transform: translateY(22px) }
    .rv.in { opacity: 1; transform: none }

Content stays hidden until an IntersectionObserver adds `.in`. With script
blocked the class never arrives, so the page published as a mostly blank
screen — no console error the author would see, nothing pointing at the cause.
Counters stayed at their placeholder "0", accordions never opened, tickers
stayed empty, and Fraunces/Inter/Plex fell back to Georgia.

A document fetched over the network carries its own CSP instead of inheriting
the embedder's, so serving it from here fixes all of that at the root. The
isolation that mattered is NOT lost: it never came from the CSP, it comes from
the iframe's sandbox attribute. Without allow-same-origin the document has an
opaque origin and cannot reach the embedding app — see PAGE_SANDBOX.
"""

from __future__ import annotations

import re

from ..config import settings

# ---------------------------------------------------------------------------
# Sandbox
# ---------------------------------------------------------------------------

# allow-same-origin is deliberately absent and must stay that way. With
# allow-scripts beside it the sandbox is void, and if the API and the SPA are
# ever deployed on one origin the framed document could read a signed-in
# visitor's auth token straight out of localStorage.
#
# allow-popups-to-escape-sandbox: a link to an external site otherwise opens
# into a tab that inherits the sandbox, so the destination loads opaque-origin
# and half-broken. The popup is a separate document at its own URL; letting it
# out is what makes an ordinary outbound link behave like an ordinary link.
PAGE_SANDBOX = (
    "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox "
    "allow-modals allow-downloads"
)

# ---------------------------------------------------------------------------
# Content-Security-Policy for the rendered document
# ---------------------------------------------------------------------------

# 'self' is useless here: the document is sandboxed to an opaque origin, so
# 'self' matches nothing at all. Every source has to be named by scheme.
#
# http: sits beside https: for local development only. It grants nothing in
# production — a browser blocks mixed content on an https page regardless of
# the policy, and upgrade-insecure-requests rewrites such URLs first anyway.
_SOURCES = {
    "default-src": "https: http: data: blob:",
    "script-src": "'unsafe-inline' 'unsafe-eval' https: http: data: blob:",
    "style-src": "'unsafe-inline' https: http: data:",
    "img-src": "https: http: data: blob:",
    "font-src": "https: http: data:",
    "media-src": "https: http: data: blob:",
    "connect-src": "https: http: data: blob:",
    "frame-src": "https: http: data: blob:",
    "form-action": "https: http:",
    "object-src": "'none'",
}

_DEV_FRAME_ANCESTORS = [
    "http://localhost:5173", "http://127.0.0.1:5173",
    "http://localhost:3000", "http://127.0.0.1:3000",
    "http://localhost:4173", "http://127.0.0.1:4173",
]


def frame_ancestors() -> str:
    """
    Who may embed a published page.

    FRONTEND_URL is the SPA that frames it, and production sets it (the CORS
    policy already depends on it). When it is unset the fallback is permissive
    rather than strict: getting this wrong does not degrade a published page,
    it stops the iframe loading at all, and a public marketing page being
    embeddable elsewhere is a far smaller problem than one that never renders.
    """
    raw = (settings.frontend_url or "").strip()
    if raw and raw != "*":
        origins = [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
        if origins:
            return " ".join(["'self'", *origins, *_DEV_FRAME_ANCESTORS])
    return " ".join(["'self'", "https:", *_DEV_FRAME_ANCESTORS])


def csp_header() -> str:
    parts = [f"{k} {v}" for k, v in _SOURCES.items()]
    parts.append(f"frame-ancestors {frame_ancestors()}")
    parts.append("upgrade-insecure-requests")
    return "; ".join(parts)


# ---------------------------------------------------------------------------
# Baseline styles
# ---------------------------------------------------------------------------

# Every rule is wrapped in :where() so it carries zero specificity and any
# author declaration — even a bare element selector — overrides it.
#
# The html/body margin rule is the fix for the left and right gaps that used to
# show on published pages: that inset was the browser's default 8px body
# margin, which no author asked for. The media rules stop an oversized image or
# a wide table from forcing sideways scroll on a phone, which author markup
# cannot be relied on to handle.
VIEWER_RESET = """
:where(html,body){margin:0;padding:0}
:where(*,*::before,*::after){box-sizing:border-box}
:where(body){overflow-x:hidden;overflow-wrap:break-word;-webkit-text-size-adjust:100%}
:where(img,svg,video,canvas){max-width:100%;height:auto}
:where(iframe,table,pre){max-width:100%}
:where(pre){overflow-x:auto}
:where(table){display:block;overflow-x:auto}
:where(img){background:#f1f5f9}
.__ft-img-failed{display:flex;align-items:center;justify-content:center;min-height:80px;
  padding:14px 16px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;
  color:#64748b;font:500 13px/1.4 system-ui,sans-serif;text-align:center}
""".strip()

# ---------------------------------------------------------------------------
# Runtime — a prelude before the author's markup, a pass after it
# ---------------------------------------------------------------------------

# The prelude has to run before any author script, because what it repairs is
# the environment those scripts assume exists.
VIEWER_PRELUDE = r"""
(function(){
  // An opaque origin has no storage area, so reading window.localStorage
  // throws SecurityError rather than returning an empty store. One unguarded
  // read at the top of an author's bundle — a theme toggle reading a saved
  // preference is the classic one — throws before anything else runs and takes
  // the whole page's behaviour down with it. An in-memory stand-in makes the
  // access succeed. A published page is ephemeral anyway, so losing
  // persistence between visits costs far less than losing the page.
  function memoryStorage(){
    var m = Object.create(null);
    return {
      getItem: function(k){ k = String(k); return k in m ? m[k] : null; },
      setItem: function(k, v){ m[String(k)] = String(v); },
      removeItem: function(k){ delete m[String(k)]; },
      clear: function(){ m = Object.create(null); },
      key: function(i){ var ks = Object.keys(m); return i < ks.length ? ks[i] : null; },
      get length(){ return Object.keys(m).length; }
    };
  }
  ['localStorage','sessionStorage'].forEach(function(name){
    var usable = true;
    try { var s = window[name]; s.setItem('__ft__','1'); s.removeItem('__ft__'); }
    catch (e) { usable = false; }
    if (usable) return;
    try { Object.defineProperty(window, name, { value: memoryStorage(), configurable: true }); }
    catch (e) {}
  });

  // history.pushState/replaceState also throw on an opaque origin. Pages use
  // them for tab state and filter state; swallowing the failure keeps the rest
  // of the click handler running.
  ['pushState','replaceState'].forEach(function(fn){
    var orig = window.history && window.history[fn];
    if (typeof orig !== 'function') return;
    try {
      window.history[fn] = function(){
        try { return orig.apply(window.history, arguments); } catch (e) { return undefined; }
      };
    } catch (e) {}
  });
})();
""".strip()

VIEWER_RUNTIME = r"""
(function(){
  // Links: a plain click would otherwise navigate the frame itself, replacing
  // the published page with the destination site inside the same box. Hash
  // links are left alone so in-page navigation keeps working natively.
  function hardenLinks(root){
    var links = (root || document).querySelectorAll('a[href]:not([data-ft-link])');
    Array.prototype.forEach.call(links, function(a){
      a.setAttribute('data-ft-link','');
      var h = a.getAttribute('href') || '';
      if (!h || h.charAt(0) === '#') return;
      if (h.slice(0,10).toLowerCase() === 'javascript') return;
      if (a.hasAttribute('target')) return;   // the author chose; respect it
      a.setAttribute('target','_blank');
      a.setAttribute('rel','noopener noreferrer');
    });
  }

  // Images: lazy by default, and a readable placeholder carrying the alt text
  // instead of the browser's broken-image glyph when a src 404s or a host
  // refuses hotlinking. A page written elsewhere and pasted in often points at
  // files that only existed next to the original.
  function handleImages(root){
    var imgs = (root || document).querySelectorAll('img:not([data-ft-img])');
    Array.prototype.forEach.call(imgs, function(img){
      img.setAttribute('data-ft-img','');
      if (!img.hasAttribute('loading')) img.setAttribute('loading','lazy');
      if (!img.hasAttribute('decoding')) img.setAttribute('decoding','async');
      var fail = function(){
        if (img.__ftFailed) return;
        img.__ftFailed = true;
        var note = document.createElement('div');
        note.className = '__ft-img-failed';
        note.textContent = img.getAttribute('alt') || 'Image could not be loaded';
        if (img.parentNode) img.parentNode.replaceChild(note, img);
      };
      img.addEventListener('error', fail);
      // A src that already failed before this ran fires no further event.
      if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) fail();
    });
  }

  // A site that refuses to be framed leaves an empty box with no explanation.
  function annotateFrames(root){
    var frames = (root || document).querySelectorAll('iframe[src]:not([data-ft-frame])');
    Array.prototype.forEach.call(frames, function(fr){
      fr.setAttribute('data-ft-frame','');
      var src = fr.getAttribute('src') || '';
      if (!src || src.charAt(0) === '#' || src.slice(0,6) === 'about:') return;
      var link = document.createElement('a');
      link.href = src; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = 'Open in new tab ↗';
      link.style.cssText = 'display:inline-block;margin-top:6px;font:500 12px system-ui,sans-serif;color:#1a56db';
      if (fr.parentNode) fr.parentNode.insertBefore(link, fr.nextSibling);
    });
  }

  function pass(){ hardenLinks(); handleImages(); annotateFrames(); }

  pass();
  window.addEventListener('load', pass);
  if (window.MutationObserver && document.body) {
    var pending = 0;
    new MutationObserver(function(){
      // Anything rendered by the author's own script needs the same treatment,
      // but a pass per mutation would fight a busy page. Coalesce to a frame.
      if (pending) return;
      pending = requestAnimationFrame(function(){ pending = 0; pass(); });
    }).observe(document.body, { childList: true, subtree: true });
  }
})();
""".strip()


# ---------------------------------------------------------------------------
# Document assembly
# ---------------------------------------------------------------------------

_HAS_DOCUMENT = re.compile(r"^\s*(<!DOCTYPE|<html)", re.IGNORECASE)
_HEAD_OPEN = re.compile(r"<head[^>]*>", re.IGNORECASE)
_HTML_OPEN = re.compile(r"<html([^>]*)>", re.IGNORECASE)
_BODY_CLOSE = re.compile(r"</body\s*>", re.IGNORECASE)
_HTML_CLOSE = re.compile(r"</html\s*>", re.IGNORECASE)


def build_document(content: str | None, padded: bool = False) -> str:
    """
    Wrap author content into a complete document.

    The reset goes in as early in <head> as it can, so author styles come later
    and win on equal specificity — and :where() means they win regardless. The
    prelude follows immediately, because it has to be in place before the first
    author <script> executes.

    `padded` only affects a bare fragment. A full document keeps whatever
    spacing its author wrote.
    """
    body = content or ""
    pad = "\n:where(body){padding:14px}" if padded else ""
    head = (
        '<meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        f"<style>{VIEWER_RESET}{pad}</style>"
        f"<script>{VIEWER_PRELUDE}</script>"
    )
    runtime = f"<script>{VIEWER_RUNTIME}</script>"

    if not _HAS_DOCUMENT.match(body):
        return f"<!DOCTYPE html><html><head>{head}</head><body>{body}{runtime}</body></html>"

    # A full document. Insert into its <head> when there is one; when the author
    # wrote <html> without <head>, create one rather than drop the reset.
    if _HEAD_OPEN.search(body):
        out = _HEAD_OPEN.sub(lambda m: m.group(0) + head, body, count=1)
    elif _HTML_OPEN.search(body):
        out = _HTML_OPEN.sub(lambda m: f"<html{m.group(1)}><head>{head}</head>", body, count=1)
    else:
        return f"<!DOCTYPE html><html><head>{head}</head><body>{body}{runtime}</body></html>"

    if _BODY_CLOSE.search(out):
        return _BODY_CLOSE.sub(lambda m: runtime + m.group(0), out, count=1)
    if _HTML_CLOSE.search(out):
        return _HTML_CLOSE.sub(lambda m: runtime + m.group(0), out, count=1)
    return out + runtime


def render_headers(cacheable: bool = False) -> dict[str, str]:
    """Response headers for a rendered document."""
    return {
        "Content-Security-Policy": csp_header(),
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        # X-Frame-Options is deliberately NOT set. It has no origin list, so
        # SAMEORIGIN would block the SPA from framing this at all whenever the
        # API and the SPA are on different hosts. frame-ancestors above is the
        # header that actually expresses the rule.
        "Cache-Control": (
            "public, max-age=60" if cacheable else "no-store, no-cache, must-revalidate"
        ),
    }
