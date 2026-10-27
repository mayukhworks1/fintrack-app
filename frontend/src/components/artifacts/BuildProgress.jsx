/**
 * What the studio shows while an artifact is being written: real steps read
 * from the streamed document, a progress bar, how much has been written, and
 * a live preview of the part that is done so far.
 */
import { useEffect, useRef, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { api } from '../../services/api'
import { previewRenderUrl } from '../../utils/pageHtml'
import ArtifactFrame from './ArtifactFrame'

// Each step starts when its marker first appears in the streamed document.
export const BUILD_STEPS = [
  { key: 'read',   label: 'Reading your request',   test: () => true },
  { key: 'setup',  label: 'Setting up the page',    test: (d) => /<!doctype|<html|<head/i.test(d) },
  { key: 'style',  label: 'Designing the look',     test: (d) => /<style/i.test(d) },
  { key: 'layout', label: 'Laying out the screen',  test: (d) => /<body/i.test(d) },
  { key: 'logic',  label: 'Adding the calculations', test: (d) => /<script/i.test(d) },
  { key: 'finish', label: 'Finishing up',           test: (d) => /<\/body>|<\/html>/i.test(d) },
]

// A typical artifact runs to roughly this many characters.
const TYPICAL_SIZE = 14000

/** Index of the step in progress (later steps imply the earlier ones). */
export function currentStep(draft) {
  const d = draft || ''
  if (!d) return 0
  let at = 1
  BUILD_STEPS.forEach((s, i) => { if (i > 0 && s.test(d)) at = i })
  return at
}

/** 0–100, from the step reached and how much has been written; never 100 until done. */
export function buildPercent(draft) {
  const d = draft || ''
  if (!d) return 4
  const byStep = (currentStep(d) / BUILD_STEPS.length) * 100
  const bySize = Math.min(1, d.length / TYPICAL_SIZE) * 100
  return Math.round(Math.min(95, Math.max(8, byStep * 0.5 + bySize * 0.5)))
}

/**
 * The written part as a document that can be shown: an unfinished script or
 * style block is left out (half a script only throws), the browser closes the
 * remaining tags itself.
 */
export function previewableDraft(draft) {
  let d = draft || ''
  for (const tag of ['script', 'style']) {
    const open = d.toLowerCase().lastIndexOf(`<${tag}`)
    const close = d.toLowerCase().lastIndexOf(`</${tag}>`)
    if (open > close) d = d.slice(0, open)
  }
  return /<body/i.test(d) ? d : ''
}

function formatSize(n) {
  return n < 1000 ? `${n} characters` : `${(n / 1000).toFixed(1)} KB`
}

/**
 * Snapshots of the draft for the live preview: a new one once the body has
 * started, at most every few seconds and only when enough has been added.
 */
function useLiveSnapshot(draft, active) {
  const [url, setUrl] = useState('')
  const last = useRef({ at: 0, len: 0, busy: false })
  useEffect(() => {
    if (!active) { setUrl(''); last.current = { at: 0, len: 0, busy: false }; return undefined }
    const html = previewableDraft(draft)
    const l = last.current
    if (!html || l.busy) return undefined
    const wait = Math.max(0, 2500 - (Date.now() - l.at))
    if (l.at && html.length - l.len < 1200) return undefined
    let cancelled = false
    const timer = setTimeout(() => {
      l.busy = true
      api.pages.preview(html)
        .then(res => { if (!cancelled && res?.token) { setUrl(previewRenderUrl(res.token)); l.len = html.length } })
        .catch(() => { /* the next snapshot tries again */ })
        .finally(() => { l.busy = false; l.at = Date.now() })
    }, wait)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [draft, active])
  return url
}

/**
 * Each snapshot loads behind the one on screen and takes its place once it
 * has drawn, so the preview fills in without flashing blank.
 */
function LiveFrames({ url, storeKey }) {
  const [shown, setShown] = useState(url)
  const srcs = shown === url ? [url] : [shown, url]
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {srcs.map(src => {
        const front = src === shown
        return (
          <div key={src} aria-hidden={front ? undefined : 'true'} inert={front ? undefined : ''}
            style={front
              ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }
              : { position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none', display: 'flex', flexDirection: 'column' }}>
            <ArtifactFrame src={src} height="100%" title="Live preview of the artifact being built" storeKey={storeKey} persist={false} data={{ mode: 'memory' }}
              onLoad={front ? undefined : () => setTimeout(() => setShown(src), 200)} style={{ flex: 1, minHeight: 0 }} />
          </div>
        )
      })}
    </div>
  )
}

export default function BuildProgress({ title, draft, thought, elapsed, onCancel, onWatchCode, storeKey, btnStyle, quietStyle }) {
  const step = currentStep(draft)
  const pct = buildPercent(draft)
  const liveUrl = useLiveSnapshot(draft, true)
  const lines = draft ? draft.split('\n').length : 0
  const slow = elapsed >= 60

  const card = (
    <div
      data-artifact-progress=""
      style={{
        width: liveUrl ? 'min(340px, calc(100% - 24px))' : 'min(460px, 100%)',
        padding: liveUrl ? 14 : 24,
        display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left',
        background: 'var(--card-bg)', borderRadius: 14,
        border: liveUrl ? '1px solid var(--border)' : 'none',
        boxShadow: liveUrl ? 'var(--shadow-popover)' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Loader2 size={18} className="animate-spin" aria-hidden="true" style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <strong style={{ fontSize: 15, color: 'var(--text-1)' }}>{title}…</strong>
        <span aria-hidden="true" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{elapsed}s</span>
      </div>

      <div
        role="progressbar" aria-label="Build progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
        aria-valuetext={`${BUILD_STEPS[step].label}, about ${pct}%`}
        style={{ height: 6, borderRadius: 99, background: 'var(--bg-base)', overflow: 'hidden' }}
      >
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 99, background: 'var(--accent)', transition: 'width 600ms ease-out' }} />
      </div>

      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
        {BUILD_STEPS.map((s, i) => {
          const done = i < step
          const now = i === step
          if (liveUrl && !now && !done) return null
          if (liveUrl && done && i < step - 1) return null
          return (
            <li key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, color: done || now ? 'var(--text-1)' : 'var(--text-2)', fontWeight: now ? 600 : 400 }}>
              {done
                ? <Check size={14} aria-hidden="true" style={{ color: 'var(--fin-positive)', flexShrink: 0 }} />
                : <span aria-hidden="true" style={{ width: 14, height: 14, flexShrink: 0, borderRadius: 99, border: `2px solid ${now ? 'var(--accent)' : 'var(--border)'}`, boxSizing: 'border-box' }} />}
              {s.label}
              {done ? <span className="sr-only"> (done)</span> : now ? <span className="sr-only"> (in progress)</span> : null}
            </li>
          )
        })}
      </ol>

      {draft
        ? <p style={{ margin: 0, fontSize: 12, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{formatSize(draft.length)} written · {lines} lines</p>
        : thought ? <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>{thought}</p> : null}

      <p style={{ margin: 0, fontSize: 12.5, color: slow ? 'var(--fin-warning)' : 'var(--text-2)' }}>
        {slow
          ? 'Taking a little longer than usual. Still working; you can cancel and try a shorter request.'
          : liveUrl ? 'The preview fills in as it is written.' : 'Usually under a minute. A live preview appears here as soon as the screen takes shape.'}
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" style={btnStyle} onClick={onCancel}>Cancel</button>
        {onWatchCode && <button type="button" style={quietStyle} onClick={onWatchCode}>Show the code</button>}
      </div>
    </div>
  )

  if (!liveUrl) {
    return <div style={{ margin: 'auto', width: '100%', display: 'flex', justifyContent: 'center', padding: 16, boxSizing: 'border-box' }}>{card}</div>
  }
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-base)', fontSize: 12, color: 'var(--text-2)', flexShrink: 0 }}>
        <span className="live-dot" aria-hidden="true" />
        Live preview, still being built. Buttons may not work until it finishes.
      </div>
      <LiveFrames url={liveUrl} storeKey={storeKey} />
      <div style={{ position: 'absolute', right: 12, bottom: 12, display: 'flex', justifyContent: 'flex-end', left: 12, pointerEvents: 'none' }}>
        <div style={{ pointerEvents: 'auto' }}>{card}</div>
      </div>
    </div>
  )
}
