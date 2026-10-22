// Extracted from AdminDashboard.jsx — InsightsTab.
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  RefreshCw
} from 'lucide-react'
import { api } from '../../services/api'
import { Badge, Empty, Err, FSel, Skeleton, StatBox, roleBadge } from './ui'
import { fmt, relTime } from './utils'

export function InsightsTab() {
  const [configs, setConfigs] = useState([])
  const [exports, setExports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [pageKey, setPageKey] = useState('')
  const [kind, setKind] = useState('')
  const [sourceKey, setSourceKey] = useState('')
  const [format, setFormat] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [cfgRes, expRes] = await Promise.all([
        api.admin.insightConfigs({ page_key: pageKey || undefined, config_kind: kind || undefined }),
        api.admin.insightExports({ page_key: pageKey || undefined, source_key: sourceKey || undefined, export_format: format || undefined }),
      ])
      setConfigs(cfgRes.configs || [])
      setExports(expRes.exports || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [format, kind, pageKey, sourceKey])

  useEffect(() => { load() }, [load])

  const dashboardCounts = useMemo(() => {
    const byPage = configs.reduce((acc, row) => {
      acc[row.page_key] = (acc[row.page_key] || 0) + 1
      return acc
    }, {})
    const byFormat = exports.reduce((acc, row) => {
      acc[row.export_format] = (acc[row.export_format] || 0) + 1
      return acc
    }, {})
    return {
      configsTotal: configs.length,
      exportsTotal: exports.length,
      dashboardPages: Object.keys(byPage).length,
      excelExports: byFormat.excel || 0,
      pdfExports: byFormat.pdf || 0,
    }
  }, [configs, exports])

  return (
    <div className="space-y-4">
      <div className="rounded-xl border p-3 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--card-bg)' }}>
        <div className="flex flex-wrap gap-2 items-end">
          <FSel label="Page" value={pageKey} onChange={setPageKey}
            opts={[['', 'All pages'], ['dashboard', 'Dashboard'], ['analytics', 'Analytics']]} />
          <FSel label="Config kind" value={kind} onChange={setKind}
            opts={[['', 'All kinds'], ['dashboard', 'Dashboard']]} />
          <FSel label="Export source" value={sourceKey} onChange={setSourceKey}
            opts={[['', 'All sources'], ['top-projects', 'Top projects'], ['status-summary', 'Status summary'], ['client-summary', 'Client summary'], ['period-invoices', 'Period invoices'], ['cashflow-months', 'Cashflow months'], ['project-profitability', 'Project profitability']]} />
          <FSel label="Format" value={format} onChange={setFormat}
            opts={[['', 'All formats'], ['excel', 'Excel'], ['pdf', 'PDF']]} />
          <button onClick={load} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1">
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
          Tracks saved custom dashboards and every export generated from Dashboard and Analytics.
        </p>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        <StatBox label="Saved dashboards" value={dashboardCounts.configsTotal} sub="Active custom insight presets" color="#2563eb" accent="#2563eb" />
        <StatBox label="Export events" value={dashboardCounts.exportsTotal} sub="All tracked downloads" color="#16a34a" accent="#16a34a" />
        <StatBox label="Pages customized" value={dashboardCounts.dashboardPages} sub="Dashboard + Analytics adoption" color="#7c3aed" accent="#7c3aed" />
        <StatBox label="Excel exports" value={dashboardCounts.excelExports} sub="Spreadsheet downloads" color="#0d9488" accent="#0d9488" />
        <StatBox label="PDF exports" value={dashboardCounts.pdfExports} sub="Portable report downloads" color="#d97706" accent="#d97706" />
      </div>

      {loading ? <Skeleton rows={8} /> : error ? <Err msg={error} onRetry={load} /> : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="card space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Saved insight configs</h3>
                <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{configs.length} config{configs.length === 1 ? '' : 's'}</p>
              </div>
              <Badge color="blue">{configs.length}</Badge>
            </div>
            {configs.length === 0 ? <Empty label="No saved custom dashboards yet" /> : (
              <div className="space-y-2">
                {configs.map((row) => (
                  <div key={row.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{row.title}</p>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          <Badge color="indigo">{row.page_key}</Badge>
                          <Badge color="purple">{row.config_kind}</Badge>
                          {row.role && roleBadge(row.role)}
                        </div>
                      </div>
                      <Badge color={row.is_active ? 'green' : 'amber'}>{row.is_active ? 'active' : 'inactive'}</Badge>
                    </div>
                    <div className="mt-2 text-[11px]" style={{ color: 'var(--text-3)' }}>
                      Updated {relTime(row.updated_at)} · {((row.config?.widgetIds) || []).length} widgets
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Insight exports</h3>
                <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{exports.length} export{exports.length === 1 ? '' : 's'}</p>
              </div>
              <Badge color="teal">{exports.length}</Badge>
            </div>
            {exports.length === 0 ? <Empty label="No exports recorded yet" /> : (
              <div className="space-y-2">
                {exports.map((row) => (
                  <div key={row.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{row.title}</p>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          <Badge color="indigo">{row.page_key}</Badge>
                          <Badge color="blue">{row.source_key}</Badge>
                          <Badge color="green">{row.export_format}</Badge>
                        </div>
                      </div>
                      {row.role && roleBadge(row.role)}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-[11px]" style={{ color: 'var(--text-3)' }}>
                      <span>{fmt(row.row_count)} rows</span>
                      <span>{fmt(row.column_count)} columns</span>
                      <span>{relTime(row.created_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Deployment Health Tab ─────────────────────────────────────────────────────
