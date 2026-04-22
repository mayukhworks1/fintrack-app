import { useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, ComposedChart, Line, Area
} from 'recharts'
import { RefreshCw, AlertCircle, TrendingUp, IndianRupee, BarChart3, Target } from 'lucide-react'
import { api } from '../services/api'
import { useAutoRefresh, useRelativeTime } from '../hooks/useAutoRefresh'
import clsx from 'clsx'

const PALETTE = ['#22c55e', '#3b82f6', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4']

const inr = (n) => {
  const v = Number(n || 0)
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(1)}Cr`
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`
  return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

function SyncDot({ syncing }) {
  return (
    <span className={clsx('w-1.5 h-1.5 rounded-full inline-block', syncing && 'animate-pulse')}
      style={{ background: syncing ? '#facc15' : '#22c55e' }} aria-hidden="true" />
  )
}

function ChartCard({ title, sub, children }) {
  return (
    <div className="card">
      <div className="mb-4">
        <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{title}</h2>
        {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{sub}</p>}
      </div>
      {children}
    </div>
  )
}

export default function Analytics() {
  const fetchAll = useCallback(() =>
    Promise.all([api.projects.summary(), api.projects.list({ limit: 100 })])
      .then(([summary, list]) => ({ summary, records: list.records || [] }))
  , [])

  const { data, loading, error, refresh, lastUpdated, syncing } = useAutoRefresh(fetchAll, 5_000)
  const updatedLabel = useRelativeTime(lastUpdated)
  const s = data?.summary
  const records = data?.records || []

  const tooltipStyle = {
    contentStyle: { background: 'var(--bg-card,#1a1d27)', border: '1px solid var(--border,#2d3250)', borderRadius: 10, fontSize: 12 },
    labelStyle:   { color: 'var(--text-1,#fff)', fontWeight: 600 },
    itemStyle:    { color: 'var(--text-2,#9ca3af)' },
  }

  // Revenue vs Cost vs Profit per project
  const revenueData = records
    .filter(r => r.fields?.['Amount Billed So far'] != null)
    .map(r => {
      const f = r.fields
      const billed   = parseFloat(f['Amount Billed So far'] || 0)
      const cost     = parseFloat(f['Input cost so far'] || 0) + parseFloat(f['Total Overhead Cost'] || 0)
      const profit   = parseFloat(f['Actual Profit'] || 0)
      const profitPct = parseFloat(f['Profit percentage'] || 0)
      return {
        name: `${f['Client']?.split(' ')[0]}/${f['Project Name']}`,
        revenue: billed,
        cost,
        profit,
        margin: profitPct,
      }
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8)

  // Profitability scatter data — each project as a dot
  const profitData = records
    .filter(r => r.fields?.['Profit percentage'] != null)
    .map(r => ({
      name:   `${r.fields['Client']?.split(' ')[0]} / ${r.fields['Project Name']}`,
      profit: parseFloat(r.fields['Profit percentage'] || 0),
      billed: parseFloat(r.fields['Amount Billed So far'] || 0),
    }))
    .sort((a, b) => b.profit - a.profit)

  const statusData = Object.entries(s?.by_status || {}).map(([name, value]) => ({ name, value }))
  const clientData = Object.entries(s?.client_billed || {}).map(([name, value]) => ({
    name,
    revenue: value,
    profit:  s?.client_profit?.[name] || 0,
  }))
  const healthData = Object.entries(s?.by_health || {}).map(([name, value]) => ({ name, value }))

  const healthColor = (name) => {
    if (name?.includes('🟢')) return '#22c55e'
    if (name?.includes('🟡')) return '#f59e0b'
    if (name?.includes('🔴')) return '#ef4444'
    return '#6b7280'
  }

  const margin = s && s.total_billed > 0 ? (s.total_profit / s.total_billed) * 100 : 0

  if (loading && !data) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: 'rgba(34,197,94,0.5)', borderTopColor: 'transparent' }} />
    </div>
  )

  return (
    <div className="p-4 sm:p-6 space-y-5 animate-fade-in">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--text-1)' }}>Analytics</h1>
          <p className="text-sm mt-0.5 flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
            Visual portfolio breakdown
            {lastUpdated && (
              <span className="flex items-center gap-1.5">
                · <SyncDot syncing={syncing} />
                <span style={{ color: syncing ? '#facc15' : 'var(--text-3)' }}>
                  {syncing ? 'syncing…' : `live · ${updatedLabel}`}
                </span>
              </span>
            )}
          </p>
        </div>
        <button onClick={refresh} disabled={loading} aria-label="Refresh"
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-all"
          style={{ color: 'var(--text-2)', border: '1px solid var(--border)', background: 'transparent' }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
          <RefreshCw size={15} className={clsx(loading && 'animate-spin')} />
        </button>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>
          <AlertCircle size={15} /> {error}
          <button onClick={refresh} className="underline ml-1">retry</button>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Revenue', value: inr(s?.total_billed),  color: '#22c55e', icon: IndianRupee },
          { label: 'Net Profit',    value: inr(s?.total_profit),   color: '#60a5fa', icon: TrendingUp  },
          { label: 'Total Cost',    value: inr(s?.total_cost),     color: '#c084fc', icon: BarChart3   },
          { label: 'Overall Margin',value: `${margin.toFixed(1)}%`, color: margin >= 20 ? '#22c55e' : margin >= 0 ? '#f59e0b' : '#f87171', icon: Target },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="card text-center">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center mx-auto mb-2"
              style={{ background: `${color}18` }}>
              <Icon size={15} style={{ color }} aria-hidden="true" />
            </div>
            <p className="text-xs uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-3)' }}>{label}</p>
            <p className="text-lg font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Revenue vs Cost vs Profit by project */}
      <ChartCard title="Revenue · Cost · Profit by Project" sub="All amounts in ₹">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={revenueData} margin={{ top: 0, right: 8, left: 0, bottom: 55 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: 'var(--text-3)', fontSize: 9 }} angle={-35} textAnchor="end" />
            <YAxis tick={{ fill: 'var(--text-3)', fontSize: 10 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
            <Tooltip {...tooltipStyle} formatter={(v, name) => [inr(v), name.charAt(0).toUpperCase() + name.slice(1)]} />
            <Bar dataKey="revenue" fill="#22c55e" radius={[3,3,0,0]} name="revenue" />
            <Bar dataKey="cost"    fill="#6366f1" radius={[3,3,0,0]} name="cost" />
            <Bar dataKey="profit"  fill="#f59e0b" radius={[3,3,0,0]} name="profit" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Client revenue vs profit */}
        <ChartCard title="Client Revenue vs Profit">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={clientData} margin={{ left: 0, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: 'var(--text-3)', fontSize: 11 }} />
              <YAxis tick={{ fill: 'var(--text-3)', fontSize: 10 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
              <Tooltip {...tooltipStyle} formatter={(v, name) => [inr(v), name.charAt(0).toUpperCase() + name.slice(1)]} />
              <Bar dataKey="revenue" fill="#22c55e" radius={[3,3,0,0]} name="revenue" />
              <Bar dataKey="profit"  fill="#3b82f6" radius={[3,3,0,0]} name="profit" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Projects by status */}
        <ChartCard title="Projects by Status">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={statusData} cx="50%" cy="44%" innerRadius={50} outerRadius={85}
                dataKey="value" nameKey="name" paddingAngle={3}
                label={({ percent }) => `${Math.round(percent * 100)}%`} labelLine={false}>
                {statusData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
              </Pie>
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-3)' }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Row 3: Profit % ranking + Health */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Profit % bar ranking */}
        <ChartCard title="Profit Margin Ranking" sub="Sorted best to worst">
          <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
            {profitData.map((p, i) => {
              const isNeg = p.profit < 0
              const pct   = Math.abs(p.profit)
              const barPct = Math.min((pct / 60) * 100, 100)
              return (
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="truncate max-w-[60%]" style={{ color: 'var(--text-2)' }}>{p.name}</span>
                    <span className="font-bold tabular-nums ml-2" style={{ color: isNeg ? '#f87171' : '#22c55e' }}>
                      {isNeg ? '' : '+'}{p.profit.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
                    <div className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${barPct}%`, background: isNeg ? '#ef4444' : '#22c55e' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </ChartCard>

        {/* Health distribution */}
        <ChartCard title="Portfolio Health" sub="Based on Teable computed Health field">
          <div className="space-y-3">
            {healthData.map(({ name, value }) => {
              const total = healthData.reduce((s, h) => s + h.value, 0)
              const pct   = total > 0 ? (value / total) * 100 : 0
              const color = healthColor(name)
              return (
                <div key={name}>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span style={{ color: 'var(--text-2)' }}>{name || 'Unknown'}</span>
                    <span className="font-semibold tabular-nums" style={{ color }}>
                      {value} <span className="font-normal text-xs" style={{ color: 'var(--text-3)' }}>({pct.toFixed(0)}%)</span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
                    <div className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${pct}%`, background: color }} />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Summary table */}
          <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
            <table className="w-full text-xs" aria-label="Project financial summary">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Project', 'Billed', 'Profit %'].map(h => (
                    <th key={h} className="text-left pb-2 font-semibold" style={{ color: 'var(--text-3)' }} scope="col">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map(r => {
                  const f = r.fields || {}
                  const p = parseFloat(f['Profit percentage'] || 0)
                  return (
                    <tr key={r.id} className="transition-colors" style={{ borderBottom: '1px solid var(--border)' }}>
                      <td className="py-1.5 truncate max-w-[120px]" style={{ color: 'var(--text-2)' }}>
                        {f['Client']?.split(' ')[0]}/{f['Project Name']}
                      </td>
                      <td className="py-1.5 tabular-nums" style={{ color: 'var(--text-2)' }}>{inr(f['Amount Billed So far'])}</td>
                      <td className="py-1.5 font-semibold tabular-nums" style={{ color: p >= 0 ? '#22c55e' : '#f87171' }}>
                        {p > 0 ? '+' : ''}{p.toFixed(1)}%
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </ChartCard>
      </div>
    </div>
  )
}
