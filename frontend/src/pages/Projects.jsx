import { useCallback, useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, Plus, X, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import ProjectCard from '../components/ProjectCard'
import { api } from '../services/api'
import { useAutoRefresh, useRelativeTime } from '../hooks/useAutoRefresh'
import clsx from 'clsx'

const STATUSES = ['🟢 Active', '✅ Completed', '⏸️ On Hold', '🔴 Cancelled']
const CLIENTS  = ['Birla Open Minds', 'Maitrimetal', 'BG']

function SkeletonCard() {
  return (
    <div className="card space-y-3 animate-pulse" aria-hidden="true">
      <div className="h-5 bg-surface-700 rounded w-3/4" />
      <div className="h-4 bg-surface-700 rounded w-1/2" />
      <div className="h-3 bg-surface-700 rounded w-full" />
      <div className="h-3 bg-surface-700 rounded w-2/3" />
    </div>
  )
}

export default function Projects() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate  = useNavigate()
  const [search, setSearch]       = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState(null)
  const searchTimer = useRef(null)

  const status = searchParams.get('status') || ''
  const client = searchParams.get('client') || ''

  const fetchProjects = useCallback(() =>
    api.projects.list({
      status:   status   || undefined,
      client:   client   || undefined,
      order_by: 'Amount Billed So far',
    }).then(d => d.records || [])
  , [status, client])

  const { data: _data, loading, error, refresh, lastUpdated, syncing } = useAutoRefresh(fetchProjects, 5_000, [status, client])
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
      } catch {
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 400)
    return () => clearTimeout(searchTimer.current)
  }, [search])

  const displayed = searchResults ?? records

  const setFilter = (key, val) => {
    const p = new URLSearchParams(searchParams)
    if (val) p.set(key, val); else p.delete(key)
    setSearchParams(p)
  }

  const clearSearch = () => { setSearch(''); setSearchResults(null) }

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold text-white">Projects</h1>
          <p className="text-gray-500 text-sm mt-0.5 flex items-center gap-2">
            {displayed.length} project{displayed.length !== 1 ? 's' : ''}
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
          <button onClick={refresh} disabled={loading} aria-label="Refresh" className="btn-icon">
            <RefreshCw size={16} className={clsx(loading && 'animate-spin')} />
          </button>
          <button onClick={() => navigate('/projects/new')} className="btn-primary flex items-center gap-2">
            <Plus size={16} aria-hidden="true" /> New Project
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div role="alert" className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          <AlertCircle size={16} />
          {error} — <button onClick={refresh} className="underline hover:no-underline">retry</button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2.5" role="search" aria-label="Filter projects">
        {/* Search */}
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" aria-hidden="true" />
          <input
            className="input pl-9 pr-8 text-sm"
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search projects"
          />
          {searching && <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 animate-spin" aria-hidden="true" />}
          {search && !searching && (
            <button onClick={clearSearch} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
              <X size={13} />
            </button>
          )}
        </div>

        {/* Status filter */}
        <select
          className="input w-auto text-sm min-w-32"
          value={status}
          onChange={(e) => setFilter('status', e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Client filter */}
        <select
          className="input w-auto text-sm min-w-36"
          value={client}
          onChange={(e) => setFilter('client', e.target.value)}
          aria-label="Filter by client"
        >
          <option value="">All clients</option>
          {CLIENTS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        {/* Clear filters */}
        {(status || client) && (
          <button
            onClick={() => setSearchParams({})}
            className="btn-ghost text-sm flex items-center gap-1.5"
            aria-label="Clear all filters"
          >
            <X size={13} aria-hidden="true" /> Clear
          </button>
        )}
      </div>

      {/* Grid */}
      {loading && !records.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-label="Loading projects">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-gray-500 text-lg">No projects found</p>
          <p className="text-gray-600 text-sm mt-1">Try adjusting your filters</p>
          <button onClick={() => navigate('/projects/new')} className="btn-primary mt-5">
            + Create project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayed.map((r) => (
            <ProjectCard key={r.id} record={r} onRefresh={refresh} />
          ))}
        </div>
      )}
    </div>
  )
}
