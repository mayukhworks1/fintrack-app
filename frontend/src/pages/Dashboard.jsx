import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  TrendingUp, TrendingDown, IndianRupee, FolderKanban,
  Target, AlertTriangle, Award, RefreshCw, Plus,
  ArrowRight, Flame, Activity
} from 'lucide-react'
import ProjectCard from '../components/ProjectCard'
import CustomInsightBlocks from '../components/CustomInsightBlocks'
import InsightWorkbench from '../components/InsightWorkbench'
import { api } from '../services/api'
import { useAutoRefresh, useRelativeTime } from '../hooks/useAutoRefresh'
import { formatInr as inr, formatPct } from '../utils/format'
import { useTheme } from '../context/ThemeContext'
import clsx from 'clsx'

/* Count projects whose health does NOT contain 🔴 */
const countHealthy = (byHealth = {}) =>
  Object.entries(byHealth).reduce((sum, [k, v]) => sum + (k.includes('🔴') ? 0 : v), 0)

function SyncDot({ syncing }) {
  return (
    <span className={clsx('w-1.5 h-1.5 rounded-full inline-block', syncing && 'animate-pulse')}
      style={{ background: syncing ? 'var(--fin-warning)' : 'var(--fin-positive)' }} aria-hidden="true" />
  )
}

function SkeletonCard() {
  return (
    <div className="card space-y-3" aria-hidden="true">
      <div className="skeleton h-3 rounded w-2/3" />
      <div className="skeleton h-8 rounded w-3/4" />
      <div className="skeleton h-3 rounded w-1/2" />
    </div>
  )
}

/* ── KPI card — horizontal layout, colored icon tile on left ──
   Matches reference: $32,350.00 / Total Revenue style with a tinted square tile.
   Each card auto-picks an icon tile color from a palette so the row pops. */
const TILE_PALETTE = [
  { bg: '#fef3c7', fg: '#d97706' },   // amber
  { bg: '#dbeafe', fg: '#2563eb' },   // blue
  { bg: '#dcfce7', fg: '#16a34a' },   // green
  { bg: '#fce7f3', fg: '#db2777' },   // pink
  { bg: '#ede9fe', fg: '#7c3aed' },   // violet
  { bg: '#cffafe', fg: '#0891b2' },   // cyan
]

function KpiCard({ label, value, sub, icon: Icon, accent, trend, tone = 0 }) {
  const palette = TILE_PALETTE[tone % TILE_PALETTE.length]
  const accentColor =
    accent === 'positive' ? 'var(--fin-positive)'
    : accent === 'warning' ? 'var(--fin-warning)'
    : accent === 'negative' ? 'var(--fin-negative)'
    : 'var(--text-1)'
  return (
    <div className="card flex items-center gap-3">
      {/* Colored icon tile */}
      {Icon && (
        <div className="rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ width: 40, height: 40, background: palette.bg, color: palette.fg }}>
          <Icon size={18} aria-hidden="true" />
        </div>
      )}
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
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{project.status || project.health}</p>
      </div>
      <span className="text-sm font-bold tabular-nums flex-shrink-0"
        style={{ color: isNeg ? 'var(--fin-negative)' : 'var(--fin-warning)' }}>
        {project.pct > 0 ? '+' : ''}{formatPct(project.pct, 2)}
      </span>
    </div>
  )
}

/* ── Client revenue bar ── */
function ClientBar({ client, billed, profit, maxBilled }) {
  const pct    = maxBilled > 0 ? (billed / maxBilled) * 100 : 0
  const margin = billed > 0 ? (profit / billed) * 100 : 0
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-baseline text-sm">
        <span className="font-medium" style={{ color: 'var(--text-1)' }}>{client}</span>
        <div className="flex items-center gap-3 text-xs flex-shrink-0 ml-2">
          <span className="tabular-nums" style={{ color: 'var(--text-2)' }}>{inr(billed)}</span>
          <span className="font-bold tabular-nums" style={{ color: margin >= 0 ? 'var(--fin-positive)' : 'var(--fin-negative)' }}>
            {formatPct(margin, 2)} margin
          </span>
        </div>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: 'var(--accent)' }} />
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

