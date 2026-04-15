import { useState } from 'react'
import { FileText, Loader2, Download, RefreshCw, Sparkles, Database } from 'lucide-react'
import { api } from '../services/api'

export default function Report() {
  const [report, setReport]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const generate = async () => {
    setLoading(true)
    setReport('')
    setError('')
    try {
      const { report: r } = await api.ai.report()
      setReport(r)
    } catch (e) {
      setError('Failed to generate report: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const download = () => {
    const blob = new Blob([report], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fintrack-report-${new Date().toISOString().split('T')[0]}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-6 space-y-5 animate-fade-in">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-1)' }}>AI Report</h1>
          <p className="text-sm mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
            <Database size={11} style={{ color: '#4ade80' }} />
            Executive summary powered by live data
          </p>
        </div>
        <div className="flex gap-2">
          {report && (
            <button onClick={download}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all hover:bg-white/5"
              style={{ color: 'var(--text-2)', border: '1px solid var(--border)' }}>
              <Download size={14} /> Download
            </button>
          )}
          <button onClick={generate} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
            style={{
              background: loading ? 'rgba(34,197,94,0.2)' : 'linear-gradient(135deg, #22c55e, #16a34a)',
              color: 'white',
              boxShadow: loading ? 'none' : '0 4px 12px rgba(34,197,94,0.3)',
            }}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {report ? 'Regenerate' : 'Generate Report'}
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="card text-sm" style={{ border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.05)', color: '#f87171' }}>
          {error}
        </div>
      )}

      {/* Empty state */}
      {!report && !loading && !error && (
        <div className="card flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'rgba(34,197,94,0.1)', boxShadow: '0 0 24px rgba(34,197,94,0.15)' }}>
            <FileText size={28} style={{ color: '#4ade80' }} />
          </div>
          <p className="font-semibold text-lg" style={{ color: 'var(--text-1)' }}>Generate Your Executive Report</p>
          <p className="text-sm mt-2 max-w-sm" style={{ color: 'var(--text-3)' }}>
            AI will read all your live project records and create a comprehensive portfolio summary with insights and recommendations.
          </p>
          <div className="flex items-center gap-4 mt-6 text-xs" style={{ color: 'var(--text-3)' }}>
            {['Portfolio overview', 'Financial analysis', 'Recommendations'].map((label) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#4ade80' }} />
                {label}
              </span>
            ))}
          </div>
          <button onClick={generate}
            className="mt-6 flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all"
            style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: 'white', boxShadow: '0 4px 12px rgba(34,197,94,0.35)' }}>
            <Sparkles size={15} /> Generate Now
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="card flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 animate-pulse"
            style={{ background: 'rgba(34,197,94,0.1)' }}>
            <Sparkles size={28} style={{ color: '#4ade80' }} />
          </div>
          <p className="font-semibold" style={{ color: 'var(--text-1)' }}>Analyzing your portfolio…</p>
          <p className="text-sm mt-1.5" style={{ color: 'var(--text-3)' }}>Reading all project records — this may take 20–40 seconds</p>
          <div className="flex gap-1.5 mt-4">
            {[0, 150, 300].map((d) => (
              <span key={d} className="w-2 h-2 rounded-full animate-bounce"
                style={{ background: '#4ade80', animationDelay: `${d}ms` }} />
            ))}
          </div>
        </div>
      )}

      {/* Report content */}
      {report && (
        <div className="card animate-fade-in" style={{ border: '1px solid rgba(34,197,94,0.2)' }}>
          <div className="flex items-center gap-2 mb-4 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(34,197,94,0.1)' }}>
              <FileText size={14} style={{ color: '#4ade80' }} />
            </div>
            <span className="text-sm font-semibold" style={{ color: '#4ade80' }}>Executive Report</span>
            <span className="text-xs ml-auto" style={{ color: 'var(--text-3)' }}>
              {new Date().toLocaleDateString('en-IN', { dateStyle: 'long' })}
            </span>
          </div>
          <div className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-2)', fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: '0.8rem' }}>
            {report}
          </div>
        </div>
      )}
    </div>
  )
}
