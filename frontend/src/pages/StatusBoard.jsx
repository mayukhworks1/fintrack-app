/**
 * Status Board — Current Status module (Master@2026)
 *
 * Displays live project status cards grouped by client.
 * Editor role can create, edit, and delete entries.
 * Viewer role sees read-only cards.
 *
 * Each card shows:
 *   • Short Status  — one-liner headline
 *   • Current Status (Detailed) — full text body
 *   • Client + Project badges
 *   • Last updated indicator (Teable record ID stub)
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Activity, Plus, Pencil, Trash2, X, Check,
  ChevronDown, ChevronUp, RefreshCw, Search,
  AlertCircle, Loader2, ClipboardList,
} from 'lucide-react'
import { api } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

// ── client colour map — consistent colours per client name ──────────────────
const CLIENT_COLOURS = [
  { bg: 'rgba(37,99,235,0.10)',   border: 'rgba(37,99,235,0.25)',   text: '#3b82f6' },
  { bg: 'rgba(139,92,246,0.10)',  border: 'rgba(139,92,246,0.25)',  text: '#8b5cf6' },
  { bg: 'rgba(16,185,129,0.10)',  border: 'rgba(16,185,129,0.25)',  text: '#10b981' },
  { bg: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.25)',  text: '#f59e0b' },
  { bg: 'rgba(239,68,68,0.10)',   border: 'rgba(239,68,68,0.25)',   text: '#ef4444' },
  { bg: 'rgba(236,72,153,0.10)',  border: 'rgba(236,72,153,0.25)',  text: '#ec4899' },
  { bg: 'rgba(14,165,233,0.10)',  border: 'rgba(14,165,233,0.25)',  text: '#0ea5e9' },
  { bg: 'rgba(234,179,8,0.10)',   border: 'rgba(234,179,8,0.25)',   text: '#eab308' },
]

const CLIENT_OPTS = [
  'Birla Open Minds', 'Maitrimetal (Zoho)', 'The Works (Inhouse)',
  'Aromatherapy (Zoho)', 'MRSC (Jinesh Jain)', 'Jacarti', 'IIAF',
  'Andre-Michael (Himanshu)',
]
const PROJECT_OPTS = [
  'PMS – Phase 1.1', 'PMS – Phase 1.2', 'PMS – Phase 1.3 + CR V2',
  'Innovine', 'Zoho Implementation', 'Zoho People – Internal',
  'Zoho Workplace Migration', 'Zoho Ecosystem Discovery',
  'Zoho CRM + WhatsApp', 'Zoho Workplace Setup',
]

function clientColour(name) {
  const idx = CLIENT_OPTS.indexOf(name)
  return CLIENT_COLOURS[(idx >= 0 ? idx : name.charCodeAt(0)) % CLIENT_COLOURS.length]
}

// ── empty state ─────────────────────────────────────────────────────────────
function EmptyState({ onAdd, isEditor }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
        <ClipboardList size={24} style={{ color: 'var(--text-3)' }} />
      </div>
      <p className="text-base font-semibold mb-1" style={{ color: 'var(--text-1)' }}>No status updates yet</p>
      <p className="text-sm mb-6 max-w-xs" style={{ color: 'var(--text-3)' }}>
        Add live project status entries to track what's happening across the portfolio.
      </p>
      {isEditor && (
        <button className="btn-primary flex items-center gap-2 text-sm" onClick={onAdd}>
          <Plus size={14} /> Add First Status
        </button>
      )}
    </div>
  )
}

// ── status card ──────────────────────────────────────────────────────────────
function StatusCard({ record, isEditor, onEdit, onDelete, expanded, onToggle }) {
  const f       = record.fields || {}
  const client  = f['Client'] || '?'
  const project = f['Project'] || '?'
  const short   = f['Short Status'] || ''
  const detail  = f['Current Status (Detailed)'] || ''
  const clr     = clientColour(client)
  const hasDetail = detail && detail.trim() !== short.trim()

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-2 transition-shadow"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
      }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1.5 min-w-0">
          {/* Client badge */}
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold"
            style={{ background: clr.bg, border: `1px solid ${clr.border}`, color: clr.text }}>
            {client}
          </span>
          {/* Project badge */}
          {project && project !== '?' && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
              {project}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {hasDetail && (
            <button
              onClick={onToggle}
              className="btn-icon p-1"
              title={expanded ? 'Collapse' : 'Expand'}
              style={{ color: 'var(--text-3)' }}
            >
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          )}
          {isEditor && (
            <>
              <button onClick={onEdit} className="btn-icon p-1" title="Edit" style={{ color: 'var(--text-3)' }}>
                <Pencil size={13} />
              </button>
              <button onClick={onDelete} className="btn-icon p-1" title="Delete"
                style={{ color: 'rgba(239,68,68,0.7)' }}
                onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                onMouseLeave={e => e.currentTarget.style.color = 'rgba(239,68,68,0.7)'}>
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Short status */}
      {short && (
        <p className="text-sm font-medium leading-snug" style={{ color: 'var(--text-1)' }}>
          {short}
        </p>
      )}

      {/* Detailed status — collapsible */}
      {hasDetail && expanded && (
        <p className="text-[13px] leading-relaxed whitespace-pre-wrap"
          style={{ color: 'var(--text-2)', borderTop: '1px solid var(--border)', paddingTop: '0.5rem', marginTop: '0.25rem' }}>
          {detail}
        </p>
      )}
      {hasDetail && !expanded && (
        <p className="text-[13px] leading-snug line-clamp-2" style={{ color: 'var(--text-3)' }}>
          {detail}
        </p>
      )}
    </div>
  )
}