const EXECUTIVE_VARS_DARK = {
  '--bg-base': '#090b10',
  '--bg-layer': '#0e1118',
  '--card-bg': '#141820',
  '--card-border': 'rgba(255,255,255,0.08)',
  '--card-shadow': '0 24px 60px rgba(0,0,0,0.32)',
  '--card-shadow-hover': '0 28px 70px rgba(0,0,0,0.4)',
  '--bg-input': '#10141d',
  '--text-1': '#f4f7fb',
  '--text-2': '#c0c8d6',
  '--text-3': '#7f8a9c',
  '--accent': '#7d95ff',
  '--accent-dim': 'rgba(125,149,255,0.12)',
  '--accent-soft': 'rgba(125,149,255,0.22)',
  '--fin-positive': '#84e254',
  '--fin-pos-bg': 'rgba(132,226,84,0.12)',
  '--fin-warning': '#f3b45d',
  '--fin-warn-bg': 'rgba(243,180,93,0.13)',
  '--fin-negative': '#ff7d80',
  '--fin-neg-bg': 'rgba(255,125,128,0.13)',
  '--border': 'rgba(255,255,255,0.08)',
}

const EXECUTIVE_VARS_LIGHT = {
  '--bg-base': '#f5f7fb',
  '--bg-layer': '#fbfcff',
  '--card-bg': '#ffffff',
  '--card-border': 'rgba(15,23,42,0.08)',
  '--card-shadow': '0 24px 60px rgba(15,23,42,0.08)',
  '--card-shadow-hover': '0 28px 70px rgba(15,23,42,0.12)',
  '--bg-input': '#f5f7fb',
  '--text-1': '#152033',
  '--text-2': '#536175',
  '--text-3': '#8b97aa',
  '--accent': '#4b67ff',
  '--accent-dim': 'rgba(75,103,255,0.10)',
  '--accent-soft': 'rgba(75,103,255,0.18)',
  '--fin-positive': '#16915f',
  '--fin-pos-bg': 'rgba(22,145,95,0.10)',
  '--fin-warning': '#ca7f14',
  '--fin-warn-bg': 'rgba(202,127,20,0.10)',
  '--fin-negative': '#d85f58',
  '--fin-neg-bg': 'rgba(216,95,88,0.10)',
  '--border': 'rgba(15,23,42,0.08)',
}

const DASHBOARD_WIDGET_CATALOG = [
  { id: 'portfolio_balance', label: 'Portfolio balance', description: 'Net profit hero with revenue, margin, cost load, and at-risk totals.' },
  { id: 'command_center', label: 'Command center', description: 'Top signal, sync state, and the current attention load.' },
  { id: 'kpi_strip', label: 'KPI strip', description: 'Top-level revenue, profit, cost, margin, targets, and project counts.' },
  { id: 'client_revenue', label: 'Revenue by client', description: 'Client concentration and billed totals at a glance.' },
  { id: 'needs_attention', label: 'Needs attention', description: 'Projects with negative profit or critical health.' },
  { id: 'leaders', label: 'Performance leaders', description: 'Top performer and lowest margin cards.' },
  { id: 'status_mix', label: 'Status mix', description: 'Clickable status counts for the current visible portfolio.' },
  { id: 'top_projects', label: 'Top projects', description: 'Highest-billed projects with linked context and quick navigation.' },
]

const DASHBOARD_DEFAULT_WIDGET_IDS = DASHBOARD_WIDGET_CATALOG.map((widget) => widget.id)

