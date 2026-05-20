/**
 * AssociationLinkModal — v2
 *
 * Links a record (and ALL matching records across modules) to canonical
 * client + project entity names.
 *
 * How it works:
 *  - User types/confirms client name + project name
 *  - On save: POST /api/associations/bulk-link
 *    → backend scans status_mirror, projects_mirror, invoices_mirror, web_invoices_mirror
 *    → upserts a record_links row (manual, confidence 100) for EVERY matching record
 *  - Results summary shown (N records linked per table)
 *
 * Props
 * -----
 * sourceTable   string   — 'status' | 'projects' | 'invoices' | 'web_invoices'
 * record        object   — the record being linked (fields, id)
 * onClose       () => void
 * onSaved       (association) => void   optional
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { Link2, Loader2, X, Search, CheckCircle2, AlertCircle, Briefcase, Users, RefreshCw } from 'lucide-react'
import { api } from '../services/api'
import { useToast } from '../context/ToastContext'

// Pretty table names for display
const TABLE_LABELS = {
  status:       'Status Board',
  projects:     'Projects',
  invoices:     'Invoices',
  web_invoices: 'Web Invoices',
}

export default function AssociationLinkModal({ sourceTable, record, onClose, onSaved }) {
  const toast = useToast()
  const fields = record?.fields || {}

  // Pre-fill from the record's own fields
  const [clientName,  setClientName]  = useState(
    record?.association?.client?.name || fields['Client'] || ''
  )
  const [projectName, setProjectName] = useState(
    record?.association?.project?.name ||
    fields['Project'] ||
    fields['Project Name'] ||
    ''
  )

  const [saving,   setSaving]   = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const [result,   setResult]   = useState(null)   // bulk-link result after save
  const [error,    setError]    = useState(null)

  // Search suggestions
  const [query,      setQuery]      = useState('')
  const [searching,  setSearching]  = useState(false)
  const [suggestions, setSuggestions] = useState({ clients: [], projects: [] })
  const searchRef = useRef(null)
  const debounceRef = useRef(null)

  // Focus first input on open
  useEffect(() => {
    const t = setTimeout(() => searchRef.current?.focus(), 80)
    return () => clearTimeout(t)
  }, [])

  // ESC closes
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  // Debounced entity search
  const handleSearch = useCallback((val) => {
    setQuery(val)
    clearTimeout(debounceRef.current)
    if (!val.trim() || val.trim().length < 2) {
      setSuggestions({ clients: [], projects: [] })
      return
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await api.associations.search(val.trim(), 8)
        setSuggestions(res || { clients: [], projects: [] })
      } catch {
        setSuggestions({ clients: [], projects: [] })
      } finally {
        setSearching(false)
      }
    }, 300)
  }, [])

  // ── Save: bulk-link ────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!clientName.trim() && !projectName.trim()) {
      toast('Enter at least a client or project name', 'error')
      return
    }
    setSaving(true)
    setError(null)
    setResult(null)
    try {
      const res = await api.associations.bulkLink({
        client_name:  clientName.trim(),
        project_name: projectName.trim(),
      })
      setResult(res)
      toast(`Linked ${res.total} record${res.total !== 1 ? 's' : ''} across modules`, 'success')
      onSaved?.(res)
    } catch (e) {
      setError(e.message || 'Failed to save association')
    } finally {
      setSaving(false)
    }
  }

  // ── Unlink THIS record ─────────────────────────────────────────────────
  const handleUnlink = async () => {
    if (!record?.id) return
    setUnlinking(true)
    setError(null)
    try {
      await api.associations.unlink(sourceTable, record.id)
      toast('Association removed', 'info')
      onSaved?.(null)
      onClose()
    } catch (e) {
      setError(e.message || 'Failed to remove association')
    } finally {
      setUnlinking(false)
    }
  }

  const hasExistingLink = !!(record?.association?.client || record?.association?.project)
  const showSuggestions = suggestions.clients.length > 0 || suggestions.projects.length > 0

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.62)', backdropFilter: 'blur(8px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-lg rounded-[22px] overflow-hidden"
        style={{
          background: 'var(--card-bg)',
          border: '1px solid var(--card-border)',
          boxShadow: '0 24px 64px rgba(15,23,42,0.22)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Link records to canonical association"
      >
        {/* Header */}
        <div className="px-5 py-4 flex items-start justify-between gap-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)', background: 'var(--accent-dim)' }}>
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-semibold mb-2"
              style={{ background: 'var(--card-bg)', border: '1px solid var(--accent-soft)', color: 'var(--accent)' }}>
              <Link2 size={11} />
              Cross-module link
            </div>
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>
              Link to canonical identity
            </h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
              Links ALL matching records in Status, Projects, and Invoices to this client + project.
            </p>
          </div>
          <button onClick={onClose} className="btn-icon p-2 flex-shrink-0" style={{ color: 'var(--text-3)' }}>
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">

          {/* ── Fields ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="assoc-client">
                <Users size={11} className="inline mr-1" />
                Client name
              </label>
              <input
                id="assoc-client"
                ref={searchRef}
                className="input"
                value={clientName}
                onChange={e => setClientName(e.target.value)}
                placeholder="e.g. Birla Open Minds"
              />
            </div>
            <div>
              <label className="label" htmlFor="assoc-project">
                <Briefcase size={11} className="inline mr-1" />
                Project name
              </label>
              <input
                id="assoc-project"
                className="input"
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                placeholder="e.g. PMS Phase 1.1"
              />
            </div>
          </div>

          {/* ── Search existing entities ─────────────────────────────── */}
          <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
            <label className="label mb-2" htmlFor="assoc-search">
              <Search size={11} className="inline mr-1" />
              Search existing linked names
            </label>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--text-3)' }} />
              <input
                id="assoc-search"
                className="input pl-8"
                value={query}
                onChange={e => handleSearch(e.target.value)}
                placeholder="Type to search existing client / project names…"
              />
              {searching && (
                <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin"
                  style={{ color: 'var(--text-3)' }} />
              )}
            </div>

            {showSuggestions && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                {suggestions.clients.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold mb-2" style={{ color: 'var(--text-3)' }}>
                      Clients
                    </p>
                    <div className="space-y-1.5">
                      {suggestions.clients.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => { setClientName(c.name); setQuery(''); setSuggestions({ clients: [], projects: [] }) }}
                          className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                          style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-dim)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'var(--card-bg)'}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {suggestions.projects.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold mb-2" style={{ color: 'var(--text-3)' }}>
                      Projects
                    </p>
                    <div className="space-y-1.5">
                      {suggestions.projects.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setProjectName(p.name)
                            if (p.client_name) setClientName(p.client_name)
                            setQuery('')
                            setSuggestions({ clients: [], projects: [] })
                          }}
                          className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                          style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-dim)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'var(--card-bg)'}
                        >
                          <span className="block font-semibold" style={{ color: 'var(--text-1)' }}>{p.name}</span>
                          {p.client_name && (
                            <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{p.client_name}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Error ───────────────────────────────────────────────────── */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
              <AlertCircle size={14} className="flex-shrink-0" />
              {error}
            </div>
          )}

          {/* ── Success result ──────────────────────────────────────────── */}
          {result && (
            <div className="rounded-xl p-4 space-y-2"
              style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)' }}>
              <div className="flex items-center gap-2">
                <CheckCircle2 size={15} style={{ color: '#10b981' }} />
                <p className="text-sm font-semibold" style={{ color: '#10b981' }}>
                  Linked {result.total} record{result.total !== 1 ? 's' : ''} across modules
                </p>
              </div>
              {result.linked_counts && Object.keys(result.linked_counts).length > 0 && (
                <div className="flex flex-wrap gap-2 mt-1">
                  {Object.entries(result.linked_counts).map(([table, count]) => (
                    <span key={table}
                      className="inline-flex items-center px-2 py-1 rounded-lg text-[11px] font-medium"
                      style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}>
                      {TABLE_LABELS[table] || table}: <strong className="ml-1">{count}</strong>
                    </span>
                  ))}
                </div>
              )}
              <p className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>
                All matched records now share the same canonical client + project identity.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 flex items-center justify-between gap-3 flex-shrink-0"
          style={{ borderTop: '1px solid var(--border)' }}>
          {hasExistingLink ? (
            <button
              onClick={handleUnlink}
              disabled={unlinking || saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{ color: '#f87171', border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.06)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.12)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(239,68,68,0.06)'}
            >
              {unlinking ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
              Remove this link
            </button>
          ) : <span />}

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{ background: 'var(--bg-input)', color: 'var(--text-2)' }}
            >
              {result ? 'Done' : 'Cancel'}
            </button>
            {!result && (
              <button
                onClick={handleSave}
                disabled={saving || (!clientName.trim() && !projectName.trim())}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                style={{ background: 'var(--accent-btn)', color: '#fff' }}
              >
                {saving ? <Loader2 size={11} className="animate-spin" /> : <Link2 size={11} />}
                {saving ? 'Linking…' : 'Link across all modules'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
