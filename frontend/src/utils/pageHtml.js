/**
 * How author-written HTML pages get onto the screen.
 *
 * The document itself is no longer built here. It is served by the API
 * (backend/app/services/page_render.py) and framed by URL, because a document
 * dropped into an iframe's `srcdoc` inherits the app's Content-Security-Policy
 * — which blocks every script, external stylesheet and web font an author
 * wrote. Pages built the ordinary way, with content revealed on scroll, then
 * published as a blank screen. A document fetched over the network carries its
 * own policy instead.
 *
 * What is left here is the embedding contract: where to point the frame, and
 * how tightly to sandbox it.
 */

import { API_BASE_URL } from '../services/api'

/**
 * Sandbox for author HTML.
 *
 * allow-same-origin is deliberately absent and must stay that way: beside
 * allow-scripts it voids the sandbox entirely, and were the API and the SPA
 * ever served from one origin the framed page could read a signed-in visitor's
 * auth token out of localStorage. Isolation rests on this attribute alone now
 * that the document's own CSP is permissive — see page_render.py.
 *
 * Kept in step with PAGE_SANDBOX in backend/app/services/page_render.py.
 */
export const PAGE_SANDBOX =
  'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox ' +
  'allow-modals allow-downloads'

/** URL of a published page's rendered document. `token` unlocks a protected page. */
export function pageRenderUrl(slug, token) {
  const q = token ? `?t=${encodeURIComponent(token)}` : ''
  return `${API_BASE_URL}/api/public/pages/${encodeURIComponent(slug)}/render${q}`
}

/** URL of an editor preview parked under a token by POST /api/pages/preview. */
export function previewRenderUrl(token) {
  return `${API_BASE_URL}/api/public/pages/preview/${encodeURIComponent(token)}`
}
