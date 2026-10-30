import { memo, useCallback, useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Plus, X, RefreshCw, AlertCircle, Loader2, SlidersHorizontal, FolderKanban, Activity, IndianRupee, Link2, ArrowRight, AlertTriangle, ChevronDown } from 'lucide-react'
import ProjectCard from '../components/ProjectCard'
import { useRelativeTime } from '../hooks/useAutoRefresh'
import { useChangeCount } from '../hooks/useServerList'
import { LiveValue, LiveDot } from '../components/LiveFigures'
import { useAuth } from '../context/AuthContext'
import clsx from 'clsx'
import { ManageSharedLinksModal, ShareLinkModal } from '../components/SharedLinks'
import { ExecutiveShell, ExecutiveHero, ExecutiveStatGrid, ExecutiveStatCard, ExecutivePanel, ExecutiveFilterBar, ExecutiveChip } from '../components/ExecutiveUI'
import EmptyState from '../components/EmptyState'
import { formatInr, formatPct } from '../utils/format'
import { PROJECT_PAGE_SIZE, useProjectFilters, useProjectQuery } from './projects/useProjectQuery'

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

function SelectFilter({ value, onChange, label, children }) {
  return (
    <select
      value={value} onChange={e => onChange(e.target.value)}
      aria-label={label}
      className="w-full rounded-xl px-3 py-2.5 text-sm outline-none sm:min-w-[11rem]"
      style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
    >
      {children}
    </select>
  )
}

// A card re-renders only when its record changes, not on every poll or
// keystroke elsewhere on the page.
const MemoProjectCard = memo(ProjectCard)