// ── modal form (create + edit) ───────────────────────────────────────────────
function StatusModal({ initial, onClose, onSave, saving }) {
  const isEdit = !!initial
  const [form, setForm] = useState({
    client: initial?.fields?.['Client'] || '',
    project: initial?.fields?.['Project'] || '',
    short_status: initial?.fields?.['Short Status'] || '',
    current_status_detailed: initial?.fields?.['Current Status (Detailed)'] || '',
  })

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.client || !form.project) return
    onSave(form)
  }

  // Close on Escape
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(6px)' }}>
      <div className="w-full max-w-lg rounded-2xl p-6 shadow-2xl"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>
            {isEdit ? 'Edit Status' : 'New Status Update'}
          </h2>
          <button onClick={onClose} className="btn-icon p-1.5" style={{ color: 'var(--text-3)' }}>
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Client */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
              Client <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <select
              className="input-field w-full text-sm"
              value={form.client}
              onChange={e => set('client', e.target.value)}
              required
            >
              <option value="">Select client…</option>
              {CLIENT_OPTS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Project */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
              Project <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <select
              className="input-field w-full text-sm"
              value={form.project}
              onChange={e => set('project', e.target.value)}
              required
            >
              <option value="">Select project…</option>
              {PROJECT_OPTS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          {/* Short Status */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
              Short Status
              <span className="ml-1 text-[10px] font-normal" style={{ color: 'var(--text-3)' }}>
                — one-line headline
              </span>
            </label>
            <input
              type="text"
              className="input-field w-full text-sm"
              placeholder="e.g. UAT in progress, awaiting client sign-off"
              value={form.short_status}
              onChange={e => set('short_status', e.target.value)}
              maxLength={160}
            />
          </div>

          {/* Detailed */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
              Current Status (Detailed)
            </label>
            <textarea
              className="input-field w-full text-sm resize-none"
              placeholder="Full status narrative — what's happening, blockers, next steps…"
              rows={5}
              value={form.current_status_detailed}
              onChange={e => set('current_status_detailed', e.target.value)}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" className="btn-ghost text-sm px-4 py-2" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary flex items-center gap-2 text-sm px-4 py-2"
              disabled={saving || !form.client || !form.project}
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {isEdit ? 'Save Changes' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── main page ────────────────────────────────────────────────────────────────
export default function StatusBoard() {
  const { isEditor } = useAuth()
  const { showToast } = useToast()

  const [records,      setRecords]      = useState([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(null)
  const [search,       setSearch]       = useState('')
  const [filterClient, setFilterClient] = useState('')
  const [expandedIds,  setExpandedIds]  = useState(new Set())
  const [modal,        setModal]        = useState(null) // null | 'new' | record
  const [saving,       setSaving]       = useState(false)
  const [deleting,     setDeleting]     = useState(null) // record id
  const abortRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.status.list()
      setRecords(res.records || [])
    } catch (e) {
      setError(e.message || 'Failed to load status updates')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // ── filtering ──────────────────────────────────────────────────────────
  const filtered = records.filter(r => {
    const f = r.fields || {}
    if (filterClient && f['Client'] !== filterClient) return false
    if (search) {
      const q = search.toLowerCase()
      const haystack = [
        f['Client'], f['Project'], f['Short Status'],
        f['Current Status (Detailed)'],
      ].join(' ').toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })

  // ── group by client ────────────────────────────────────────────────────
  const grouped = filtered.reduce((acc, r) => {
    const cl = r.fields?.['Client'] || 'Unknown'
    if (!acc[cl]) acc[cl] = []
    acc[cl].push(r)
    return acc
  }, {})

  // ── toggle expand ──────────────────────────────────────────────────────
  function toggleExpand(id) {
    setExpandedIds(s => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  // ── create ─────────────────────────────────────────────────────────────
  async function handleCreate(form) {
    setSaving(true)
    try {
      await api.status.create({
        client: form.client,
        project: form.project,
        short_status: form.short_status,
        current_status_detailed: form.current_status_detailed,
      })
      showToast('Status update created', 'success')
      setModal(null)
      await load()
    } catch (e) {
      showToast(e.message || 'Failed to create', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── edit ───────────────────────────────────────────────────────────────
  async function handleEdit(form) {
    if (!modal?.id) return
    setSaving(true)
    try {
      await api.status.update(modal.id, {
        client: form.client,
        project: form.project,
        short_status: form.short_status,
        current_status_detailed: form.current_status_detailed,
      })
      showToast('Status update saved', 'success')
      setModal(null)
      await load()
    } catch (e) {
      showToast(e.message || 'Failed to save', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── delete ─────────────────────────────────────────────────────────────
  async function handleDelete(record) {
    if (!window.confirm(`Delete status for ${record.fields?.['Client']} / ${record.fields?.['Project']}?`)) return
    setDeleting(record.id)
    try {
      await api.status.delete(record.id)
      showToast('Status update deleted', 'success')
      setRecords(rs => rs.filter(r => r.id !== record.id))
    } catch (e) {
      showToast(e.message || 'Failed to delete', 'error')
    } finally {
      setDeleting(null)
    }
  }

  // ── render ─────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">

      {/* ── Page header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(37,99,235,0.10)', border: '1px solid rgba(37,99,235,0.20)' }}>
            <Activity size={16} style={{ color: 'var(--accent)' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight" style={{ color: 'var(--text-1)' }}>
              Current Status
            </h1>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
              Live project status — {records.length} entries
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="btn-icon p-2"
            title="Refresh"
            style={{ color: 'var(--text-3)' }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          {isEditor && (
            <button
              onClick={() => setModal('new')}
              className="btn-primary flex items-center gap-2 text-sm px-3 py-1.5"
            >
              <Plus size={13} /> Add Status
            </button>
          )}
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-col sm:flex-row gap-2">
        {/* Search */}
        <div className="relative flex-1">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'var(--text-3)' }} />
          <input
            type="text"
            className="input-field w-full pl-8 text-sm"
            placeholder="Search by client, project, or status…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {/* Client filter */}
        <select
          className="input-field text-sm sm:w-52"
          value={filterClient}
          onChange={e => setFilterClient(e.target.value)}
        >
          <option value="">All clients</option>
          {CLIENT_OPTS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--text-3)' }} />
        </div>
      )}

      {/* ── Error ── */}
      {!loading && error && (
        <div className="flex items-start gap-3 p-4 rounded-xl"
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)' }}>
          <AlertCircle size={16} style={{ color: '#ef4444', flexShrink: 0, marginTop: 1 }} />
          <div>
            <p className="text-sm font-medium" style={{ color: '#ef4444' }}>Failed to load</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{error}</p>
            <button onClick={load} className="text-xs font-semibold mt-2" style={{ color: 'var(--accent)' }}>
              Retry
            </button>
          </div>
        </div>
      )}

      {/* ── Empty ── */}
      {!loading && !error && records.length === 0 && (
        <EmptyState onAdd={() => setModal('new')} isEditor={isEditor} />
      )}

      {/* ── No results after filter ── */}
      {!loading && !error && records.length > 0 && filtered.length === 0 && (
        <div className="text-center py-12">
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>No entries match your filter.</p>
          <button className="text-xs font-semibold mt-2" style={{ color: 'var(--accent)' }}
            onClick={() => { setSearch(''); setFilterClient('') }}>
            Clear filters
          </button>
        </div>
      )}

      {/* ── Cards grouped by client ── */}
      {!loading && !error && filtered.length > 0 && Object.entries(grouped)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([client, recs]) => {
          const clr = clientColour(client)
          return (
            <section key={client} className="space-y-3">
              {/* Client group header */}
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold"
                  style={{ background: clr.bg, border: `1px solid ${clr.border}`, color: clr.text }}>
                  {client}
                </span>
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                  {recs.length} {recs.length === 1 ? 'project' : 'projects'}
                </span>
              </div>

              {/* Cards grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {recs.map(r => (
                  <StatusCard
                    key={r.id}
                    record={r}
                    isEditor={isEditor && deleting !== r.id}
                    onEdit={() => setModal(r)}
                    onDelete={() => handleDelete(r)}
                    expanded={expandedIds.has(r.id)}
                    onToggle={() => toggleExpand(r.id)}
                  />
                ))}
              </div>
            </section>
          )
        })
      }

      {/* ── Modal ── */}
      {modal && (
        <StatusModal
          initial={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSave={modal === 'new' ? handleCreate : handleEdit}
          saving={saving}
        />
      )}
    </div>
  )
}
