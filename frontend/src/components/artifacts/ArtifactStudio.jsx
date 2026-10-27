/**
 * The artifact editor: describe it, start from a template or paste HTML; then
 * a live preview (code one click away), with a change prompt to iterate.
 *
 * Every replacement of the code (a build, a change, a template, an upload)
 * can be undone from the note that reports it, so trying something is safe.
 *
 * Saving, publishing, sharing and version history are the page editor's job
 * (PagesManager's PageDrawer); this component only owns the document itself.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Link2, Loader2, Maximize2, Redo2, RotateCw, ShieldCheck, Undo2, X } from 'lucide-react'
import { api } from '../../services/api'
import { useConfirm } from '../../context/ConfirmContext'
import { isTopmostTrap } from '../../hooks/useFocusTrap'
import { previewRenderUrl } from '../../utils/pageHtml'
import StreamingDraft from '../StreamingDraft'
import ArtifactFrame, { readArtifactStore, writeArtifactStore } from './ArtifactFrame'
import ArtifactTemplates from './ArtifactTemplates'
import BuildProgress from './BuildProgress'
import ArtifactDataPanel from './ArtifactDataPanel'
import PlanCard, { PlanSkeleton } from './PlanCard'
import { readDontAsk, usablePlan } from './artifactPlan'
import { templateTitle } from './templates'
import { friendlyAiError, isNotSetUp, streamArtifact } from './artifactAi'

/** Starting points for the prompt: a short label, and the request it fills in. */
export const PROMPT_SUGGESTIONS = [
  { label: 'GST invoice builder', prompt: 'A GST invoice line-item calculator with HSN codes, CGST/SGST or IGST, and a printable summary' },
  { label: 'SIP goal planner', prompt: 'A savings goal planner that shows the monthly SIP needed to reach a target amount by a date, at an expected return' },
  { label: 'Cash runway', prompt: 'A cash runway calculator: cash in bank, monthly costs and expected income, showing how many months the cash lasts' },
  { label: 'Expense splitter', prompt: 'An expense splitter for a team trip: add people and expenses, and see who owes whom' },
  { label: 'Client onboarding checklist', prompt: 'A client onboarding checklist with progress, a note per step and a reset button' },
]

/** Follow-up changes offered once there is something to change. */
export const CHANGE_IDEAS = [
  'Add a reset button',
  'Add a print-friendly summary',
  'Show totals in words',
  'Make it easier to use on a phone',
]

const btn = { border: '1px solid var(--border)', borderRadius: 10, padding: '7px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'var(--card-bg)', color: 'var(--text-1)', minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }
const btnPrimary = { ...btn, background: 'var(--accent-btn)', color: 'var(--accent-fg)', border: '1px solid transparent' }
const btnSmall = { ...btn, padding: '4px 10px', minHeight: 28 }
const btnQuiet = { ...btnSmall, background: 'transparent', border: '1px solid transparent', color: 'var(--text-2)' }
const input = { display: 'block', width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card-bg)', color: 'var(--text-1)', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit' }
const sectionTitle = { margin: '0 0 4px', fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }
const sectionHint = { margin: '0 0 10px', fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }
const chip = { fontSize: 12, border: '1px solid var(--border)', borderRadius: 99, padding: '5px 12px', minHeight: 30, background: 'var(--bg-base)', color: 'var(--text-1)', cursor: 'pointer' }

function titleOf(html) {
  return html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || ''
}

/** Parks the draft behind a preview token so it renders through the real pipeline. */
function useArtifactPreview(content, nonce) {
  const [url, setUrl] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!content?.trim()) { setUrl(''); setErr(''); return }
    let cancelled = false
    const timer = setTimeout(() => {
      api.pages.preview(content)
        .then(res => {
          if (cancelled) return
          if (res?.token) { setUrl(previewRenderUrl(res.token)); setErr('') }
          else setErr('The preview could not be prepared.')
        })
        .catch(() => { if (!cancelled) setErr('The preview could not be prepared.') })
    }, 450)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [content, nonce])
  return { url, err }
}

function HtmlFileButton({ onLoad, label = 'Upload .html' }) {
  const ref = useRef(null)
  return (
    <>
      <input ref={ref} type="file" accept=".html,.htm,text/html" style={{ display: 'none' }}
        data-testid="artifact-file" tabIndex={-1} aria-hidden="true"
        onChange={async (e) => {
          const file = e.target.files?.[0]; e.target.value = ''
          if (!file) return
          try { onLoad(await file.text(), file.name) } catch { /* unreadable file: nothing to load */ }
        }} />
      <button type="button" style={btn} onClick={() => ref.current?.click()}>{label}</button>
    </>
  )
}

