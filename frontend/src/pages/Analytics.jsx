import { useCallback, useMemo, useState, useRef } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area, LineChart, Line,
  ComposedChart, ReferenceLine,
} from 'recharts'
import {
  RefreshCw, AlertCircle, TrendingUp, TrendingDown, IndianRupee,
  Wallet, Receipt, Clock, AlertTriangle, ArrowUpRight, ArrowDownRight,
  Target, Sparkles, Activity, CalendarClock, CheckCircle2, Hourglass,
  Users, Layers, Zap, ArrowRight, Filter, BarChart2, PieChart as PieIcon,
  ChevronRight, DollarSign, Percent, Timer,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import CustomInsightBlocks from '../components/CustomInsightBlocks'
import InsightWorkbench from '../components/InsightWorkbench'
import { api } from '../services/api'
import { useAutoRefresh, useRelativeTime } from '../hooks/useAutoRefresh'
import { formatInr as inr, formatPct, formatInt } from '../utils/format'
import { useTheme } from '../context/ThemeContext'
import clsx from 'clsx'

/* ── Helpers ─────────────────────────────────────────────────────────── */
const axisInr = (v) => {
  const n = Number(v || 0)
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`
  if (Math.abs(n) >= 1e3) return `₹${(n / 1e3).toFixed(0)}k`
  return `₹${formatInt(n)}`
}

const monthKey = (iso) => {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const monthLabel = (key) => {
  if (!key) return ''
  const [y, m] = key.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleString('en-US', { month: 'short' }) + " '" + String(y).slice(-2)
}

const daysBetween = (a, b) => {
  if (!a || !b) return null
  const da = new Date(a), db = new Date(b)
  if (isNaN(da) || isNaN(db)) return null
  return Math.max(0, Math.round((db - da) / 86400000))
}

const PERIODS = [
  { id: 'all',  label: 'All time', days: null },
  { id: '30d',  label: '30 days',  days: 30 },
  { id: '90d',  label: '90 days',  days: 90 },
  { id: 'ytd',  label: 'YTD',      days: 'ytd' },
]

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
  '--fin-pos-border': 'rgba(132,226,84,0.18)',
  '--fin-warning': '#f3b45d',
  '--fin-warn-bg': 'rgba(243,180,93,0.13)',
  '--fin-warn-border': 'rgba(243,180,93,0.18)',
  '--fin-negative': '#ff7d80',
  '--fin-neg-bg': 'rgba(255,125,128,0.13)',
  '--fin-neg-border': 'rgba(255,125,128,0.18)',
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
  '--fin-pos-border': 'rgba(22,145,95,0.14)',
  '--fin-warning': '#ca7f14',
  '--fin-warn-bg': 'rgba(202,127,20,0.10)',
  '--fin-warn-border': 'rgba(202,127,20,0.14)',
  '--fin-negative': '#d85f58',
  '--fin-neg-bg': 'rgba(216,95,88,0.10)',
  '--fin-neg-border': 'rgba(216,95,88,0.14)',
  '--border': 'rgba(15,23,42,0.08)',
}

const ANALYTICS_WIDGET_CATALOG = [
  { id: 'kpi_strip', label: 'Analytics KPIs', description: 'Revenue, collections, outstanding, DSO, and margin at the top.' },
  { id: 'insights', label: 'AI-style insights', description: 'Concentration, overdue, forecast, and strongest signal cards.' },
  { id: 'cashflow', label: 'Cash flow timeline', description: 'Raised vs collected month by month.' },
  { id: 'aging', label: 'Receivables aging', description: 'Pending invoice value by age bucket.' },
  { id: 'top_pending', label: 'Top pending invoices', description: 'Oldest pending invoices that need follow-up first.' },
  { id: 'status_breakdown', label: 'Invoice status mix', description: 'Status distribution by amount raised.' },
  { id: 'client_concentration', label: 'Client concentration', description: 'Revenue distribution across clients.' },
  { id: 'project_profitability', label: 'Project profitability', description: 'Project-level revenue, cost, profit, and outstanding exposure.' },
  { id: 'pipeline', label: 'Revenue pipeline', description: 'Funnel from raised → collected → outstanding → overdue.' },
  { id: 'dso_trend', label: 'Payment speed trend', description: 'Month-by-month average days to collect.' },
]

const ANALYTICS_DEFAULT_WIDGET_IDS = ANALYTICS_WIDGET_CATALOG.map((widget) => widget.id)

/* ── Components ──────────────────────────────────────────────────────── */
function SyncDot({ syncing }) {
  return (
    <span className={clsx('w-1.5 h-1.5 rounded-full inline-block', syncing && 'animate-pulse')}
      style={{ background: syncing ? 'var(--fin-warning)' : 'var(--fin-positive)' }} aria-hidden="true" />
  )
}

const TILE_PALETTE = [
  { bg: '#dbeafe', fg: '#2563eb' },
  { bg: '#dcfce7', fg: '#16a34a' },
  { bg: '#fef3c7', fg: '#d97706' },
  { bg: '#fce7f3', fg: '#db2777' },
  { bg: '#ede9fe', fg: '#7c3aed' },
]

/* Mini sparkline — area chart, no axes */
function Sparkline({ data, color = '#2563eb', height = 26 }) {
  if (!data || data.length === 0) return null
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 1, right: 0, bottom: 1, left: 0 }}>
        <defs>
          <linearGradient id={`sg-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#sg-${color})`} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function KpiCard({ label, value, sub, icon: Icon, accent, tone = 0, trend, spark, sparkColor }) {
  const palette = TILE_PALETTE[tone % TILE_PALETTE.length]
  const accentColor =
    accent === 'positive' ? 'var(--fin-positive)' :
    accent === 'warning'  ? 'var(--fin-warning)'  :
    accent === 'negative' ? 'var(--fin-negative)' : 'var(--text-1)'
  return (
    <div className="card flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ width: 40, height: 40, background: palette.bg, color: palette.fg }}>
            <Icon size={18} aria-hidden="true" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="display-num tabular-nums break-words leading-tight"
            style={{ color: accentColor, fontSize: 'clamp(0.95rem, 2.4vw, 1.35rem)', wordBreak: 'break-word' }}>
            {value ?? '—'}
          </p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <p className="text-[11px] leading-tight" style={{ color: 'var(--text-3)' }}>{label}</p>
            {trend != null && Number.isFinite(trend) && (
              <span className="text-[10px] font-bold flex items-center gap-0.5 tabular-nums px-1.5 py-0.5 rounded"
                style={{
                  color: trend >= 0 ? 'var(--fin-positive)' : 'var(--fin-negative)',
                  background: trend >= 0 ? 'var(--fin-pos-bg)' : 'var(--fin-neg-bg)',
                }}>
                {trend >= 0 ? <ArrowUpRight size={9} /> : <ArrowDownRight size={9} />}
                {formatPct(Math.abs(trend), 1)}
              </span>
            )}
          </div>
          {sub && <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{sub}</p>}
        </div>
      </div>
      {spark && spark.length > 1 && (
        <div className="-mx-1">
          <Sparkline data={spark} color={sparkColor || palette.fg} />
        </div>
      )}
    </div>
  )
}

function ChartCard({ title, sub, children, action, className }) {
  return (
    <div className={clsx('card', className)}>
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{title}</h2>
          {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

function InsightCard({ icon: Icon, tone = 'positive', title, body }) {
  const map = {
    positive: { bg: 'var(--fin-pos-bg)', fg: 'var(--fin-positive)', border: 'var(--fin-pos-border)' },
    warning:  { bg: 'var(--fin-warn-bg)', fg: 'var(--fin-warning)', border: 'var(--fin-warn-border)' },
    negative: { bg: 'var(--fin-neg-bg)', fg: 'var(--fin-negative)', border: 'var(--fin-neg-border)' },
    info:     { bg: 'var(--accent-dim)', fg: 'var(--accent)', border: 'var(--accent-soft)' },
  }
  const m = map[tone] || map.info
  return (
    <div className="rounded-xl p-3 flex items-start gap-2.5"
      style={{ background: m.bg, border: `1px solid ${m.border}` }}>
      <div className="rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ width: 32, height: 32, background: 'rgba(255,255,255,0.55)', color: m.fg }}>
        <Icon size={15} />
      </div>
      <div className="min-w-0">
        <p className="text-[13px] font-bold leading-tight" style={{ color: m.fg }}>{title}</p>
        <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--text-2)' }}>{body}</p>
      </div>
    </div>
  )
}

/* Custom tooltip wrapper for recharts with consistent design */
function CustomTooltip({ active, payload, label, formatter, dark: _dark }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--card-bg)',
      border: '1px solid var(--card-border)',
      borderRadius: 14,
      padding: '10px 14px',
      fontSize: 12,
      boxShadow: 'var(--card-shadow)',
      minWidth: 140,
    }}>
      {label && <p style={{ color: 'var(--text-1)', fontWeight: 700, marginBottom: 6 }}>{label}</p>}
      {payload.map((item, i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <span style={{ color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.color, flexShrink: 0, display: 'inline-block' }} />
            {item.name}
          </span>
          <span style={{ color: 'var(--text-1)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {formatter ? formatter(item.value, item.name, item) : item.value}
          </span>
        </div>
      ))}
    </div>
  )
}

/* Pipeline funnel stages */
function PipelineFunnel({ data, dark }) {
  if (!data) return null
  const stages = [
    { label: 'Total Raised', value: data.raised, color: '#7d95ff', pct: 100 },
    { label: 'Collected', value: data.received, color: '#84e254', pct: data.raised > 0 ? (data.received / data.raised) * 100 : 0 },
    { label: 'Outstanding', value: data.outstanding, color: '#f3b45d', pct: data.raised > 0 ? (data.outstanding / data.raised) * 100 : 0 },
    { label: 'Overdue (>30d)', value: data.overdue, color: '#ff7d80', pct: data.raised > 0 ? (data.overdue / data.raised) * 100 : 0 },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stages.map((s, i) => (
        <div key={s.label} className="relative overflow-hidden rounded-2xl p-4 transition-transform duration-200 hover:scale-[1.02]"
          style={{ background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(245,247,251,0.86)', border: `1px solid ${s.color}22` }}>
          {/* Background fill bar */}
          <div className="absolute inset-x-0 bottom-0 rounded-b-2xl transition-all duration-700"
            style={{ height: `${s.pct}%`, background: `${s.color}11` }} />
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              {i > 0 && (
                <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded"
                  style={{ color: s.color, background: `${s.color}18` }}>
                  {s.pct.toFixed(1)}%
                </span>
              )}
            </div>
            <p className="text-lg font-bold tabular-nums" style={{ color: s.color }}>{inr(s.value)}</p>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>{s.label}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Page ────────────────────────────────────────────────────────────── */
export default function Analytics() {
  const [period, setPeriod] = useState('all')
  const [activeWidgetIds, setActiveWidgetIds] = useState(ANALYTICS_DEFAULT_WIDGET_IDS)
  const [activeCustomBlocks, setActiveCustomBlocks] = useState([])
  const [customSourceRows, setCustomSourceRows] = useState({})
  const { dark } = useTheme()

  const fetchAll = useCallback((opts = {}) =>
    Promise.all([
      api.projects.summary(opts),
      api.projects.list({ limit: 100, ...opts }),
      api.invoices.summary(opts),
      api.invoices.list({ limit: 500, ...opts }),
    ]).then(([projSummary, projList, invSummary, invList]) => ({
      projSummary, projects: projList.records || [],
      invSummary,  invoices: invList.records || [],
    }))
  , [])

  const { data, loading, error, refresh, lastUpdated, syncing } = useAutoRefresh(fetchAll, 10_000)
  const updatedLabel = useRelativeTime(lastUpdated)

  const ps = data?.projSummary
  const is = data?.invSummary
  const projects = data?.projects || []
  const allInvoices = data?.invoices || []

  /* ── Filter invoices by period ── */
  const periodCfg = PERIODS.find(p => p.id === period) || PERIODS[0]
  const cutoff = useMemo(() => {
    if (!periodCfg.days) return null
    if (periodCfg.days === 'ytd') {
      const now = new Date()
      return new Date(now.getFullYear(), 0, 1).toISOString()
    }
    const d = new Date()
    d.setDate(d.getDate() - periodCfg.days)
    return d.toISOString()
  }, [periodCfg])

  const invoices = useMemo(() => {
    if (!cutoff) return allInvoices
    return allInvoices.filter(r => {
      const raised = r.fields?.['Raised Date']
      return raised && raised >= cutoff
    })
  }, [allInvoices, cutoff])

  const tooltipStyle = {
    contentStyle: {
      background: 'var(--card-bg)', border: '1px solid var(--card-border)',
      borderRadius: 10, fontSize: 12, boxShadow: 'var(--card-shadow)',
    },
    labelStyle: { color: 'var(--text-1)', fontWeight: 600 },
    itemStyle:  { color: 'var(--text-2)' },
  }

  /* ── Derived metrics from filtered invoices ── */
  const filtered = useMemo(() => {
    let raised = 0, received = 0, outstanding = 0
    let dsoSum = 0, dsoCount = 0
    const byStatus = {}, byStatusAmt = {}, byCategory = {}, byClient = {}, byProject = {}
    invoices.forEach(r => {
      const f = r.fields || {}
      const amt = Number(f['Amount Raised'] || 0)
      const status = f['Payment Status'] || 'Unknown'
      const cat = f['Category'] || 'Uncategorized'
      const proj = f['Project'] || 'Unknown'
      byStatus[status] = (byStatus[status] || 0) + 1
      if (status === 'Cancelled') return
      raised += amt
      byStatusAmt[status] = (byStatusAmt[status] || 0) + amt
      byCategory[cat] = (byCategory[cat] || 0) + amt
      byProject[proj] = (byProject[proj] || 0) + amt
      // Roll up by client (project name → client name lookup from projects)
      const projRec = projects.find(p => p.fields?.['Project Name'] === proj)
      const client = projRec?.fields?.['Client'] || proj
      byClient[client] = (byClient[client] || 0) + amt
      if (status === 'Paid') {
        received += amt
        const days = daysBetween(f['Raised Date'], f['Cleared Date'])
        if (days != null) { dsoSum += days; dsoCount += 1 }
      } else if (status === 'Pending') {
        outstanding += amt
      }
    })
    return {
      raised, received, outstanding,
      avgDso: dsoCount > 0 ? dsoSum / dsoCount : null,
      collectionRate: raised > 0 ? (received / raised) * 100 : 0,
      byStatus, byStatusAmt, byCategory, byClient, byProject,
    }
  }, [invoices, projects])

  /* ── Cash flow timeline (always last 12 months, regardless of period) ── */
  const cashflow = useMemo(() => {
    const buckets = {}
    allInvoices.forEach(r => {
      const f = r.fields || {}
      if (f['Payment Status'] === 'Cancelled') return
      const raisedKey = monthKey(f['Raised Date'])
      if (raisedKey) {
        buckets[raisedKey] = buckets[raisedKey] || { key: raisedKey, raised: 0, collected: 0 }
        buckets[raisedKey].raised += Number(f['Amount Raised'] || 0)
      }
      const clearedKey = monthKey(f['Cleared Date'])
      if (clearedKey && f['Payment Status'] === 'Paid') {
        buckets[clearedKey] = buckets[clearedKey] || { key: clearedKey, raised: 0, collected: 0 }
        buckets[clearedKey].collected += Number(f['Amount Raised'] || 0)
      }
    })
    return Object.values(buckets)
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-12)
      .map(b => ({ ...b, label: monthLabel(b.key) }))
  }, [allInvoices])

  /* ── Sparkline series (last 6 months, derived from cashflow) ── */
  const sparks = useMemo(() => {
    const last6 = cashflow.slice(-6)
    return {
      raised:    last6.map(c => ({ v: c.raised })),
      collected: last6.map(c => ({ v: c.collected })),
      net:       last6.map(c => ({ v: c.collected - 0 })),  // collection trend
    }
  }, [cashflow])

  /* ── Aging buckets ── */
  const aging = useMemo(() => {
    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }
    const counts  = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }
    allInvoices.forEach(r => {
      const f = r.fields || {}
      if (f['Payment Status'] !== 'Pending') return
      const days = Number(f['Agening (Days)'] || 0)
      const amount = Number(f['Amount Raised'] || 0)
      let bucket = '0-30'
      if      (days > 90) bucket = '90+'
      else if (days > 60) bucket = '61-90'
      else if (days > 30) bucket = '31-60'
      buckets[bucket] += amount
      counts[bucket]  += 1
    })
    return Object.entries(buckets).map(([range, amount]) => ({ range, amount, count: counts[range] }))
  }, [allInvoices])

  /* ── DSO trend per month (last 8 months) ── */
  const dsoTrend = useMemo(() => {
    const byMonth = {}
    allInvoices.forEach(r => {
      const f = r.fields || {}
      if (f['Payment Status'] !== 'Paid') return
      const key = monthKey(f['Cleared Date'])
      if (!key) return
      const days = daysBetween(f['Raised Date'], f['Cleared Date'])
      if (days == null) return
      if (!byMonth[key]) byMonth[key] = { sum: 0, count: 0, collected: 0 }
      byMonth[key].sum += days
      byMonth[key].count += 1
      byMonth[key].collected += Number(f['Amount Raised'] || 0)
    })
    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-8)
      .map(([key, { sum, count, collected }]) => ({
        label: monthLabel(key),
        dso: Math.round(sum / count),
        count,
        collected,
      }))
  }, [allInvoices])

  /* ── Revenue pipeline funnel ── */
  const pipeline = useMemo(() => {
    if (!allInvoices.length) return null
    let raised = 0, received = 0, outstanding = 0, overdue = 0
    allInvoices.forEach(r => {
      const f = r.fields || {}
      if (f['Payment Status'] === 'Cancelled') return
      const amt = Number(f['Amount Raised'] || 0)
      raised += amt
      if (f['Payment Status'] === 'Paid') {
        received += amt
      } else {
        outstanding += amt
        const aging = Number(f['Agening (Days)'] || 0)
        if (aging > 30) overdue += amt
      }
    })
    return { raised, received, outstanding, overdue }
  }, [allInvoices])

  /* ── Top pending invoices (oldest first, top 5) ── */
  const topPending = useMemo(() =>
    allInvoices
      .filter(r => r.fields?.['Payment Status'] === 'Pending')
      .map(r => ({
        id: r.id,
        invoice_no: r.fields['Invoice Number'] || '—',
        project: r.fields['Project'] || '—',
        amount: Number(r.fields['Amount Raised'] || 0),
        aging: Number(r.fields['Agening (Days)'] || 0),
      }))
      .sort((a, b) => b.aging - a.aging)
      .slice(0, 5)
  , [allInvoices])

  /* ── Client concentration (from filtered) ── */
  const clientConc = useMemo(() => {
    const total = Object.values(filtered.byClient).reduce((s, v) => s + v, 0)
    if (total === 0) return []
    return Object.entries(filtered.byClient)
      .map(([name, amount]) => ({ name, amount, pct: (amount / total) * 100 }))
      .sort((a, b) => b.amount - a.amount)
  }, [filtered])

  /* ── Status breakdown by amount ── */
  const statusBreakdown = useMemo(() =>
    Object.entries(filtered.byStatusAmt).map(([status, amount]) => ({
      name: status, amount, count: filtered.byStatus[status] || 0,
    }))
  , [filtered])

  /* ── Per-project invoice totals built from raw invoice records.
        Keys are lowercase+trimmed invoice Project field values.
        Excludes Cancelled invoices; outstanding = non-Paid only. ── */
  const invByProject = useMemo(() => {
    const map = {}
    allInvoices.forEach(r => {
      const f = r.fields || {}
      if (f['Payment Status'] === 'Cancelled') return
      const key = (f['Project'] || '').toLowerCase().trim()
      if (!key) return
      if (!map[key]) map[key] = { raised: 0, outstanding: 0 }
      const amt = Number(f['Amount Raised'] || 0)
      map[key].raised += amt
      if (f['Payment Status'] !== 'Paid') map[key].outstanding += amt
    })
    return map
  }, [allInvoices])

  /* Resolve invoice data for a Projects-table row using a two-pass lookup:
     1. Exact normalised match   — handles "PMS" ↔ "Pms"
     2. Client-name prefix match — handles cases where the invoice project
        name starts with the client's first word but differs from the Projects
        table name (e.g. Projects: Client="Maitrimetal", Name="ZOHO" but
        invoice Project="Maitrimetal Workspace migration"). Only fires when
        there is exactly ONE unambiguous match to avoid cross-project bleed. */
  const resolveInvData = useCallback((projectName, clientName) => {
    const norm = s => (s || '').toLowerCase().trim()
    // 1. Direct match
    const direct = invByProject[norm(projectName)]
    if (direct) return direct
    // 2. Client-name prefix fallback
    const clientPrefix = norm(clientName).split(' ')[0]
    if (!clientPrefix) return null
    const hits = Object.entries(invByProject).filter(([k]) => k.startsWith(clientPrefix))
    return hits.length === 1 ? hits[0][1] : null
  }, [invByProject])

  /* ── Project profitability matrix ── */
  const projMatrix = useMemo(() =>
    projects
      .filter(r => r.fields?.['Amount Billed So far'] != null)
      .map(r => {
        const f = r.fields
        const billed = parseFloat(f['Amount Billed So far'] || 0)
        const cost   = parseFloat(f['Input cost so far'] || 0) + parseFloat(f['Total Overhead Cost'] || 0)
        const profit = parseFloat(f['Actual Profit'] || 0)
        const margin = parseFloat(f['Profit percentage'] || 0) * 100
        const invData = resolveInvData(f['Project Name'], f['Client'])
        return {
          id: r.id,
          name: `${(f['Client'] || '').split(' ')[0]}/${f['Project Name'] || ''}`,
          status: f['Project Status'],
          billed, cost, profit, margin,
          invoiced:    invData?.raised      || 0,
          outstanding: invData?.outstanding || 0,
        }
      })
      .sort((a, b) => b.billed - a.billed)
  , [projects, resolveInvData])

  /* ── Smart insights ── */
  const insights = useMemo(() => {
    const out = []
    if (!ps || !is) return out

    const sorted = [...projMatrix].filter(p => p.billed > 0).sort((a, b) => b.margin - a.margin)
    if (sorted[0]) {
      out.push({
        icon: Sparkles, tone: 'positive',
        title: `Top performer: ${sorted[0].name}`,
        body: `${formatPct(sorted[0].margin, 2)} margin on ${inr(sorted[0].billed)} billed.`,
      })
    }

    // Client concentration risk
    if (clientConc[0] && clientConc[0].pct >= 70) {
      out.push({
        icon: Users,
        tone: clientConc[0].pct >= 85 ? 'warning' : 'info',
        title: `${formatPct(clientConc[0].pct, 1)} from ${clientConc[0].name}`,
        body: `Concentration risk — diversify revenue sources to reduce exposure.`,
      })
    }

    // Average DSO
    if (filtered.avgDso != null) {
      const dso = filtered.avgDso
      out.push({
        icon: Hourglass,
        tone: dso <= 14 ? 'positive' : dso <= 30 ? 'info' : 'warning',
        title: `${dso.toFixed(0)} day avg payment time`,
        body: dso <= 14 ? 'Excellent collection speed.' : dso <= 30 ? 'Healthy collection cycle.' : 'Slow — invoices taking >30 days to clear.',
      })
    }

    // Collection forecast (pending × historical collection rate)
    if (is.total_outstanding > 0 && filtered.collectionRate >= 50) {
      const expected = is.total_outstanding * (filtered.collectionRate / 100)
      out.push({
        icon: Zap, tone: 'info',
        title: `Forecast: ${inr(expected)} expected`,
        body: `Based on ${formatPct(filtered.collectionRate, 0)} collection rate, of ${inr(is.total_outstanding)} pending.`,
      })
    }

    // Overdue alert
    const overdueCount = is.overdue_invoices?.length || 0
    if (overdueCount > 0) {
      const overdueAmount = is.overdue_invoices.reduce((s, i) => s + Number(i.amount || 0), 0)
      out.push({
        icon: AlertTriangle, tone: 'negative',
        title: `${overdueCount} overdue invoice${overdueCount === 1 ? '' : 's'}`,
        body: `${inr(overdueAmount)} pending more than 30 days — needs follow-up.`,
      })
    }

    return out.slice(0, 4)
  }, [ps, is, projMatrix, clientConc, filtered])

  /* ── KPIs ── */
  const margin = ps && ps.total_billed > 0 ? (ps.total_profit / ps.total_billed) * 100 : 0
  const collectedThisMonth = useMemo(() => {
    const k = monthKey(new Date().toISOString())
    return cashflow.find(c => c.key === k)?.collected || 0
  }, [cashflow])
  const collectedLastMonth = useMemo(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1)
    const k = monthKey(d.toISOString())
    return cashflow.find(c => c.key === k)?.collected || 0
  }, [cashflow])
  const monthDelta = collectedLastMonth > 0
    ? ((collectedThisMonth - collectedLastMonth) / collectedLastMonth) * 100 : null
  const executiveVars = dark ? EXECUTIVE_VARS_DARK : EXECUTIVE_VARS_LIGHT

  const executiveTooltip = {
    contentStyle: {
      background: dark ? '#171b23' : '#ffffff',
      border: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(15,23,42,0.08)',
      borderRadius: 16,
      fontSize: 12,
      boxShadow: dark ? '0 24px 60px rgba(0,0,0,0.32)' : '0 24px 60px rgba(15,23,42,0.12)',
    },
    labelStyle: { color: dark ? '#f4f7fb' : '#152033', fontWeight: 700 },
    itemStyle: { color: dark ? '#c0c8d6' : '#536175' },
  }
  const visibleWidgets = useMemo(
    () => new Set(activeWidgetIds.length ? activeWidgetIds : ANALYTICS_DEFAULT_WIDGET_IDS),
    [activeWidgetIds]
  )
  const analyticsSourceOptions = useMemo(() => {
    const invoiceColumns = [
      { key: 'invoice_number', label: 'Invoice #' },
      { key: 'project', label: 'Project' },
      { key: 'status', label: 'Status' },
      { key: 'raised_date', label: 'Raised Date' },
      { key: 'cleared_date', label: 'Cleared Date' },
      { key: 'amount_raised', label: 'Amount Raised' },
      { key: 'received', label: 'Received' },
      { key: 'aging_days', label: 'Aging Days' },
    ]
    return [
      {
        key: 'period-invoices',
        label: 'Invoices in current period',
        columns: invoiceColumns,
        defaultColumns: invoiceColumns.map((col) => col.key),
        loadRows: async () => {
          const res = await api.invoices.list({ limit: 1000 })
          const rows = (res.records || []).map((record) => ({
            invoice_number: record.fields?.['Invoice Number'] || '',
            project: record.fields?.['Project'] || '',
            status: record.fields?.['Payment Status'] || '',
            raised_date: record.fields?.['Raised Date'] || '',
            cleared_date: record.fields?.['Cleared Date'] || '',
            amount_raised: record.fields?.['Amount Raised'] || 0,
            received: record.fields?.['Amount Received'] || 0,
            aging_days: record.fields?.['Agening (Days)'] || 0,
          }))
          if (!cutoff) return rows
          return rows.filter((row) => row.raised_date && row.raised_date >= cutoff)
        },
        getRows: () => invoices.map((record) => ({
          invoice_number: record.fields?.['Invoice Number'] || '',
          project: record.fields?.['Project'] || '',
          status: record.fields?.['Payment Status'] || '',
          raised_date: record.fields?.['Raised Date'] || '',
          cleared_date: record.fields?.['Cleared Date'] || '',
          amount_raised: record.fields?.['Amount Raised'] || 0,
          received: record.fields?.['Amount Received'] || 0,
          aging_days: record.fields?.['Agening (Days)'] || 0,
        })),
      },
      {
        key: 'cashflow-months',
        label: 'Cash flow by month',
        columns: [
          { key: 'label', label: 'Month' },
          { key: 'raised', label: 'Raised' },
          { key: 'collected', label: 'Collected' },
        ],
        defaultColumns: ['label', 'raised', 'collected'],
        getRows: () => cashflow,
      },
      {
        key: 'project-profitability',
        label: 'Project profitability matrix',
        columns: [
          { key: 'name', label: 'Project' },
          { key: 'status', label: 'Status' },
          { key: 'billed', label: 'Revenue' },
          { key: 'cost', label: 'Cost' },
          { key: 'profit', label: 'Profit' },
          { key: 'margin', label: 'Margin %' },
          { key: 'invoiced', label: 'Invoiced' },
          { key: 'outstanding', label: 'Outstanding' },
        ],
        defaultColumns: ['name', 'status', 'billed', 'profit', 'margin', 'outstanding'],
        loadRows: async () => {
          const [projSummary, projList, invSummary, invList] = await Promise.all([
            api.projects.summary(),
            api.projects.list({ limit: 500 }),
            api.invoices.summary(),
            api.invoices.list({ limit: 1000 }),
          ])
          void projSummary
          void invSummary
          const projectsFull = projList.records || []
          const invoicesFull = invList.records || []
          const buckets = {}
          invoicesFull.forEach((record) => {
            const fields = record.fields || {}
            const project = fields['Project'] || 'Unknown'
            const amountRaised = Number(fields['Amount Raised'] || 0)
            const received = Number(fields['Amount Received'] || 0)
            const status = fields['Payment Status'] || 'Unknown'
            const bucket = buckets[project] || { invoiced: 0, outstanding: 0 }
            bucket.invoiced += amountRaised
            if (status !== 'Paid' && status !== 'Cancelled') bucket.outstanding += Math.max(0, amountRaised - received)
            buckets[project] = bucket
          })
          return projectsFull.map((project) => {
            const fields = project.fields || {}
            const name = fields['Project Name'] || 'Unknown'
            const billed = Number(fields['Amount Billed So far'] || 0)
            const cost = Number(fields['Actual Cost'] || 0)
            const profit = Number(fields['Actual Profit'] || 0)
            return {
              name,
              status: fields['Project Status'] || 'Unknown',
              billed,
              cost,
              profit,
              margin: billed > 0 ? (profit / billed) * 100 : 0,
              invoiced: buckets[name]?.invoiced || 0,
              outstanding: buckets[name]?.outstanding || 0,
            }
          })
        },
        getRows: () => projMatrix,
      },
      {
        key: 'invoice-project-joined',
        label: 'Invoices + project context',
        columns: [
          { key: 'invoice_number', label: 'Invoice #' },
          { key: 'client', label: 'Client' },
          { key: 'project', label: 'Project' },
          { key: 'project_status', label: 'Project Status' },
          { key: 'project_health', label: 'Health' },
          { key: 'invoice_status', label: 'Invoice Status' },
          { key: 'raised_date', label: 'Raised Date' },
          { key: 'cleared_date', label: 'Cleared Date' },
          { key: 'amount_raised', label: 'Raised' },
          { key: 'received', label: 'Received' },
          { key: 'outstanding', label: 'Outstanding' },
          { key: 'margin', label: 'Project Margin %' },
        ],
        defaultColumns: ['invoice_number', 'client', 'project', 'invoice_status', 'amount_raised', 'received', 'outstanding', 'margin'],
        loadRows: async () => {
          const [projList, invList] = await Promise.all([
            api.projects.list({ limit: 500 }),
            api.invoices.list({ limit: 1000 }),
          ])
          const projectsByName = new Map((projList.records || []).map((project) => [
            project.fields?.['Project Name'] || '',
            project,
          ]))
          const rows = (invList.records || []).map((record) => {
            const fields = record.fields || {}
            const projectName = fields['Project'] || ''
            const project = projectsByName.get(projectName)
            const raised = Number(fields['Amount Raised'] || 0)
            const received = Number(fields['Amount Received'] || 0)
            return {
              invoice_number: fields['Invoice Number'] || '',
              client: project?.fields?.['Client'] || projectName,
              project: projectName,
              project_status: project?.fields?.['Project Status'] || '',
              project_health: project?.fields?.['Health'] || '',
              invoice_status: fields['Payment Status'] || '',
              raised_date: fields['Raised Date'] || '',
              cleared_date: fields['Cleared Date'] || '',
              amount_raised: raised,
              received,
              outstanding: Math.max(0, raised - received),
              margin: Number(project?.fields?.['Profit percentage'] || 0),
            }
          })
          if (!cutoff) return rows
          return rows.filter((row) => row.raised_date && row.raised_date >= cutoff)
        },
        getRows: () => {
          const projectsByName = new Map(projects.map((project) => [
            project.fields?.['Project Name'] || '',
            project,
          ]))
          return invoices.map((record) => {
            const fields = record.fields || {}
            const projectName = fields['Project'] || ''
            const project = projectsByName.get(projectName)
            const raised = Number(fields['Amount Raised'] || 0)
            const received = Number(fields['Amount Received'] || 0)
            return {
              invoice_number: fields['Invoice Number'] || '',
              client: project?.fields?.['Client'] || projectName,
              project: projectName,
              project_status: project?.fields?.['Project Status'] || '',
              project_health: project?.fields?.['Health'] || '',
              invoice_status: fields['Payment Status'] || '',
              raised_date: fields['Raised Date'] || '',
              cleared_date: fields['Cleared Date'] || '',
              amount_raised: raised,
              received,
              outstanding: Math.max(0, raised - received),
              margin: Number(project?.fields?.['Profit percentage'] || 0),
            }
          })
        },
      },
    ]
  }, [cashflow, cutoff, invoices, projMatrix, projects])

  if (loading && !data) return (
    <div className="p-4 sm:p-6 space-y-5 animate-fade-in">
      {/* Header skeleton */}
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-2">
          <div className="skeleton h-7 w-40 rounded-lg" />
          <div className="skeleton h-4 w-56 rounded" />
        </div>
        <div className="skeleton h-9 w-24 rounded-xl" />
      </div>
      {/* KPI row skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="card flex items-center gap-3">
            <div className="skeleton rounded-xl flex-shrink-0" style={{ width: 40, height: 40 }} />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-5 rounded w-3/4" />
              <div className="skeleton h-3 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
      {/* Chart skeleton */}
      <div className="card space-y-3">
        <div className="skeleton h-4 w-32 rounded" />
        <div className="skeleton rounded-xl w-full" style={{ height: 200 }} />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="card space-y-3">
          <div className="skeleton h-4 w-28 rounded" />
          <div className="skeleton rounded-xl w-full" style={{ height: 160 }} />
        </div>
        <div className="card space-y-3">
          <div className="skeleton h-4 w-28 rounded" />
          <div className="skeleton rounded-xl w-full" style={{ height: 160 }} />
        </div>
      </div>
    </div>
  )

  return (
    <div
      className="p-4 sm:p-6 space-y-5 animate-fade-in rounded-[28px]"
      style={{
        ...executiveVars,
        background: dark
          ? 'radial-gradient(circle at top left, rgba(125,149,255,0.14), transparent 18%), radial-gradient(circle at top right, rgba(132,226,84,0.08), transparent 18%), linear-gradient(180deg, #0a0d12 0%, #090b10 100%)'
          : 'radial-gradient(circle at top left, rgba(75,103,255,0.10), transparent 18%), radial-gradient(circle at top right, rgba(22,145,95,0.06), transparent 18%), linear-gradient(180deg, #f8faff 0%, #f4f7fb 100%)',
      }}
    >

      {/* Header */}
      <div className="rounded-[30px] p-5 sm:p-7" style={{ background: dark ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.82)', border: dark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.06)' }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: 'var(--accent)' }}>
              Finance command center
            </p>
            <h1 className="text-3xl sm:text-4xl font-semibold" style={{ color: 'var(--text-1)', letterSpacing: '-0.04em', lineHeight: 1.05 }}>
              Analytics that feel board-room ready
            </h1>
            <p className="text-sm sm:text-base max-w-3xl" style={{ color: 'var(--text-3)' }}>
              Deep dive into cashflow, collections, concentration, and project profitability without losing the existing operational depth.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <InsightWorkbench
              pageKey="analytics"
              pageLabel="Analytics"
              widgetCatalog={ANALYTICS_WIDGET_CATALOG}
              defaultWidgetIds={activeWidgetIds}
              factoryWidgetIds={ANALYTICS_DEFAULT_WIDGET_IDS}
              sourceOptions={analyticsSourceOptions}
              currentFilters={{ period, invoice_count: invoices.length }}
              onApplyWidgets={setActiveWidgetIds}
              onApplyCustomBlocks={(blocks, rowsByKey) => {
                setActiveCustomBlocks(blocks)
                setCustomSourceRows(rowsByKey || {})
              }}
            />
            <div className="inline-flex items-center p-1 rounded-2xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              {PERIODS.map(p => (
                <button key={p.id}
                  onClick={() => setPeriod(p.id)}
                  className="text-xs font-medium px-3 py-1.5 rounded-xl transition-colors"
                  style={period === p.id
                    ? { background: 'rgba(255,255,255,0.08)', color: 'var(--text-1)' }
                    : { color: 'var(--text-3)' }}>
                  {p.label}
                </button>
              ))}
            </div>
            <button
              onClick={refresh}
              disabled={loading}
              aria-label="Refresh"
              className="inline-flex items-center gap-2 rounded-2xl px-3.5 py-2 text-sm font-medium"
              style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-2)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <RefreshCw size={14} className={clsx(loading && 'animate-spin')} />
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 xl:grid-cols-[1.9fr_1fr] gap-4">
          <div className="rounded-[28px] p-5 sm:p-6" style={{ background: dark ? 'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%)' : 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(246,249,255,0.96) 100%)', border: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(15,23,42,0.06)' }}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-3)' }}>Cash position</p>
                <h2 className="text-4xl sm:text-5xl font-semibold mt-2 tabular-nums" style={{ color: 'var(--text-1)', letterSpacing: '-0.05em' }}>
                  {inr(filtered.received)}
                </h2>
                <p className="text-sm mt-2" style={{ color: 'var(--text-3)' }}>
                  Collected in the selected period, against {inr(filtered.raised)} raised and {inr(filtered.outstanding)} still open.
                </p>
              </div>
              <div className="rounded-3xl px-4 py-3 min-w-[170px]" style={{ background: dark ? 'rgba(132,226,84,0.08)' : 'rgba(22,145,95,0.08)', border: dark ? '1px solid rgba(132,226,84,0.12)' : '1px solid rgba(22,145,95,0.12)' }}>
                <p className="text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--text-3)' }}>Collection rate</p>
                <p className="text-2xl font-semibold mt-1 tabular-nums" style={{ color: 'var(--fin-positive)' }}>
                  {formatPct(filtered.collectionRate, 1)}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                  {filtered.avgDso != null ? `${filtered.avgDso.toFixed(0)} day average payment cycle` : 'Waiting for more paid invoice data'}
                </p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Outstanding', value: inr(filtered.outstanding), tone: filtered.outstanding > 0 ? 'var(--fin-warning)' : 'var(--text-1)' },
                { label: 'Margin', value: formatPct(margin, 2), tone: margin >= 0 ? 'var(--fin-positive)' : 'var(--fin-negative)' },
                { label: 'Period invoices', value: `${invoices.length}`, tone: 'var(--text-1)' },
                { label: 'Month delta', value: monthDelta != null ? formatPct(monthDelta, 1) : '—', tone: monthDelta == null ? 'var(--text-1)' : monthDelta >= 0 ? 'var(--fin-positive)' : 'var(--fin-negative)' },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl p-4" style={{ background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(245,247,251,0.86)', border: dark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.06)' }}>
                  <p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-3)' }}>{item.label}</p>
                  <p className="text-xl font-semibold mt-2 tabular-nums" style={{ color: item.tone }}>{item.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] p-5 sm:p-6" style={{ background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.78)', border: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(15,23,42,0.06)' }}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-3)' }}>Live context</p>
            <h2 className="text-2xl font-semibold mt-2" style={{ color: 'var(--text-1)' }}>Signals worth noticing</h2>
            <div className="mt-5 space-y-3">
              <div className="rounded-2xl p-4" style={{ background: dark ? 'rgba(255,255,255,0.02)' : 'rgba(245,247,251,0.76)', border: dark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.06)' }}>
                <p className="text-[11px] uppercase tracking-[0.16em]" style={{ color: 'var(--text-3)' }}>Sync state</p>
                <p className="text-sm mt-2 flex items-center gap-2" style={{ color: syncing ? 'var(--fin-warning)' : 'var(--fin-positive)' }}>
                  <SyncDot syncing={syncing} />
                  {syncing ? 'Syncing current finance context' : `Updated ${updatedLabel || 'just now'}`}
                </p>
              </div>
              <div className="rounded-2xl p-4" style={{ background: dark ? 'rgba(255,125,128,0.06)' : 'rgba(216,95,88,0.08)', border: dark ? '1px solid rgba(255,125,128,0.12)' : '1px solid rgba(216,95,88,0.10)' }}>
                <p className="text-[11px] uppercase tracking-[0.16em]" style={{ color: 'var(--text-3)' }}>Overdue pressure</p>
                <p className="text-base font-semibold mt-2" style={{ color: (is?.overdue_invoices?.length || 0) > 0 ? 'var(--fin-negative)' : 'var(--text-1)' }}>
                  {is?.overdue_invoices?.length ? `${is.overdue_invoices.length} overdue invoice${is.overdue_invoices.length === 1 ? '' : 's'}` : 'No overdue invoices'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
          style={{ background: 'var(--fin-neg-bg)', border: '1px solid var(--fin-neg-border)', color: 'var(--fin-negative)' }}>
          <AlertCircle size={15} /> {error}
          <button onClick={refresh} className="underline ml-1">retry</button>
        </div>
      )}

      <CustomInsightBlocks
        blocks={activeCustomBlocks}
        sourceOptions={analyticsSourceOptions}
        sourceRowsByKey={customSourceRows}
      />

      {/* ── KPI strip — 5 cards with sparklines ── */}
      {visibleWidgets.has('kpi_strip') && (
      <section aria-label="Key analytics" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
        <KpiCard tone={0} icon={IndianRupee}
          label="Revenue (period)"
          value={inr(filtered.raised)}
          sub={`${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`}
          spark={sparks.raised} sparkColor="#2563eb" />
        <KpiCard tone={1} icon={Wallet}
          label="Collected"
          value={inr(filtered.received)}
          accent="positive"
          sub={`${formatPct(filtered.collectionRate, 1)} collection rate`}
          spark={sparks.collected} sparkColor="#16a34a" />
        <KpiCard tone={2} icon={Clock}
          label="Outstanding"
          value={inr(filtered.outstanding)}
          accent={filtered.outstanding > 0 ? 'warning' : 'positive'}
          sub={`${filtered.byStatus?.Pending || 0} pending`} />
        <KpiCard tone={3} icon={Hourglass}
          label="Avg Days to Pay"
          value={filtered.avgDso != null ? `${filtered.avgDso.toFixed(0)}d` : '—'}
          accent={filtered.avgDso == null ? undefined : filtered.avgDso <= 14 ? 'positive' : filtered.avgDso <= 30 ? 'warning' : 'negative'}
          sub="DSO across paid invoices" />
        <KpiCard tone={4} icon={Target}
          label="Profit Margin"
          value={formatPct(margin, 2)}
          accent={margin >= 20 ? 'positive' : margin >= 0 ? 'warning' : 'negative'}
          sub={inr(ps?.total_profit) + ' on ' + inr(ps?.total_billed)} />
      </section>
      )}

      {/* ── Smart insights ── */}
      {visibleWidgets.has('insights') && insights.length > 0 && (
        <section aria-label="Insights" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {insights.map((i, idx) => <InsightCard key={idx} {...i} />)}
        </section>
      )}

      {/* ── Revenue pipeline funnel ── */}
      {visibleWidgets.has('pipeline') && pipeline && (
        <ChartCard title="Revenue Pipeline" sub="Lifecycle from raised → collected → outstanding → overdue">
          <PipelineFunnel data={pipeline} dark={dark} />
        </ChartCard>
      )}

      {/* ── Cash flow timeline ── */}
      {visibleWidgets.has('cashflow') && (
      <ChartCard
        title="Cash Flow"
        sub="Monthly raised (bars) vs collected (line) — last 12 months"
        action={monthDelta != null && (
          <span className="text-[11px] font-semibold tabular-nums px-2 py-1 rounded-md flex items-center gap-1"
            style={{
              color: monthDelta >= 0 ? 'var(--fin-positive)' : 'var(--fin-negative)',
              background: monthDelta >= 0 ? 'var(--fin-pos-bg)' : 'var(--fin-neg-bg)',
            }}>
            {monthDelta >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {formatPct(Math.abs(monthDelta), 1)} vs last month
          </span>
        )}
      >
        {cashflow.length === 0 ? (
          <div className="text-center py-10 text-sm" style={{ color: 'var(--text-3)' }}>No invoice data yet</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={cashflow} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              style={{ cursor: 'crosshair' }}>
              <defs>
                <linearGradient id="raisedBarG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={dark ? '#7d95ff' : '#2563eb'} stopOpacity={0.85} />
                  <stop offset="100%" stopColor={dark ? '#7d95ff' : '#2563eb'} stopOpacity={0.45} />
                </linearGradient>
                <linearGradient id="collectedLineG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={dark ? '#84e254' : '#16a34a'} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={dark ? '#84e254' : '#16a34a'} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: 'var(--text-3)', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--text-3)', fontSize: 10 }} tickFormatter={axisInr} axisLine={false} tickLine={false} width={52} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const raised = payload.find(p => p.dataKey === 'raised')?.value || 0
                  const collected = payload.find(p => p.dataKey === 'collected')?.value || 0
                  const gap = raised - collected
                  const rate = raised > 0 ? (collected / raised * 100).toFixed(1) : '—'
                  return (
                    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 14, padding: '10px 14px', fontSize: 12, boxShadow: 'var(--card-shadow)', minWidth: 170 }}>
                      <p style={{ color: 'var(--text-1)', fontWeight: 700, marginBottom: 8 }}>{label}</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                          <span style={{ color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: dark ? '#7d95ff' : '#2563eb', display: 'inline-block' }} />Raised
                          </span>
                          <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{inr(raised)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                          <span style={{ color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: dark ? '#84e254' : '#16a34a', display: 'inline-block' }} />Collected
                          </span>
                          <span style={{ color: dark ? '#84e254' : '#16a34a', fontWeight: 600 }}>{inr(collected)}</span>
                        </div>
                        {gap > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                            <span style={{ color: 'var(--text-3)' }}>Gap</span>
                            <span style={{ color: 'var(--fin-warning)', fontWeight: 600 }}>{inr(gap)}</span>
                          </div>
                        )}
                        <div style={{ borderTop: '1px solid var(--card-border)', marginTop: 4, paddingTop: 4, display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                          <span style={{ color: 'var(--text-3)' }}>Collection rate</span>
                          <span style={{ color: 'var(--fin-positive)', fontWeight: 700 }}>{rate}%</span>
                        </div>
                      </div>
                    </div>
                  )
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-3)' }} />
              <Bar dataKey="raised" name="Raised" fill="url(#raisedBarG)" radius={[4, 4, 0, 0]}
                animationBegin={0} animationDuration={800} />
              <Area type="monotone" dataKey="collected" name="Collected"
                stroke={dark ? '#84e254' : '#16a34a'} strokeWidth={2.5}
                fill="url(#collectedLineG)" dot={{ r: 3.5, fill: dark ? '#84e254' : '#16a34a', strokeWidth: 0 }}
                activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--card-bg)' }}
                animationBegin={200} animationDuration={900} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
      )}

      {/* ── DSO trend chart ── */}
      {visibleWidgets.has('dso_trend') && dsoTrend.length > 1 && (
        <ChartCard title="Payment Speed" sub="Average days to collect per month — lower is better">
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={dsoTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="dsoLineG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f3b45d" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#f3b45d" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: 'var(--text-3)', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--text-3)', fontSize: 10 }} tickFormatter={v => `${v}d`} axisLine={false} tickLine={false} width={36} />
              <ReferenceLine y={14} stroke="var(--fin-positive)" strokeDasharray="4 3" label={{ value: '14d target', position: 'insideTopRight', fontSize: 9, fill: 'var(--fin-positive)' }} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const dso = payload[0]?.value
                  return (
                    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 14, padding: '10px 14px', fontSize: 12, boxShadow: 'var(--card-shadow)' }}>
                      <p style={{ color: 'var(--text-1)', fontWeight: 700, marginBottom: 6 }}>{label}</p>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                        <span style={{ color: 'var(--text-3)' }}>Avg days to collect</span>
                        <span style={{ color: dso <= 14 ? 'var(--fin-positive)' : dso <= 30 ? 'var(--fin-warning)' : 'var(--fin-negative)', fontWeight: 700 }}>{dso}d</span>
                      </div>
                      {payload[0]?.payload?.count && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginTop: 4 }}>
                          <span style={{ color: 'var(--text-3)' }}>Invoices cleared</span>
                          <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{payload[0].payload.count}</span>
                        </div>
                      )}
                    </div>
                  )
                }}
              />
              <Area type="monotone" dataKey="dso" name="DSO (days)"
                stroke="#f3b45d" strokeWidth={2.5}
                fill="url(#dsoLineG)"
                dot={(props) => {
                  const { cx, cy, payload } = props
                  const color = payload.dso <= 14 ? (dark ? '#84e254' : '#16a34a') : payload.dso <= 30 ? '#f3b45d' : (dark ? '#ff7d80' : '#d85f58')
                  return <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={4} fill={color} stroke="var(--card-bg)" strokeWidth={2} />
                }}
                activeDot={{ r: 6, strokeWidth: 2, stroke: 'var(--card-bg)' }}
                animationBegin={0} animationDuration={900} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* ── Row: Aging + Top pending ── */}
      {(visibleWidgets.has('aging') || visibleWidgets.has('top_pending')) && (
      <div className={clsx('grid gap-4', visibleWidgets.has('aging') && visibleWidgets.has('top_pending') ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1')}>

        {visibleWidgets.has('aging') && (
        <ChartCard title="Receivables Aging" sub="Pending invoice value by age bucket (overall)">
          {aging.every(a => a.amount === 0) ? (
            <div className="text-center py-10 text-sm" style={{ color: 'var(--text-3)' }}>
              No pending invoices — all caught up 🎉
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={aging} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 4 }}
                barCategoryGap="28%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" horizontal={false} />
                <XAxis type="number" tick={{ fill: 'var(--text-3)', fontSize: 10 }} tickFormatter={axisInr} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="range" tick={{ fill: 'var(--text-2)', fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} width={54} tickFormatter={v => `${v}d`} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload
                    return (
                      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 14, padding: '10px 14px', fontSize: 12, boxShadow: 'var(--card-shadow)' }}>
                        <p style={{ color: 'var(--text-1)', fontWeight: 700, marginBottom: 6 }}>{d.range} days</p>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                          <span style={{ color: 'var(--text-3)' }}>Outstanding</span>
                          <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{inr(d.amount)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginTop: 4 }}>
                          <span style={{ color: 'var(--text-3)' }}>Invoices</span>
                          <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{d.count}</span>
                        </div>
                      </div>
                    )
                  }}
                />
                <Bar dataKey="amount" name="Outstanding" radius={[0, 6, 6, 0]} animationBegin={0} animationDuration={800}>
                  {aging.map((entry) => {
                    const fill = entry.range === '0-30'
                      ? (dark ? '#84e254' : '#16a34a')
                      : entry.range === '31-60'
                        ? '#f3b45d'
                        : (dark ? '#ff7d80' : '#d85f58')
                    return <Cell key={entry.range} fill={fill} />
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
        )}

        {visibleWidgets.has('top_pending') && (
        <ChartCard
          title="Top Pending Invoices"
          sub="Oldest first — needs follow-up"
          action={topPending.length > 0 && (
            <Link to="/invoices?status=Pending"
              className="text-[11px] font-medium flex items-center gap-1 transition-opacity hover:opacity-70"
              style={{ color: 'var(--accent)' }}>
              View all <ArrowRight size={11} />
            </Link>
          )}
        >
          {topPending.length === 0 ? (
            <div className="text-center py-10 text-sm" style={{ color: 'var(--text-3)' }}>No pending invoices</div>
          ) : (
            <div className="space-y-2">
              {topPending.map(inv => {
                const sev = inv.aging > 60 ? 'negative' : inv.aging > 30 ? 'warning' : 'info'
                const color = sev === 'negative' ? 'var(--fin-negative)' : sev === 'warning' ? 'var(--fin-warning)' : 'var(--text-2)'
                return (
                  <Link key={inv.id} to="/invoices"
                    className="flex items-center justify-between gap-3 p-2.5 rounded-lg transition-colors"
                    style={{ background: 'var(--bg-input)', border: '1px solid transparent' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-soft)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}>
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs font-bold truncate" style={{ color: 'var(--text-1)' }}>{inv.invoice_no}</p>
                      <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-3)' }}>{inv.project}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-bold tabular-nums text-sm" style={{ color: 'var(--text-1)' }}>{inr(inv.amount)}</p>
                      <p className="text-[10px] font-semibold tabular-nums mt-0.5" style={{ color }}>{inv.aging}d aging</p>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </ChartCard>
        )}
      </div>
      )}

      {/* ── Invoice status breakdown — rich split layout ── */}
      {visibleWidgets.has('status_breakdown') && (
      <ChartCard title="Invoice Status Mix" sub="Detailed breakdown of amount, count, and share by status this period">
        {statusBreakdown.length === 0 ? (
          <div className="text-center py-10 text-sm" style={{ color: 'var(--text-3)' }}>No invoices in selected period</div>
        ) : (() => {
          const totalAmt = statusBreakdown.reduce((s, x) => s + x.amount, 0)
          const totalCnt = statusBreakdown.reduce((s, x) => s + x.count, 0)
          const STATUS_COLOR = (name) =>
            name === 'Paid'      ? (dark ? '#84e254' : '#16a34a') :
            name === 'Pending'   ? '#f3b45d' :
            name === 'Cancelled' ? (dark ? '#ff7d80' : '#dc2626') : '#9ca3af'
          const STATUS_BG = (name) =>
            name === 'Paid'      ? (dark ? 'rgba(132,226,84,0.1)' : 'rgba(22,145,95,0.08)') :
            name === 'Pending'   ? 'rgba(243,180,93,0.1)' :
            name === 'Cancelled' ? (dark ? 'rgba(255,125,128,0.1)' : 'rgba(220,38,38,0.08)') :
            'rgba(156,163,175,0.1)'
          return (
            <div className="flex flex-col lg:flex-row gap-4 items-stretch">
              {/* Left: donut + center label */}
              <div className="flex-shrink-0 flex flex-col items-center justify-center" style={{ minWidth: 200 }}>
                <div style={{ position: 'relative', width: 180, height: 180 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={statusBreakdown} cx="50%" cy="50%" innerRadius={58} outerRadius={82}
                        dataKey="amount" nameKey="name" paddingAngle={3} animationBegin={0} animationDuration={800}>
                        {statusBreakdown.map((entry) => (
                          <Cell key={entry.name} fill={STATUS_COLOR(entry.name)} opacity={0.9} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const d = payload[0].payload
                          return (
                            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 14, padding: '10px 14px', fontSize: 12, boxShadow: 'var(--card-shadow)' }}>
                              <p style={{ color: STATUS_COLOR(d.name), fontWeight: 700, marginBottom: 6 }}>{d.name}</p>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                                <span style={{ color: 'var(--text-3)' }}>Amount</span>
                                <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{inr(d.amount)}</span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginTop: 4 }}>
                                <span style={{ color: 'var(--text-3)' }}>Share</span>
                                <span style={{ color: STATUS_COLOR(d.name), fontWeight: 700 }}>{totalAmt > 0 ? ((d.amount / totalAmt) * 100).toFixed(1) : '0'}%</span>
                              </div>
                            </div>
                          )
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Center label */}
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                    <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{totalCnt}</p>
                    <p style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>invoices</p>
                  </div>
                </div>
                <p className="text-xs mt-2 font-semibold tabular-nums" style={{ color: 'var(--text-1)' }}>{inr(totalAmt)}</p>
                <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>total raised this period</p>
              </div>

              {/* Right: per-status detail rows */}
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3 content-start">
                {statusBreakdown.map((s) => {
                  const pct = totalAmt > 0 ? (s.amount / totalAmt) * 100 : 0
                  const cntPct = totalCnt > 0 ? (s.count / totalCnt) * 100 : 0
                  const color = STATUS_COLOR(s.name)
                  const bg = STATUS_BG(s.name)
                  return (
                    <div key={s.name} className="rounded-2xl p-3.5 transition-transform duration-200 hover:scale-[1.01]"
                      style={{ background: bg, border: `1px solid ${color}22` }}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                          <span className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>{s.name}</span>
                        </div>
                        <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded"
                          style={{ color, background: `${color}18` }}>
                          {pct.toFixed(1)}%
                        </span>
                      </div>
                      <p className="text-lg font-bold tabular-nums" style={{ color }}>{inr(s.amount)}</p>
                      <div className="flex items-center justify-between mt-1 mb-2">
                        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{s.count} invoice{s.count === 1 ? '' : 's'}</p>
                        <p className="text-[10px] tabular-nums" style={{ color: 'var(--text-3)' }}>{cntPct.toFixed(0)}% by count</p>
                      </div>
                      {/* Amount share bar */}
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: `${color}22` }}>
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
                      </div>
                    </div>
                  )
                })}

                {/* Summary stat row */}
                <div className="rounded-2xl p-3.5 sm:col-span-2"
                  style={{ background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(245,247,251,0.86)', border: '1px solid var(--card-border)' }}>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    {[
                      { label: 'Collection rate', value: totalAmt > 0 ? `${((statusBreakdown.find(s => s.name === 'Paid')?.amount || 0) / totalAmt * 100).toFixed(1)}%` : '—', color: 'var(--fin-positive)' },
                      { label: 'Avg per invoice', value: totalCnt > 0 ? inr(totalAmt / totalCnt) : '—', color: 'var(--text-1)' },
                      { label: 'Pending exposure', value: inr(statusBreakdown.find(s => s.name === 'Pending')?.amount || 0), color: 'var(--fin-warning)' },
                    ].map(stat => (
                      <div key={stat.label}>
                        <p className="text-base font-bold tabular-nums" style={{ color: stat.color }}>{stat.value}</p>
                        <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{stat.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )
        })()}
      </ChartCard>
      )}

      {/* ── Client concentration row ── */}
      {visibleWidgets.has('client_concentration') && clientConc.length > 0 && (
        <ChartCard
          title="Client Concentration"
          sub="Revenue distribution — diversification risk check"
          action={clientConc[0]?.pct >= 70 && (
            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded"
              style={{ background: 'var(--fin-warn-bg)', color: 'var(--fin-warning)' }}>
              High concentration
            </span>
          )}
        >
          <ResponsiveContainer width="100%" height={Math.max(160, clientConc.length * 44)}>
            <BarChart data={clientConc} layout="vertical" margin={{ top: 4, right: 60, left: 0, bottom: 4 }} barCategoryGap="28%">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" horizontal={false} />
              <XAxis type="number" tick={{ fill: 'var(--text-3)', fontSize: 10 }} tickFormatter={v => `${v.toFixed(0)}%`} domain={[0, 100]} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text-2)', fontSize: 11 }} axisLine={false} tickLine={false} width={90} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload
                  return (
                    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 14, padding: '10px 14px', fontSize: 12, boxShadow: 'var(--card-shadow)' }}>
                      <p style={{ color: 'var(--text-1)', fontWeight: 700, marginBottom: 6 }}>{d.name}</p>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                        <span style={{ color: 'var(--text-3)' }}>Revenue</span>
                        <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{inr(d.amount)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginTop: 4 }}>
                        <span style={{ color: 'var(--text-3)' }}>Share</span>
                        <span style={{ color: d.pct >= 70 ? 'var(--fin-warning)' : 'var(--accent)', fontWeight: 700 }}>{d.pct.toFixed(1)}%</span>
                      </div>
                    </div>
                  )
                }}
              />
              <Bar dataKey="pct" name="% of revenue" radius={[0, 6, 6, 0]} animationBegin={0} animationDuration={800}
                label={{ position: 'right', formatter: (v) => `${v.toFixed(1)}%`, fontSize: 10, fill: 'var(--text-3)', dy: 1 }}>
                {clientConc.map((entry, i) => (
                  <Cell key={entry.name}
                    fill={i === 0 && entry.pct >= 70 ? '#f3b45d' : (dark ? '#7d95ff' : '#2563eb')}
                    opacity={0.85 - i * 0.06}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* ── Project profitability matrix ── */}
      {visibleWidgets.has('project_profitability') && (
      <ChartCard title="Project Profitability" sub="Revenue, cost, profit & invoiced amounts (overall)">
        {projMatrix.length === 0 ? (
          <div className="text-center py-10 text-sm" style={{ color: 'var(--text-3)' }}>No project data</div>
        ) : (
          <div className="overflow-x-auto -mx-2 sm:-mx-4">
            <table className="w-full text-xs" style={{ minWidth: 740 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--card-border)' }}>
                  {['Project', 'Revenue', 'Cost', 'Profit', 'Margin', 'Invoiced', 'Outstanding'].map(h => (
                    <th key={h} className="px-2 sm:px-4 py-2 text-left font-semibold uppercase tracking-wide text-[10px]"
                      style={{ color: 'var(--text-3)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {projMatrix.map(p => {
                  const marginColor = p.margin >= 20 ? 'var(--fin-positive)' : p.margin >= 0 ? 'var(--fin-warning)' : 'var(--fin-negative)'
                  const marginBg = p.margin >= 20 ? 'var(--fin-pos-bg)' : p.margin >= 0 ? 'var(--fin-warn-bg)' : 'var(--fin-neg-bg)'
                  const cappedPct = Math.min(Math.abs(p.margin), 100)
                  return (
                    <tr key={p.id} className="tbl-row" style={{ transition: 'background 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-dim)'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}>
                      <td className="px-2 sm:px-4 py-2.5">
                        <p className="font-semibold" style={{ color: 'var(--text-1)' }}>{p.name}</p>
                        <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>{p.status}</p>
                      </td>
                      <td className="px-2 sm:px-4 py-2.5 tabular-nums font-medium" style={{ color: 'var(--text-1)' }}>{inr(p.billed)}</td>
                      <td className="px-2 sm:px-4 py-2.5 tabular-nums" style={{ color: 'var(--text-2)' }}>{inr(p.cost)}</td>
                      <td className="px-2 sm:px-4 py-2.5 tabular-nums font-semibold"
                        style={{ color: p.profit >= 0 ? 'var(--fin-positive)' : 'var(--fin-negative)' }}>
                        {inr(p.profit)}
                      </td>
                      <td className="px-2 sm:px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold tabular-nums px-1.5 py-0.5 rounded text-[11px]"
                            style={{ color: marginColor, background: marginBg, flexShrink: 0 }}>
                            {p.margin >= 0 ? '+' : ''}{formatPct(p.margin, 1)}
                          </span>
                          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)', minWidth: 36 }}>
                            <div className="h-full rounded-full" style={{ width: `${cappedPct}%`, background: marginColor, transition: 'width 0.7s ease' }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-2 sm:px-4 py-2.5 tabular-nums" style={{ color: 'var(--text-2)' }}>{inr(p.invoiced)}</td>
                      <td className="px-2 sm:px-4 py-2.5 tabular-nums">
                        <span style={{ color: p.outstanding > 0 ? 'var(--fin-warning)' : 'var(--text-3)' }}>
                          {p.outstanding > 0 ? inr(p.outstanding) : '—'}
                        </span>
                        {p.outstanding > 0 && (
                          <div className="w-1.5 h-1.5 rounded-full inline-block ml-1.5 animate-pulse" style={{ background: 'var(--fin-warning)' }} />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
      )}
    </div>
  )
}
