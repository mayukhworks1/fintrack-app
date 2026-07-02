// Extracted from AdminDashboard.jsx — DeploymentHealthTab.
import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw, CheckCircle2, XCircle
} from 'lucide-react'
import { api } from '../../services/api'
import { Err, HealthEvidenceCard, Skeleton } from './ui'

export function DeploymentHealthTab() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await api.admin.deploymentHealth({ fresh: true, timeout: 18000 })) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const checks = data ? [
    ['PostgreSQL', data.postgres],
    ['Teable', data.teable],
    ['Valkey / Redis', data.valkey],
    ['Email (Brevo)', data.email],
    ['OpenRouter', data.openrouter],
    ['Auth Sessions', data.auth_sessions],
    ['Cron Jobs', data.cron_jobs],
    ['Sync Freshness', data.sync_freshness],
    ['Failed Webhooks', data.failed_webhooks],
    ['Environment', data.env],
  ] : []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>System Health</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Live readiness check for all backend services</p>
        </div>
        <button onClick={load} disabled={loading}
          className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Recheck
        </button>
      </div>

      {loading && !data && <Skeleton rows={5} />}
      {error && <Err msg={error} onRetry={load} />}

      {data && (
        <>
          <div className={`rounded-xl border p-3 flex items-center gap-3`}
            style={{ borderColor: data.overall ? 'rgba(22,163,74,0.3)' : 'rgba(220,38,38,0.3)', background: data.overall ? 'rgba(22,163,74,0.06)' : 'rgba(220,38,38,0.06)' }}>
            {data.overall
              ? <CheckCircle2 size={18} style={{ color: '#16a34a', flexShrink: 0 }} />
              : <XCircle size={18} style={{ color: '#dc2626', flexShrink: 0 }} />}
            <div>
              <p className="text-sm font-semibold" style={{ color: data.overall ? '#16a34a' : '#dc2626' }}>
                {data.overall ? 'All systems operational' : 'One or more systems need attention'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
            {checks.map(([label, item]) => <HealthEvidenceCard key={label} label={label} item={item} />)}
          </div>

          {data.env && !data.env.ok && (
            <div className="rounded-xl border p-3" style={{ borderColor: 'rgba(220,38,38,0.25)', background: 'rgba(220,38,38,0.05)' }}>
              <p className="text-xs font-semibold mb-2" style={{ color: '#dc2626' }}>Missing environment variables</p>
              <div className="space-y-1">
                {Object.entries(data.env.checks || {}).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2 text-xs">
                    {v ? <CheckCircle2 size={11} style={{ color: '#16a34a' }} /> : <XCircle size={11} style={{ color: '#dc2626' }} />}
                    <code style={{ color: v ? 'var(--text-2)' : '#dc2626' }}>{k}</code>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── User Timeline Drawer ──────────────────────────────────────────────────────
