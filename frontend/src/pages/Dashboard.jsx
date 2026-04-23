import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  TrendingUp, TrendingDown, IndianRupee, FolderKanban,
  Target, AlertTriangle, Award, RefreshCw, Plus, Activity,
  ArrowRight, Flame, ShieldAlert
} from 'lucide-react'
import ProjectCard from '../components/ProjectCard'
import { api } from '../services/api'
import { useAutoRefresh, useRelativeTime } from '../hooks/useAutoRefresh'
import clsx from 'clsx'

/* ── helpers ── */
const inr = (n) => {
  const v = Number(n || 0)
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)}L`
  return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

function SyncDot({ syncing }) {
  return (
    <span className={clsx('w-1.5 h-1.5 rounded-full inline-block', syncing && 'animate-pulse')}
      style={{ background: syncing ? '#facc15' : '#22c55e' }} aria-hidden="true" />
  )
}

function SkeletonCard({ tall }) {
  return (
    <div className="card space-y-3 animate-pulse" aria-hidden="true">
      <div className="h-4 rounded w-1/2" style={{ background: 'var(--bg-input)' }} />
      <div className={clsx('rounded w-3/4', tall ? 'h-10' : 'h-7')} style={{ background: 'var(--bg-input)' }} />
      <div className="h-3 rounded w-2/3" style={{ background: 'var(--bg-input)' }} />
    </div>
  )
}

/* ── KPI card ── */
function KpiCard({ label, value, sub, icon: Icon, color, trend }) {
  const palette = {
    green:  { icon: '#22c55e', bg: 'rgba(34,197,94,0.1)',   glow: 'rgba(34,197,94,0.2)'  },
    blue:   { icon: '#60a5fa', bg: 'rgba(59,130,246,0.1)',  glow: 'rgba(59,130,246,0.2)' },
    purple: { icon: '#c084fc', bg: 'rgba(168,85,247,0.1)',  glow: 'rgba(168,85,247,0.2)' },
    amber:  { icon: '#fbbf24', bg: 'rgba(251,191,36,0.1)',  glow: 'rgba(251,191,36,0.2)' },
    red:    { icon: '#f87171', bg: 'rgba(239,68,68,0.1)',   glow: 'rgba(239,68,68,0.2)'  },
    teal:   { icon: '#2dd4bf', bg: 'rgba(45,212,191,0.1)',  glow: 'rgba(45,212,191,0.2)' },
  }
  const c = palette[color] || palette.green
  return (
    <div className="card flex items-start gap-3">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: c.bg, boxShadow: `0 0 16px ${c.glow}` }}>
        <Icon size={18} style={{ color: c.icon }} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-3)' }}>{label}</p>
        <p className="text-xl font-bold tabular-nums leading-tight" style={{ color: 'var(--text-1)' }}>{value}</p>
        {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{sub}</p>}
        {trend != null && (
          <p className="text-xs mt-1 font-semibold flex items-center gap-1"
            style={{ color: trend >= 0 ? '#22c55e' : '#f87171' }}>
            {trend >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
            {Math.abs(trend).toFixed(1)}% avg margin
          </p>
        )}
      </div>
    </div>
  )
}

/* ── at-risk row ── */
function RiskRow({ project }) {
  const isNeg = project.pct < 0
  return (
    <div className="flex items-center justify-between py-2.5"
      style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-1)' }}>{project.name}</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{project.status || project.health}</p>
      </div>
      <span className="text-sm font-bold tabular-nums ml-3 flex-shrink-0"
        style={{ color: isNeg ? '#f87171' : '#fbbf24' }}>
        {project.pct > 0 ? '+' : ''}{project.pct}%
      </span>
    </div>
  )
}

/* ── client bar ── */
function ClientBar({ client, billed, profit, maxBilled }) {
  const pct = maxBilled > 0 ? (billed / maxBilled) * 100 : 0
  const margin = billed > 0 ? (profit / billed) * 100 : 0
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-baseline text-sm">
        <span className="font-medium" style={{ color: 'var(--text-1)' }}>{client}</span>
        <div className="flex items-center gap-3 text-xs">
          <span style={{ color: 'var(--text-2)' }}>{inr(billed)}</span>
          <span className="font-semibold" style={{ color: margin >= 0 ? '#22c55e' : '#f87171' }}>
            {margin.toFixed(1)}% margin
          </span>
        </div>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #22c55e88, #22c55e)' }} />
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

  const s       = data?.summary
  const recent  = data?.records || []

  // derived
  const margin     = s && s.total_billed > 0 ? (s.total_profit / s.total_billed) * 100 : 0
  const costRatio  = s && s.total_billed > 0 ? (s.total_cost   / s.total_billed) * 100 : 0
  const maxBilled  = s ? Math.max(...Object.values(s.client_billed || {}).map(Number), 1) : 1
  const atRisk     = s?.at_risk || []
  const healthOk   = s ? Object.entries(s.by_health || {}).reduce(
    (sum, [h, n]) => (h.includes('🟢') || h.includes('🟡') ? sum + n : sum), 0
  ) : 0

  return (
    <div className="p-6 space-y-6 animate-fade-in">

      {/* ── Page header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-1)' }}>Dashboard</h1>
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
        <div className="flex gap-2">
          <button onClick={refresh} disabled={loading} aria-label="Refresh"
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-all"
            style={{ color: 'var(--text-2)', border: '1px solid var(--border)', background: 'transparent' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <RefreshCw size={16} className={clsx(loading && 'animate-spin')} />
          </button>
          <button onClick={() => navigate('/projects/new')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)', color: '#fff', boxShadow: '0 4px 12px rgba(34,197,94,0.3)' }}>
            <Plus size={15} /> New Project
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>
          <AlertTriangle size={15} /> {error} —
          <button onClick={refresh} className="underline">retry</button>
        </div>
      )}

      {/* ── KPI row ── */}
      <section aria-label="Key metrics">
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {loading && !data
            ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
            : <>
                <KpiCard label="Total Revenue"   value={inr(s?.total_billed)}  icon={IndianRupee}  color="green"  />
                <KpiCard label="Net Profit"       value={inr(s?.total_profit)}  icon={TrendingUp}   color="blue"   trend={s?.avg_profit_pct} />
                <KpiCard label="Total Cost"       value={inr(s?.total_cost)}    icon={Activity}     color="purple"
                  sub={s?.total_cost > 0 ? `${costRatio.toFixed(1)}% of revenue` : undefined} />
                <KpiCard label="Profit Margin"    value={`${margin.toFixed(1)}%`} icon={Flame}      color={margin >= 20 ? 'green' : margin >= 0 ? 'amber' : 'red'} />
                <KpiCard label="Targets Hit"      value={`${s?.target_achieved_count ?? 0} / ${s?.total_projects ?? 0}`} icon={Target} color="teal" />
                <KpiCard label="Projects"         value={s?.total_projects ?? '—'} icon={FolderKanban} color="amber"
                  sub={`${healthOk} healthy`} />
              </>
          }
        </div>
      </section>

      {/* ── Middle row: Client revenue + At-risk + Best/Worst ── */}
      <section aria-label="Portfolio breakdown" className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Client revenue breakdown */}
        <div className="card lg:col-span-1">
          <h2 className="text-xs font-bold uppercase tracking-wider mb-4 flex items-center gap-2"
            style={{ color: 'var(--text-3)' }}>
            <IndianRupee size={13} style={{ color: '#22c55e' }} /> Revenue by Client
          </h2>
          {loading && !data
            ? <div className="space-y-4">{Array.from({length:3}).map((_,i)=><SkeletonCard key={i}/>)}</div>
            : <div className="space-y-4">
                {Object.entries(s?.client_billed || {}).map(([cl, billed]) => (
                  <ClientBar key={cl}
                    client={cl}
                    billed={billed}
                    profit={s?.client_profit?.[cl] || 0}
                    maxBilled={maxBilled}
                  />
                ))}
              </div>
          }
        </div>

        {/* Projects at risk */}
        <div className="card lg:col-span-1">
          <h2 className="text-xs font-bold uppercase tracking-wider mb-1 flex items-center gap-2"
            style={{ color: 'var(--text-3)' }}>
            <ShieldAlert size={13} style={{ color: '#f87171' }} /> Needs Attention
          </h2>
          <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>
            Negative profit or critical health
          </p>
          {loading && !data
            ? <SkeletonCard />
            : atRisk.length === 0
              ? <div className="flex flex-col items-center justify-center py-6 text-center">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center mb-2"
                    style={{ background: 'rgba(34,197,94,0.1)' }}>
                    <Award size={18} style={{ color: '#22c55e' }} />
                  </div>
                  <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>All projects healthy</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>No critical issues found</p>
                </div>
              : <div>
                  {atRisk.map((p, i) => <RiskRow key={i} project={p} />)}
                </div>
          }
        </div>

        {/* Best & worst performer */}
        <div className="card lg:col-span-1 flex flex-col gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-2"
              style={{ color: 'var(--text-3)' }}>
              <Award size={13} style={{ color: '#22c55e' }} /> Top Performer
            </p>
            {loading && !data
              ? <SkeletonCard />
              : s?.best_project?.name
                ? <div className="rounded-xl p-3" style={{ background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.18)' }}>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{s.best_project.name}</p>
                    <p className="text-2xl font-bold mt-1 tabular-nums" style={{ color: '#22c55e' }}>
                      {s.best_project.pct >= 0 ? '+' : ''}{s.best_project.pct}%
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>profit margin</p>
                  </div>
                : <p className="text-sm" style={{ color: 'var(--text-3)' }}>No data</p>
            }
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-2"
              style={{ color: 'var(--text-3)' }}>
              <TrendingDown size={13} style={{ color: '#f87171' }} /> Lowest Margin
            </p>
            {loading && !data
              ? <SkeletonCard />
              : s?.worst_project?.name
                ? <div className="rounded-xl p-3" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)' }}>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{s.worst_project.name}</p>
                    <p className="text-2xl font-bold mt-1 tabular-nums"
                      style={{ color: s.worst_project.pct < 0 ? '#f87171' : '#fbbf24' }}>
                      {s.worst_project.pct > 0 ? '+' : ''}{s.worst_project.pct}%
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>profit margin</p>
                  </div>
                : <p className="text-sm" style={{ color: 'var(--text-3)' }}>No data</p>
            }
          </div>
        </div>
      </section>

      {/* ── Status chips ── */}
      {s?.by_status && (
        <section aria-label="Projects by status">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(s.by_status).map(([status, count]) => {
              const isActive    = status.includes('Active')
              const isCompleted = status.includes('Completed')
              const isHold      = status.includes('Hold')
              const accent = isActive ? '#22c55e' : isCompleted ? '#60a5fa' : isHold ? '#fbbf24' : '#f87171'
              return (
                <button key={status}
                  onClick={() => navigate(`/projects?status=${encodeURIComponent(status)}`)}
                  className="card text-center transition-all hover:scale-[1.02] active:scale-[0.99]"
                  style={{ cursor: 'pointer' }}
                  aria-label={`${count} ${status} projects`}>
                  <p className="text-3xl font-bold tabular-nums" style={{ color: accent }}>{count}</p>
                  <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-3)' }}>{status}</p>
                  <div className="mt-2 h-0.5 rounded-full mx-auto w-8"
                    style={{ background: accent, opacity: 0.5 }} />
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
            View all <ArrowRight size={12} />
          </button>
        </div>

        {loading && !data
          ? <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({length:3}).map((_,i)=><SkeletonCard key={i} tall />)}
            </div>
          : recent.length > 0
            ? <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
