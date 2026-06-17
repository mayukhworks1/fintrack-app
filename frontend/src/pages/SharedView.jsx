import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Activity, AlertCircle, ChevronDown, ChevronUp, Clock, Columns, Eye, LayoutGrid, List,
  Loader2, Pencil, RefreshCw, Search, Shield, X,
} from 'lucide-react'
import { api } from '../services/api'
import { DocPreviewModal, AttachmentList, fileTypeInfo } from '../components/DocPreviewModal'

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
    columns: ['Client', 'Project', 'Status', 'Short Status', 'Current Status (Detailed)', 'Attachments', 'Last Modified'],
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
    clientField: 'Client Name',
    titleField: 'Invoice Number',
    statusField: 'Payment Status',
    categoryField: 'Category',
    subtitleFields: ['Client Name', 'Project', 'Amount Raised'],
    searchFields: ['Invoice Number', 'Client Name', 'Client', 'Project', 'Category', 'Payment Status', 'Milestone', 'Raised By', 'Description', 'Remark'],
    primaryFilterKey: 'filterClient',
    primaryLabel: 'All clients',
    defaultView: 'list',
    showDashboardByDefault: false,
    columns: ['Invoice Number', 'Client Name', 'Project', 'Category', 'Payment Status', 'Milestone', 'Raised By', 'Amount Raised', 'Amount with Tax', 'Amount Received', 'Outstanding Amount', 'Agening (Days)', 'Raised Date', 'Cleared Date', 'Next followup', 'Description', 'Remark', 'Reference', 'Invoice PDF', 'Last Modified'],
    defaultColumns: ['Invoice Number', 'Client Name', 'Project', 'Category', 'Payment Status', 'Amount Raised', 'Amount Received', 'Outstanding Amount', 'Agening (Days)', 'Raised Date', 'Cleared Date', 'Next followup'],
  },
  'tax-ledger': {
    noun: 'tax invoice',
    plural: 'tax invoices',
    clientField: 'Client Name',
    titleField: 'Invoice Number',
    statusField: 'Payment Status',
    categoryField: 'Category',
    subtitleFields: ['Client Name', 'Project', 'Amount Raised'],
    searchFields: ['Invoice Number', 'Client Name', 'Client', 'Project', 'Category', 'Payment Status', 'Milestone', 'Raised By', 'Description', 'Remark'],
    primaryFilterKey: 'filterClient',
    primaryLabel: 'All clients',
    defaultView: 'list',
    showDashboardByDefault: true,
    columns: ['Invoice Number', 'Client Name', 'Project', 'Payment Status', 'Amount Raised', 'Amount with Tax', 'GST Amount', 'TDS Amount', 'TDS %', 'Amount Received', 'Outstanding Amount', 'Raised Date', 'Cleared Date'],
    defaultColumns: ['Invoice Number', 'Client Name', 'Project', 'Payment Status', 'Amount Raised', 'Amount with Tax', 'GST Amount', 'TDS Amount', 'TDS %', 'Amount Received', 'Outstanding Amount', 'Raised Date'],
  },
}
const BOARD_GROUP_OPTIONS = {
  status: ['Status', 'Client'],
  projects: ['Project Status', 'Client', 'Health'],
  invoices: ['Payment Status', 'Client Name', 'Project', 'Category'],
  'tax-ledger': ['Payment Status', 'Client Name', 'Project'],
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
function taxParts(fields = {}) {
  const base = Number(fields['Amount Raised'] || 0)
  const gross = Number(fields['Amount with Tax'] || base)
  const received = Number(fields['Amount Received'] || 0)
  const status = String(fields['Payment Status'] || '').trim()
  const isPaid = status === 'Paid'
  const isCancelled = status === 'Cancelled'
  const gst = Math.max(0, gross - base)
  const tds = isPaid && received < gross ? Math.max(0, gross - received) : 0
  const outstanding = !isPaid && !isCancelled ? Math.max(0, base) : 0
  return {
    base,
    gross,
    received,
    status,
    isPaid,
    isCancelled,
    gst,
    tds,
    gstPct: base > 0 ? (gst / base) * 100 : 0,
    tdsPct: base > 0 ? (tds / base) * 100 : 0,
    outstanding,
  }
}
function dateOnlyValue(value) {
  if (!value) return ''
  return String(value).slice(0, 10)
}
function monthKey(value) {
  const dateOnly = dateOnlyValue(value)
  return dateOnly ? dateOnly.slice(0, 7) : ''
}
function parseAttachments(value) {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : []
}
function recordAttachmentSummary(resourceType, fields = {}) {
  if (resourceType === 'status') {
    const count = parseAttachments(fields['Attachments']).length
    return count ? { count, label: count === 1 ? '1 attachment' : `${count} attachments` } : null
  }
  if (resourceType === 'invoices' || resourceType === 'tax-ledger') {
    const refs = parseAttachments(fields['Reference']).length
    const pdfs = parseAttachments(fields['Invoice PDF']).length
    const total = refs + pdfs
    return total
      ? { count: total, label: `${refs} ref · ${pdfs} pdf${pdfs === 1 ? '' : 's'}` }
      : null
  }
  return null
}
function effectiveAging(fields = {}) {
  const raw = Number(fields['Agening (Days)'] ?? fields['Aging'] ?? 0)
  if (Number.isFinite(raw) && raw > 0) return raw
  const candidate = dateOnlyValue(fields['Raised Date'])
  if (!candidate) return 0
  const target = new Date(candidate)
  if (Number.isNaN(target.getTime())) return 0
  return Math.max(0, Math.floor((Date.now() - target.getTime()) / 86400000))
}
function classifyAgingBand(days) {
  if (days <= 14) return '0-14d'
  if (days <= 30) return '15-30d'
  if (days <= 60) return '31-60d'
  return '60d+'
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
    viewConfig?.raisedByFilter ? `Raised by: ${viewConfig.raisedByFilter}` : null,
    viewConfig?.monthFilter ? `Raised month: ${viewConfig.monthFilter}` : null,
    viewConfig?.agingBandFilter ? `Aging: ${viewConfig.agingBandFilter}` : null,
    viewConfig?.dateFieldFilter && (viewConfig?.dateFrom || viewConfig?.dateTo)
      ? `${viewConfig.dateFieldFilter}: ${viewConfig.dateFrom || '…'} → ${viewConfig.dateTo || '…'}`
      : null,
    viewConfig?.billingFilter && viewConfig.billingFilter !== 'all' ? `Scope: ${viewConfig.billingFilter}` : null,
    viewConfig?.invoiceScope && viewConfig.invoiceScope !== 'tax' ? `Invoice scope: ${viewConfig.invoiceScope}` : null,
    viewConfig?.periodLabel ? `Period: ${viewConfig.periodLabel}` : null,
    viewConfig?.periodFrom || viewConfig?.periodTo ? `Date: ${viewConfig.periodFrom || '…'} → ${viewConfig.periodTo || '…'}` : null,
    viewConfig?.overdueOnly ? 'Outstanding only' : null,
    viewConfig?.hasDocsOnly ? 'With docs only' : null,
    viewConfig?.followupDueOnly ? 'Follow-up due' : null,
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

function TaxLedgerDashboard({ records, filterStatus, onFilterStatus, theme }) {
  const totals = records.reduce((acc, record) => {
    const p = taxParts(record.fields || {})
    if (!p.isCancelled) {
      acc.active += 1
      if (p.isPaid) {
        acc.paid += 1
        acc.taxable += p.base
        acc.gross += p.gross
        acc.gst += p.gst
        acc.tds += p.tds
        acc.received += p.received
      } else {
        acc.open += 1
        acc.openBase += p.base
        acc.openGross += p.gross
        acc.outstanding += p.outstanding
      }
    } else {
      acc.cancelled += 1
    }
    return acc
  }, {
    active: 0,
    paid: 0,
    open: 0,
    cancelled: 0,
    taxable: 0,
    gross: 0,
    gst: 0,
    tds: 0,
    received: 0,
    openBase: 0,
    openGross: 0,
    outstanding: 0,
  })
  const collectionRate = totals.gross > 0 ? (totals.received / totals.gross) * 100 : 0
  const tdsPct = totals.taxable > 0 ? (totals.tds / totals.taxable) * 100 : 0
  const statusCards = [
    ['Paid', totals.paid, 'Paid tax register'],
    ['Pending', totals.open, 'Open receivables'],
    ['Cancelled', totals.cancelled, 'Excluded'],
  ]
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        {[
          ['Taxable base', fmtInr(totals.taxable), `${totals.paid} paid invoices`],
          ['GST collected', fmtInr(totals.gst), 'Paid invoices only'],
          ['TDS deducted', totals.tds > 0 ? fmtInr(totals.tds) : '—', `${tdsPct.toFixed(1)}% on taxable`],
          ['Net received', fmtInr(totals.received), `${collectionRate.toFixed(1)}% of gross`],
          ['Open invoices', fmtInr(totals.outstanding), `${totals.open} pending · excluded from tax totals`],
        ].map(([label, value, sub], index) => (
          <div key={label} className="rounded-2xl p-3" style={{
            background: index === 1 ? 'rgba(16,185,129,0.08)' : index === 2 ? 'rgba(245,158,11,0.08)' : '#fff',
            border: '1px solid #e5e7eb',
          }}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{label}</p>
            <p className="text-lg sm:text-xl font-black tabular-nums mt-1" style={{ color: index === 1 ? '#059669' : index === 2 ? '#d97706' : '#111827' }}>{value}</p>
            <p className="text-[11px] text-gray-500 mt-1">{sub}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => onFilterStatus('')} className="px-3 py-2 rounded-xl text-xs font-bold"
          style={{ background: !filterStatus ? theme.accent : '#fff', color: !filterStatus ? '#fff' : '#475569', border: `1px solid ${!filterStatus ? theme.accent : '#e5e7eb'}` }}>
          All tax invoices · {totals.active}
        </button>
        {statusCards.map(([status, count, label]) => {
          const active = filterStatus === status
          const st = simpleStatusStyle(status)
          return (
            <button key={status} onClick={() => onFilterStatus(active ? '' : status)}
              className="px-3 py-2 rounded-xl text-xs font-bold"
              style={{ background: active ? st.bg : '#fff', color: active ? st.text : '#475569', border: `1px solid ${active ? st.border : '#e5e7eb'}` }}>
              {label} · {count}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ResourceCard({ record, resourceType, canEdit, onEdit, onDetail, compact = false, showClientAccents = true, allExpanded = false }) {
  const meta = RESOURCE_META[resourceType]
  const f = record.fields || {}
  const groupValue = f[meta.clientField] || 'Unknown'
  const titleValue = f[meta.titleField] || 'Untitled'
  const statusValue = f[meta.statusField] || ''
  const clr = clientColor(groupValue)
  // Per-card local expand state — syncs whenever the global allExpanded changes
  const [expanded, setExpanded] = useState(allExpanded)
  useEffect(() => { setExpanded(allExpanded) }, [allExpanded])

  const short      = resourceType === 'status' ? (f['Short Status'] || '') : ''
  const detail     = resourceType === 'status' ? (f['Current Status (Detailed)'] || '') : ''
  const hasDetail  = detail.trim() && detail.trim() !== short.trim()
  const attachmentInfo = recordAttachmentSummary(resourceType, f)

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
      {showClientAccents && <div className="h-1" style={{ background: clr }} />}
      <div className={compact ? 'p-4' : 'p-5'}>
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold mb-1 truncate" style={{ color: clr }}>{groupValue}</p>
            <h3 className="text-base font-bold text-gray-900 leading-snug">{titleValue}</h3>
            {attachmentInfo && (
              <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
                style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.18)', color: '#1d4ed8' }}>
                <Eye size={11} />
                {attachmentInfo.label}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge value={statusValue} />
            <button onClick={() => onDetail(record)} className="p-1 rounded-lg text-gray-400 hover:text-slate-700" title="View details"><Eye size={12} /></button>
            {canEdit && <button onClick={() => onEdit(record)} className="p-1 rounded-lg text-gray-400 hover:text-blue-600"><Pencil size={12} /></button>}
          </div>
        </div>
        {resourceType === 'status' && (
          <>
            {short && <p className="text-sm font-semibold text-gray-800 leading-snug mb-2">{short}</p>}
            {hasDetail && (
              <div>
                <p className="text-sm text-gray-500 leading-relaxed"
                  style={expanded
                    ? { whiteSpace: 'pre-wrap' }
                    : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {detail}
                </p>
                <button
                  onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
                  className="mt-1 text-[11px] font-semibold flex items-center gap-0.5"
                  style={{ color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  {expanded ? '↑ Show less' : '↓ Show more'}
                </button>
              </div>
            )}
            {!hasDetail && f['Current Status (Detailed)'] && (
              <p className="text-sm text-gray-500 leading-relaxed">{f['Current Status (Detailed)']}</p>
            )}
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
        {resourceType === 'tax-ledger' && (() => {
          const tax = taxParts(f)
          return (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div><p className="text-gray-400 uppercase tracking-wide mb-1">Client</p><p className="font-semibold text-gray-700">{f['Client Name'] || f['Client'] || '—'}</p></div>
              <div><p className="text-gray-400 uppercase tracking-wide mb-1">Project</p><p className="font-semibold text-gray-700">{f['Project'] || '—'}</p></div>
              <div><p className="text-gray-400 uppercase tracking-wide mb-1">Taxable</p><p className="font-semibold text-gray-700">{fmtInr(f['Amount Raised'])}</p></div>
              <div><p className="text-gray-400 uppercase tracking-wide mb-1">GST</p><p className="font-semibold text-gray-700">{fmtInr(tax.gst)}</p></div>
              <div><p className="text-gray-400 uppercase tracking-wide mb-1">TDS</p><p className="font-semibold text-gray-700">{tax.tds > 0 ? `${fmtInr(tax.tds)} · ${tax.tdsPct.toFixed(1)}%` : '—'}</p></div>
              <div><p className="text-gray-400 uppercase tracking-wide mb-1">Received</p><p className="font-semibold text-gray-700">{fmtInr(f['Amount Received'])}</p></div>
            </div>
          )
        })()}
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
  allExpanded = false,
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
            <div className={`grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 ${compact ? 'gap-3' : 'gap-4'}`}>
              {recs.map(r => <ResourceCard key={r.id} record={r} resourceType={resourceType} canEdit={canEdit} onEdit={onEdit} onDetail={onDetail} compact={compact} showClientAccents={showClientAccents} allExpanded={allExpanded} />)}
            </div>
          </section>
        )
      })}
    </div>
  )
}

// Column width config — controls how much space each field gets in the grid
const COL_WIDTHS = {
  'Client':                     '140px',
  'Project':                    '160px',
  'Project Name':               '180px',
  'Status':                     '120px',
  'Project Status':             '120px',
  'Payment Status':             '110px',
  'Short Status':               '200px',
  'Current Status (Detailed)': '1fr',
  'Attachments':               '100px',
  'Health':                     '90px',
  'Amount Billed So far':       '110px',
  'Actual Profit':              '110px',
  'Profit percentage':          '80px',
  'Invoice Number':             '130px',
  'Client Name':                '150px',
  'Category':                   '110px',
  'Milestone':                  '110px',
  'Raised By':                  '110px',
  'Amount Raised':              '110px',
  'Amount with Tax':            '110px',
  'Amount Received':            '110px',
  'GST Amount':                 '100px',
  'TDS Amount':                 '100px',
  'TDS %':                      '70px',
  'Outstanding Amount':         '110px',
  'Agening (Days)':             '80px',
  'Raised Date':                '100px',
  'Cleared Date':               '100px',
  'Next followup':              '100px',
  'Reference':                  '100px',
  'Invoice PDF':                '100px',
  'Description':                '1fr',
  'Remark':                     '140px',
  'Last Modified':              '110px',
}

const COL_LABELS = {
  'Payment Status':             'Status',
  'Amount Raised':              'Raised',
  'Amount with Tax':            'With Tax',
  'Amount Received':            'Received',
  'Outstanding Amount':         'Outstanding',
  'Agening (Days)':             'Aging',
  'Amount Billed So far':       'Billed',
  'Current Status (Detailed)': 'Detail',
  'Profit percentage':          'Profit %',
  'Resource contribution percentage': 'Resource %',
  'Next followup':              'Follow-up',
  'Project Status':             'Status',
  'Project Name':               'Project',
  'Short Status':               'Headline',
  'Invoice PDF':                'PDF',
  'Last Modified':              'Modified',
}

function cellContent(col, f, clr, resourceType, meta, showClientAccents) {
  const tax = resourceType === 'tax-ledger' ? taxParts(f) : null
  if (resourceType === 'tax-ledger' && col === 'GST Amount') return (
    <span className="text-[12px] font-semibold tabular-nums text-emerald-700">{fmtInr(tax.gst)}</span>
  )
  if (resourceType === 'tax-ledger' && col === 'TDS Amount') return (
    <span className="text-[12px] font-semibold tabular-nums text-amber-700">{tax.tds > 0 ? fmtInr(tax.tds) : '—'}</span>
  )
  if (resourceType === 'tax-ledger' && col === 'TDS %') return (
    <span className="text-[12px] font-semibold tabular-nums text-amber-700">{tax.tds > 0 ? `${tax.tdsPct.toFixed(1)}%` : '—'}</span>
  )
  if (resourceType === 'tax-ledger' && col === 'Outstanding Amount') return (
    <span className="text-[12px] font-semibold tabular-nums text-amber-700">{tax.outstanding > 0 ? fmtInr(tax.outstanding) : '—'}</span>
  )
  if (col === meta.clientField) return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full max-w-full truncate"
      style={{ background: showClientAccents ? hexRgba(clr, 0.1) : '#f1f5f9', color: showClientAccents ? clr : '#475569', border: `1px solid ${showClientAccents ? hexRgba(clr, 0.2) : '#e2e8f0'}` }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: clr }} />
      <span className="truncate">{f[col] || '—'}</span>
    </span>
  )
  if (col === meta.titleField) return (
    <span className="text-[13px] font-semibold text-gray-900 block truncate">{f[col] || '—'}</span>
  )
  if (col === meta.statusField) return <StatusBadge value={f[col]} />
  if (col === 'Short Status') return (
    // Clamp to 2 lines — never dump the full paragraph
    <span className="text-[12px] text-gray-700 leading-snug block"
      style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
      {f[col] || '—'}
    </span>
  )
  if (col === 'Current Status (Detailed)') return (
    <span className="text-[11px] text-gray-500 leading-relaxed block"
      style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
      {f[col] || '—'}
    </span>
  )
  if (col === 'Health') return (
    <span className="text-[12px] font-medium text-gray-700">{f[col] || '—'}</span>
  )
  if (['Amount Billed So far', 'Actual Profit', 'Amount Raised', 'Amount with Tax', 'Amount Received', 'Outstanding Amount'].includes(col)) return (
    <span className="text-[12px] font-semibold tabular-nums text-gray-800">{fmtInr(f[col])}</span>
  )
  if (col === 'Agening (Days)') return (
    <span className="text-[12px] font-semibold tabular-nums text-gray-800">
      {effectiveAging(f) > 0 ? `${effectiveAging(f)}d` : '—'}
    </span>
  )
  if (col === 'Profit percentage') return (
    <span className="text-[12px] font-semibold tabular-nums text-gray-800">{f[col] ? `${Number(f[col]).toFixed(1)}%` : '—'}</span>
  )
  if (['Raised Date', 'Cleared Date', 'Next followup'].includes(col)) return (
    <span className="text-[11px] text-gray-600 whitespace-nowrap">{fmtDate(f[col])}</span>
  )
  if (col === 'Reference' || col === 'Invoice PDF' || col === 'Attachments') {
    const files = parseAttachments(f[col])
    if (!files.length) return <span className="text-[11px] text-gray-400">—</span>
    const first = fileTypeInfo(files[0])
    return (
      <span className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[11px] font-semibold"
        style={{ background: first.bg, color: first.color }}>
        <first.Icon size={10} />
        {files.length} file{files.length === 1 ? '' : 's'}
      </span>
    )
  }
  if (col === 'Last Modified') return (
    <span className="text-[11px] text-gray-400 whitespace-nowrap">{fmtDate(f.lastModifiedTime || '')}</span>
  )
  return <span className="text-[12px] text-gray-700 truncate block">{f[col] || '—'}</span>
}

function ListView({ records, columns, resourceType, canEdit, onEdit, onDetail, showClientAccents = true, highlightColumns = [] }) {
  const meta = RESOURCE_META[resourceType]
  const cols = (columns || meta.defaultColumns).filter(c => meta.columns.includes(c))
  const highlighted = new Set((highlightColumns || []).filter((col) => cols.includes(col)))

  // Build grid template: one column per field + fixed actions column
  const gridTemplate = [...cols.map(c => COL_WIDTHS[c] || '1fr'), '64px'].join(' ')

  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid #e2e8f0', background: '#fff' }}>
      {/* Sticky header */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: 900 }}>
          {/* Header row */}
          <div className="grid px-4 py-2.5 gap-3"
            style={{ gridTemplateColumns: gridTemplate, background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
            {cols.map(col => (
              <div
                key={col}
                className="text-[10px] font-bold uppercase tracking-wide px-3 py-2 whitespace-nowrap overflow-hidden"
                style={highlighted.has(col)
                  ? {
                      color: '#1d4ed8',
                      background: 'linear-gradient(180deg, rgba(59,130,246,0.16), rgba(59,130,246,0.10))',
                      borderTop: '1px solid rgba(59,130,246,0.24)',
                      borderBottom: '1px solid rgba(59,130,246,0.24)',
                      borderLeft: '1px solid rgba(59,130,246,0.24)',
                      borderRight: '1px solid rgba(59,130,246,0.24)',
                      borderTopLeftRadius: 12,
                      borderTopRightRadius: 12,
                    }
                  : { color: '#94a3b8' }}
              >
                {COL_LABELS[col] || col}
              </div>
            ))}
            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 text-right">–</div>
          </div>

          {/* Data rows */}
          {records.map((r, i) => {
            const f = r.fields || {}
            const clr = clientColor(f[meta.clientField] || '')
            return (
              <div key={r.id}
                className="grid px-4 gap-3 group transition-colors"
                style={{
                  gridTemplateColumns: gridTemplate,
                  alignItems: 'center',
                  minHeight: 52,
                  paddingTop: 10,
                  paddingBottom: 10,
                  background: i % 2 === 0 ? '#fff' : '#fafafa',
                  borderBottom: '1px solid #f1f5f9',
                  borderLeft: showClientAccents ? `3px solid ${hexRgba(clr, 0.5)}` : '3px solid transparent',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = hexRgba(clr, 0.03) }}
                onMouseLeave={e => { e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#fafafa' }}
              >
                {cols.map(col => (
                  <div
                    key={col}
                    className="min-w-0 px-3 py-2 transition-colors"
                    style={highlighted.has(col)
                      ? {
                          background: 'linear-gradient(180deg, rgba(59,130,246,0.12), rgba(59,130,246,0.07))',
                          borderLeft: '1px solid rgba(59,130,246,0.18)',
                          borderRight: '1px solid rgba(59,130,246,0.18)',
                        }
                      : undefined}
                  >
                    {cellContent(col, f, clr, resourceType, meta, showClientAccents)}
                  </div>
                ))}
                {/* Actions */}
                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => onDetail(r)}
                    className="p-1.5 rounded-lg transition-colors"
                    style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#334155'}
                    onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}
                    title="View details">
                    <Eye size={13} />
                  </button>
                  {canEdit && (
                    <button onClick={() => onEdit(r)}
                      className="p-1.5 rounded-lg transition-colors"
                      style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.color = '#2563eb'}
                      onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}
                      title="Edit">
                      <Pencil size={13} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
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

function DetailModal({ resourceType, record, onClose, onTrackEvent }) {
  const meta = RESOURCE_META[resourceType] || RESOURCE_META.status
  const f = record?.fields || {}
  const groupValue = f[meta.clientField] || 'Unknown'
  const titleValue = f[meta.titleField] || 'Untitled'
  const statusValue = f[meta.statusField] || ''
  const accent = clientColor(groupValue)
  const [previewDocs, setPreviewDocs] = useState(null)

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') { if (previewDocs) { setPreviewDocs(null) } else { onClose() } } }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose, previewDocs])

  if (!record) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(10px)' }}
      onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col rounded-[24px] shadow-2xl"
        style={{ background: '#fff', border: '1px solid #e5e7eb' }}
        onClick={e => e.stopPropagation()}>

        {/* ── Header ─────────────────────────────────── */}
        <div className="px-6 pt-6 pb-5 flex-shrink-0"
          style={{ borderBottom: '1px solid #f1f5f9', background: `linear-gradient(135deg, ${hexRgba(accent, 0.07)} 0%, #fff 70%)` }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold mb-2"
                style={{ background: hexRgba(accent, 0.1), border: `1px solid ${hexRgba(accent, 0.22)}`, color: accent }}>
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: accent }} />
                {groupValue}
              </div>
              <h2 className="text-[18px] font-bold text-slate-900 leading-snug">{titleValue}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge value={statusValue} />
                {f['Last Modified'] && (
                  <span className="text-[11px] text-slate-400">
                    Updated {fmtDate(f['Last Modified'])}
                  </span>
                )}
              </div>
            </div>
            <button onClick={onClose}
              className="flex-shrink-0 p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── Body ───────────────────────────────────── */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">

          {/* STATUS resource */}
          {resourceType === 'status' && (
            <>
              {f['Short Status'] && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-400 mb-1.5">Summary</p>
                  <p className="text-[14px] font-semibold text-slate-800 leading-relaxed">{f['Short Status']}</p>
                </div>
              )}
              {f['Current Status (Detailed)'] && (
                <div className="rounded-2xl p-4" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-400 mb-2">Detailed Status</p>
                  <p className="text-[13px] text-slate-700 leading-relaxed whitespace-pre-wrap">{f['Current Status (Detailed)']}</p>
                </div>
              )}
              {parseAttachments(f['Attachments']).length > 0 && (() => {
                const files = parseAttachments(f['Attachments'])
                return (
                  <div className="rounded-2xl p-4" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                    <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-400 mb-3">
                      Attachments <span className="font-normal normal-case text-slate-400">· {files.length} file{files.length !== 1 ? 's' : ''} · click to preview</span>
                    </p>
                    <AttachmentList
                      attachments={files}
                      onPreview={index => {
                        const item = files[index]
                        const name = item?.name || item?.filename || `File ${index + 1}`
                        const info = fileTypeInfo(item)
                        onTrackEvent?.('attachment_open', record, { file_name: name, file_type: info.label })
                        setPreviewDocs({ docs: files, index })
                      }}
                    />
                  </div>
                )
              })()}
              <DocPreviewModal state={previewDocs} onClose={() => setPreviewDocs(null)} />
              {f['Notes'] && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-400 mb-1.5">Notes</p>
                  <p className="text-[13px] text-slate-600 leading-relaxed">{f['Notes']}</p>
                </div>
              )}
            </>
          )}

          {/* PROJECTS resource */}
          {resourceType === 'projects' && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  ['Health', f['Health'] || '—'],
                  ['Billed', fmtInr(f['Amount Billed So far'])],
                  ['Profit', fmtInr(f['Actual Profit'])],
                  ['Margin', f['Profit percentage'] ? `${Number(f['Profit percentage']).toFixed(1)}%` : '—'],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl px-3 py-3 text-center" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 mb-1">{label}</p>
                    <p className="text-sm font-bold text-slate-800">{value}</p>
                  </div>
                ))}
              </div>
              {f['Notes'] && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-400 mb-1.5">Notes</p>
                  <p className="text-[13px] text-slate-600 leading-relaxed whitespace-pre-wrap">{f['Notes']}</p>
                </div>
              )}
            </>
          )}

          {/* INVOICES resource */}
          {resourceType === 'invoices' && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  ['Raised', fmtInr(f['Amount Raised'])],
                  ['Received', fmtInr(f['Amount Received'])],
                  ['Raised Date', fmtDate(f['Raised Date'])],
                  ['Cleared Date', fmtDate(f['Cleared Date'])],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl px-3 py-3 text-center" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 mb-1">{label}</p>
                    <p className="text-sm font-bold text-slate-800">{value}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Project', f['Project'] || '—'],
                  ['Category', f['Category'] || '—'],
                  ['Payment Status', f['Payment Status'] || '—'],
                  ['Next Follow-up', fmtDate(f['Next followup'])],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl px-3 py-2.5" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 mb-0.5">{label}</p>
                    <p className="text-[13px] font-semibold text-slate-700">{value}</p>
                  </div>
                ))}
              </div>
              {f['Remark'] && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-400 mb-1.5">Remark</p>
                  <p className="text-[13px] text-slate-600 leading-relaxed">{f['Remark']}</p>
                </div>
              )}
            </>
          )}

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
      <div className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col"
        style={{ background: '#fff', border: '1px solid #e5e7eb', maxHeight: '92vh' }}>
        {/* sticky header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0" style={{ borderBottom: '1px solid #e5e7eb' }}>
          <h2 className="text-base font-bold text-gray-900">Update {resourceType === 'status' ? 'Status' : resourceType === 'projects' ? 'Project' : 'Invoice'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        {/* scrollable body */}
        <form onSubmit={e => { e.preventDefault(); onSave(form) }} className="flex flex-col flex-1 min-h-0">
          <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4" style={{ WebkitOverflowScrolling: 'touch' }}>
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
                  <input className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: '#e2e8f0' }} value={form.short_status || ''} onChange={e => setForm(v => ({ ...v, short_status: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5 text-gray-700">Detail</label>
                  <textarea rows={5} className="w-full rounded-xl border px-3 py-2 text-sm resize-none" style={{ borderColor: '#e2e8f0' }} value={form.current_status_detailed || ''} onChange={e => setForm(v => ({ ...v, current_status_detailed: e.target.value }))} />
                </div>
              </>
            )}
            {resourceType === 'projects' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-semibold mb-1.5 text-gray-700">Client</label><input className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: '#e2e8f0' }} value={form.client || ''} onChange={e => setForm(v => ({ ...v, client: e.target.value }))} /></div>
                  <div><label className="block text-xs font-semibold mb-1.5 text-gray-700">Project Name</label><input className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: '#e2e8f0' }} value={form.project_name || ''} onChange={e => setForm(v => ({ ...v, project_name: e.target.value }))} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-semibold mb-1.5 text-gray-700">Project Status</label><input className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: '#e2e8f0' }} value={form.project_status || ''} onChange={e => setForm(v => ({ ...v, project_status: e.target.value }))} /></div>
                  <div><label className="block text-xs font-semibold mb-1.5 text-gray-700">Amount Billed</label><input type="number" className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: '#e2e8f0' }} value={form.amount_billed || ''} onChange={e => setForm(v => ({ ...v, amount_billed: e.target.value }))} /></div>
                </div>
              </>
            )}
            {resourceType === 'invoices' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-semibold mb-1.5 text-gray-700">Invoice Number</label><input className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: '#e2e8f0' }} value={form.invoice_number || ''} onChange={e => setForm(v => ({ ...v, invoice_number: e.target.value }))} /></div>
                  <div><label className="block text-xs font-semibold mb-1.5 text-gray-700">Payment Status</label><input className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: '#e2e8f0' }} value={form.payment_status || ''} onChange={e => setForm(v => ({ ...v, payment_status: e.target.value }))} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-semibold mb-1.5 text-gray-700">Amount Received</label><input type="number" className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: '#e2e8f0' }} value={form.amount_received || ''} onChange={e => setForm(v => ({ ...v, amount_received: e.target.value }))} /></div>
                  <div><label className="block text-xs font-semibold mb-1.5 text-gray-700">Cleared Date</label><input type="date" className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: '#e2e8f0' }} value={form.cleared_date || ''} onChange={e => setForm(v => ({ ...v, cleared_date: e.target.value }))} /></div>
                </div>
                <div><label className="block text-xs font-semibold mb-1.5 text-gray-700">Next Follow-up</label><input type="date" className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: '#e2e8f0' }} value={form.next_followup || ''} onChange={e => setForm(v => ({ ...v, next_followup: e.target.value }))} /></div>
                <div><label className="block text-xs font-semibold mb-1.5 text-gray-700">Remark</label><textarea rows={4} className="w-full rounded-xl border px-3 py-2 text-sm resize-none" style={{ borderColor: '#e2e8f0' }} value={form.remark || ''} onChange={e => setForm(v => ({ ...v, remark: e.target.value }))} /></div>
              </>
            )}
          </div>
          {/* sticky footer */}
          <div className="flex items-center justify-end gap-2 px-5 py-3 flex-shrink-0" style={{ borderTop: '1px solid #e5e7eb' }}>
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-xl border" style={{ borderColor: '#e2e8f0', color: '#475569' }}>Cancel</button>
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
  const [raisedByFilter, setRaisedByFilter] = useState('')
  const [monthFilter, setMonthFilter] = useState('')
  const [dateFieldFilter, setDateFieldFilter] = useState('Raised Date')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [agingBandFilter, setAgingBandFilter] = useState('')
  const [billingFilter, setBillingFilter] = useState('all')
  const [invoiceScope, setInvoiceScope] = useState('all')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [hasDocsOnly, setHasDocsOnly] = useState(false)
  const [followupDueOnly, setFollowupDueOnly] = useState(false)
  const [viewType, setViewType] = useState('card')
  const [boardGroupBy, setBoardGroupBy] = useState('')
  const [editRecord, setEditRecord] = useState(null)
  const [detailRecord, setDetailRecord] = useState(null)
  const [savingRecordId, setSavingRecordId] = useState('')
  const [pendingStatusById, setPendingStatusById] = useState({})
  const [allExpanded, setAllExpanded] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const trackSharedEvent = useCallback((eventType, record, meta = {}) => {
    if (!token || !eventType || !record?.id) return
    api.sharedViews.recordEvent(token, {
      event_type: eventType,
      record_id: record.id,
      meta,
    })
  }, [token])

  const openDetailRecord = useCallback((record) => {
    if (!record) return
    trackSharedEvent('record_detail', record, {
      title: record.fields?.[RESOURCE_META[data?.resource_type || 'status']?.titleField || 'Project'] || '',
    })
    setDetailRecord(record)
  }, [data?.resource_type, trackSharedEvent])

  const resourceType = data?.resource_type || 'status'
  const meta = RESOURCE_META[resourceType] || RESOURCE_META.status
  const isInvoiceLike = resourceType === 'invoices' || resourceType === 'tax-ledger'

  const load = async ({ silent = false, signal } = {}) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const res = await api.sharedViews.publicGet(token, { signal, fresh: true })
      const vc = res.view_config || {}
      const rt = res.resource_type || 'status'
      const rmeta = RESOURCE_META[rt] || RESOURCE_META.status
      setData(res)
      setRecords(res.records || [])
      setPendingStatusById({})
      if (!silent) {
        setViewType(vc.type || rmeta.defaultView)
        setBoardGroupBy(vc.boardGroupBy || rmeta.statusField)
        setAllExpanded(vc.allExpanded === true)
      }
      setSearch(prev => prev || vc.search || '')
      setFilterPrimary(prev => prev || vc[rmeta.primaryFilterKey] || '')
      setFilterStatus(prev => prev || vc.filterStatus || '')
      setFilterCategory(prev => prev || vc.filterCategory || '')
      setRaisedByFilter(prev => prev || vc.raisedByFilter || '')
      setMonthFilter(prev => prev || vc.monthFilter || '')
      setDateFieldFilter(prev => prev || vc.dateFieldFilter || 'Raised Date')
      setDateFrom(prev => prev || vc.dateFrom || '')
      setDateTo(prev => prev || vc.dateTo || '')
      setAgingBandFilter(prev => prev || vc.agingBandFilter || '')
      setBillingFilter(prev => prev !== 'all' ? prev : (vc.billingFilter || 'all'))
      setInvoiceScope(prev => prev !== 'all' ? prev : (vc.invoiceScope || 'all'))
      setOverdueOnly(prev => prev || vc.overdueOnly === true)
      setHasDocsOnly(prev => prev || vc.hasDocsOnly === true)
      setFollowupDueOnly(prev => prev || vc.followupDueOnly === true)
    } catch (e) {
      if (e?.name === 'AbortError') return
      setError(e.message || 'This link is unavailable')
      setData(null)
      setRecords([])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    load({ signal: controller.signal })
    return () => controller.abort()
  }, [token])

  useEffect(() => {
    if (!token) return
    const refresh = () => load({ silent: true })
    const intervalId = setInterval(refresh, 15000)
    const handleVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', handleVisible)
    return () => {
      clearInterval(intervalId)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', handleVisible)
    }
  }, [token])

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
    () => isInvoiceLike
      ? [...new Set(records.map(r => r.fields?.Category).filter(Boolean))].sort()
      : [],
    [records, isInvoiceLike]
  )
  const raisedByOptions = useMemo(
    () => isInvoiceLike
      ? [...new Set(records.map(r => r.fields?.['Raised By']).filter(Boolean))].sort()
      : [],
    [records, isInvoiceLike]
  )
  const monthOptions = useMemo(
    () => isInvoiceLike
      ? [...new Set(records.map(r => monthKey(r.fields?.['Raised Date'])).filter(Boolean))].sort().reverse()
      : [],
    [records, isInvoiceLike]
  )

  const filtered = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10)
    return recordsForView.filter(r => {
      const f = r.fields || {}
      if (filterPrimary && f[meta.clientField] !== filterPrimary) return false
      if (filterStatus && (f[meta.statusField] || '') !== filterStatus) return false
      if (filterCategory && isInvoiceLike && f.Category !== filterCategory) return false
      if (isInvoiceLike) {
        if (resourceType === 'tax-ledger') {
          const parts = taxParts(f)
          if (invoiceScope === 'tax' && !parts.isPaid) return false
          if (invoiceScope === 'open' && (parts.isPaid || parts.isCancelled)) return false
          if (invoiceScope !== 'all' && parts.isCancelled) return false
        }
        if (raisedByFilter && f['Raised By'] !== raisedByFilter) return false
        if (billingFilter === 'retainer' && !/retainer/i.test(String(f.Category || ''))) return false
        if (billingFilter === 'project' && /retainer/i.test(String(f.Category || ''))) return false
        if (monthFilter && monthKey(f['Raised Date']) !== monthFilter) return false
        if (dateFrom || dateTo) {
          const candidate = dateOnlyValue(f[dateFieldFilter])
          if (!candidate) return false
          if (dateFrom && candidate < dateFrom) return false
          if (dateTo && candidate > dateTo) return false
        }
        if (agingBandFilter) {
          if ((f['Payment Status'] || '') !== 'Pending') return false
          if (classifyAgingBand(effectiveAging(f)) !== agingBandFilter) return false
        }
        if (overdueOnly && !((f['Payment Status'] || '') === 'Pending' || Number(f['Outstanding Amount'] || 0) > 0)) return false
        if (hasDocsOnly && parseAttachments(f['Reference']).length + parseAttachments(f['Invoice PDF']).length === 0) return false
        if (followupDueOnly) {
          const followup = dateOnlyValue(f['Next followup'])
          if (!followup || followup > todayIso) return false
        }
      }
      if (search) {
        const q = search.toLowerCase()
        const hay = meta.searchFields.map(key => f[key] || '').join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [recordsForView, filterPrimary, filterStatus, filterCategory, search, meta, resourceType, isInvoiceLike, invoiceScope, raisedByFilter, billingFilter, monthFilter, dateFieldFilter, dateFrom, dateTo, agingBandFilter, overdueOnly, hasDocsOnly, followupDueOnly])

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
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#f1f5f9' }}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={28} className="animate-spin" style={{ color: '#3b82f6' }} />
          <p className="text-sm font-medium" style={{ color: '#64748b' }}>Loading shared view…</p>
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
    <div className="min-h-screen" style={{ background: '#f1f5f9', ...accentStyle }}>
      <header className="sticky top-0 z-30" style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', boxShadow: '0 1px 8px rgba(15,23,42,0.06)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: theme.accentDim, border: `1px solid ${theme.accentSoft}` }}>
                <Activity size={16} style={{ color: theme.accent }} />
              </div>
              <div className="min-w-0">
                <h1 className="text-base font-bold text-gray-900 leading-tight truncate">{title}</h1>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {filtered.length} of {records.length} {meta.plural}
                  {createdAt && ` · ${fmtDate(createdAt)}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => load({ silent: true })}
                className="w-8 h-8 rounded-lg border flex items-center justify-center"
                style={{ borderColor: '#e2e8f0', color: '#64748b', background: '#f8fafc' }}>
                <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
              </button>
              <button onClick={() => setFiltersOpen(v => !v)}
                className="flex items-center gap-1.5 px-3 h-8 rounded-lg border text-xs font-semibold sm:hidden"
                style={{ borderColor: filtersOpen ? theme.accentSoft : '#e2e8f0', color: filtersOpen ? theme.accent : '#475569', background: filtersOpen ? theme.accentDim : '#f8fafc' }}>
                <Search size={12} /> Filters
              </button>
              <span className="hidden sm:flex items-center gap-1.5 text-xs text-gray-400">
                <Shield size={11} /> FinTrack
              </span>
            </div>
          </div>

          <SnapshotSummary viewConfig={vc} accessMode={data?.access_mode || 'read'} />

          {showDashboard && records.length > 0 && (
            resourceType === 'tax-ledger' ? (
              <TaxLedgerDashboard
                records={filtered}
                filterStatus={filterStatus}
                onFilterStatus={setFilterStatus}
                theme={theme}
              />
            ) : (
              <SummaryStrip
                records={records}
                statusOptions={statusOptions}
                filterStatus={filterStatus}
                onFilterStatus={setFilterStatus}
                accent={theme}
                noun={meta.plural}
                statusField={meta.statusField}
              />
            )
          )}

          <div className={`${filtersOpen || window.innerWidth >= 640 ? 'flex' : 'hidden'} sm:flex flex-col sm:flex-row flex-wrap gap-2`}>
            <div className="relative flex-1 min-w-[180px]">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" />
              <input type="text" className="w-full rounded-xl border bg-white pl-8 pr-3 py-2 text-sm outline-none"
                style={{ borderColor: '#e2e8f0' }}
                placeholder={`Search ${meta.plural}…`}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <select className="rounded-xl border bg-white px-3 py-2 text-sm outline-none" style={{ borderColor: '#e2e8f0' }} value={filterPrimary} onChange={e => setFilterPrimary(e.target.value)}>
              <option value="">{meta.primaryLabel}</option>
              {primaryOptions.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <select className="rounded-xl border bg-white px-3 py-2 text-sm outline-none" style={{ borderColor: '#e2e8f0' }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All statuses</option>
              {statusOptions.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            {isInvoiceLike && (
              <select className="rounded-xl border bg-white px-3 py-2 text-sm outline-none" style={{ borderColor: '#e2e8f0' }} value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
                <option value="">All categories</option>
                {categoryOptions.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            )}
            {isInvoiceLike && (
              <select className="rounded-xl border bg-white px-3 py-2 text-sm outline-none" style={{ borderColor: '#e2e8f0' }} value={raisedByFilter} onChange={e => setRaisedByFilter(e.target.value)}>
                <option value="">All owners</option>
                {raisedByOptions.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            )}
            <div className="flex items-center rounded-xl overflow-hidden border bg-slate-50" style={{ borderColor: '#e2e8f0' }}>
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
              <select className="rounded-xl border bg-white px-3 py-2 text-sm outline-none" style={{ borderColor: '#e2e8f0' }} value={activeBoardGroupBy} onChange={e => setBoardGroupBy(e.target.value)}>
                {boardGroupOptions.map(v => <option key={v} value={v}>Group by {v}</option>)}
              </select>
            )}
            {viewType === 'card' && (
              <button
                onClick={() => setAllExpanded(v => !v)}
                className="rounded-xl border bg-white px-3 py-2 text-sm font-medium flex items-center gap-2"
                style={{ borderColor: '#e2e8f0', color: '#475569' }}
              >
                {allExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                {allExpanded ? 'Collapse all' : 'Expand all'}
              </button>
            )}
            <button onClick={() => load({ silent: true })} className="hidden sm:flex rounded-xl border bg-white px-3 py-2 text-sm font-medium items-center gap-2" style={{ borderColor: '#e2e8f0', color: '#475569' }}>
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
          {isInvoiceLike && (
            <div className="mt-3 flex flex-wrap gap-2">
              {resourceType === 'tax-ledger' && (
                <select className="rounded-xl border bg-white px-3 py-2 text-sm outline-none" style={{ borderColor: '#e2e8f0' }} value={invoiceScope} onChange={e => setInvoiceScope(e.target.value)}>
                  <option value="all">All valid invoices</option>
                  <option value="tax">Paid tax register</option>
                  <option value="open">Open invoices only</option>
                </select>
              )}
              <select className="rounded-xl border bg-white px-3 py-2 text-sm outline-none" style={{ borderColor: '#e2e8f0' }} value={billingFilter} onChange={e => setBillingFilter(e.target.value)}>
                <option value="all">All billing</option>
                <option value="project">Projects only</option>
                <option value="retainer">Retainers only</option>
              </select>
              <select className="rounded-xl border bg-white px-3 py-2 text-sm outline-none" style={{ borderColor: '#e2e8f0' }} value={monthFilter} onChange={e => setMonthFilter(e.target.value)}>
                <option value="">All raised months</option>
                {monthOptions.map(v => <option key={v} value={v}>{new Date(`${v}-01`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</option>)}
              </select>
              <select className="rounded-xl border bg-white px-3 py-2 text-sm outline-none" style={{ borderColor: '#e2e8f0' }} value={dateFieldFilter} onChange={e => setDateFieldFilter(e.target.value)}>
                <option value="Raised Date">Raised Date</option>
                <option value="Cleared Date">Cleared Date</option>
                <option value="Next followup">Next Follow-up</option>
              </select>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="rounded-xl border bg-white px-3 py-2 text-sm outline-none" style={{ borderColor: '#e2e8f0' }} />
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="rounded-xl border bg-white px-3 py-2 text-sm outline-none" style={{ borderColor: '#e2e8f0' }} />
              <select className="rounded-xl border bg-white px-3 py-2 text-sm outline-none" style={{ borderColor: '#e2e8f0' }} value={agingBandFilter} onChange={e => setAgingBandFilter(e.target.value)}>
                <option value="">All aging</option>
                {['0-14d', '15-30d', '31-60d', '60d+'].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <button onClick={() => setOverdueOnly(v => !v)} className="rounded-xl border px-3 py-2 text-sm font-medium" style={{ borderColor: overdueOnly ? theme.accentSoft : '#e5e7eb', color: overdueOnly ? theme.accent : '#475569', background: overdueOnly ? theme.accentDim : '#fff' }}>
                Outstanding only
              </button>
              <button onClick={() => setHasDocsOnly(v => !v)} className="rounded-xl border px-3 py-2 text-sm font-medium" style={{ borderColor: hasDocsOnly ? theme.accentSoft : '#e5e7eb', color: hasDocsOnly ? theme.accent : '#475569', background: hasDocsOnly ? theme.accentDim : '#fff' }}>
                With docs only
              </button>
              <button onClick={() => setFollowupDueOnly(v => !v)} className="rounded-xl border px-3 py-2 text-sm font-medium" style={{ borderColor: followupDueOnly ? theme.accentSoft : '#e5e7eb', color: followupDueOnly ? theme.accent : '#475569', background: followupDueOnly ? theme.accentDim : '#fff' }}>
                Follow-up due
              </button>
            </div>
          )}
        </div>
      </header>

      {expiresAt && (
        <div className={`py-2 text-center text-xs font-medium ${expired ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>
          <Clock className="inline mr-1" size={11} />
          {expired ? `This link expired on ${fmtDateTime(expiresAt)}` : `This link expires on ${fmtDateTime(expiresAt)}`}
        </div>
      )}

      <main className={`mx-auto px-4 sm:px-6 py-6 ${viewType === 'board' ? 'max-w-full' : 'max-w-6xl'}`}>
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
                onDetail={openDetailRecord}
                compact={compact}
                showClientAccents={showClientAccents}
                groupByField={activeCardGroupBy}
                groupSort={vc.cardGroupSort || 'count-desc'}
                recordSort={vc.cardRecordSort || 'project-asc'}
                allExpanded={allExpanded}
              />
            )}
            {viewType === 'list' && <ListView records={filtered} columns={listColumns} resourceType={resourceType} canEdit={canEdit} onEdit={setEditRecord} onDetail={openDetailRecord} showClientAccents={showClientAccents} highlightColumns={vc.highlightColumns || []} />}
            {viewType === 'board' && <BoardView records={filtered} resourceType={resourceType} statusOptions={statusOptions} canEdit={canEdit} onEdit={setEditRecord} onDetail={openDetailRecord} onDropStatus={moveRecordToStatus} compact={compact} showClientAccents={showClientAccents} groupByField={activeBoardGroupBy} />}
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
          statusOptions={resourceType === 'status' ? DEFAULT_BOARD_ORDER : statusOptions}
          saving={savingRecordId === editRecord.id}
          onClose={() => setEditRecord(null)}
          onSave={form => saveRecordChanges(editRecord, form)}
        />
      )}
      {detailRecord && <DetailModal resourceType={resourceType} record={detailRecord} onClose={() => setDetailRecord(null)} onTrackEvent={trackSharedEvent} />}
    </div>
  )
}
