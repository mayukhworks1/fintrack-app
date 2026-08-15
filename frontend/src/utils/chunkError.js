/**
 * Detects a failed lazy-chunk load.
 *
 * Why this happens at all: chunk filenames are content-hashed, so a deploy
 * replaces Invoices-AAA.js with Invoices-BBB.js. A tab opened before the deploy
 * still holds the old name in memory, and requesting it now 404s. The SPA
 * catch-all rewrite turns that 404 into index.html, so the browser receives
 * HTML where it expected a module — hence the MIME-type wording in most of
 * these messages.
 *
 * Every engine words it differently, and matching only some of them is worse
 * than matching none: the recovery path silently does not run on the browsers
 * it missed. iOS Safari's phrasing shares no substring with Chrome's, which is
 * why this was only ever reported from iPhones.
 */
const PATTERNS = [
  // Chrome / Edge
  'failed to fetch dynamically imported module',
  'failed to load module script',
  // WebKit / iOS Safari — no wording in common with Chrome's version
  'is not a valid javascript mime type',
  'importing a module script failed',
  // Firefox
  'error loading dynamically imported module',
  'was blocked because of a disallowed mime type',
  // Vite's stylesheet preloader, same root cause
  'unable to preload css',
]

export function isChunkLoadError(error) {
  if (!error) return false
  // Webpack-style bundlers tag the error rather than relying on the message.
  if (error.name === 'ChunkLoadError') return true
  const msg = String(error.message || error).toLowerCase()
  return PATTERNS.some((p) => msg.includes(p))
}