export default function Projects() {
  const navigate = useNavigate()
  const { isEditor } = useAuth()
  // Search, status, client, sort and loaded pages live in the URL.
  const { filters, pages, setFilters, setPages, searchInput, setSearchInput, commitSearch, clearAll } = useProjectFilters()
  const { status, client, sort: sortBy } = filters
  const search = filters.q
  const {
    records, total, nextCursor, aggregates: agg, workspace: ws, hasData, loading, refreshing,
    loadingMore, error, loadMore, refresh,
  } = useProjectQuery(filters, { pages, onPagesChange: setPages })

  const [showFilters, setShowFilters] = useState(false)
  const [shareModal, setShareModal] = useState(false)
  const [manageModal, setManageModal] = useState(false)
  const searchInputRef = useRef(null)

  // The changed time, not the polled time: the chip says when the portfolio
  // last moved, not when it was last asked.
  const changeCount = useChangeCount(ws ? [ws.count, ws.total_billed, ws.total_profit, ws.needs_action] : null)
  const [changedAt, setChangedAt] = useState(null)
  useEffect(() => { if (changeCount) setChangedAt(new Date()) }, [changeCount])
  const changedLabel = useRelativeTime(changedAt)

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

  const displayed = records
  const hasFilters = !!(status || client || search)
  const activeFilters = [status && `Status: ${status}`, client && `Client: ${client}`].filter(Boolean)
  const statusOptions = useMemo(() => [...new Set([...STATUSES, ...(ws?.facets?.statuses || [])])], [ws])
  const clientOptions = useMemo(() => [...new Set([...CLIENTS, ...(ws?.facets?.clients || [])])], [ws])
  // Client concentration of the current scope (the search and filters).
  const topClients = Object.entries(agg?.by_client || {})
    .filter(([name]) => name !== 'Unknown')
    .sort(([, a], [, b]) => Number(b) - Number(a))
    .slice(0, 4)
  const actionQueue = agg?.action_queue || []
  const needsAction = agg?.needs_action || 0
  const blindSpots = agg?.blind_spots || 0
  const margin = agg?.margin || 0
  const outstandingTotal = 0
  const highestExposure = agg?.highest_exposure || null
  const allCount = ws?.count ?? 0

  const setFilter = (key, val) => setFilters({ [key]: val || '' })
  const setSortBy = (val) => setFilters({ sort: val })
  const setSearchQuery = (val) => {
    setSearchInput(val)
    setFilters({ q: val.trim() }, { replace: true })
  }
  const clearSearch = () => { setSearchQuery(''); searchInputRef.current?.focus() }
  const clearEverything = () => { clearAll(); setShowFilters(false) }

  // Under each card, while a search or filter narrows the view: the portfolio figure.
  const ofAll = (text) => hasFilters && ws ? <p className="invoice-kpi-of-all">{text}</p> : null

  return (
    <ExecutiveShell>

      <ExecutiveHero
        eyebrow="Projects Control Center"
        title="Projects"
        description="Track portfolio health, profit coverage, billing context, and delivery risk from one unified project workspace."
        icon={FolderKanban}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <ExecutiveChip accent>{total} visible project{total !== 1 ? 's' : ''}</ExecutiveChip>
            {hasData && (
              <ExecutiveChip>
                <LiveDot changeCount={changeCount} loading={refreshing && !hasData} /> {changedAt ? `changed ${changedLabel}` : 'live'}
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
            <button onClick={refresh} disabled={refreshing} aria-label="Refresh" className="btn-ghost">
              <RefreshCw size={14} className={clsx(refreshing && 'animate-spin')} />
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
        {/* The cards follow the search and filters; while either narrows the
            view, a quiet line under each gives the whole portfolio's figure. */}
        <ExecutiveStatGrid className="mt-5">
          <ExecutiveStatCard
            label="Needs action"
            value={<LiveValue value={needsAction} format={v => String(Math.round(v))} />}
            sub={needsAction
              ? `${actionQueue[0]?.name || 'Top project'} is the first review candidate`
              : 'No urgent collections or delivery blockers in the visible scope'}
            accent={needsAction ? 'warning' : 'positive'}
            icon={AlertTriangle}
          >
            {ofAll(`of ${ws?.needs_action ?? 0} across all ${allCount}`)}
          </ExecutiveStatCard>
          <ExecutiveStatCard
            label="Cashflow summary"
            value={agg ? <LiveValue value={agg.total_billed || 0} format={formatInr} /> : '—'}
            sub={agg ? `${formatInr(agg.total_profit || 0)} profit · ${formatPct(margin, 2)} margin` : 'Loading billing health'}
            icon={IndianRupee}
          >
            {ofAll(`of ${formatInr(ws?.total_billed || 0)} across all ${allCount}`)}
          </ExecutiveStatCard>
          <ExecutiveStatCard
            label="Open receivables"
            value={<LiveValue value={outstandingTotal} format={formatInr} />}
            sub={highestExposure
              ? `${highestExposure.name || 'Highest billed project'} has the largest billed exposure`
              : 'No billing exposure visible in this scope'}
            accent={outstandingTotal > 0 ? 'warning' : 'positive'}
            icon={Link2}
          />
          <ExecutiveStatCard
            label="Delivery blockers"
            value={<LiveValue value={needsAction} format={v => String(Math.round(v))} />}
            sub={blindSpots
              ? `${blindSpots} project${blindSpots !== 1 ? 's' : ''} still missing health or status`
              : 'Project health and status are available on the visible projects'}
            accent={needsAction ? 'warning' : 'positive'}
            icon={Activity}
          >
            {ofAll(`of ${ws?.needs_action ?? 0} across all ${allCount}`)}
          </ExecutiveStatCard>
        </ExecutiveStatGrid>
      </ExecutiveHero>

      {/* ── Search and filters: one compact bar that stays in view ── */}
      <div className="invoice-sticky-filters" role="search" aria-label="Search and filter projects">
        <ExecutiveFilterBar className="executive-filter-bar-toolbar">
          {/* Search */}
          <div className="executive-search relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--text-3)' }} aria-hidden="true" />
            <input
              ref={searchInputRef}
              className="w-full rounded-xl pl-9 pr-16 py-2.5 text-sm outline-none transition-all"
              placeholder="Search projects…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitSearch() } }}
              aria-label="Search projects"
              autoComplete="off"
              style={{ background: 'transparent', border: 'none', color: 'var(--text-1)' }}
            />
            {/* Right side of search */}
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {refreshing && searchInput && <Loader2 size={12} className="animate-spin" style={{ color: 'var(--text-3)' }} aria-hidden="true" />}
              {searchInput && !refreshing && (
                <button onClick={clearSearch} aria-label="Clear search"
                  className="w-5 h-5 rounded flex items-center justify-center"
                  style={{ color: 'var(--text-3)' }}>
                  <X size={12} />
                </button>
              )}
              {!searchInput && (
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
            className="flex items-center justify-center gap-1.5 px-3 rounded-xl text-sm transition-all min-h-[42px]"
            style={{
              background: showFilters || activeFilters.length ? 'var(--accent-dim)' : 'var(--bg-input)',
              border: `1px solid ${showFilters || activeFilters.length ? 'color-mix(in srgb, var(--accent) 25%, transparent)' : 'var(--border)'}`,
              color: showFilters || activeFilters.length ? 'var(--fin-positive)' : 'var(--text-2)',
            }}>
            <SlidersHorizontal size={14} aria-hidden="true" />
            <span className="hidden sm:inline">Filters</span>
            {activeFilters.length > 0 && (
              <span className="w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ background: 'var(--accent-btn)', color: 'var(--accent-fg)' }}>{activeFilters.length}</span>
            )}
          </button>
          <span aria-live="polite" className="inline-flex items-center">
            <ExecutiveChip accent>
              {!hasData ? 'Loading…' : `${total.toLocaleString('en-IN')} result${total !== 1 ? 's' : ''}`}
              {refreshing && hasData && <RefreshCw size={10} className="animate-spin" aria-hidden="true" />}
            </ExecutiveChip>
          </span>
        </ExecutiveFilterBar>

        {/* Expanded filter row */}
        {showFilters && (
          <div className="project-filter-grid filter-expanded-panel animate-slide-up">
            <SelectFilter value={status} onChange={v => setFilter('status', v)} label="Filter by status">
              <option value="">All statuses</option>
              {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </SelectFilter>

            <SelectFilter value={client} onChange={v => setFilter('client', v)} label="Filter by client">
              <option value="">All clients</option>
              {clientOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </SelectFilter>

            <SelectFilter value={sortBy} onChange={setSortBy} label="Sort by">
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </SelectFilter>

            {(status || client) && (
              <button
                onClick={clearEverything}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-all sm:min-w-[11rem]"
                style={{ color: 'var(--fin-negative)', border: '1px solid var(--fin-neg-border)', background: 'var(--fin-neg-bg)' }}
                aria-label="Clear all filters">
                <X size={13} aria-hidden="true" /> Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div role="alert" className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
          style={{ background: 'var(--fin-neg-bg)', border: '1px solid var(--fin-neg-border)', color: 'var(--fin-negative)' }}>
          <AlertCircle size={15} aria-hidden="true" /> {error}
          <button onClick={refresh} className="underline ml-1">retry</button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.9fr)] gap-4">
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
          {/* The scope by status: each count narrows the list to it. */}
          <div className="flex flex-wrap gap-2">
            {Object.entries(agg?.by_status || {}).map(([name, count]) => (
              <button
                key={name}
                type="button"
                disabled={name === 'Unknown'}
                onClick={() => setFilter('status', status === name ? '' : name)}
                className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold"
                style={{
                  background: status === name ? 'var(--accent-dim)' : 'var(--bg-input)',
                  border: '1px solid var(--border)', color: 'var(--text-2)',
                }}
              >
                <span>{name}</span>
                <span className="tabular-nums" style={{ color: 'var(--text-1)' }}>{count}</span>
              </button>
            ))}
            {!agg && <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading the portfolio…</p>}
          </div>
        </ExecutivePanel>

        <ExecutivePanel
          title="Signals to review"
          subtitle="Top clients, current at-risk pressure, and revenue movement."
        >
          {actionQueue.length > 0 ? (
            <div className="signal-list">
              {actionQueue.map((row, index) => (
                <button
                  key={row.id}
                  onClick={() => navigate(`/projects/${row.id}`)}
                  className="signal-list-row text-left"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="signal-list-kicker">Priority {index + 1}</p>
                      <p className="signal-list-title truncate">{row.name || 'Project'}</p>
                    </div>
                    <ExecutiveChip accent>Review</ExecutiveChip>
                  </div>
                  <p className="signal-list-copy">
                    {row.health || 'Review project health, margin, and delivery status'}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>No urgent delivery or collections pressure is visible right now.</p>
          )}
          {topClients.length > 0 && (
            <div className="mt-4 space-y-2 rounded-2xl p-3" style={{ background: 'var(--fin-warn-bg)', border: '1px solid var(--fin-warn-border)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: 'var(--fin-warning)' }}>Client concentration</p>
              {topClients.map(([name, count]) => (
                <button
                  key={name}
                  onClick={() => setSearchQuery(name)}
                  className="w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-left"
                  style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{name}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{count} active project{count === 1 ? '' : 's'} in the current scope</p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--fin-warning)' }}>
                    Filter
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
          <div className="project-stream-grid" aria-label="Loading projects">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        </ExecutivePanel>
      ) : displayed.length === 0 ? (
        <ExecutivePanel title="Project stream" subtitle="No projects are visible in the current scope.">
          <EmptyState
            icon={<FolderKanban size={22} />}
            title={search ? 'No results found' : 'No projects match these filters'}
            subtitle={search
              ? (status || client ? 'Nothing matches this search with the status or client filter on. Search everything, or try another term.' : 'Try a different search term or clear the search.')
              : 'Clear your filters or add a new project to get started.'}
            action={
              <>
                {search && (status || client) && (
                  <button onClick={() => setFilters({ status: '', client: '' })} className="btn-ghost">
                    Search all projects
                  </button>
                )}
                {(search || status || client) && (
                  <button onClick={clearEverything} className="btn-ghost">
                    Clear filters
                  </button>
                )}
                {isEditor && (
                  <button onClick={() => navigate('/projects/new')} className="btn-primary">
                    <Plus size={13} />New project
                  </button>
                )}
              </>
            }
          />
        </ExecutivePanel>
      ) : (
        <ExecutivePanel title="Project stream" subtitle="Live project cards with direct finance and delivery context.">
          <div className="project-stream-grid">
            {displayed.map(r => <MemoProjectCard key={r.id} record={r} onRefresh={refresh} />)}
          </div>
          {/* Show more: the next page of this scope through the cursor. */}
          <div className="invoice-show-more mt-4" aria-live="polite">
            <span>Showing {displayed.length.toLocaleString('en-IN')} of {total.toLocaleString('en-IN')}</span>
            {nextCursor && (
              <button type="button" onClick={loadMore} disabled={loadingMore} className="btn-ghost"
                style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem' }}>
                {loadingMore ? <RefreshCw size={12} className="animate-spin" /> : <ChevronDown size={12} />}
                {loadingMore ? 'Loading…' : `Show ${Math.min(PROJECT_PAGE_SIZE, total - displayed.length)} more`}
              </button>
            )}
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
