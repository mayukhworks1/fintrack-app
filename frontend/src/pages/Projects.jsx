import { useCallback, useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, Plus, X, RefreshCw, AlertCircle, Loader2, SlidersHorizontal, FolderKanban, Activity, IndianRupee, Link2, ArrowRight, AlertTriangle } from 'lucide-react'
import ProjectCard from '../components/ProjectCard'
import { api } from '../services/api'
import { useAutoRefresh, useRelativeTime } from '../hooks/useAutoRefresh'
import { useAuth } from '../context/AuthContext'
import clsx from 'clsx'
import { ManageSharedLinksModal, ShareLinkModal } from '../components/SharedLinks'
import { ExecutiveShell, ExecutiveHero, ExecutiveStatGrid, ExecutiveStatCard, ExecutivePanel, ExecutiveFilterBar, ExecutiveChip, ExecutiveMetricList } from '../components/ExecutiveUI'
import { formatInr, formatPct } from '../utils/format'

const STATUSES = ['🟢 Active', '✅ Completed', '⏸️ On Hold', '🔴 Cancelled']
const CLIENTS  = ['Birla Open Minds', 'Maitrimetal', 'BG']
const SORT_OPTIONS = [
  { value: 'Amount Billed So far', label: 'Highest Billed' },
  { value: 'Profit percentage',    label: 'Profit %' },
  { value: 'Target Revenue',       label: 'Target Revenue' },
]

function SkeletonCard() {
  return (
    <div className="card space-y-3" aria-hidden="true">
      <div className="skeleton h-5 rounded w-3/4" />
      <div className="skeleton h-4 rounded w-1/2" />
      <div className="skeleton h-2 rounded w-full" />
      <div className="skeleton h-2 rounded w-2/3" />
      <div className="flex gap-2 pt-1">
        <div className="skeleton h-7 rounded w-1/2" />
        <div className="skeleton h-7 rounded w-1/2" />
      </div>
    </div>
  )
}

function SyncDot({ syncing }) {
  return (
    <span className={clsx('w-1.5 h-1.5 rounded-full inline-block', syncing && 'animate-pulse')}
      style={{ background: syncing ? 'var(--fin-warning)' : 'var(--fin-positive)' }} aria-hidden="true" />
  )
}

function SelectFilter({ value, onChange, label, children }) {
  return (
    <select
      value={value} onChange={e => onChange(e.target.value)}
      aria-label={label}
      className="rounded-xl px-3 py-2.5 text-sm outline-none"
      style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
    >
      {children}
    </select>
  )
}

