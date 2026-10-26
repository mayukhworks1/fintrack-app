/**
 * ArtifactFrame — shows an artifact in the same sandboxed frame as a Web Page.
 *
 * The document is never assembled here: it is served by the API's renderer
 * (backend/app/services/page_render.py) with its own Content-Security-Policy,
 * and framed by URL under PAGE_SANDBOX. That is what lets an artifact's script
 * run while keeping it walled off from the app (no allow-same-origin).
 *
 * Address it one of three ways:
 *   <ArtifactFrame slug="gst-calculator" />            a published artifact
 *   <ArtifactFrame slug="x" token={renderToken} />      a protected one
 *   <ArtifactFrame pageId={id} token={embedToken} />    by id, e.g. inside a
 *        document; with no token one is minted for the signed-in author.
 *
 * Storage: a sandboxed document has no localStorage of its own. The renderer
 * gives it an in-memory one, which this frame seeds from — and saves back to —
 * the app's storage on this device, under a key for this artifact. So an
 * artifact's state (form responses, settings) survives a reload.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE_URL, api } from '../../services/api'
import { PAGE_SANDBOX, pageRenderUrl } from '../../utils/pageHtml'

const STORE_PREFIX = 'ft_artifact_store:'
const STORE_MARK = '__ftstore:'
// Kept well under what a frame name and the app's storage quota tolerate.
export const MAX_STORE_CHARS = 200_000

/** URL of an artifact rendered by id with an embed token. */
export function artifactRenderUrl(pageId, token) {
  const q = token ? `?t=${encodeURIComponent(token)}` : ''
  return `${API_BASE_URL}/api/public/pages/by-id/${encodeURIComponent(pageId)}/render${q}`
}

export function readArtifactStore(key) {
  if (!key) return {}
  try {
    const raw = localStorage.getItem(STORE_PREFIX + key)
    const data = raw ? JSON.parse(raw) : {}
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch { return {} }
}

export function writeArtifactStore(key, data) {
  if (!key || !data || typeof data !== 'object' || Array.isArray(data)) return false
  const clean = {}
  for (const [k, v] of Object.entries(data)) clean[String(k)] = String(v)
  const raw = JSON.stringify(clean)
  if (raw.length > MAX_STORE_CHARS) return false
  try { localStorage.setItem(STORE_PREFIX + key, raw); return true } catch { return false }
}

export default function ArtifactFrame({
  slug,
  pageId,
  token,
  src: srcOverride,
  height = 480,
  title = 'Artifact',
  fullBleed = false,
  storeKey,
  persist = true,
  style,
}) {
  const frameRef = useRef(null)
  const [minted, setMinted] = useState(null)
  const [error, setError] = useState('')

  // By id without a token: ask the API for one (only the page's author may).
  const needsMint = !srcOverride && !slug && !!pageId && !token
  useEffect(() => {
    if (!needsMint) return
    let cancelled = false
    setError('')
    api.pages.artifactToken(pageId)
      .then(res => {
        if (cancelled) return
        if (res?.token) setMinted(res.token)
        else setError(res?.detail || 'This artifact could not be loaded.')
      })
      .catch(e => { if (!cancelled) setError(e?.message || 'This artifact could not be loaded.') })
    return () => { cancelled = true }
  }, [needsMint, pageId])

  const src = srcOverride
    || (slug ? pageRenderUrl(slug, token) : null)
    || (pageId && (token || minted) ? artifactRenderUrl(pageId, token || minted) : null)

  const key = persist ? (storeKey || (slug ? `slug:${slug}` : pageId ? `page:${pageId}` : null)) : null

  // The frame's name carries the saved state in. It is read once per document
  // load, so it is computed when the frame (re)mounts — keyed on src below.
  const name = useMemo(() => {
    if (!key || !src) return undefined
    return STORE_MARK + JSON.stringify(readArtifactStore(key))
  }, [key, src])

  const onMessage = useCallback((e) => {
    const frame = frameRef.current
    if (!key || !frame || e.source !== frame.contentWindow) return
    const d = e.data
    if (!d || typeof d !== 'object' || d.type !== '__ft_artifact_store') return
    writeArtifactStore(key, d.data)
  }, [key])

  useEffect(() => {
    if (!key) return
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [key, onMessage])

  const box = fullBleed
    ? { position: 'fixed', inset: 0, width: '100%', height: '100%' }
    : { width: '100%', height, minHeight: 120 }

  if (error) {
    return (
      <div role="alert" style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontSize: 13, color: 'var(--fin-warning, #a15c00)', border: fullBleed ? 'none' : '1px dashed var(--border, #ddd)', borderRadius: fullBleed ? 0 : 10, boxSizing: 'border-box', ...style }}>
        {error}
      </div>
    )
  }
  if (!src) {
    return (
      <div aria-busy="true" style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--text-2, #666)', ...style }}>
        Loading artifact…
      </div>
    )
  }
  return (
    <iframe
      key={src}
      ref={frameRef}
      src={src}
      name={name}
      title={title}
      sandbox={PAGE_SANDBOX}
      data-artifact-frame=""
      style={{ ...box, border: 'none', display: 'block', background: 'transparent', colorScheme: 'normal', ...style }}
    />
  )
}
