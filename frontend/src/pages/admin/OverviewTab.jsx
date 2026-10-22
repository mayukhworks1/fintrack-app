// Extracted from AdminDashboard.jsx — OverviewTab.
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Database, Globe, Zap } from 'lucide-react'
import { api } from '../../services/api'
import { Badge, DeploymentChecklist, Err, StatBox, StatSkeleton } from './ui'
import { cacheGet, cacheSet, fmt, relTime } from './utils'

export function OverviewTab({ onOpenHistoryDrilldown }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const load = useCallback(async (opts = {}) => {
    const cached = cacheGet('overview')
    if (cached && !opts.fresh) { setData(cached); setLoading(false) }
    else setLoading(true)
    setError(null)
    try {
      const fresh = await api.admin.stats({ timeout: 12000, ...opts })
      cacheSet('overview', fresh)
      setData(fresh)
    } catch (e) {
      if (e?.name === 'AbortError') return
      setError(e.message)
    } finally { if (!opts.signal?.aborted) setLoading(false) }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    load({ signal: controller.signal })
    return () => controller.abort()
  }, [load])

  if (!data) {
    return (
      <div className="space-y-6">
        <DeploymentChecklist />
        {loading ? <StatSkeleton /> : error ? <Err msg={error} onRetry={() => load({ fresh: true })} /> : null}
      </div>
    )
  }

  const total24h = data.audit_24h || 0
  const err4xx   = data.audit_4xx_24h || 0
  const err5xx   = data.audit_5xx_24h || 0
  const errRate  = total24h > 0 ? (((err4xx + err5xx) / total24h) * 100).toFixed(1) : '0.0'

  return (
    <div className="space-y-6">
      <DeploymentChecklist />

      {/* Requests */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
          API Traffic
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <StatBox label="Total Requests"    value={data.audit_total}
            sub={`${fmt(data.audit_24h)} today`} />
          <StatBox label="Last Hour"         value={data.audit_1h}
            sub={`${fmt(data.audit_24h)} last 24h`} />
          <StatBox label="Unique IPs (24h)"  value={data.unique_ips_24h} />
          <StatBox label="Error Rate (24h)"  value={`${errRate}%`}
            color={parseFloat(errRate) > 5 ? '#dc2626' : '#16a34a'}
            sub={`${err4xx} client · ${err5xx} server errors`} />
        </div>
      </section>

      {/* Top error paths */}
      {data.top_error_paths?.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
            Top Error Paths (24h)
          </h3>
          <div className="card overflow-hidden p-0">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-2)' }}>
                  <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-3)' }}>Path</th>
                  <th className="text-right px-3 py-2 font-medium" style={{ color: 'var(--text-3)' }}>4xx</th>
                  <th className="text-right px-3 py-2 font-medium" style={{ color: 'var(--text-3)' }}>5xx</th>
                  <th className="text-right px-3 py-2 font-medium" style={{ color: 'var(--text-3)' }}>Total</th>
                  <th className="text-right px-3 py-2 font-medium" style={{ color: 'var(--text-3)' }}>Avg ms</th>
                </tr>
              </thead>
              <tbody>
                {data.top_error_paths.map((r, i) => (
                  <tr key={i} style={{ borderBottom: i < data.top_error_paths.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <td className="px-3 py-2 font-mono truncate max-w-[220px]" style={{ color: 'var(--text-1)' }} title={r.path}>{r.path}</td>
                    <td className="px-3 py-2 text-right" style={{ color: r.client_errors > 0 ? '#d97706' : 'var(--text-3)' }}>{r.client_errors}</td>
                    <td className="px-3 py-2 text-right" style={{ color: r.server_errors > 0 ? '#dc2626' : 'var(--text-3)' }}>{r.server_errors}</td>
                    <td className="px-3 py-2 text-right font-semibold" style={{ color: 'var(--text-1)' }}>{r.total}</td>
                    <td className="px-3 py-2 text-right" style={{ color: 'var(--text-3)' }}>{r.avg_ms ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Top slow paths */}
      {data.top_slow_paths?.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
            Slow Paths (24h · avg &gt;800ms · ≥2 requests)
          </h3>
          <div className="card overflow-hidden p-0">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-2)' }}>
                  <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-3)' }}>Path</th>
                  <th className="text-right px-3 py-2 font-medium" style={{ color: 'var(--text-3)' }}>Avg ms</th>
                  <th className="text-right px-3 py-2 font-medium" style={{ color: 'var(--text-3)' }}>Max ms</th>
                  <th className="text-right px-3 py-2 font-medium" style={{ color: 'var(--text-3)' }}>Requests</th>
                </tr>
              </thead>
              <tbody>
                {data.top_slow_paths.map((r, i) => (
                  <tr key={i} style={{ borderBottom: i < data.top_slow_paths.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <td className="px-3 py-2 font-mono truncate max-w-[260px]" style={{ color: 'var(--text-1)' }} title={r.path}>{r.path}</td>
                    <td className="px-3 py-2 text-right font-semibold"
                      style={{ color: r.avg_ms > 3000 ? '#dc2626' : r.avg_ms > 1500 ? '#d97706' : '#16a34a' }}>
                      {r.avg_ms?.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right" style={{ color: 'var(--text-3)' }}>{r.max_ms?.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right" style={{ color: 'var(--text-3)' }}>{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Requests by role */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
          Requests by Role
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <StatBox label="Editor"   value={data.audit_editor} color="#2563eb" accent="#2563eb" />
          <StatBox label="Web"      value={data.audit_web}    color="#7c3aed" accent="#7c3aed" />
          <StatBox label="All"      value={data.audit_all}    color="#db2777" accent="#db2777" />
          <StatBox label="Viewer"   value={data.audit_viewer} color="#6366f1" accent="#6366f1" />
          <StatBox label="Admin"    value={data.audit_admin}  color="#dc2626" accent="#dc2626" />
          <StatBox label="Anonymous" value={data.audit_anon}  color="var(--text-3)" />
        </div>
      </section>

      {/* Sessions */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
          Login Sessions
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatBox label="Active Sessions"  value={data.sessions_active} color="#16a34a" accent="#16a34a"
            sub={data.sessions_last_active ? `Last: ${relTime(data.sessions_last_active)}` : 'None active'} />
          <StatBox label="Total Sessions"   value={data.sessions_total} />
          <StatBox label="AI Chat Sessions" value={data.chat_sessions_total}
            sub={`${fmt(data.chat_messages_total)} messages`} />
        </div>
      </section>

      {/* Mirror */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
          Teable Mirror (PostgreSQL)
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <StatBox label="Projects"         value={data.projects_total}
            sub={data.projects_last_sync ? `Synced ${relTime(data.projects_last_sync)}` : 'Never synced'} />
          <StatBox label="Main Invoices"    value={data.invoices_total}
            sub={data.invoices_last_sync ? `Synced ${relTime(data.invoices_last_sync)}` : 'Never synced'} />
          <StatBox label="Web Invoices"     value={data.web_invoices_total}
            sub={data.web_invoices_last_sync ? `Synced ${relTime(data.web_invoices_last_sync)}` : 'Never synced'} />
          <StatBox label="Change History"   value={data.history_total}
            sub={`${fmt(data.history_24h)} changes today`} />

          {/* Sync status card */}
          <div className="card flex flex-col gap-1 col-span-2 sm:col-span-1">
            <p className="text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>Last Sync Run</p>
            <p className="text-sm font-semibold"
              style={{ color: data.last_sync_error ? '#dc2626' : '#16a34a' }}>
              {data.last_sync_at ? relTime(data.last_sync_at) : 'Never'}
            </p>
            {data.last_sync_error
              ? <p className="text-[11px] truncate" style={{ color: '#dc2626' }} title={data.last_sync_error}>
                  ✕ {data.last_sync_error}
                </p>
              : data.last_sync_source
                ? <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                    Source: {data.last_sync_source}
                  </p>
                : null
            }
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
          Truth Contract
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="card space-y-2" style={{ borderLeft: '3px solid var(--accent)' }}>
            <div className="flex items-center gap-2">
              <Globe size={14} style={{ color: 'var(--accent)' }} />
              <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Teable is source of truth</p>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>
              Primary operational state should always match Teable. Any discrepancy should be treated as a sync defect, not a product state.
            </p>
          </div>
          <div className="card space-y-2" style={{ borderLeft: '3px solid #16a34a' }}>
            <div className="flex items-center gap-2">
              <Database size={14} style={{ color: '#16a34a' }} />
              <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>PostgreSQL is mirror and history</p>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>
              PG exists for analytics, audit trails, report history, and faster app reads. Mirror freshness is tracked here, not assumed.
            </p>
          </div>
          <div className="card space-y-2" style={{ borderLeft: '3px solid #d97706' }}>
            <div className="flex items-center gap-2">
              <Zap size={14} style={{ color: '#d97706' }} />
              <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Valkey is cache only</p>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>
              Cached responses should improve speed only. If a record looks wrong after refresh, use Sync Log and History to diagnose the mirror path.
            </p>
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
            Mirror Sanity
          </h3>
          <button
            onClick={() => load({ fresh: true })}
            disabled={loading}
            className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            ['Projects', 'projects', data.projects_total, data.projects_stale, data.projects_deleted, data.projects_last_sync],
            ['Invoices', 'invoices', data.invoices_total, data.invoices_stale, data.invoices_deleted, data.invoices_last_sync],
            ['Web invoices', 'web_invoices', data.web_invoices_total, data.web_invoices_stale, data.web_invoices_deleted, data.web_invoices_last_sync],
            ['Status', 'status', data.status_total, data.status_stale, data.status_deleted, data.status_last_sync],
          ].map(([label, sourceTable, total, stale, deleted, lastSync]) => (
            <div key={label} className="card space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{label}</p>
                {(Number(stale) || 0) > 0 ? <Badge color="amber">{fmt(stale)} stale</Badge> : <Badge color="green">Fresh</Badge>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge color="blue">{fmt(total)} total</Badge>
                {(Number(deleted) || 0) > 0 ? (
                  <button
                    type="button"
                    onClick={() => onOpenHistoryDrilldown?.(sourceTable, label)}
                    className="inline-flex items-center"
                    title={`View attributed delete history for ${label}`}
                  >
                    <Badge color="red">{fmt(deleted)} deleted</Badge>
                  </button>
                ) : (
                  <Badge color="default">{fmt(deleted)} deleted</Badge>
                )}
              </div>
              <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                {lastSync ? `Last sync ${relTime(lastSync)}` : 'No sync seen yet'}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
          Shared Link Activity
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatBox label="Links Total" value={data.shared_links_total} />
          <StatBox label="Links Active" value={data.shared_links_active} color="#16a34a" accent="#16a34a" />
          <StatBox label="Editable Links" value={data.shared_links_edit} color="#d97706" accent="#d97706" />
          <StatBox label="Opens (24h)" value={data.shared_link_accesses_24h} sub="All shared modules" />
          <StatBox label="Edits (24h)" value={data.shared_link_edits_24h} sub="Public link mutations" color="#2563eb" accent="#2563eb" />
        </div>
      </section>
    </div>
  )
}

// ── Tab: Audit Log ────────────────────────────────────────────────────────────

// ── Country flag emoji from ISO 2-letter code ────────────────────────────────
