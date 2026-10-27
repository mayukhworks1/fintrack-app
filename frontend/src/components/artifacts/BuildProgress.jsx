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

const clip = (t, n = 48) => { const v = String(t).replace(/\s+/g, ' ').trim(); return v.length > n ? v.slice(0, n - 1) + '…' : v }
const strip = (h) => h.replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ')

/**
 * What the streamed document shows has been done so far, in the order it was
 * written: the look, the screen's parts, the logic and the cloud data. Each
 * entry has a stable key so the feed can time-stamp it when it first appears.
 */
export function deriveMilestones(draft) {
  const d = draft || ''
  const out = []
  const seen = new Set()
  const add = (key, text) => { if (!seen.has(key)) { seen.add(key); out.push({ key, text }) } }
  if (/fonts\.googleapis\.com/i.test(d)) add('font', 'Loaded the typeface')
  if (/<style/i.test(d)) add('style', 'Started the stylesheet')
  if (/prefers-color-scheme:\s*dark/i.test(d)) add('dark', 'Added dark mode colours')
  const title = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(d)
  if (title && strip(title[1]).trim()) add('h1', `Header: “${clip(strip(title[1]), 40)}”`)
  for (const m of d.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)) {
    const t = strip(m[1]).trim()
    if (t) add(`h2:${t}`, `Section: “${clip(t, 40)}”`)
  }
  if (/<form/i.test(d)) add('form', 'Built the input form')
  for (const m of d.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/gi)) {
    const t = strip(m[1]).trim()
    if (t && out.filter(x => x.key.startsWith('label:')).length < 6) add(`label:${t}`, `Field: ${clip(t, 32)}`)
  }
  for (const m of d.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/gi)) {
    const t = strip(m[1]).trim()
    if (t && out.filter(x => x.key.startsWith('btn:')).length < 6) add(`btn:${t}`, `Button: ${clip(t, 32)}`)
  }
  if (/<table/i.test(d)) add('table', 'Laid out a table')
  if (/<script/i.test(d)) add('script', 'Started the app logic')
  for (const m of d.matchAll(/(?:function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>))/g)) {
    const name = m[1] || m[2]
    if (name && out.filter(x => x.key.startsWith('fn:')).length < 10) add(`fn:${name}`, `Wrote ${name}()`)
  }
  for (const m of d.matchAll(/collection\(\s*['"]([\w-]+)['"]/g)) add(`col:${m[1]}`, `Connected cloud data: “${m[1]}”`)
  if (/\.subscribe\(/.test(d)) add('sub', 'Turned on live sync')
  if (/<\/html>/i.test(d)) add('end', 'Closed the document')
  return out
}

const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

function useFeed(draft, activity) {
  const started = useRef(Date.now())
  const stamps = useRef(new Map())
  const milestones = deriveMilestones(draft).map(m => {
    if (!stamps.current.has(m.key)) stamps.current.set(m.key, Date.now())
    return { at: stamps.current.get(m.key), text: m.text, kind: 'work' }
  })
  const feed = [...(activity || []).map(a => ({ ...a, kind: 'status' })), ...milestones].sort((a, b) => a.at - b.at)
  return { feed, started: started.current }
}

function Feed({ feed, started, max, live }) {
  const ref = useRef(null)
  const shown = max ? feed.slice(-max) : feed
  useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight }, [shown.length])
  if (!shown.length) return null
  return (
    <ol ref={ref} aria-label="What has been done" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, maxHeight: max ? 'none' : 200, overflowY: 'auto' }}>
      {shown.map((f, i) => {
        const last = i === shown.length - 1
        return (
          <li key={`${f.at}-${f.text}`} style={{ display: 'flex', gap: 8, alignItems: 'baseline', color: last ? 'var(--text-1)' : 'var(--text-2)' }}>
            <span aria-hidden="true" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-3, var(--text-2))', fontSize: 11, minWidth: 30 }}>{mmss(f.at - started)}</span>
            <span aria-hidden="true" className={last && live ? 'live-dot' : undefined}
              style={last && live ? { alignSelf: 'center' } : { width: 6, height: 6, borderRadius: 99, flexShrink: 0, alignSelf: 'center', background: f.kind === 'status' ? 'var(--accent)' : 'var(--fin-positive)' }} />
            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{f.text}</span>
          </li>
        )
      })}
    </ol>
  )
}

