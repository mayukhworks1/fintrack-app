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
 *
 * Loading: a skeleton covers the frame until its document has loaded. A frame
 * that has not loaded after `loadTimeout` offers Try again (and, with
 * `openHref`, a link to open it on its own) instead of an endless blank box.
 *
 * Size: with `autoHeight` the frame follows the height its document reports
 * (the renderer posts it), between `minHeight` and `maxHeight`. Content that
 * just fills whatever box it is given (a 100vh layout) keeps `height`.
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

/**
 * The height an embed should take for a reported document size, or null to
 * keep the current one. A document as tall as its frame is sized by the frame
 * (100vh layouts), so following it would only feed back into itself.
 */
export function fitHeight({ height, viewport }, min = 160, max = 1200) {
  const h = Number(height), vp = Number(viewport)
  if (!(h > 0)) return null
  if (vp > 0 && Math.abs(h - vp) <= 2) return null
  return Math.round(Math.min(max, Math.max(min, h)))
}

const LOAD_TIMEOUT_MS = 15_000

function FrameSkeleton({ fullBleed }) {
  return (
    <div aria-hidden="true" data-artifact-skeleton=""
      style={{ position: 'absolute', inset: 0, padding: fullBleed ? 'clamp(16px,4vw,40px)' : 16, display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--card-bg, #fff)', overflow: 'hidden', pointerEvents: 'none' }}>
      <div style={{ width: '100%', maxWidth: fullBleed ? 960 : 'none', margin: fullBleed ? '0 auto' : 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="skeleton" style={{ height: 22, width: '45%' }} />
        <div className="skeleton" style={{ height: 12, width: '70%' }} />
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', marginTop: 6 }}>
          <div className="skeleton" style={{ height: 120, borderRadius: 12 }} />
          <div className="skeleton" style={{ height: 120, borderRadius: 12 }} />
        </div>
      </div>
    </div>
  )
}

const noticeBtn = { border: '1px solid var(--border, #d0d5dd)', borderRadius: 10, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'var(--card-bg, #fff)', color: 'var(--text-1, #14171f)', minHeight: 36 }

function FrameNotice({ title, message, onRetry, openHref, box }) {
  return (
    <div role="alert" data-artifact-fallback=""
      style={{ ...box, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 20, textAlign: 'center', background: 'var(--card-bg, #fff)', color: 'var(--text-1, #14171f)', boxSizing: 'border-box' }}>
      <strong style={{ fontSize: 14 }}>{title}</strong>
      <span style={{ fontSize: 13, color: 'var(--text-2, #5b6372)', maxWidth: 420, lineHeight: 1.5 }}>{message}</span>
      <span style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        {onRetry && <button type="button" style={noticeBtn} onClick={onRetry}>Try again</button>}
        {openHref && <a href={openHref} target="_blank" rel="noopener noreferrer" style={{ ...noticeBtn, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>Open in a new tab</a>}
      </span>
    </div>
  )
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
  autoHeight = false,
  minHeight = 160,
  maxHeight = 1200,
  loadTimeout = LOAD_TIMEOUT_MS,
  openHref,
  style,
}) {
  const frameRef = useRef(null)
  const [minted, setMinted] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [slow, setSlow] = useState(false)
  const [fit, setFit] = useState(null)

  // By id without a token: ask the API for one (only the page's author may).
  const needsMint = !srcOverride && !slug && !!pageId && !token
  useEffect(() => {
    if (!needsMint) return
    let cancelled = false
    setError(''); setMinted(null)
    api.pages.artifactToken(pageId)
      .then(res => {
        if (cancelled) return
        if (res?.token) setMinted(res.token)
        else setError(res?.detail || 'This artifact could not be loaded.')
      })
      .catch(e => { if (!cancelled) setError(e?.message || 'This artifact could not be loaded.') })
    return () => { cancelled = true }
  }, [needsMint, pageId, attempt])

  const src = srcOverride
    || (slug ? pageRenderUrl(slug, token) : null)
    || (pageId && (token || minted) ? artifactRenderUrl(pageId, token || minted) : null)

  const key = persist ? (storeKey || (slug ? `slug:${slug}` : pageId ? `page:${pageId}` : null)) : null

  // The frame's name carries the saved state in. It is read once per document
  // load, so it is computed when the frame (re)mounts — keyed on src below.
  const name = useMemo(() => {
    if (!key || !src) return undefined
    return STORE_MARK + JSON.stringify(readArtifactStore(key))
  }, [key, src, attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  // A new document starts loading: cover it, and give it a while to arrive.
  useEffect(() => {
    setLoaded(false); setSlow(false)
    if (!src || !(loadTimeout > 0)) return undefined
    const t = setTimeout(() => setSlow(true), loadTimeout)
    return () => clearTimeout(t)
  }, [src, attempt, loadTimeout])

  const onMessage = useCallback((e) => {
    const frame = frameRef.current
    if (!frame || e.source !== frame.contentWindow) return
    const d = e.data
    if (!d || typeof d !== 'object') return
    if (d.type === '__ft_artifact_store') {
      if (key) writeArtifactStore(key, d.data)
    } else if (d.type === '__ft_frame_size') {
      setLoaded(true)
      if (autoHeight) {
        const next = fitHeight(d, minHeight, maxHeight)
        if (next != null) setFit(next)
      }
    }
  }, [key, autoHeight, minHeight, maxHeight])

  useEffect(() => {
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onMessage])

  const retry = () => { setError(''); setFit(null); setAttempt(n => n + 1) }

  const frameHeight = fullBleed ? '100%' : (autoHeight && fit ? fit : height)
  const outer = fullBleed
    ? { position: 'fixed', inset: 0, width: '100%', height: '100%' }
    : { position: 'relative', width: '100%', minHeight: 120 }

  if (error) {
    return (
      <FrameNotice box={{ ...outer, height: fullBleed ? '100%' : height, border: fullBleed ? 'none' : '1px dashed var(--border, #ddd)', borderRadius: fullBleed ? 0 : 10, ...style }}
        title="This artifact couldn't load" message={error} onRetry={retry} openHref={openHref} />
    )
  }
  if (!src) {
    return (
      <div aria-busy="true" aria-label="Loading artifact" style={{ ...outer, height: fullBleed ? '100%' : height, ...style }}>
        <FrameSkeleton fullBleed={fullBleed} />
      </div>
    )
  }
  const showSlow = slow && !loaded
  return (
    <div data-artifact-box="" aria-busy={!loaded || undefined}
      style={{ ...outer, display: 'flex', flexDirection: 'column', ...style }}>
      <iframe
        key={`${src}#${attempt}`}
        ref={frameRef}
        src={src}
        name={name}
        title={title}
        sandbox={PAGE_SANDBOX}
        data-artifact-frame=""
        onLoad={() => setLoaded(true)}
        style={{ width: '100%', height: frameHeight, minHeight: fullBleed ? 0 : 120, flex: fullBleed || height === '100%' ? 1 : 'none', border: 'none', display: 'block', background: 'transparent', colorScheme: 'normal', opacity: loaded ? 1 : 0, transition: 'opacity .15s ease, height .15s ease' }}
      />
      {!loaded && !showSlow && <FrameSkeleton fullBleed={fullBleed} />}
      {showSlow && (
        <FrameNotice box={{ position: 'absolute', inset: 0 }}
          title="This is taking longer than usual"
          message="The artifact hasn't finished loading. Check your connection and try again."
          onRetry={retry} openHref={openHref} />
      )}
    </div>
  )
}
