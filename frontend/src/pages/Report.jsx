import { useState, useRef, useEffect, useCallback } from 'react'
import {
  FileText, Loader2, Download, RefreshCw, Sparkles, Database, Copy, Check,
  Square, Printer, Zap, Clock, Activity, BarChart2,
  History, Eye, Trash2,
} from 'lucide-react'
import { api } from '../services/api'
import BrandMark from '../components/BrandMark'

/* ── Markdown-lite renderer (tuned for the new professional theme) ───────── */
function AiText({ text }) {
  if (!text) return null
  const lines = text.split('\n')
  const elements = []
  let i = 0

  const isBullet   = (s) => /^[-•·]\s/.test(s)
  const isNumbered = (s) => /^\d+\.\s/.test(s)
  const escHtml    = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  const cleanMd    = (s) => escHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/[`#*_]/g, '')

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

// ── Report mode configs ───────────────────────────────────────────────────────
const REPORT_MODES = [
  {
    id:       'board-pack',
    label:    'Board Pack',
    icon:     BarChart2,
    desc:     'Full executive report — financials, P&L, invoice health, project status',
    genLabel: 'Analysing portfolio…',
    hint:     'Covers revenue, margins, collections, at-risk projects, and status updates',
    features: ['Portfolio overview', 'Cash flow', 'Recommendations'],
  },
  {
    id:       'status-briefing',
    label:    'Status Briefing',
    icon:     Activity,
    desc:     'Delivery status only — what\'s happening across projects right now',
    genLabel: 'Reading project status…',
    hint:     'Focuses on delivery health, blockers, and next steps — no financial data',
    features: ['Status by category', 'Blockers flagged', 'Key actions'],
  },
]

const REPORT_TEMPLATES = [
  { id: 'board-pack', label: 'Board Pack', mode: 'board-pack', note: 'Full executive pack across revenue, risk, and delivery.' },
  { id: 'founder-weekly', label: 'Founder Weekly', mode: 'board-pack', note: 'Cash, pressure points, and leadership-ready weekly summary.' },
  { id: 'collections-report', label: 'Collections', mode: 'board-pack', note: 'Pending invoices, aging pressure, and receivables follow-up.' },
  { id: 'project-health-review', label: 'Project Health', mode: 'board-pack', note: 'Margin pressure, delivery health, and projects needing review.' },
  { id: 'client-billing-summary', label: 'Client Billing', mode: 'board-pack', note: 'Top billed clients and portfolio concentration.' },
  { id: 'status-board-summary', label: 'Status Board', mode: 'status-briefing', note: 'Current status-board movement and delivery state.' },
]

/* ── Main Report page ────────────────────────────────────────────────────── */
export default function Report() {
  const [reportMode, setReportMode] = useState('board-pack')
  const [report,     setReport]    = useState('')
  const [reportMeta, setReportMeta] = useState({})
  const [model,      setModel]     = useState('')
  const [loading,    setLoading]   = useState(false)
  const [error,      setError]     = useState('')
  const [copied,     setCopied]    = useState(false)
  const [fromCache,  setFromCache] = useState(false)
  const [cachedAt,   setCachedAt]  = useState('')
  const [duration,   setDuration]  = useState(0)
  const [isEmpty,    setIsEmpty]   = useState(false)
  const [history,    setHistory]   = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [activeHistoryId, setActiveHistoryId] = useState('')
  const [deletingHistoryId, setDeletingHistoryId] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState('board-pack')
  const abortRef = useRef(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const resp = await api.ai.reportHistory(20)
      setHistory(resp.items || [])
    } catch {
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  // Clear report when switching modes
  const switchMode = (mode) => {
    if (mode === reportMode) return
    setReportMode(mode)
    setReport('')
    setReportMeta({})
    setModel('')
    setError('')
    setFromCache(false)
    setCachedAt('')
    setIsEmpty(false)
    setActiveHistoryId('')
    const defaultTemplate = REPORT_TEMPLATES.find(t => t.mode === mode)?.id || 'board-pack'
    setSelectedTemplate(defaultTemplate)
  }

  const generate = async ({ force = false } = {}) => {
    setLoading(true)
    setReport('')
    setReportMeta({})
    setModel('')
    setError('')
    setFromCache(false)
    setCachedAt('')
    setDuration(0)
    setIsEmpty(false)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      let resp
      if (reportMode === 'status-briefing') {
        resp = await api.ai.statusBriefing({ signal: ctrl.signal })
        // status-briefing is never cached
        setFromCache(false)
        setCachedAt('')
      } else {
        resp = await api.ai.report({ signal: ctrl.signal, force, template: selectedTemplate })
        setFromCache(!!resp.from_cache)
        setCachedAt(resp.cached_at || '')
      }
      setReport(resp.report || '')
      setReportMeta(resp.metadata || {})
      setModel(resp.model || '')
      setDuration(resp.duration_ms || 0)
      setIsEmpty(!!resp.empty)
      setActiveHistoryId(resp.history_id || '')
      setSelectedTemplate(resp.metadata?.template || selectedTemplate)
      if (resp.history_id) loadHistory()
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

  const openHistory = async (id) => {
    setLoading(true)
    setError('')
    try {
      const resp = await api.ai.reportHistoryDetail(id)
      setReport(resp.report || '')
      setReportMeta(resp.metadata || {})
      setModel(resp.model || '')
      setFromCache(false)
      setCachedAt(resp.created_at || '')
      setDuration(0)
      setIsEmpty(false)
      setActiveHistoryId(id)
      setReportMode(resp.report_type === 'status-briefing' ? 'status-briefing' : 'board-pack')
      setSelectedTemplate(resp.metadata?.template || (resp.report_type === 'status-briefing' ? 'status-board-summary' : 'board-pack'))
    } catch (e) {
      setError('Failed to open report history: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const deleteHistory = async (id) => {
    if (!window.confirm('Delete this saved report from history?')) return
    setDeletingHistoryId(id)
    try {
      await api.ai.reportHistoryDelete(id)
      setHistory(items => items.filter(item => item.id !== id))
      if (activeHistoryId === id) {
        setActiveHistoryId('')
        setReport('')
        setReportMeta({})
        setModel('')
        setFromCache(false)
        setCachedAt('')
        setDuration(0)
        setIsEmpty(false)
      }
    } catch (e) {
      setError('Failed to delete report history: ' + e.message)
    } finally {
      setDeletingHistoryId('')
    }
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

  const currentMode = REPORT_MODES.find(m => m.id === reportMode)
  const visibleTemplates = REPORT_TEMPLATES.filter(template => template.mode === reportMode)
  const metricCards = reportMode === 'status-briefing'
    ? [
        { label: 'Status Rows', value: reportMeta.statuses ?? '—' },
      ]
    : [
        { label: 'Projects', value: reportMeta.projects ?? '—' },
        { label: 'Invoices', value: reportMeta.invoices ?? '—' },
        { label: 'Pending Invoices', value: reportMeta.pending_invoices ?? '—' },
        { label: 'At-Risk Projects', value: reportMeta.at_risk_projects ?? '—' },
      ]

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 animate-fade-in">

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="page-title">AI Reports</h1>
          <p className="text-xs sm:text-sm mt-1 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
            <Database size={11} style={{ color: 'var(--accent)' }} />
            {currentMode?.desc}
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

      {/* ── Mode tabs ────────────────────────────────────────────────── */}
      <div className="flex gap-2 p-1 rounded-xl" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
        {REPORT_MODES.map(mode => {
          const Icon = mode.icon
          const active = reportMode === mode.id
          return (
            <button
              key={mode.id}
              onClick={() => switchMode(mode.id)}
              className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: active ? 'var(--card-bg)' : 'transparent',
                color:      active ? 'var(--text-1)'  : 'var(--text-3)',
                boxShadow:  active ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                border:     active ? '1px solid var(--card-border)' : '1px solid transparent',
              }}
            >
              <Icon size={14} style={{ color: active ? 'var(--accent)' : 'var(--text-3)' }} />
              <span className="hidden xs:inline">{mode.label}</span>
              <span className="inline xs:hidden">{mode.label.split(' ')[0]}</span>
            </button>
          )
        })}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {visibleTemplates.map(template => {
          const active = selectedTemplate === template.id
          return (
            <button
              key={template.id}
              onClick={() => setSelectedTemplate(template.id)}
              className="card text-left transition-all"
              style={{
                borderColor: active ? 'var(--accent)' : 'var(--card-border)',
                boxShadow: active ? '0 0 0 2px rgba(37,99,235,0.10)' : 'var(--card-shadow)',
                background: active ? 'var(--accent-dim)' : 'var(--card-bg)',
              }}
            >
              <p className="text-sm font-semibold" style={{ color: active ? 'var(--accent)' : 'var(--text-1)' }}>{template.label}</p>
              <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-3)' }}>{template.note}</p>
            </button>
          )
        })}
      </div>

      {/* ── Report history ───────────────────────────────────────────── */}
      <div className="card print-hide">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <History size={15} style={{ color: 'var(--accent)' }} />
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Report History</h2>
          </div>
          <button onClick={loadHistory} className="btn-ghost px-2 py-1 text-xs" disabled={historyLoading}>
            <RefreshCw size={12} className={historyLoading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
        {history.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>
            {historyLoading ? 'Loading saved reports…' : 'No saved reports yet. Fresh generated reports will appear here.'}
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {history.map(item => {
              const active = activeHistoryId === item.id
              const meta = item.metadata || {}
              return (
                <div
                  key={item.id}
                  className="rounded-lg p-3 transition-colors"
                  style={{
                    border: active ? '1px solid var(--accent)' : '1px solid var(--card-border)',
                    background: active ? 'var(--accent-dim)' : 'var(--bg-input)',
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      onClick={() => openHistory(item.id)}
                      className="text-left flex-1 min-w-0"
                    >
                      <div className="flex items-center gap-2">
                        <Eye size={13} style={{ color: active ? 'var(--accent)' : 'var(--text-3)' }} />
                        <span className="text-xs font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                          {item.title || item.report_type}
                        </span>
                      </div>
                      <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                        {new Date(item.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                      </p>
                      <p className="text-[11px] mt-1 truncate" style={{ color: 'var(--text-3)' }}>
                        {item.report_type} · {item.model || 'n/a'}
                        {meta.pending_invoices != null ? ` · ${meta.pending_invoices} pending` : ''}
                      </p>
                    </button>
                    <button
                      onClick={() => deleteHistory(item.id)}
                      disabled={deletingHistoryId === item.id}
                      className="btn-ghost px-2 py-1 text-[11px]"
                      title="Delete saved report"
                      style={{ color: 'var(--fin-negative)' }}
                    >
                      <Trash2 size={12} className={deletingHistoryId === item.id ? 'animate-pulse' : ''} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {report && !isEmpty && Object.keys(reportMeta || {}).length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {metricCards.map(card => (
            <div key={card.label} className="card">
              <p className="text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--text-3)' }}>{card.label}</p>
              <p className="text-xl font-bold mt-1" style={{ color: 'var(--text-1)' }}>{card.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Cache + freshness indicators (board-pack only) ──────────── */}
      {report && !isEmpty && reportMode === 'board-pack' && (
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
          <p className="font-semibold text-base sm:text-lg" style={{ color: 'var(--text-1)' }}>Generate {currentMode?.label}</p>
          <p className="text-xs sm:text-sm mt-2 max-w-sm" style={{ color: 'var(--text-3)' }}>
            {currentMode?.hint}
          </p>
          <div className="flex items-center gap-3 sm:gap-4 mt-6 text-[11px] flex-wrap justify-center" style={{ color: 'var(--text-3)' }}>
            {(currentMode?.features || []).map((label) => (
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
            {currentMode?.genLabel || 'Generating report…'}
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
                <BrandMark size={36} />
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
            <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{currentMode?.label || 'Report'}</span>
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
