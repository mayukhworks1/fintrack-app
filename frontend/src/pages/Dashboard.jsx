import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  TrendingUp, TrendingDown, IndianRupee, FolderKanban,
  Target, AlertTriangle, Award, RefreshCw, Plus,
  ArrowRight, Flame, ShieldAlert, Activity
} from 'lucide-react'
import ProjectCard from '../components/ProjectCard'
import { api } from '../services/api'
import { useAutoRefresh, useRelativeTime } from '../hooks/useAutoRefresh'
import { formatInr as inr, formatPct } from '../utils/format'
import clsx from 'clsx'

/* Count projects whose health does NOT contain 🔴 */
const countHealthy = (byHealth = {}) =>
  Object.entries(byHealth).reduce((sum, [k, v]) => sum + (k.includes('🔴') ? 0 : v), 0)

function SyncDot({ syncing }) {
  return (
    <span className={clsx('w-1.5 h-1.5 rounded-full inline-block', syncing && 'animate-pulse')}
      style={{ background: syncing ? '#facc15' : '#22c55e' }} aria-hidden="true" />
  )
}

function SkeletonCard() {
  return (
    <div className="card space-y-3 animate-pulse" aria-hidden="true">
      <div className="h-3 rounded w-2/3" style={{ background: 'var(--bg-input)' }} />
      <div className="h-8 rounded w-3/4" style={{ background: 'var(--bg-input)' }} />
      <div className="h-3 rounded w-1/2" style={{ background: 'var(--bg-input)' }} />
    </div>
  )
}