export default function Projects() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { isEditor } = useAuth()

  const [search, setSearch]           = useState('')
  const [searching, setSearching]     = useState(false)
  const [searchResults, setSearchResults] = useState(null)
  const [sortBy, setSortBy]           = useState('Amount Billed So far')
  const [showFilters, setShowFilters] = useState(false)
  const [shareModal, setShareModal] = useState(false)
  const [manageModal, setManageModal] = useState(false)
  const searchTimer = useRef(null)
  const searchInputRef = useRef(null)

  const status = searchParams.get('status') || ''
  const client = searchParams.get('client') || ''

  const fetchProjects = useCallback(() =>
    api.projects.list({ status: status || undefined, client: client || undefined, order_by: sortBy })
      .then(d => d.records || [])
  , [status, client, sortBy])

  const { data: _data, loading, error, refresh, lastUpdated, syncing } =
    useAutoRefresh(fetchProjects, 5_000)
  const fetchSummary = useCallback(() => api.projects.summary(), [])
  const { data: summary } = useAutoRefresh(fetchSummary, 10_000)
  const records = _data ?? []
  const updatedLabel = useRelativeTime(lastUpdated)

  // Debounced search
  useEffect(() => {
    if (!search.trim()) { setSearchResults(null); return }
    setSearching(true)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      try {
        const d = await api.projects.search(search)
        setSearchResults(d.records || [])
      } catch { setSearchResults([]) }
      finally  { setSearching(false) }
    }, 350)
    return () => clearTimeout(searchTimer.current)
  }, [search])

  // Cmd/Ctrl+K focuses search
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const displayed = searchResults ?? records
  const activeFilters = [status && `Status: ${status}`, client && `Client: ${client}`].filter(Boolean)
  const visibleCount = displayed.length
  const topClients = Object.entries(summary?.by_client || {})
    .sort(([, a], [, b]) => Number(b) - Number(a))
    .slice(0, 4)
  const atRisk = (summary?.at_risk || []).slice(0, 4)
  const margin = Number(summary?.total_billed || 0) > 0
    ? (Number(summary?.total_profit || 0) / Number(summary?.total_billed || 1)) * 100
    : 0
  const healthCoverage = Number(summary?.total_projects || 0) > 0
    ? (((summary?.healthy_projects || 0) / Number(summary?.total_projects || 1)) * 100)
    : 0

  const setFilter = (key, val) => {
    const p = new URLSearchParams(searchParams)
    if (val) p.set(key, val); else p.delete(key)
    setSearchParams(p)
  }

  const clearSearch = () => { setSearch(''); setSearchResults(null); searchInputRef.current?.focus() }

  return (
    <ExecutiveShell>

      <ExecutiveHero
        eyebrow="Projects Control Center"
        title="Projects"
        description="Track portfolio health, profit coverage, linked invoices, and delivery risk from one unified project workspace."
        icon={FolderKanban}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <ExecutiveChip accent>{visibleCount} visible project{visibleCount !== 1 ? 's' : ''}</ExecutiveChip>
            {lastUpdated && (
              <ExecutiveChip>
                <SyncDot syncing={syncing} /> {syncing ? 'syncing…' : `live · ${updatedLabel}`}
              </ExecutiveChip>
            )}
            {activeFilters.length > 0 && <ExecutiveChip>{activeFilters.length} active filter{activeFilters.length !== 1 ? 's' : ''}</ExecutiveChip>}
          </div>
        }
        actions={
          <>
            {isEditor && (
              <>
                <button onClick={() => setShareModal(true)} className="btn-ghost">
                  Share View
                </button>
                <button onClick={() => setManageModal(true)} className="btn-ghost">
                  Links
                </button>
              </>
            )}
            <button onClick={refresh} disabled={loading} aria-label="Refresh" className="btn-ghost">
              <RefreshCw size={14} className={clsx(loading && 'animate-spin')} />
              Refresh
            </button>
            {isEditor && (
              <button onClick={() => navigate('/projects/new')} className="btn-primary">
                <Plus size={14} /> New Project
              </button>
            )}
          </>
        }
      >
        <ExecutiveStatGrid className="mt-5">
          <ExecutiveStatCard
            label="Portfolio health"
            value={`${summary?.healthy_projects || 0}/${summary?.total_projects || visibleCount}`}
            sub={`${formatPct(healthCoverage, 1)} of tracked projects outside critical health bands`}
            accent="positive"
            icon={Activity}
          />
          <ExecutiveStatCard
            label="Cashflow summary"
            value={summary ? formatInr(summary.total_billed || 0) : '—'}
            sub={summary ? `${formatInr(summary.total_profit || 0)} profit · ${formatPct(margin, 2)} margin` : 'Loading billing health'}
            icon={IndianRupee}
          />
          <ExecutiveStatCard
            label="Linked invoices"
            value={records.reduce((sum, row) => sum + Number(row.association?.related_counts?.project?.invoices || 0), 0)}
            sub="Cross-module invoice associations visible on project cards"
            icon={Link2}
          />
          <ExecutiveStatCard
            label="At-risk now"
            value={summary?.at_risk?.length || 0}
            sub={summary?.at_risk?.length ? `${summary.at_risk[0]?.name || 'Highest pressure project'} needs review` : 'No negative-margin projects flagged'}
            accent={(summary?.at_risk?.length || 0) > 0 ? 'warning' : 'positive'}
            icon={AlertTriangle}
          />
        </ExecutiveStatGrid>
      </ExecutiveHero>

      {/* Error */}
      {error && (
        <div role="alert" className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
          style={{ background: 'var(--fin-neg-bg)', border: '1px solid var(--fin-neg-border)', color: 'var(--fin-negative)' }}>
          <AlertCircle size={15} aria-hidden="true" /> {error}
          <button onClick={refresh} className="underline ml-1">retry</button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.3fr)_360px] gap-4">
        <ExecutivePanel
          title="Delivery and finance lens"
          subtitle="Search, filter, and sort projects with the same control rhythm used across the main app."
          action={
            activeFilters.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {activeFilters.map(f => <ExecutiveChip key={f} accent>{f}</ExecutiveChip>)}
              </div>
            )
          }
        >
          <div className="space-y-3">
            <ExecutiveFilterBar role="search">
          {/* Search */}
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--text-3)' }} aria-hidden="true" />
            <input
              ref={searchInputRef}
              className="w-full rounded-xl pl-9 pr-16 py-2.5 text-sm outline-none transition-all"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
              placeholder="Search projects…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="Search projects"
              autoComplete="off"
            />
            {/* Right side of search */}
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {searching && <Loader2 size={12} className="animate-spin" style={{ color: 'var(--text-3)' }} aria-hidden="true" />}
              {search && !searching && (
                <button onClick={clearSearch} aria-label="Clear search"
                  className="w-5 h-5 rounded flex items-center justify-center"
                  style={{ color: 'var(--text-3)' }}>
                  <X size={12} />
                </button>
              )}
              {!search && (
                <kbd className="hidden sm:inline-flex items-center px-1.5 rounded text-xs font-mono"
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-3)' }}>
                  ⌘K
                </kbd>
              )}
            </div>
          </div>

          {/* Filter toggle button */}
          <button
            onClick={() => setShowFilters(f => !f)}
            aria-label="Toggle filters" aria-expanded={showFilters}
            className="flex items-center gap-1.5 px-3 rounded-xl text-sm transition-all min-h-[42px]"
            style={{
              background: showFilters || activeFilters.length ? 'var(--accent-dim)' : 'var(--bg-input)',
              border: `1px solid ${showFilters || activeFilters.length ? 'rgba(37,99,235,0.25)' : 'var(--border)'}`,
              color: showFilters || activeFilters.length ? 'var(--fin-positive)' : 'var(--text-2)',
            }}>
            <SlidersHorizontal size={14} aria-hidden="true" />
            <span className="hidden sm:inline">Filters</span>
            {activeFilters.length > 0 && (
              <span className="w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ background: 'var(--accent)', color: '#fff' }}>{activeFilters.length}</span>
            )}
          </button>
            </ExecutiveFilterBar>

        {/* Expanded filter row */}
        {showFilters && (
          <div className="flex flex-wrap gap-2 p-3 rounded-xl animate-slide-up"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <SelectFilter value={status} onChange={v => setFilter('status', v)} label="Filter by status">
              <option value="">All statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </SelectFilter>

            <SelectFilter value={client} onChange={v => setFilter('client', v)} label="Filter by client">
              <option value="">All clients</option>
              {CLIENTS.map(c => <option key={c} value={c}>{c}</option>)}
            </SelectFilter>

            <SelectFilter value={sortBy} onChange={setSortBy} label="Sort by">
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </SelectFilter>

            {(status || client) && (
              <button
                onClick={() => { setSearchParams({}); setShowFilters(false) }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-all"
                style={{ color: 'var(--fin-negative)', border: '1px solid var(--fin-neg-border)', background: 'var(--fin-neg-bg)' }}
                aria-label="Clear all filters">
                <X size={13} aria-hidden="true" /> Clear filters
              </button>
            )}
          </div>
        )}
          </div>
        </ExecutivePanel>

        <ExecutivePanel
          title="Signals to review"
          subtitle="Top clients, current at-risk pressure, and revenue movement."
        >
          {topClients.length > 0 ? (
            <ExecutiveMetricList
              items={topClients.map(([name, count]) => ({
                label: name,
                sub: `${count} project${count === 1 ? '' : 's'} active in the current summary`,
                value: count,
              }))}
            />
          ) : (
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>No client distribution available yet.</p>
          )}
          {atRisk.length > 0 && (
            <div className="mt-4 space-y-2 rounded-2xl p-3" style={{ background: 'var(--fin-warn-bg)', border: '1px solid var(--fin-warn-border)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: 'var(--fin-warning)' }}>Pressure points</p>
              {atRisk.map(project => (
                <button
                  key={project.name}
                  onClick={() => setSearch(project.name)}
                  className="w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-left"
                  style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{project.name}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{project.client || 'Portfolio project'} · {project.status || project.health}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--fin-warning)' }}>
                    Open
                    <ArrowRight size={12} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </ExecutivePanel>
      </div>

      {/* Grid */}
      {loading && !records.length ? (
        <ExecutivePanel title="Project stream" subtitle="Loading current portfolio view…">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-label="Loading projects">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        </ExecutivePanel>
      ) : displayed.length === 0 ? (
        <ExecutivePanel title="Project stream" subtitle="No projects are visible in the current scope.">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'var(--bg-input)' }}>
            <FolderKanbanIcon />
          </div>
          <p className="text-base font-semibold" style={{ color: 'var(--text-2)' }}>
            {search ? 'No results found' : 'No projects match these filters'}
          </p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
            {search ? 'Try a different search term' : 'Clear your filters or create a new project'}
          </p>
          <div className="flex gap-2 mt-5">
            {(search || status || client) && (
              <button onClick={() => { clearSearch(); setSearchParams({}) }}
                className="px-4 py-2 rounded-xl text-sm transition-all"
                style={{ border: '1px solid var(--border)', color: 'var(--text-2)', background: 'transparent' }}>
                Clear filters
              </button>
            )}
            {isEditor && (
              <button onClick={() => navigate('/projects/new')}
                className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--accent-btn)', color: '#fff', boxShadow: '0 4px 12px rgba(37,99,235,0.25)' }}>
                + New project
              </button>
            )}
          </div>
        </div>
        </ExecutivePanel>
      ) : (
        <ExecutivePanel title="Project stream" subtitle="Live project cards with linked invoice and status context.">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayed.map(r => <ProjectCard key={r.id} record={r} onRefresh={refresh} />)}
          </div>
        </ExecutivePanel>
      )}

      {isEditor && shareModal && (
        <ShareLinkModal
          resourceType="projects"
          selectedRecords={displayed}
          title={`Projects · ${status || client || 'Current View'}`}
          recordLabel="project"
          enableLiveMode
          viewConfig={{
            type: 'card',
            filterClient: client || '',
            filterStatus: status || '',
            search,
          }}
          onClose={() => setShareModal(false)}
        />
      )}
      {isEditor && manageModal && (
        <ManageSharedLinksModal
          resourceType="projects"
          recordLabel="project"
          currentViewConfig={{
            type: 'card',
            filterClient: client || '',
            filterStatus: status || '',
            search,
          }}
          visibleRecords={displayed}
          onClose={() => setManageModal(false)}
        />
      )}
    </ExecutiveShell>
  )
}

function FolderKanbanIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ color: 'var(--text-3)' }}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  )
}
