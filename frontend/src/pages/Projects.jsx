import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, Plus, Filter, Loader2 } from 'lucide-react'
import ProjectCard from '../components/ProjectCard'
import { api } from '../services/api'

const STATUSES = ['', '🟢 Active', '✅ Completed', '⏸️ On Hold', '🔴 Cancelled']
const CLIENTS = ['', 'Birla Open Minds', 'Maitrimetal', 'BG']

export default function Projects() {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const status = searchParams.get('status') || ''
  const client = searchParams.get('client') || ''

  const fetchProjects = async () => {
    setLoading(true)
    try {
      const data = await api.projects.list({ status: status || undefined, client: client || undefined, order_by: 'Amount Billed So far' })
      setRecords(data.records || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchProjects() }, [status, client])

  const handleSearch = async (val) => {
    setSearch(val)
    if (!val.trim()) { fetchProjects(); return }
    setSearching(true)
    try {
      const data = await api.projects.search(val)
      setRecords(data.records || [])
    } finally {
      setSearching(false)
    }
  }

  const setFilter = (key, val) => {
    const p = new URLSearchParams(searchParams)
    if (val) p.set(key, val); else p.delete(key)
    setSearchParams(p)
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Projects</h1>
          <p className="text-gray-500 text-sm mt-0.5">{records.length} project{records.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => navigate('/projects/new')} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> New Project
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            className="input pl-9 text-sm"
            placeholder="Search projects..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
          />
          {searching && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 animate-spin" />}
        </div>
        <select className="input w-auto text-sm" value={status} onChange={(e) => setFilter('status', e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
        </select>
        <select className="input w-auto text-sm" value={client} onChange={(e) => setFilter('client', e.target.value)}>
          {CLIENTS.map((c) => <option key={c} value={c}>{c || 'All clients'}</option>)}
        </select>
        {(status || client) && (
          <button onClick={() => setSearchParams({})} className="btn-ghost text-sm flex items-center gap-1">
            <Filter size={13} /> Clear
          </button>
        )}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : records.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-gray-500">No projects found.</p>
          <button onClick={() => navigate('/projects/new')} className="btn-primary mt-4">Create your first project</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {records.map((r) => <ProjectCard key={r.id} record={r} />)}
        </div>
      )}
    </div>
  )
}