/* ── KPI card — neutral palette, exact digits, mobile-readable ── */
function KpiCard({ label, value, sub, icon: Icon, accent, trend }) {
  // Neutral by default. `accent` is only used for semantic cues (positive/negative).
  const accentColor =
    accent === 'positive' ? '#22c55e'
    : accent === 'warning' ? '#fbbf24'
    : accent === 'negative' ? '#f87171'
    : 'var(--text-2)'
  return (
    <div className="card p-3 sm:p-5">
      <div className="flex items-center justify-between mb-2 sm:mb-3">
        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
          <Icon size={14} style={{ color: 'var(--text-2)' }} aria-hidden="true" />
        </div>
        {trend != null && Number.isFinite(trend) && (
          <span className="text-[10px] sm:text-xs font-semibold flex items-center gap-0.5 tabular-nums"
            style={{ color: trend >= 0 ? '#22c55e' : '#f87171' }}>
            {trend >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
            {formatPct(Math.abs(trend), 2)}
          </span>
        )}
      </div>
      <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider mb-1"
        style={{ color: 'var(--text-3)' }}>
        {label}
      </p>
      {/* Exact digits — break-word so long numbers wrap cleanly on mobile */}
      <p className="font-semibold tabular-nums leading-tight break-words"
        style={{
          fontSize: 'clamp(1.0625rem, 3.6vw, 1.5rem)',
          color: accentColor === 'var(--text-2)' ? 'var(--text-1)' : accentColor,
          wordBreak: 'break-word',
        }}>
        {value}
      </p>
      {sub && (
        <p className="text-[10px] sm:text-xs mt-1" style={{ color: 'var(--text-3)' }}>{sub}</p>
      )}
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
        style={{ color: isNeg ? '#f87171' : '#fbbf24' }}>
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
          <span className="font-bold tabular-nums" style={{ color: margin >= 0 ? '#22c55e' : '#f87171' }}>
            {formatPct(margin, 2)} margin
          </span>
        </div>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#22c55e88,#22c55e)' }} />
      </div>
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

  const s      = data?.summary
  const recent = data?.records || []

  const margin    = s?.total_billed > 0 ? (s.total_profit / s.total_billed) * 100 : 0
  const costRatio = s?.total_billed > 0 ? (s.total_cost   / s.total_billed) * 100 : 0
  const maxBilled = s ? Math.max(...Object.values(s.client_billed || {}).map(Number), 1) : 1
  const atRisk    = s?.at_risk || []
  const healthOk  = countHealthy(s?.by_health)

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--text-1)' }}>Dashboard</h1>
          <p className="text-sm mt-0.5 flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
            Portfolio overview
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
        <div className="flex gap-2 flex-shrink-0">
          <button onClick={refresh} disabled={loading} aria-label="Refresh"
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-all"
            style={{ color: 'var(--text-2)', border: '1px solid var(--border)', background: 'transparent' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <RefreshCw size={15} className={clsx(loading && 'animate-spin')} />
          </button>
          <button onClick={() => navigate('/projects/new')}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)', color: '#fff', boxShadow: '0 4px 12px rgba(34,197,94,0.3)' }}>
            <Plus size={15} aria-hidden="true" />
            <span className="hidden sm:inline">New Project</span>
            <span className="sm:hidden">New</span>
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div role="alert" className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>
          <AlertTriangle size={15} aria-hidden="true" /> {error} —
          <button onClick={refresh} className="underline">retry</button>
        </div>
      )}

      {/* ── KPI row — 2 cols mobile → 3 cols tablet → 6 cols desktop ── */}
      <section aria-label="Key metrics">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
          {loading && !data
            ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
            : <>
                <KpiCard
                  label="Total Revenue"
                  value={inr(s?.total_billed)}
                  icon={IndianRupee}
                />
                <KpiCard
                  label="Net Profit"
                  value={inr(s?.total_profit)}
                  icon={TrendingUp}
                  accent={(s?.total_profit ?? 0) >= 0 ? 'positive' : 'negative'}
                  trend={s?.avg_profit_pct}
                />
                <KpiCard
                  label="Total Cost"
                  value={inr(s?.total_cost)}
                  icon={Activity}
                  sub={s?.total_cost > 0 ? `${formatPct(costRatio, 1)} of revenue` : undefined}
                />
                <KpiCard
                  label="Profit Margin"
                  value={formatPct(margin, 2)}
                  icon={Flame}
                  accent={margin >= 20 ? 'positive' : margin >= 0 ? 'warning' : 'negative'}
                />
                <KpiCard
                  label="Targets Hit"
                  value={`${s?.target_achieved_count ?? 0} / ${s?.total_projects ?? 0}`}
                  icon={Target}
                />
                <KpiCard
                  label="Projects"
                  value={s?.total_projects ?? '—'}
                  icon={FolderKanban}
                  sub={`${healthOk} healthy`}
                />
              </>
          }
        </div>
      </section>

      {/* ── Middle row ── */}
      <section aria-label="Portfolio breakdown" className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Client revenue */}
        <div className="card">
          <h2 className="text-xs font-bold uppercase tracking-wider mb-4 flex items-center gap-2"
            style={{ color: 'var(--text-3)' }}>
            <IndianRupee size={13} style={{ color: '#22c55e' }} aria-hidden="true" /> Revenue by Client
          </h2>
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

        {/* Needs attention */}
        <div className="card">
          <h2 className="text-xs font-bold uppercase tracking-wider mb-1 flex items-center gap-2"
            style={{ color: 'var(--text-3)' }}>
            <ShieldAlert size={13} style={{ color: '#f87171' }} aria-hidden="true" /> Needs Attention
          </h2>
          <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>Negative profit or critical health</p>
          {loading && !data ? <SkeletonCard /> :
            atRisk.length === 0
              ? <div className="flex flex-col items-center py-6 text-center">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center mb-2"
                    style={{ background: 'rgba(34,197,94,0.1)' }}>
                    <Award size={18} style={{ color: '#22c55e' }} aria-hidden="true" />
                  </div>
                  <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>All projects healthy</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>No critical issues found</p>
                </div>
              : <div>{atRisk.map((p, i) => <RiskRow key={i} project={p} />)}</div>
          }
        </div>

        {/* Best & worst */}
        <div className="card flex flex-col gap-4">
          {/* Top performer */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-2"
              style={{ color: 'var(--text-3)' }}>
              <Award size={13} style={{ color: '#22c55e' }} aria-hidden="true" /> Top Performer
            </p>
            {loading && !data ? <SkeletonCard /> :
              s?.best_project?.name
                ? <div className="rounded-xl p-3"
                    style={{ background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.18)' }}>
                    <p className="text-sm font-semibold leading-snug" style={{ color: 'var(--text-1)' }}>
                      {s.best_project.name}
                    </p>
                    <p className="text-2xl font-bold mt-1 tabular-nums" style={{ color: '#22c55e' }}>
                      {s.best_project.pct >= 0 ? '+' : ''}{formatPct(s.best_project.pct, 2)}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>profit margin</p>
                  </div>
                : <p className="text-sm" style={{ color: 'var(--text-3)' }}>No data</p>
            }
          </div>

          {/* Lowest margin */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-2"
              style={{ color: 'var(--text-3)' }}>
              <TrendingDown size={13} style={{ color: '#f87171' }} aria-hidden="true" /> Lowest Margin
            </p>
            {loading && !data ? <SkeletonCard /> :
              s?.worst_project?.name
                ? <div className="rounded-xl p-3"
                    style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)' }}>
                    <p className="text-sm font-semibold leading-snug" style={{ color: 'var(--text-1)' }}>
                      {s.worst_project.name}
                    </p>
                    <p className="text-2xl font-bold mt-1 tabular-nums"
                      style={{ color: s.worst_project.pct < 0 ? '#f87171' : '#fbbf24' }}>
                      {s.worst_project.pct > 0 ? '+' : ''}{formatPct(s.worst_project.pct, 2)}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>profit margin</p>
                  </div>
                : <p className="text-sm" style={{ color: 'var(--text-3)' }}>No data</p>
            }
          </div>
        </div>
      </section>

      {/* ── Status chips ── */}
      {s?.by_status && Object.keys(s.by_status).length > 0 && (
        <section aria-label="Projects by status">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(s.by_status).map(([status, count]) => {
              const accent = status.includes('Active')    ? '#22c55e'
                           : status.includes('Completed') ? '#60a5fa'
                           : status.includes('Hold')      ? '#fbbf24'
                           : '#f87171'
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
      <section aria-label="Top projects by billing">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
            Top Projects by Revenue
          </h2>
          <button onClick={() => navigate('/projects')}
            className="text-xs font-semibold flex items-center gap-1 transition-opacity hover:opacity-70"
            style={{ color: '#22c55e' }}>
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
                  className="underline hover:no-underline" style={{ color: '#22c55e' }}>
                  Create one
                </button>
              </div>
        }
      </section>
    </div>
  )
}
