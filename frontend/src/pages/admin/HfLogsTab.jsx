// Extracted from AdminDashboard.jsx — HfLogsTab.
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Activity, XCircle, Terminal } from 'lucide-react'
import { api } from '../../services/api'
import { logLineColor, stripAnsi } from './utils'

export function HfLogsTab() {
  const [logType, setLogType]   = useState('run')
  const [lines, setLines]       = useState([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [lastFetch, setLastFetch] = useState(null)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const fetchLogs = useCallback(async (type = logType) => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.admin.getLogs(type, 400)
      setLines(data.lines || [])
      setLastFetch(new Date())
    } catch (e) {
      setError(e?.error || e?.message || 'Failed to fetch logs')
    } finally {
      setLoading(false)
    }
  }, [logType])

  // Auto-refresh every 20 s when the tab is active and autoRefresh is on
  useEffect(() => {
    fetchLogs(logType)
    if (!autoRefresh) return
    const id = setInterval(() => fetchLogs(logType), 20_000)
    return () => clearInterval(id)
  }, [logType, autoRefresh, fetchLogs])

  // Auto-scroll to bottom when new lines arrive
  const bottomRef = useCallback(node => {
    if (node) node.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <div className="rounded-xl p-3 flex flex-wrap items-center gap-2"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
        <Terminal size={14} style={{ color: '#dc2626' }} />
        <span className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>
          HF Space Logs
        </span>
        <span className="text-xs" style={{ color: 'var(--text-3)' }}>
          Mayukhj24/fintrack-api
        </span>

        {/* Run / Build toggle */}
        <div className="ml-auto flex items-center gap-1 rounded-lg p-0.5"
          style={{ background: 'var(--bg-input)' }}>
          {['run', 'build'].map(t => (
            <button key={t}
              onClick={() => setLogType(t)}
              className="px-3 py-1 rounded-md text-xs font-medium transition-colors"
              style={logType === t
                ? { background: 'rgba(220,38,38,0.15)', color: '#dc2626' }
                : { color: 'var(--text-3)' }}>
              {t === 'run' ? '▶ Runtime' : '🔨 Build'}
            </button>
          ))}
        </div>

        {/* Auto-refresh toggle */}
        <button
          onClick={() => setAutoRefresh(v => !v)}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors"
          style={{
            background: autoRefresh ? 'rgba(34,197,94,0.10)' : 'var(--bg-input)',
            color:      autoRefresh ? '#22c55e' : 'var(--text-3)',
          }}>
          <Activity size={11} />
          {autoRefresh ? 'Live' : 'Paused'}
        </button>

        {/* Manual refresh */}
        <button
          onClick={() => fetchLogs(logType)}
          disabled={loading}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors"
          style={{ background: 'var(--bg-input)', color: 'var(--text-2)' }}>
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>

        {lastFetch && (
          <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
            {lines.length} lines · fetched {lastFetch.toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-xl p-3 text-xs flex items-start gap-2"
          style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#f87171' }}>
          <XCircle size={13} className="flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Failed to load logs</p>
            <p className="mt-0.5 opacity-80">{error}</p>
            {error.includes('HF_TOKEN') && (
              <p className="mt-1 opacity-70">
                Set <code className="font-mono bg-black/20 px-1 rounded">HF_TOKEN</code> in your HF Space → Settings → Repository secrets.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Terminal */}
      {!error && (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          {/* Terminal header */}
          <div className="flex items-center gap-1.5 px-3 py-2"
            style={{ background: '#0f172a', borderBottom: '1px solid #1e293b' }}>
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
            <span className="ml-2 text-[10px] font-mono" style={{ color: '#64748b' }}>
              {logType === 'run' ? 'runtime logs' : 'build logs'} — Mayukhj24/fintrack-api
            </span>
            {loading && (
              <span className="ml-auto text-[10px] font-mono flex items-center gap-1"
                style={{ color: '#22c55e' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                fetching…
              </span>
            )}
          </div>

          {/* Log lines */}
          <div className="overflow-y-auto font-mono text-[11px] leading-relaxed"
            style={{ background: '#0f172a', maxHeight: 560, minHeight: 200 }}>
            {lines.length === 0 && !loading ? (
              <div className="p-4 text-center text-[11px]" style={{ color: '#475569' }}>
                {logType === 'run' ? 'No runtime log lines fetched yet.' : 'No build log lines fetched yet.'}
              </div>
            ) : (
              lines.map((line, i) => {
                const clean = stripAnsi(line.text || '')
                const color = logLineColor(clean)
                return (
                  <div key={i} className="flex gap-2 px-3 py-0.5 hover:bg-white/[0.03]">
                    {line.ts && (
                      <span className="flex-shrink-0 text-[10px] tabular-nums select-none"
                        style={{ color: '#334155', minWidth: 140 }}>
                        {line.ts}
                      </span>
                    )}
                    <span style={{ color, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {clean}
                    </span>
                  </div>
                )
              })
            )}
            <div ref={bottomRef} />
          </div>
        </div>
      )}
    </div>
  )
}
