/**
 * SharedView — public status workspace
 *
 * Route: /view/:token  (no auth required)
 * Fetches records via GET /api/public/view/:token
 * Supports read-only and edit-capable links depending on access_mode.
 */

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Activity, AlertCircle, Clock, Columns, Eye, GripVertical,
  LayoutGrid, List, Loader2, Pencil, RefreshCw, Search, Shield, X,
} from 'lucide-react'
import { api } from '../services/api'

const THEME_PRESETS = {
  cobalt: { accent: '#2563eb', accentDim: 'rgba(37,99,235,0.12)', accentSoft: 'rgba(37,99,235,0.24)' },
  emerald: { accent: '#059669', accentDim: 'rgba(5,150,105,0.12)', accentSoft: 'rgba(5,150,105,0.24)' },
  amber: { accent: '#d97706', accentDim: 'rgba(217,119,6,0.12)', accentSoft: 'rgba(217,119,6,0.24)' },
  rose: { accent: '#e11d48', accentDim: 'rgba(225,29,72,0.12)', accentSoft: 'rgba(225,29,72,0.24)' },
  slate: { accent: '#475569', accentDim: 'rgba(71,85,105,0.12)', accentSoft: 'rgba(71,85,105,0.24)' },
}
function resolveTheme(themeId) { return THEME_PRESETS[themeId] || THEME_PRESETS.cobalt }

function fmtDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'long', year: 'numeric',
    })
  } catch { return iso }
}

function fmtDateTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('en-IN', {
      dateStyle: 'medium', timeStyle: 'short',
    })
  } catch { return iso }
}

function isExpired(iso) {
  if (!iso) return false
  return new Date(iso) < new Date()
}

