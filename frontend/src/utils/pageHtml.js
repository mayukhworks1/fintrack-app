/**
 * Builds the document that author-written HTML pages are rendered into.
 *
 * Shared by the editor preview and the published viewer so what you see while
 * writing is what visitors get. They had drifted apart: the preview sandboxed
 * correctly while the published page did not.
 */

/**
 * Baseline styles, wrapped in :where() so every rule has zero specificity and
 * any author declaration — even a bare element selector — overrides it.
 *
 * html/body margin is the fix for the left and right gaps on published pages:
 * the browser's default 8px body margin was showing as an inset the author
 * never asked for. The media rules stop an oversized image from forcing
 * sideways scroll on a phone, which no author markup can be relied on to do.
 */
export const VIEWER_RESET = `
:where(html,body){margin:0;padding:0}
:where(*,*::before,*::after){box-sizing:border-box}
:where(body){overflow-x:hidden}
:where(img,svg,video,canvas){max-width:100%;height:auto}
:where(iframe,table,pre){max-width:100%}
:where(pre){overflow-x:auto}
:where(table){display:block;overflow-x:auto}
:where(img){background:#f1f5f9}
.__ft-img-failed{display:flex;align-items:center;justify-content:center;min-height:80px;
  padding:14px 16px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;
  color:#64748b;font:500 13px/1.4 system-ui,sans-serif;text-align:center}
`.trim()

/**
 * Runs inside the sandboxed frame. It has no access to the parent document —
 * the frame is deliberately opaque-origin — so it communicates by postMessage.
 */
export const VIEWER_RUNTIME = `
(function(){
  var CH = '__ft_page__';

  function hardenLinks(root){
    (root || document).querySelectorAll('a[href]').forEach(function(a){
      var h = a.getAttribute('href') || '';
      if (h.charAt(0) !== '#' && h.slice(0,10).toLowerCase() !== 'javascript') {
        a.setAttribute('target','_blank');
        a.setAttribute('rel','noopener noreferrer');
      }
    });
  }

  // Images: lazy by default, and a readable placeholder instead of the
  // browser's broken-image glyph when a src 404s or a host blocks hotlinking.
  function handleImages(root){
    (root || document).querySelectorAll('img').forEach(function(img){
      if (img.__ftBound) return;
      img.__ftBound = true;
      if (!img.hasAttribute('loading')) img.setAttribute('loading','lazy');
      if (!img.hasAttribute('decoding')) img.setAttribute('decoding','async');
      img.addEventListener('error', function(){
        if (img.__ftFailed) return;
        img.__ftFailed = true;
        var note = document.createElement('div');
        note.className = '__ft-img-failed';
        note.textContent = img.getAttribute('alt') || 'Image could not be loaded';
        if (img.parentNode) img.parentNode.replaceChild(note, img);
      });
    });
  }

  // Embedded frames that refuse to be framed leave a blank box; offer a way out.
  function annotateFrames(root){
    (root || document).querySelectorAll('iframe[src]').forEach(function(fr){
      if (fr.__ftBound) return;
      fr.__ftBound = true;
      var src = fr.getAttribute('src') || '';
      if (!src || src.charAt(0) === '#' || src.slice(0,6) === 'about:') return;
      var link = document.createElement('a');
      link.href = src; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = 'Open in new tab \\u2197';
      link.style.cssText = 'display:inline-block;margin-top:6px;font:500 12px system-ui,sans-serif;color:#1a56db';
      if (fr.parentNode) fr.parentNode.insertBefore(link, fr.nextSibling);
    });
  }

  // The parent cannot measure an opaque-origin document, so the height is
  // reported out. Without this the frame is a fixed box with its own scrollbar
  // sitting inside the page's scrollbar.
  var lastH = 0;
  function reportHeight(){
    var d = document.documentElement, b = document.body;
    var h = Math.max(
      d ? d.scrollHeight : 0, d ? d.offsetHeight : 0,
      b ? b.scrollHeight : 0, b ? b.offsetHeight : 0
    );
    if (!h || Math.abs(h - lastH) < 2) return;
    lastH = h;
    try { parent.postMessage({ channel: CH, type: 'height', height: h }, '*'); } catch (e) {}
  }

  function init(){
    hardenLinks(); handleImages(); annotateFrames(); reportHeight();
    if (window.ResizeObserver && document.body) {
      new ResizeObserver(reportHeight).observe(document.body);
    }
    if (window.MutationObserver && document.body) {
      new MutationObserver(function(){
        hardenLinks(); handleImages(); annotateFrames(); reportHeight();
      }).observe(document.body, { childList: true, subtree: true });
    }
    window.addEventListener('load', reportHeight);
    // Late-loading images and webfonts change layout after load.
    setTimeout(reportHeight, 300);
    setTimeout(reportHeight, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // In-document anchors, which cannot navigate normally inside the frame.
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!a) return;
    var id = a.getAttribute('href').slice(1);
    if (!id) return;
    var el = document.getElementById(id) || document.querySelector('[name="' + id + '"]');
    if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
})();
`.trim()

/** Channel name shared with the parent listener. */
export const PAGE_MESSAGE_CHANNEL = '__ft_page__'

const HAS_DOCTYPE = /^\s*(<!DOCTYPE|<html)/i

/**
 * Wraps author content into a complete document.
 *
 * The reset is injected as early in <head> as possible so author styles, which
 * come later, win on equal specificity — and :where() means they win anyway.
 */
export function buildPageDocument(content, { padded = false } = {}) {
  const body = String(content || '')
  const head =
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<base target="_blank">` +
    `<style>${VIEWER_RESET}${padded ? '\n:where(body){padding:14px}' : ''}</style>`
  const runtime = `<script>${VIEWER_RUNTIME}</script>`

  if (!HAS_DOCTYPE.test(body)) {
    return `<!DOCTYPE html><html><head>${head}</head><body>${body}${runtime}</body></html>`
  }

  // A full document. Insert into its <head> when there is one; when the author
  // wrote <html> without <head>, create one rather than dropping the reset.
  if (/<head[^>]*>/i.test(body)) {
    return body
      .replace(/<head([^>]*)>/i, (m, attrs) => `<head${attrs}>${head}`)
      .replace(/<\/body>/i, `${runtime}</body>`)
      .replace(/<\/html>/i, (m) => (/<\/body>/i.test(body) ? m : `${runtime}</html>`))
  }
  if (/<html[^>]*>/i.test(body)) {
    return body.replace(/<html([^>]*)>/i, (m, attrs) => `<html${attrs}><head>${head}</head>`)
               .replace(/<\/html>/i, `${runtime}</html>`)
  }
  return `<!DOCTYPE html><html><head>${head}</head><body>${body}${runtime}</body></html>`
}

/**
 * Sandbox for author HTML.
 *
 * allow-same-origin is deliberately absent. Combined with allow-scripts it
 * lets the framed document reach into the parent — and because published pages
 * are served from the app's own origin, that means reading the auth token of
 * any signed-in visitor. The two flags must never appear together here.
 */
export const PAGE_SANDBOX = 'allow-scripts allow-popups allow-forms'
