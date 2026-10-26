/**
 * The artifact editor: describe it, start from a template or paste HTML; then
 * code and live preview side by side, with a Refine prompt to iterate.
 *
 * Saving, publishing, sharing and version history are the page editor's job
 * (PagesManager's PageDrawer); this component only owns the document itself.
 */
import { useEffect, useRef, useState } from 'react'
import { api } from '../../services/api'
import { useConfirm } from '../../context/ConfirmContext'
import { previewRenderUrl } from '../../utils/pageHtml'
import StreamingDraft from '../StreamingDraft'
import ArtifactFrame, { readArtifactStore, writeArtifactStore } from './ArtifactFrame'
import ArtifactTemplates from './ArtifactTemplates'
import { templateTitle } from './templates'
import { friendlyAiError, streamArtifact } from './artifactAi'

const EXAMPLES = [
  'A GST invoice line-item calculator with HSN codes and a printable summary',
  'A savings goal tracker with monthly SIP needed to reach a target by a date',
  'A client onboarding checklist with progress and a reset button',
]

const btn = { border: '1px solid var(--border)', borderRadius: 10, padding: '7px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'var(--card-bg)', color: 'var(--text-1)' }
const btnPrimary = { ...btn, background: 'var(--accent-btn)', color: 'var(--accent-fg)', border: '1px solid transparent' }
const input = { display: 'block', width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card-bg)', color: 'var(--text-1)', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }
const sectionTitle = { margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }

function titleOf(html) {
  return html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || ''
}

/** Parks the draft behind a preview token so it renders through the real pipeline. */
function useArtifactPreview(content) {
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
          else setErr('Preview is unavailable right now.')
        })
        .catch(() => { if (!cancelled) setErr('Preview is unavailable right now.') })
    }, 450)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [content])
  return { url, err }
}

function HtmlFileButton({ onLoad, label = 'Upload .html' }) {
  const ref = useRef(null)
  return (
    <>
      <input ref={ref} type="file" accept=".html,.htm,text/html" style={{ display: 'none' }}
        data-testid="artifact-file"
        onChange={async (e) => {
          const file = e.target.files?.[0]; e.target.value = ''
          if (!file) return
          try { onLoad(await file.text(), file.name) } catch { /* unreadable file: nothing to load */ }
        }} />
      <button type="button" style={btn} onClick={() => ref.current?.click()}>{label}</button>
    </>
  )
}