function CodeTail({ draft, lines }) {
  const tail = draft.split('\n').slice(-lines).join('\n')
  return (
    <pre aria-hidden="true" style={{ margin: 0, padding: '10px 12px', background: '#0f1115', color: '#c9d1d9', borderRadius: 10, fontSize: 11.5, lineHeight: 1.55, fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: lines * 18 + 20 }}>
      {tail}<span className="artifact-caret">▍</span>
    </pre>
  )
}

export default function BuildProgress({ title, draft, thought, activity, reasoning, elapsed, onCancel, onWatchCode, storeKey, btnStyle, quietStyle }) {
  const step = currentStep(draft)
  const pct = buildPercent(draft)
  const liveUrl = useLiveSnapshot(draft, true)
  const lines = draft ? draft.split('\n').length : 0
  const slow = elapsed >= 75
  const { feed, started } = useFeed(draft, activity)
  const thinking = (reasoning || '').trim()
  const waiting = !draft && !thinking

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Loader2 size={18} className="animate-spin" aria-hidden="true" style={{ color: 'var(--accent)', flexShrink: 0 }} />
      <strong style={{ fontSize: 15, color: 'var(--text-1)' }}>{title}…</strong>
      <span aria-hidden="true" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{mmss(elapsed * 1000)}</span>
      <button type="button" style={btnStyle} onClick={onCancel}>Cancel</button>
    </div>
  )
  const bar = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        role="progressbar" aria-label="Build progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
        aria-valuetext={`${BUILD_STEPS[step].label}, about ${pct}%`}
        style={{ height: 6, borderRadius: 99, background: 'var(--bg-base)', overflow: 'hidden' }}
      >
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 99, background: 'var(--accent)', transition: 'width 600ms ease-out' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
        <span>Step {step + 1} of {BUILD_STEPS.length} · <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{BUILD_STEPS[step].label}</span></span>
        {draft ? <span>{formatSize(draft.length)} · {lines} lines</span> : null}
      </div>
    </div>
  )
  const note = (
    <p style={{ margin: 0, fontSize: 12.5, color: slow ? 'var(--fin-warning)' : 'var(--text-2)' }}>
      {slow
        ? 'Taking longer than usual. It is still working; if a model stalls, the next one takes over automatically.'
        : waiting ? 'Waiting for the model to start. Some models think for a while before writing.' : liveUrl ? 'The preview fills in as it is written.' : 'A live preview appears as soon as the screen takes shape.'}
    </p>
  )

  if (liveUrl) {
    const card = (
      <div data-artifact-progress="" style={{ width: 'min(360px, calc(100% - 24px))', padding: 14, display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left', background: 'var(--card-bg)', borderRadius: 14, border: '1px solid var(--border)', boxShadow: 'var(--shadow-popover)' }}>
        {header}{bar}
        <Feed feed={feed} started={started} max={3} live />
        {onWatchCode && <button type="button" style={{ ...quietStyle, alignSelf: 'flex-start' }} onClick={onWatchCode}>Show the code</button>}
      </div>
    )
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

  return (
    <div style={{ margin: 'auto', width: '100%', display: 'flex', justifyContent: 'center', padding: 16, boxSizing: 'border-box' }}>
      <div data-artifact-progress="" style={{ width: 'min(640px, 100%)', display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'left' }}>
        {header}
        {bar}
        {thought && !feed.length ? <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-2)' }}>{thought}</p> : null}
        <Feed feed={feed} started={started} live />
        {thinking && !draft ? (
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', background: 'var(--bg-base)' }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>Thinking</div>
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-2)', fontStyle: 'italic', maxHeight: 96, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              {thinking.slice(-420)}
            </p>
          </div>
        ) : null}
        {draft ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-2)' }}>
              <span style={{ fontFamily: 'ui-monospace,monospace' }}>index.html</span>
              {onWatchCode && <button type="button" style={{ ...quietStyle, marginLeft: 'auto' }} onClick={onWatchCode}>Show the full code</button>}
            </div>
            <CodeTail draft={draft} lines={10} />
          </div>
        ) : null}
        {note}
      </div>
    </div>
  )
}
