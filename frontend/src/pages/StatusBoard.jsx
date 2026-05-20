/**
 * Status Board v3
 *
 * • Status Dashboard — live stat strip with per-status counts + click-to-filter
 * • Three view modes: Card (grouped by client) | List (configurable columns) | Board (Kanban DnD)
 * • Kanban drag-and-drop — drag cards between status columns, updates Teable instantly
 * • Detail Panel — slide-in right panel with full record details (eye button)
 * • Saved Views — name, save, switch, delete views (localStorage)
 * • URL-encoded view config — shareable internal links (?v=BASE64)
 * • Multi-select + AI Update + External Share (existing)
 * • Mobile-first responsive throughout
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Activity, Plus, Pencil, Trash2, X, Check,
  ChevronDown, ChevronUp, RefreshCw, Search,
  AlertCircle, Loader2, ClipboardList, Sparkles,
  Share2, Copy, CheckCheck, ExternalLink, Eye,
  Clock, ToggleLeft, ToggleRight, Link2,
  MapPin, Monitor, Smartphone, Globe, Shield,
  LayoutGrid, List, Columns,
  Bookmark, BookmarkPlus, Trash, SlidersHorizontal,
  GripVertical, ArrowRight, ChevronRight, TrendingUp,
  Receipt, Unlink,
} from 'lucide-react'
import { api } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { FilterBuilder, applyConditions } from '../components/FilterBuilder'
import InvoicePicklist from '../components/InvoicePicklist'
import { formatInr } from '../utils/format'

// ── Status config ─────────────────────────────────────────────────────────────
// Fallback only — real options are fetched dynamically from the picklist API
// and merged at runtime in the component. This array is never shown on its own.
const STATUS_OPTIONS_FALLBACK = ['In progress', 'Input Pending', 'On Hold', 'Not started', 'Completed']
const THEME_PRESETS = {
  cobalt: {
    id: 'cobalt',
    label: 'Cobalt',
    accent: '#2563eb',
    accentDim: 'rgba(37,99,235,0.12)',
    accentSoft: 'rgba(37,99,235,0.24)',
    accentGradient: 'linear-gradient(135deg,#2563eb,#1d4ed8)',
  },
  emerald: {
    id: 'emerald',
    label: 'Emerald',
    accent: '#059669',
    accentDim: 'rgba(5,150,105,0.12)',
    accentSoft: 'rgba(5,150,105,0.24)',
    accentGradient: 'linear-gradient(135deg,#059669,#047857)',
  },
  amber: {
    id: 'amber',
    label: 'Amber',
    accent: '#d97706',
    accentDim: 'rgba(217,119,6,0.12)',
    accentSoft: 'rgba(217,119,6,0.24)',
    accentGradient: 'linear-gradient(135deg,#f59e0b,#d97706)',
  },
  rose: {
    id: 'rose',
    label: 'Rose',
    accent: '#e11d48',
    accentDim: 'rgba(225,29,72,0.12)',
    accentSoft: 'rgba(225,29,72,0.24)',
    accentGradient: 'linear-gradient(135deg,#f43f5e,#e11d48)',
  },
  slate: {
    id: 'slate',
    label: 'Slate',
    accent: '#475569',
    accentDim: 'rgba(71,85,105,0.12)',
    accentSoft: 'rgba(71,85,105,0.24)',
    accentGradient: 'linear-gradient(135deg,#64748b,#475569)',
  },
}
const STATUS_CONFIG = {
  'Completed':     { color: '#10b981', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.35)', dot: '#10b981', light: '#dcfce7' },
  'In progress':   { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.35)', dot: '#3b82f6', light: '#dbeafe' },
  'On Hold':       { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.35)', dot: '#f59e0b', light: '#fef3c7' },
  'Input Pending': { color: '#f97316', bg: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.35)', dot: '#f97316', light: '#ffedd5' },
  'Not started':   { color: '#94a3b8', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.30)', dot: '#94a3b8', light: '#f1f5f9' },
}
function statusStyle(s) {
  return STATUS_CONFIG[s] || { color: '#94a3b8', bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.2)', dot: '#94a3b8', light: '#f1f5f9' }
}

// ── List view columns ─────────────────────────────────────────────────────────
const ALL_COLUMNS = ['Client', 'Project', 'Status', 'Short Status', 'Detailed Status', 'Last Modified']
const DEFAULT_COLUMNS = ['Client', 'Project', 'Status', 'Short Status']
const LIST_COLUMN_META = {
  'Client': { label: 'Client', track: 'minmax(150px, 1.05fr)', minWidth: 150 },
  'Project': { label: 'Project', track: 'minmax(240px, 1.6fr)', minWidth: 240 },
  'Status': { label: 'Status', track: '144px', minWidth: 144 },
  'Short Status': { label: 'Headline', track: 'minmax(260px, 1.55fr)', minWidth: 260 },
  'Detailed Status': { label: 'Detail', track: 'minmax(320px, 1.75fr)', minWidth: 320 },
  'Last Modified': { label: 'Modified', track: '112px', minWidth: 112 },
}

function getListLayout(columns, isEditor) {
  const active = columns.filter(col => LIST_COLUMN_META[col])
  const actionWidth = isEditor ? 96 : 44
  const baseTracks = [isEditor ? '28px' : '16px']
  const tracks = [
    ...baseTracks,
    ...active.map(col => LIST_COLUMN_META[col].track),
    `${actionWidth}px`,
  ]
  const minWidth = active.reduce((sum, col) => sum + LIST_COLUMN_META[col].minWidth, 0) + actionWidth + (isEditor ? 28 : 16) + 48
  return {
    active,
    actionWidth,
    gridTemplateColumns: tracks.join(' '),
    minWidth,
  }
}

// ── Client colour palette ─────────────────────────────────────────────────────
const PALETTE = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#ec4899','#0ea5e9','#eab308','#14b8a6','#f97316','#6366f1','#84cc16']
const _clientMap = {}
function clientColor(name) {
  if (!_clientMap[name]) { _clientMap[name] = PALETTE[Object.keys(_clientMap).length % PALETTE.length] }
  return _clientMap[name]
}
function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
  return `rgba(${r},${g},${b},${a})`
}

// ── Expiry presets ─────────────────────────────────────────────────────────────
const EXPIRY_OPTS = [
  { label: 'Never',    value: 0   },
  { label: '1 hour',   value: 1   },
  { label: '24 hours', value: 24  },
  { label: '3 days',   value: 72  },
  { label: '7 days',   value: 168 },
  { label: '30 days',  value: 720 },
]
const MAX_SHARED_VIEW_RECORDS = 50
const STATUS_FILTER_FIELDS = [
  { key: 'Client', label: 'Client', type: 'text' },
  { key: 'Project', label: 'Project', type: 'text' },
  { key: 'Status', label: 'Status', type: 'text' },
  { key: 'Short Status', label: 'Headline', type: 'text' },
  { key: 'Current Status (Detailed)', label: 'Detail', type: 'text' },
  { key: 'lastModifiedTime', label: 'Last Modified', type: 'date' },
]
const BOARD_GROUP_OPTIONS = [
  { value: 'Status', label: 'Status' },
  { value: 'Client', label: 'Client' },
]
const CARD_GROUP_OPTIONS = [
  { value: 'Client', label: 'Client' },
  { value: 'Status', label: 'Status' },
]
const CARD_GROUP_SORT_OPTIONS = [
  { value: 'count-desc', label: 'Most projects first' },
  { value: 'count-asc', label: 'Least projects first' },
  { value: 'name-asc', label: 'Group A-Z' },
  { value: 'name-desc', label: 'Group Z-A' },
]
const CARD_RECORD_SORT_OPTIONS = [
  { value: 'project-asc', label: 'Project A-Z' },
  { value: 'project-desc', label: 'Project Z-A' },
  { value: 'modified-desc', label: 'Recently updated' },
  { value: 'modified-asc', label: 'Oldest updated' },
  { value: 'status-asc', label: 'Status A-Z' },
]

function fmtDate(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' }) } catch { return iso }
}
function fmtShortDate(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('en-IN', { day:'numeric', month:'short' }) } catch { return iso }
}
function isExpired(iso) { return iso ? new Date(iso) < new Date() : false }
function resolveTheme(themeId) { return THEME_PRESETS[themeId] || THEME_PRESETS.cobalt }

// ── View config helpers ───────────────────────────────────────────────────────
function encodeViewConfig(cfg) {
  try { return btoa(JSON.stringify(cfg)) } catch { return '' }
}
function decodeViewConfig(s) {
  try { return JSON.parse(atob(s)) } catch { return null }
}
function getViewConfigFromUrl() {
  try {
    const p = new URLSearchParams(window.location.search)
    const v = p.get('v')
    if (v) return decodeViewConfig(v)
  } catch {}
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Status Dashboard strip
// ─────────────────────────────────────────────────────────────────────────────
function StatusDashboard({ records, statusOptions, filterStatus, onFilterStatus }) {
  const total = records.length
  const counts = statusOptions.reduce((acc, s) => {
    acc[s] = records.filter(r => (r.fields?.['Status'] || 'Not started') === s).length
    return acc
  }, {})

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div className="flex gap-2 min-w-max">
      {/* Total */}
      <button
        onClick={() => onFilterStatus('')}
        className="flex items-center gap-2 px-3 py-2 rounded-xl transition-all text-left shrink-0"
        style={{
          background: !filterStatus ? 'var(--accent)' : 'var(--card-bg)',
          border: !filterStatus ? '1.5px solid var(--accent)' : '1px solid var(--border)',
          color: !filterStatus ? '#fff' : 'var(--text-2)',
          boxShadow: !filterStatus ? '0 2px 8px rgba(37,99,235,0.25)' : 'none',
        }}
      >
        <span className="text-lg font-bold tabular-nums leading-none" style={{ color: !filterStatus ? '#fff' : 'var(--text-1)' }}>{total}</span>
        <span className="text-xs font-semibold">All Projects</span>
      </button>

      {statusOptions.map(s => {
        const sc = statusStyle(s)
        const cnt = counts[s] || 0
        const active = filterStatus === s
        return (
          <button
            key={s}
            onClick={() => onFilterStatus(active ? '' : s)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl transition-all text-left shrink-0"
            style={{
              background: active ? sc.bg : 'var(--card-bg)',
              border: active ? `1.5px solid ${sc.border}` : '1px solid var(--border)',
              boxShadow: active ? `0 2px 8px ${sc.bg}` : 'none',
            }}
          >
            <span className="text-lg font-bold tabular-nums leading-none" style={{ color: sc.color }}>{cnt}</span>
            <div>
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.dot }} />
                <span className="text-xs font-semibold" style={{ color: active ? sc.color : 'var(--text-2)' }}>{s}</span>
              </div>
            </div>
          </button>
        )
      })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail Panel — slide-in from right
