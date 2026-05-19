import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Activity, AlertCircle, Clock, Columns, Eye, LayoutGrid, List,
  Loader2, Pencil, RefreshCw, Search, Shield, X,
} from 'lucide-react'
import { api } from '../services/api'

const THEME_PRESETS = {
  cobalt: { accent: '#2563eb', accentDim: 'rgba(37,99,235,0.12)', accentSoft: 'rgba(37,99,235,0.24)' },
  emerald: { accent: '#059669', accentDim: 'rgba(5,150,105,0.12)', accentSoft: 'rgba(5,150,105,0.24)' },
  amber: { accent: '#d97706', accentDim: 'rgba(217,119,6,0.12)', accentSoft: 'rgba(217,119,6,0.24)' },
  rose: { accent: '#e11d48', accentDim: 'rgba(225,29,72,0.12)', accentSoft: 'rgba(225,29,72,0.24)' },
  slate: { accent: '#475569', accentDim: 'rgba(71,85,105,0.12)', accentSoft: 'rgba(71,85,105,0.24)' },
}
const PALETTE = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#ec4899','#0ea5e9','#eab308','#14b8a6','#f97316']
const STATUS_CFG = {
  Completed:     { bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.35)',  dot: '#10b981', text: '#059669' },
  'In progress': { bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.35)',  dot: '#3b82f6', text: '#2563eb' },
  'On Hold':     { bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.35)',  dot: '#f59e0b', text: '#d97706' },
  'Input Pending': { bg: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.35)', dot: '#f97316', text: '#ea580c' },
  'Not started': { bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.30)', dot: '#94a3b8', text: '#64748b' },
  Paid:          { bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.35)',  dot: '#10b981', text: '#059669' },
  Pending:       { bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.35)',  dot: '#f59e0b', text: '#d97706' },
  Cancelled:     { bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.30)',   dot: '#ef4444', text: '#dc2626' },
}
const _clientMap = {}
const DEFAULT_BOARD_ORDER = ['In progress', 'Input Pending', 'On Hold', 'Not started', 'Completed']

const RESOURCE_META = {
  status: {
    noun: 'project update',
    plural: 'project updates',
    clientField: 'Client',
    titleField: 'Project',
    statusField: 'Status',
    subtitleFields: ['Short Status'],
    searchFields: ['Client', 'Project', 'Short Status', 'Current Status (Detailed)', 'Status'],
    primaryFilterKey: 'filterClient',
    primaryLabel: 'All clients',
    defaultView: 'card',
    showDashboardByDefault: true,
    columns: ['Client', 'Project', 'Status', 'Short Status', 'Current Status (Detailed)', 'Last Modified'],
    defaultColumns: ['Client', 'Project', 'Status', 'Short Status'],
  },
  projects: {
    noun: 'project',
    plural: 'projects',
    clientField: 'Client',
    titleField: 'Project Name',
    statusField: 'Project Status',
    subtitleFields: ['Health', 'Amount Billed So far'],
    searchFields: ['Client', 'Project Name', 'Project Status', 'Health'],
    primaryFilterKey: 'filterClient',
    primaryLabel: 'All clients',
    defaultView: 'card',
    showDashboardByDefault: false,
    columns: ['Client', 'Project Name', 'Project Status', 'Health', 'Amount Billed So far', 'Actual Profit', 'Profit percentage', 'Last Modified'],
    defaultColumns: ['Client', 'Project Name', 'Project Status', 'Health', 'Amount Billed So far'],
  },
  invoices: {
    noun: 'invoice',
    plural: 'invoices',
    clientField: 'Project',
    titleField: 'Invoice Number',
    statusField: 'Payment Status',
    categoryField: 'Category',
    subtitleFields: ['Project', 'Amount Raised'],
    searchFields: ['Invoice Number', 'Project', 'Category', 'Payment Status', 'Remark'],
    primaryFilterKey: 'filterProject',
    primaryLabel: 'All projects',
    defaultView: 'list',
    showDashboardByDefault: false,
    columns: ['Invoice Number', 'Project', 'Category', 'Payment Status', 'Amount Raised', 'Amount Received', 'Raised Date', 'Cleared Date', 'Next followup', 'Remark', 'Last Modified'],
    defaultColumns: ['Invoice Number', 'Project', 'Category', 'Payment Status', 'Amount Raised', 'Amount Received', 'Raised Date', 'Next followup'],
  },
}
const BOARD_GROUP_OPTIONS = {
  status: ['Status', 'Client'],
  projects: ['Project Status', 'Client', 'Health'],
  invoices: ['Payment Status', 'Project', 'Category'],
}

