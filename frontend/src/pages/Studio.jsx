/**
 * Studio — ask questions of your own documents.
 *
 * Built mobile-first: one column, the question box at the top where a thumb
 * reaches it, and the document library behind a disclosure rather than above
 * the thing you came here to do.
 *
 * Every answer carries numbered citations. A claim with no source is the
 * failure this module exists to avoid, so the sources are shown beside the
 * answer rather than hidden behind a toggle.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Sparkles, FileText, Upload, Trash2, ChevronDown, ChevronRight,
  AlertTriangle, CheckCircle2, Loader2, Quote,
} from 'lucide-react'
import { api } from '../services/api'
import { useConfirm } from '../context/ConfirmContext'
import { usePageMeta } from '../hooks/usePageMeta'

const ACCEPTED = '.pdf,.txt,.md,.markdown,.csv,.json,.log'

function fmtBytes(n) {
  if (!n) return '0 KB'
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// ---------------------------------------------------------------------------
// Document row
// ---------------------------------------------------------------------------
function DocRow({ doc, selected, onToggle, onDelete }) {
  const busy = doc.status === 'pending'
  const failed = doc.status === 'failed'

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
      borderBottom: '1px solid var(--border)',
    }}>
      <input
        type="checkbox"
        checked={selected}
        disabled={doc.status !== 'ready'}
        onChange={() => onToggle(doc.id)}
        aria-label={`Search within ${doc.filename}`}
        style={{ marginTop: 3, flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: 'var(--text-1)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {doc.filename}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {busy && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Loader2 size={11} className="animate-spin" aria-hidden="true" /> Processing…
          </span>}
          {doc.status === 'ready' && (
            <span>{doc.page_count} page{doc.page_count === 1 ? '' : 's'} · {doc.chunk_count} sections</span>
          )}
          {failed && <span style={{ color: '#ef4444' }}>{doc.error || 'Could not be read'}</span>}
          <span>{fmtBytes(doc.byte_size)}</span>
        </div>
      </div>
      <button
        onClick={() => onDelete(doc)}
        aria-label={`Delete ${doc.filename}`}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 4,
          color: 'var(--text-2)', flexShrink: 0,
        }}
      >
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Answer with citations
// ---------------------------------------------------------------------------
function Answer({ turn }) {
  const [openSource, setOpenSource] = useState(null)

  // Turn [1] [2] markers into buttons that reveal the passage they point at.
  // The citation is only worth anything if the reader can check it.
  const parts = String(turn.answer || '').split(/(\[\d+\])/g)

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--text-1)', whiteSpace: 'pre-wrap' }}>
        {parts.map((part, i) => {
          const m = part.match(/^\[(\d+)\]$/)
          if (!m) return <span key={i}>{part}</span>
          const n = Number(m[1])
          const src = turn.sources?.find(s => s.n === n)
          if (!src) return <span key={i}>{part}</span>
          return (
            <button
              key={i}
              onClick={() => setOpenSource(openSource === n ? null : n)}
              title={`${src.title}${src.page ? `, page ${src.page}` : ''}`}
              style={{
                display: 'inline-flex', alignItems: 'center', verticalAlign: 'baseline',
                background: openSource === n ? 'var(--accent)' : 'var(--bg-base)',
                color: openSource === n ? '#fff' : 'var(--accent)',
                border: '1px solid var(--accent)', borderRadius: 4,
                fontSize: 11, fontWeight: 700, padding: '0 5px', margin: '0 2px',
                cursor: 'pointer', lineHeight: 1.5,
              }}
            >
              {n}
            </button>
          )
        })}
      </div>

      {openSource != null && (() => {
        const src = turn.sources.find(s => s.n === openSource)
        if (!src) return null
        return (
          <div style={{
            background: 'var(--bg-base)', border: '1px solid var(--border)',
            borderLeft: '3px solid var(--accent)', borderRadius: '0 8px 8px 0',
            padding: '10px 14px', fontSize: 13, lineHeight: 1.6, color: 'var(--text-2)',
          }}>
            <div style={{ fontWeight: 700, color: 'var(--text-1)', marginBottom: 4, fontSize: 12 }}>
              <Quote size={11} style={{ verticalAlign: -1, marginRight: 4 }} aria-hidden="true" />
              {src.title}{src.page ? `, page ${src.page}` : ''}
            </div>
            {src.excerpt}…
          </div>
        )
      })()}

      <div style={{
        display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
        fontSize: 11, color: 'var(--text-2)', borderTop: '1px solid var(--border)', paddingTop: 10,
      }}>
        {turn.verdict === 'pass' && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#16a34a' }}>
            <CheckCircle2 size={12} aria-hidden="true" /> Checked against sources
          </span>
        )}
        {turn.verdict === 'soft-fail' && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#b45309' }}>
            <AlertTriangle size={12} aria-hidden="true" /> Corrected during checking
          </span>
        )}
        {turn.verdict === 'no-sources' && (
          <span style={{ color: '#b45309' }}>No matching passages found</span>
        )}
        {turn.sources?.length > 0 && <span>{turn.sources.length} sources</span>}
        {turn.model && <span>{turn.model}</span>}
        {turn.latency_ms != null && <span>{(turn.latency_ms / 1000).toFixed(1)}s</span>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function Studio() {
  const confirm = useConfirm()
  const fileRef = useRef(null)
  usePageMeta({ title: 'Studio — FinTrack', description: 'Ask questions of your own documents.' })

  const [docs, setDocs] = useState([])
  const [selected, setSelected] = useState(() => new Set())
  const [docsOpen, setDocsOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState([])
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  const [quota, setQuota] = useState(null)

  const loadDocs = useCallback(async () => {
    try {
      const res = await api.studio.documents()
      setDocs(res?.documents || [])
    } catch { /* the empty state covers it */ }
  }, [])

  useEffect(() => { loadDocs() }, [loadDocs])

  useEffect(() => {
    api.studio.usage().then(r => setQuota(r?.quota || null)).catch(() => {})
  }, [turns.length])

  // Ingestion runs detached on the server, so the row's status is the only way
  // to know it finished. Poll only while something is actually pending.
  useEffect(() => {
    if (!docs.some(d => d.status === 'pending')) return
    const id = setInterval(loadDocs, 3000)
    return () => clearInterval(id)
  }, [docs, loadDocs])

  const ready = docs.filter(d => d.status === 'ready')

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setUploading(true); setError('')
    for (const f of files) {
      try {
        await api.studio.upload(f)
      } catch (err) {
        setError(err?.message || `Could not upload ${f.name}`)
      }
    }
    setUploading(false)
    setDocsOpen(true)
    loadDocs()
  }

  const handleDelete = async (doc) => {
    const ok = await confirm({
      title: 'Delete document',
      message: `Remove "${doc.filename}"? Answers will no longer be able to cite it.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await api.studio.deleteDocument(doc.id)
      setSelected(s => { const n = new Set(s); n.delete(doc.id); return n })
      loadDocs()
    } catch (err) {
      setError(err?.message || 'Could not delete that document.')
    }
  }

  const toggle = (id) => setSelected(s => {
    const n = new Set(s)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })

  const handleAsk = async () => {
    const q = question.trim()
    if (!q || asking) return
    setAsking(true); setError('')
    try {
      const res = await api.studio.ask({
        question: q,
        document_ids: selected.size ? Array.from(selected) : undefined,
      })
      setTurns(t => [{ question: q, ...res }, ...t])
      setQuestion('')
      if (res?.quota) setQuota(res.quota)
    } catch (err) {
      setError(err?.message || 'Could not answer that. Try again in a moment.')
    } finally {
      setAsking(false)
    }
  }

  return (
    <div style={{ padding: '20px 16px 48px', maxWidth: 880, margin: '0 auto' }}>

      <header style={{ marginBottom: 18 }}>
        <h1 style={{
          margin: 0, fontSize: 'clamp(22px,4vw,30px)', fontWeight: 800,
          letterSpacing: '-0.025em', color: 'var(--text-1)',
          display: 'flex', alignItems: 'center', gap: 9,
        }}>
          <Sparkles size={22} aria-hidden="true" style={{ color: 'var(--accent)' }} />
          Studio
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--text-2)', lineHeight: 1.5 }}>
          Upload contracts, agreements or notes, then ask questions about them. Every
          answer cites the document and page it came from.
        </p>
      </header>

      {/* Ask — first, because it is what you came here to do */}
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <textarea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleAsk() }}
          placeholder={ready.length
            ? 'What are the payment terms in the Britannia agreement?'
            : 'Upload a document below to get started.'}
          rows={3}
          disabled={asking}
          aria-label="Your question"
          style={{
            width: '100%', border: '1px solid var(--border)', borderRadius: 8,
            padding: '10px 12px', fontSize: 15, lineHeight: 1.5, resize: 'vertical',
            background: 'var(--bg-base)', color: 'var(--text-1)', outline: 'none',
            fontFamily: 'inherit', boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-2)' }}>
            {selected.size > 0
              ? `Searching ${selected.size} selected document${selected.size === 1 ? '' : 's'}`
              : `Searching all ${ready.length} document${ready.length === 1 ? '' : 's'}`}
          </span>
          <button
            onClick={handleAsk}
            disabled={asking || !question.trim() || !ready.length}
            style={{
              marginLeft: 'auto', padding: '9px 18px', borderRadius: 8, border: 'none',
              background: (asking || !question.trim() || !ready.length) ? 'var(--border)' : 'var(--accent)',
              color: (asking || !question.trim() || !ready.length) ? 'var(--text-2)' : '#fff',
              fontSize: 14, fontWeight: 600,
              cursor: (asking || !question.trim() || !ready.length) ? 'default' : 'pointer',
            }}
          >
            {asking ? 'Reading…' : 'Ask'}
          </button>
        </div>
        {error && <div style={{ fontSize: 12, color: '#ef4444' }}>{error}</div>}
      </div>

      {/* Answers, newest first */}
      {turns.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 18 }}>
          {turns.map((turn, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)' }}>
                {turn.question}
              </div>
              <Answer turn={turn} />
            </div>
          ))}
        </div>
      )}

      {/* Library — a disclosure, so it never sits between you and the question */}
      <div style={{
        marginTop: 20, background: 'var(--bg-card)',
        border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden',
      }}>
        <button
          onClick={() => setDocsOpen(o => !o)}
          aria-expanded={docsOpen}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: '12px 14px', border: 'none', background: 'none',
            cursor: 'pointer', textAlign: 'left', color: 'var(--text-1)',
          }}
        >
          {docsOpen ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
          <FileText size={15} aria-hidden="true" style={{ color: 'var(--text-2)' }} />
          <span style={{ fontSize: 14, fontWeight: 700 }}>Documents</span>
          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
            {ready.length} ready{docs.length > ready.length ? ` · ${docs.length - ready.length} processing` : ''}
          </span>
        </button>

        {docsOpen && (
          <div>
            {docs.map(doc => (
              <DocRow
                key={doc.id}
                doc={doc}
                selected={selected.has(doc.id)}
                onToggle={toggle}
                onDelete={handleDelete}
              />
            ))}
            {docs.length === 0 && (
              <div style={{ padding: '18px 14px', fontSize: 13, color: 'var(--text-2)', textAlign: 'center' }}>
                No documents yet.
              </div>
            )}
            <div style={{ padding: 12 }}>
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPTED}
                multiple
                onChange={handleUpload}
                style={{ display: 'none' }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  padding: '8px 14px', borderRadius: 8,
                  border: '1px solid var(--border)', background: 'var(--bg-base)',
                  color: 'var(--text-1)', fontSize: 13, fontWeight: 600,
                  cursor: uploading ? 'default' : 'pointer',
                }}
              >
                <Upload size={14} aria-hidden="true" />
                {uploading ? 'Uploading…' : 'Add documents'}
              </button>
              <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 7 }}>
                PDF, text, Markdown, CSV or JSON — up to 15 MB each. Scanned PDFs
                need OCR before they can be read.
              </div>
            </div>
          </div>
        )}
      </div>

      {quota && quota.limit > 0 && (
        <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-2)', textAlign: 'right' }}>
          {quota.used} of {quota.limit} AI calls used today
        </div>
      )}
    </div>
  )
}