// ─────────────────────────────────────────────────────────────────────────────
function DetailPanel({ record, onClose, onEdit, onDelete, isEditor, openInvoice = false }) {
  const f = record?.fields || {}
  const client  = f['Client']  || ''
  const project = f['Project'] || ''
  const status  = f['Status']  || ''
  const short   = f['Short Status'] || ''
  const detail  = f['Current Status (Detailed)'] || ''
  const modified = f['lastModifiedTime'] || record?.createdTime || ''
  const clrHex  = clientColor(client)
  const sc      = statusStyle(status)
  const toast   = useToast()

  // ── Linked invoices state ──────────────────────────────────────────────
  const [linkedInvoices,  setLinkedInvoices]  = useState([])
  const [loadingInvs,     setLoadingInvs]     = useState(false)
  const [showPicklist,    setShowPicklist]     = useState(false)
  const [unlinkingId,     setUnlinkingId]     = useState(null)

  // Load linked invoices when the panel opens
  useEffect(() => {
    if (!record?.id) return
    setLoadingInvs(true)
    api.projectInvoices.list(record.id)
      .then(res => setLinkedInvoices(res.invoices || []))
      .catch(() => {})
      .finally(() => setLoadingInvs(false))
  }, [record?.id])

  // Auto-open picklist if launched from invoice button on card
  useEffect(() => {
    if (openInvoice) setShowPicklist(true)
  }, [openInvoice])

  const handleLinkInvoice = async (invoiceTId, source) => {
    await api.projectInvoices.link(record.id, invoiceTId, source)
    toast('Invoice linked!', 'success')
    const res = await api.projectInvoices.list(record.id)
    setLinkedInvoices(res.invoices || [])
  }

  const handleUnlinkInvoice = async (invoiceTeableId) => {
    setUnlinkingId(invoiceTeableId)
    try {
      await api.projectInvoices.unlink(record.id, invoiceTeableId)
      setLinkedInvoices(prev => prev.filter(i => i.invoice_teable_id !== invoiceTeableId))
      toast('Invoice unlinked', 'info')
    } catch (e) {
      toast('Unlink failed: ' + e.message, 'error')
    } finally {
      setUnlinkingId(null)
    }
  }

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
      <div
        className="w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden rounded-[28px] shadow-2xl"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-5"
          style={{ background: `linear-gradient(135deg, ${hexToRgba(clrHex, 0.14)}, var(--card-bg))`, borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-bold mb-3"
                style={{ background: hexToRgba(clrHex, 0.12), border: `1px solid ${hexToRgba(clrHex, 0.24)}`, color: clrHex }}>
                <span className="w-2 h-2 rounded-full" style={{ background: clrHex }} />
                {client || 'Unknown client'}
              </div>
              <h2 className="text-2xl font-bold leading-tight" style={{ color: 'var(--text-1)' }}>{project || 'Untitled project'}</h2>
              {modified && (
                <p className="text-xs mt-2 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                  <Clock size={12} />
                  Last updated {fmtDate(modified)}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1">
              {isEditor && (
                <>
                  <button onClick={onEdit} className="btn-icon p-2" title="Edit" style={{ color: 'var(--text-3)' }}>
                    <Pencil size={15} />
                  </button>
                  <button onClick={onDelete} className="btn-icon p-2" title="Delete"
                    style={{ color: 'rgba(239,68,68,0.7)' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                    onMouseLeave={e => e.currentTarget.style.color = 'rgba(239,68,68,0.7)'}>
                    <Trash size={15} />
                  </button>
                </>
              )}
              <button onClick={onClose} className="btn-icon p-2" style={{ color: 'var(--text-3)' }}>
                <X size={16} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">

          {/* ── Linked Invoices — FIRST, most prominent ──────────────────── */}
          <div className="rounded-2xl overflow-hidden"
            style={{ border: '2px solid rgba(37,99,235,0.22)', background: 'var(--card-bg)' }}>
            {/* Section header */}
            <div className="flex items-center justify-between px-4 py-3"
              style={{ background: 'rgba(37,99,235,0.06)', borderBottom: '1px solid rgba(37,99,235,0.12)' }}>
              <div className="flex items-center gap-2">
                <Receipt size={14} style={{ color: 'var(--accent)' }} />
                <p className="text-sm font-bold" style={{ color: 'var(--accent)' }}>
                  Linked Invoices
                </p>
                {linkedInvoices.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold"
                    style={{ background: 'var(--accent)', color: '#fff' }}>
                    {linkedInvoices.length}
                  </span>
                )}
              </div>
              {isEditor && (
                <button
                  onClick={() => setShowPicklist(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
                  style={{ background: 'var(--accent)', color: '#fff', boxShadow: '0 2px 8px rgba(37,99,235,0.3)' }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.88'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >
                  <Receipt size={11} />
                  {linkedInvoices.length > 0 ? 'Add invoice' : 'Link invoice'}
                </button>
              )}
            </div>

            {/* Invoice list */}
            <div className="p-4">
              {loadingInvs && (
                <div className="flex items-center gap-2 py-2" style={{ color: 'var(--text-3)' }}>
                  <Loader2 size={12} className="animate-spin" />
                  <span className="text-xs">Loading…</span>
                </div>
              )}
              {!loadingInvs && linkedInvoices.length === 0 && (
                <div className="flex flex-col items-center py-5 gap-2">
                  <Receipt size={28} style={{ color: 'rgba(37,99,235,0.2)' }} />
                  <p className="text-sm font-medium" style={{ color: 'var(--text-3)' }}>No invoices linked yet</p>
                  {isEditor && (
                    <button
                      onClick={() => setShowPicklist(true)}
                      className="mt-1 flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all"
                      style={{ background: 'rgba(37,99,235,0.1)', color: 'var(--accent)', border: '1px solid rgba(37,99,235,0.2)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(37,99,235,0.18)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'rgba(37,99,235,0.1)'}
                    >
                      <Receipt size={12} /> Link an invoice to this project
                    </button>
                  )}
                </div>
              )}
              {!loadingInvs && linkedInvoices.length > 0 && (
                <div className="space-y-2">
                  {linkedInvoices.map(inv => {
                    const isUnlinking = unlinkingId === inv.invoice_teable_id
                    const statusColor = {
                      'Paid': '#10b981', 'Received': '#10b981',
                      'Partially Paid': '#f59e0b', 'Pending': '#f97316',
                      'Overdue': '#ef4444', 'Raised': '#6366f1',
                    }[inv.payment_status] || 'var(--text-3)'
                    return (
                      <div key={inv.invoice_teable_id}
                        className="flex items-center gap-2.5 p-3 rounded-xl"
                        style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', opacity: isUnlinking ? 0.5 : 1 }}>
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: statusColor }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
                              {inv.invoice_number || '—'}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md font-semibold"
                              style={{ background: `${statusColor}20`, color: statusColor }}>
                              {inv.payment_status || '—'}
                            </span>
                          </div>
                          {inv.raised_date && (
                            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                              {new Date(inv.raised_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </p>
                          )}
                        </div>
                        <span className="text-sm font-bold tabular-nums flex-shrink-0" style={{ color: 'var(--text-1)' }}>
                          {inv.amount_raised != null ? formatInr(inv.amount_raised) : '—'}
                        </span>
                        {isEditor && (
                          <button onClick={() => handleUnlinkInvoice(inv.invoice_teable_id)}
                            disabled={isUnlinking}
                            className="btn-icon flex-shrink-0 rounded-lg" style={{ padding: '0.35rem', color: 'var(--text-3)' }}
                            title={`Unlink ${inv.invoice_number}`}
                            onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}>
                            {isUnlinking ? <Loader2 size={12} className="animate-spin" /> : <Unlink size={12} />}
                          </button>
                        )}
                      </div>
                    )
                  })}
                  {linkedInvoices.length > 1 && (
                    <div className="flex justify-between items-center px-1 pt-2 mt-1" style={{ borderTop: '1px solid var(--border)' }}>
                      <span className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>Total ({linkedInvoices.length} invoices)</span>
                      <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>
                        {formatInr(linkedInvoices.reduce((s, i) => s + (i.amount_raised || 0), 0))}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Status ─────────────────────────────────────────────────── */}
          {status && (
            <div className="rounded-2xl p-4" style={{ background: sc.bg, border: `1px solid ${sc.border}` }}>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: sc.color }}>Current Status</p>
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-bold"
                style={{ background: '#ffffff', color: sc.color, border: `1px solid ${sc.border}` }}>
                <span className="w-2 h-2 rounded-full" style={{ background: sc.dot }} />
                {status}
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[0.9fr,1.1fr] gap-5">
            <div className="space-y-5">
              <div className="rounded-2xl p-4" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-3)' }}>Status Headline</p>
                <p className="text-sm font-semibold leading-relaxed" style={{ color: 'var(--text-1)' }}>{short || 'No headline added yet.'}</p>
              </div>

              <div className="rounded-2xl p-4" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-3)' }}>Portfolio Context</p>
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-[11px] font-semibold mb-1" style={{ color: 'var(--text-3)' }}>Client</p>
                    <p style={{ color: 'var(--text-1)' }}>{client || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold mb-1" style={{ color: 'var(--text-3)' }}>Project</p>
                    <p style={{ color: 'var(--text-1)' }}>{project || '—'}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl p-4" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>Detailed Update</p>
              <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-2)' }}>
                {detail?.trim() || short?.trim() || 'No detailed update added yet.'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Invoice picklist modal */}
      {showPicklist && (
        <InvoicePicklist
          projectId={record.id}
          projectName={project}
          linkedIds={linkedInvoices.map(i => i.invoice_teable_id)}
          onLink={handleLinkInvoice}
          onClose={() => setShowPicklist(false)}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Status Card — Card view
// ─────────────────────────────────────────────────────────────────────────────
function StatusCard({ record, isEditor, onEdit, onDelete, onDetail, onInvoice, selected, onSelect, expanded, onToggle, deleting, compact = false, showClientAccents = true }) {
  const f       = record.fields || {}
  const client  = f['Client']  || '?'
  const project = f['Project'] || '?'
  const short   = f['Short Status'] || ''
  const detail  = f['Current Status (Detailed)'] || ''
  const status  = f['Status'] || ''
  const clrHex  = clientColor(client)
  const sc      = statusStyle(status)
  const hasDetail = detail.trim() && detail.trim() !== short.trim()

  return (
    <div
      className="rounded-2xl overflow-hidden transition-all duration-150 group"
      style={{
        background: selected ? hexToRgba(clrHex, 0.06) : 'var(--card-bg)',
        border: selected ? `2px solid ${clrHex}` : '1px solid var(--border)',
        boxShadow: selected
          ? `0 0 0 3px ${hexToRgba(clrHex, 0.15)}`
          : '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      {/* Client colour bar */}
      {showClientAccents && <div className="h-[3px]" style={{ background: clrHex }} />}

      <div className={compact ? 'p-3' : 'p-4'}>
        {/* Top row */}
        <div className="flex items-start gap-2 mb-3">
          {/* Checkbox */}
          {isEditor && (
            <button
              onClick={e => { e.stopPropagation(); onSelect(record.id) }}
              className="flex-shrink-0 mt-0.5 rounded-md transition-all"
              style={{
                width: 18, height: 18, minWidth: 18,
                background: selected ? clrHex : 'transparent',
                border: `2px solid ${selected ? clrHex : 'var(--border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              title={selected ? 'Deselect' : 'Select'}
            >
              {selected && <Check size={10} color="#fff" strokeWidth={3} />}
            </button>
          )}

          <div className="flex-1 min-w-0">
            {/* Client chip */}
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full mb-1.5"
              style={{
                background: showClientAccents ? hexToRgba(clrHex, 0.12) : 'var(--bg-input)',
                color: showClientAccents ? clrHex : 'var(--text-2)',
                border: `1px solid ${showClientAccents ? hexToRgba(clrHex, 0.25) : 'var(--border)'}`,
              }}>
              {client}
            </span>
            {/* Project name */}
            <p className="text-sm font-bold leading-snug" style={{ color: 'var(--text-1)' }}>{project}</p>
          </div>

          {/* Action icons */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {isEditor && (
              <button onClick={e => { e.stopPropagation(); onInvoice?.(record) }}
                className="btn-icon p-1.5 transition-colors"
                style={{ color: 'var(--accent)' }}
                title="Link invoice">
                <Receipt size={13} />
              </button>
            )}
            <button onClick={e => { e.stopPropagation(); onDetail(record) }}
              className="btn-icon p-1.5 transition-opacity"
              style={{ color: 'var(--text-3)' }}
              title="View details">
              <Eye size={13} />
            </button>
            {isEditor && !deleting && (
              <>
                <button onClick={e => { e.stopPropagation(); onEdit() }}
                  className="btn-icon p-1.5 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                  style={{ color: 'var(--text-3)' }} title="Edit">
                  <Pencil size={12} />
                </button>
                <button onClick={e => { e.stopPropagation(); onDelete() }}
                  className="btn-icon p-1.5 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                  style={{ color: 'rgba(239,68,68,0.5)' }}
                  onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                  onMouseLeave={e => e.currentTarget.style.color = 'rgba(239,68,68,0.5)'}
                  title="Delete">
                  <Trash2 size={12} />
                </button>
              </>
            )}
            {deleting && <Loader2 size={12} className="animate-spin" style={{ color: 'var(--text-3)' }} />}
          </div>
        </div>

        {/* Status badge */}
        {status && (
          <div className="mb-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
              style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.dot }} />
              {status}
            </span>
          </div>
        )}

        {/* Short status */}
        {short && (
          <p className="text-[13px] font-semibold leading-snug mb-2" style={{ color: 'var(--text-1)' }}>{short}</p>
        )}

        {/* Detail preview */}
        {hasDetail && (
          <div>
            {expanded ? (
              <p className="text-[12px] leading-relaxed whitespace-pre-wrap pt-2"
                style={{ color: 'var(--text-2)', borderTop: '1px solid var(--border)' }}>
                {detail}
              </p>
            ) : (
              <p className="text-[12px] leading-snug"
                style={{ color: 'var(--text-3)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {detail}
              </p>
            )}
            <button
              onClick={e => { e.stopPropagation(); onToggle() }}
              className="mt-1 text-[11px] font-semibold flex items-center gap-0.5"
              style={{ color: 'var(--accent)' }}>
              {expanded ? <><ChevronUp size={10} /> Show less</> : <><ChevronDown size={10} /> Show more</>}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// List View Row
// ─────────────────────────────────────────────────────────────────────────────
function ListViewRow({ record, idx, isEditor, onEdit, onDelete, onDetail, onInvoice, selected, onSelect, columns, deleting, compact = false, showClientAccents = true, layout }) {
  const f = record.fields || {}
  const client   = f['Client']  || '?'
  const project  = f['Project'] || '?'
  const status   = f['Status']  || ''
  const short    = f['Short Status'] || ''
  const detail   = f['Current Status (Detailed)'] || ''
  const modified = f['lastModifiedTime'] || ''
  const clrHex   = clientColor(client)
  const sc       = statusStyle(status)
  const sel      = selected

  return (
    <div className={`grid gap-3 px-4 transition-colors group ${compact ? 'py-2.5' : 'py-3'}`}
      style={{
        gridTemplateColumns: layout.gridTemplateColumns,
        minWidth: layout.minWidth,
        alignItems: 'center',
        background: sel ? hexToRgba(clrHex, 0.05) : (idx % 2 === 0 ? 'var(--card-bg)' : 'var(--bg-input)'),
        borderBottom: '1px solid var(--border)',
        borderLeft: showClientAccents && sel ? `3px solid ${clrHex}` : '3px solid transparent',
      }}>

      {/* Checkbox */}
      {isEditor ? (
        <button onClick={() => onSelect(record.id)}
          className="w-4 h-4 rounded flex items-center justify-center transition-all"
          style={{ background: sel ? clrHex : 'transparent', border: `1.5px solid ${sel ? clrHex : 'var(--border)'}` }}>
          {sel && <Check size={9} color="#fff" strokeWidth={3} />}
        </button>
      ) : <span className="w-4" />}

      {/* Dynamic columns */}
      {columns.includes('Client') && (
        <div className="min-w-0">
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold truncate"
            style={{ color: showClientAccents ? clrHex : 'var(--text-2)', background: showClientAccents ? hexToRgba(clrHex, 0.08) : 'var(--bg-input)', border: `1px solid ${showClientAccents ? hexToRgba(clrHex, 0.18) : 'var(--border)'}` }}>
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: clrHex }} />
            <span className="truncate">{client}</span>
          </span>
        </div>
      )}
      {columns.includes('Project') && (
        <div className="min-w-0">
          <span className="text-[13px] font-semibold block truncate" style={{ color: 'var(--text-1)' }}>
            {project}
          </span>
        </div>
      )}
      {columns.includes('Status') && (
        <div className="min-w-0">
          {status && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
              style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.dot }} />
              {status}
            </span>
          )}
        </div>
      )}
      {columns.includes('Short Status') && (
        <div className="min-w-0">
          <span className="text-[12px] block truncate" style={{ color: 'var(--text-2)' }}>
            {short || '—'}
          </span>
        </div>
      )}
      {columns.includes('Detailed Status') && (
        <div className="min-w-0">
          <span className="text-[11px] block leading-relaxed"
            style={{ color: 'var(--text-3)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {detail || '—'}
          </span>
        </div>
      )}
      {columns.includes('Last Modified') && (
        <div className="min-w-0">
          <span className="text-[11px] block tabular-nums" style={{ color: 'var(--text-3)' }}>
            {fmtShortDate(modified) || '—'}
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-0.5 flex-shrink-0 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
        {isEditor && (
          <button onClick={() => onInvoice?.(record)} className="btn-icon p-1" style={{ color: 'var(--accent)' }} title="Link invoice">
            <Receipt size={12} />
          </button>
        )}
        <button onClick={() => onDetail(record)} className="btn-icon p-1" style={{ color: 'var(--text-3)' }} title="View">
          <Eye size={12} />
        </button>
        {isEditor && !deleting && (
          <>
            <button onClick={onEdit} className="btn-icon p-1" style={{ color: 'var(--text-3)' }} title="Edit">
              <Pencil size={12} />
            </button>
            <button onClick={onDelete} className="btn-icon p-1"
              style={{ color: 'rgba(239,68,68,0.5)' }}
              onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(239,68,68,0.5)'}
              title="Delete">
              <Trash2 size={12} />
            </button>
          </>
        )}
        {deleting && <Loader2 size={11} className="animate-spin" style={{ color: 'var(--text-3)' }} />}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Kanban Board — drag-and-drop
// ─────────────────────────────────────────────────────────────────────────────
function KanbanCard({ record, isEditor, onEdit, onDetail, onInvoice, selected, onSelect, updating, onDragStart, onDragEnd, isDragging, compact = false, showClientAccents = true, dragDisabled = false }) {
  const f = record.fields || {}
  const client  = f['Client']  || '?'
  const project = f['Project'] || '?'
  const short   = f['Short Status'] || ''
  const clrHex  = clientColor(client)
  const sel     = selected

  return (
    <div
      className="rounded-xl p-3 transition-all select-none"
      style={{
        background: sel ? hexToRgba(clrHex, 0.08) : 'var(--card-bg)',
        border: sel ? `1.5px solid ${clrHex}` : '1px solid var(--border)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        opacity: updating ? 0.6 : isDragging ? 0.45 : 1,
      }}
    >
      <div className="flex items-start justify-between gap-1 mb-1.5">
        <div className="min-w-0 flex-1">
          <span className="text-[10px] font-bold" style={{ color: showClientAccents ? clrHex : 'var(--text-2)' }}>{client}</span>
          <p className="text-xs font-semibold leading-snug" style={{ color: 'var(--text-1)' }}>{project}</p>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {isEditor && (
            <div
              draggable={!updating && !dragDisabled}
              onDragStart={e => {
                if (dragDisabled) return
                e.dataTransfer.setData('text/plain', record.id)
                e.dataTransfer.effectAllowed = 'move'
                onDragStart?.(record.id)
              }}
              onDragEnd={() => onDragEnd?.()}
              className="btn-icon p-0.5"
              style={{ color: 'var(--text-3)', cursor: updating || dragDisabled ? 'not-allowed' : 'grab', opacity: dragDisabled ? 0.45 : 1 }}
              title={dragDisabled ? 'Switch board grouping back to Status to drag cards' : 'Drag to move'}
            >
              <GripVertical size={11} />
            </div>
          )}
          {isEditor && (
            <button onClick={e => { e.stopPropagation(); onSelect(record.id) }}
              className="w-4 h-4 rounded flex items-center justify-center transition-all"
              style={{ background: sel ? clrHex : 'transparent', border: `1.5px solid ${sel ? clrHex : 'var(--border)'}` }}>
              {sel && <Check size={8} color="#fff" strokeWidth={3} />}
            </button>
          )}
          {isEditor && (
            <button onClick={e => { e.stopPropagation(); onInvoice?.(record) }}
              className="btn-icon p-0.5" style={{ color: 'var(--accent)' }} title="Link invoice">
              <Receipt size={11} />
            </button>
          )}
          <button onClick={e => { e.stopPropagation(); onDetail(record) }} className="btn-icon p-0.5" style={{ color: 'var(--text-3)' }}>
            <Eye size={11} />
          </button>
          {isEditor && (
            <button onClick={e => { e.stopPropagation(); onEdit() }} className="btn-icon p-0.5" style={{ color: 'var(--text-3)' }}>
              <Pencil size={11} />
            </button>
          )}
        </div>
      </div>
      {short && (
        <p className={`leading-snug ${compact ? 'text-[10px]' : 'text-[11px]'}`} style={{ color: 'var(--text-2)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {short}
        </p>
      )}
      {updating && (
        <div className="flex items-center gap-1 mt-1.5">
          <Loader2 size={10} className="animate-spin" style={{ color: 'var(--text-3)' }} />
          <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>Updating…</span>
        </div>
      )}
    </div>
  )
}

function KanbanColumn({ statusKey, statusLabel, records, isEditor, onEdit, onDetail, onInvoice, selectedIds, onSelect, onDrop, updatingIds, onDragStart, onDragEnd, draggedId, compact = false, showClientAccents = true, draggable = true }) {
  const [dragOver, setDragOver] = useState(false)
  const sc = draggable ? statusStyle(statusLabel) : { color: '#475569', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.24)', dot: '#94a3b8' }

  function handleDragOver(e) {
    if (!draggable || !isEditor) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(true)
  }

  return (
    <div
      className="flex flex-col min-w-[240px] sm:min-w-[260px] flex-1 rounded-2xl transition-all"
      style={{
        background: dragOver ? sc.bg : 'var(--bg-input)',
        border: dragOver ? `2px dashed ${sc.border}` : '1px solid var(--border)',
        boxShadow: dragOver ? `0 0 16px ${sc.bg}` : 'none',
      }}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { setDragOver(false); if (draggable && isEditor) onDrop(statusKey, e) }}
    >
      {/* Column header */}
      <div className="flex items-center justify-between px-3 py-2.5 rounded-t-2xl"
        style={{ borderBottom: `1.5px solid ${sc.border}`, background: sc.bg }}>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: sc.dot }} />
          <span className="text-xs font-bold" style={{ color: sc.color }}>{statusLabel}</span>
        </div>
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
          style={{ background: sc.color, color: '#fff' }}>{records.length}</span>
      </div>

      {/* Cards */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 340px)', minHeight: 80 }}>
        {records.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-2 opacity-50">
            <div className="w-8 h-8 rounded-xl border-2 border-dashed flex items-center justify-center"
              style={{ borderColor: sc.border }}>
              <Plus size={14} style={{ color: sc.color }} />
            </div>
            <p className="text-[10px] font-medium" style={{ color: 'var(--text-3)' }}>{draggable ? 'Drop here' : 'No records'}</p>
          </div>
        )}
        {records.map(r => (
          <KanbanCard
            key={r.id}
            record={r}
            isEditor={isEditor}
            onEdit={() => onEdit(r)}
            onDetail={onDetail}
            onInvoice={onInvoice}
            selected={selectedIds.has(r.id)}
            onSelect={onSelect}
            updating={updatingIds.has(r.id)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            isDragging={draggedId === r.id}
            compact={compact}
            showClientAccents={showClientAccents}
            dragDisabled={!draggable}
          />
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Status Modal — create/edit
// ─────────────────────────────────────────────────────────────────────────────
function StatusModal({ initial, onClose, onSave, saving, allRecords, statusOptions, onAddStatusOption }) {
  const isEdit = !!initial
  const [form, setForm] = useState({
    client:                  initial?.fields?.['Client'] || '',
    project:                 initial?.fields?.['Project'] || '',
    status:                  initial?.fields?.['Status'] || '',
    short_status:            initial?.fields?.['Short Status'] || '',
    current_status_detailed: initial?.fields?.['Current Status (Detailed)'] || '',
  })
  const [newStatusOption, setNewStatusOption] = useState('')
  const [addingStatusOption, setAddingStatusOption] = useState(false)
  const allClients  = [...new Set(allRecords.map(r => r.fields?.['Client']).filter(Boolean))].sort()
  const allProjects = [...new Set(allRecords.map(r => r.fields?.['Project']).filter(Boolean))].sort()
  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }
  async function addStatusOptionInline() {
    const trimmed = newStatusOption.trim()
    if (!trimmed || !onAddStatusOption) return
    setAddingStatusOption(true)
    try {
      await onAddStatusOption(trimmed)
      set('status', trimmed)
      setNewStatusOption('')
    } finally {
      setAddingStatusOption(false)
    }
  }
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', maxHeight: '92vh', overflow: 'auto' }}>

        <div className="flex items-center justify-between px-5 pt-5 pb-3 sticky top-0 z-10"
          style={{ background: 'var(--card-bg)', borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>
            {isEdit ? 'Edit Status Update' : 'New Status Update'}
          </h2>
          <button onClick={onClose} className="btn-icon p-1.5" style={{ color: 'var(--text-3)' }}><X size={16} /></button>
        </div>

        <form onSubmit={e => { e.preventDefault(); if (form.client && form.project) onSave(form) }}
          className="px-5 py-4 space-y-4">

          {/* Client + Project */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
                Client <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input list="cl-list" className="input-field w-full text-sm" placeholder="Type or select…"
                value={form.client} onChange={e => set('client', e.target.value)} required />
              <datalist id="cl-list">{allClients.map(c => <option key={c} value={c} />)}</datalist>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
                Project <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input list="pr-list" className="input-field w-full text-sm" placeholder="Type or select…"
                value={form.project} onChange={e => set('project', e.target.value)} required />
              <datalist id="pr-list">{allProjects.map(p => <option key={p} value={p} />)}</datalist>
            </div>
          </div>

          {/* Status selector */}
          <div>
            <div className="flex items-center justify-between gap-3 mb-2">
              <label className="block text-xs font-semibold" style={{ color: 'var(--text-2)' }}>Status</label>
              {onAddStatusOption && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    className="input-field text-xs py-1 px-2"
                    style={{ width: 140 }}
                    placeholder="Add status option"
                    value={newStatusOption}
                    onChange={e => setNewStatusOption(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addStatusOptionInline() } }}
                  />
                  <button type="button" onClick={addStatusOptionInline} disabled={addingStatusOption || !newStatusOption.trim()}
                    className="btn-ghost text-xs px-2 py-1 flex items-center gap-1">
                    {addingStatusOption ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                    Add
                  </button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
              {statusOptions.map(opt => {
                const sc = statusStyle(opt)
                const active = form.status === opt
                return (
                  <button key={opt} type="button"
                    onClick={() => set('status', active ? '' : opt)}
                    className="py-2 px-1 rounded-xl text-[11px] font-semibold text-center transition-all leading-tight"
                    style={{
                      background: active ? sc.bg : 'var(--bg-input)',
                      color:      active ? sc.color : 'var(--text-3)',
                      border:     `1.5px solid ${active ? sc.border : 'var(--border)'}`,
                      boxShadow:  active ? `0 0 0 2px ${sc.bg}` : 'none',
                    }}>
                    <span className="flex items-center justify-center gap-0.5">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: active ? sc.dot : 'var(--text-3)' }} />
                    </span>
                    {opt}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Short status */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
              Headline <span className="font-normal" style={{ color: 'var(--text-3)' }}>· one-line summary</span>
            </label>
            <input type="text" className="input-field w-full text-sm"
              placeholder="e.g. UAT in progress — awaiting client sign-off"
              value={form.short_status} onChange={e => set('short_status', e.target.value)} maxLength={300} />
          </div>

          {/* Detailed status */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
              Full Detail <span className="font-normal" style={{ color: 'var(--text-3)' }}>· blockers, next steps, notes</span>
            </label>
            <textarea className="input-field w-full text-sm resize-none" rows={5}
              placeholder="Full narrative — blockers, dependencies, billing notes…"
              value={form.current_status_detailed}
              onChange={e => set('current_status_detailed', e.target.value)} />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" className="btn-ghost text-sm px-4 py-2" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary flex items-center gap-2 text-sm px-4 py-2"
              disabled={saving || !form.client || !form.project}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {isEdit ? 'Save Changes' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Update Modal
// ─────────────────────────────────────────────────────────────────────────────
function AIUpdateModal({ selectedRecords, onClose, onShare }) {
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState(null)
  const [error,   setError]   = useState(null)
  const [context, setContext] = useState('')
  const [copied,  setCopied]  = useState(false)

  async function generate() {
    setLoading(true); setError(null); setResult(null)
    try {
      const res = await api.status.aiUpdate(selectedRecords.map(r => r.id), context)
      setResult(res)
    } catch (e) { setError(e.message || 'AI generation failed') }
    finally { setLoading(false) }
  }
  function copyText() {
    navigator.clipboard.writeText(result?.text || '')
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(15,23,42,0.7)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', maxHeight: '88vh' }}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)' }}>
              <Sparkles size={15} style={{ color: '#8b5cf6' }} />
            </div>
            <div>
              <h2 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>AI Status Update</h2>
              <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{selectedRecords.length} project{selectedRecords.length !== 1 ? 's' : ''} selected</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-icon p-1.5" style={{ color: 'var(--text-3)' }}><X size={16} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {selectedRecords.map(r => {
              const f = r.fields || {}
              const sc = statusStyle(f['Status'] || '')
              return (
                <span key={r.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium"
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                  {f['Status'] && <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.dot }} />}
                  <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{f['Client']}</span>
                  <span style={{ color: 'var(--text-3)' }}>·</span>
                  {f['Project']}
                </span>
              )
            })}
          </div>
          {!result && (
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
                Additional context <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(optional)</span>
              </label>
              <textarea className="input-field w-full text-sm resize-none" rows={2}
                placeholder="e.g. Focus on billing, ignore items not yet started…"
                value={context} onChange={e => setContext(e.target.value)} />
            </div>
          )}
          {!result && !loading && (
            <button onClick={generate} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm"
              style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)', color: '#fff', boxShadow: '0 2px 8px rgba(99,102,241,0.35)' }}>
              <Sparkles size={14} /> Generate Status Update
            </button>
          )}
          {loading && (
            <div className="flex flex-col items-center py-12 gap-3">
              <div className="flex gap-1.5">
                {[0,1,2].map(i => <span key={i} className="w-2 h-2 rounded-full animate-bounce" style={{ background: '#8b5cf6', animationDelay: `${i*0.15}s` }} />)}
              </div>
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>Generating…</p>
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-xl" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)' }}>
              <AlertCircle size={14} style={{ color: '#ef4444', marginTop: 1 }} />
              <div>
                <p className="text-sm font-medium" style={{ color: '#ef4444' }}>Generation failed</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{error}</p>
                <button onClick={generate} className="text-xs font-semibold mt-2" style={{ color: '#ef4444' }}>Retry</button>
              </div>
            </div>
          )}
          {result && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>via {result.model || 'AI'}</p>
                <div className="flex gap-1.5">
                  <button onClick={generate} className="btn-ghost text-xs px-2 py-1 flex items-center gap-1"><RefreshCw size={10} /> Redo</button>
                  <button onClick={copyText} className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg"
                    style={{ background: copied ? 'rgba(16,185,129,0.12)' : 'var(--bg-input)', color: copied ? '#10b981' : 'var(--text-2)', border: '1px solid var(--border)' }}>
                    {copied ? <CheckCheck size={11} /> : <Copy size={11} />} {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
              <div className="rounded-xl p-4 text-[13px] leading-relaxed whitespace-pre-wrap"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-1)', maxHeight: '40vh', overflow: 'auto' }}>
                {result.text}
              </div>
            </div>
          )}
        </div>

        {result && (
          <div className="flex items-center justify-between gap-2 px-5 py-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
            <button onClick={onClose} className="btn-ghost text-sm px-4 py-2">Done</button>
            <button onClick={() => { onClose(); onShare() }} className="btn-primary flex items-center gap-2 text-sm px-4 py-2">
              <Share2 size={13} /> Share These Projects
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Share Modal
// ─────────────────────────────────────────────────────────────────────────────
function ShareModal({ selectedRecords, viewConfig = null, title: defaultTitle = '', isViewShare = false, onClose }) {
  const [step,      setStep]      = useState('form')
  const [title,     setTitle]     = useState(defaultTitle)
  const [expiry,    setExpiry]    = useState(0)
  const [accessMode, setAccessMode] = useState('read')
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState(null)
  const [shareData, setShareData] = useState(null)
  const [copied,    setCopied]    = useState(false)
  const shareUrl = shareData ? `${window.location.origin}/view/${shareData.token}` : ''

  async function createShare() {
    setSaving(true); setError(null)
    try {
      if (selectedRecords.length === 0) {
        throw new Error('No records selected to share.')
      }
      if (selectedRecords.length > MAX_SHARED_VIEW_RECORDS) {
        throw new Error(`Public sharing is limited to ${MAX_SHARED_VIEW_RECORDS} records. Narrow the current view first.`)
      }
      const payload = {
        title: title.trim() || null,
        record_ids: selectedRecords.map(r => r.id),
        expires_hours: expiry || null,
        access_mode: isViewShare ? 'read' : accessMode,  // view shares are always read-only
        resource_type: 'status',
      }
      if (viewConfig) {
        // Strip advancedConditions — they're internal-only and not supported by the public viewer
        const { advancedConditions: _stripped, ...safeConfig } = viewConfig
        payload.view_config = safeConfig
      }
      const data = await api.sharedViews.create(payload)
      setShareData(data); setStep('created')
    } catch (e) { setError(e.message || 'Failed to create share link') }
    finally { setSaving(false) }
  }
  function copyUrl() { navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 2500) }
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(15,23,42,0.7)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.25)' }}>
              <Share2 size={15} style={{ color: '#0ea5e9' }} />
            </div>
            <div>
              <h2 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{step === 'form' ? (isViewShare ? 'Share Current View' : 'Share with Manager') : 'Link Ready!'}</h2>
              <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{selectedRecords.length} project{selectedRecords.length !== 1 ? 's' : ''} · no login needed</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-icon p-1.5" style={{ color: 'var(--text-3)' }}><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {step === 'form' && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {selectedRecords.slice(0, 8).map(r => (
                  <span key={r.id} className="text-[11px] px-2 py-0.5 rounded-lg font-medium"
                    style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                    {r.fields?.['Client']} · {r.fields?.['Project']}
                  </span>
                ))}
                {selectedRecords.length > 8 && <span className="text-[11px] px-2 py-0.5 rounded-lg" style={{ color: 'var(--text-3)' }}>+{selectedRecords.length - 8} more</span>}
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>Link title</label>
                <input type="text" className="input-field w-full text-sm" placeholder="e.g. May 2026 Status Update"
                  value={title} onChange={e => setTitle(e.target.value)} maxLength={200} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-2)' }}>Expires</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {EXPIRY_OPTS.map(opt => (
                    <button key={opt.value} onClick={() => setExpiry(opt.value)}
                      className="py-1.5 rounded-xl text-xs font-semibold transition-all"
                      style={{ background: expiry === opt.value ? 'var(--accent)' : 'var(--bg-input)', color: expiry === opt.value ? '#fff' : 'var(--text-2)', border: `1px solid ${expiry === opt.value ? 'var(--accent)' : 'var(--border)'}` }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {!isViewShare && (
                <div>
                  <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-2)' }}>Access</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { id: 'read', label: 'Read only', hint: 'Recipients can view, filter, and switch layouts.' },
                      { id: 'edit', label: 'Can edit', hint: 'Recipients can update status, headline, and details.' },
                    ].map(opt => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setAccessMode(opt.id)}
                        className="rounded-xl px-3 py-2 text-left transition-all"
                        style={{
                          background: accessMode === opt.id ? 'var(--accent-dim)' : 'var(--bg-input)',
                          border: `1px solid ${accessMode === opt.id ? 'var(--accent-soft)' : 'var(--border)'}`,
                        }}
                      >
                        <p className="text-xs font-semibold" style={{ color: accessMode === opt.id ? 'var(--accent)' : 'var(--text-2)' }}>{opt.label}</p>
                        <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>{opt.hint}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {error && <p className="text-xs p-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>{error}</p>}
              <div className="flex items-start gap-2 p-3 rounded-xl" style={{ background: 'rgba(14,165,233,0.06)', border: '1px solid rgba(14,165,233,0.15)' }}>
                <Shield size={13} style={{ color: '#0ea5e9', marginTop: 1, flexShrink: 0 }} />
                <p className="text-[11px]" style={{ color: 'var(--text-2)' }}>
                  {isViewShare
                    ? `This creates a public snapshot of the ${selectedRecords.length} records currently visible here. IP, location, device and browser are tracked on every open.`
                    : 'IP, location, device & browser tracked on every open. Disable or delete anytime.'}
                </p>
              </div>
              {isViewShare && (
                <div className="space-y-1">
                  <p className="text-[11px]" style={{ color: selectedRecords.length > MAX_SHARED_VIEW_RECORDS ? '#ef4444' : 'var(--text-3)' }}>
                    Public shares support up to {MAX_SHARED_VIEW_RECORDS} records per link.
                  </p>
                  <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                    Current layout, theme, density, and dashboard preferences will travel with this link.
                  </p>
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <button onClick={onClose} className="btn-ghost text-sm px-4 py-2">Cancel</button>
                <button onClick={createShare} disabled={saving || selectedRecords.length > MAX_SHARED_VIEW_RECORDS || selectedRecords.length === 0} className="btn-primary flex items-center gap-2 text-sm px-4 py-2">
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />} Generate Link
                </button>
              </div>
            </>
          )}
          {step === 'created' && shareData && (
            <>
              <div className="flex flex-col items-center py-2 gap-3">
                <div className="w-14 h-14 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(16,185,129,0.12)', border: '2px solid rgba(16,185,129,0.3)' }}>
                  <CheckCheck size={24} style={{ color: '#10b981' }} />
                </div>
                <div className="text-center">
                  <p className="font-bold text-base" style={{ color: 'var(--text-1)' }}>Link ready!</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Share this URL — no login required.</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-xl" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                <Link2 size={13} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                <p className="text-xs font-mono flex-1 truncate" style={{ color: 'var(--text-1)' }}>{shareUrl}</p>
                <button onClick={copyUrl} className="flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg"
                  style={{ background: copied ? 'rgba(16,185,129,0.12)' : 'var(--card-bg)', color: copied ? '#10b981' : 'var(--accent)', border: '1px solid var(--border)' }}>
                  {copied ? <CheckCheck size={11} /> : <Copy size={11} />} {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              {shareData.expires_at && (
                <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
                  <Clock size={11} /> Expires {fmtDate(shareData.expires_at)}
                </p>
              )}
              <div className="flex items-center justify-between gap-2 pt-1">
                <a href={shareUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--accent)' }}>
                  <ExternalLink size={11} /> Preview
                </a>
                <button onClick={onClose} className="btn-primary text-sm px-4 py-2">Done</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Manage Shares Modal
// ─────────────────────────────────────────────────────────────────────────────
function ManageSharesModal({ onClose }) {
  const { showToast } = useToast()
  const [views,    setViews]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState(null)
  const [accesses, setAccesses] = useState([])
  const [loadingAcc, setLoadingAcc] = useState(false)
  const [updatingTokens, setUpdatingTokens] = useState(() => new Set())
  const [confirmDelete, setConfirmDelete] = useState(null) // token to confirm delete
  useEffect(() => { loadViews() }, [])
  async function loadViews() { setLoading(true); try { const r = await api.sharedViews.list('status'); setViews(r.views || []) } catch {} finally { setLoading(false) } }
  async function toggleActive(view) {
    const next = !view.is_active
    setViews(vs => vs.map(v => v.token === view.token ? { ...v, is_active: next } : v))
    try { await api.sharedViews.update(view.token, { is_active: next }); showToast(next ? 'Link enabled' : 'Link disabled', 'success') }
    catch (e) { setViews(vs => vs.map(v => v.token === view.token ? { ...v, is_active: view.is_active } : v)); showToast(e.message || 'Failed', 'error') }
  }
  async function setAccessMode(view, next) {
    if (!view || view.access_mode === next || updatingTokens.has(view.token)) return
    const prev = view.access_mode
    setUpdatingTokens(tokens => new Set(tokens).add(view.token))
    setViews(vs => vs.map(v => v.token === view.token ? { ...v, access_mode: next } : v))
    try {
      const updated = await api.sharedViews.update(view.token, { access_mode: next })
      setViews(vs => vs.map(v => v.token === view.token ? { ...v, ...(updated || {}), access_mode: updated?.access_mode || next } : v))
      showToast(next === 'edit' ? 'Link can now edit' : 'Link set to read only', 'success')
    } catch (e) {
      setViews(vs => vs.map(v => v.token === view.token ? { ...v, access_mode: prev } : v))
      showToast(e.message || 'Failed', 'error')
    } finally {
      setUpdatingTokens(tokens => {
        const nextTokens = new Set(tokens)
        nextTokens.delete(view.token)
        return nextTokens
      })
    }
  }
  async function deleteView(token) {
    const prev = views; setViews(vs => vs.filter(v => v.token !== token))
    if (selected === token) setSelected(null)
    try { await api.sharedViews.delete(token); showToast('Deleted', 'success') }
    catch (e) { setViews(prev); showToast(e.message || 'Failed', 'error') }
  }
  async function viewAccesses(token) {
    if (selected === token) { setSelected(null); return }
    setSelected(token); setLoadingAcc(true)
    try { const r = await api.sharedViews.accesses(token); setAccesses(r.accesses || []) } catch {} finally { setLoadingAcc(false) }
  }
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(15,23,42,0.7)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', maxHeight: '88vh' }}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.25)' }}>
              <Link2 size={15} style={{ color: '#0ea5e9' }} />
            </div>
            <h2 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Manage Share Links</h2>
          </div>
          <button onClick={onClose} className="btn-icon p-1.5" style={{ color: 'var(--text-3)' }}><X size={16} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-2">
          {loading && <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--text-3)' }} /></div>}
          {!loading && views.length === 0 && <div className="text-center py-10 text-sm" style={{ color: 'var(--text-3)' }}>No share links yet.</div>}
          {views.map(v => {
            const expired  = isExpired(v.expires_at)
            const inactive = !v.is_active
            const updatingMode = updatingTokens.has(v.token)
            const url = `${window.location.origin}/view/${v.token}`
            return (
              <div key={v.token}>
                <div className="rounded-xl p-3 transition-all"
                  style={{ background: (expired || inactive) ? 'var(--bg-input)' : 'var(--card-bg)', border: '1px solid var(--border)', opacity: (expired || inactive) ? 0.7 : 1 }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                          {v.title || `${Array.isArray(v.record_ids) ? v.record_ids.length : '?'} projects`}
                        </p>
                        {inactive && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>DISABLED</span>}
                        {expired  && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>EXPIRED</span>}
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: v.access_mode === 'edit' ? 'rgba(59,130,246,0.1)' : 'rgba(148,163,184,0.12)', color: v.access_mode === 'edit' ? '#2563eb' : 'var(--text-3)' }}>
                          {v.access_mode === 'edit' ? 'CAN EDIT' : 'READ ONLY'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        <span className="text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>…/{v.token}</span>
                        <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>Created {fmtDate(v.created_at)}</span>
                        {v.expires_at && <span className="text-[11px] flex items-center gap-0.5" style={{ color: expired ? '#f59e0b' : 'var(--text-3)' }}><Clock size={9} /> {expired ? 'Expired' : 'Expires'} {fmtDate(v.expires_at)}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--text-2)' }}><Eye size={11} /> {v.access_count}</span>
                      <a href={url} target="_blank" rel="noopener noreferrer" className="btn-icon p-1.5" style={{ color: 'var(--text-3)' }}><ExternalLink size={12} /></a>
                      <button onClick={() => toggleActive(v)} className="btn-icon p-1.5" style={{ color: v.is_active ? '#10b981' : 'var(--text-3)' }} title={v.is_active ? 'Disable' : 'Enable'}>
                        {v.is_active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                      </button>
                      <div className="flex items-center rounded-lg p-0.5"
                        style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                        <button
                          onClick={() => setAccessMode(v, 'read')}
                          disabled={updatingMode}
                          className="px-2 py-1 rounded-md text-[10px] font-semibold transition"
                          style={{
                            color: v.access_mode === 'read' ? '#1f2937' : 'var(--text-3)',
                            background: v.access_mode === 'read' ? 'var(--card-bg)' : 'transparent',
                            opacity: updatingMode ? 0.72 : 1,
                          }}
                          title="Read only"
                        >
                          View
                        </button>
                        <button
                          onClick={() => setAccessMode(v, 'edit')}
                          disabled={updatingMode}
                          className="px-2 py-1 rounded-md text-[10px] font-semibold transition flex items-center gap-1"
                          style={{
                            color: v.access_mode === 'edit' ? '#2563eb' : 'var(--text-3)',
                            background: v.access_mode === 'edit' ? 'rgba(59,130,246,0.12)' : 'transparent',
                            opacity: updatingMode ? 0.72 : 1,
                          }}
                          title="Can edit"
                        >
                          Edit
                          {updatingMode && <Loader2 size={9} className="animate-spin" />}
                        </button>
                      </div>
                      <button onClick={() => viewAccesses(v.token)} className="btn-icon p-1.5" style={{ color: selected === v.token ? 'var(--accent)' : 'var(--text-3)' }}><MapPin size={12} /></button>
                      <button onClick={() => setConfirmDelete(v.token)} className="btn-icon p-1.5" style={{ color: 'rgba(239,68,68,0.6)' }}
                        onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                        onMouseLeave={e => e.currentTarget.style.color = 'rgba(239,68,68,0.6)'}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
                {selected === v.token && (
                  <div className="ml-3 mt-1 rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)', background: 'var(--bg-input)' }}>
                    <div className="px-3 py-2 text-xs font-bold" style={{ color: 'var(--text-2)', borderBottom: '1px solid var(--border)' }}>
                      Access Log — {accesses.length} entries
                    </div>
                    {loadingAcc ? <div className="flex justify-center py-6"><Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-3)' }} /></div>
                    : accesses.length === 0 ? <p className="text-xs text-center py-4" style={{ color: 'var(--text-3)' }}>No accesses yet</p>
                    : (
                      <div className="max-h-48 overflow-y-auto divide-y" style={{ borderColor: 'var(--border)' }}>
                        {accesses.map((a, i) => (
                          <div key={i} className="px-3 py-2 flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[11px] font-mono" style={{ color: 'var(--text-1)' }}>{a.ip || '?'}</span>
                                {(a.city || a.region || a.country) && (
                                  <span className="text-[11px]" style={{ color: 'var(--text-2)' }}>
                                    {[a.city, a.region, a.country].filter(Boolean).join(', ')}
                                  </span>
                                )}
                                {a.geo_source && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                                    style={{ background: a.geo_source === 'browser' ? 'rgba(16,185,129,0.08)' : 'rgba(148,163,184,0.1)', color: a.geo_source === 'browser' ? '#059669' : 'var(--text-3)' }}>
                                    {a.geo_source === 'browser' ? 'GPS' : 'IP Geo'}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                {a.device_label && <span className="text-[10px] font-medium" style={{ color: 'var(--text-2)' }}>{a.device_label}</span>}
                                {a.os && <span className="text-[10px] flex items-center gap-0.5" style={{ color: 'var(--text-3)' }}><Monitor size={8} /> {a.os}</span>}
                                {a.browser && <span className="text-[10px] flex items-center gap-0.5" style={{ color: 'var(--text-3)' }}><Globe size={8} /> {a.browser}</span>}
                                {a.device_type && <span className="text-[10px] flex items-center gap-0.5" style={{ color: 'var(--text-3)' }}><Smartphone size={8} /> {a.device_type}</span>}
                                {a.device_model && <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{a.device_model}</span>}
                                {a.timezone && <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{a.timezone}</span>}
                                {a.isp && <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{a.isp}</span>}
                                {typeof a.lat === 'number' && typeof a.lon === 'number' && (
                                  <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                                    {a.lat.toFixed(4)}, {a.lon.toFixed(4)}
                                  </span>
                                )}
                              </div>
                            </div>
                            <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--text-3)' }}>{fmtDate(a.accessed_at)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {confirmDelete && (
        <ConfirmModal
          message="Delete this share link? Anyone with the URL will immediately lose access."
          confirmLabel="Delete link"
          onConfirm={() => deleteView(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Saved Views Menu
// ─────────────────────────────────────────────────────────────────────────────
function SavedViewsMenu({ currentConfig, onLoad, onClose }) {
  const [views, setViews] = useState(() => {
    try { return JSON.parse(localStorage.getItem('fintrack-status-views') || '[]') } catch { return [] }
  })
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  function saveCurrentView() {
    if (!name.trim()) return
    const v = { id: Date.now().toString(), name: name.trim(), config: currentConfig }
    const updated = [...views, v]
    setViews(updated)
    localStorage.setItem('fintrack-status-views', JSON.stringify(updated))
    setName(''); setSaving(false)
  }
  function deleteView(id) {
    const updated = views.filter(v => v.id !== id)
    setViews(updated)
    localStorage.setItem('fintrack-status-views', JSON.stringify(updated))
  }
  return (
    <div className="absolute right-0 top-full mt-1 z-30 w-72 rounded-2xl shadow-xl overflow-hidden"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
      <div className="px-4 py-3 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}>
        Saved Views
      </div>
      {views.length === 0 && (
        <p className="text-xs text-center py-4" style={{ color: 'var(--text-3)' }}>No saved views yet</p>
      )}
      {views.map(v => (
        <div key={v.id} className="flex items-center justify-between px-4 py-2.5 group hover:bg-opacity-50 transition-colors"
          style={{ borderBottom: '1px solid var(--border)' }}>
          <button onClick={() => { onLoad(v.config); onClose() }}
            className="text-sm font-medium text-left flex-1" style={{ color: 'var(--text-1)' }}>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase"
                style={{ background: 'var(--bg-input)', color: 'var(--text-3)' }}>
                {v.config?.type || 'card'}
              </span>
              {v.name}
            </div>
            {(v.config?.filterClient || v.config?.filterStatus) && (
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                {[v.config?.filterClient, v.config?.filterStatus].filter(Boolean).join(' · ')}
              </p>
            )}
          </button>
          <button onClick={() => deleteView(v.id)}
            className="btn-icon p-1 ml-2 flex-shrink-0 opacity-40 group-hover:opacity-100 transition-opacity"
            style={{ color: '#ef4444' }}
            title="Delete saved view">
            <Trash size={12} />
          </button>
        </div>
      ))}
      {/* Save current */}
      <div className="p-3 space-y-2">
        {saving ? (
          <div className="flex gap-2">
            <input autoFocus className="input-field flex-1 text-sm py-1.5" placeholder="View name…"
              value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveCurrentView(); if (e.key === 'Escape') setSaving(false) }} />
            <button onClick={saveCurrentView} disabled={!name.trim()} className="btn-primary text-xs px-3 py-1.5">Save</button>
            <button onClick={() => setSaving(false)} className="btn-ghost text-xs px-2 py-1.5"><X size={12} /></button>
          </div>
        ) : (
          <button onClick={() => setSaving(true)}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-xl transition-colors"
            style={{ background: 'var(--bg-input)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
            <BookmarkPlus size={12} /> Save current view
          </button>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Column Selector (for List view)
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Confirm Modal — replaces window.confirm everywhere
// ─────────────────────────────────────────────────────────────────────────────
function ConfirmModal({ message, confirmLabel = 'Delete', onConfirm, onClose }) {
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-5"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <Trash size={16} style={{ color: '#ef4444' }} />
          </div>
          <p className="text-sm leading-relaxed pt-1.5" style={{ color: 'var(--text-1)' }}>{message}</p>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="btn-ghost text-sm px-4 py-2">Cancel</button>
          <button
            onClick={() => { onConfirm(); onClose() }}
            className="text-sm px-4 py-2 rounded-xl font-semibold transition-all"
            style={{ background: '#ef4444', color: '#fff', border: '1px solid rgba(239,68,68,0.3)' }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function ColumnSelector({ columns, onChange, onClose }) {
  return (
    <div className="absolute right-0 top-full mt-1 z-30 w-56 rounded-2xl shadow-xl overflow-hidden"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
      <div className="px-4 py-3 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}>
        Visible Columns
      </div>
      {ALL_COLUMNS.map(col => {
        const active = columns.includes(col)
        const required = col === 'Client' || col === 'Project'
        return (
          <button key={col} onClick={() => { if (required) return; onChange(active ? columns.filter(c => c !== col) : [...columns, col]) }}
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors"
            style={{ color: 'var(--text-1)', borderBottom: '1px solid var(--border)', opacity: required ? 0.5 : 1, cursor: required ? 'default' : 'pointer' }}>
            {col}
            <div className="w-4 h-4 rounded flex items-center justify-center"
              style={{ background: active ? 'var(--accent)' : 'transparent', border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}` }}>
              {active && <Check size={10} color="#fff" strokeWidth={3} />}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function AppearancePanel({
  themeId,
  density,
  showDashboard,
  showClientAccents,
  statusOptions,
  canManageStatuses,
  onThemeChange,
  onDensityChange,
  onToggleDashboard,
  onToggleClientAccents,
  onAddStatusOption,
  onClose,
}) {
  const [newStatus, setNewStatus] = useState('')
  const [adding, setAdding] = useState(false)

  async function handleAddStatus() {
    const trimmed = newStatus.trim()
    if (!trimmed || !onAddStatusOption) return
    setAdding(true)
    try {
      await onAddStatusOption(trimmed)
      setNewStatus('')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="absolute right-0 top-full mt-1 z-30 w-[min(92vw,26rem)] rounded-2xl shadow-xl overflow-hidden"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid var(--border)' }}>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Customize Board</p>
          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Appearance, density, and status options</p>
        </div>
        <button onClick={onClose} className="btn-icon p-1.5" style={{ color: 'var(--text-3)' }}>
          <X size={14} />
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-2)' }}>Accent theme</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Object.values(THEME_PRESETS).map(theme => (
              <button
                key={theme.id}
                type="button"
                onClick={() => onThemeChange(theme.id)}
                className="rounded-xl px-3 py-2 text-left transition-all"
                style={{
                  background: themeId === theme.id ? theme.accentDim : 'var(--bg-input)',
                  border: `1px solid ${themeId === theme.id ? theme.accentSoft : 'var(--border)'}`,
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ background: theme.accent }} />
                  <span className="text-xs font-semibold" style={{ color: themeId === theme.id ? theme.accent : 'var(--text-2)' }}>{theme.label}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-2)' }}>Density</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: 'comfortable', label: 'Comfortable', hint: 'More whitespace and larger cards.' },
              { id: 'compact', label: 'Compact', hint: 'Denser cards and tighter list rows.' },
            ].map(opt => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onDensityChange(opt.id)}
                className="rounded-xl px-3 py-2 text-left transition-all"
                style={{
                  background: density === opt.id ? 'var(--accent-dim)' : 'var(--bg-input)',
                  border: `1px solid ${density === opt.id ? 'var(--accent-soft)' : 'var(--border)'}`,
                }}
              >
                <p className="text-xs font-semibold" style={{ color: density === opt.id ? 'var(--accent)' : 'var(--text-2)' }}>{opt.label}</p>
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>{opt.hint}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {[
            {
              key: 'dashboard',
              label: 'Show status dashboard',
              hint: 'Keep the top status strip visible for quick filtering.',
              active: showDashboard,
              toggle: onToggleDashboard,
            },
            {
              key: 'accents',
              label: 'Highlight client accents',
              hint: 'Show stronger client color bars and chips across cards.',
              active: showClientAccents,
              toggle: onToggleClientAccents,
            },
          ].map(item => (
            <button
              key={item.key}
              type="button"
              onClick={item.toggle}
              className="w-full flex items-start justify-between gap-3 rounded-xl px-3 py-3"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}
            >
              <div className="text-left">
                <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>{item.label}</p>
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>{item.hint}</p>
              </div>
              <span className="flex-shrink-0" style={{ color: item.active ? 'var(--accent)' : 'var(--text-3)' }}>
                {item.active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
              </span>
            </button>
          ))}
        </div>

        <div>
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>Status options</p>
            <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{statusOptions.length} total</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {statusOptions.map(opt => {
              const sc = statusStyle(opt)
              return (
                <span key={opt} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium"
                  style={{ background: sc.bg, border: `1px solid ${sc.border}`, color: sc.color }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.dot }} />
                  {opt}
                </span>
              )
            })}
          </div>
          {canManageStatuses && (
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                className="input-field flex-1 text-sm"
                placeholder="Add a new status option"
                value={newStatus}
                onChange={e => setNewStatus(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddStatus() } }}
              />
              <button onClick={handleAddStatus} disabled={adding || !newStatus.trim()}
                className="btn-primary text-sm px-3 py-2 flex items-center justify-center gap-1.5">
                {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                Add status
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────
export default function StatusBoard() {
  const { isEditor } = useAuth()
  const { showToast } = useToast()

  // ── Core data ──────────────────────────────────────────────────────────────
  const [records,     setRecords]     = useState([])
  const [statusPicklists, setStatusPicklists] = useState({})
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)

  // ── View config (persisted in URL) ────────────────────────────────────────
  const initConfig = getViewConfigFromUrl() || {
    type: 'card',
    filterClient: '',
    filterStatus: '',
    search: '',
    columns: DEFAULT_COLUMNS,
    boardGroupBy: 'Status',
    cardGroupBy: 'Client',
    cardGroupSort: 'count-desc',
    cardRecordSort: 'project-asc',
    advancedConditions: [],
    theme: 'cobalt',
    density: 'comfortable',
    showDashboard: true,
    showClientAccents: true,
  }
  const [viewType,      setViewType]      = useState(initConfig.type || 'card')
  const [filterClient,  setFilterClient]  = useState(initConfig.filterClient || '')
  const [filterStatus,  setFilterStatus]  = useState(initConfig.filterStatus || '')
  const [search,        setSearch]        = useState(initConfig.search || '')
  const [listColumns,   setListColumns]   = useState(initConfig.columns || DEFAULT_COLUMNS)
  const [boardGroupBy,  setBoardGroupBy]  = useState(initConfig.boardGroupBy || 'Status')
  const [cardGroupBy,   setCardGroupBy]   = useState(initConfig.cardGroupBy || 'Client')
  const [cardGroupSort, setCardGroupSort] = useState(initConfig.cardGroupSort || 'count-desc')
  const [cardRecordSort, setCardRecordSort] = useState(initConfig.cardRecordSort || 'project-asc')
  const [advancedConditions, setAdvancedConditions] = useState(initConfig.advancedConditions || [])
  const [themeId,       setThemeId]       = useState(initConfig.theme || 'cobalt')
  const [density,       setDensity]       = useState(initConfig.density || 'comfortable')
  const [showDashboard, setShowDashboard] = useState(initConfig.showDashboard !== false)
  const [showClientAccents, setShowClientAccents] = useState(initConfig.showClientAccents !== false)

  // ── UI state ──────────────────────────────────────────────────────────────
  const [expandedIds,   setExpandedIds]   = useState(new Set())
  const [selectedIds,   setSelectedIds]   = useState(new Set())
  const [modal,         setModal]         = useState(null)
  const [saving,        setSaving]        = useState(false)
  const [deletingId,    setDeletingId]    = useState(null)
  const [updatingIds,   setUpdatingIds]   = useState(new Set())  // kanban DnD in-flight
  const [detailRecord,      setDetailRecord]      = useState(null)
  const [detailOpenInvoice, setDetailOpenInvoice] = useState(false)
  const [aiModal,           setAiModal]           = useState(false)
  const [shareModal,    setShareModal]    = useState(false)
  const [manageModal,   setManageModal]   = useState(false)
  const [showViews,     setShowViews]     = useState(false)
  const [showCols,      setShowCols]      = useState(false)
  const [showSettings,  setShowSettings]  = useState(false)
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [shareViewModal, setShareViewModal] = useState(false)
  const [draggedId, setDraggedId] = useState('')
  const [pendingStatusById, setPendingStatusById] = useState({})
  const [confirmDialog, setConfirmDialog] = useState(null) // { message, onConfirm, confirmLabel? }

  const statusOptions = useMemo(() => {
    const dynamic = statusPicklists?.Status?.options || []
    const merged = [...new Set([...dynamic, ...STATUS_OPTIONS_FALLBACK])]
    return merged.length ? merged : STATUS_OPTIONS_FALLBACK
  }, [statusPicklists])
  const recordsForView = useMemo(
    () => records.map(r => {
      const pendingStatus = pendingStatusById[r.id]
      return pendingStatus ? { ...r, fields: { ...r.fields, Status: pendingStatus } } : r
    }),
    [records, pendingStatusById]
  )
  const listLayout = useMemo(() => getListLayout(listColumns, isEditor), [listColumns, isEditor])

  // ── Persist view config to URL on any change ──────────────────────────────
  useEffect(() => {
    const cfg = {
      type: viewType,
      filterClient,
      filterStatus,
      search,
      columns: listColumns,
      boardGroupBy,
      cardGroupBy,
      cardGroupSort,
      cardRecordSort,
      advancedConditions,
      theme: themeId,
      density,
      showDashboard,
      showClientAccents,
    }
    const encoded = encodeViewConfig(cfg)
    const url = new URL(window.location.href)
    url.searchParams.set('v', encoded)
    window.history.replaceState({}, '', url.toString())
  }, [viewType, filterClient, filterStatus, search, listColumns, boardGroupBy, cardGroupBy, cardGroupSort, cardRecordSort, advancedConditions, themeId, density, showDashboard, showClientAccents])

  // ── Load data ─────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [res, picklists] = await Promise.all([
        api.status.list(),
        api.status.picklists.get().catch(() => ({})),
      ])
      setRecords(res.records || [])
      setPendingStatusById({})
      setStatusPicklists(picklists || {})
    }
    catch (e) { setError(e.message || 'Failed to load') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  // ── Derived / filtered data ───────────────────────────────────────────────
  const baseFiltered = recordsForView.filter(r => {
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
  const filtered = useMemo(
    () => applyConditions(baseFiltered, advancedConditions, r => r.fields || {}),
    [baseFiltered, advancedConditions]
  )
  const cardGroups = useMemo(() => {
    const groups = new Map()
    for (const record of filtered) {
      const rawValue = record.fields?.[cardGroupBy]
      const key = rawValue || (cardGroupBy === 'Status' ? 'Not started' : 'Unknown')
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(record)
    }

    const sortRecords = (records) => {
      const items = [...records]
      items.sort((a, b) => {
        const af = a.fields || {}
        const bf = b.fields || {}
        switch (cardRecordSort) {
          case 'project-desc':
            return String(bf['Project'] || '').localeCompare(String(af['Project'] || ''))
          case 'modified-desc':
            return new Date(bf.lastModifiedTime || 0).getTime() - new Date(af.lastModifiedTime || 0).getTime()
          case 'modified-asc':
            return new Date(af.lastModifiedTime || 0).getTime() - new Date(bf.lastModifiedTime || 0).getTime()
          case 'status-asc':
            return String(af['Status'] || 'Not started').localeCompare(String(bf['Status'] || 'Not started'))
          case 'project-asc':
          default:
            return String(af['Project'] || '').localeCompare(String(bf['Project'] || ''))
        }
      })
      return items
    }

    const shaped = [...groups.entries()].map(([key, records]) => ({
      key,
      records: sortRecords(records),
      count: records.length,
    }))

    shaped.sort((a, b) => {
      switch (cardGroupSort) {
        case 'count-asc':
          return a.count - b.count || String(a.key).localeCompare(String(b.key))
        case 'name-desc':
          return String(b.key).localeCompare(String(a.key))
        case 'name-asc':
          return String(a.key).localeCompare(String(b.key))
        case 'count-desc':
        default:
          return b.count - a.count || String(a.key).localeCompare(String(b.key))
      }
    })

    return shaped
  }, [filtered, cardGroupBy, cardGroupSort, cardRecordSort])
  const allClients = [...new Set(recordsForView.map(r => r.fields?.['Client']).filter(Boolean))].sort()
  const boardColumnKeys = useMemo(() => {
    const ordered = boardGroupBy === 'Status' ? statusOptions : [...new Set(filtered.map(r => r.fields?.[boardGroupBy] || 'Unassigned'))].sort((a, b) => String(a).localeCompare(String(b)))
    return ordered.length ? ordered : ['Unassigned']
  }, [boardGroupBy, filtered, statusOptions])
  const selectedRecords = recordsForView.filter(r => selectedIds.has(r.id))
  const hasSelection = selectedIds.size > 0
  const theme = resolveTheme(themeId)
  const compact = density === 'compact'
  const boardIsDraggable = boardGroupBy === 'Status'
  const boardVars = useMemo(() => ({
    '--accent': theme.accent,
    '--accent-dim': theme.accentDim,
    '--accent-soft': theme.accentSoft,
  }), [theme])

  // Opens detail panel and immediately shows invoice picklist
  function openInvoicePanel(record) {
    setDetailOpenInvoice(true)
    setDetailRecord(record)
  }

  function toggleSelect(id) {
    setSelectedIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function selectAll() { setSelectedIds(new Set(filtered.map(r => r.id))) }
  function clearSelection() { setSelectedIds(new Set()) }
  function toggleExpand(id) { setExpandedIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n }) }

  // ── Share view — opens modal with all visible records + current view config ─
  function shareViewUrl() {
    if (filtered.length === 0) { showToast('No records visible to share.', 'error'); return }
    if (filtered.length > MAX_SHARED_VIEW_RECORDS) {
      showToast(`Public sharing is limited to ${MAX_SHARED_VIEW_RECORDS} records. Narrow the current view first.`, 'error')
      return
    }
    setShareViewModal(true)
  }

  // ── Load saved view ───────────────────────────────────────────────────────
  function loadSavedView(cfg) {
    if (cfg.type)         setViewType(cfg.type)
    if (cfg.filterClient !== undefined) setFilterClient(cfg.filterClient)
    if (cfg.filterStatus !== undefined) setFilterStatus(cfg.filterStatus)
    if (cfg.search !== undefined)       setSearch(cfg.search)
    if (cfg.columns !== undefined)      setListColumns(cfg.columns)
    if (cfg.boardGroupBy !== undefined) setBoardGroupBy(cfg.boardGroupBy)
    if (cfg.cardGroupBy !== undefined) setCardGroupBy(cfg.cardGroupBy)
    if (cfg.cardGroupSort !== undefined) setCardGroupSort(cfg.cardGroupSort)
    if (cfg.cardRecordSort !== undefined) setCardRecordSort(cfg.cardRecordSort)
    if (cfg.advancedConditions !== undefined) setAdvancedConditions(cfg.advancedConditions)
    if (cfg.theme)        setThemeId(cfg.theme)
    if (cfg.density)      setDensity(cfg.density)
    if (cfg.showDashboard !== undefined) setShowDashboard(cfg.showDashboard !== false)
    if (cfg.showClientAccents !== undefined) setShowClientAccents(cfg.showClientAccents !== false)
    clearSelection()
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────
  async function handleCreate(form) {
    setSaving(true)
    try { await api.status.create(form); showToast('Created', 'success'); setModal(null); await load() }
    catch (e) { showToast(e.message || 'Failed', 'error') }
    finally { setSaving(false) }
  }
  async function handleEdit(form) {
    if (!modal?.id) return
    setSaving(true)
    try { await api.status.update(modal.id, form); showToast('Saved', 'success'); setModal(null); await load() }
    catch (e) { showToast(e.message || 'Failed', 'error') }
    finally { setSaving(false) }
  }
  async function handleDelete(record) {
    setConfirmDialog({
      message: `Delete status update for "${record.fields?.['Project']}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      onConfirm: async () => {
        setDeletingId(record.id)
        if (detailRecord?.id === record.id) setDetailRecord(null)
        try {
          await api.status.delete(record.id); showToast('Deleted', 'success')
          setRecords(rs => rs.filter(r => r.id !== record.id))
          setSelectedIds(s => { const n = new Set(s); n.delete(record.id); return n })
        } catch (e) { showToast(e.message || 'Failed', 'error') }
        finally { setDeletingId(null) }
      },
    })
  }

  // ── Kanban drag-and-drop ──────────────────────────────────────────────────
  async function handleKanbanDrop(toStatus, e) {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain')
    setDraggedId('')
    if (!id) return
    const record = recordsForView.find(r => r.id === id)
    const fromStatus = record?.fields?.['Status'] || 'Not started'
    if (fromStatus === toStatus) return

    setPendingStatusById(prev => ({ ...prev, [id]: toStatus }))
    setUpdatingIds(s => { const n = new Set(s); n.add(id); return n })

    try {
      const updated = await api.status.update(id, { status: toStatus })
      setRecords(rs => rs.map(r => {
        if (r.id !== id) return r
        if (updated && updated.fields) return { ...r, ...updated, fields: updated.fields }
        return { ...r, fields: { ...r.fields, Status: toStatus } }
      }))
      showToast(`Moved to ${toStatus}`, 'success')
    } catch (err) {
      showToast(err.message || 'Failed to update status', 'error')
    } finally {
      setPendingStatusById(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      setUpdatingIds(s => { const n = new Set(s); n.delete(id); return n })
    }
  }

  // ── Current view config (for saved views) ────────────────────────────────
  const currentConfig = {
    type: viewType,
    filterClient,
    filterStatus,
    search,
    columns: listColumns,
    boardGroupBy,
    cardGroupBy,
    cardGroupSort,
    cardRecordSort,
    advancedConditions,
    theme: themeId,
    density,
    showDashboard,
    showClientAccents,
  }

  async function addStatusOption(option) {
    const trimmed = option.trim()
    if (!trimmed) return
    try {
      const res = await api.status.picklists.add('Status', trimmed)
      setStatusPicklists(prev => ({ ...prev, Status: { ...(prev.Status || {}), options: res.options || [] } }))
      showToast('Status option added', 'success')
    } catch (e) {
      showToast(e.message || 'Failed to add option', 'error')
      throw e
    }
  }

  return (
    <div className="relative min-h-screen" style={boardVars}>
      <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-4 pb-28">

        {/* ── Page header ── */}
        <div className="rounded-[26px] border p-4 sm:p-5 space-y-4" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(247,249,252,0.96))', borderColor: 'var(--border)', boxShadow: '0 18px 40px rgba(15,23,42,0.06)' }}>
          <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-12 h-12 rounded-[18px] flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)' }}>
                <Activity size={19} style={{ color: 'var(--accent)' }} />
              </div>
              <div className="min-w-0">
                <h1 className="text-[28px] sm:text-[30px] font-bold leading-[0.95] tracking-[-0.03em]" style={{ color: 'var(--text-1)' }}>
                  Status Board
                </h1>
                <p className="text-sm mt-2 leading-6" style={{ color: 'var(--text-3)' }}>
                  {loading
                    ? 'Loading status data…'
                    : error
                      ? 'Status sync unavailable'
                      : `${records.length} projects · ${allClients.length} clients`}
                  {hasSelection ? <span className="ml-2 font-semibold" style={{ color: 'var(--accent)' }}>· {selectedIds.size} selected</span> : null}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 xl:items-end">
              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                <div className="flex items-center rounded-2xl overflow-hidden shrink-0" style={{ border: '1px solid var(--border)', background: 'var(--card-bg)', boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
                  {[
                    { id: 'card',  Icon: LayoutGrid, label: 'Card' },
                    { id: 'list',  Icon: List,        label: 'List' },
                    { id: 'board', Icon: Columns,     label: 'Board' },
                  ].map(({ id, Icon, label }) => (
                    <button key={id} onClick={() => setViewType(id)} title={`${label} view`}
                      className="flex items-center gap-1.5 px-3 sm:px-3.5 py-2 text-xs font-semibold transition-all min-h-[40px]"
                      style={{ color: viewType === id ? 'var(--accent)' : 'var(--text-3)', background: viewType === id ? 'var(--accent-dim)' : 'transparent' }}>
                      <Icon size={13} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>

                {viewType === 'list' && (
                  <div className="relative">
                    <button onClick={() => { setShowCols(s => !s); setShowViews(false); setShowSettings(false) }}
                      className="btn-ghost flex items-center gap-1.5 text-xs px-3 py-2 min-h-[40px]">
                      <SlidersHorizontal size={12} /> Columns ({listColumns.length})
                    </button>
                    {showCols && <ColumnSelector columns={listColumns} onChange={setListColumns} onClose={() => setShowCols(false)} />}
                  </div>
                )}

                <div className="relative">
                  <button onClick={() => { setShowViews(s => !s); setShowCols(false); setShowSettings(false) }}
                    className="btn-ghost flex items-center gap-1.5 text-xs px-3 py-2 min-h-[40px]">
                    <Bookmark size={12} /> Views
                  </button>
                  {showViews && <SavedViewsMenu currentConfig={currentConfig} onLoad={loadSavedView} onClose={() => setShowViews(false)} />}
                </div>

                <div className="relative">
                  <button onClick={() => { setShowSettings(s => !s); setShowViews(false); setShowCols(false) }}
                    className="btn-ghost flex items-center gap-1.5 text-xs px-3 py-2 min-h-[40px]">
                    <SlidersHorizontal size={12} /> Customize
                  </button>
                  {showSettings && (
                    <AppearancePanel
                      themeId={themeId}
                      density={density}
                      showDashboard={showDashboard}
                      showClientAccents={showClientAccents}
                      statusOptions={statusOptions}
                      canManageStatuses={isEditor}
                      onThemeChange={setThemeId}
                      onDensityChange={setDensity}
                      onToggleDashboard={() => setShowDashboard(v => !v)}
                      onToggleClientAccents={() => setShowClientAccents(v => !v)}
                      onAddStatusOption={isEditor ? addStatusOption : null}
                      onClose={() => setShowSettings(false)}
                    />
                  )}
                </div>
              </div>

              {(viewType === 'board' || viewType === 'card') && (
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 w-full xl:w-auto">
                  {viewType === 'board' && (
                    <label className="rounded-2xl px-3 py-2 flex items-center gap-2 min-w-[180px]" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] shrink-0" style={{ color: 'var(--text-3)' }}>Group by</span>
                      <select
                        className="bg-transparent text-sm font-semibold min-w-0 flex-1 outline-none"
                        value={boardGroupBy}
                        onChange={e => setBoardGroupBy(e.target.value)}
                        style={{ color: 'var(--text-1)' }}
                      >
                        {BOARD_GROUP_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </label>
                  )}

                  {viewType === 'card' && (
                    <>
                      <label className="rounded-2xl px-3 py-2 flex items-center gap-2 min-w-[180px]" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
                        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] shrink-0" style={{ color: 'var(--text-3)' }}>Group</span>
                        <select
                          className="bg-transparent text-sm font-semibold min-w-0 flex-1 outline-none"
                          value={cardGroupBy}
                          onChange={e => setCardGroupBy(e.target.value)}
                          style={{ color: 'var(--text-1)' }}
                        >
                          {CARD_GROUP_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="rounded-2xl px-3 py-2 flex items-center gap-2 min-w-[210px]" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
                        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] shrink-0" style={{ color: 'var(--text-3)' }}>Order</span>
                        <select
                          className="bg-transparent text-sm font-semibold min-w-0 flex-1 outline-none"
                          value={cardGroupSort}
                          onChange={e => setCardGroupSort(e.target.value)}
                          style={{ color: 'var(--text-1)' }}
                        >
                          {CARD_GROUP_SORT_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="rounded-2xl px-3 py-2 flex items-center gap-2 min-w-[190px]" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
                        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] shrink-0" style={{ color: 'var(--text-3)' }}>Cards</span>
                        <select
                          className="bg-transparent text-sm font-semibold min-w-0 flex-1 outline-none"
                          value={cardRecordSort}
                          onChange={e => setCardRecordSort(e.target.value)}
                          style={{ color: 'var(--text-1)' }}
                        >
                          {CARD_RECORD_SORT_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                <button onClick={shareViewUrl}
                  className="btn-ghost flex items-center gap-1.5 text-xs px-3 py-2 min-h-[40px]"
                  title="Generate a public share link for the current view">
                  <Share2 size={12} />
                  <span>Share View</span>
                </button>

                {isEditor && (
                  <button onClick={() => setManageModal(true)} className="btn-ghost flex items-center gap-1.5 text-xs px-3 py-2 min-h-[40px]">
                    <Link2 size={12} /> <span>Links</span>
                  </button>
                )}

                <button onClick={load} disabled={loading} className="btn-ghost px-3 py-2 min-h-[40px]" title="Refresh">
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
                {isEditor && (
                  <button onClick={() => setModal('new')} className="btn-primary flex items-center gap-2 text-sm px-4 py-2 min-h-[40px]">
                    <Plus size={13} /> <span>Add Status</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Status Dashboard ── */}
        {!loading && records.length > 0 && showDashboard && (
          <StatusDashboard records={records} statusOptions={statusOptions} filterStatus={filterStatus} onFilterStatus={setFilterStatus} />
        )}

        {/* ── Filter bar ── */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
            <input type="text" className="input-field w-full pl-8 text-sm"
              placeholder="Search projects, clients, status…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="input-field text-sm sm:w-36" value={filterClient} onChange={e => setFilterClient(e.target.value)}>
            <option value="">All clients</option>
            {allClients.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            onClick={() => setShowAdvancedFilters(v => !v)}
            className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5 whitespace-nowrap"
          >
            <SlidersHorizontal size={12} />
            {showAdvancedFilters ? 'Hide advanced' : 'Advanced filters'}
          </button>
          {/* Select all (card/list views) */}
          {filtered.length > 0 && isEditor && viewType !== 'board' && (
            <button
              onClick={hasSelection && selectedIds.size === filtered.length ? clearSelection : selectAll}
              className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5 whitespace-nowrap">
              <div className="w-3.5 h-3.5 rounded flex items-center justify-center"
                style={{ background: hasSelection && selectedIds.size === filtered.length ? 'var(--accent)' : 'var(--bg-input)', border: `1.5px solid ${hasSelection && selectedIds.size === filtered.length ? 'var(--accent)' : 'var(--border)'}` }}>
                {hasSelection && selectedIds.size === filtered.length && <Check size={9} color="#fff" strokeWidth={3} />}
              </div>
              {hasSelection && selectedIds.size === filtered.length ? 'Deselect all' : 'Select all'}
            </button>
          )}
        </div>

        {showAdvancedFilters && (
          <div className="rounded-2xl p-4" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
            <FilterBuilder
              fields={STATUS_FILTER_FIELDS}
              records={records}
              getFieldValue={r => r.fields || {}}
              conditions={advancedConditions}
              onChange={setAdvancedConditions}
            />
          </div>
        )}

        {/* ── Active filter chips ── */}
        {Boolean(filterClient || filterStatus || search || advancedConditions.length > 0) && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>Filters:</span>
            {filterClient && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                Client: {filterClient}
                <button onClick={() => setFilterClient('')} style={{ color: 'var(--text-3)' }}><X size={10} /></button>
              </span>
            )}
            {filterStatus && (() => { const sc = statusStyle(filterStatus); return (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
                style={{ background: sc.bg, border: `1px solid ${sc.border}`, color: sc.color }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.dot }} />
                {filterStatus}
                <button onClick={() => setFilterStatus('')} style={{ color: sc.color }}><X size={10} /></button>
              </span>
            )})()}
            {search && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                "{search}"
                <button onClick={() => setSearch('')} style={{ color: 'var(--text-3)' }}><X size={10} /></button>
              </span>
            )}
            {advancedConditions.length > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                {advancedConditions.length} advanced rule{advancedConditions.length !== 1 ? 's' : ''}
                <button onClick={() => setAdvancedConditions([])} style={{ color: 'var(--text-3)' }}><X size={10} /></button>
              </span>
            )}
            <button onClick={() => { setFilterClient(''); setFilterStatus(''); setSearch(''); setAdvancedConditions([]) }}
              className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>
              Clear all
            </button>
          </div>
        )}

        {viewType === 'list' && !loading && !error && filtered.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--text-3)' }}>Visible columns</span>
            {listLayout.active.map(col => (
              <span key={col} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                {LIST_COLUMN_META[col]?.label || col}
              </span>
            ))}
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={22} className="animate-spin" style={{ color: 'var(--text-3)' }} />
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
              <button onClick={load} className="text-xs font-semibold mt-2" style={{ color: 'var(--accent)' }}>Retry</button>
            </div>
          </div>
        )}

        {/* ── Empty state ── */}
        {!loading && !error && records.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
              <ClipboardList size={26} style={{ color: 'var(--text-3)' }} />
            </div>
            <p className="text-base font-bold mb-1" style={{ color: 'var(--text-1)' }}>No status updates yet</p>
            <p className="text-sm mb-5 max-w-xs" style={{ color: 'var(--text-3)' }}>
              Add live project status entries to track what's happening across the portfolio.
            </p>
            {isEditor && (
              <button className="btn-primary flex items-center gap-2 text-sm" onClick={() => setModal('new')}>
                <Plus size={14} /> Add First Status
              </button>
            )}
          </div>
        )}

        {/* ── No results ── */}
        {!loading && !error && records.length > 0 && filtered.length === 0 && (
          <div className="text-center py-12">
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>No entries match your filter.</p>
            <button onClick={() => { setSearch(''); setFilterClient(''); setFilterStatus('') }}
              className="text-xs font-semibold mt-2" style={{ color: 'var(--accent)' }}>
              Clear filters
            </button>
          </div>
        )}

        {/* ══ CARD VIEW ══ */}
        {!loading && !error && filtered.length > 0 && viewType === 'card' && (
          <div className="space-y-6">
            {cardGroups.map(({ key, records: recs, count }) => {
              const clrHex = cardGroupBy === 'Client' ? clientColor(key) : statusStyle(key).color
              const groupStyle = cardGroupBy === 'Status'
                ? statusStyle(key)
                : { bg: hexToRgba(clrHex, 0.1), border: hexToRgba(clrHex, 0.3), color: clrHex, dot: clrHex }
              const groupSel = recs.filter(r => selectedIds.has(r.id)).length
              return (
                <section key={key} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
                        style={{ background: groupStyle.bg, border: `1px solid ${groupStyle.border}`, color: groupStyle.color }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: groupStyle.dot }} />
                        {key}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                        {count} project{count !== 1 ? 's' : ''}
                        {groupSel > 0 && <span className="ml-1 font-semibold" style={{ color: clrHex }}>· {groupSel} selected</span>}
                      </span>
                    </div>
                    {isEditor && recs.length > 1 && (
                      <button
                        onClick={() => {
                          const allGroupSel = recs.every(r => selectedIds.has(r.id))
                          setSelectedIds(s => { const n = new Set(s); recs.forEach(r => allGroupSel ? n.delete(r.id) : n.add(r.id)); return n })
                        }}
                        className="text-[11px] font-medium px-2 py-0.5 rounded-lg"
                        style={{ color: 'var(--text-3)', background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                        {recs.every(r => selectedIds.has(r.id)) ? 'Deselect group' : 'Select group'}
                      </button>
                    )}
                  </div>
                  <div className={`grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 ${compact ? 'gap-2' : 'gap-3'}`}>
                    {recs.map(r => (
                      <StatusCard
                        key={r.id}
                        record={r}
                        isEditor={isEditor}
                        onEdit={() => setModal(r)}
                        onDelete={() => handleDelete(r)}
                        onDetail={setDetailRecord}
                        onInvoice={openInvoicePanel}
                        selected={selectedIds.has(r.id)}
                        onSelect={toggleSelect}
                        expanded={expandedIds.has(r.id)}
                        onToggle={() => toggleExpand(r.id)}
                        deleting={deletingId === r.id}
                        compact={compact}
                        showClientAccents={showClientAccents}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}

        {/* ══ LIST VIEW ══ */}
        {!loading && !error && filtered.length > 0 && viewType === 'list' && (
          <div className="rounded-[24px] overflow-hidden" style={{ border: '1px solid var(--border)', background: 'var(--card-bg)', boxShadow: '0 12px 28px rgba(15,23,42,0.05)' }}>
            <div className="overflow-x-auto">
              <div className="min-w-full">
                <div className="grid gap-3 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.18em]"
                  style={{ gridTemplateColumns: listLayout.gridTemplateColumns, minWidth: listLayout.minWidth, background: 'linear-gradient(180deg, rgba(248,250,252,0.98), rgba(241,245,249,0.98))', color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}>
                  <span />
                  {listLayout.active.map(col => (
                    <span key={col} className="min-w-0 truncate">{LIST_COLUMN_META[col]?.label || col}</span>
                  ))}
                  <span className="text-right">Actions</span>
                </div>
                {filtered.map((r, i) => (
                  <ListViewRow
                    key={r.id}
                    record={r}
                    idx={i}
                    isEditor={isEditor}
                    onEdit={() => setModal(r)}
                    onDelete={() => handleDelete(r)}
                    onDetail={setDetailRecord}
                    onInvoice={openInvoicePanel}
                    selected={selectedIds.has(r.id)}
                    onSelect={toggleSelect}
                    columns={listColumns}
                    deleting={deletingId === r.id}
                    compact={compact}
                    showClientAccents={showClientAccents}
                    layout={listLayout}
                  />
                ))}
              </div>
            </div>
            {/* Summary row */}
            <div className="px-3 py-2 text-xs flex items-center gap-3 flex-wrap"
              style={{ background: 'var(--bg-input)', borderTop: '1px solid var(--border)', color: 'var(--text-3)' }}>
              <span>{filtered.length} records</span>
              {filterClient && <span>Client: <strong style={{ color: 'var(--text-2)' }}>{filterClient}</strong></span>}
              {filterStatus && (() => { const sc = statusStyle(filterStatus); return <span style={{ color: sc.color }}>● {filterStatus}</span> })()}
            </div>
          </div>
        )}

        {/* ══ BOARD VIEW (Kanban + DnD) ══ */}
        {!loading && !error && viewType === 'board' && (
          <div>
            {isEditor && !boardIsDraggable && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl mb-3 text-xs font-medium"
                style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: '#d97706' }}>
                <GripVertical size={12} />
                Grouped by <strong>{boardGroupBy}</strong> — drag &amp; drop is disabled. Switch "Group by" to <strong>Status</strong> to move cards between columns.
              </div>
            )}
            {isEditor && boardIsDraggable && (
              <p className="text-xs mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                <GripVertical size={12} /> Drag cards between columns to update their status
              </p>
            )}
            <div className="overflow-x-auto -mx-4 px-4 pb-4">
              <div className="flex gap-3" style={{ minWidth: `${boardColumnKeys.length * 240}px` }}>
                {boardColumnKeys.map(columnKey => {
                  const recs = filtered.filter(r => (r.fields?.[boardGroupBy] || (boardGroupBy === 'Status' ? 'Not started' : 'Unassigned')) === columnKey)
                  return (
                    <KanbanColumn
                      key={columnKey}
                      statusKey={columnKey}
                      statusLabel={columnKey}
                      records={recs}
                      isEditor={isEditor}
                      onEdit={r => setModal(r)}
                      onDetail={setDetailRecord}
                      onInvoice={openInvoicePanel}
                      selectedIds={selectedIds}
                      onSelect={toggleSelect}
                      onDrop={handleKanbanDrop}
                      updatingIds={updatingIds}
                      onDragStart={setDraggedId}
                      onDragEnd={() => setDraggedId('')}
                      draggedId={draggedId}
                      compact={compact}
                      showClientAccents={showClientAccents}
                      draggable={boardIsDraggable}
                    />
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Floating action bar ── */}
      {hasSelection && isEditor && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 pointer-events-none"
          style={{ width: 'calc(100% - 2rem)', maxWidth: '560px' }}>
          <div className="pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-2xl shadow-xl"
            style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', boxShadow: '0 8px 32px rgba(15,23,42,0.2), 0 0 0 1px rgba(255,255,255,0.05)' }}>
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-xl flex items-center justify-center"
                style={{ background: 'var(--accent)', color: '#fff', fontSize: '11px', fontWeight: 700 }}>
                {selectedIds.size}
              </div>
              <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
                project{selectedIds.size !== 1 ? 's' : ''} selected
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setAiModal(true)}
                className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-all"
                style={{ background: 'rgba(139,92,246,0.12)', color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.25)' }}>
                <Sparkles size={13} /> <span className="hidden sm:inline">AI Update</span>
              </button>
              <button onClick={() => setShareModal(true)}
                className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-all"
                style={{ background: 'rgba(14,165,233,0.12)', color: '#0ea5e9', border: '1px solid rgba(14,165,233,0.25)' }}>
                <Share2 size={13} /> <span className="hidden sm:inline">Share</span>
              </button>
              <button onClick={clearSelection} className="btn-icon p-1.5" style={{ color: 'var(--text-3)' }}>
                <X size={15} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail Panel ── */}
      {detailRecord && (
        <DetailPanel
          record={detailRecord}
          onClose={() => { setDetailRecord(null); setDetailOpenInvoice(false) }}
          onEdit={() => { setModal(detailRecord); setDetailRecord(null); setDetailOpenInvoice(false) }}
          onDelete={() => { handleDelete(detailRecord); setDetailRecord(null); setDetailOpenInvoice(false) }}
          isEditor={isEditor}
          openInvoice={detailOpenInvoice}
        />
      )}

      {/* ── Close dropdowns on outside click ── */}
      {(showViews || showCols || showSettings) && (
        <div className="fixed inset-0 z-20" onClick={() => { setShowViews(false); setShowCols(false); setShowSettings(false) }} />
      )}

      {/* ── Modals ── */}
      {modal && (
        <StatusModal
          initial={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSave={modal === 'new' ? handleCreate : handleEdit}
          saving={saving}
          allRecords={records}
          statusOptions={statusOptions}
          onAddStatusOption={isEditor ? addStatusOption : null}
        />
      )}
      {aiModal && (
        <AIUpdateModal selectedRecords={selectedRecords} onClose={() => setAiModal(false)} onShare={() => setShareModal(true)} />
      )}
      {shareModal && (
        <ShareModal selectedRecords={selectedRecords} onClose={() => setShareModal(false)} />
      )}
      {shareViewModal && (
        <ShareModal
          selectedRecords={filtered}
          viewConfig={currentConfig}
          title={`Status Update · ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
          isViewShare
          onClose={() => setShareViewModal(false)}
        />
      )}
      {manageModal && (
        <ManageSharesModal onClose={() => setManageModal(false)} />
      )}
      {confirmDialog && (
        <ConfirmModal
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel || 'Delete'}
          onConfirm={confirmDialog.onConfirm}
          onClose={() => setConfirmDialog(null)}
        />
      )}
    </div>
  )
}
