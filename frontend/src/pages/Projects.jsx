import { useCallback, useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, Plus, X, RefreshCw, AlertCircle, Loader2, SlidersHorizontal } from 'lucide-react'
import ProjectCard from '../components/ProjectCard'
import { api } from '../services/api'
import { useAutoRefresh, useRelativeTime } from '../hooks/useAutoRefresh'
import clsx from 'clsx'

const STATUSES = ['🟢 Active', '✅ Completed', '⏸️ On Hold', '🔴 Cancelled']
const CLIENTS  = ['Birla Open Minds', 'Maitrimetal', 'BG']
const SORT_OPTIONS = [
  { value: 'Amount Billed So far', label: 'Highest Billed' },
  { value: 'Profit percentage',    label: 'Profit %' },
  { value: 'Target Revenue',       label: 'Target Revenue' },
]

function SkeletonCard() {
  return (
    <div className="card space-y-3 animate-pulse" aria-hidden="true">
      <div className="h-5 rounded w-3/4" style={{ background: 'var(--bg-input)' }} />
      <div className="h-4 rounded w-1/2" style={{ background: 'var(--bg-input)' }} />
      <div className="h-2 rounded w-full" style={{ background: 'var(--bg-input)' }} />
      <div className="h-2 rounded w-2/3" style={{ background: 'var(--bg-input)' }} />
      <div className="flex gap-2 pt-1">
        <div className="h-7 rounded w-1/2" style={{ background: 'var(--bg-input)' }} />
        <div className="h-7 rounded w-1/2" style={{ background: 'var(--bg-input)' }} />
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

  const [search, setSearch]           = useState('')
  const [searching, setSearching]     = useState(false)
  const [searchResults, setSearchResults] = useState(null)
  const [sortBy, setSortBy]           = useState('Amount Billed So far')
  const [showFilters, setShowFilters] = useState(false)
  const searchTimer = useRef(null)
  const searchInputRef = useRef(null)

  const status = searchParams.get('status') || ''
  const client = searchParams.get('client') || ''

  const fetchProjects = useCallback(() =>
    api.projects.list({ status: status || undefined, client: client || undefined, order_by: sortBy })
      .then(d => d.records || [])
  , [status, client, sortBy])

  const { data: _data, loading, error, refresh, lastUpdated, syncing } =
    useAutoRefresh(fetchProjects, 5_000, [status, client, sortBy])
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

  const setFilter = (key, val) => {
    const p = new URLSearchParams(searchParams)
    if (val) p.set(key, val); else p.delete(key)
    setSearchParams(p)
  }

  const clearSearch = () => { setSearch(''); setSearchResults(null); searchInputRef.current?.focus() }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 animate-fade-in">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--text-1)' }}>Projects</h1>
          <p className="text-sm mt-0.5 flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
            {displayed.length} project{displayed.length !== 1 ? 's' : ''}
            {lastUpdated && (
              <span className="flex items-center gap-1.5">
                · <SyncDot syncing={syncing} />
                <span style={{ color: syncing ? 'var(--fin-warning)' : 'var(--text-3)' }}>
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
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--accent-btn)', color: '#fff', boxShadow: '0 4px 12px rgba(37,99,235,0.25)' }}>
            <Plus size={15} aria-hidden="true" /> <span className="hidden sm:inline">New Project</span><span className="sm:hidden">New</span>
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div role="alert" className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
          style={{ background: 'var(--fin-neg-bg)', border: '1px solid var(--fin-neg-border)', color: 'var(--fin-negative)' }}>
          <AlertCircle size={15} aria-hidden="true" /> {error}
          <button onClick={refresh} className="underline ml-1">retry</button>
        </div>
      )}

      {/* Search + filter bar */}
      <div className="space-y-2">
        <div className="flex gap-2" role="search">
          {/* Search */}
          <div className="relative flex-1">
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
            className="flex items-center gap-1.5 px-3 rounded-xl text-sm transition-all"
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
        </div>

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

        {/* Active filter chips */}
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {activeFilters.map(f => (
              <span key={f} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)', color: 'var(--fin-positive)' }}>
                {f}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Grid */}
      {loading && !records.length ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-label="Loading projects">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : displayed.length === 0 ? (
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
            <button onClick={() => navigate('/projects/new')}
              className="px-4 py-2 rounded-xl text-sm font-semibold"
              style={{ background: 'var(--accent-btn)', color: '#fff', boxShadow: '0 4px 12px rgba(37,99,235,0.25)' }}>
              + New project
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayed.map(r => <ProjectCard key={r.id} record={r} onRefresh={refresh} />)}
        </div>
      )}
    </div>
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
