import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { TrendingUp, IndianRupee, FolderKanban, Target, Activity, Plus, RefreshCw, AlertCircle } from 'lucide-react'
import StatCard from '../components/StatCard'
import ProjectCard from '../components/ProjectCard'
import { api } from '../services/api'
import { useAutoRefresh, useRelativeTime } from '../hooks/useAutoRefresh'
import clsx from 'clsx'

function SkeletonCard() {
  return (
    <div className="card space-y-3" aria-hidden="true">
      <div className="skeleton h-4 w-3/4" />
      <div className="skeleton h-8 w-1/2" />
      <div className="skeleton h-3 w-1/3" />
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()

  const fetchAll = useCallback(() =>
    Promise.all([
      api.projects.summary(),
      api.projects.list({ limit: 6, order_by: 'Amount Billed So far' }),
    ]).then(([summary, list]) => ({ summary, records: list.records || [] }))
  , [])

  const { data, loading, error, refresh, lastUpdated, syncing } = useAutoRefresh(fetchAll, 5_000)
  const updatedLabel = useRelativeTime(lastUpdated)

  const summary = data?.summary
  const recent  = data?.records || []

  const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-0.5 flex items-center gap-2">
            Financial overview
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
        <div className="flex gap-2">
          <button
            onClick={refresh}
            disabled={loading}
            aria-label="Refresh data"
            className="btn-icon"
          >
            <RefreshCw size={16} className={clsx(loading && 'animate-spin')} />
          </button>
          <button
            onClick={() => navigate('/projects/new')}
            className="btn-primary flex items-center gap-2"
            aria-label="Create new project"
          >
            <Plus size={16} aria-hidden="true" /> New Project
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div role="alert" className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          <AlertCircle size={16} aria-hidden="true" />
          {error} — <button onClick={refresh} className="underline hover:no-underline">retry</button>
        </div>
      )}

      {/* Stats */}
      <section aria-label="Summary statistics">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {loading && !data ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          ) : (
            <>
              <StatCard label="Total Projects"  value={summary?.total_projects ?? '—'} icon={FolderKanban} color="blue" />
              <StatCard label="Total Billed"    value={fmt(summary?.total_billed)}      icon={IndianRupee}  color="green" />
              <StatCard label="Total Profit"    value={fmt(summary?.total_profit)}      icon={TrendingUp}   color="purple" trend={summary?.avg_profit_pct} />
              <StatCard label="Targets Hit"     value={`${summary?.target_achieved_count ?? 0}/${summary?.total_projects ?? 0}`} icon={Target} color="yellow" />
            </>
          )}
        </div>
      </section>

      {/* Status breakdown */}
      {summary?.by_status && (
        <section aria-label="Projects by status">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Object.entries(summary.by_status).map(([status, count]) => (
              <button
                key={status}
                onClick={() => navigate(`/projects?status=${encodeURIComponent(status)}`)}
                className="card text-center hover:border-brand-500/40 transition-colors focus-visible:ring-2 focus-visible:ring-brand-400 rounded-xl"
                aria-label={`${count} ${status} projects`}
              >
                <p className="text-2xl font-bold text-white">{count}</p>
                <p className="text-xs text-gray-500 mt-1 truncate">{status}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Client & Health */}
      {summary && (
        <section aria-label="Breakdown by client and health" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card">
            <h2 className="section-title mb-4 flex items-center gap-2">
              <Activity size={16} className="text-brand-400" aria-hidden="true" /> By Client
            </h2>
            <div className="space-y-3" role="list">
              {Object.entries(summary.by_client || {}).map(([client, count]) => {
                const pct = Math.round((count / summary.total_projects) * 100)
                return (
                  <div key={client} role="listitem">
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="text-gray-300">{client}</span>
                      <span className="text-gray-500">{count} project{count > 1 ? 's' : ''}</span>
                    </div>
                    <div className="h-1.5 bg-surface-700 rounded-full overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${client}: ${pct}%`}>
                      <div className="h-full bg-brand-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="card">
            <h2 className="section-title mb-4">By Health</h2>
            <div className="space-y-2" role="list">
              {Object.entries(summary.by_health || {}).map(([h, c]) => (
                <div key={h} role="listitem" className="flex items-center justify-between py-2 border-b border-surface-700 last:border-0">
                  <span className="text-sm text-gray-300">{h || 'Unknown'}</span>
                  <span className="text-sm font-semibold text-white tabular-nums">{c}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Recent projects */}
      <section aria-label="Top projects by billing">
        <div className="flex items-center justify-between mb-3">
          <h2 className="section-title">Top Projects by Billing</h2>
          <button onClick={() => navigate('/projects')} className="text-xs text-brand-400 hover:text-brand-300 transition-colors">
            View all →
          </button>
        </div>
        {loading && !data ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : recent.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {recent.map((r) => <ProjectCard key={r.id} record={r} />)}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-500">
            No projects yet. <button onClick={() => navigate('/projects/new')} className="text-brand-400 hover:text-brand-300 underline">Create one</button>
          </div>
        )}
      </section>
    </div>
  )
}