export default function Dashboard() {
  const navigate = useNavigate()
  const greeting = useGreeting()
  const { isEditor } = useAuth()
  const { dark } = useTheme()
  const [activeWidgetIds, setActiveWidgetIds] = useState(DASHBOARD_DEFAULT_WIDGET_IDS)
  const [activeCustomBlocks, setActiveCustomBlocks] = useState([])
  const [customSourceRows, setCustomSourceRows] = useState({})

  const fetchAll = useCallback(() =>
    Promise.all([
      api.projects.summary(),
      api.projects.list({ limit: 6, order_by: 'Amount Billed So far' }),
    ]).then(([summary, list]) => ({ summary, records: list.records || [] }))
  , [])

  const { data, loading, error, refresh, lastUpdated, syncing } = useAutoRefresh(fetchAll, 5_000)
  const updatedLabel = useRelativeTime(lastUpdated)

  const s      = data?.summary
  const recent = data?.records || []
  const recentSignals = recent
    .map((record) => {
      const insight = record.association?.insights?.project
      const profit = Number(record.fields?.['Profit percentage'] || 0)
      const severityRank = profit < 0
        ? 3
        : insight?.signal?.severity === 'danger'
          ? 3
          : insight?.signal?.severity === 'warning'
            ? 2
            : 1
      return { record, insight, severityRank, profit }
    })
    .sort((a, b) => b.severityRank - a.severityRank || a.profit - b.profit)
  const leadSignal = recentSignals[0]
  const leadRecord = leadSignal?.record
  const leadInsight = leadSignal?.insight
  const blockedRecent = recent.filter(r => Number(r.association?.insights?.project?.status_summary?.blocked_count || 0) > 0).length
  const outstandingRecent = recent.reduce((sum, r) => sum + Number(r.association?.insights?.project?.invoice_summary?.outstanding_total || 0), 0)

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
        key: 'portfolio-linked',
        label: 'Linked portfolio matrix',
        columns: [
          { key: 'client', label: 'Client' },
          { key: 'project', label: 'Project' },
          { key: 'status', label: 'Project Status' },
          { key: 'health', label: 'Health' },
          { key: 'billed', label: 'Billed' },
          { key: 'profit', label: 'Profit' },
          { key: 'profit_pct', label: 'Profit %' },
          { key: 'outstanding_total', label: 'Outstanding' },
          { key: 'pending_invoices', label: 'Pending Invoices' },
          { key: 'blocked_statuses', label: 'Blocked Statuses' },
          { key: 'signal', label: 'Signal' },
        ],
        defaultColumns: ['client', 'project', 'status', 'billed', 'profit', 'outstanding_total', 'signal'],
        loadRows: async () => {
          const res = await api.projects.list({ limit: 500, order_by: 'Amount Billed So far' })
          return (res.records || []).map((record) => {
            const insight = record.association?.insights?.project
            return {
              client: record.fields?.['Client'] || '',
              project: record.fields?.['Project Name'] || '',
              status: record.fields?.['Project Status'] || '',
              health: record.fields?.['Health'] || '',
              billed: record.fields?.['Amount Billed So far'] || 0,
              profit: record.fields?.['Actual Profit'] || 0,
              profit_pct: record.fields?.['Profit percentage'] || 0,
              outstanding_total: Number(insight?.invoice_summary?.outstanding_total || 0),
              pending_invoices: Number(insight?.invoice_summary?.pending_count || 0),
              blocked_statuses: Number(insight?.status_summary?.blocked_count || 0),
              signal: insight?.signal?.label || '',
            }
          })
        },
        getRows: () => recent.map((record) => {
          const insight = record.association?.insights?.project
          return {
            client: record.fields?.['Client'] || '',
            project: record.fields?.['Project Name'] || '',
            status: record.fields?.['Project Status'] || '',
            health: record.fields?.['Health'] || '',
            billed: record.fields?.['Amount Billed So far'] || 0,
            profit: record.fields?.['Actual Profit'] || 0,
            profit_pct: record.fields?.['Profit percentage'] || 0,
            outstanding_total: Number(insight?.invoice_summary?.outstanding_total || 0),
            pending_invoices: Number(insight?.invoice_summary?.pending_count || 0),
            blocked_statuses: Number(insight?.status_summary?.blocked_count || 0),
            signal: insight?.signal?.label || '',
          }
        }),
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

  const executiveVars = dark ? EXECUTIVE_VARS_DARK : EXECUTIVE_VARS_LIGHT

  return (
    <div
      className="p-4 sm:p-5 space-y-5 animate-fade-in rounded-[28px]"
      style={{
        ...executiveVars,
        background: dark
          ? 'radial-gradient(circle at top left, rgba(125,149,255,0.14), transparent 22%), radial-gradient(circle at top right, rgba(132,226,84,0.08), transparent 18%), linear-gradient(180deg, #0a0d12 0%, #090b10 100%)'
          : 'radial-gradient(circle at top left, rgba(75,103,255,0.10), transparent 20%), radial-gradient(circle at top right, rgba(22,145,95,0.06), transparent 18%), linear-gradient(180deg, #f8faff 0%, #f4f7fb 100%)',
      }}
    >

      {/* Header */}
      <div className="rounded-[28px] p-4 sm:p-5" style={{ background: dark ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.82)', border: dark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.06)' }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold tabular-nums tracking-[0.22em] uppercase"
              style={{ color: 'var(--accent)' }}>
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <h1 className="text-[2rem] sm:text-[2.5rem] font-semibold" style={{ color: 'var(--text-1)', letterSpacing: '-0.05em', lineHeight: 1 }}>
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
              style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-2)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <RefreshCw size={14} className={clsx(loading && 'animate-spin')} />
              Refresh
            </button>
            {isEditor && (
              <button
                onClick={() => navigate('/projects/new')}
                className="inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold"
                style={{ background: 'linear-gradient(135deg, #4d74ff 0%, #6f8fff 100%)', color: '#fff', boxShadow: '0 12px 28px rgba(77,116,255,0.28)' }}
              >
                <Plus size={14} aria-hidden="true" />
                New Project
              </button>
            )}
          </div>
        </div>

        <div className={clsx('mt-4 grid gap-4', visibleWidgets.has('portfolio_balance') && visibleWidgets.has('command_center') ? 'grid-cols-1 xl:grid-cols-[1.9fr_0.95fr]' : 'grid-cols-1')}>
          {visibleWidgets.has('portfolio_balance') && (
          <div className="rounded-[28px] p-5 sm:p-6" style={{ background: dark ? 'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%)' : 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(246,249,255,0.96) 100%)', border: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(15,23,42,0.06)' }}>
            <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-3)' }}>Portfolio balance</p>
                <h2 className="text-[2.35rem] sm:text-[3rem] font-semibold mt-2 tabular-nums leading-none" style={{ color: 'var(--text-1)', letterSpacing: '-0.05em' }}>
                  {inr(s?.total_profit)}
                </h2>
                <p className="text-sm mt-2 max-w-xl" style={{ color: 'var(--text-3)' }}>
                  Net profit from <span style={{ color: 'var(--text-2)' }}>{inr(s?.total_billed)}</span> billed across {s?.total_projects ?? 0} active portfolio entries.
                </p>
              </div>
              <div className="rounded-3xl px-4 py-3 min-w-[160px]" style={{ background: dark ? 'rgba(132,226,84,0.08)' : 'rgba(22,145,95,0.08)', border: dark ? '1px solid rgba(132,226,84,0.12)' : '1px solid rgba(22,145,95,0.12)' }}>
                <p className="text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--text-3)' }}>Healthy projects</p>
                <p className="text-[1.9rem] font-semibold mt-1 tabular-nums leading-none" style={{ color: 'var(--fin-positive)' }}>
                  {healthOk}/{s?.total_projects ?? 0}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{formatPct(healthiestPct, 1)} portfolio health coverage</p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Revenue', value: inr(s?.total_billed), tone: 'var(--text-1)' },
                { label: 'Margin', value: formatPct(margin, 2), tone: margin >= 0 ? 'var(--fin-positive)' : 'var(--fin-negative)' },
                { label: 'Cost load', value: formatPct(costRatio, 1), tone: 'var(--fin-warning)' },
                { label: 'At risk', value: `${atRisk.length}`, tone: atRisk.length ? 'var(--fin-negative)' : 'var(--text-1)' },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl p-4" style={{ background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(245,247,251,0.86)', border: dark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.06)' }}>
                  <p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-3)' }}>{item.label}</p>
                  <p className="text-lg sm:text-xl font-semibold mt-2 tabular-nums" style={{ color: item.tone }}>{item.value}</p>
                </div>
              ))}
            </div>
          </div>
          )}

          {visibleWidgets.has('command_center') && (
          <div className="rounded-[28px] p-5 sm:p-6" style={{ background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.78)', border: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(15,23,42,0.06)' }}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-3)' }}>Command center</p>
                <h2 className="text-xl font-semibold mt-2" style={{ color: 'var(--text-1)' }}>What needs action</h2>
              </div>
              {lastUpdated && (
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-[0.16em]" style={{ color: 'var(--text-3)' }}>Sync</p>
                  <p className="text-xs mt-1 flex items-center gap-1.5 justify-end" style={{ color: syncing ? 'var(--fin-warning)' : 'var(--fin-positive)' }}>
                    <SyncDot syncing={syncing} />
                    {syncing ? 'syncing…' : updatedLabel}
                  </p>
                </div>
              )}
            </div>

            <div className="mt-5 space-y-3">
              <div className="rounded-2xl p-4" style={{ background: dark ? 'rgba(255,255,255,0.02)' : 'rgba(245,247,251,0.76)', border: dark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.06)' }}>
                <p className="text-[11px] uppercase tracking-[0.16em]" style={{ color: 'var(--text-3)' }}>Top signal</p>
                <p className="text-base font-semibold mt-2" style={{ color: 'var(--text-1)' }}>
                  {leadRecord ? `${leadRecord.fields?.['Client'] || 'Unknown'} / ${leadRecord.fields?.['Project Name'] || 'Project'}` : 'No project performance signal yet'}
                </p>
                <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
                  {leadSignal
                    ? (leadSignal.profit < 0
                      ? `${formatPct(leadSignal.profit, 2)} margin currently needs intervention.`
                      : leadInsight?.signal?.detail || 'Linked delivery and billing context is available for review.')
                    : 'As project financials settle in, this space will surface the strongest performer.'}
                </p>
              </div>
              <div className="rounded-2xl p-4" style={{ background: dark ? 'rgba(255,125,128,0.06)' : 'rgba(216,95,88,0.08)', border: dark ? '1px solid rgba(255,125,128,0.12)' : '1px solid rgba(216,95,88,0.10)' }}>
                <p className="text-[11px] uppercase tracking-[0.16em]" style={{ color: 'var(--text-3)' }}>Attention load</p>
                <p className="text-base font-semibold mt-2" style={{ color: blockedRecent || outstandingRecent > 0 ? 'var(--fin-negative)' : 'var(--text-1)' }}>
                  {blockedRecent || outstandingRecent > 0
                    ? `${blockedRecent} blocked · ${inr(outstandingRecent)} open`
                    : 'No critical portfolio blockers'}
                </p>
                <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
                  {blockedRecent || outstandingRecent > 0
                    ? 'Combines blocked delivery statuses with open receivable exposure on the visible control set.'
                    : 'No blocked linked statuses and no open receivable pressure in the visible control set.'}
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
          <AlertTriangle size={15} aria-hidden="true" /> {error} —
          <button onClick={refresh} className="underline">retry</button>
        </div>
      )}

      <CustomInsightBlocks
        blocks={activeCustomBlocks}
        sourceOptions={dashboardSourceOptions}
        sourceRowsByKey={customSourceRows}
      />


      {/* ── KPI row — 2 cols mobile → 3 cols tablet → 6 cols desktop ── */}
      {visibleWidgets.has('kpi_strip') && (
      <section aria-label="Key metrics">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {loading && !data
            ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
            : <>
                <KpiCard tone={0}
                  label="Total Revenue"
                  value={inr(s?.total_billed)}
                  icon={IndianRupee}
                />
                <KpiCard tone={1}
                  label="Net Profit"
                  value={inr(s?.total_profit)}
                  icon={TrendingUp}
                  accent={(s?.total_profit ?? 0) >= 0 ? 'positive' : 'negative'}
                  trend={s?.avg_profit_pct}
                />
                <KpiCard tone={2}
                  label="Total Cost"
                  value={inr(s?.total_cost)}
                  icon={Activity}
                  sub={s?.total_cost > 0 ? `${formatPct(costRatio, 1)} of revenue` : undefined}
                />
                <KpiCard tone={3}
                  label="Profit Margin"
                  value={formatPct(margin, 2)}
                  icon={Flame}
                  accent={margin >= 20 ? 'positive' : margin >= 0 ? 'warning' : 'negative'}
                />
                <KpiCard tone={4}
                  label="Targets Hit"
                  value={`${s?.target_achieved_count ?? 0} / ${s?.total_projects ?? 0}`}
                  icon={Target}
                />
                <KpiCard tone={5}
                  label="Projects"
                  value={s?.total_projects ?? '—'}
                  icon={FolderKanban}
                  sub={`${healthOk} healthy`}
                />
              </>
          }
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
            ? <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}</div>
            : <div className="space-y-4">
                {Object.entries(s?.client_billed || {}).length === 0
                  ? <p className="text-sm" style={{ color: 'var(--text-3)' }}>No data yet</p>
                  : Object.entries(s.client_billed).map(([cl, billed]) => (
                      <ClientBar key={cl} client={cl} billed={billed}
                        profit={s.client_profit?.[cl] || 0} maxBilled={maxBilled} />
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
              ? <div className="flex flex-col items-center py-6 text-center">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center mb-2"
                    style={{ background: 'var(--accent-dim)' }}>
                    <Award size={18} style={{ color: 'var(--fin-positive)' }} aria-hidden="true" />
                  </div>
                  <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>All projects healthy</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>No critical issues found</p>
                </div>
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
                    style={{ background: 'var(--accent-dim)', border: '1px solid rgba(37,99,235,0.20)' }}>
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
                    style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)' }}>
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
                           : status.includes('Completed') ? '#60a5fa'
                           : status.includes('Hold')      ? 'var(--fin-warning)'
                           : 'var(--fin-negative)'
              return (
                <button key={status}
                  onClick={() => navigate(`/projects?status=${encodeURIComponent(status)}`)}
                  className="card text-center transition-all hover:scale-[1.02] active:scale-[0.99] p-3 sm:p-5"
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
            <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Existing project cards remain available, now presented inside the executive canvas.</p>
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
