import { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts'
import { api } from '../services/api'

const COLORS = ['#22c55e', '#3b82f6', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4']

const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

export default function Analytics() {
  const [summary, setSummary] = useState(null)
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.projects.summary(), api.projects.list({ limit: 100 })])
      .then(([s, r]) => { setSummary(s); setRecords(r.records || []) })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

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

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Analytics</h1>
        <p className="text-gray-500 text-sm mt-0.5">Visual breakdown of your portfolio</p>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Billed', value: fmt(summary?.total_billed) },
          { label: 'Total Profit', value: fmt(summary?.total_profit) },
          { label: 'Avg Profit %', value: `${Number(summary?.avg_profit_pct || 0).toFixed(1)}%` },
        ].map(({ label, value }) => (
          <div key={label} className="card text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
            <p className="text-xl font-bold text-white mt-1">{value}</p>
          </div>
        ))}
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card">
          <h2 className="font-semibold text-white mb-4">Billing vs Profit % by Project</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={profitData} margin={{ top: 0, right: 10, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3250" />
              <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 10 }} angle={-30} textAnchor="end" />
              <YAxis yAxisId="left" tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={(v) => `₹${(v/1000).toFixed(0)}k`} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                contentStyle={{ background: '#1a1d27', border: '1px solid #2d3250', borderRadius: 8 }}
                labelStyle={{ color: '#fff' }}
                formatter={(v, name) => name === 'profit' ? [`${Number(v).toFixed(1)}%`, 'Profit %'] : [fmt(v), 'Billed']}
              />
              <Bar yAxisId="left" dataKey="billed" fill="#22c55e" radius={[4, 4, 0, 0]} name="billed" />
              <Bar yAxisId="right" dataKey="profit" fill="#3b82f6" radius={[4, 4, 0, 0]} name="profit" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h2 className="font-semibold text-white mb-4">Projects by Status</h2>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={statusData} cx="50%" cy="50%" innerRadius={55} outerRadius={90}
                dataKey="value" nameKey="name" paddingAngle={3}>
                {statusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: '#1a1d27', border: '1px solid #2d3250', borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card">
          <h2 className="font-semibold text-white mb-4">Projects by Client</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={clientData} layout="vertical" margin={{ left: 10, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3250" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fill: '#9ca3af', fontSize: 12 }} width={110} />
              <Tooltip contentStyle={{ background: '#1a1d27', border: '1px solid #2d3250', borderRadius: 8 }} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {clientData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h2 className="font-semibold text-white mb-4">All Projects Table</h2>
          <div className="overflow-auto max-h-48">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-surface-700">
                  <th className="text-left pb-2 font-medium">Project</th>
                  <th className="text-right pb-2 font-medium">Billed</th>
                  <th className="text-right pb-2 font-medium">Profit%</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const f = r.fields || {}
                  return (
                    <tr key={r.id} className="border-b border-surface-700/50 hover:bg-surface-700/30">
                      <td className="py-1.5 text-gray-300">{f['Client']?.split(' ')[0]} / {f['Project Name']}</td>
                      <td className="py-1.5 text-right text-gray-300">{fmt(f['Amount Billed So far'])}</td>
                      <td className={`py-1.5 text-right font-medium ${parseFloat(f['Profit percentage'] || 0) >= 0 ? 'text-brand-400' : 'text-red-400'}`}>
                        {Number(f['Profit percentage'] || 0).toFixed(1)}%
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
