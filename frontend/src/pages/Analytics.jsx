import { useCallback, useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area, LineChart, Line,
} from 'recharts'
import {
  RefreshCw, AlertCircle, TrendingUp, TrendingDown, IndianRupee,
  Wallet, Receipt, Clock, AlertTriangle, ArrowUpRight, ArrowDownRight,
  Target, Sparkles, Activity, CalendarClock, CheckCircle2, Hourglass,
  Users, Layers, Zap, ArrowRight,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../services/api'
import { useAutoRefresh, useRelativeTime } from '../hooks/useAutoRefresh'
import { formatInr as inr, formatPct, formatInt } from '../utils/format'
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

/* ── Page ────────────────────────────────────────────────────────────── */
export default function Analytics() {
  const [period, setPeriod] = useState('all')

  const fetchAll = useCallback(() =>
    Promise.all([
      api.projects.summary(),
      api.projects.list({ limit: 100 }),
      api.invoices.summary(),
      api.invoices.list({ limit: 500 }),
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

  /* ── Project profitability matrix ── */
  const projMatrix = useMemo(() =>
    projects
      .filter(r => r.fields?.['Amount Billed So far'] != null)
      .map(r => {
        const f = r.fields
        const billed = parseFloat(f['Amount Billed So far'] || 0)
        const cost   = parseFloat(f['Input cost so far'] || 0) + parseFloat(f['Total Overhead Cost'] || 0)
        const profit = parseFloat(f['Actual Profit'] || 0)
        const margin = parseFloat(f['Profit percentage'] || 0)
        return {
          id: r.id,
          name: `${(f['Client'] || '').split(' ')[0]}/${f['Project Name'] || ''}`,
          status: f['Project Status'],
          billed, cost, profit, margin,
          invoiced: is?.by_project?.[f['Project Name']]?.raised || 0,
          outstanding: is?.by_project?.[f['Project Name']]?.outstanding || 0,
        }
      })
      .sort((a, b) => b.billed - a.billed)
  , [projects, is])

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
    <div className="p-4 sm:p-6 space-y-5 animate-fade-in">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--text-1)' }}>Analytics</h1>
          <p className="text-sm mt-0.5 flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
            Portfolio &amp; cash flow insights
            {lastUpdated && (
              <span className="flex items-center gap-1.5">
                · <SyncDot syncing={syncing} />
                <span style={{ color: syncing ? 'var(--fin-warning)' : 'var(--text-3)' }}>
                  {syncing ? 'syncing…' : `live · ${updatedLabel}`}
                </span>
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Period chips */}
          <div className="inline-flex items-center p-1 rounded-lg" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
            {PERIODS.map(p => (
              <button key={p.id}
                onClick={() => setPeriod(p.id)}
                className="text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
                style={period === p.id
                  ? { background: 'var(--card-bg)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }
                  : { color: 'var(--text-3)' }}>
                {p.label}
              </button>
            ))}
          </div>
          <button onClick={refresh} disabled={loading} aria-label="Refresh" className="btn-icon">
            <RefreshCw size={14} className={clsx(loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
          style={{ background: 'var(--fin-neg-bg)', border: '1px solid var(--fin-neg-border)', color: 'var(--fin-negative)' }}>
          <AlertCircle size={15} /> {error}
          <button onClick={refresh} className="underline ml-1">retry</button>
        </div>
      )}

      {/* ── KPI strip — 5 cards with sparklines ── */}
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

      {/* ── Smart insights ── */}
      {insights.length > 0 && (
        <section aria-label="Insights" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {insights.map((i, idx) => <InsightCard key={idx} {...i} />)}
        </section>
      )}

      {/* ── Cash flow timeline ── */}
      <ChartCard
        title="Cash Flow"
        sub="Monthly raised vs collected (last 12 months)"
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
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={cashflow} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="raisedG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2563eb" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="collectedG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#16a34a" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#16a34a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: 'var(--text-3)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'var(--text-3)', fontSize: 10 }} tickFormatter={axisInr} />
              <Tooltip {...tooltipStyle} formatter={(v, name) => [inr(v), name]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="raised"    stroke="#2563eb" strokeWidth={2} fill="url(#raisedG)"    name="Raised" />
              <Area type="monotone" dataKey="collected" stroke="#16a34a" strokeWidth={2} fill="url(#collectedG)" name="Collected" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* ── Row: Aging + Top pending ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        <ChartCard title="Receivables Aging" sub="Pending invoice value by age (overall)">
          {aging.every(a => a.amount === 0) ? (
            <div className="text-center py-10 text-sm" style={{ color: 'var(--text-3)' }}>
              No pending invoices — all caught up
            </div>
          ) : (
            <div className="space-y-3">
              {aging.map(({ range, amount, count }) => {
                const total = aging.reduce((s, a) => s + a.amount, 0)
                const pct = total > 0 ? (amount / total) * 100 : 0
                const color =
                  range === '0-30'  ? 'var(--fin-positive)' :
                  range === '31-60' ? 'var(--fin-warning)' : 'var(--fin-negative)'
                return (
                  <div key={range}>
                    <div className="flex items-baseline justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                        <span className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>{range} days</span>
                        <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>· {count} invoice{count === 1 ? '' : 's'}</span>
                      </div>
                      <span className="font-bold tabular-nums text-sm" style={{ color }}>{inr(amount)}</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </ChartCard>

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
      </div>

      {/* ── Invoice status pie ── */}
      <ChartCard title="Invoice Status" sub="By total amount raised (this period)">
        {statusBreakdown.length === 0 ? (
          <div className="text-center py-10 text-sm" style={{ color: 'var(--text-3)' }}>No invoices in selected period</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={statusBreakdown} cx="50%" cy="50%" innerRadius={56} outerRadius={88}
                dataKey="amount" nameKey="name" paddingAngle={2}>
                {statusBreakdown.map((entry) => {
                  const c = entry.name === 'Paid' ? '#16a34a' : entry.name === 'Pending' ? '#d97706' : entry.name === 'Cancelled' ? '#dc2626' : '#9ca3af'
                  return <Cell key={entry.name} fill={c} />
                })}
              </Pie>
              <Tooltip {...tooltipStyle}
                formatter={(v, n, p) => [inr(v) + ` (${p.payload.count} invoice${p.payload.count === 1 ? '' : 's'})`, n]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* ── Client concentration row ── */}
      {clientConc.length > 1 && (
        <ChartCard title="Client Concentration" sub="Revenue distribution — diversification check">
          <div className="space-y-2.5">
            {clientConc.map((c, i) => {
              const color = i === 0 && c.pct >= 70 ? 'var(--fin-warning)' : 'var(--accent)'
              return (
                <div key={c.name}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-medium truncate" style={{ color: 'var(--text-1)' }}>{c.name}</span>
                      {i === 0 && c.pct >= 70 && (
                        <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                          style={{ background: 'var(--fin-warn-bg)', color: 'var(--fin-warning)' }}>
                          High concentration
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs tabular-nums" style={{ color: 'var(--text-3)' }}>{inr(c.amount)}</span>
                      <span className="text-xs font-bold tabular-nums" style={{ color }}>{formatPct(c.pct, 1)}</span>
                    </div>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${c.pct}%`, background: color }} />
                  </div>
                </div>
              )
            })}
          </div>
        </ChartCard>
      )}

      {/* ── Project profitability matrix ── */}
      <ChartCard title="Project Profitability" sub="Revenue, cost, profit & invoiced amounts (overall)">
        {projMatrix.length === 0 ? (
          <div className="text-center py-10 text-sm" style={{ color: 'var(--text-3)' }}>No project data</div>
        ) : (
          <div className="overflow-x-auto -mx-2 sm:-mx-4">
            <table className="w-full text-xs" style={{ minWidth: 720 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--card-border)' }}>
                  {['Project', 'Revenue', 'Cost', 'Profit', 'Margin', 'Invoiced', 'Outstanding'].map(h => (
                    <th key={h} className="px-2 sm:px-4 py-2 text-left font-semibold uppercase tracking-wide text-[10px]"
                      style={{ color: 'var(--text-3)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {projMatrix.map(p => (
                  <tr key={p.id} className="tbl-row">
                    <td className="px-2 sm:px-4 py-2.5">
                      <p className="font-semibold" style={{ color: 'var(--text-1)' }}>{p.name}</p>
                      <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>{p.status}</p>
                    </td>
                    <td className="px-2 sm:px-4 py-2.5 tabular-nums" style={{ color: 'var(--text-1)' }}>{inr(p.billed)}</td>
                    <td className="px-2 sm:px-4 py-2.5 tabular-nums" style={{ color: 'var(--text-2)' }}>{inr(p.cost)}</td>
                    <td className="px-2 sm:px-4 py-2.5 tabular-nums font-semibold"
                      style={{ color: p.profit >= 0 ? 'var(--fin-positive)' : 'var(--fin-negative)' }}>
                      {inr(p.profit)}
                    </td>
                    <td className="px-2 sm:px-4 py-2.5">
                      <span className="font-bold tabular-nums px-1.5 py-0.5 rounded text-[11px]"
                        style={{
                          color: p.margin >= 20 ? 'var(--fin-positive)' : p.margin >= 0 ? 'var(--fin-warning)' : 'var(--fin-negative)',
                          background: p.margin >= 20 ? 'var(--fin-pos-bg)' : p.margin >= 0 ? 'var(--fin-warn-bg)' : 'var(--fin-neg-bg)',
                        }}>
                        {p.margin >= 0 ? '+' : ''}{formatPct(p.margin, 2)}
                      </span>
                    </td>
                    <td className="px-2 sm:px-4 py-2.5 tabular-nums" style={{ color: 'var(--text-2)' }}>{inr(p.invoiced)}</td>
                    <td className="px-2 sm:px-4 py-2.5 tabular-nums"
                      style={{ color: p.outstanding > 0 ? 'var(--fin-warning)' : 'var(--text-3)' }}>
                      {p.outstanding > 0 ? inr(p.outstanding) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
  )
}