function resolveTheme(themeId) { return THEME_PRESETS[themeId] || THEME_PRESETS.cobalt }
function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return String(iso).slice(0, 10) }
}
function fmtDateTime(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) }
  catch { return String(iso) }
}
function isExpired(iso) { return iso ? new Date(iso) < new Date() : false }
function clientColor(name) {
  if (!_clientMap[name]) _clientMap[name] = PALETTE[Object.keys(_clientMap).length % PALETTE.length]
  return _clientMap[name]
}
function hexRgba(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${a})`
}
function fmtInr(value) {
  const num = Number(value || 0)
  if (!Number.isFinite(num)) return '—'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(num)
}
function simpleStatusStyle(value) {
  const raw = String(value || '')
  const normalized = raw.toLowerCase()
  if (STATUS_CFG[raw]) return STATUS_CFG[raw]
  if (normalized.includes('complete')) return STATUS_CFG.Completed
  if (normalized.includes('hold')) return STATUS_CFG['On Hold']
  if (normalized.includes('cancel')) return STATUS_CFG.Cancelled
  if (normalized.includes('active') || normalized.includes('progress')) return STATUS_CFG['In progress']
  if (normalized.includes('pending')) return STATUS_CFG.Pending
  if (normalized.includes('not start')) return STATUS_CFG['Not started']
  return { bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.30)', dot: '#94a3b8', text: '#64748b' }
}

function StatusBadge({ value }) {
  if (!value) return null
  const st = simpleStatusStyle(value)
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold"
      style={{ background: st.bg, border: `1px solid ${st.border}`, color: st.text }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: st.dot }} />
      {value}
    </span>
  )
}

function SnapshotSummary({ viewConfig, accessMode }) {
  const chips = [
    viewConfig?.filterClient ? `Shared client: ${viewConfig.filterClient}` : null,
    viewConfig?.filterProject ? `Shared project: ${viewConfig.filterProject}` : null,
    viewConfig?.filterStatus ? `Shared status: ${viewConfig.filterStatus}` : null,
    viewConfig?.filterCategory ? `Shared category: ${viewConfig.filterCategory}` : null,
    viewConfig?.search ? `Shared search: "${viewConfig.search}"` : null,
    accessMode === 'edit' ? 'Link permission: can edit' : 'Link permission: read only',
  ].filter(Boolean)
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map(chip => (
        <span key={chip} className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold"
          style={{ background: '#fff', border: '1px solid #e5e7eb', color: '#475569' }}>
          {chip}
        </span>
      ))}
    </div>
  )
}

function SummaryStrip({ records, statusOptions, filterStatus, onFilterStatus, accent, noun, statusField }) {
  const counts = statusOptions.reduce((acc, s) => {
    acc[s] = records.filter(r => (r.fields?.[statusField] || '') === s).length
    return acc
  }, {})
  return (
    <div className="flex flex-wrap gap-2">
      <button onClick={() => onFilterStatus('')}
        className="flex items-center gap-2 px-3 py-2 rounded-xl transition-all text-left"
        style={{ background: !filterStatus ? accent.accent : '#fff', border: !filterStatus ? `1px solid ${accent.accent}` : '1px solid #e5e7eb', color: !filterStatus ? '#fff' : '#475569' }}>
        <span className="text-lg font-bold leading-none">{records.length}</span>
        <span className="text-xs font-semibold">All {noun}</span>
      </button>
      {statusOptions.map(s => {
        const st = simpleStatusStyle(s)
        const active = filterStatus === s
        return (
          <button key={s} onClick={() => onFilterStatus(active ? '' : s)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl transition-all text-left"
            style={{ background: active ? st.bg : '#fff', border: active ? `1px solid ${st.border}` : '1px solid #e5e7eb' }}>
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

function ResourceCard({ record, resourceType, canEdit, onEdit, onDetail, compact = false, showClientAccents = true }) {
  const meta = RESOURCE_META[resourceType]
  const f = record.fields || {}
  const groupValue = f[meta.clientField] || 'Unknown'
  const titleValue = f[meta.titleField] || 'Untitled'
  const statusValue = f[meta.statusField] || ''
  const clr = clientColor(groupValue)
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
      {showClientAccents && <div className="h-1" style={{ background: clr }} />}
      <div className={compact ? 'p-4' : 'p-5'}>
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold mb-1 truncate" style={{ color: clr }}>{groupValue}</p>
            <h3 className="text-base font-bold text-gray-900 leading-snug">{titleValue}</h3>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge value={statusValue} />
            <button onClick={() => onDetail(record)} className="p-1 rounded-lg text-gray-400 hover:text-slate-700" title="View details"><Eye size={12} /></button>
            {canEdit && <button onClick={() => onEdit(record)} className="p-1 rounded-lg text-gray-400 hover:text-blue-600"><Pencil size={12} /></button>}
          </div>
        </div>
        {resourceType === 'status' && (
          <>
            {f['Short Status'] && <p className="text-sm font-semibold text-gray-800 leading-snug mb-2">{f['Short Status']}</p>}
            {f['Current Status (Detailed)'] && <p className="text-sm text-gray-500 leading-relaxed line-clamp-3">{f['Current Status (Detailed)']}</p>}
          </>
        )}
        {resourceType === 'projects' && (
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div><p className="text-gray-400 uppercase tracking-wide mb-1">Health</p><p className="font-semibold text-gray-700">{f['Health'] || '—'}</p></div>
            <div><p className="text-gray-400 uppercase tracking-wide mb-1">Billed</p><p className="font-semibold text-gray-700">{fmtInr(f['Amount Billed So far'])}</p></div>
            <div><p className="text-gray-400 uppercase tracking-wide mb-1">Profit</p><p className="font-semibold text-gray-700">{fmtInr(f['Actual Profit'])}</p></div>
            <div><p className="text-gray-400 uppercase tracking-wide mb-1">Margin</p><p className="font-semibold text-gray-700">{f['Profit percentage'] ? `${Number(f['Profit percentage']).toFixed(1)}%` : '—'}</p></div>
          </div>
        )}
        {resourceType === 'invoices' && (
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div><p className="text-gray-400 uppercase tracking-wide mb-1">Project</p><p className="font-semibold text-gray-700">{f['Project'] || '—'}</p></div>
            <div><p className="text-gray-400 uppercase tracking-wide mb-1">Category</p><p className="font-semibold text-gray-700">{f['Category'] || '—'}</p></div>
            <div><p className="text-gray-400 uppercase tracking-wide mb-1">Amount</p><p className="font-semibold text-gray-700">{fmtInr(f['Amount Raised'])}</p></div>
            <div><p className="text-gray-400 uppercase tracking-wide mb-1">Received</p><p className="font-semibold text-gray-700">{fmtInr(f['Amount Received'])}</p></div>
            <div><p className="text-gray-400 uppercase tracking-wide mb-1">Raised</p><p className="font-semibold text-gray-700">{fmtDate(f['Raised Date'])}</p></div>
            <div><p className="text-gray-400 uppercase tracking-wide mb-1">Follow-up</p><p className="font-semibold text-gray-700">{fmtDate(f['Next followup'])}</p></div>
          </div>
        )}
      </div>
    </div>
  )
}

function CardView({
  records,
  resourceType,
  canEdit,
  onEdit,
  onDetail,
  compact = false,
  showClientAccents = true,
  groupByField,
  groupSort = 'count-desc',
  recordSort = 'project-asc',
}) {
  const meta = RESOURCE_META[resourceType]
  const groups = new Map()
  for (const record of records) {
    const groupValue = record.fields?.[groupByField] || (groupByField === meta.statusField ? 'Unassigned' : 'Unknown')
    if (!groups.has(groupValue)) groups.set(groupValue, [])
    groups.get(groupValue).push(record)
  }

  const sortRecords = (items) => {
    const ordered = [...items]
    ordered.sort((a, b) => {
      const af = a.fields || {}
      const bf = b.fields || {}
      switch (recordSort) {
        case 'project-desc':
          return String(bf[meta.titleField] || '').localeCompare(String(af[meta.titleField] || ''))
        case 'modified-desc':
          return new Date(bf.lastModifiedTime || 0).getTime() - new Date(af.lastModifiedTime || 0).getTime()
        case 'modified-asc':
          return new Date(af.lastModifiedTime || 0).getTime() - new Date(bf.lastModifiedTime || 0).getTime()
        case 'status-asc':
          return String(af[meta.statusField] || '').localeCompare(String(bf[meta.statusField] || ''))
        case 'project-asc':
        default:
          return String(af[meta.titleField] || '').localeCompare(String(bf[meta.titleField] || ''))
      }
    })
    return ordered
  }

  const grouped = [...groups.entries()].map(([groupValue, items]) => ({
    groupValue,
    recs: sortRecords(items),
    count: items.length,
  })).sort((a, b) => {
    switch (groupSort) {
      case 'count-asc':
        return a.count - b.count || String(a.groupValue).localeCompare(String(b.groupValue))
      case 'name-desc':
        return String(b.groupValue).localeCompare(String(a.groupValue))
      case 'name-asc':
        return String(a.groupValue).localeCompare(String(b.groupValue))
      case 'count-desc':
      default:
        return b.count - a.count || String(a.groupValue).localeCompare(String(b.groupValue))
    }
  })

  return (
    <div className="space-y-8">
      {grouped.map(({ groupValue, recs, count }) => {
        const clrHex = clientColor(groupValue)
        return (
          <section key={groupValue}>
            <div className="flex items-center gap-3 mb-4">
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold"
                style={{ background: showClientAccents ? hexRgba(clrHex, 0.1) : '#fff', border: `1.5px solid ${showClientAccents ? hexRgba(clrHex, 0.3) : '#e5e7eb'}`, color: showClientAccents ? clrHex : '#334155' }}>
                <span className="w-2 h-2 rounded-full" style={{ background: clrHex }} />
                {groupValue}
              </span>
              <span className="text-sm text-gray-400">{count} {meta.noun}{count !== 1 ? 's' : ''}</span>
            </div>
            <div className={`grid grid-cols-1 sm:grid-cols-2 ${compact ? 'gap-3' : 'gap-4'}`}>
              {recs.map(r => <ResourceCard key={r.id} record={r} resourceType={resourceType} canEdit={canEdit} onEdit={onEdit} onDetail={onDetail} compact={compact} showClientAccents={showClientAccents} />)}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function ListView({ records, columns, resourceType, canEdit, onEdit, onDetail, showClientAccents = true }) {
  const meta = RESOURCE_META[resourceType]
  const cols = (columns || meta.defaultColumns).filter(c => meta.columns.includes(c))
  return (
    <div className="overflow-x-auto rounded-2xl" style={{ border: '1px solid #e5e7eb' }}>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
            {cols.map(col => <th key={col} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap">{col}</th>)}
            <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => {
            const f = r.fields || {}
            const clr = clientColor(f[meta.clientField] || '')
            return (
              <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                {cols.map(col => (
                  <td key={col} className="px-4 py-3 align-top">
                    {col === meta.clientField && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: showClientAccents ? hexRgba(clr, 0.1) : '#f8fafc', color: showClientAccents ? clr : '#475569' }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: clr }} />
                        {f[col] || '—'}
                      </span>
                    )}
                    {col === meta.titleField && <span className="font-semibold text-gray-900">{f[col] || '—'}</span>}
                    {col === meta.statusField && <StatusBadge value={f[col]} />}
                    {col === 'Short Status' && <span className="text-gray-700">{f[col] || '—'}</span>}
                    {col === 'Current Status (Detailed)' && <span className="text-gray-500 text-xs leading-relaxed line-clamp-2">{f[col] || '—'}</span>}
                    {col === 'Health' && <span className="text-gray-700">{f[col] || '—'}</span>}
                    {col === 'Amount Billed So far' && <span className="text-gray-700">{fmtInr(f[col])}</span>}
                    {col === 'Actual Profit' && <span className="text-gray-700">{fmtInr(f[col])}</span>}
                    {col === 'Profit percentage' && <span className="text-gray-700">{f[col] ? `${Number(f[col]).toFixed(1)}%` : '—'}</span>}
                    {col === 'Amount Raised' && <span className="text-gray-700">{fmtInr(f[col])}</span>}
                    {col === 'Amount Received' && <span className="text-gray-700">{fmtInr(f[col])}</span>}
                    {col === 'Raised Date' && <span className="text-gray-700 whitespace-nowrap">{fmtDate(f[col])}</span>}
                    {col === 'Cleared Date' && <span className="text-gray-700 whitespace-nowrap">{fmtDate(f[col])}</span>}
                    {col === 'Next followup' && <span className="text-gray-700 whitespace-nowrap">{fmtDate(f[col])}</span>}
                    {col === 'Last Modified' && <span className="text-gray-500 text-xs whitespace-nowrap">{fmtDateTime(f.lastModifiedTime || r.createdTime || '') || '—'}</span>}
                    {![
                      meta.clientField, meta.titleField, meta.statusField, 'Short Status', 'Current Status (Detailed)', 'Health', 'Amount Billed So far',
                      'Actual Profit', 'Profit percentage', 'Amount Raised', 'Amount Received', 'Raised Date', 'Cleared Date', 'Next followup', 'Last Modified',
                    ].includes(col) && <span className="text-gray-700">{f[col] || '—'}</span>}
                  </td>
                ))}
                <td className="px-4 py-3 align-top text-right">
                  <button onClick={() => onDetail(r)} className="p-1 rounded-lg text-gray-400 hover:text-slate-700" title="View details"><Eye size={12} /></button>
                  {canEdit && (
                    <button onClick={() => onEdit(r)} className="p-1 rounded-lg text-gray-400 hover:text-blue-600" title="Edit"><Pencil size={12} /></button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function BoardView({ records, resourceType, statusOptions, canEdit, onEdit, onDetail, onDropStatus, compact = false, showClientAccents = true, groupByField }) {
  const meta = RESOURCE_META[resourceType]
  const [draggedId, setDraggedId] = useState('')
  const draggable = groupByField === meta.statusField
  const columnKeys = draggable
    ? statusOptions
    : [...new Set(records.map(r => r.fields?.[groupByField] || 'Unassigned'))].sort((a, b) => String(a).localeCompare(String(b)))
  const byStatus = columnKeys.reduce((acc, s) => ({ ...acc, [s]: [] }), {})
  records.forEach(r => {
    const status = r.fields?.[groupByField] || 'Unassigned'
    if (!byStatus[status]) byStatus[status] = []
    byStatus[status].push(r)
  })
  return (
    <div className="flex gap-4 overflow-x-auto pb-2" style={{ minHeight: 200 }}>
      {columnKeys.map(status => {
        const recs = byStatus[status] || []
        const st = draggable ? simpleStatusStyle(status) : { bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.24)', dot: '#94a3b8', text: '#475569' }
        return (
          <div key={status} className="flex-shrink-0 w-[250px] sm:w-72 rounded-2xl overflow-hidden"
            style={{ background: '#fff', border: '1px solid #e5e7eb' }}
            onDragOver={e => { if (canEdit && draggable) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } }}
            onDrop={e => {
              if (!canEdit || !draggable) return
              e.preventDefault()
              const id = e.dataTransfer.getData('text/plain')
              setDraggedId('')
              if (id) onDropStatus(id, status)
            }}>
            <div className="px-4 py-3 flex items-center justify-between" style={{ background: st.bg, borderBottom: `1px solid ${st.border}` }}>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: st.dot }} />
                <span className="text-sm font-bold" style={{ color: st.text }}>{status}</span>
              </div>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: st.border, color: st.text }}>{recs.length}</span>
            </div>
            <div className="p-3 space-y-3" style={{ minHeight: 100 }}>
              {recs.length === 0 && <p className="text-xs text-center py-4 text-gray-400">{canEdit ? 'Drop here' : 'No records'}</p>}
              {recs.map(r => {
                const f = r.fields || {}
                const groupValue = f[meta.clientField] || ''
                const titleValue = f[meta.titleField] || 'Untitled'
                const subtitle = meta.subtitleFields.map(key => f[key]).filter(Boolean).join(' · ')
                const clr = clientColor(groupValue)
                return (
                  <div key={r.id} className="rounded-xl p-3" draggable={false}
                    style={{ background: draggedId === r.id ? '#eef2ff' : '#f8fafc', border: '1px solid #e5e7eb' }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold mb-1" style={{ color: showClientAccents ? clr : '#64748b' }}>{groupValue}</div>
                        <div className="text-sm font-bold text-gray-900 mb-1 leading-tight">{titleValue}</div>
                        {subtitle && <p className={`${compact ? 'text-[11px]' : 'text-xs'} text-gray-500 leading-relaxed line-clamp-2`}>{subtitle}</p>}
                      </div>
                      {canEdit && (
                        <div
                          draggable={draggable}
                          onDragStart={e => {
                            if (!draggable) return
                            e.dataTransfer.setData('text/plain', r.id); e.dataTransfer.effectAllowed = 'move'; setDraggedId(r.id)
                          }}
                          onDragEnd={() => setDraggedId('')}
                          className="p-1 rounded-lg text-gray-400"
                          style={{ cursor: draggable ? 'grab' : 'not-allowed', opacity: draggable ? 1 : 0.45 }}
                          title={draggable ? 'Drag to move' : `Grouped by ${groupByField}; drag is only available when grouped by ${meta.statusField}`}
                        >
                          <Columns size={12} />
                        </div>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-1">
                      <button onClick={() => onDetail(r)} className="p-1 rounded-lg text-gray-400 hover:text-slate-700" title="View details"><Eye size={12} /></button>
                      {canEdit && <button onClick={() => onEdit(r)} className="p-1 rounded-lg text-gray-400 hover:text-blue-600" title="Edit"><Pencil size={12} /></button>}
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

function DetailModal({ resourceType, record, onClose }) {
  const meta = RESOURCE_META[resourceType] || RESOURCE_META.status
  const f = record?.fields || {}
  const groupValue = f[meta.clientField] || 'Unknown'
  const titleValue = f[meta.titleField] || 'Untitled'
  const statusValue = f[meta.statusField] || ''
  const accent = clientColor(groupValue)
  const entries = Object.entries(f)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  if (!record) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}>
      <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-[28px] shadow-2xl bg-white"
        style={{ border: '1px solid #e5e7eb' }}
        onClick={e => e.stopPropagation()}>
        <div className="px-6 py-5 border-b" style={{ borderColor: '#e5e7eb', background: `linear-gradient(135deg, ${hexRgba(accent, 0.14)}, rgba(255,255,255,0.98))` }}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-bold mb-3"
                style={{ background: hexRgba(accent, 0.12), border: `1px solid ${hexRgba(accent, 0.24)}`, color: accent }}>
                <span className="w-2 h-2 rounded-full" style={{ background: accent }} />
                {groupValue}
              </div>
              <h2 className="text-2xl font-bold text-slate-900 leading-tight">{titleValue}</h2>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StatusBadge value={statusValue} />
                <span className="text-xs text-slate-500">Record ID: {record.id}</span>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-white/80">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto max-h-[calc(90vh-132px)] p-6">
          {resourceType === 'invoices' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
              {[
                ['Project', f['Project'] || '—'],
                ['Category', f['Category'] || '—'],
                ['Amount Raised', fmtInr(f['Amount Raised'])],
                ['Amount Received', fmtInr(f['Amount Received'])],
                ['Raised Date', fmtDate(f['Raised Date'])],
                ['Cleared Date', fmtDate(f['Cleared Date'])],
                ['Next follow-up', fmtDate(f['Next followup'])],
                ['Payment Status', f['Payment Status'] || '—'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border px-4 py-3" style={{ borderColor: '#e5e7eb', background: '#f8fafc' }}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 mb-1">{label}</p>
                  <p className="text-sm font-semibold text-slate-700">{value}</p>
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {entries.map(([key, value]) => (
              <div key={key} className="rounded-2xl border px-4 py-3" style={{ borderColor: '#e5e7eb' }}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 mb-1">{key}</p>
                <p className="text-sm text-slate-700 break-words whitespace-pre-wrap">
                  {/(Amount|Profit)/i.test(key) && typeof value !== 'string' ? fmtInr(value) : String(value)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function EditModal({ resourceType, record, statusOptions, saving, onClose, onSave }) {
  const f = record?.fields || {}
  const [form, setForm] = useState({})
  useEffect(() => {
    if (resourceType === 'status') {
      setForm({
        status: f.Status || '',
        short_status: f['Short Status'] || '',
        current_status_detailed: f['Current Status (Detailed)'] || '',
      })
    } else if (resourceType === 'projects') {
      setForm({
        client: f.Client || '',
        project_name: f['Project Name'] || '',
        project_status: f['Project Status'] || '',
        amount_billed: f['Amount Billed So far'] || '',
      })
    } else {
      setForm({
        invoice_number: f['Invoice Number'] || '',
        payment_status: f['Payment Status'] || '',
        amount_received: f['Amount Received'] || '',
        cleared_date: f['Cleared Date'] ? String(f['Cleared Date']).slice(0, 10) : '',
        remark: f.Remark || '',
        next_followup: f['Next followup'] ? String(f['Next followup']).slice(0, 10) : '',
      })
    }
  }, [resourceType, record])
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])
  if (!record) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl" style={{ background: '#fff', border: '1px solid #e5e7eb', maxHeight: '92vh', overflow: 'auto' }}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 sticky top-0 z-10" style={{ background: '#fff', borderBottom: '1px solid #e5e7eb' }}>
          <h2 className="text-base font-bold text-gray-900">Update {resourceType === 'status' ? 'Status' : resourceType === 'projects' ? 'Project' : 'Invoice'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); onSave(form) }} className="px-5 py-4 space-y-4">
          {resourceType === 'status' && (
            <>
              <div>
                <label className="block text-xs font-semibold mb-2 text-gray-700">Status</label>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                  {statusOptions.map(opt => {
                    const st = simpleStatusStyle(opt)
                    const active = form.status === opt
                    return (
                      <button key={opt} type="button" onClick={() => setForm(v => ({ ...v, status: active ? '' : opt }))}
                        className="py-2 px-1 rounded-xl text-[11px] font-semibold text-center transition-all leading-tight"
                        style={{ background: active ? st.bg : '#f8fafc', color: active ? st.text : '#64748b', border: `1.5px solid ${active ? st.border : '#e5e7eb'}` }}>
                        {opt}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5 text-gray-700">Headline</label>
                <input className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} value={form.short_status || ''} onChange={e => setForm(v => ({ ...v, short_status: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5 text-gray-700">Detail</label>
                <textarea rows={5} className="w-full rounded-xl border px-3 py-2 text-sm resize-none" style={{ borderColor: '#e5e7eb' }} value={form.current_status_detailed || ''} onChange={e => setForm(v => ({ ...v, current_status_detailed: e.target.value }))} />
              </div>
            </>
          )}
          {resourceType === 'projects' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-semibold mb-1.5 text-gray-700">Client</label><input className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} value={form.client || ''} onChange={e => setForm(v => ({ ...v, client: e.target.value }))} /></div>
                <div><label className="block text-xs font-semibold mb-1.5 text-gray-700">Project Name</label><input className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} value={form.project_name || ''} onChange={e => setForm(v => ({ ...v, project_name: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-semibold mb-1.5 text-gray-700">Project Status</label><input className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} value={form.project_status || ''} onChange={e => setForm(v => ({ ...v, project_status: e.target.value }))} /></div>
                <div><label className="block text-xs font-semibold mb-1.5 text-gray-700">Amount Billed</label><input type="number" className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} value={form.amount_billed || ''} onChange={e => setForm(v => ({ ...v, amount_billed: e.target.value }))} /></div>
              </div>
            </>
          )}
          {resourceType === 'invoices' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-semibold mb-1.5 text-gray-700">Invoice Number</label><input className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} value={form.invoice_number || ''} onChange={e => setForm(v => ({ ...v, invoice_number: e.target.value }))} /></div>
                <div><label className="block text-xs font-semibold mb-1.5 text-gray-700">Payment Status</label><input className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} value={form.payment_status || ''} onChange={e => setForm(v => ({ ...v, payment_status: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-semibold mb-1.5 text-gray-700">Amount Received</label><input type="number" className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} value={form.amount_received || ''} onChange={e => setForm(v => ({ ...v, amount_received: e.target.value }))} /></div>
                <div><label className="block text-xs font-semibold mb-1.5 text-gray-700">Cleared Date</label><input type="date" className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} value={form.cleared_date || ''} onChange={e => setForm(v => ({ ...v, cleared_date: e.target.value }))} /></div>
              </div>
              <div><label className="block text-xs font-semibold mb-1.5 text-gray-700">Next Follow-up</label><input type="date" className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: '#e5e7eb' }} value={form.next_followup || ''} onChange={e => setForm(v => ({ ...v, next_followup: e.target.value }))} /></div>
              <div><label className="block text-xs font-semibold mb-1.5 text-gray-700">Remark</label><textarea rows={4} className="w-full rounded-xl border px-3 py-2 text-sm resize-none" style={{ borderColor: '#e5e7eb' }} value={form.remark || ''} onChange={e => setForm(v => ({ ...v, remark: e.target.value }))} /></div>
            </>
          )}
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

export default function SharedView() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [saveError, setSaveError] = useState('')
  const [search, setSearch] = useState('')
  const [filterPrimary, setFilterPrimary] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [viewType, setViewType] = useState('card')
  const [boardGroupBy, setBoardGroupBy] = useState('')
  const [editRecord, setEditRecord] = useState(null)
  const [detailRecord, setDetailRecord] = useState(null)
  const [savingRecordId, setSavingRecordId] = useState('')
  const [pendingStatusById, setPendingStatusById] = useState({})

  const resourceType = data?.resource_type || 'status'
  const meta = RESOURCE_META[resourceType] || RESOURCE_META.status

  const load = async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const res = await api.sharedViews.publicGet(token)
      const vc = res.view_config || {}
      const rt = res.resource_type || 'status'
      const rmeta = RESOURCE_META[rt] || RESOURCE_META.status
      setData(res)
      setRecords(res.records || [])
      setPendingStatusById({})
      setViewType(vc.type || rmeta.defaultView)
      setBoardGroupBy(vc.boardGroupBy || rmeta.statusField)
      setSearch(prev => prev || vc.search || '')
      setFilterPrimary(prev => prev || vc[rmeta.primaryFilterKey] || '')
      setFilterStatus(prev => prev || vc.filterStatus || '')
      setFilterCategory(prev => prev || vc.filterCategory || '')
    } catch (e) {
      setError(e.message || 'This link is unavailable')
      setData(null)
      setRecords([])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { if (token) load() }, [token])

  const canEdit = (data?.access_mode || 'read') === 'edit'
  const vc = data?.view_config || {}
  const theme = resolveTheme(vc.theme)
  const compact = vc.density === 'compact'
  const showDashboard = vc.showDashboard ?? meta.showDashboardByDefault
  const showClientAccents = vc.showClientAccents !== false
  const boardGroupOptions = BOARD_GROUP_OPTIONS[resourceType] || [meta.statusField]
  const activeBoardGroupBy = boardGroupOptions.includes(boardGroupBy) ? boardGroupBy : meta.statusField
  const activeCardGroupBy = [meta.clientField, meta.statusField].includes(vc.cardGroupBy) ? vc.cardGroupBy : meta.clientField
  const accentStyle = { '--share-accent': theme.accent, '--share-accent-dim': theme.accentDim, '--share-accent-soft': theme.accentSoft }

  const recordsForView = useMemo(() => {
    const statusField = meta.statusField
    return records.map(r => {
      const pendingStatus = pendingStatusById[r.id]
      return pendingStatus ? { ...r, fields: { ...r.fields, [statusField]: pendingStatus } } : r
    })
  }, [records, pendingStatusById, meta.statusField])

  const listColumns = useMemo(() => {
    const requested = Array.isArray(vc.columns) && vc.columns.length ? vc.columns : meta.defaultColumns
    return requested.filter(c => meta.columns.includes(c))
  }, [vc.columns, meta])

  const primaryOptions = useMemo(
    () => [...new Set(records.map(r => r.fields?.[meta.clientField]).filter(Boolean))].sort(),
    [records, meta.clientField]
  )
  const statusOptions = useMemo(() => {
    const dynamic = [...new Set(recordsForView.map(r => r.fields?.[meta.statusField]).filter(Boolean))]
    if (resourceType === 'status') {
      const ordered = [...DEFAULT_BOARD_ORDER.filter(s => dynamic.includes(s)), ...dynamic.filter(s => !DEFAULT_BOARD_ORDER.includes(s))]
      return ordered.length ? ordered : DEFAULT_BOARD_ORDER
    }
    return dynamic.length ? dynamic : ['Uncategorized']
  }, [recordsForView, meta.statusField, resourceType])
  const categoryOptions = useMemo(
    () => resourceType === 'invoices'
      ? [...new Set(records.map(r => r.fields?.Category).filter(Boolean))].sort()
      : [],
    [records, resourceType]
  )

  const filtered = useMemo(() => {
    return recordsForView.filter(r => {
      const f = r.fields || {}
      if (filterPrimary && f[meta.clientField] !== filterPrimary) return false
      if (filterStatus && (f[meta.statusField] || '') !== filterStatus) return false
      if (filterCategory && resourceType === 'invoices' && f.Category !== filterCategory) return false
      if (search) {
        const q = search.toLowerCase()
        const hay = meta.searchFields.map(key => f[key] || '').join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [recordsForView, filterPrimary, filterStatus, filterCategory, search, meta, resourceType])

  async function saveRecordChanges(record, patch) {
    setSavingRecordId(record.id)
    setSaveError('')
    try {
      await api.sharedViews.publicUpdate(token, record.id, patch)
      const fieldPatch = resourceType === 'status'
        ? {
            ...(patch.status !== undefined ? { Status: patch.status } : {}),
            ...(patch.short_status !== undefined ? { 'Short Status': patch.short_status } : {}),
            ...(patch.current_status_detailed !== undefined ? { 'Current Status (Detailed)': patch.current_status_detailed } : {}),
          }
        : resourceType === 'projects'
          ? {
              ...(patch.client !== undefined ? { Client: patch.client } : {}),
              ...(patch.project_name !== undefined ? { 'Project Name': patch.project_name } : {}),
              ...(patch.project_status !== undefined ? { 'Project Status': patch.project_status } : {}),
              ...(patch.amount_billed !== undefined ? { 'Amount Billed So far': patch.amount_billed } : {}),
            }
          : {
              ...(patch.invoice_number !== undefined ? { 'Invoice Number': patch.invoice_number } : {}),
              ...(patch.payment_status !== undefined ? { 'Payment Status': patch.payment_status } : {}),
              ...(patch.amount_received !== undefined ? { 'Amount Received': patch.amount_received } : {}),
              ...(patch.cleared_date !== undefined ? { 'Cleared Date': patch.cleared_date } : {}),
              ...(patch.remark !== undefined ? { Remark: patch.remark } : {}),
              ...(patch.next_followup !== undefined ? { 'Next followup': patch.next_followup } : {}),
            }
      setRecords(rs => rs.map(r => r.id === record.id ? { ...r, fields: { ...r.fields, ...fieldPatch } } : r))
      setEditRecord(null)
    } catch (e) {
      setSaveError(e.message || 'Failed to update')
    } finally {
      setSavingRecordId('')
    }
  }

  async function moveRecordToStatus(recordId, status) {
    const statusField = meta.statusField
    const payload = resourceType === 'status'
      ? { status }
      : resourceType === 'projects'
        ? { project_status: status }
        : { payment_status: status }
    const liveRecord = recordsForView.find(r => r.id === recordId)
    if (!liveRecord || (liveRecord.fields?.[statusField] || '') === status) return
    setPendingStatusById(prev => ({ ...prev, [recordId]: status }))
    try {
      await api.sharedViews.publicUpdate(token, recordId, payload)
      setRecords(rs => rs.map(r => r.id === recordId ? { ...r, fields: { ...r.fields, [statusField]: status } } : r))
    } catch (e) {
      setSaveError(e.message || 'Failed to update')
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
          <p className="text-sm text-gray-500">Loading shared view…</p>
        </div>
      </div>
    )
  }

  if (error) {
    const isDisabled = /disabled/i.test(error)
    const isExpiredLink = /expired/i.test(error)
    const isMissingLink = /not found|unavailable|not accessible/i.test(error)
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#f8fafc' }}>
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-2xl p-8 text-center shadow-sm" style={{ border: '1px solid #e5e7eb' }}>
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5 ${(isDisabled || isExpiredLink) ? 'bg-amber-50' : 'bg-red-50'}`}
              style={{ border: `1px solid ${(isDisabled || isExpiredLink) ? 'rgba(245,158,11,0.25)' : 'rgba(239,68,68,0.2)'}` }}>
              <AlertCircle size={28} className={(isDisabled || isExpiredLink) ? 'text-amber-500' : 'text-red-500'} />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">
              {isExpiredLink ? 'Link Expired' : isDisabled ? 'Link Disabled' : isMissingLink ? 'Link Not Found' : 'Access Restricted'}
            </h1>
            <p className="text-sm text-gray-600 leading-relaxed">
              {isDisabled
                ? 'This link has been disabled by the owner.'
                : isExpiredLink
                  ? 'This link has passed its expiry date.'
                  : isMissingLink
                    ? 'This shared link was deleted, is invalid, or no longer exists.'
                    : 'This page is not accessible.'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const title = data?.title || 'Shared View'
  const expiresAt = data?.expires_at
  const createdAt = data?.created_at
  const expired = isExpired(expiresAt)

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc', ...accentStyle }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #e5e7eb' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: theme.accentDim, border: `1px solid ${theme.accentSoft}` }}>
                <Activity size={18} style={{ color: theme.accent }} />
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900 leading-tight">{title}</h1>
                <p className="text-xs text-gray-500 mt-0.5">
                  {filtered.length} shown of {records.length} {meta.plural} · {primaryOptions.length} {resourceType === 'invoices' ? 'projects' : 'clients'}
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
            <SummaryStrip
              records={records}
              statusOptions={statusOptions}
              filterStatus={filterStatus}
              onFilterStatus={setFilterStatus}
              accent={theme}
              noun={meta.plural}
              statusField={meta.statusField}
            />
          )}

          <div className="flex flex-col lg:flex-row gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" />
              <input type="text" className="w-full rounded-xl border bg-white pl-8 pr-3 py-2 text-sm outline-none"
                style={{ borderColor: '#e5e7eb' }}
                placeholder={`Search ${meta.plural}…`}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <select className="rounded-xl border bg-white px-3 py-2 text-sm outline-none" style={{ borderColor: '#e5e7eb' }} value={filterPrimary} onChange={e => setFilterPrimary(e.target.value)}>
              <option value="">{meta.primaryLabel}</option>
              {primaryOptions.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <select className="rounded-xl border bg-white px-3 py-2 text-sm outline-none" style={{ borderColor: '#e5e7eb' }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All statuses</option>
              {statusOptions.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            {resourceType === 'invoices' && (
              <select className="rounded-xl border bg-white px-3 py-2 text-sm outline-none" style={{ borderColor: '#e5e7eb' }} value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
                <option value="">All categories</option>
                {categoryOptions.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            )}
            <div className="flex items-center rounded-xl overflow-hidden border bg-slate-50" style={{ borderColor: '#e5e7eb' }}>
              {[
                { id: 'card', Icon: LayoutGrid, label: 'Card' },
                { id: 'list', Icon: List, label: 'List' },
                { id: 'board', Icon: Columns, label: 'Board' },
              ].map(({ id, Icon, label }) => (
                <button key={id} onClick={() => setViewType(id)} className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold"
                  style={{ background: viewType === id ? '#fff' : 'transparent', color: viewType === id ? theme.accent : '#64748b' }}>
                  <Icon size={12} />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
            {viewType === 'board' && (
              <select className="rounded-xl border bg-white px-3 py-2 text-sm outline-none" style={{ borderColor: '#e5e7eb' }} value={activeBoardGroupBy} onChange={e => setBoardGroupBy(e.target.value)}>
                {boardGroupOptions.map(v => <option key={v} value={v}>Group by {v}</option>)}
              </select>
            )}
            <button onClick={() => load({ silent: true })} className="rounded-xl border bg-white px-3 py-2 text-sm font-medium flex items-center gap-2" style={{ borderColor: '#e5e7eb', color: '#475569' }}>
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
        {saveError && <div className="mb-4 rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#dc2626' }}>{saveError}</div>}
        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-500 text-sm">No shared {meta.plural} match the current filters.</p>
          </div>
        ) : (
          <>
            {viewType === 'card' && (
              <CardView
                records={filtered}
                resourceType={resourceType}
                canEdit={canEdit}
                onEdit={setEditRecord}
                onDetail={setDetailRecord}
                compact={compact}
                showClientAccents={showClientAccents}
                groupByField={activeCardGroupBy}
                groupSort={vc.cardGroupSort || 'count-desc'}
                recordSort={vc.cardRecordSort || 'project-asc'}
              />
            )}
            {viewType === 'list' && <ListView records={filtered} columns={listColumns} resourceType={resourceType} canEdit={canEdit} onEdit={setEditRecord} onDetail={setDetailRecord} showClientAccents={showClientAccents} />}
            {viewType === 'board' && <BoardView records={filtered} resourceType={resourceType} statusOptions={statusOptions} canEdit={canEdit} onEdit={setEditRecord} onDetail={setDetailRecord} onDropStatus={moveRecordToStatus} compact={compact} showClientAccents={showClientAccents} groupByField={activeBoardGroupBy} />}
          </>
        )}
      </main>

      <footer className="py-8 text-center" style={{ borderTop: '1px solid #e5e7eb' }}>
        <div className="flex items-center justify-center gap-1.5 text-xs text-gray-400 mb-1">
          <Shield size={11} />
          <span>FinTrack · Shared View</span>
        </div>
        {createdAt && <p className="text-[11px] text-gray-300">Generated {fmtDateTime(createdAt)}</p>}
      </footer>

      {canEdit && editRecord && (
        <EditModal
          resourceType={resourceType}
          record={editRecord}
          statusOptions={statusOptions}
          saving={savingRecordId === editRecord.id}
          onClose={() => setEditRecord(null)}
          onSave={form => saveRecordChanges(editRecord, form)}
        />
      )}
      {detailRecord && <DetailModal resourceType={resourceType} record={detailRecord} onClose={() => setDetailRecord(null)} />}
    </div>
  )
}
