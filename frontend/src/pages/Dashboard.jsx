import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TrendingUp, IndianRupee, FolderKanban, Target, Activity, Plus } from 'lucide-react'
import StatCard from '../components/StatCard'
import ProjectCard from '../components/ProjectCard'
import { api } from '../services/api'

export default function Dashboard() {
  const [summary, setSummary] = useState(null)
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    Promise.all([api.projects.summary(), api.projects.list({ limit: 6, order_by: 'Amount Billed So far' })])
      .then(([s, r]) => { setSummary(s); setRecent(r.records || []) })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-0.5">Financial overview of all projects</p>
        </div>
        <button onClick={() => navigate('/projects/new')} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> New Project
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Projects" value={summary?.total_projects ?? '—'} icon={FolderKanban} color="blue" />
        <StatCard label="Total Billed" value={fmt(summary?.total_billed)} icon={IndianRupee} color="green" />
        <StatCard label="Total Profit" value={fmt(summary?.total_profit)} icon={TrendingUp} color="purple" trend={summary?.avg_profit_pct} />
        <StatCard label="Targets Hit" value={`${summary?.target_achieved_count ?? 0}/${summary?.total_projects ?? 0}`} icon={Target} color="yellow" />
      </div>

      {/* Status breakdown */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {summary?.by_status && Object.entries(summary.by_status).map(([status, count]) => (
          <div key={status} className="card text-center cursor-pointer hover:border-brand-500/40 transition-colors"
            onClick={() => navigate(`/projects?status=${encodeURIComponent(status)}`)}>
            <p className="text-2xl font-bold text-white">{count}</p>
            <p className="text-xs text-gray-500 mt-1 truncate">{status}</p>
          </div>
        ))}
      </div>

      {/* Client breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="font-semibold text-white mb-3 flex items-center gap-2"><Activity size={16} className="text-brand-400" /> By Client</h2>
          <div className="space-y-3">
            {summary?.by_client && Object.entries(summary.by_client).map(([client, count]) => {
              const pct = Math.round((count / summary.total_projects) * 100)
              return (
                <div key={client}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-300">{client}</span>
                    <span className="text-gray-500">{count} project{count > 1 ? 's' : ''}</span>
                  </div>
                  <div className="h-1.5 bg-surface-700 rounded-full overflow-hidden">
                    <div className="h-full bg-brand-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="card">
          <h2 className="font-semibold text-white mb-3">By Health</h2>
          <div className="space-y-2">
            {summary?.by_health && Object.entries(summary.by_health).map(([h, c]) => (
              <div key={h} className="flex items-center justify-between py-1.5 border-b border-surface-700 last:border-0">
                <span className="text-sm text-gray-300">{h}</span>
                <span className="text-sm font-semibold text-white">{c}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent projects */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-white">Top Projects by Billing</h2>
          <button onClick={() => navigate('/projects')} className="text-xs text-brand-400 hover:text-brand-300">View all →</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {recent.map((r) => <ProjectCard key={r.id} record={r} />)}
        </div>
      </div>
    </div>
  )
}
