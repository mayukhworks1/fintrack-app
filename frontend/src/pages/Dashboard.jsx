import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  TrendingUp, TrendingDown, IndianRupee, FolderKanban,
  Target, AlertTriangle, RefreshCw, Plus,
  ArrowRight, Flame, Activity, ShieldCheck
} from 'lucide-react'
import EmptyState from '../components/EmptyState'
import InvoiceActivityChart from '../components/InvoiceActivityChart'
import ProjectCard from '../components/ProjectCard'
// Lazy: see the Suspense boundary at the render site for why.
const CustomInsightBlocks = lazy(() => import('../components/CustomInsightBlocks'))
import InsightWorkbench from '../components/InsightWorkbench'
import { api } from '../services/api'
import { useAutoRefresh, useRelativeTime } from '../hooks/useAutoRefresh'
import { LiveValue, LiveDot } from '../components/LiveFigures'
import { formatInr as inr, formatPct } from '../utils/format'
import clsx from 'clsx'
import { plainLabel } from '../utils/plainLabel'

/* Count projects whose health does NOT contain 🔴 */
const countHealthy = (byHealth = {}) =>
  Object.entries(byHealth).reduce((sum, [k, v]) => sum + (k.includes('🔴') ? 0 : v), 0)

function SkeletonCard() {
  return (
    <div className="card space-y-3" aria-hidden="true">
      <div className="skeleton h-3 rounded w-2/3" />
      <div className="skeleton h-8 rounded w-3/4" />
      <div className="skeleton h-3 rounded w-1/2" />
    </div>
  )
}

/* ── KPI card: figure, label, trend. No icon tile. ── */

function KpiCard({ label, value, sub, icon: Icon, accent, trend, tone = 0 }) {
  const accentColor =
    accent === 'positive' ? 'var(--fin-positive)'
    : accent === 'warning' ? 'var(--fin-warning)'
    : accent === 'negative' ? 'var(--fin-negative)'
    : 'var(--text-1)'
  return (
    <div className="card flex items-center gap-3">
      {/* Number + label + trend — full digits, wraps if needed */}
      <div className="min-w-0 flex-1">
        <p className="display-num tabular-nums break-words leading-tight"
          style={{
            color: accentColor,
            fontSize: 'clamp(0.95rem, 2.4vw, 1.35rem)',
            wordBreak: 'break-word',
          }}>
          {value}
        </p>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <p className="text-[11px] leading-tight" style={{ color: 'var(--text-3)' }}>{label}</p>
          {trend != null && Number.isFinite(trend) && (
            <span className="text-[10px] font-bold flex items-center gap-0.5 tabular-nums px-1.5 py-0.5 rounded"
              style={{
                color: trend >= 0 ? 'var(--fin-positive)' : 'var(--fin-negative)',
                background: trend >= 0 ? 'var(--fin-pos-bg)' : 'var(--fin-neg-bg)',
              }}>
              {trend >= 0 ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
              {formatPct(Math.abs(trend), 1)}
            </span>
          )}
        </div>
        {sub && <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{sub}</p>}
      </div>
    </div>
  )
}

/* ── At-risk row ── */
function RiskRow({ project }) {
  const isNeg = project.pct < 0
  return (
    <div className="flex items-center justify-between py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="min-w-0 flex-1 pr-2">
        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-1)' }}>{project.name}</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{plainLabel(project.status || project.health)}</p>
      </div>
      <span className="text-sm font-bold tabular-nums flex-shrink-0"
        style={{ color: isNeg ? 'var(--fin-negative)' : 'var(--fin-warning)' }}>
        {project.pct > 0 ? '+' : ''}{formatPct(project.pct, 2)}
      </span>
    </div>
  )
}

/* ── Client revenue bar ── */
function ClientBar({ client, billed, profit, maxBilled, rank }) {
  const pct    = maxBilled > 0 ? Math.max(4, (billed / maxBilled) * 100) : 4
  const margin = billed > 0 ? (profit / billed) * 100 : 0
  const isPos  = margin >= 0
  const marginColor = margin >= 20 ? 'var(--fin-positive)' : margin >= 0 ? 'var(--fin-warning)' : 'var(--fin-negative)'
  const marginBg    = margin >= 20 ? 'var(--fin-pos-bg)' : margin >= 0 ? 'var(--fin-warn-bg)' : 'var(--fin-neg-bg)'
  // bar gradient: anchor at accent, lighter at edges
  const barGrad = 'var(--accent)'
  const initials = client.split(/\s+/).slice(0,2).map(w=>w[0]?.toUpperCase()).join('')

  return (
    <div
      className="group flex flex-col gap-2 p-3 rounded-2xl transition-all"
      style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--card-bg)'; e.currentTarget.style.borderColor = 'var(--accent-soft)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'var(--glass-bg)'; e.currentTarget.style.borderColor = 'var(--glass-border)' }}
    >
      <div className="flex items-center gap-2.5">
        {/* Avatar */}
        <div className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center text-[11px] font-bold select-none"
          style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}>
          {initials || '#'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug truncate" style={{ color: 'var(--text-1)' }}>{client}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--text-2)' }}>{inr(billed)}</span>
          <span
            className="text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded-full"
            style={{ background: marginBg, color: marginColor }}
          >
            {isPos ? '+' : ''}{formatPct(margin, 1)}
          </span>
        </div>
      </div>
      {/* Bar */}
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: barGrad,
            transition: 'width 0.8s cubic-bezier(0.34,1.26,0.64,1)',
          }}
        />
      </div>
    </div>
  )
}