const PALETTE = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#ec4899','#0ea5e9','#eab308','#14b8a6','#f97316']
const _cmap = {}
function clientColor(name) {
  if (!_cmap[name]) _cmap[name] = PALETTE[Object.keys(_cmap).length % PALETTE.length]
  return _cmap[name]
}
function hexRgba(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${a})`
}

const STATUS_CFG = {
  'Completed':     { bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.35)',  dot: '#10b981', text: '#059669' },
  'In progress':   { bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.35)',  dot: '#3b82f6', text: '#2563eb' },
  'On Hold':       { bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.35)',  dot: '#f59e0b', text: '#d97706' },
  'Input Pending': { bg: 'rgba(249,115,22,0.12)',  border: 'rgba(249,115,22,0.35)',  dot: '#f97316', text: '#ea580c' },
  'Not started':   { bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.30)', dot: '#94a3b8', text: '#64748b' },
}
const DEFAULT_BOARD_ORDER = ['In progress', 'Input Pending', 'On Hold', 'Not started', 'Completed']
const DEFAULT_COLS = ['Client', 'Project', 'Status', 'Short Status']
const ALL_COLS = ['Client', 'Project', 'Status', 'Short Status', 'Current Status (Detailed)', 'Last Modified']
const COLUMN_ALIASES = {
  'Detailed Status': 'Current Status (Detailed)',
  'Current Status (Detailed)': 'Current Status (Detailed)',
  'Last Modified': 'Last Modified',
}

function statusStyle(s) {
  return STATUS_CFG[s] || { bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.3)', dot: '#94a3b8', text: '#64748b' }
}

function StatusBadge({ status }) {
  if (!status) return null
  const st = statusStyle(status)
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold"
      style={{ background: st.bg, border: `1px solid ${st.border}`, color: st.text }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: st.dot }} />
      {status}
    </span>
  )
}

function SnapshotSummary({ viewConfig, accessMode }) {
  const chips = [
    viewConfig?.filterClient ? `Shared client: ${viewConfig.filterClient}` : null,
    viewConfig?.filterStatus ? `Shared status: ${viewConfig.filterStatus}` : null,
    viewConfig?.search ? `Shared search: "${viewConfig.search}"` : null,
    accessMode === 'edit' ? 'Link permission: can edit' : 'Link permission: read only',
  ].filter(Boolean)

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map(chip => (
        <span key={chip}
          className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold"
          style={{ background: '#ffffff', border: '1px solid #e5e7eb', color: '#475569' }}>
          {chip}
        </span>
      ))}
    </div>
  )
}

function PublicStatusDashboard({ records, statusOptions, filterStatus, onFilterStatus, accent }) {
  const total = records.length
  const counts = statusOptions.reduce((acc, s) => {
    acc[s] = records.filter(r => (r.fields?.['Status'] || 'Not started') === s).length
    return acc
  }, {})

  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => onFilterStatus('')}
        className="flex items-center gap-2 px-3 py-2 rounded-xl transition-all text-left"
        style={{
          background: !filterStatus ? accent.accent : '#ffffff',
          border: !filterStatus ? `1px solid ${accent.accent}` : '1px solid #e5e7eb',
          color: !filterStatus ? '#ffffff' : '#475569',
        }}
      >
        <span className="text-lg font-bold leading-none">{total}</span>
        <span className="text-xs font-semibold">All Projects</span>
      </button>
      {statusOptions.map(s => {
        const st = statusStyle(s)
        const active = filterStatus === s
        return (
          <button
            key={s}
            onClick={() => onFilterStatus(active ? '' : s)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl transition-all text-left"
            style={{
              background: active ? st.bg : '#ffffff',
              border: active ? `1px solid ${st.border}` : '1px solid #e5e7eb',
            }}
          >
            <span className="text-lg font-bold leading-none" style={{ color: st.text }}>{counts[s] || 0}</span>
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: st.dot }} />
              <span className="text-xs font-semibold" style={{ color: active ? st.text : '#64748b' }}>{s}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function PublicEditModal({ record, statusOptions, saving, onClose, onSave }) {
  const fields = record?.fields || {}
  const [form, setForm] = useState({
    status: fields['Status'] || '',
    short_status: fields['Short Status'] || '',
    current_status_detailed: fields['Current Status (Detailed)'] || '',
  })

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  if (!record) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl"
        style={{ background: '#fff', border: '1px solid #e5e7eb', maxHeight: '92vh', overflow: 'auto' }}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 sticky top-0 z-10"
          style={{ background: '#fff', borderBottom: '1px solid #e5e7eb' }}>
          <div>
            <h2 className="text-base font-bold text-gray-900">Update Status</h2>
            <p className="text-xs text-gray-500 mt-0.5">{fields['Client']} · {fields['Project']}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        <form
          onSubmit={e => {
            e.preventDefault()
            onSave(form)
          }}
          className="px-5 py-4 space-y-4"
        >
          <div>
            <label className="block text-xs font-semibold mb-2 text-gray-700">Status</label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
              {statusOptions.map(opt => {
                const sc = statusStyle(opt)
                const active = form.status === opt
                return (
                  <button key={opt} type="button" onClick={() => setForm(f => ({ ...f, status: active ? '' : opt }))}
                    className="py-2 px-1 rounded-xl text-[11px] font-semibold text-center transition-all leading-tight"
                    style={{
                      background: active ? sc.bg : '#f8fafc',
                      color: active ? sc.color : '#64748b',
                      border: `1.5px solid ${active ? sc.border : '#e5e7eb'}`,
                    }}>
                    {opt}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5 text-gray-700">Headline</label>
            <input
              type="text"
              className="w-full rounded-xl border px-3 py-2 text-sm outline-none"
              style={{ borderColor: '#e5e7eb' }}
              value={form.short_status}
              onChange={e => setForm(f => ({ ...f, short_status: e.target.value }))}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5 text-gray-700">Detail</label>
            <textarea
              rows={5}
              className="w-full rounded-xl border px-3 py-2 text-sm outline-none resize-none"
              style={{ borderColor: '#e5e7eb' }}
              value={form.current_status_detailed}
              onChange={e => setForm(f => ({ ...f, current_status_detailed: e.target.value }))}
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-xl border" style={{ borderColor: '#e5e7eb', color: '#475569' }}>Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-xl bg-blue-600 text-white font-semibold flex items-center gap-2">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Pencil size={13} />}
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function PublicStatusCard({ record, canEdit, onEdit, compact = false, showClientAccents = true }) {
  const [expanded, setExpanded] = useState(false)
  const f = record.fields || {}
  const client = f['Client'] || ''
  const project = f['Project'] || 'Unknown Project'
  const short = f['Short Status'] || ''
  const detail = f['Current Status (Detailed)'] || ''
  const status = f['Status'] || ''
  const clr = clientColor(client)
  const hasDetail = detail.trim() && detail.trim() !== short.trim()

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ background: '#ffffff', border: '1px solid #e5e7eb', boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
      {showClientAccents && <div className="h-1" style={{ background: clr }} />}
      <div className={compact ? 'p-4' : 'p-5'}>
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="text-base font-bold text-gray-900 leading-snug">{project}</h3>
          <div className="flex items-center gap-2">
            {status && <StatusBadge status={status} />}
            {canEdit && (
              <button onClick={() => onEdit(record)} className="p-1 rounded-lg text-gray-400 hover:text-blue-600" title="Edit">
                <Pencil size={12} />
              </button>
            )}
          </div>
        </div>
        {short && <p className="text-sm font-semibold text-gray-800 leading-snug mb-3">{short}</p>}
        {hasDetail && (
          <>
            {expanded
              ? <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{detail}</p>
              : <p className="text-sm text-gray-500 leading-relaxed line-clamp-3">{detail}</p>}
            <button onClick={() => setExpanded(x => !x)} className="mt-2 flex items-center gap-1 text-xs font-semibold" style={{ color: clr }}>
              {expanded ? <><X size={12} /> Show less</> : <><Eye size={12} /> Show more</>}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function CardView({ records, canEdit, onEdit, compact = false, showClientAccents = true }) {
  const grouped = records.reduce((acc, r) => {
    const cl = r.fields?.['Client'] || 'Unknown'
    if (!acc[cl]) acc[cl] = []
    acc[cl].push(r)
    return acc
  }, {})

  return (
    <div className="space-y-8">
      {Object.entries(grouped).sort(([a],[b]) => a.localeCompare(b)).map(([client, recs]) => {
        const clrHex = clientColor(client)
        return (
          <section key={client}>
            <div className="flex items-center gap-3 mb-4">
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold"
                style={{
                  background: showClientAccents ? hexRgba(clrHex, 0.1) : '#ffffff',
                  border: `1.5px solid ${showClientAccents ? hexRgba(clrHex, 0.3) : '#e5e7eb'}`,
                  color: showClientAccents ? clrHex : '#334155',
                }}>
                <span className="w-2 h-2 rounded-full" style={{ background: clrHex }} />
                {client}
              </span>
              <span className="text-sm text-gray-400">{recs.length} project{recs.length !== 1 ? 's' : ''}</span>
            </div>
            <div className={`grid grid-cols-1 sm:grid-cols-2 ${compact ? 'gap-3' : 'gap-4'}`}>
              {recs.map(r => <PublicStatusCard key={r.id} record={r} canEdit={canEdit} onEdit={onEdit} compact={compact} showClientAccents={showClientAccents} />)}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function ListView({ records, columns, canEdit, onEdit, showClientAccents = true }) {
  const cols = (columns || DEFAULT_COLS)
    .map(c => COLUMN_ALIASES[c] || c)
    .filter(c => ALL_COLS.includes(c))

  return (
    <div className="overflow-x-auto rounded-2xl" style={{ border: '1px solid #e5e7eb' }}>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
            {cols.map(col => (
              <th key={col} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap">
                {col}
              </th>
            ))}
            {canEdit && <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap text-right">Edit</th>}
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => {
            const f = r.fields || {}
            const clr = clientColor(f['Client'] || '')
            return (
              <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? '#ffffff' : '#fafafa' }}>
                {cols.map(col => (
                  <td key={col} className="px-4 py-3 align-top">
                    {col === 'Client' && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: showClientAccents ? hexRgba(clr, 0.1) : '#f8fafc', color: showClientAccents ? clr : '#475569' }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: clr }} />
                        {f['Client'] || '—'}
                      </span>
                    )}
                    {col === 'Project' && <span className="font-semibold text-gray-900">{f['Project'] || '—'}</span>}
                    {col === 'Status' && <StatusBadge status={f['Status']} />}
                    {col === 'Short Status' && <span className="text-gray-700">{f['Short Status'] || '—'}</span>}
                    {col === 'Current Status (Detailed)' && <span className="text-gray-500 text-xs leading-relaxed line-clamp-2">{f['Current Status (Detailed)'] || '—'}</span>}
                    {col === 'Last Modified' && <span className="text-gray-500 text-xs whitespace-nowrap">{fmtDateTime(f['lastModifiedTime'] || r.createdTime || '') || '—'}</span>}
                  </td>
                ))}
                {canEdit && (
                  <td className="px-4 py-3 align-top text-right">
                    <button onClick={() => onEdit(r)} className="p-1 rounded-lg text-gray-400 hover:text-blue-600" title="Edit">
                      <Pencil size={12} />
                    </button>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function BoardView({ records, statusOptions, canEdit, onEdit, onDropStatus, compact = false, showClientAccents = true }) {
  const [draggedId, setDraggedId] = useState('')
  const byStatus = statusOptions.reduce((acc, s) => ({ ...acc, [s]: [] }), {})
  records.forEach(r => {
    const s = r.fields?.['Status'] || 'Not started'
    if (!byStatus[s]) byStatus[s] = []
    byStatus[s].push(r)
  })

  return (
    <div className="flex gap-4 overflow-x-auto pb-2" style={{ minHeight: 200 }}>
      {statusOptions.map(status => {
        const recs = byStatus[status] || []
        const st = statusStyle(status)
        return (
          <div
            key={status}
            className="flex-shrink-0 w-[250px] sm:w-72 rounded-2xl overflow-hidden"
            style={{ background: '#ffffff', border: '1px solid #e5e7eb' }}
            onDragOver={e => { if (canEdit) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } }}
            onDrop={e => {
              if (!canEdit) return
              e.preventDefault()
              const id = e.dataTransfer.getData('text/plain')
              setDraggedId('')
              if (id) onDropStatus(id, status)
            }}
          >
            <div className="px-4 py-3 flex items-center justify-between" style={{ background: st.bg, borderBottom: `1px solid ${st.border}` }}>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: st.dot }} />
                <span className="text-sm font-bold" style={{ color: st.text }}>{status}</span>
              </div>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: st.border, color: st.text }}>
                {recs.length}
              </span>
            </div>
            <div className="p-3 space-y-3" style={{ minHeight: 100 }}>
              {recs.length === 0 && <p className="text-xs text-center py-4 text-gray-400">{canEdit ? 'Drop here' : 'No projects'}</p>}
              {recs.map(r => {
                const f = r.fields || {}
                const clr = clientColor(f['Client'] || '')
                return (
                  <div key={r.id} className="rounded-xl p-3" draggable={false}
                    style={{ background: draggedId === r.id ? '#eef2ff' : '#f8fafc', border: '1px solid #e5e7eb' }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold mb-1" style={{ color: showClientAccents ? clr : '#64748b' }}>{f['Client'] || ''}</div>
                        <div className="text-sm font-bold text-gray-900 mb-1 leading-tight">{f['Project'] || 'Unknown Project'}</div>
                        {f['Short Status'] && <p className={`${compact ? 'text-[11px]' : 'text-xs'} text-gray-500 leading-relaxed line-clamp-2`}>{f['Short Status']}</p>}
                      </div>
                      <div className="flex items-center gap-1">
                        {canEdit && (
                          <div
                            draggable
                            onDragStart={e => {
                              e.dataTransfer.setData('text/plain', r.id)
                              e.dataTransfer.effectAllowed = 'move'
                              setDraggedId(r.id)
                            }}
                            onDragEnd={() => setDraggedId('')}
                            className="p-1 rounded-lg text-gray-400 cursor-grab"
                            title="Drag to move"
                          >
                            <GripVertical size={12} />
                          </div>
                        )}
                        {canEdit && (
                          <button onClick={() => onEdit(r)} className="p-1 rounded-lg text-gray-400 hover:text-blue-600" title="Edit">
                            <Pencil size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function SharedView() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [saveError, setSaveError] = useState('')
  const [search, setSearch] = useState('')
  const [filterClient, setFilterClient] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [viewType, setViewType] = useState('card')
  const [editRecord, setEditRecord] = useState(null)
  const [savingRecordId, setSavingRecordId] = useState('')
  const [pendingStatusById, setPendingStatusById] = useState({})

  const load = async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const res = await api.sharedViews.publicGet(token)
      setData(res)
      setRecords(res.records || [])
      setPendingStatusById({})
      const vc = res.view_config || {}
      setViewType(vc.type || 'card')
      if (!search && vc.search) setSearch(vc.search)
      if (!filterClient && vc.filterClient) setFilterClient(vc.filterClient)
      if (!filterStatus && vc.filterStatus) setFilterStatus(vc.filterStatus)
    } catch (e) {
      setError(e.message || 'This link is unavailable')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (token) load()
  }, [token])

  const canEdit = (data?.access_mode || 'read') === 'edit'
  const vc = data?.view_config || {}
  const theme = resolveTheme(vc.theme)
  const compact = vc.density === 'compact'
  const showDashboard = vc.showDashboard !== false
  const showClientAccents = vc.showClientAccents !== false
  const accentStyle = {
    '--share-accent': theme.accent,
    '--share-accent-dim': theme.accentDim,
    '--share-accent-soft': theme.accentSoft,
  }
  const recordsForView = useMemo(
    () => records.map(r => {
      const pendingStatus = pendingStatusById[r.id]
      return pendingStatus ? { ...r, fields: { ...r.fields, Status: pendingStatus } } : r
    }),
    [records, pendingStatusById]
  )
  const listColumns = useMemo(() => {
    const raw = vc.columns || DEFAULT_COLS
    return raw.map(c => COLUMN_ALIASES[c] || c).filter(c => ALL_COLS.includes(c))
  }, [vc.columns])

  const allClients = useMemo(
    () => [...new Set(records.map(r => r.fields?.['Client']).filter(Boolean))].sort(),
    [records]
  )
  const statusOptions = useMemo(() => {
    const dynamic = [...new Set(recordsForView.map(r => r.fields?.['Status']).filter(Boolean))]
    const ordered = [...DEFAULT_BOARD_ORDER.filter(s => dynamic.includes(s)), ...dynamic.filter(s => !DEFAULT_BOARD_ORDER.includes(s))]
    return ordered.length ? ordered : DEFAULT_BOARD_ORDER
  }, [recordsForView])

  const filtered = useMemo(() => {
    return recordsForView.filter(r => {
      const f = r.fields || {}
      if (filterClient && f['Client'] !== filterClient) return false
      if (filterStatus && (f['Status'] || 'Not started') !== filterStatus) return false
      if (search) {
        const q = search.toLowerCase()
        const hay = [f['Client'], f['Project'], f['Short Status'], f['Current Status (Detailed)'], f['Status']].join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [recordsForView, filterClient, filterStatus, search])

  async function saveRecordChanges(record, patch) {
    setSavingRecordId(record.id)
    setSaveError('')
    try {
      await api.sharedViews.publicUpdate(token, record.id, patch)
      setRecords(rs => rs.map(r => {
        if (r.id !== record.id) return r
        return {
          ...r,
          fields: {
            ...r.fields,
            ...(patch.status !== undefined ? { Status: patch.status } : {}),
            ...(patch.short_status !== undefined ? { 'Short Status': patch.short_status } : {}),
            ...(patch.current_status_detailed !== undefined ? { 'Current Status (Detailed)': patch.current_status_detailed } : {}),
          },
        }
      }))
      setEditRecord(null)
    } catch (e) {
      setSaveError(e.message || 'Failed to update')
    } finally {
      setSavingRecordId('')
    }
  }

  async function moveRecordToStatus(recordId, status) {
    const record = records.find(r => r.id === recordId)
    const liveRecord = recordsForView.find(r => r.id === recordId) || record
    if (!record) return
    const fromStatus = liveRecord?.fields?.['Status'] || 'Not started'
    if (fromStatus === status) return

    setPendingStatusById(prev => ({ ...prev, [recordId]: status }))
    try {
      await api.sharedViews.publicUpdate(token, recordId, { status })
      setRecords(rs => rs.map(r => r.id === recordId ? { ...r, fields: { ...r.fields, Status: status } } : r))
    } catch (e) {
      setSaveError(e.message || 'Failed to move status')
    } finally {
      setPendingStatusById(prev => {
        const next = { ...prev }
        delete next[recordId]
        return next
      })
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#f8fafc' }}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={28} className="animate-spin text-blue-500" />
          <p className="text-sm text-gray-500">Loading status update…</p>
        </div>
      </div>
    )
  }

  if (error) {
    const isDisabled = /disabled/i.test(error)
    const isExpiredLink = /expired/i.test(error)
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#f8fafc' }}>
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-2xl p-8 text-center shadow-sm" style={{ border: '1px solid #e5e7eb' }}>
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5 ${isDisabled ? 'bg-amber-50' : 'bg-red-50'}`}
              style={{ border: `1px solid ${isDisabled ? 'rgba(245,158,11,0.25)' : 'rgba(239,68,68,0.2)'}` }}>
              <AlertCircle size={28} className={isDisabled ? 'text-amber-500' : 'text-red-500'} />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">{isExpiredLink ? 'Link Expired' : 'Access Restricted'}</h1>
            <p className="text-sm text-gray-600 leading-relaxed">
              {isDisabled ? 'This link has been disabled by the admin.' : isExpiredLink ? 'This link has passed its expiry date.' : 'This page is not accessible.'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const title = data?.title || 'Project Status Update'
  const expiresAt = data?.expires_at
  const createdAt = data?.created_at
  const expired = isExpired(expiresAt)

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc', ...accentStyle }}>
      <header style={{ background: '#ffffff', borderBottom: '1px solid #e5e7eb' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: theme.accentDim, border: `1px solid ${theme.accentSoft}` }}>
                <Activity size={18} style={{ color: theme.accent }} />
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900 leading-tight">{title}</h1>
                <p className="text-xs text-gray-500 mt-0.5">
                  {filtered.length} shown of {records.length} project update{records.length !== 1 ? 's' : ''} · {allClients.length} clients
                  {createdAt && ` · ${fmtDate(createdAt)}`}
                </p>
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-gray-400">
              <Shield size={11} />
              FinTrack
            </div>
          </div>

          <SnapshotSummary viewConfig={vc} accessMode={data?.access_mode || 'read'} />

          {showDashboard && records.length > 0 && (
            <PublicStatusDashboard
              records={records}
              statusOptions={statusOptions}
              filterStatus={filterStatus}
              onFilterStatus={setFilterStatus}
              accent={theme}
            />
          )}

          <div className="flex flex-col lg:flex-row gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" />
              <input
                type="text"
                className="w-full rounded-xl border bg-white pl-8 pr-3 py-2 text-sm outline-none"
                style={{ borderColor: '#e5e7eb' }}
                placeholder="Search projects, clients, status…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <select
              className="rounded-xl border bg-white px-3 py-2 text-sm outline-none"
              style={{ borderColor: '#e5e7eb' }}
              value={filterClient}
              onChange={e => setFilterClient(e.target.value)}
            >
              <option value="">All clients</option>
              {allClients.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              className="rounded-xl border bg-white px-3 py-2 text-sm outline-none"
              style={{ borderColor: '#e5e7eb' }}
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
            >
              <option value="">All statuses</option>
              {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="flex items-center rounded-xl overflow-hidden border bg-slate-50" style={{ borderColor: '#e5e7eb' }}>
              {[
                { id: 'card', Icon: LayoutGrid, label: 'Card' },
                { id: 'list', Icon: List, label: 'List' },
                { id: 'board', Icon: Columns, label: 'Board' },
              ].map(({ id, Icon, label }) => (
                <button
                  key={id}
                  onClick={() => setViewType(id)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold"
                  style={{ background: viewType === id ? '#ffffff' : 'transparent', color: viewType === id ? theme.accent : '#64748b' }}
                >
                  <Icon size={12} />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => load({ silent: true })}
              className="rounded-xl border bg-white px-3 py-2 text-sm font-medium flex items-center gap-2"
              style={{ borderColor: '#e5e7eb', color: '#475569' }}
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      {expiresAt && (
        <div className={`py-2 text-center text-xs font-medium ${expired ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>
          <Clock className="inline mr-1" size={11} />
          {expired ? `This link expired on ${fmtDateTime(expiresAt)}` : `This link expires on ${fmtDateTime(expiresAt)}`}
        </div>
      )}

      <main className={`mx-auto px-4 sm:px-6 py-8 ${viewType === 'board' ? 'max-w-full' : 'max-w-6xl'}`}>
        {saveError && (
          <div className="mb-4 rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#dc2626' }}>
            {saveError}
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-500 text-sm">No project updates match the current filters.</p>
          </div>
        ) : (
          <>
            {viewType === 'card' && <CardView records={filtered} canEdit={canEdit} onEdit={setEditRecord} compact={compact} showClientAccents={showClientAccents} />}
            {viewType === 'list' && <ListView records={filtered} columns={listColumns} canEdit={canEdit} onEdit={setEditRecord} showClientAccents={showClientAccents} />}
            {viewType === 'board' && <BoardView records={filtered} statusOptions={statusOptions} canEdit={canEdit} onEdit={setEditRecord} onDropStatus={moveRecordToStatus} compact={compact} showClientAccents={showClientAccents} />}
          </>
        )}
      </main>

      <footer className="py-8 text-center" style={{ borderTop: '1px solid #e5e7eb' }}>
        <div className="flex items-center justify-center gap-1.5 text-xs text-gray-400 mb-1">
          <Shield size={11} />
          <span>FinTrack · Project Status</span>
        </div>
        {createdAt && <p className="text-[11px] text-gray-300">Generated {fmtDateTime(createdAt)}</p>}
      </footer>

      {canEdit && editRecord && (
        <PublicEditModal
          record={editRecord}
          statusOptions={statusOptions}
          saving={savingRecordId === editRecord.id}
          onClose={() => setEditRecord(null)}
          onSave={form => saveRecordChanges(editRecord, form)}
        />
      )}
    </div>
  )
}
