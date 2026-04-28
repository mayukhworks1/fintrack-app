import { useCallback, useState, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, Area, AreaChart,
} from 'recharts'
import {
  RefreshCw, AlertCircle, TrendingUp, TrendingDown, IndianRupee,
  Wallet, Receipt, Clock, AlertTriangle, ArrowUpRight, ArrowDownRight,
  Target, Sparkles, Activity, CalendarClock, CheckCircle2,
} from 'lucide-react'
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

/* ── Components ──────────────────────────────────────────────────────── */
function SyncDot({ syncing }) {
  return (
    <span className={clsx('w-1.5 h-1.5 rounded-full inline-block', syncing && 'animate-pulse')}
      style={{ background: syncing ? 'var(--fin-warning)' : 'var(--fin-positive)' }} aria-hidden="true" />
  )
}

const TILE_PALETTE = [
  { bg: '#dbeafe', fg: '#2563eb' },   // blue
  { bg: '#dcfce7', fg: '#16a34a' },   // green
  { bg: '#fef3c7', fg: '#d97706' },   // amber
  { bg: '#fce7f3', fg: '#db2777' },   // pink
  { bg: '#ede9fe', fg: '#7c3aed' },   // violet
]

function KpiCard({ label, value, sub, icon: Icon, accent, tone = 0, trend, delta }) {
  const palette = TILE_PALETTE[tone % TILE_PALETTE.length]
  const accentColor =
    accent === 'positive' ? 'var(--fin-positive)' :
    accent === 'warning'  ? 'var(--fin-warning)'  :
    accent === 'negative' ? 'var(--fin-negative)' : 'var(--text-1)'
  return (
    <div className="card flex items-center gap-3">
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
        {delta && <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{delta}</p>}
      </div>
    </div>
  )
}

