import { useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts'
import { RefreshCw, AlertCircle, TrendingUp, DollarSign, BarChart3 } from 'lucide-react'
import { api } from '../services/api'
import { useAutoRefresh, useRelativeTime } from '../hooks/useAutoRefresh'
import clsx from 'clsx'

const COLORS = ['#22c55e', '#3b82f6', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4']
const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

function SyncDot({ syncing }) {
  return (
    <span className={clsx('w-1.5 h-1.5 rounded-full inline-block transition-colors', syncing ? 'animate-pulse' : '')}
      style={{ background: syncing ? '#facc15' : '#4ade80' }} aria-hidden="true" />
  )
}

export default function Analytics() {
  const fetchAll = useCallback(() =>
    Promise.all([api.projects.summary(), api.projects.list({ limit: 100 })])
      .then(([summary, list]) => ({ summary, records: list.records || [] }))
  , [])

  const { data, loading, error, refresh, lastUpdated, syncing } = useAutoRefresh(fetchAll, 5_000)
  const updatedLabel = useRelativeTime(lastUpdated)

  const summary = data?.summary
  const records = data?.records || []

  const statusData = Object.entries(summary?.by_status || {}).map(([name, value]) => ({ name, value }))
  const clientData = Object.entries(summary?.by_client || {}).map(([name, value]) => ({ name, value }))
  const profitData = records
    .filter(r => r.fields?.['Profit percentage'] != null)
    .map(r => ({
      name: `${r.fields['Client']?.split(' ')[0]} / ${r.fields['Project Name']}`,
      profit: parseFloat(r.fields['Profit percentage'] || 0),
      billed: parseFloat(r.fields['Amount Billed So far'] || 0),
    }))
    .sort((a, b) => b.billed - a.billed)
    .slice(0, 8)

  const tooltipStyle = {
    contentStyle: {
      background: 'var(--bg-card, #1a1d27)',
      border: '1px solid var(--border, #2d3250)',
      borderRadius: 10,
      fontSize: 12,
      color: 'var(--text-1, #fff)',
    },
    labelStyle: { color: 'var(--text-1, #fff)' },
    itemStyle: { color: 'var(--text-2, #9ca3af)' },
  }

  if (loading && !data) return (
    <div className="flex items-center justify-center h-full" aria-label="Loading analytics">
      <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: 'rgba(34,197,94,0.5)', borderTopColor: 'transparent' }} />
    </div>
  )

  return (
    <div className="p-6 space-y-6 animate-fade-in">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-1)' }}>Analytics</h1>
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
        <button onClick={refresh} disabled={loading} aria-label="Refresh data"
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:bg-white/5"
          style={{ color: 'var(--text-2)', border: '1px solid var(--border)' }}>
          <RefreshCw size={16} className={clsx(loading && 'animate-spin')} />
        </button>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>
          <AlertCircle size={16} />{error}
          <button onClick={refresh} className="underline hover:no-underline ml-1">retry</button>
        </div>
      )}

      {/* KPI cards */}
      <section aria-label="Key financial metrics">
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total Billed',  value: fmt(summary?.total_billed),   icon: DollarSign,  color: '#4ade80' },
            { label: 'Total Profit',  value: fmt(summary?.total_profit),   icon: TrendingUp,  color: '#60a5fa' },
            { label: 'Avg Profit %',  value: `${Number(summary?.avg_profit_pct || 0).toFixed(1)}%`, icon: BarChart3, color: '#c084fc' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="card text-center">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center mx-auto mb-2"
                style={{ background: `${color}18`, boxShadow: `0 0 12px ${color}30` }}>
                <Icon size={15} style={{ color }} />
              </div>
              <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>{label}</p>
              <p className="text-xl font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>{value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card">
          <h2 className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--text-3)' }}>
            Billing & Profit % by Project
          </h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={profitData} margin={{ top: 0, right: 10, left: 0, bottom: 50 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fill: 'var(--text-3, #6b7280)', fontSize: 9 }} angle={-35} textAnchor="end" />
              <YAxis yAxisId="left"  tick={{ fill: 'var(--text-3, #6b7280)', fontSize: 10 }} tickFormatter={(v) => `₹${(v/1000).toFixed(0)}k`} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: 'var(--text-3, #6b7280)', fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip {...tooltipStyle} formatter={(v, name) => name === 'profit' ? [`${Number(v).toFixed(1)}%`, 'Profit %'] : [fmt(v), 'Billed']} />
              <Bar yAxisId="left"  dataKey="billed" fill="#22c55e" radius={[4,4,0,0]} name="billed" />
              <Bar yAxisId="right" dataKey="profit" fill="#3b82f6" radius={[4,4,0,0]} name="profit" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h2 className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--text-3)' }}>
            Projects by Status
          </h2>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={statusData} cx="50%" cy="45%" innerRadius={55} outerRadius={90}
                dataKey="value" nameKey="name" paddingAngle={3}
                label={({ name, percent }) => `${Math.round(percent * 100)}%`}
                labelLine={false}>
                {statusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-3, #9ca3af)' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card">
          <h2 className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--text-3)' }}>
            Projects by Client
          </h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={clientData} layout="vertical" margin={{ left: 10, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis type="number" tick={{ fill: 'var(--text-3, #6b7280)', fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text-2, #9ca3af)', fontSize: 11 }} width={115} />
              <Tooltip {...tooltipStyle} formatter={(v) => [v, 'Projects']} />
              <Bar dataKey="value" radius={[0,4,4,0]}>
                {clientData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h2 className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--text-3)' }}>
            All Projects
          </h2>
          <div className="overflow-auto max-h-48" role="region" aria-label="Projects table">
            <table className="w-full text-xs" aria-label="Project financial data">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th className="text-left pb-2 font-semibold" style={{ color: 'var(--text-3)' }} scope="col">Project</th>
                  <th className="text-right pb-2 font-semibold" style={{ color: 'var(--text-3)' }} scope="col">Billed</th>
                  <th className="text-right pb-2 font-semibold" style={{ color: 'var(--text-3)' }} scope="col">Profit %</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const f = r.fields || {}
                  const p = parseFloat(f['Profit percentage'] || 0)
                  return (
                    <tr key={r.id} className="transition-colors"
                      style={{ borderBottom: '1px solid var(--border)' }}>
                      <td className="py-1.5" style={{ color: 'var(--text-2)' }}>
                        {f['Client']?.split(' ')[0]} / {f['Project Name']}
                      </td>
                      <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--text-2)' }}>
                        {fmt(f['Amount Billed So far'])}
                      </td>
                      <td className="py-1.5 text-right font-semibold tabular-nums"
                        style={{ color: p >= 0 ? '#4ade80' : '#f87171' }}>
                        {p.toFixed(1)}%
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
