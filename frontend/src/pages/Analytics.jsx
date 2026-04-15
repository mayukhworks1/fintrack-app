import { useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts'
import { RefreshCw, AlertCircle } from 'lucide-react'
import { api } from '../services/api'
import { useAutoRefresh, useRelativeTime } from '../hooks/useAutoRefresh'
import clsx from 'clsx'

const COLORS = ['#22c55e', '#3b82f6', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4']
const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

const tooltipStyle = {
  contentStyle: { background: '#1a1d27', border: '1px solid #2d3250', borderRadius: 10, fontSize: 12 },
  labelStyle: { color: '#fff' },
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

  if (loading && !data) return (
    <div className="flex items-center justify-center h-full" aria-label="Loading analytics">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold text-white">Analytics</h1>
          <p className="text-gray-500 text-sm mt-0.5 flex items-center gap-2">
            Visual portfolio breakdown
          {lastUpdated && (
              <span className="text-gray-600 flex items-center gap-1.5">
                ·
                <span className={clsx(
                  'w-1.5 h-1.5 rounded-full inline-block transition-colors',
                  syncing ? 'bg-yellow-400 animate-pulse' : 'bg-green-400'
                )} aria-hidden="true" />
                <span className={syncing ? 'text-yellow-500' : 'text-gray-600'}>
                  {syncing ? 'syncing…' : `live · ${updatedLabel}`}
                </span>
              </span>
            )}
          </p>
        </div>
        <button onClick={refresh} disabled={loading} aria-label="Refresh data" className="btn-icon">
          <RefreshCw size={16} className={clsx(loading && 'animate-spin')} />
        </button>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          <AlertCircle size={16} />{error}
          <button onClick={refresh} className="underline hover:no-underline">retry</button>
        </div>
      )}

      {/* KPIs */}
      <section aria-label="Key financial metrics" className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Billed',  value: fmt(summary?.total_billed) },
          { label: 'Total Profit',  value: fmt(summary?.total_profit) },
          { label: 'Avg Profit %',  value: `${Number(summary?.avg_profit_pct || 0).toFixed(1)}%` },
        ].map(({ label, value }) => (
          <div key={label} className="card text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
            <p className="text-xl font-bold text-white mt-1 tabular-nums">{value}</p>
          </div>
        ))}
      </section>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card">
          <h2 className="section-title mb-4">Billing & Profit % by Project</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={profitData} margin={{ top: 0, right: 10, left: 0, bottom: 45 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3250" />
              <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 9 }} angle={-35} textAnchor="end" />
              <YAxis yAxisId="left"  tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={(v) => `₹${(v/1000).toFixed(0)}k`} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip {...tooltipStyle} formatter={(v, name) => name === 'profit' ? [`${Number(v).toFixed(1)}%`, 'Profit %'] : [fmt(v), 'Billed']} />
              <Bar yAxisId="left"  dataKey="billed" fill="#22c55e" radius={[4,4,0,0]} name="billed" />
              <Bar yAxisId="right" dataKey="profit" fill="#3b82f6" radius={[4,4,0,0]} name="profit" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h2 className="section-title mb-4">Projects by Status</h2>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={statusData} cx="50%" cy="45%" innerRadius={55} outerRadius={90}
                dataKey="value" nameKey="name" paddingAngle={3}
                label={({ name, percent }) => `${Math.round(percent * 100)}%`}
                labelLine={false}
              >
                {statusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card">
          <h2 className="section-title mb-4">Projects by Client</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={clientData} layout="vertical" margin={{ left: 10, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3250" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} width={115} />
              <Tooltip {...tooltipStyle} formatter={(v) => [v, 'Projects']} />
              <Bar dataKey="value" radius={[0,4,4,0]}>
                {clientData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h2 className="section-title mb-4">All Projects</h2>
          <div className="overflow-auto max-h-48" role="region" aria-label="Projects table">
            <table className="w-full text-xs" aria-label="Project financial data">
              <thead>
                <tr className="text-gray-500 border-b border-surface-700">
                  <th className="text-left pb-2 font-medium" scope="col">Project</th>
                  <th className="text-right pb-2 font-medium" scope="col">Billed</th>
                  <th className="text-right pb-2 font-medium" scope="col">Profit %</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const f = r.fields || {}
                  const p = parseFloat(f['Profit percentage'] || 0)
                  return (
                    <tr key={r.id} className="border-b border-surface-700/50 hover:bg-surface-700/30 transition-colors">
                      <td className="py-1.5 text-gray-300">{f['Client']?.split(' ')[0]} / {f['Project Name']}</td>
                      <td className="py-1.5 text-right text-gray-300 tabular-nums">{fmt(f['Amount Billed So far'])}</td>
                      <td className={clsx('py-1.5 text-right font-medium tabular-nums', p >= 0 ? 'text-brand-400' : 'text-red-400')}>
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