export default function ArtifactStudio({ content, onChange, onTitle, pageId, canUseAi = false, isMobile = false }) {
  const confirm = useConfirm()
  // Opens on the result; the code is one click away.
  const [view, setView] = useState('preview')
  const [prompt, setPrompt] = useState('')
  const [refine, setRefine] = useState('')
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState('create')
  const [thought, setThought] = useState('')
  const [draft, setDraft] = useState('')
  const [edits, setEdits] = useState([])
  const [elapsed, setElapsed] = useState(0)
  const [err, setErr] = useState('')
  const [note, setNote] = useState(null)
  const [pageError, setPageError] = useState(null)
  const [showGallery, setShowGallery] = useState(false)
  const abortRef = useRef(null)

  const hasContent = !!(content || '').trim()
  const { url: previewUrl, err: previewErr } = useArtifactPreview(content)

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
      if (d && typeof d === 'object' && d.type === '__ft_page_error') {
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
  useEffect(() => {
    if (!pageId) return
    const draft = readArtifactStore('draft')
    if (!Object.keys(draft).length) return
    if (!Object.keys(readArtifactStore(storeKey)).length) writeArtifactStore(storeKey, draft)
    try { localStorage.removeItem('ft_artifact_store:draft') } catch { /* storage unavailable */ }
  }, [pageId, storeKey])

  const apply = (html, { name } = {}) => {
    onChange(html)
    const t = titleOf(html) || name
    if (t) onTitle?.(t)
    setShowGallery(false)
  }

  const replaceOk = async (what) => !hasContent || await confirm({
    title: 'Replace this artifact?',
    message: `The current code will be replaced by ${what}. Saved versions stay in History.`,
    confirmLabel: 'Replace',
  })

  const run = async (text, existing) => {
    const p = (text || '').trim()
    if (!p || busy) return
    setBusy(true); setErr(''); setNote(null); setDraft(''); setThought(''); setEdits([])
    setMode(existing ? 'edit' : 'create')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const res = await streamArtifact({
        prompt: p,
        existing,
        signal: controller.signal,
        onThought: (t) => setThought(t),
        onDelta: (s) => setDraft(s),
        onEdit: (f) => setEdits(list => [...list, f]),
      })
      apply(res.content)
      setNote({ model: res.model, warnings: res.warnings })
      if (existing) setRefine(''); else setPrompt('')
    } catch (e) {
      if (e?.name !== 'AbortError') setErr(friendlyAiError(e?.message, 'Generation failed. Try again, or rephrase the request.'))
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  const fixError = async () => {
    if (!pageError || busy) return
    setBusy(true); setErr(''); setMode('fix')
    try {
      const res = await api.pages.aiFixError({ content, error: pageError })
      if (res?.content) apply(res.content)
      setPageError(null)
    } catch (e) {
      setErr(friendlyAiError(e?.message, 'The fix did not work. Try describing the problem in Refine.'))
    } finally { setBusy(false) }
  }

  const pickTemplate = async (t) => {
    if (!(await replaceOk(`the ${t.name} template`))) return
    apply(t.html, { name: templateTitle(t) })
    setNote(null)
  }

  const status = (busy || err || note || pageError) && (
    <div style={{ padding: '6px 12px', fontSize: 12, borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', background: 'var(--bg-base)', flexShrink: 0 }}>
      {busy && (
        <>
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>
            {mode === 'edit' ? 'Refining' : mode === 'fix' ? 'Fixing' : 'Building'}… {elapsed}s
          </span>
          {thought && <span style={{ color: 'var(--text-2)', fontStyle: 'italic', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{thought}</span>}
          {edits.length > 0 && <span style={{ color: 'var(--text-2)' }}>{edits.filter(e => e.ok).length} change(s) applied</span>}
          {mode !== 'fix' && <button type="button" style={{ ...btn, padding: '3px 10px', marginLeft: 'auto', color: 'var(--fin-negative)' }} onClick={() => abortRef.current?.abort()}>Stop</button>}
        </>
      )}
      {!busy && err && <span role="alert" style={{ color: 'var(--fin-negative)' }}>{err}</span>}
      {!busy && note && !err && (
        <span style={{ color: 'var(--text-2)' }}>
          ✓ Updated{note.model ? ` with ${note.model}` : ''}. Try it in the preview before publishing.
          {note.warnings?.length > 0 && <span style={{ color: 'var(--fin-warning)' }}> Check: {note.warnings.join('; ')}.</span>}
        </span>
      )}
      {!busy && pageError && (
        <span role="alert" style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--fin-negative)', flexBasis: '100%' }}>
          ⚠ Script error: {pageError.message.slice(0, 140)}{pageError.lineno ? ` (line ${pageError.lineno})` : ''}
          {canUseAi && <button type="button" style={{ ...btn, padding: '3px 10px' }} onClick={fixError}>Fix it</button>}
          <button type="button" style={{ ...btn, padding: '3px 10px' }} onClick={() => setPageError(null)}>Dismiss</button>
        </span>
      )}
    </div>
  )

  // ── Start: nothing built yet ────────────────────────────────────────────
  if (!hasContent && !busy) {
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? 14 : '18px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {status}
        {canUseAi && (
          <section aria-labelledby="art-describe">
            <h3 id="art-describe" style={sectionTitle}>Describe what it should do</h3>
            <textarea
              aria-label="Describe the artifact"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run(prompt) }}
              rows={3}
              placeholder="e.g. a quote builder that adds GST, applies a discount and shows the total in words"
              style={{ ...input, resize: 'vertical', lineHeight: 1.5 }}
            />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
              {EXAMPLES.map(ex => (
                <button key={ex} type="button" onClick={() => setPrompt(ex)}
                  style={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 99, padding: '3px 10px', background: 'var(--bg-base)', color: 'var(--text-2)', cursor: 'pointer' }}>
                  {ex.length > 56 ? ex.slice(0, 56) + '…' : ex}
                </button>
              ))}
              <button type="button" style={{ ...btnPrimary, marginLeft: 'auto', opacity: prompt.trim() ? 1 : 0.6 }} disabled={!prompt.trim()} onClick={() => run(prompt)}>
                ✨ Build artifact
              </button>
            </div>
          </section>
        )}
        <section aria-labelledby="art-templates">
          <h3 id="art-templates" style={sectionTitle}>Start from a template</h3>
          <ArtifactTemplates onPick={pickTemplate} />
        </section>
        <section aria-labelledby="art-paste">
          <h3 id="art-paste" style={sectionTitle}>Or bring your own HTML</h3>
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
        </section>
      </div>
    )
  }

  // ── Workspace: code beside a live preview ───────────────────────────────
  const streamingCreate = busy && mode === 'create'
  // While a new artifact is being written there is nothing to preview yet,
  // so the draft shows whatever the layout.
  const showCode = view !== 'preview' || streamingCreate
  const showPreview = view !== 'code' && !(streamingCreate && view === 'preview')

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
          style={{ flex: 1, width: '100%', padding: '14px 16px', fontFamily: 'ui-monospace,monospace', fontSize: 12.5, lineHeight: 1.6, background: 'var(--bg-base)', color: 'var(--text-1)', border: 'none', outline: 'none', resize: 'none', boxSizing: 'border-box' }}
        />
      )}
    </div>
  )

  const previewPane = (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--card-bg)' }}>
      {!hasContent ? (
        <div style={{ margin: 'auto', fontSize: 12, color: 'var(--text-2)' }}>The preview appears when the artifact is ready.</div>
      ) : previewErr ? (
        <div style={{ margin: 'auto', fontSize: 12, color: 'var(--fin-warning)' }}>{previewErr}</div>
      ) : previewUrl ? (
        <ArtifactFrame src={previewUrl} height="100%" title="Artifact preview" storeKey={storeKey} style={{ flex: 1 }} />
      ) : (
        <div style={{ margin: 'auto', fontSize: 12, color: 'var(--text-2)' }}>Rendering preview…</div>
      )}
    </div>
  )

  const views = isMobile ? ['code', 'preview'] : ['split', 'code', 'preview']

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--card-bg)', alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
        {canUseAi && (
          <form
            onSubmit={e => { e.preventDefault(); run(refine, content) }}
            style={{ display: 'flex', gap: 6, flex: '1 1 320px', minWidth: 0 }}
          >
            <input
              aria-label="Refine the artifact"
              value={refine}
              onChange={e => setRefine(e.target.value)}
              disabled={busy}
              placeholder='Refine: e.g. "add a reset button and show totals in words"'
              style={{ ...input, flex: 1, minWidth: 0 }}
            />
            <button type="submit" style={{ ...btnPrimary, opacity: refine.trim() && !busy ? 1 : 0.6 }} disabled={!refine.trim() || busy}>Refine</button>
          </form>
        )}
        <div role="group" aria-label="Layout" style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginLeft: canUseAi ? 0 : 'auto' }}>
          {views.map(v => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
              style={{ border: 'none', padding: '6px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: view === v ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'transparent', color: view === v ? 'var(--accent)' : 'var(--text-2)', textTransform: 'capitalize' }}>
              {v}
            </button>
          ))}
        </div>
        <HtmlFileButton label={isMobile ? 'Upload' : 'Upload .html'} onLoad={async (html, name) => {
          if (await replaceOk(`"${name}"`)) apply(html, { name: name.replace(/\.html?$/i, '') })
        }} />
        <button type="button" style={btn} aria-expanded={showGallery} onClick={() => setShowGallery(s => !s)}>Templates</button>
      </div>
      {status}
      {showGallery && (
        <div style={{ padding: 12, borderBottom: '1px solid var(--border)', background: 'var(--bg-base)', maxHeight: '45%', overflowY: 'auto', flexShrink: 0 }}>
          <ArtifactTemplates onPick={pickTemplate} compact />
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: isMobile ? 'column' : 'row' }}>
        {showCode && codePane}
        {showPreview && previewPane}
      </div>
    </div>
  )
}
