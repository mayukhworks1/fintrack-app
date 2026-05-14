import { useState, useRef, useEffect } from 'react'
import {
  FileText, Loader2, Download, RefreshCw, Sparkles, Database, Copy, Check,
  Square, Printer, TrendingUp, Zap, Clock,
} from 'lucide-react'
import { api } from '../services/api'

/* ── Markdown-lite renderer (tuned for the new professional theme) ───────── */
function AiText({ text }) {
  if (!text) return null
  const lines = text.split('\n')
  const elements = []
  let i = 0

  const isBullet   = (s) => /^[-•·]\s/.test(s)
  const isNumbered = (s) => /^\d+\.\s/.test(s)
  const cleanMd    = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/[`#*_]/g, '')

  while (i < lines.length) {
    const line = lines[i].trim()
    if (!line) { i++; continue }

    if (isNumbered(line)) {
      const items = []
      while (i < lines.length && isNumbered(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s/, ''))
        i++
      }
      elements.push(
        <ol key={`ol-${i}`} className="space-y-2 my-2 ml-0.5">
          {items.map((it, j) => (
            <li key={j} className="flex gap-2.5 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
              <span className="flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold mt-0.5 tabular-nums"
                style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>{j + 1}</span>
              <span dangerouslySetInnerHTML={{ __html: cleanMd(it) }} />
            </li>
          ))}
        </ol>
      )
      continue
    }

    if (isBullet(line)) {
      const items = []
      while (i < lines.length && isBullet(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-•·]\s/, ''))
        i++
      }
      elements.push(
        <ul key={`ul-${i}`} className="space-y-1.5 my-2 ml-0.5">
          {items.map((it, j) => (
            <li key={j} className="flex gap-2.5 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
              <span className="flex-shrink-0 w-1 h-1 rounded-full mt-2.5" style={{ background: 'var(--accent)' }} />
              <span dangerouslySetInnerHTML={{ __html: cleanMd(it) }} />
            </li>
          ))}
        </ul>
      )
      continue
    }

    if (/^#{1,3}\s/.test(line)) {
      const heading = line.replace(/^#{1,3}\s/, '')
      elements.push(
        <h3 key={i} className="text-sm font-semibold mt-5 mb-2 pt-3"
          style={{ color: 'var(--text-1)', borderTop: '1px solid var(--card-border)' }}>
          {heading.replace(/[`*_]/g, '')}
        </h3>
      )
    } else if (/^[A-Z][A-Za-z\s&]{1,40}:\s?/.test(line)) {
      // Section label like "Portfolio Overview:" or "Cash Flow & Collections:"
      const ci = line.indexOf(':')
      const label = line.slice(0, ci)
      const rest  = line.slice(ci + 1).trim()
      elements.push(
        <div key={i} className="mt-5 mb-2 pt-3" style={{ borderTop: '1px solid var(--card-border)' }}>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
            style={{ color: 'var(--accent)', letterSpacing: '0.08em' }}>
            {label}
          </h3>
          {rest && <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}
            dangerouslySetInnerHTML={{ __html: cleanMd(rest) }} />}
        </div>
      )
    } else {
      elements.push(
        <p key={i} className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}
          dangerouslySetInnerHTML={{ __html: cleanMd(line) }} />
      )
    }
    i++
  }
  return <div className="space-y-1.5">{elements}</div>
}

