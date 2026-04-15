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
      <div className="h-5 rounded w-3/4" style={{ background: 'var(--bg-input)' }} />
      <div className="h-4 rounded w-1/2" style={{ background: 'var(--bg-input)' }} />
      <div className="h-3 rounded w-full" style={{ background: 'var(--bg-input)' }} />
      <div className="h-3 rounded w-2/3" style={{ background: 'var(--bg-input)' }} />
    </div>
  )
}

function SyncDot({ syncing }) {
  return (
    <span className={clsx('w-1.5 h-1.5 rounded-full inline-block', syncing ? 'animate-pulse' : '')}
      style={{ background: syncing ? '#facc15' : '#4ade80' }} aria-hidden="true" />
  )
}

export default function Projects() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate  = useNavigate()
  const [search, setSearch]             = useState('')
  const [searching, setSearching]       = useState(false)
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
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-1)' }}>Projects</h1>
          <p className="text-sm mt-0.5 flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
            {displayed.length} project{displayed.length !== 1 ? 's' : ''}
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
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:bg-white/5"
            style={{ color: 'var(--text-2)', border: '1px solid var(--border)' }}>
            <RefreshCw size={16} className={clsx(loading && 'animate-spin')} />
          </button>
          <button onClick={() => navigate('/projects/new')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: 'white', boxShadow: '0 4px 12px rgba(34,197,94,0.3)' }}>
            <Plus size={15} aria-hidden="true" /> New Project
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div role="alert" className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>
          <AlertCircle size={16} />
          {error} — <button onClick={refresh} className="underline hover:no-underline ml-1">retry</button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2.5" role="search" aria-label="Filter projects">
        {/* Search input */}
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'var(--text-3)' }} aria-hidden="true" />
          <input
            className="w-full rounded-xl pl-9 pr-8 py-2.5 text-sm outline-none transition-all"
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
            }}
            placeholder="Search projects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search projects"
          />
          {searching && (
            <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin"
              style={{ color: 'var(--text-3)' }} aria-hidden="true" />
          )}
          {search && !searching && (
            <button onClick={clearSearch} aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
              style={{ color: 'var(--text-3)' }}>
              <X size={13} />
            </button>
          )}
        </div>

        {/* Status filter */}
        <select
          className="rounded-xl px-3 py-2.5 text-sm outline-none min-w-32"
          style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
          value={status}
          onChange={(e) => setFilter('status', e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Client filter */}
        <select
          className="rounded-xl px-3 py-2.5 text-sm outline-none min-w-36"
          style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
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
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-all hover:bg-white/5"
            style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}
            aria-label="Clear all filters"
          >
            <X size={13} aria-hidden="true" /> Clear
          </button>
        )}
      </div>

      {/* Project grid */}
      {loading && !records.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-label="Loading projects">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-lg" style={{ color: 'var(--text-3)' }}>No projects found</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-3)', opacity: 0.7 }}>Try adjusting your filters</p>
          <button onClick={() => navigate('/projects/new')}
            className="mt-5 px-5 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: 'white', boxShadow: '0 4px 12px rgba(34,197,94,0.3)' }}>
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
