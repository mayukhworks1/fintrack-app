// Shared HTML-sanitisation helpers for the hand-rolled markdown renderers.
//
// The Pages markdown renderers build HTML strings and inject them with
// dangerouslySetInnerHTML. Page content is authored by users and, for public
// pages, rendered to anonymous visitors — so any raw HTML in the source must be
// neutralised and any URL placed into an attribute must be both scheme-checked
// and attribute-escaped. Keep these two helpers as the single source of truth.

/** Escape a value destined for an HTML attribute (src, href, alt, …). */
export function escapeAttr(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Escape text destined for element content (neutralises tag injection). */
export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Return the URL if it uses a safe scheme, otherwise "#".
 * Blocks javascript:/vbscript:/file: and non-image data: URLs — the vectors
 * that turn a link or <img src> into script execution.
 */
export function safeUrl(url) {
  const u = String(url || '').trim()
  if (!u) return '#'
  if (/^(javascript|vbscript|file|blob):/i.test(u)) return '#'
  if (/^data:/i.test(u) && !/^data:image\//i.test(u)) return '#'
  return u
}