/* ── Main Report page ────────────────────────────────────────────────────── */
export default function Report() {
  const [report,     setReport]    = useState('')
  const [model,      setModel]     = useState('')
  const [loading,    setLoading]   = useState(false)
  const [error,      setError]     = useState('')
  const [copied,     setCopied]    = useState(false)
  const [fromCache,  setFromCache] = useState(false)
  const [cachedAt,   setCachedAt]  = useState('')
  const [duration,   setDuration]  = useState(0)
  const [isEmpty,    setIsEmpty]   = useState(false)
  const abortRef = useRef(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const generate = async ({ force = false } = {}) => {
    setLoading(true)
    setReport('')
    setModel('')
    setError('')
    setFromCache(false)
    setCachedAt('')
    setDuration(0)
    setIsEmpty(false)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const resp = await api.ai.report({ signal: ctrl.signal, force })
      setReport(resp.report || '')
      setModel(resp.model || '')
      setFromCache(!!resp.from_cache)
      setCachedAt(resp.cached_at || '')
      setDuration(resp.duration_ms || 0)
      setIsEmpty(!!resp.empty)
    } catch (e) {
      if (e.name === 'AbortError') setError('Report generation cancelled.')
      else setError('Failed to generate report: ' + e.message)
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  const cancel = () => abortRef.current?.abort()

  const printPdf = () => {
    document.body.classList.add('printing-report')
    window.print()
  }

  useEffect(() => {
    const cleanup = () => document.body.classList.remove('printing-report')
    window.addEventListener('afterprint', cleanup)
    return () => window.removeEventListener('afterprint', cleanup)
  }, [])

  const downloadTxt = () => {
    const blob = new Blob([report], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fintrack-report-${new Date().toISOString().split('T')[0]}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  /* ── Format cached_at as a relative time ── */
  const cachedRelative = (() => {
    if (!cachedAt) return ''
    try {
      const t = new Date(cachedAt).getTime()
      const delta = Math.max(0, Date.now() - t)
      const s = Math.floor(delta / 1000)
      if (s < 60)  return `${s}s ago`
      const m = Math.floor(s / 60)
      if (m < 60)  return `${m}m ago`
      const h = Math.floor(m / 60)
      return `${h}h ago`
    } catch { return '' }
  })()

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 animate-fade-in">

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="page-title">Executive Report</h1>
          <p className="text-xs sm:text-sm mt-1 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
            <Database size={11} style={{ color: 'var(--accent)' }} />
            AI-generated board pack from your live portfolio data
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {report && !isEmpty && (
            <>
              <button onClick={copy} className="btn-ghost"
                style={copied ? { color: 'var(--fin-positive)', borderColor: 'var(--fin-pos-border)', background: 'var(--fin-pos-bg)' } : undefined}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
                <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
              </button>
              <button onClick={downloadTxt} title="Download plain text" className="btn-ghost">
                <Download size={13} /><span className="hidden sm:inline">.txt</span>
              </button>
              <button onClick={printPdf} title="Print / Save as PDF" className="btn-primary">
                <Printer size={13} /><span className="hidden sm:inline">PDF</span>
              </button>
            </>
          )}
          {loading ? (
            <button onClick={cancel} className="btn-ghost"
              style={{ color: 'var(--fin-negative)', borderColor: 'var(--fin-neg-border)', background: 'var(--fin-neg-bg)' }}>
              <Square size={11} fill="currentColor" /> Stop
            </button>
          ) : (
            <button onClick={() => generate({ force: !!report })} className="btn-primary">
              {report ? <RefreshCw size={13} /> : <Sparkles size={13} />}
              {report ? 'Regenerate' : 'Generate'}
            </button>
          )}
        </div>
      </div>

      {/* ── Cache + freshness indicators ─────────────────────────────── */}
      {report && !isEmpty && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-3)' }}>
          {fromCache ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium"
              style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}>
              <Zap size={10} /> Served from cache · {cachedRelative}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium"
              style={{ background: 'var(--fin-pos-bg)', color: 'var(--fin-positive)', border: '1px solid var(--fin-pos-border)' }}>
              <Sparkles size={10} /> Fresh · generated in {(duration / 1000).toFixed(1)}s
            </span>
          )}
          {model && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
              <Sparkles size={9} style={{ color: 'var(--accent)' }} />
              {model}
            </span>
          )}
          {fromCache && (
            <button
              onClick={() => generate({ force: true })}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium transition-colors hover:bg-[var(--accent-dim)]"
              style={{ color: 'var(--text-2)', border: '1px solid var(--card-border)' }}>
              <RefreshCw size={10} /> Force refresh
            </button>
          )}
        </div>
      )}

      {/* ── Error state ──────────────────────────────────────────────── */}
      {error && (
        <div className="card text-sm flex items-start gap-2"
          style={{ borderColor: 'var(--fin-neg-border)', background: 'var(--fin-neg-bg)', color: 'var(--fin-negative)' }}>
          <span className="flex-1">{error}</span>
          <button onClick={() => generate({ force: true })} className="font-semibold underline">
            Try again
          </button>
        </div>
      )}

      {/* ── Empty state ──────────────────────────────────────────────── */}
      {!report && !loading && !error && (
        <div className="card flex flex-col items-center justify-center py-14 sm:py-20 px-4 text-center">
          <div className="flex items-center justify-center mb-4"
            style={{ width: 56, height: 56, borderRadius: 12, background: 'var(--accent-dim)' }}>
            <FileText size={22} style={{ color: 'var(--accent)' }} />
          </div>
          <p className="font-semibold text-base sm:text-lg" style={{ color: 'var(--text-1)' }}>Generate Your Executive Report</p>
          <p className="text-xs sm:text-sm mt-2 max-w-sm" style={{ color: 'var(--text-3)' }}>
            AI synthesises your live projects and invoices into a board-ready summary with
            financial performance, collections analysis, and prioritised action items.
          </p>
          <div className="flex items-center gap-3 sm:gap-4 mt-6 text-[11px] flex-wrap justify-center" style={{ color: 'var(--text-3)' }}>
            {['Portfolio overview', 'Cash flow', 'Recommendations'].map((label) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full" style={{ background: 'var(--accent)' }} />
                {label}
              </span>
            ))}
          </div>
          <button onClick={() => generate()} className="btn-primary mt-6 px-5 py-2.5 text-sm">
            <Sparkles size={14} /> Generate Now
          </button>
          <p className="text-[10px] mt-3 flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
            <Clock size={9} /> First run ~10-20s · subsequent loads are instant from cache
          </p>
        </div>
      )}

      {/* ── Loading state ────────────────────────────────────────────── */}
      {loading && (
        <div className="card flex flex-col items-center justify-center py-14 sm:py-20 px-4 text-center">
          <div className="flex items-center justify-center mb-4 animate-pulse"
            style={{ width: 56, height: 56, borderRadius: 12, background: 'var(--accent-dim)' }}>
            <Sparkles size={22} style={{ color: 'var(--accent)' }} />
          </div>
          <p className="font-semibold text-sm sm:text-base" style={{ color: 'var(--text-1)' }}>
            Analysing your portfolio…
          </p>
          <p className="text-xs sm:text-sm mt-1.5" style={{ color: 'var(--text-3)' }}>
            Reading mirror data and consulting the model — ~10-30 seconds
          </p>
          <div className="flex gap-1.5 mt-4">
            {[0, 150, 300].map((d) => (
              <span key={d} className="w-1.5 h-1.5 rounded-full animate-bounce"
                style={{ background: 'var(--accent)', animationDelay: `${d}ms` }} />
            ))}
          </div>
        </div>
      )}

      {/* ── Empty portfolio state ────────────────────────────────────── */}
      {report && isEmpty && (
        <div className="card text-center py-10" style={{ color: 'var(--text-3)' }}>
          <p className="text-sm">{report}</p>
        </div>
      )}

      {/* ── Generated report ─────────────────────────────────────────── */}
      {report && !isEmpty && (
        <div className="card printable-report animate-fade-in">

          {/* PRINT-ONLY branded letterhead */}
          <div className="print-only print-letterhead">
            <div className="print-brand">
              <div className="print-logo">
                <TrendingUp size={20} color="#fff" />
              </div>
              <div>
                <p className="print-brand-name">FinTrack</p>
                <p className="print-brand-tagline">AI Finance Manager · Board Pack</p>
              </div>
            </div>
            <div className="print-meta">
              <p className="print-meta-label">Report date</p>
              <p className="print-meta-value">{new Date().toLocaleDateString('en-IN', { dateStyle: 'long' })}</p>
            </div>
          </div>

          {/* On-screen toolbar — hidden in print */}
          <div className="print-hide flex items-center gap-2 mb-4 pb-3 flex-wrap"
            style={{ borderBottom: '1px solid var(--card-border)' }}>
            <div className="flex items-center justify-center flex-shrink-0"
              style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--accent-dim)' }}>
              <FileText size={13} style={{ color: 'var(--accent)' }} />
            </div>
            <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Executive Report</span>
            <span className="text-xs ml-auto" style={{ color: 'var(--text-3)' }}>
              {new Date().toLocaleDateString('en-IN', { dateStyle: 'long' })}
            </span>
          </div>

          <AiText text={report} />

          {/* PRINT-ONLY footer */}
          <div className="print-only print-footer">
            <p>Generated by FinTrack · {new Date().toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' })}</p>
            <p>Confidential — for internal use only</p>
          </div>
        </div>
      )}
    </div>
  )
}
