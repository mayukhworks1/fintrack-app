import { useState, useRef, useEffect } from 'react'
import { FileText, Loader2, Download, RefreshCw, Sparkles, Database, Copy, Check, Square } from 'lucide-react'
import { api } from '../services/api'

function AiText({ text }) {
  if (!text) return null
  const lines = text.split('\n')
  const elements = []
  let i = 0

  const isBullet   = (s) => /^[-•·]\s/.test(s)
  const isNumbered = (s) => /^\d+\.\s/.test(s)

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
        <ol key={`ol-${i}`} className="space-y-1.5 my-2 ml-0.5">
          {items.map((it, j) => (
            <li key={j} className="flex gap-2 sm:gap-2.5 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
              <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5"
                style={{ background: 'rgba(34,197,94,0.12)', color: 'var(--fin-positive)' }}>{j+1}</span>
              <span dangerouslySetInnerHTML={{ __html: it.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/[`#*_]/g,'') }} />
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
            <li key={j} className="flex gap-2 sm:gap-2.5 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
              <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full mt-2" style={{ background: 'var(--fin-positive)' }} />
              <span dangerouslySetInnerHTML={{ __html: it.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/[`#*_]/g,'') }} />
            </li>
          ))}
        </ul>
      )
      continue
    }

    if (/^#{1,3}\s/.test(line)) {
      const heading = line.replace(/^#{1,3}\s/, '')
      elements.push(
        <h3 key={i} className="text-sm font-bold mt-5 mb-2 pt-3"
          style={{ color: 'var(--fin-positive)', borderTop: '1px solid var(--border)' }}>
          {heading.replace(/[`*_]/g,'')}
        </h3>
      )
    } else if (/^[A-Z][A-Za-z\s]{1,30}:\s?/.test(line)) {
      const ci = line.indexOf(':')
      const label = line.slice(0, ci)
      const rest  = line.slice(ci+1).trim()
      elements.push(
        <div key={i} className="mt-3 mb-1">
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--fin-positive)' }}>{label}</span>
          {rest && <span className="text-sm ml-2" style={{ color: 'var(--text-2)' }}
            dangerouslySetInnerHTML={{ __html: rest.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/[`#*_]/g,'') }} />}
        </div>
      )
    } else {
      elements.push(
        <p key={i} className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}
          dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/[`#*_]/g,'') }} />
      )
    }
    i++
  }
  return <div className="space-y-1.5">{elements}</div>
}

export default function Report() {
  const [report, setReport]   = useState('')
  const [model, setModel]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [copied, setCopied]   = useState(false)
  const abortRef = useRef(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const generate = async () => {
    setLoading(true)
    setReport('')
    setModel('')
    setError('')
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const { report: r, model: m } = await api.ai.report({ signal: ctrl.signal })
      setReport(r)
      setModel(m || '')
    } catch (e) {
      if (e.name === 'AbortError') setError('Report generation cancelled.')
      else setError('Failed to generate report: ' + e.message)
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  const cancel = () => abortRef.current?.abort()

  const download = () => {
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

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 animate-fade-in">

      {/* Header — stacks on mobile */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--text-1)' }}>AI Report</h1>
          <p className="text-xs sm:text-sm mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
            <Database size={11} style={{ color: 'var(--fin-positive)' }} />
            Executive summary powered by live data
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {report && (
            <>
              <button onClick={copy}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all hover:bg-white/5"
                style={{
                  color: copied ? 'var(--fin-positive)' : 'var(--text-2)',
                  border: `1px solid ${copied ? 'rgba(34,197,94,0.4)' : 'var(--border)'}`,
                }}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
                <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
              </button>
              <button onClick={download}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all hover:bg-white/5"
                style={{ color: 'var(--text-2)', border: '1px solid var(--border)' }}>
                <Download size={13} /><span className="hidden sm:inline">Download</span>
              </button>
            </>
          )}
          {loading ? (
            <button onClick={cancel}
              className="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all"
              style={{
                background: 'rgba(239,68,68,0.15)',
                border: '1px solid rgba(239,68,68,0.3)',
                color: 'var(--fin-negative)',
              }}>
              <Square size={12} fill="currentColor" /> Stop
            </button>
          ) : (
            <button onClick={generate}
              className="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all"
              style={{
                background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                color: 'white',
                boxShadow: '0 4px 12px rgba(37,99,235,0.25)',
              }}>
              <RefreshCw size={13} />
              {report ? 'Regenerate' : 'Generate'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="card text-sm" style={{ border: '1px solid var(--fin-neg-border)', background: 'rgba(239,68,68,0.05)', color: 'var(--fin-negative)' }}>
          {error}
        </div>
      )}

      {!report && !loading && !error && (
        <div className="card flex flex-col items-center justify-center py-14 sm:py-20 px-4 text-center">
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'var(--accent-dim)', boxShadow: '0 0 24px rgba(34,197,94,0.15)' }}>
            <FileText size={24} style={{ color: 'var(--fin-positive)' }} />
          </div>
          <p className="font-semibold text-base sm:text-lg" style={{ color: 'var(--text-1)' }}>Generate Your Executive Report</p>
          <p className="text-xs sm:text-sm mt-2 max-w-sm" style={{ color: 'var(--text-3)' }}>
            AI will read all your live project records and create a comprehensive portfolio summary with insights and recommendations.
          </p>
          <div className="flex items-center gap-3 sm:gap-4 mt-6 text-[10px] sm:text-xs flex-wrap justify-center" style={{ color: 'var(--text-3)' }}>
            {['Portfolio overview', 'Financial analysis', 'Recommendations'].map((label) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--fin-positive)' }} />
                {label}
              </span>
            ))}
          </div>
          <button onClick={generate}
            className="mt-6 flex items-center gap-2 px-5 sm:px-6 py-2.5 rounded-xl text-sm font-semibold transition-all"
            style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: 'white', boxShadow: '0 4px 12px rgba(34,197,94,0.35)' }}>
            <Sparkles size={15} /> Generate Now
          </button>
        </div>
      )}

      {loading && (
        <div className="card flex flex-col items-center justify-center py-14 sm:py-20 px-4 text-center">
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center mb-4 animate-pulse"
            style={{ background: 'var(--accent-dim)' }}>
            <Sparkles size={24} style={{ color: 'var(--fin-positive)' }} />
          </div>
          <p className="font-semibold text-sm sm:text-base" style={{ color: 'var(--text-1)' }}>Analyzing your portfolio…</p>
          <p className="text-xs sm:text-sm mt-1.5" style={{ color: 'var(--text-3)' }}>Reading all project records — may take 20–40 seconds</p>
          <div className="flex gap-1.5 mt-4">
            {[0, 150, 300].map((d) => (
              <span key={d} className="w-2 h-2 rounded-full animate-bounce"
                style={{ background: 'var(--fin-positive)', animationDelay: `${d}ms` }} />
            ))}
          </div>
        </div>
      )}

      {report && (
        <div className="card animate-fade-in" style={{ border: '1px solid var(--accent-soft)' }}>
          <div className="flex items-center gap-2 mb-4 pb-4 flex-wrap" style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--accent-dim)' }}>
              <FileText size={14} style={{ color: 'var(--fin-positive)' }} />
            </div>
            <span className="text-sm font-semibold" style={{ color: 'var(--fin-positive)' }}>Executive Report</span>
            {model && (
              <span className="text-[10px] flex items-center gap-1 px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(34,197,94,0.08)', color: 'var(--text-3)' }}>
                <Sparkles size={9} style={{ color: 'var(--fin-positive)' }} /> {model}
              </span>
            )}
            <span className="text-xs ml-auto" style={{ color: 'var(--text-3)' }}>
              {new Date().toLocaleDateString('en-IN', { dateStyle: 'long' })}
            </span>
          </div>
          <AiText text={report} />
        </div>
      )}
    </div>
  )
}