function useGreeting() {
  return useMemo(() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }, [])
}

const DASHBOARD_WIDGET_CATALOG = [
  { id: 'portfolio_balance', label: 'Portfolio balance', description: 'Net profit hero with revenue, margin, cost load, and at-risk totals.' },
  { id: 'command_center', label: 'Command center', description: 'Top signal, sync state, and the current attention load.' },
  { id: 'kpi_strip', label: 'KPI strip', description: 'Top-level revenue, profit, cost, margin, targets, and project counts.' },
  { id: 'client_revenue', label: 'Revenue by client', description: 'Client concentration and billed totals at a glance.' },
  { id: 'needs_attention', label: 'Needs attention', description: 'Projects with negative profit or critical health.' },
  { id: 'leaders', label: 'Performance leaders', description: 'Top performer and lowest margin cards.' },
  { id: 'status_mix', label: 'Status mix', description: 'Clickable status counts for the current visible portfolio.' },
  { id: 'top_projects', label: 'Top projects', description: 'Highest-billed projects with direct project context and quick navigation.' },
]

const DASHBOARD_DEFAULT_WIDGET_IDS = DASHBOARD_WIDGET_CATALOG.map((widget) => widget.id)

export default function Dashboard() {
  const navigate = useNavigate()
  const greeting = useGreeting()
  const { isEditor } = useAuth()
  const [activeWidgetIds, setActiveWidgetIds] = useState(DASHBOARD_DEFAULT_WIDGET_IDS)
  const [activeCustomBlocks, setActiveCustomBlocks] = useState([])
  const [customSourceRows, setCustomSourceRows] = useState({})

  const [kpiFrom, setKpiFrom] = useState('')
  const [kpiTo,   setKpiTo]   = useState('')

  const fetchAll = useCallback((opts = {}) => {
    const dateOpts = {}
    if (kpiFrom) dateOpts.date_from = kpiFrom
    if (kpiTo)   dateOpts.date_to   = kpiTo
    return Promise.all([
      api.projects.summary({ ...dateOpts, ...opts }),
      api.projects.list({ limit: 6, order_by: 'Amount Billed So far', ...dateOpts, ...opts }),
    ]).then(([summary, list]) => ({ summary, records: list.records || [] }))
  }, [kpiFrom, kpiTo])

  const { data, loading, error, refresh, lastUpdated, changedAt, changeCount, syncing } = useAutoRefresh(fetchAll, 5_000)
  // Deliberately the changed time, not the polled time. The old label read
  // `lastUpdated`, which moves on every poll, so it said "updated just now"
  // every five seconds whether or not a single figure had moved.
  const changedLabel = useRelativeTime(changedAt)

  // Invoice records for the activity timeline chart
  const [invoiceRecords, setInvoiceRecords] = useState([])
  // { total, overdue_count, healthy, overdue: [≤6 slim rows] } — computed
  // server-side so the retainer card no longer needs every invoice in memory.
  const [retainerSummary, setRetainerSummary] = useState(null)
  const [chartPreset, setChartPreset] = useState('60d')
  const [chartFrom,   setChartFrom]   = useState('')
  const [chartTo,     setChartTo]     = useState('')
  const [agingBuckets, setAgingBuckets] = useState(null)
  useEffect(() => {
    let cancelled = false
    // One slim payload instead of 400 full records. The server computes the
    // retainer aggregate; the chart still gets one row per invoice, but only
    // the fields it reads. `month` is sent so "this month" is decided in the
    // user's timezone, exactly as the widget did when it ran client-side.
    const now = new Date()
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    api.invoices.dashboardActivity({ month })
      .then(r => {
        if (cancelled) return
        setInvoiceRecords(r?.activity || [])
        setRetainerSummary(r?.retainer || null)
      })
      .catch(() => {})
    api.invoices.agingBuckets()
      .then(r => { if (!cancelled) setAgingBuckets(r) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const s      = data?.summary
  const recent = data?.records || []
  const recentSignals = recent
    .map((record) => {
      const profit = Number(record.fields?.['Profit percentage'] || 0)
      const health = record.fields?.['Health'] || ''
      const severityRank = profit < 0
        ? 3
        : health === 'Critical'
          ? 3
          : health === 'At Risk'
            ? 2
            : 1
      return { record, severityRank, profit, health }
    })
    .sort((a, b) => b.severityRank - a.severityRank || a.profit - b.profit)
  const leadSignal = recentSignals[0]
  const leadRecord = leadSignal?.record
  const blockedRecent = recent.filter(r => {
    const profit = Number(r.fields?.['Profit percentage'] || 0)
    const health = r.fields?.['Health'] || ''
    return profit < 0 || health === 'Critical' || health === 'At Risk'
  }).length

  const margin    = s?.total_billed > 0 ? (s.total_profit / s.total_billed) * 100 : 0
  const costRatio = s?.total_billed > 0 ? (s.total_cost   / s.total_billed) * 100 : 0
  const maxBilled = s ? Math.max(...Object.values(s.client_billed || {}).map(Number), 1) : 1
  const atRisk    = s?.at_risk || []
  const healthOk  = countHealthy(s?.by_health)
  const statusEntries = Object.entries(s?.by_status || {})
  const healthiestPct = (s?.total_projects ?? 0) > 0 ? (healthOk / s.total_projects) * 100 : 0
  const visibleWidgets = useMemo(
    () => new Set(activeWidgetIds.length ? activeWidgetIds : DASHBOARD_DEFAULT_WIDGET_IDS),
    [activeWidgetIds]
  )
  const dashboardSourceOptions = useMemo(() => {
    const projectColumns = [
      { key: 'client', label: 'Client' },
      { key: 'project', label: 'Project' },
      { key: 'status', label: 'Status' },
      { key: 'health', label: 'Health' },
      { key: 'billed', label: 'Billed' },
      { key: 'profit', label: 'Profit' },
      { key: 'profit_pct', label: 'Profit %' },
    ]
    return [
      {
        key: 'top-projects',
        label: 'Top projects snapshot',
        columns: projectColumns,
        defaultColumns: projectColumns.map((col) => col.key),
        loadRows: async () => {
          const res = await api.projects.list({ limit: 500, order_by: 'Amount Billed So far' })
          return (res.records || []).map((record) => ({
            client: record.fields?.['Client'] || '',
            project: record.fields?.['Project Name'] || '',
            status: record.fields?.['Project Status'] || '',
            health: record.fields?.['Health'] || '',
            billed: record.fields?.['Amount Billed So far'] || 0,
            profit: record.fields?.['Actual Profit'] || 0,
            profit_pct: record.fields?.['Profit percentage'] || 0,
          }))
        },
        getRows: () => recent.map((record) => ({
          client: record.fields?.['Client'] || '',
          project: record.fields?.['Project Name'] || '',
          status: record.fields?.['Project Status'] || '',
          health: record.fields?.['Health'] || '',
          billed: record.fields?.['Amount Billed So far'] || 0,
          profit: record.fields?.['Actual Profit'] || 0,
          profit_pct: record.fields?.['Profit percentage'] || 0,
        })),
      },
      {
        key: 'status-summary',
        label: 'Status mix',
        columns: [
          { key: 'status', label: 'Status' },
          { key: 'projects', label: 'Projects' },
        ],
        defaultColumns: ['status', 'projects'],
        getRows: () => statusEntries.map(([status, projects]) => ({ status, projects })),
      },
      {
        key: 'client-summary',
        label: 'Client revenue summary',
        columns: [
          { key: 'client', label: 'Client' },
          { key: 'billed', label: 'Billed' },
          { key: 'profit', label: 'Profit' },
        ],
        defaultColumns: ['client', 'billed', 'profit'],
        getRows: () => Object.entries(s?.client_billed || {}).map(([client, billed]) => ({
          client,
          billed,
          profit: s?.client_profit?.[client] || 0,
        })),
      },
    ]
  }, [recent, s, statusEntries])

  return (
    <div
      className="p-4 sm:p-5 space-y-5 animate-fade-in rounded-[28px]"
      style={{ background: 'var(--hero-wash)' }}
    >

      {/* Header */}
      <div className="rounded-[28px] p-4 sm:p-5" style={{ background: 'var(--glass-bg)', border: '1px solid var(--card-border)' }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold tabular-nums tracking-[0.06em] uppercase"
              style={{ color: 'var(--accent)' }}>
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <h1 className="text-[2rem] sm:text-[2.5rem] font-semibold" style={{ color: 'var(--text-1)', letterSpacing: '-0.02em', lineHeight: 1 }}>
              {greeting}, Mayukh
            </h1>
            <p className="text-sm max-w-xl" style={{ color: 'var(--text-3)' }}>
              Executive overview of portfolio health, project cashflow, and operational pressure points.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <InsightWorkbench
              pageKey="dashboard"
              pageLabel="Dashboard"
              widgetCatalog={DASHBOARD_WIDGET_CATALOG}
              defaultWidgetIds={activeWidgetIds}
              factoryWidgetIds={DASHBOARD_DEFAULT_WIDGET_IDS}
              sourceOptions={dashboardSourceOptions}
              currentFilters={{ updated_at: lastUpdated || null }}
              // lastUpdated moves on every poll; key loaded rows to real changes.
              rowsKey={changeCount}
              onApplyWidgets={setActiveWidgetIds}
              onApplyCustomBlocks={(blocks, rowsByKey) => {
                setActiveCustomBlocks(blocks)
                setCustomSourceRows(rowsByKey || {})
              }}
            />
            <button
              onClick={refresh}
              disabled={loading}
              aria-label="Refresh"
              className="inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-medium"
              style={{ background: 'var(--bg-input)', color: 'var(--text-2)', border: '1px solid var(--card-border)' }}
            >
              <RefreshCw size={14} className={clsx(loading && 'animate-spin')} />
              Refresh
            </button>
            {isEditor && (
              <button
                onClick={() => navigate('/projects/new')}
                className="inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold"
                style={{ background: 'var(--accent-gradient)', color: 'var(--accent-fg)', boxShadow: 'var(--btn-shadow)' }}
              >
                <Plus size={14} aria-hidden="true" />
                New Project
              </button>
            )}
          </div>
        </div>

        <div className={clsx('mt-4 grid gap-4', visibleWidgets.has('portfolio_balance') && visibleWidgets.has('command_center') ? 'grid-cols-1 xl:grid-cols-[1.9fr_0.95fr]' : 'grid-cols-1')}>
          {visibleWidgets.has('portfolio_balance') && (
          <div className="rounded-[28px] p-5 sm:p-6" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
            <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--text-3)' }}>Portfolio balance</p>
                <h2 className="text-[2.35rem] sm:text-[3rem] font-semibold mt-2 tabular-nums leading-none" style={{ color: 'var(--text-1)', letterSpacing: '-0.02em' }}>
                  <LiveValue value={s?.total_profit} format={inr} />
                </h2>
                <p className="text-sm mt-2 max-w-xl" style={{ color: 'var(--text-3)' }}>
                  Net profit from <LiveValue value={s?.total_billed} format={inr} style={{ color: 'var(--text-2)' }} /> billed across {s?.total_projects ?? 0} active portfolio entries.
                </p>
              </div>
              <div className="rounded-3xl px-4 py-3 min-w-[160px]" style={{ background: 'var(--fin-pos-bg)', border: '1px solid var(--fin-pos-border)' }}>
                <p className="text-[11px] uppercase tracking-[0.06em]" style={{ color: 'var(--text-3)' }}>Healthy projects</p>
                <p className="text-[1.9rem] font-semibold mt-1 tabular-nums leading-none" style={{ color: 'var(--fin-positive)' }}>
                  {healthOk}/{s?.total_projects ?? 0}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{formatPct(healthiestPct, 1)} portfolio health coverage</p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Revenue', value: s?.total_billed, format: inr, tone: 'var(--text-1)' },
                { label: 'Margin', value: margin, format: v => formatPct(v, 2), tone: margin >= 0 ? 'var(--fin-positive)' : 'var(--fin-negative)' },
                { label: 'Cost load', value: costRatio, format: v => formatPct(v, 1), tone: 'var(--fin-warning)' },
                { label: 'At risk', value: atRisk.length, format: v => String(Math.round(v)), tone: atRisk.length ? 'var(--fin-negative)' : 'var(--text-1)' },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl p-4" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                  <p className="text-[11px] uppercase tracking-[0.06em]" style={{ color: 'var(--text-3)' }}>{item.label}</p>
                  <p className="text-lg sm:text-xl font-semibold mt-2 tabular-nums" style={{ color: item.tone }}>
                    <LiveValue value={item.value} format={item.format} />
                  </p>
                </div>
              ))}
            </div>
          </div>
          )}

          {visibleWidgets.has('command_center') && (
          <div className="rounded-[28px] p-5 sm:p-6" style={{ background: 'var(--glass-bg)', border: '1px solid var(--card-border)' }}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--text-3)' }}>Command center</p>
                <h2 className="text-xl font-semibold mt-2" style={{ color: 'var(--text-1)' }}>What needs action</h2>
              </div>
              {lastUpdated && (
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-[0.06em]" style={{ color: 'var(--text-3)' }}>Sync</p>
                  <p className="text-xs mt-1 flex items-center gap-1.5 justify-end" style={{ color: 'var(--text-2)' }}>
                    <LiveDot changeCount={changeCount} loading={syncing && !data} />
                    {changedAt ? `changed ${changedLabel}` : 'up to date'}
                  </p>
                </div>
              )}
            </div>

            <div className="mt-5 space-y-3">
              <div className="rounded-2xl p-4" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                <p className="text-[11px] uppercase tracking-[0.06em]" style={{ color: 'var(--text-3)' }}>Top signal</p>
                <p className="text-base font-semibold mt-2" style={{ color: 'var(--text-1)' }}>
                  {leadRecord ? `${leadRecord.fields?.['Client'] || 'Unknown'} / ${leadRecord.fields?.['Project Name'] || 'Project'}` : 'No project performance signal yet'}
                </p>
                <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
                  {leadSignal
                    ? (leadSignal.profit < 0
                      ? `${formatPct(leadSignal.profit, 2)} margin currently needs intervention.`
                      : `${leadSignal.health || 'Project'} health with live project financial context.`)
                    : 'As project financials settle in, this space will surface the strongest performer.'}
                </p>
              </div>
              <div className="rounded-2xl p-4" style={{ background: 'var(--fin-neg-bg)', border: '1px solid var(--fin-neg-border)' }}>
                <p className="text-[11px] uppercase tracking-[0.06em]" style={{ color: 'var(--text-3)' }}>Attention load</p>
                <p className="text-base font-semibold mt-2" style={{ color: blockedRecent ? 'var(--fin-negative)' : 'var(--text-1)' }}>
                  {blockedRecent
                    ? `${blockedRecent} project${blockedRecent === 1 ? '' : 's'} need review`
                    : 'No critical portfolio blockers'}
                </p>
                <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
                  {blockedRecent
                    ? 'Based on project health and margin signals from the live project records.'
                    : 'No negative margin or critical health flags in the visible control set.'}
                </p>
              </div>
            </div>
          </div>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div role="alert" className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
          style={{ background: 'var(--fin-neg-bg)', border: '1px solid var(--fin-neg-border)', color: 'var(--fin-negative)' }}>
          <AlertTriangle size={15} aria-hidden="true" /> {error}.
          <button onClick={refresh} className="underline">retry</button>
        </div>
      )}

      {/* Deferred: this is the only Dashboard dependency that imports recharts,
          and it sits at the bottom of the page. Eager, it put the ~373 KB chart
          chunk (plus d3) on the first-paint critical path for every user, for
          content they had to scroll to. Lazy, the KPI strip and tables render
          before the chart library has even started downloading. */}
      <Suspense fallback={null}>
        <CustomInsightBlocks
          blocks={activeCustomBlocks}
          sourceOptions={dashboardSourceOptions}
          sourceRowsByKey={customSourceRows}
        />
      </Suspense>


      {/* ── KPI row — 2 cols mobile → 3 cols tablet → 6 cols desktop ── */}
      {visibleWidgets.has('kpi_strip') && (
      <section aria-label="Key metrics">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <p className="text-[11px] uppercase tracking-[0.06em] font-semibold" style={{ color: 'var(--text-3)' }}>Filter by date</p>
          <input
            type="date" value={kpiFrom} onChange={e => setKpiFrom(e.target.value)}
            className="input text-xs px-2 py-2 rounded-lg"
            style={{ minWidth: 120, maxWidth: 140, minHeight: 38 }}
          />
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>to</span>
          <input
            type="date" value={kpiTo} onChange={e => setKpiTo(e.target.value)}
            className="input text-xs px-2 py-2 rounded-lg"
            style={{ minWidth: 120, maxWidth: 140, minHeight: 38 }}
          />
          {(kpiFrom || kpiTo) && (
            <button
              onClick={() => { setKpiFrom(''); setKpiTo('') }}
              className="text-xs px-2 py-2 rounded-lg"
              style={{ color: 'var(--text-3)', background: 'var(--bg-input)', border: '1px solid var(--border)' }}
            >
              Clear
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {loading && !data
            ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
            : <>
                <KpiCard tone={0}
                  label="Total Revenue"
                  value={<LiveValue value={s?.total_billed} format={inr} />}
                  icon={IndianRupee}
                />
                <KpiCard tone={1}
                  label="Net Profit"
                  value={<LiveValue value={s?.total_profit} format={inr} />}
                  icon={TrendingUp}
                  accent={(s?.total_profit ?? 0) >= 0 ? 'positive' : 'negative'}
                  trend={s?.avg_profit_pct}
                />
                <KpiCard tone={2}
                  label="Total Cost"
                  value={<LiveValue value={s?.total_cost} format={inr} />}
                  icon={Activity}
                  sub={s?.total_cost > 0 ? `${formatPct(costRatio, 1)} of revenue` : undefined}
                />
                <KpiCard tone={3}
                  label="Profit Margin"
                  value={<LiveValue value={margin} format={v => formatPct(v, 2)} />}
                  icon={Flame}
                  accent={margin >= 20 ? 'positive' : margin >= 0 ? 'warning' : 'negative'}
                />
                <KpiCard tone={4}
                  label="Targets Hit"
                  value={<><LiveValue value={s?.target_achieved_count ?? 0} format={v => String(Math.round(v))} /> / <LiveValue value={s?.total_projects ?? 0} format={v => String(Math.round(v))} /></>}
                  icon={Target}
                />
                <KpiCard tone={5}
                  label="Projects"
                  value={s?.total_projects == null ? '—' : <LiveValue value={s.total_projects} format={v => String(Math.round(v))} />}
                  icon={FolderKanban}
                  sub={`${healthOk} healthy`}
                />
              </>
          }
        </div>
      </section>
      )}

      {/* ── Retainer health ── */}
      {retainerSummary && retainerSummary.total > 0 && (() => {
        // The filter, the overdue rule and the counts now come from the
        // server. `overdue` is capped at six rows there, so the counts must
        // come from the aggregate, not from the rows' length.
        const overdue      = retainerSummary.overdue || []
        const overdueCount = retainerSummary.overdue_count || 0
        const healthy      = retainerSummary.healthy || 0
        return (
          <div className="rounded-[20px] p-4 sm:p-5" style={{ background: 'var(--glass-bg)', border: '1px solid var(--card-border)' }}>
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--text-3)' }}>Retainer health</p>
                <p className="text-base font-semibold mt-1" style={{ color: 'var(--text-1)' }}>
                  {overdueCount ? `${overdueCount} retainer${overdueCount > 1 ? 's' : ''} with outstanding balance` : 'All retainers cleared'}
                </p>
              </div>
              <div className="flex gap-3">
                <div className="rounded-xl px-3 py-2 text-center" style={{ background: 'var(--fin-pos-bg)' }}>
                  <p className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Healthy</p>
                  <p className="text-lg font-bold tabular-nums" style={{ color: 'var(--fin-positive)' }}>{healthy}</p>
                </div>
                <div className="rounded-xl px-3 py-2 text-center" style={{ background: overdueCount ? 'var(--fin-warn-bg)' : 'var(--fin-pos-bg)' }}>
                  <p className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Overdue</p>
                  <p className="text-lg font-bold tabular-nums" style={{ color: overdueCount ? 'var(--fin-warning)' : 'var(--fin-positive)' }}>{overdueCount}</p>
                </div>
              </div>
            </div>
            {overdueCount > 0 && (
              <div className="space-y-2 mt-2">
                {overdue.slice(0, 6).map(r => {
                  const f = r.fields || {}
                  const outstanding = Number(f['Outstanding Amount'] || 0)
                  return (
                    <div key={r.id} className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
                      style={{ background: 'var(--fin-neg-bg)', border: '1px solid var(--fin-neg-border)' }}>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{f['Client Name'] || f['Client'] || '—'}</p>
                        <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-3)' }}>{f['Project'] || f['Invoice Number'] || ''}{f['Raised Date'] ? ` · ${f['Raised Date'].slice(0, 7)}` : ''}</p>
                      </div>
                      <p className="text-sm font-bold tabular-nums flex-shrink-0" style={{ color: 'var(--fin-warning)' }}>{inr(outstanding)}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Invoice activity timeline ── */}
      {invoiceRecords.length > 0 && (() => {
        const PRESETS = [
          { key: '30d',    label: '30d',   days: 30 },
          { key: '60d',    label: '60d',   days: 60 },
          { key: '3m',     label: '3 mo',  days: 90 },
          { key: '6m',     label: '6 mo',  days: 180 },
          { key: '1y',     label: '1 yr',  days: 365 },
          { key: 'custom', label: 'Custom',days: null },
        ]
        const activePreset  = PRESETS.find(p => p.key === chartPreset) || PRESETS[1]
        const chartFromProp = chartPreset === 'custom' ? chartFrom : undefined
        const chartToProp   = chartPreset === 'custom' ? chartTo   : undefined
        const chartDaysProp = chartPreset === 'custom' ? 60 : (activePreset.days || 60)
        const labelText = chartPreset === 'custom' && chartFrom
          ? `${chartFrom}${chartTo ? ' to ' + chartTo : ''}`
          : `last ${activePreset.label}`
        return (
          <section aria-label="Invoice activity timeline">
            <div className="card overflow-hidden" style={{ padding: 0 }}>
              <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-2">
                <div>
                  <p className="text-sm font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.01em' }}>
                    Invoice activity · {labelText}
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                    Cumulative billing · bar height = amount ·
                    <span className="inline-flex items-center gap-1 ml-1">
                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--fin-positive)' }} />paid
                      <span className="inline-block w-2 h-2 rounded-full ml-1" style={{ background: 'var(--fin-negative)' }} />overdue
                      <span className="inline-block w-2 h-2 rounded-full ml-1" style={{ background: 'var(--text-3)' }} />pending
                    </span>
                  </p>
                </div>
                {/* ── Date range controls ── */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center rounded-lg p-0.5 gap-0.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                    {PRESETS.map(p => (
                      <button key={p.key}
                        onClick={() => setChartPreset(p.key)}
                        className="text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors"
                        style={chartPreset === p.key
                          ? { background: 'var(--card-bg)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }
                          : { color: 'var(--text-3)' }}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                  {chartPreset === 'custom' && (
                    <div className="flex items-center gap-1.5">
                      <input type="date" value={chartFrom} onChange={e => setChartFrom(e.target.value)}
                        className="text-[11px] px-2 py-1.5 rounded-md"
                        style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)', color: 'var(--text-1)', outline: 'none', minHeight: 36 }} />
                      <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>to</span>
                      <input type="date" value={chartTo} onChange={e => setChartTo(e.target.value)}
                        className="text-[11px] px-2 py-1.5 rounded-md"
                        style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)', color: 'var(--text-1)', outline: 'none', minHeight: 36 }} />
                    </div>
                  )}
                </div>
              </div>
              <InvoiceActivityChart
                records={invoiceRecords}
                days={chartDaysProp}
                from={chartFromProp}
                to={chartToProp}
                className="px-2 pb-1"
              />
            </div>
          </section>
        )
      })()}

      {/* ── Aging Buckets widget ── */}
      {agingBuckets && agingBuckets.total_pending > 0 && (
        <section aria-label="Invoice aging buckets">
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.01em' }}>Collections aging</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                  {agingBuckets.total_pending} pending invoice{agingBuckets.total_pending !== 1 ? 's' : ''} · ₹{Number(agingBuckets.total_outstanding).toLocaleString('en-IN')} outstanding
                </p>
              </div>
              <a href="/invoices?status=Pending" className="text-[11px] font-medium" style={{ color: 'var(--accent)' }}>View all</a>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(agingBuckets.buckets || []).map((b, i) => {
                const colors = ['var(--fin-positive)', 'var(--fin-warning)', 'color-mix(in srgb, var(--fin-warning) 50%, var(--fin-negative))', 'var(--fin-negative)']
                const color = colors[i] || 'var(--text-3)'
                const light = `color-mix(in srgb, ${color} 9%, var(--card-bg))`
                const pct = agingBuckets.total_outstanding > 0 ? (b.amount / agingBuckets.total_outstanding * 100) : 0
                return (
                  <div key={b.label} className="rounded-xl p-3" style={{ background: light, border: `1px solid color-mix(in srgb, ${color} 19%, transparent)` }}>
                    <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color }}>{b.label}</p>
                    <p className="text-base font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>
                      ₹{Number(b.amount).toLocaleString('en-IN')}
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>{b.count} invoice{b.count !== 1 ? 's' : ''}</p>
                    <div className="mt-2 rounded-full overflow-hidden" style={{ height: 4, background: `color-mix(in srgb, ${color} 15%, transparent)` }}>
                      <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: color, borderRadius: 9999 }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── Middle row ── */}
      {(visibleWidgets.has('client_revenue') || visibleWidgets.has('needs_attention') || visibleWidgets.has('leaders')) && (
      <section
        aria-label="Portfolio breakdown"
        className={clsx(
          'grid gap-4',
          [
            visibleWidgets.has('client_revenue'),
            visibleWidgets.has('needs_attention'),
            visibleWidgets.has('leaders'),
          ].filter(Boolean).length >= 3 ? 'grid-cols-1 lg:grid-cols-3' : 'grid-cols-1 lg:grid-cols-2'
        )}
      >

        {/* Client revenue */}
        {visibleWidgets.has('client_revenue') && (
        <div className="card">
          <h2 className="section-title mb-4">Revenue by Client</h2>
          {loading && !data
            ? <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}</div>
            : <div className="space-y-2">
                {Object.entries(s?.client_billed || {}).length === 0
                  ? <p className="text-sm" style={{ color: 'var(--text-3)' }}>No data yet</p>
                  : Object.entries(s.client_billed)
                      .sort(([,a],[,b]) => b - a)
                      .map(([cl, billed], i) => (
                        <ClientBar key={cl} client={cl} billed={billed}
                          profit={s.client_profit?.[cl] || 0} maxBilled={maxBilled} rank={i} />
                      ))
                }
              </div>
          }
        </div>
        )}

        {/* Needs attention */}
        {visibleWidgets.has('needs_attention') && (
        <div className="card">
          <h2 className="section-title mb-1">Needs Attention</h2>
          <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>Negative profit or critical health</p>
          {loading && !data ? <SkeletonCard /> :
            atRisk.length === 0
              ? <EmptyState
                  compact
                  icon={<ShieldCheck size={20} />}
                  title="All projects healthy"
                  subtitle="No negative margin or critical health flags found."
                />
              : <div>{atRisk.map((p, i) => <RiskRow key={i} project={p} />)}</div>
          }
        </div>
        )}

        {/* Best & worst */}
        {visibleWidgets.has('leaders') && (
        <div className="card flex flex-col gap-4">
          {/* Top performer */}
          <div>
            <p className="section-title mb-3">Top Performer</p>
            {loading && !data ? <SkeletonCard /> :
              s?.best_project?.name
                ? <div className="rounded-xl p-3"
                    style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)' }}>
                    <p className="text-sm font-semibold leading-snug" style={{ color: 'var(--text-1)' }}>
                      {s.best_project.name}
                    </p>
                    <p className="text-2xl font-bold mt-1 tabular-nums" style={{ color: 'var(--fin-positive)' }}>
                      {s.best_project.pct >= 0 ? '+' : ''}{formatPct(s.best_project.pct, 2)}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>profit margin</p>
                  </div>
                : <p className="text-sm" style={{ color: 'var(--text-3)' }}>No data</p>
            }
          </div>

          {/* Lowest margin */}
          <div>
            <p className="section-title mb-3">Lowest Margin</p>
            {loading && !data ? <SkeletonCard /> :
              s?.worst_project?.name
                ? <div className="rounded-xl p-3"
                    style={{ background: 'var(--fin-neg-bg)', border: '1px solid var(--fin-neg-border)' }}>
                    <p className="text-sm font-semibold leading-snug" style={{ color: 'var(--text-1)' }}>
                      {s.worst_project.name}
                    </p>
                    <p className="text-2xl font-bold mt-1 tabular-nums"
                      style={{ color: s.worst_project.pct < 0 ? 'var(--fin-negative)' : 'var(--fin-warning)' }}>
                      {s.worst_project.pct > 0 ? '+' : ''}{formatPct(s.worst_project.pct, 2)}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>profit margin</p>
                  </div>
                : <p className="text-sm" style={{ color: 'var(--text-3)' }}>No data</p>
            }
          </div>
        </div>
        )}
      </section>
      )}

      {/* ── Status chips ── */}
      {visibleWidgets.has('status_mix') && statusEntries.length > 0 && (
        <section aria-label="Projects by status">
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-5 gap-3">
            {statusEntries.map(([status, count]) => {
              const accent = status.includes('Active')    ? 'var(--fin-positive)'
                           : status.includes('Completed') ? 'var(--accent)'
                           : status.includes('Hold')      ? 'var(--fin-warning)'
                           : 'var(--fin-negative)'
              return (
                <button key={status}
                  onClick={() => navigate(`/projects?status=${encodeURIComponent(status)}`)}
                  className="card text-center transition-colors active:scale-[0.99] p-3 sm:p-5"
                  aria-label={`${count} ${status} projects`}>
                  <div className="flex items-center justify-center gap-1.5 mb-1">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: accent }} />
                    <p className="text-[10px] sm:text-xs truncate" style={{ color: 'var(--text-3)' }}>{status}</p>
                  </div>
                  <p className="text-2xl sm:text-3xl font-semibold tabular-nums" style={{ color: 'var(--text-1)' }}>{count}</p>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Top projects ── */}
      {visibleWidgets.has('top_projects') && (
      <section aria-label="Top projects by billing">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="section-title">Top Projects by Revenue</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Sorted by total billed. Click any card to open the project detail.</p>
          </div>
          <button onClick={() => navigate('/projects')}
            className="text-xs font-medium flex items-center gap-1 transition-opacity hover:opacity-70"
            style={{ color: 'var(--accent)' }}>
            View all <ArrowRight size={12} aria-hidden="true" />
          </button>
        </div>

        {loading && !data
          ? <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          : recent.length > 0
            ? <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {recent.map(r => <ProjectCard key={r.id} record={r} />)}
              </div>
            : <div className="text-center py-12" style={{ color: 'var(--text-3)' }}>
                No projects yet.{' '}
                <button onClick={() => navigate('/projects/new')}
                  className="underline hover:no-underline" style={{ color: 'var(--fin-positive)' }}>
                  Create one
                </button>
              </div>
        }
      </section>
      )}
    </div>
  )
}