/**
 * The preview at the size of the screen, as a modal dialog. Everything behind
 * it is inert; Tab moves between the close button and the artifact (two edge
 * stops wrap focus round, since keys pressed inside the sandboxed frame never
 * reach this page). Escape (passed on by the preview when pressed inside the
 * artifact) or the button closes it, and focus goes back.
 */
function FullScreenPreview({ src, storeKey, title, onClose, data }) {
  const ref = useRef(null)
  const closeRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const dialog = ref.current
    const returnTo = document.activeElement
    const behind = [...document.body.children].filter(el => el !== dialog && !el.inert)
    behind.forEach(el => { el.inert = true })
    // Start on the close button, so Escape and Enter work straight away.
    const raf = requestAnimationFrame(() => closeRef.current?.focus())
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.preventDefault(); e.stopPropagation()
      onCloseRef.current()
    }
    // Escape pressed inside the artifact arrives from the preview's bridge.
    const onMsg = (e) => {
      const frame = dialog?.querySelector('iframe')
      if (frame && e.source === frame.contentWindow && e.data?.type === '__ft_escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('message', onMsg)
    return () => {
      cancelAnimationFrame(raf)
      behind.forEach(el => { el.inert = false })
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('message', onMsg)
      if (returnTo && document.contains(returnTo)) returnTo.focus?.()
    }
  }, [])
  const name = title || 'Artifact'
  const edge = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 }
  return createPortal(
    <div ref={ref} role="dialog" aria-modal="true" aria-label={`${name}, full screen`} tabIndex={-1}
      style={{ position: 'fixed', inset: 0, zIndex: 2700, display: 'flex', flexDirection: 'column', background: 'var(--card-bg)', outline: 'none' }}>
      <span tabIndex={0} data-focus-edge="" style={edge} onFocus={() => ref.current?.querySelector('iframe')?.focus()} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <strong style={{ fontSize: 13, color: 'var(--text-1)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</strong>
        <span style={{ fontSize: 12, color: 'var(--text-2)' }} aria-hidden="true">Esc to close</span>
        <button ref={closeRef} type="button" style={btn} onClick={onClose}><X size={14} aria-hidden="true" /> Exit full screen</button>
      </div>
      <ArtifactFrame src={src} height="100%" title={`${name} (full screen)`} storeKey={storeKey} data={data} style={{ flex: 1, minHeight: 0 }} />
      <span tabIndex={0} data-focus-edge="" style={edge} onFocus={() => closeRef.current?.focus()} />
    </div>,
    document.body,
  )
}

export default function ArtifactStudio({
  content, onChange, onTitle, pageId, title = '', canUseAi = false, isMobile = false,
  shareUrl = '', isPublished = false, onShare, onCopied,
}) {
  const confirm = useConfirm()
  // Opens on the result; the code is one click away.
  const [view, setView] = useState('preview')
  const [prompt, setPrompt] = useState('')
  const [change, setChange] = useState('')
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState('create')
  const [thought, setThought] = useState('')
  const [draft, setDraft] = useState('')
  const [edits, setEdits] = useState([])
  const [elapsed, setElapsed] = useState(0)
  const [err, setErr] = useState(null)           // { title, message, retry }
  const [note, setNote] = useState(null)         // { kind, text, warnings }
  const [undo, setUndo] = useState(null)         // { before, after }
  const [pageError, setPageError] = useState(null)
  const [showGallery, setShowGallery] = useState(false)
  const [fullOpen, setFullOpen] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [announce, setAnnounce] = useState('')
  // The plan step before a first build: { prompt, status: 'loading' | 'ready', data }.
  const [plan, setPlan] = useState(null)
  const planReq = useRef(0)
  const abortRef = useRef(null)
  const busyRef = useRef(false)
  busyRef.current = busy
  const promptRef = useRef(null)
  const changeRef = useRef(null)
  const galleryBtnRef = useRef(null)

  const hasContent = !!(content || '').trim()
  const { url: previewUrl, err: previewErr } = useArtifactPreview(content, nonce)

  useEffect(() => {
    if (!busy) { setElapsed(0); return }
    const t0 = Date.now()
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(id)
  }, [busy])

  // Script errors inside the preview arrive from the renderer's bridge.
  useEffect(() => {
    const onMsg = (e) => {
      const d = e.data
      if (d && typeof d === 'object' && d.type === '__ft_page_error' && !busyRef.current) {
        setPageError({ message: String(d.message || 'Script error'), lineno: d.lineno || 0, colno: d.colno || 0, stack: d.stack || '' })
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])
  useEffect(() => { setPageError(null) }, [content])

  useEffect(() => () => abortRef.current?.abort(), [])

  // A new artifact's preview keeps its state under "draft" until auto-save
  // gives the page an id; then that state moves to the page's own key.
  const storeKey = pageId ? `page:${pageId}` : 'draft'
  // The preview works on the artifact's real shared data, as its owner, once
  // the page exists; before that, in memory.
  const dataDesc = pageId ? { mode: 'owner', pageId } : { mode: 'memory' }
  useEffect(() => {
    if (!pageId) return
    const draft = readArtifactStore('draft')
    if (!Object.keys(draft).length) return
    if (!Object.keys(readArtifactStore(storeKey)).length) writeArtifactStore(storeKey, draft)
    try { localStorage.removeItem('ft_artifact_store:draft') } catch { /* storage unavailable */ }
  }, [pageId, storeKey])

  // Escape closes the template gallery and hands focus back to its button.
  useEffect(() => {
    if (!showGallery) return undefined
    const onKey = (e) => {
      if (e.key !== 'Escape' || !isTopmostTrap(null)) return
      setShowGallery(false)
      galleryBtnRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [showGallery])

  /** Put new code in place; what it replaced stays one click away. */
  const apply = (html, { name, kind = 'replaced', text } = {}) => {
    const before = content || ''
    onChange(html)
    const t = titleOf(html) || name
    if (t) onTitle?.(t)
    setShowGallery(false)
    setErr(null)
    setUndo(before.trim() && before !== html ? { before, after: html } : null)
    setNote(text ? { kind, text } : null)
  }

  const undoLast = () => {
    if (!undo) return
    onChange(undo.before)
    setNote({ kind: 'undone', text: 'Restored the previous version.' })
    setAnnounce('Restored the previous version.')
    setUndo(u => (u ? { ...u, undone: true } : u))
  }
  const redoLast = () => {
    if (!undo) return
    onChange(undo.after)
    setNote({ kind: 'redone', text: 'Put the change back.' })
    setAnnounce('Put the change back.')
    setUndo(u => (u ? { ...u, undone: false } : u))
  }

  const replaceOk = async (what) => !hasContent || await confirm({
    title: 'Replace this artifact?',
    message: `The current version will be replaced by ${what}. You can undo this straight after, and saved versions stay in Version history.`,
    confirmLabel: 'Replace',
  })

  const run = async (text, existing, style) => {
    const p = (text || '').trim()
    if (!p || busy) return
    const editing = !!existing
    setBusy(true); setErr(null); setNote(null); setDraft(''); setThought(''); setEdits([])
    setMode(editing ? 'edit' : 'create')
    setAnnounce(editing ? 'Making your changes. This usually takes under a minute.' : 'Building your artifact. This usually takes under a minute.')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const res = await streamArtifact({
        prompt: p,
        existing,
        style,
        signal: controller.signal,
        onThought: (t) => setThought(t),
        onDelta: (s) => setDraft(s),
        onEdit: (f) => setEdits(list => [...list, f]),
      })
      apply(res.content, { kind: 'built', text: editing ? 'Your changes are in.' : 'Your artifact is ready.' })
      setNote({ kind: 'built', text: editing ? 'Your changes are in.' : 'Your artifact is ready.', warnings: res.warnings })
      setAnnounce(editing ? 'Your changes are in. Try them in the preview.' : 'Your artifact is ready. Try it in the preview.')
      if (editing) setChange(''); else setPrompt('')
      setView(v => (v === 'code' ? v : 'preview'))
    } catch (e) {
      if (e?.name === 'AbortError') {
        setNote({ kind: 'cancelled', text: 'Stopped. Nothing was changed.' })
        setAnnounce('Stopped. Nothing was changed.')
      } else {
        const message = friendlyAiError(e?.message, 'Something went wrong on our side.')
        setErr({
          title: editing ? "Couldn't make that change" : "Couldn't build that",
          message,
          retry: isNotSetUp(message) ? null : () => run(p, editing ? content : undefined, style),
        })
      }
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  /**
   * A first build asks before it builds: a quick plan with features and a few
   * questions. Any trouble getting the plan (slow, refused, unusable) and it
   * builds straight from the request instead, as does the person's own
   * "Don't ask before building". Changes to an existing artifact never ask.
   */
  const startBuild = async (text) => {
    const p = (text || '').trim()
    if (!p || busy || plan) return
    if (readDontAsk()) { run(p); return }
    const req = ++planReq.current
    setErr(null); setNote(null)
    setPlan({ prompt: p, status: 'loading' })
    setAnnounce('Planning your app.')
    let data = null
    try { data = usablePlan(await api.pages.aiPlan({ prompt: p, content_type: 'artifact' })) } catch { data = null }
    if (req !== planReq.current) return          // skipped or abandoned meanwhile
    if (!data) { setPlan(null); run(p); return }
    setPlan({ prompt: p, status: 'ready', data })
    setAnnounce('The plan is ready. Review it, then build.')
  }
  const closePlan = () => { planReq.current += 1; setPlan(null) }
  const buildFromPlan = (text, style) => { closePlan(); run(text, undefined, style) }
  const skipPlan = () => { const p = plan?.prompt; closePlan(); if (p) run(p) }
  const backToPrompt = () => { closePlan(); requestAnimationFrame(() => promptRef.current?.focus()) }

  const fixError = async () => {
    if (!pageError || busy) return
    setBusy(true); setErr(null); setMode('fix')
    setAnnounce('Fixing the error.')
    try {
      const res = await api.pages.aiFixError({ content, error: pageError })
      if (res?.content) apply(res.content, { kind: 'built', text: 'Fixed. Check it in the preview.' })
      setPageError(null)
    } catch (e) {
      setErr({ title: "Couldn't fix it automatically", message: friendlyAiError(e?.message, 'Try describing the problem as a change instead.'), retry: null })
    } finally { setBusy(false) }
  }

  const pickTemplate = async (t) => {
    if (!(await replaceOk(`the ${t.name} template`))) return
    apply(t.html, { name: templateTitle(t), kind: 'template', text: `Added the ${t.name} template.` })
    setAnnounce(`Added the ${t.name} template.`)
  }

  const copyLink = () => {
    if (!shareUrl) return
    const done = () => { onCopied?.(); setAnnounce('Link copied.') }
    try { navigator.clipboard.writeText(shareUrl).then(done).catch(() => {}) } catch { /* no clipboard */ }
  }

  const pickIdea = (text) => {
    setChange(text)
    requestAnimationFrame(() => changeRef.current?.focus())
  }

  const stepLabel = mode === 'edit' ? 'Making your changes' : mode === 'fix' ? 'Fixing the error' : 'Building your artifact'
  const liveRegion = <div className="sr-only" role="status" aria-live="polite">{announce}</div>

  const errorBox = err && (
    <div role="alert" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap', padding: '10px 12px', border: '1px solid var(--fin-neg-border, var(--border))', background: 'var(--fin-neg-bg, var(--bg-base))', borderRadius: 10, fontSize: 13, color: 'var(--text-1)' }}>
      <span style={{ flex: '1 1 240px', minWidth: 0 }}>
        <strong style={{ color: 'var(--fin-negative)' }}>{err.title}.</strong>{' '}
        <span>{err.message}</span>
        {err.retry && <span style={{ color: 'var(--text-2)' }}> Your request is kept, so you can try again or reword it.</span>}
      </span>
      <span style={{ display: 'flex', gap: 6 }}>
        {err.retry && <button type="button" style={btnSmall} onClick={err.retry}><RotateCw size={13} aria-hidden="true" /> Try again</button>}
        <button type="button" style={btnQuiet} onClick={() => setErr(null)}>Dismiss</button>
      </span>
    </div>
  )

  // ── Start: nothing built yet ────────────────────────────────────────────
  if (!hasContent && !busy) {
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? 14 : '20px 24px', display: 'flex', flexDirection: 'column', gap: 22 }}>
        {liveRegion}
        <div>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text-1)' }}>Create an artifact</h2>
          <p style={{ ...sectionHint, margin: '4px 0 0', maxWidth: 640 }}>
            A small working tool, like a calculator, tracker or form. Share it with a link, or drop it into a document.
          </p>
        </div>
        {errorBox}
        {note?.kind === 'cancelled' && <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{note.text}</div>}
        {plan && (plan.status === 'loading'
          ? <PlanSkeleton onSkip={skipPlan} btnStyle={btn} />
          : <PlanCard key={plan.prompt} prompt={plan.prompt} plan={plan.data} onBuild={buildFromPlan}
              onSkip={skipPlan} onBack={backToPrompt} btnStyle={btn} btnPrimaryStyle={btnPrimary} />)}
        {canUseAi && !plan && (
          <section aria-labelledby="art-describe">
            <h3 id="art-describe" style={sectionTitle}>Describe what you need</h3>
            <p id="art-describe-hint" style={sectionHint}>Say what it should work out and what it should show. Plain words are fine.</p>
            <textarea
              ref={promptRef}
              aria-label="Describe the artifact"
              aria-describedby="art-describe-hint art-describe-keys"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); startBuild(prompt) } }}
              rows={3}
              placeholder="e.g. a quote builder that adds GST, applies a discount and shows the total in words"
              style={{ ...input, resize: 'vertical', lineHeight: 1.5, fontSize: 14 }}
            />
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
              <div role="group" aria-label="Suggestions" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: '1 1 300px', minWidth: 0 }}>
                {PROMPT_SUGGESTIONS.map(s => (
                  <button key={s.label} type="button" style={chip} title={s.prompt}
                    aria-label={`Suggestion: ${s.label}`}
                    onClick={() => { setPrompt(s.prompt); promptRef.current?.focus() }}>
                    {s.label}
                  </button>
                ))}
              </div>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
                {!isMobile && <span id="art-describe-keys" style={{ fontSize: 11.5, color: 'var(--text-2)' }}>Ctrl + Enter</span>}
                <button type="button" style={{ ...btnPrimary, padding: '8px 16px', fontSize: 13, opacity: prompt.trim() ? 1 : 0.6 }} disabled={!prompt.trim()} onClick={() => startBuild(prompt)}>
                  Build artifact
                </button>
              </span>
            </div>
          </section>
        )}
        {!plan && <section aria-labelledby="art-templates">
          <h3 id="art-templates" style={sectionTitle}>{canUseAi ? 'Or start from a template' : 'Start from a template'}</h3>
          <p style={sectionHint}>Ready to use, and you can change anything afterwards.</p>
          <ArtifactTemplates onPick={pickTemplate} />
        </section>}
        {!plan && <details open={!canUseAi || undefined} style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text-1)', minHeight: 24 }}>Have your own HTML? Paste or upload it</summary>
          <div style={{ marginTop: 10 }}>
            <textarea
              aria-label="Paste HTML"
              value={paste}
              onChange={e => setPaste(e.target.value)}
              rows={4}
              placeholder="<!DOCTYPE html>…  Paste a complete single-file app here"
              style={{ ...input, resize: 'vertical', fontFamily: 'ui-monospace,monospace', fontSize: 12 }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <button type="button" style={{ ...btnPrimary, opacity: paste.trim() ? 1 : 0.6 }} disabled={!paste.trim()} onClick={() => { apply(paste); setPaste('') }}>Use this HTML</button>
              <HtmlFileButton onLoad={(html, name) => apply(html, { name: name.replace(/\.html?$/i, '') })} />
            </div>
          </div>
        </details>}
      </div>
    )
  }

  // ── Workspace: a live preview, with the code beside it on request ──────
  const streamingCreate = busy && mode === 'create'
  const showData = view === 'data' && !!pageId
  const showCode = !showData && view !== 'preview'
  const showPreview = !showData && view !== 'code'

  const progress = (
    <BuildProgress
      title={stepLabel}
      draft={draft}
      thought={thought}
      elapsed={elapsed}
      storeKey={storeKey}
      btnStyle={btn}
      quietStyle={btnQuiet}
      onCancel={() => abortRef.current?.abort()}
      onWatchCode={view === 'preview' && !isMobile ? () => setView('split') : null}
    />
  )

  const status = (busy && !streamingCreate) || pageError || note || err ? (
    <div style={{ padding: '8px 12px', fontSize: 12.5, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg-base)', flexShrink: 0 }}>
      {busy && !streamingCreate && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Loader2 size={14} className="animate-spin" aria-hidden="true" style={{ color: 'var(--accent)' }} />
          <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{stepLabel}…</span>
          <span aria-hidden="true" style={{ color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{elapsed}s</span>
          {thought && <span style={{ color: 'var(--text-2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{thought}</span>}
          {edits.length > 0 && <span style={{ color: 'var(--text-2)' }}>{edits.filter(e => e.ok).length} change(s) applied</span>}
          {mode !== 'fix' && <button type="button" style={{ ...btnSmall, marginLeft: 'auto' }} onClick={() => abortRef.current?.abort()}>Cancel</button>}
        </div>
      )}
      {!busy && errorBox}
      {!busy && note && !err && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', color: 'var(--text-1)' }}>
          {note.kind !== 'cancelled' && <Check size={14} aria-hidden="true" style={{ color: 'var(--fin-positive)' }} />}
          <span>{note.text}{note.kind === 'built' ? ' Try it in the preview before you publish.' : ''}</span>
          {note.warnings?.length > 0 && <span style={{ color: 'var(--fin-warning)' }}>Check: {note.warnings.join('; ')}.</span>}
          {undo && !undo.undone && <button type="button" style={btnSmall} onClick={undoLast}><Undo2 size={13} aria-hidden="true" /> Undo</button>}
          {undo && undo.undone && <button type="button" style={btnSmall} onClick={redoLast}><Redo2 size={13} aria-hidden="true" /> Redo</button>}
          <button type="button" style={{ ...btnQuiet, marginLeft: 'auto' }} aria-label="Dismiss message" onClick={() => setNote(null)}><X size={14} aria-hidden="true" /></button>
          {canUseAi && !isMobile && (note.kind === 'built' || note.kind === 'template') && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', flexBasis: '100%' }}>
              <span style={{ color: 'var(--text-2)', fontSize: 12 }}>Next, you could ask to:</span>
              {CHANGE_IDEAS.map(idea => (
                <button key={idea} type="button" style={{ ...chip, minHeight: 28, padding: '3px 10px' }} onClick={() => pickIdea(idea)}>{idea}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {!busy && pageError && (
        <div role="alert" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', color: 'var(--text-1)' }}>
          <span style={{ flex: '1 1 240px', minWidth: 0 }}>
            <strong style={{ color: 'var(--fin-negative)' }}>Part of this artifact isn't working.</strong>{' '}
            <span style={{ color: 'var(--text-2)' }}>{pageError.message.slice(0, 140)}{pageError.lineno ? ` (line ${pageError.lineno})` : ''}</span>
          </span>
          {canUseAi && <button type="button" style={btnSmall} onClick={fixError}>Fix it</button>}
          <button type="button" style={btnQuiet} onClick={() => setPageError(null)}>Dismiss</button>
        </div>
      )}
    </div>
  ) : null

  const codePane = (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', borderRight: showPreview && !isMobile ? '1px solid var(--border)' : 'none' }}>
      {streamingCreate ? (
        <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
          {draft ? <StreamingDraft content={draft} label="Writing the artifact" /> : <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Waiting for the first lines…</div>}
        </div>
      ) : (
        <textarea
          aria-label="Artifact code"
          value={content}
          onChange={e => onChange(e.target.value)}
          spellCheck={false}
          readOnly={busy}
          style={{ flex: 1, width: '100%', padding: '14px 16px', fontFamily: 'ui-monospace,monospace', fontSize: 12.5, lineHeight: 1.6, background: 'var(--bg-base)', color: 'var(--text-1)', border: 'none', outlineOffset: -2, resize: 'none', boxSizing: 'border-box' }}
        />
      )}
    </div>
  )

  const previewBar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-base)', flexShrink: 0, flexWrap: 'wrap' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)', flex: '1 1 200px', minWidth: 0 }}>
        <ShieldCheck size={14} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--fin-positive)' }} />
        <span>{isMobile ? 'Runs in a private sandbox.' : 'Runs in a private sandbox, separate from your FinTrack data.'}</span>
      </span>
      <button type="button" style={btnQuiet} aria-label="Reload preview" title="Reload preview" onClick={() => setNonce(n => n + 1)}><RotateCw size={14} aria-hidden="true" /></button>
      <button type="button" style={btnSmall} onClick={() => setFullOpen(true)} disabled={!previewUrl}><Maximize2 size={13} aria-hidden="true" /> Open full screen</button>
      {isPublished && shareUrl
        ? <button type="button" style={btnSmall} onClick={copyLink}><Link2 size={13} aria-hidden="true" /> Copy link</button>
        : onShare && <button type="button" style={btnSmall} onClick={onShare}><Link2 size={13} aria-hidden="true" /> Get a link</button>}
    </div>
  )

  const previewPane = (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--card-bg)' }}>
      {streamingCreate ? progress : (
        <>
          {previewBar}
          {previewErr ? (
            <div role="alert" style={{ margin: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-1)', padding: 20, textAlign: 'center' }}>
              <strong>{previewErr}</strong>
              <span style={{ color: 'var(--text-2)' }}>Your code is safe. Check your connection and try again.</span>
              <button type="button" style={btn} onClick={() => setNonce(n => n + 1)}><RotateCw size={13} aria-hidden="true" /> Try again</button>
            </div>
          ) : previewUrl ? (
            <ArtifactFrame key={nonce} src={previewUrl} height="100%" title={`Preview of ${title || 'the artifact'}`} storeKey={storeKey} data={dataDesc} style={{ flex: 1, minHeight: 0 }} />
          ) : (
            <div aria-busy="true" aria-label="Preparing the preview" style={{ position: 'relative', flex: 1 }}>
              <div style={{ position: 'absolute', inset: 0, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }} aria-hidden="true">
                <div className="skeleton" style={{ height: 22, width: '40%' }} />
                <div className="skeleton" style={{ height: 12, width: '65%' }} />
                <div className="skeleton" style={{ height: 140, borderRadius: 12 }} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )

  const views = [...(isMobile ? ['preview', 'code'] : ['preview', 'split', 'code']), ...(pageId ? ['data'] : [])]
  const viewLabel = { preview: 'Preview', split: 'Split', code: 'Code', data: 'Data' }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {liveRegion}
      <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--card-bg)', alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
        {canUseAi && (
          <form
            onSubmit={e => { e.preventDefault(); run(change, content) }}
            style={{ display: 'flex', gap: 6, flex: '1 1 320px', minWidth: 0 }}
          >
            <input
              ref={changeRef}
              aria-label="Describe a change"
              value={change}
              onChange={e => setChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape' && change) { e.preventDefault(); setChange('') } }}
              disabled={busy}
              placeholder={isMobile ? 'Describe a change…' : 'Describe a change, e.g. "add a reset button and show totals in words"'}
              style={{ ...input, flex: 1, minWidth: 0, minHeight: 32 }}
            />
            <button type="submit" style={{ ...btnPrimary, opacity: change.trim() && !busy ? 1 : 0.6 }} disabled={!change.trim() || busy}>Make changes</button>
          </form>
        )}
        <div role="group" aria-label="Layout" style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginLeft: canUseAi ? 0 : 'auto' }}>
          {views.map(v => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
              style={{ border: 'none', padding: '6px 12px', minHeight: 32, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: view === v ? 'var(--accent-btn)' : 'transparent', color: view === v ? 'var(--accent-fg)' : 'var(--text-1)' }}>
              {viewLabel[v]}
            </button>
          ))}
        </div>
        <HtmlFileButton label={isMobile ? 'Upload' : 'Upload .html'} onLoad={async (html, name) => {
          if (await replaceOk(`"${name}"`)) apply(html, { name: name.replace(/\.html?$/i, ''), kind: 'upload', text: `Loaded ${name}.` })
        }} />
        <button ref={galleryBtnRef} type="button" style={btn} aria-expanded={showGallery} aria-controls="artifact-gallery" onClick={() => setShowGallery(s => !s)}>Templates</button>
      </div>
      {status}
      {showGallery && (
        <div id="artifact-gallery" role="region" aria-label="Templates" style={{ padding: 12, borderBottom: '1px solid var(--border)', background: 'var(--bg-base)', maxHeight: '45%', overflowY: 'auto', flexShrink: 0 }}>
          <ArtifactTemplates onPick={pickTemplate} compact />
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: isMobile ? 'column' : 'row' }}>
        {showCode && codePane}
        {showPreview && previewPane}
        {showData && <ArtifactDataPanel pageId={pageId} isPublished={isPublished} isMobile={isMobile} />}
      </div>
      {fullOpen && previewUrl && (
        <FullScreenPreview src={previewUrl} storeKey={storeKey} title={title} data={dataDesc} onClose={() => setFullOpen(false)} />
      )}
    </div>
  )
}