function ChartCard({ title, sub, children, action }) {
  return (
    <div className="card">
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

/* ── Insight card — auto-generated callout ─────────────────────────── */
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
        style={{ width: 32, height: 32, background: 'rgba(255,255,255,0.5)', color: m.fg }}>
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
  const fetchAll = useCallback(() =>
    Promise.all([
      api.projects.summary(),
      api.projects.list({ limit: 100 }),
      api.invoices.summary(),
      api.invoices.list({ limit: 500 }),
    ]).then(([projSummary, projList, invSummary, invList]) => ({
      projSummary,
      projects: projList.records || [],
      invSummary,
      invoices: invList.records || [],
    }))
  , [])

  const { data, loading, error, refresh, lastUpdated, syncing } = useAutoRefresh(fetchAll, 10_000)
  const updatedLabel = useRelativeTime(lastUpdated)

  const ps  = data?.projSummary
  const is  = data?.invSummary
  const projects = data?.projects || []
  const invoices = data?.invoices || []

  const tooltipStyle = {
    contentStyle: {
      background: 'var(--card-bg)', border: '1px solid var(--card-border)',
      borderRadius: 10, fontSize: 12, boxShadow: 'var(--card-shadow)',
    },
    labelStyle: { color: 'var(--text-1)', fontWeight: 600 },
    itemStyle:  { color: 'var(--text-2)' },
  }

  /* ── Cash flow timeline — group invoices by month ── */
  const cashflow = useMemo(() => {
    const buckets = {}
    invoices.forEach(r => {
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
      .slice(-12)  // last 12 months
      .map(b => ({ ...b, label: monthLabel(b.key) }))
  }, [invoices])

  /* ── Aging buckets for pending invoices ── */
  const aging = useMemo(() => {
    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }
    const counts  = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }
    invoices.forEach(r => {
      const f = r.fields || {}
      if (f['Payment Status'] !== 'Pending') return
      const days   = Number(f['Agening (Days)'] || 0)
      const amount = Number(f['Amount Raised'] || 0)
      let bucket = '0-30'
      if      (days > 90) bucket = '90+'
      else if (days > 60) bucket = '61-90'
      else if (days > 30) bucket = '31-60'
      buckets[bucket] += amount
      counts[bucket]  += 1
    })
    return Object.entries(buckets).map(([range, amount]) => ({
      range, amount, count: counts[range],
    }))
  }, [invoices])

  /* ── Status breakdown by amount (not just count) ── */
  const statusBreakdown = useMemo(() => {
    if (!is?.by_status_amounts) return []
    return Object.entries(is.by_status_amounts).map(([status, amount]) => ({
      name: status,
      amount,
      count: is.by_status?.[status] || 0,
    }))
  }, [is])

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
          client: f['Client'],
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

    // Best margin project
    const sorted = [...projMatrix].filter(p => p.billed > 0).sort((a, b) => b.margin - a.margin)
    if (sorted[0]) {
      out.push({
        icon: Sparkles,
        tone: 'positive',
        title: `Top performer: ${sorted[0].name}`,
        body: `${formatPct(sorted[0].margin, 2)} profit margin on ${inr(sorted[0].billed)} billed.`,
      })
    }

    // Lowest margin project
    if (sorted.length > 1) {
      const worst = sorted[sorted.length - 1]
      if (worst.margin < sorted[0].margin) {
        out.push({
          icon: TrendingDown,
          tone: worst.margin < 0 ? 'negative' : 'warning',
          title: `Lowest margin: ${worst.name}`,
          body: `${formatPct(worst.margin, 2)} on ${inr(worst.billed)} — ${worst.margin < 0 ? 'currently loss-making' : 'consider review'}.`,
        })
      }
    }

    // Outstanding alert
    if (is.total_outstanding > 0) {
      const pct = is.total_raised > 0 ? (is.total_outstanding / is.total_raised) * 100 : 0
      out.push({
        icon: Clock,
        tone: pct > 30 ? 'warning' : 'info',
        title: `${inr(is.total_outstanding)} outstanding`,
        body: `${is.by_status?.Pending || 0} pending invoice${(is.by_status?.Pending || 0) === 1 ? '' : 's'} — ${formatPct(pct, 1)} of total raised.`,
      })
    }

    // Overdue alert
    const overdueCount = is.overdue_invoices?.length || 0
    if (overdueCount > 0) {
      const overdueAmount = is.overdue_invoices.reduce((s, i) => s + Number(i.amount || 0), 0)
      out.push({
        icon: AlertTriangle,
        tone: 'negative',
        title: `${overdueCount} overdue invoice${overdueCount === 1 ? '' : 's'}`,
        body: `${inr(overdueAmount)} pending more than 30 days — needs follow-up.`,
      })
    }

    // Collection rate
    if (is.collection_rate != null && is.total_raised > 0) {
      const rate = is.collection_rate
      out.push({
        icon: CheckCircle2,
        tone: rate >= 90 ? 'positive' : rate >= 70 ? 'info' : 'warning',
        title: `${formatPct(rate, 1)} collection rate`,
        body: `${inr(is.total_received)} collected of ${inr(is.total_raised)} raised this period.`,
      })
    }

    return out.slice(0, 4)
  }, [ps, is, projMatrix])

  /* ── KPIs ── */
  const margin = ps && ps.total_billed > 0 ? (ps.total_profit / ps.total_billed) * 100 : 0
  const collectedThisMonth = useMemo(() => {
    const thisMonth = monthKey(new Date().toISOString())
    return cashflow.find(c => c.key === thisMonth)?.collected || 0
  }, [cashflow])
  const collectedLastMonth = useMemo(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    const lastMonth = monthKey(d.toISOString())
    return cashflow.find(c => c.key === lastMonth)?.collected || 0
  }, [cashflow])
  const monthDelta = collectedLastMonth > 0
    ? ((collectedThisMonth - collectedLastMonth) / collectedLastMonth) * 100
    : null

  if (loading && !data) return (
    <div className="flex items-center justify-center h-full p-12">
      <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--text-3)' }} />
    </div>
  )

  return (
    <div className="p-4 sm:p-6 space-y-5 animate-fade-in">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
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
        <button onClick={refresh} disabled={loading} aria-label="Refresh" className="btn-icon">
          <RefreshCw size={14} className={clsx(loading && 'animate-spin')} />
        </button>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
          style={{ background: 'var(--fin-neg-bg)', border: '1px solid var(--fin-neg-border)', color: 'var(--fin-negative)' }}>
          <AlertCircle size={15} /> {error}
          <button onClick={refresh} className="underline ml-1">retry</button>
        </div>
      )}

      {/* ── KPI strip ── */}
      <section aria-label="Key analytics" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard tone={0} icon={IndianRupee}
          label="Total Revenue (billed)"
          value={inr(ps?.total_billed)}
          sub={`Across ${ps?.total_projects || 0} projects`} />
        <KpiCard tone={1} icon={TrendingUp}
          label="Net Profit"
          value={inr(ps?.total_profit)}
          accent={(ps?.total_profit ?? 0) >= 0 ? 'positive' : 'negative'}
          trend={margin}
          sub={`${formatPct(margin, 2)} margin`} />
        <KpiCard tone={2} icon={Wallet}
          label="Outstanding"
          value={inr(is?.total_outstanding)}
          accent={(is?.total_outstanding ?? 0) > 0 ? 'warning' : 'positive'}
          sub={`${is?.by_status?.Pending || 0} pending invoices`} />
        <KpiCard tone={3} icon={Receipt}
          label="Collection Rate"
          value={is ? `${(is.collection_rate ?? 0).toFixed(1)}%` : '—'}
          accent={(is?.collection_rate || 0) >= 90 ? 'positive' : (is?.collection_rate || 0) >= 70 ? 'warning' : 'negative'}
          sub={`${inr(is?.total_received)} collected`} />
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
        sub="Monthly invoice raised vs collected (last 12 months)"
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
          <div className="text-center py-10 text-sm" style={{ color: 'var(--text-3)' }}>
            No invoice data yet
          </div>
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

      {/* ── Two-column row: aging buckets + status breakdown ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Aging buckets */}
        <ChartCard title="Receivables Aging" sub="Pending invoice value by age">
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
                  range === '31-60' ? 'var(--fin-warning)' :
                  'var(--fin-negative)'
                return (
                  <div key={range}>
                    <div className="flex items-baseline justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                        <span className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>{range} days</span>
                        <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>· {count} invoice{count === 1 ? '' : 's'}</span>
                      </div>
                      <span className="font-bold tabular-nums text-sm" style={{ color }}>
                        {inr(amount)}
                      </span>
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

        {/* Status breakdown by amount */}
        <ChartCard title="Invoice Status" sub="By total amount raised">
          {statusBreakdown.length === 0 ? (
            <div className="text-center py-10 text-sm" style={{ color: 'var(--text-3)' }}>
              No invoices yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={statusBreakdown} cx="50%" cy="50%" innerRadius={50} outerRadius={80}
                  dataKey="amount" nameKey="name" paddingAngle={2}>
                  {statusBreakdown.map((entry) => {
                    const c =
                      entry.name === 'Paid'      ? '#16a34a' :
                      entry.name === 'Pending'   ? '#d97706' :
                      entry.name === 'Cancelled' ? '#dc2626' : '#9ca3af'
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
      </div>

      {/* ── Project profitability matrix ── */}
      <ChartCard title="Project Profitability" sub="Revenue, cost, profit & invoiced amounts">
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
