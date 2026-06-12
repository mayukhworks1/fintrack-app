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
import { useNavigate } from 'react-router-dom'
import {
  Activity, Plus, Pencil, Trash2, X, Check,
  ChevronDown, ChevronUp, RefreshCw, Search,
  AlertCircle, Loader2, ClipboardList, Sparkles,
  Share2, Copy, CheckCheck, ExternalLink, Eye,
  Clock, ToggleLeft, ToggleRight, Link2,
  MapPin, Monitor, Smartphone, Globe, Shield,
  LayoutGrid, List, Columns,
  Bookmark, BookmarkPlus, Trash, SlidersHorizontal,
  GripVertical, ArrowRight, ChevronRight, TrendingUp, Filter,
  CheckSquare, Square, Paperclip, Upload,
} from 'lucide-react'
import { api, clientCacheBust, getAuthToken, API_BASE_URL } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useTheme } from '../context/ThemeContext'
import { FilterBuilder, applyConditions } from '../components/FilterBuilder'
import { formatInr } from '../utils/format'
import EmptyState from '../components/EmptyState'

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
const ALL_COLUMNS = ['Client', 'Project', 'Status', 'Short Status', 'Detailed Status', 'Attachments', 'Last Modified']
const DEFAULT_COLUMNS = ['Client', 'Project', 'Status', 'Short Status']
const LIST_COLUMN_META = {
  'Client': { label: 'Client', track: 'minmax(150px, 1.05fr)', minWidth: 150 },
  'Project': { label: 'Project', track: 'minmax(240px, 1.6fr)', minWidth: 240 },
  'Status': { label: 'Status', track: '144px', minWidth: 144 },
  'Short Status': { label: 'Headline', track: 'minmax(260px, 1.55fr)', minWidth: 260 },
  'Detailed Status': { label: 'Detail', track: 'minmax(320px, 1.75fr)', minWidth: 320 },
  'Attachments': { label: 'Files', track: '120px', minWidth: 120 },
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

function parseAttachments(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.filter(Boolean)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.filter(Boolean) : []
    } catch {
      return []
    }
  }
  return []
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

const EXECUTIVE_VARS_DARK = {
  '--bg-base': '#090b10',
  '--bg-layer': '#0e1118',
  '--card-bg': '#141820',
  '--card-border': 'rgba(255,255,255,0.08)',
  '--card-shadow': '0 24px 60px rgba(0,0,0,0.32)',
  '--card-shadow-hover': '0 28px 70px rgba(0,0,0,0.4)',
  '--bg-input': '#10141d',
  '--text-1': '#f4f7fb',
  '--text-2': '#c0c8d6',
  '--text-3': '#7f8a9c',
  '--border': 'rgba(255,255,255,0.08)',
}

const EXECUTIVE_VARS_LIGHT = {
  '--bg-base': '#f5f7fb',
  '--bg-layer': '#fbfcff',
  '--card-bg': '#ffffff',
  '--card-border': 'rgba(15,23,42,0.08)',
  '--card-shadow': '0 24px 60px rgba(15,23,42,0.08)',
  '--card-shadow-hover': '0 28px 70px rgba(15,23,42,0.12)',
  '--bg-input': '#f5f7fb',
  '--text-1': '#152033',
  '--text-2': '#536175',
  '--text-3': '#8b97aa',
  '--border': 'rgba(15,23,42,0.08)',
}

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
          background: !filterStatus ? 'linear-gradient(135deg, rgba(125,149,255,0.24), rgba(125,149,255,0.12))' : 'rgba(255,255,255,0.03)',
          border: !filterStatus ? '1.5px solid var(--accent)' : '1px solid rgba(255,255,255,0.08)',
          color: !filterStatus ? '#fff' : 'var(--text-2)',
          boxShadow: !filterStatus ? '0 14px 30px rgba(77,116,255,0.18)' : 'none',
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
              background: active ? sc.bg : 'rgba(255,255,255,0.03)',
              border: active ? `1.5px solid ${sc.border}` : '1px solid rgba(255,255,255,0.08)',
              boxShadow: active ? `0 12px 24px ${sc.bg}` : 'none',
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
function DetailPanel({ record, onClose, onEdit, onDelete, isEditor }) {
  const navigate = useNavigate()
  const f = record?.fields || {}
  const client  = f['Client']  || ''
  const project = f['Project'] || ''
  const status  = f['Status']  || ''
  const short   = f['Short Status'] || ''
  const detail  = f['Current Status (Detailed)'] || ''
  const attachments = parseAttachments(f['Attachments'])
  const modified = f['lastModifiedTime'] || record?.createdTime || ''
  const clrHex  = clientColor(client)
  const sc      = statusStyle(status)
  const toast   = useToast()
  const openInvoices = () => {
    const params = new URLSearchParams()
    if (project) params.set('project', project)
    navigate(`/invoices?${params.toString()}`)
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

          {/* ── Status ─────────────────────────────────────────────────── */}
          {status && (
            <div className="rounded-2xl p-4" style={{ background: sc.bg, border: `1px solid ${sc.border}` }}>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: sc.color }}>Current Status</p>
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-bold"
                style={{ background: 'var(--card-bg)', color: sc.color, border: `1px solid ${sc.border}` }}>
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
                  <div className="pt-1">
                    <button onClick={openInvoices} className="btn-ghost text-xs" style={{ padding: '0.4rem 0.7rem' }}>
                      View invoices
                    </button>
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
            {attachments.length > 0 && (
              <div className="rounded-2xl p-4" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>Attachments</p>
                <div className="space-y-2">
                  {attachments.map((item, index) => {
                    const name = item?.name || item?.filename || `Attachment ${index + 1}`
                    const url = item?.url || item?.presignedUrl || ''
                    return (
                      <div key={`${name}-${index}`} className="flex items-center gap-2 px-3 py-2 rounded-xl"
                        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
                        <Paperclip size={12} style={{ color: 'var(--text-3)' }} />
                        <span className="flex-1 truncate text-sm" style={{ color: 'var(--text-2)' }}>{name}</span>
                        {url && (
                          <a href={url} target="_blank" rel="noopener noreferrer" className="btn-icon p-1.5">
                            <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Status Card — Card view
// ─────────────────────────────────────────────────────────────────────────────
function StatusCard({ record, isEditor, onEdit, onDelete, onDetail, selected, onSelect, expanded, onToggle, deleting, compact = false, showClientAccents = true }) {
  const f        = record.fields || {}
  const client   = f['Client']  || '?'
  const project  = f['Project'] || '?'
  const short    = f['Short Status'] || ''
  const detail   = f['Current Status (Detailed)'] || ''
  const status   = f['Status'] || ''
  const modified = f['lastModifiedTime'] || record?.createdTime || ''
  const clrHex   = clientColor(client)
  const sc       = statusStyle(status)
  const p        = compact ? '0.75rem' : '1rem'

  return (
    <div
      className="rounded-xl overflow-hidden transition-shadow duration-150 group"
      style={{
        background: 'var(--card-bg)',
        border: `1.5px solid ${selected ? clrHex : 'var(--border)'}`,
        boxShadow: selected ? `0 0 0 3px ${hexToRgba(clrHex, 0.15)}` : '0 1px 3px rgba(0,0,0,0.05)',
      }}
    >
      {/* Client accent bar */}
      {showClientAccents && <div style={{ height: 3, background: clrHex }} />}

      <div style={{ padding: p }}>
        {/* Row 1: checkbox + client chip + project + actions */}
        <div className="flex items-start gap-2 mb-2.5">
          {isEditor && (
            <button
              onClick={e => { e.stopPropagation(); onSelect(record.id) }}
              className="flex-shrink-0 mt-0.5 rounded transition-all"
              style={{
                width: 15, height: 15, minWidth: 15,
                background: selected ? clrHex : 'transparent',
                border: `2px solid ${selected ? clrHex : 'var(--border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {selected && <Check size={8} color="#fff" strokeWidth={3.5} />}
            </button>
          )}
          <div className="flex-1 min-w-0">
            <span className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-full mb-1"
              style={{
                background: showClientAccents ? hexToRgba(clrHex, 0.1) : 'var(--bg-input)',
                color: showClientAccents ? clrHex : 'var(--text-2)',
                border: `1px solid ${showClientAccents ? hexToRgba(clrHex, 0.2) : 'var(--border)'}`,
              }}>
              {client}
            </span>
            <p className="text-[13px] font-bold leading-snug truncate" style={{ color: 'var(--text-1)' }}>{project}</p>
          </div>
          {/* Actions — hidden until hover */}
          <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={e => { e.stopPropagation(); onDetail(record) }}
              className="btn-icon p-1" style={{ color: 'var(--text-3)' }} title="View details">
              <Eye size={12} />
            </button>
            {isEditor && !deleting && (
              <>
                <button onClick={e => { e.stopPropagation(); onEdit() }}
                  className="btn-icon p-1" style={{ color: 'var(--text-3)' }} title="Edit">
                  <Pencil size={11} />
                </button>
                <button onClick={e => { e.stopPropagation(); onDelete() }}
                  className="btn-icon p-1"
                  style={{ color: 'rgba(239,68,68,0.4)' }}
                  onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                  onMouseLeave={e => e.currentTarget.style.color = 'rgba(239,68,68,0.4)'}
                  title="Delete">
                  <Trash2 size={11} />
                </button>
              </>
            )}
            {deleting && <Loader2 size={12} className="animate-spin" style={{ color: 'var(--text-3)' }} />}
          </div>
        </div>

        {/* Row 2: status badge + last modified */}
        <div className="flex items-center justify-between mb-2">
          {status ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
              style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.dot }} />
              {status}
            </span>
          ) : <span />}
          {modified && (
            <span className="text-[10px] flex items-center gap-0.5" style={{ color: 'var(--text-3)' }}>
              <Clock size={9} />{fmtShortDate(modified)}
            </span>
          )}
        </div>

        {/* Short status — headline, up to 3 lines */}
        {short && (
          <p className="text-[13px] font-semibold leading-snug mb-1.5"
            style={{ color: 'var(--text-1)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {short}
          </p>
        )}

        {/* Detailed status — dimmer, 2-line clamp, no toggle */}
        {detail && detail.trim() !== short.trim() && (
          <p className="text-[12px] leading-snug"
            style={{ color: 'var(--text-3)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {detail}
          </p>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// List View Row
// ─────────────────────────────────────────────────────────────────────────────
function ListViewRow({ record, idx, isEditor, onEdit, onDelete, onDetail, selected, onSelect, columns, deleting, compact = false, showClientAccents = true, layout }) {
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
      {columns.includes('Attachments') && (
        <div className="min-w-0">
          <span className="text-[11px] font-semibold block" style={{ color: 'var(--text-2)' }}>
            {parseAttachments(f['Attachments']).length ? `${parseAttachments(f['Attachments']).length} file${parseAttachments(f['Attachments']).length === 1 ? '' : 's'}` : '—'}
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
function KanbanCard({ record, isEditor, onEdit, onDetail, selected, onSelect, updating, onDragStart, onDragEnd, isDragging, compact = false, showClientAccents = true, dragDisabled = false }) {
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

function KanbanColumn({ statusKey, statusLabel, records, isEditor, onEdit, onDetail, selectedIds, onSelect, onDrop, updatingIds, onDragStart, onDragEnd, draggedId, compact = false, showClientAccents = true, draggable = true }) {
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
function StatusAttachmentField({ value, onChange, recordId }) {
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState('')
  const fileInputRef = useRef(null)
  const attachments = Array.isArray(value) ? value : []
  const disabled = !recordId

  async function processFiles(files) {
    if (!files?.length || !recordId) return
    setUploading(true)
    setUploadErr('')
    try {
      let latest = attachments
      for (const file of files) {
        const result = await api.status.upload(recordId, 'Attachments', file)
        latest = result?.attachments || latest
      }
      onChange(latest)
    } catch (e) {
      setUploadErr(e.message || 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div>
      <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
        Attachments <span className="font-normal" style={{ color: 'var(--text-3)' }}>· shared with public views</span>
      </label>
      {attachments.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {attachments.map((item, index) => {
            const name = item?.name || item?.filename || `Attachment ${index + 1}`
            const url = item?.url || item?.presignedUrl || ''
            return (
              <div key={`${name}-${index}`} className="flex items-center gap-2 px-3 py-2 rounded-xl"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                <Paperclip size={12} style={{ color: 'var(--text-3)' }} />
                <span className="flex-1 truncate text-xs font-medium" style={{ color: 'var(--text-2)' }}>{name}</span>
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer"
                    className="btn-icon p-1.5" aria-label="Open attachment">
                    <ExternalLink size={11} />
                  </a>
                )}
              </div>
            )
          })}
        </div>
      )}
      <button
        type="button"
        onClick={() => !disabled && !uploading && fileInputRef.current?.click()}
        disabled={disabled || uploading}
        className="w-full rounded-xl border border-dashed px-3 py-4 flex items-center justify-center gap-2 text-sm font-medium transition-all"
        style={{
          borderColor: disabled ? 'var(--border)' : 'rgba(59,130,246,0.28)',
          background: disabled ? 'var(--bg-input)' : 'rgba(59,130,246,0.04)',
          color: disabled ? 'var(--text-3)' : 'var(--text-2)',
          opacity: disabled ? 0.8 : 1,
        }}>
        {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
        {disabled ? 'Save the status first to upload files' : 'Upload attachment'}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        onChange={e => processFiles(Array.from(e.target.files || []))}
      />
      {uploadErr && <p className="mt-1.5 text-xs" style={{ color: '#ef4444' }}>{uploadErr}</p>}
    </div>
  )
}

function StatusModal({ initial, onClose, onSave, saving, allRecords, statusOptions, onAddStatusOption, options }) {
  const isEdit = !!initial
  const [form, setForm] = useState({
    client:                  initial?.fields?.['Client'] || '',
    project:                 initial?.fields?.['Project'] || '',
    status:                  initial?.fields?.['Status'] || '',
    short_status:            initial?.fields?.['Short Status'] || '',
    current_status_detailed: initial?.fields?.['Current Status (Detailed)'] || '',
    attachments:             parseAttachments(initial?.fields?.['Attachments']),
  })
  const [newStatusOption, setNewStatusOption] = useState('')
  const [addingStatusOption, setAddingStatusOption] = useState(false)
  const allClients  = (options?.clients?.length ? options.clients : [...new Set(allRecords.map(r => r.fields?.['Client']).filter(Boolean))].sort())
  const allProjects = (options?.projects?.length ? options.projects : [...new Set(allRecords.map(r => r.fields?.['Project']).filter(Boolean))].sort())
  const projectsByClient = options?.projects_by_client || {}
  const projectOptions = form.client && projectsByClient[form.client]?.length
    ? projectsByClient[form.client]
    : allProjects
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
              <select
                className="input-field w-full text-sm"
                value={form.client}
                onChange={e => setForm(f => ({ ...f, client: e.target.value, project: '' }))}
                required>
                <option value="">Select client…</option>
                {allClients.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
                Project <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <select
                className="input-field w-full text-sm"
                value={form.project}
                onChange={e => set('project', e.target.value)}
                required
                disabled={!projectOptions.length}>
                <option value="">{form.client ? 'Select project…' : 'Select client first…'}</option>
                {projectOptions.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
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
              value={form.short_status} onChange={e => set('short_status', e.target.value)} maxLength={500} />
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

          <StatusAttachmentField
            value={form.attachments}
            onChange={(attachments) => set('attachments', attachments)}
            recordId={initial?.id || ''}
          />

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
      if (isViewShare) {
        // Dynamic live link — always fetches all matching records from Teable,
        // so new projects added after the link is created appear automatically.
        const payload = {
          title: title.trim() || null,
          record_ids: ['__dynamic__'],   // sentinel: "fetch live on every access"
          expires_hours: expiry || null,
          access_mode: 'read',
          resource_type: 'status',
        }
        if (viewConfig) {
          const { advancedConditions: _stripped, ...safeConfig } = viewConfig
          payload.view_config = safeConfig
        }
        const data = await api.sharedViews.create(payload)
        setShareData(data); setStep('created')
      } else {
        // Snapshot link — shares the currently selected records only.
        if (selectedRecords.length === 0) throw new Error('No records selected to share.')
        if (selectedRecords.length > MAX_SHARED_VIEW_RECORDS) {
          throw new Error(`Public sharing is limited to ${MAX_SHARED_VIEW_RECORDS} records. Narrow the current view first.`)
        }
        const payload = {
          title: title.trim() || null,
          record_ids: selectedRecords.map(r => r.id),
          expires_hours: expiry || null,
          access_mode: accessMode,
          resource_type: 'status',
        }
        const data = await api.sharedViews.create(payload)
        setShareData(data); setStep('created')
      }
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
              <h2 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{step === 'form' ? (isViewShare ? 'Share Current View' : 'Share Selected Projects') : 'Link Ready!'}</h2>
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
                <label className="block text-xs font-semibold mb-0.5" style={{ color: 'var(--text-2)' }}>Page title</label>
                <p className="text-[10px] mb-1.5" style={{ color: 'var(--text-3)' }}>Shown to the viewer as the page heading</p>
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
                    ? 'Live link — always fetches the latest data from Teable. New projects added after sharing appear automatically. IP, location & device tracked on every open.'
                    : 'IP, location, device & browser tracked on every open. Disable or delete anytime.'}
                </p>
              </div>
              <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                Need to update an existing public URL? Use <strong>Links</strong> and edit that link’s scope there.
              </p>
              {isViewShare && (
                <div className="space-y-1">
                  <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                    Current filters, layout, theme, density, dashboard preferences, and card expansion state will travel with this link.
                  </p>
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <button onClick={onClose} className="btn-ghost text-sm px-4 py-2">Cancel</button>
                <button onClick={createShare} disabled={saving || (!isViewShare && (selectedRecords.length === 0 || selectedRecords.length > MAX_SHARED_VIEW_RECORDS))} className="btn-primary flex items-center gap-2 text-sm px-4 py-2">
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
                  {isViewShare && (
                    <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full text-[10px] font-bold"
                      style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Live · new projects appear automatically
                    </span>
                  )}
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
// Manage Shares Modal — fully redesigned
// ─────────────────────────────────────────────────────────────────────────────
function summarizeShareScope(view, fallbackCount = 0) {
  const vc = view?.view_config || {}
  const parts = []
  if (view?.is_dynamic) {
    parts.push('Live')
    if (vc.filterClient) parts.push(`Client: ${vc.filterClient}`)
    if (vc.filterProject) parts.push(`Project: ${vc.filterProject}`)
    if (vc.filterStatus) parts.push(`Status: ${vc.filterStatus}`)
    if (vc.search) parts.push(`Search: "${vc.search}"`)
  } else {
    const count = Array.isArray(view?.record_ids) ? view.record_ids.length : fallbackCount
    parts.push(`Snapshot · ${count} project${count === 1 ? '' : 's'}`)
  }
  return parts.join(' · ')
}

function ScopeEditorModal({ view, currentConfig, visibleRecords, onClose, onSave }) {
  const [mode, setMode] = useState(view?.is_dynamic ? 'live' : 'snapshot')
  const [saving, setSaving] = useState(false)
  const { showToast } = useToast()

  if (!view) return null

  const visibleCount = visibleRecords.length
  const snapshotTooLarge = visibleCount > MAX_SHARED_VIEW_RECORDS
  const { advancedConditions: _ignored, ...safeConfig } = currentConfig || {}
  const currentScope = summarizeShareScope(view)
  const newScope = mode === 'live'
    ? summarizeShareScope({ is_dynamic: true, view_config: safeConfig })
    : `Snapshot · ${visibleCount} project${visibleCount === 1 ? '' : 's'}`

  async function handleSave() {
    if (!currentConfig) {
      showToast('Current view is unavailable.', 'error')
      return
    }
    if (visibleCount <= 0) {
      showToast('No visible projects in the current view to save.', 'error')
      return
    }
    if (mode === 'snapshot' && snapshotTooLarge) {
      showToast(`Snapshot links are limited to ${MAX_SHARED_VIEW_RECORDS} projects. Narrow the current view first.`, 'error')
      return
    }

    setSaving(true)
    try {
      const patch = mode === 'live'
        ? { record_ids: ['__dynamic__'], view_config: safeConfig }
        : { record_ids: visibleRecords.map(r => r.id), view_config: safeConfig }
      await onSave(patch)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(15,23,42,0.7)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <h3 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Edit Link Scope</h3>
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>You are updating one existing public URL, not creating a new one.</p>
          </div>
          <button onClick={onClose} className="btn-icon p-1.5" style={{ color: 'var(--text-3)' }}><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-2)' }}>{view.title || 'Untitled link'}</p>
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{window.location.origin}/view/{view.token}</p>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>Current scope</p>
              <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>{currentScope}</p>
            </div>
            <div className="rounded-xl p-3" style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.15)' }}>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>Current visible view</p>
              <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>{visibleCount} visible project{visibleCount === 1 ? '' : 's'}</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-2)' }}>Replace with</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {[
                { id: 'live', label: 'Live current view', hint: 'Same URL, always re-fetches matching Teable data from this view.' },
                { id: 'snapshot', label: 'Snapshot current view', hint: `Same URL, fixed to the ${visibleCount} projects visible right now.` },
              ].map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setMode(opt.id)}
                  className="rounded-xl px-3 py-2 text-left transition-all"
                  style={{
                    background: mode === opt.id ? 'var(--accent-dim)' : 'var(--bg-input)',
                    border: `1px solid ${mode === opt.id ? 'var(--accent-soft)' : 'var(--border)'}`,
                    opacity: opt.id === 'snapshot' && snapshotTooLarge ? 0.55 : 1,
                  }}
                >
                  <p className="text-xs font-semibold" style={{ color: mode === opt.id ? 'var(--accent)' : 'var(--text-2)' }}>{opt.label}</p>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>{opt.hint}</p>
                </button>
              ))}
            </div>
            {snapshotTooLarge && (
              <p className="text-[11px] mt-2" style={{ color: '#ef4444' }}>
                Snapshot update is limited to {MAX_SHARED_VIEW_RECORDS} projects. Narrow the current view or use a live scope.
              </p>
            )}
          </div>

          <div className="rounded-xl p-3" style={{ background: 'rgba(14,165,233,0.06)', border: '1px solid rgba(14,165,233,0.15)' }}>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>New scope summary</p>
            <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>{newScope}</p>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} className="btn-ghost text-sm px-4 py-2">Cancel</button>
            <button onClick={handleSave} disabled={saving || visibleCount <= 0 || (mode === 'snapshot' && snapshotTooLarge)} className="btn-primary flex items-center gap-2 text-sm px-4 py-2">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Update Link
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ManageSharesModal({ onClose, currentConfig = null, visibleCount = 0, visibleRecords = [] }) {
  const { showToast } = useToast()
  const [views,         setViews]         = useState([])
  const [loading,       setLoading]       = useState(true)
  const [selectedToken, setSelectedToken] = useState(null)   // viewer activity panel
  const [accesses,      setAccesses]      = useState([])
  const [loadingAcc,    setLoadingAcc]    = useState(false)
  const [savingTokens,  setSavingTokens]  = useState(() => new Set())  // PATCH in flight
  const [savedTokens,   setSavedTokens]   = useState(() => new Set())  // brief "Saved ✓"
  const [copiedToken,   setCopiedToken]   = useState(null)
  const [editingTitle,  setEditingTitle]  = useState(null)   // token whose title is in edit mode
  const [titleDraft,    setTitleDraft]    = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [scopeEditor,   setScopeEditor]   = useState(null)
  const [accessFilters, setAccessFilters] = useState({ q: '', event: '' })
  const [selectedAccessIds, setSelectedAccessIds] = useState([])
  const [deletingAccesses, setDeletingAccesses] = useState(false)

  useEffect(() => { loadViews() }, [])
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  async function loadViews() {
    setLoading(true)
    try { const r = await api.sharedViews.list('status'); setViews(r.views || []) } catch {}
    finally { setLoading(false) }
  }

  // Generic optimistic PATCH with rollback + "Saved ✓" flash
  async function patchView(token, patch, onRollback) {
    setSavingTokens(s => new Set(s).add(token))
    try {
      await api.sharedViews.update(token, patch)
      setSavedTokens(s => new Set(s).add(token))
      setTimeout(() => setSavedTokens(s => { const n = new Set(s); n.delete(token); return n }), 2200)
    } catch (e) {
      onRollback?.()
      showToast(e.message || 'Failed to save', 'error')
    } finally {
      setSavingTokens(s => { const n = new Set(s); n.delete(token); return n })
    }
  }

  async function toggleActive(view) {
    const next = !view.is_active
    setViews(vs => vs.map(v => v.token === view.token ? { ...v, is_active: next } : v))
    await patchView(
      view.token,
      { is_active: next },
      () => setViews(vs => vs.map(v => v.token === view.token ? { ...v, is_active: view.is_active } : v)),
    )
  }

  async function changeAccessMode(view, next) {
    if (view.access_mode === next || savingTokens.has(view.token)) return
    const prev = view.access_mode
    setViews(vs => vs.map(v => v.token === view.token ? { ...v, access_mode: next } : v))
    await patchView(
      view.token,
      { access_mode: next },
      () => setViews(vs => vs.map(v => v.token === view.token ? { ...v, access_mode: prev } : v)),
    )
  }

  async function saveScopeUpdate(view, patch) {
    const prev = { ...view }
    const nextView = {
      ...view,
      ...patch,
      is_dynamic: Array.isArray(patch.record_ids) && patch.record_ids.length === 1 && patch.record_ids[0] === '__dynamic__',
    }
    setViews(vs => vs.map(v => v.token === view.token ? nextView : v))
    await patchView(
      view.token,
      patch,
      () => setViews(vs => vs.map(v => v.token === view.token ? prev : v)),
    )
    showToast('Link scope updated', 'success')
  }

  async function saveTitle(view) {
    const newTitle = titleDraft.trim()
    setEditingTitle(null)
    if (newTitle === (view.title || '')) return
    const prev = view.title
    setViews(vs => vs.map(v => v.token === view.token ? { ...v, title: newTitle || null } : v))
    await patchView(
      view.token,
      { title: newTitle || '' },
      () => setViews(vs => vs.map(v => v.token === view.token ? { ...v, title: prev } : v)),
    )
  }

  async function deleteView(token) {
    const prev = views
    setViews(vs => vs.filter(v => v.token !== token))
    if (selectedToken === token) setSelectedToken(null)
    try { await api.sharedViews.delete(token); showToast('Link deleted', 'success') }
    catch (e) { setViews(prev); showToast(e.message || 'Failed', 'error') }
  }

  async function loadAccesses(token) {
    if (selectedToken === token) { setSelectedToken(null); return }
    setSelectedToken(token); setLoadingAcc(true)
    setAccessFilters({ q: '', event: '' })
    setSelectedAccessIds([])
    try { const r = await api.sharedViews.accesses(token); setAccesses(r.accesses || []) } catch {}
    finally { setLoadingAcc(false) }
  }

  function copyUrl(token) {
    navigator.clipboard.writeText(`${window.location.origin}/view/${token}`)
    setCopiedToken(token)
    setTimeout(() => setCopiedToken(t => t === token ? null : t), 2500)
  }

  const filteredAccesses = useMemo(() => {
    const q = (accessFilters.q || '').trim().toLowerCase()
    const event = accessFilters.event || ''
    return accesses.filter(a => {
      if (event && String(a.event_type || 'view') !== event) return false
      if (!q) return true
      const hay = [
        a.ip, a.city, a.region, a.country, a.device_label, a.os, a.browser,
        a.device_type, a.record_id, a.geo_source, a.isp, a.timezone,
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [accesses, accessFilters])

  const allFilteredSelected = filteredAccesses.length > 0 && filteredAccesses.every(a => selectedAccessIds.includes(a.id))

  function toggleAccessRow(id) {
    setSelectedAccessIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function toggleSelectAllFiltered() {
    const ids = filteredAccesses.map(a => a.id).filter(Boolean)
    if (!ids.length) return
    setSelectedAccessIds(prev => {
      const allSelected = ids.every(id => prev.includes(id))
      return allSelected ? prev.filter(id => !ids.includes(id)) : [...new Set([...prev, ...ids])]
    })
  }

  async function deleteSelectedAccessRows() {
    const ids = selectedAccessIds.filter(Boolean)
    if (!ids.length || !selectedToken) return
    setDeletingAccesses(true)
    try {
      await api.sharedViews.deleteAccesses(selectedToken, ids)
      setAccesses(prev => prev.filter(a => !ids.includes(a.id)))
      setSelectedAccessIds([])
      showToast(`Deleted ${ids.length} activity record${ids.length !== 1 ? 's' : ''}`, 'success')
    } catch (e) {
      showToast(e.message || 'Failed to delete activity', 'error')
    } finally {
      setDeletingAccesses(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(15,23,42,0.7)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.25)' }}>
              <Link2 size={15} style={{ color: '#0ea5e9' }} />
            </div>
            <div>
              <h2 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Manage Share Links</h2>
              {!loading && <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{views.length} link{views.length !== 1 ? 's' : ''}</p>}
            </div>
          </div>
          <button onClick={onClose} className="btn-icon p-1.5" style={{ color: 'var(--text-3)' }}><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          {loading && <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--text-3)' }} /></div>}
          {!loading && views.length === 0 && (
            <div className="text-center py-12">
              <Link2 size={24} className="mx-auto mb-3 opacity-30" style={{ color: 'var(--text-3)' }} />
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>No share links yet.</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Select records and click Share to create one.</p>
            </div>
          )}

          {views.map(v => {
            const expired     = isExpired(v.expires_at)
            const inactive    = !v.is_active
            const isSaving    = savingTokens.has(v.token)
            const justSaved   = savedTokens.has(v.token)
            const url         = `${window.location.origin}/view/${v.token}`
            const statusColor = inactive ? '#ef4444' : expired ? '#f59e0b' : '#10b981'

            return (
              <div key={v.token} className="rounded-2xl overflow-hidden"
                style={{ border: '1px solid var(--border)', background: 'var(--card-bg)', opacity: (expired || inactive) ? 0.82 : 1 }}>

                {/* Top accent bar — red=disabled, amber=expired, green=active */}
                <div className="h-1 w-full" style={{ background: statusColor }} />

                <div className="p-4 space-y-3">
                  {/* ── Row 1: Title + badges ── */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {editingTitle === v.token ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            autoFocus
                            className="input-field flex-1 text-sm font-semibold py-1"
                            value={titleDraft}
                            onChange={e => setTitleDraft(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveTitle(v); if (e.key === 'Escape') setEditingTitle(null) }}
                            onBlur={() => saveTitle(v)}
                            placeholder="Add a page title…"
                            maxLength={200}
                          />
                          <button onClick={() => saveTitle(v)}
                            className="p-1.5 rounded-lg flex-shrink-0"
                            style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>
                            <Check size={13} />
                          </button>
                          <button onClick={() => setEditingTitle(null)}
                            className="p-1.5 rounded-lg flex-shrink-0"
                            style={{ color: 'var(--text-3)' }}>
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <button
                          className="group flex items-center gap-1.5 text-left w-full"
                          onClick={() => { setEditingTitle(v.token); setTitleDraft(v.title || '') }}
                          title="Click to edit page title">
                          <span className="text-sm font-semibold" style={{ color: v.title ? 'var(--text-1)' : 'var(--text-3)' }}>
                            {v.title || 'Untitled — click to add title'}
                          </span>
                          <Pencil size={10} className="flex-shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: 'var(--text-3)' }} />
                        </button>
                      )}
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                        This title is visible to the viewer as the page heading
                      </p>
                      {v.is_dynamic && (
                        <p className="text-[10px] mt-1" style={{ color: '#10b981' }}>
                          Live link: records are re-fetched on every open using the saved view filters.
                        </p>
                      )}
                      <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>
                        {summarizeShareScope(v)}
                      </p>
                    </div>

                    {/* Right badges */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {v.is_dynamic && (
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md"
                          style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          LIVE
                        </span>
                      )}
                      {inactive && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md"
                          style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>DISABLED</span>
                      )}
                      {expired && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md"
                          style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>EXPIRED</span>
                      )}
                      <span className="flex items-center gap-1 text-[11px] font-semibold"
                        style={{ color: v.access_count > 0 ? '#10b981' : 'var(--text-3)' }}>
                        <Eye size={11} /> {v.access_count}
                      </span>
                      {v.last_accessed_at && (
                        <span className="text-[10px] hidden sm:block" style={{ color: '#10b981' }}>
                          Last seen {fmtDate(v.last_accessed_at)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ── Row 2: Full URL ── */}
                  <div className="flex items-center gap-2 rounded-xl px-3 py-2"
                    style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                    <Link2 size={11} className="flex-shrink-0" style={{ color: 'var(--text-3)' }} />
                    <span className="flex-1 text-[11px] font-mono truncate" style={{ color: 'var(--text-2)' }}>{url}</span>
                    <button onClick={() => copyUrl(v.token)}
                      className="flex-shrink-0 flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg transition-all"
                      style={{
                        background: copiedToken === v.token ? 'rgba(16,185,129,0.12)' : 'var(--card-bg)',
                        color: copiedToken === v.token ? '#10b981' : 'var(--accent)',
                        border: '1px solid var(--border)',
                      }}>
                      {copiedToken === v.token ? <><CheckCheck size={9} /> Copied!</> : <><Copy size={9} /> Copy</>}
                    </button>
                    <a href={url} target="_blank" rel="noopener noreferrer"
                      className="flex-shrink-0 p-1.5 rounded-lg transition-colors btn-icon"
                      style={{ color: 'var(--text-3)' }} title="Open in new tab">
                      <ExternalLink size={11} />
                    </a>
                  </div>

                  {/* ── Row 3: Access mode + controls ── */}
                  <div className="flex items-center justify-between gap-3 flex-wrap">

                    {/* Access mode selector */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Access</span>
                      <div className="flex items-center gap-0.5 rounded-xl p-0.5"
                        style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                        {[
                          { id: 'read',  Icon: Eye,    label: 'View only' },
                          { id: 'edit',  Icon: Pencil, label: 'Can edit' },
                        ].map(({ id, Icon, label }) => {
                          const active = v.access_mode === id
                          return (
                            <button key={id}
                              onClick={() => changeAccessMode(v, id)}
                              disabled={isSaving}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
                              style={{
                                background: active
                                  ? (id === 'edit' ? 'rgba(59,130,246,0.14)' : 'var(--card-bg)')
                                  : 'transparent',
                                color: active
                                  ? (id === 'edit' ? '#2563eb' : 'var(--text-1)')
                                  : 'var(--text-3)',
                                boxShadow: active ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                              }}>
                              {isSaving && active
                                ? <Loader2 size={10} className="animate-spin" />
                                : <Icon size={10} />
                              }
                              {label}
                            </button>
                          )
                        })}
                      </div>
                      {/* "Saved ✓" flash */}
                      {justSaved && (
                        <span className="flex items-center gap-0.5 text-[10px] font-semibold" style={{ color: '#10b981' }}>
                          <Check size={10} /> Saved
                        </span>
                      )}
                    </div>

                    {/* Right actions */}
                    <div className="flex items-center gap-1">
                      {v.expires_at && (
                        <span className="text-[10px] mr-1 hidden sm:block" style={{ color: expired ? '#f59e0b' : 'var(--text-3)' }}>
                          <Clock size={9} className="inline mr-0.5" />
                          {expired ? 'Expired' : 'Expires'} {fmtDate(v.expires_at)}
                        </span>
                      )}
                      {/* Viewer activity toggle */}
                      <button onClick={() => loadAccesses(v.token)}
                        className="btn-icon p-1.5"
                        title="Viewer activity"
                        style={{ color: selectedToken === v.token ? 'var(--accent)' : 'var(--text-3)' }}>
                        <Activity size={13} />
                      </button>
                      {/* Open explicit scope editor */}
                      <button
                        onClick={() => setScopeEditor(v)}
                        disabled={isSaving || !currentConfig}
                        className="btn-icon p-1.5"
                        title="Edit which projects this link should include"
                        style={{ color: currentConfig ? 'var(--accent)' : 'var(--text-3)', opacity: currentConfig ? 1 : 0.45 }}>
                        <RefreshCw size={13} />
                      </button>
                      {/* Enable / disable */}
                      <button onClick={() => toggleActive(v)}
                        className="btn-icon p-1.5"
                        title={v.is_active ? 'Disable this link' : 'Enable this link'}
                        style={{ color: v.is_active ? '#10b981' : 'var(--text-3)' }}>
                        {v.is_active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                      </button>
                      {/* Delete */}
                      <button onClick={() => setConfirmDelete(v.token)}
                        className="btn-icon p-1.5"
                        title="Delete link"
                        style={{ color: 'rgba(239,68,68,0.55)' }}
                        onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                        onMouseLeave={e => e.currentTarget.style.color = 'rgba(239,68,68,0.55)'}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* ── Viewer activity panel ── */}
                {selectedToken === v.token && (
                  <div className="border-t" style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}>
                    <div className="px-4 py-2.5 flex items-center justify-between"
                      style={{ borderBottom: accesses.length > 0 ? '1px solid var(--border)' : 'none' }}>
                      <span className="text-[11px] font-bold flex items-center gap-1.5" style={{ color: 'var(--text-2)' }}>
                        <Activity size={11} /> Viewer Activity
                        {!loadingAcc && <span className="font-normal" style={{ color: 'var(--text-3)' }}>— {accesses.length} access{accesses.length !== 1 ? 'es' : ''}</span>}
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>IP · Device · Location</span>
                    </div>
                    {loadingAcc
                      ? <div className="flex justify-center py-6"><Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-3)' }} /></div>
                      : accesses.length === 0
                        ? <p className="text-xs text-center py-5" style={{ color: 'var(--text-3)' }}>No accesses recorded yet</p>
                        : (
                          <>
                            <div className="px-4 py-2.5 space-y-2" style={{ borderBottom: '1px solid var(--border)' }}>
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-xs font-bold" style={{ color: 'var(--text-2)' }}>
                                  Events — {filteredAccesses.length}/{accesses.length} entries
                                </div>
                                <div className="flex items-center gap-2">
                                  <button onClick={toggleSelectAllFiltered} className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg"
                                    style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                                    {allFilteredSelected ? <CheckSquare size={12} /> : <Square size={12} />}
                                    {allFilteredSelected ? 'Unselect all' : 'Select all'}
                                  </button>
                                  <button onClick={deleteSelectedAccessRows} disabled={!selectedAccessIds.length || deletingAccesses}
                                    className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg"
                                    style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#ef4444', opacity: (!selectedAccessIds.length || deletingAccesses) ? 0.5 : 1 }}>
                                    {deletingAccesses ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                    Delete selected
                                  </button>
                                </div>
                              </div>
                              <div className="flex flex-col sm:flex-row gap-2">
                                <div className="relative flex-1">
                                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
                                  <input
                                    value={accessFilters.q}
                                    onChange={e => setAccessFilters(prev => ({ ...prev, q: e.target.value }))}
                                    placeholder="Filter by IP, location, device, browser…"
                                    className="w-full rounded-lg pl-7 pr-2 py-1.5 text-[11px]"
                                    style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
                                  />
                                </div>
                                <div className="relative">
                                  <Filter size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
                                  <select
                                    value={accessFilters.event}
                                    onChange={e => setAccessFilters(prev => ({ ...prev, event: e.target.value }))}
                                    className="rounded-lg pl-7 pr-7 py-1.5 text-[11px]"
                                    style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', color: 'var(--text-1)' }}>
                                    <option value="">All events</option>
                                    <option value="view">View</option>
                                    <option value="edit">Edit</option>
                                  </select>
                                </div>
                              </div>
                            </div>
                            <div className="max-h-52 overflow-y-auto divide-y" style={{ borderColor: 'var(--border)' }}>
                            {filteredAccesses.map((a, i) => (
                              <div key={a.id || i} className="px-4 py-2.5 flex items-start gap-3">
                                <button onClick={() => toggleAccessRow(a.id)} className="mt-0.5 flex-shrink-0" style={{ color: selectedAccessIds.includes(a.id) ? 'var(--accent)' : 'var(--text-3)' }}>
                                  {selectedAccessIds.includes(a.id) ? <CheckSquare size={13} /> : <Square size={13} />}
                                </button>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                                      style={{ background: a.event_type === 'edit' ? 'rgba(59,130,246,0.08)' : 'rgba(16,185,129,0.08)', color: a.event_type === 'edit' ? '#2563eb' : '#059669' }}>
                                      {String(a.event_type || 'view').toUpperCase()}
                                    </span>
                                    <span className="text-[11px] font-mono font-semibold" style={{ color: 'var(--text-1)' }}>{a.ip || '—'}</span>
                                    {(a.city || a.region || a.country) && (
                                      <span className="text-[11px]" style={{ color: 'var(--text-2)' }}>
                                        {[a.city, a.region, a.country].filter(Boolean).join(', ')}
                                      </span>
                                    )}
                                    {a.geo_source && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                                        style={{ background: a.geo_source === 'browser' ? 'rgba(16,185,129,0.08)' : 'rgba(148,163,184,0.1)', color: a.geo_source === 'browser' ? '#059669' : 'var(--text-3)' }}>
                                        {a.geo_source === 'browser' ? 'GPS' : 'IP geo'}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                    {a.device_label && <span className="text-[10px] font-medium" style={{ color: 'var(--text-2)' }}>{a.device_label}</span>}
                                    {a.os && <span className="text-[10px] flex items-center gap-0.5" style={{ color: 'var(--text-3)' }}><Monitor size={8} /> {a.os}</span>}
                                    {a.browser && <span className="text-[10px] flex items-center gap-0.5" style={{ color: 'var(--text-3)' }}><Globe size={8} /> {a.browser}</span>}
                                    {a.device_type && <span className="text-[10px] flex items-center gap-0.5" style={{ color: 'var(--text-3)' }}><Smartphone size={8} /> {a.device_type}</span>}
                                    {a.isp && <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{a.isp}</span>}
                                    {a.timezone && <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{a.timezone}</span>}
                                  </div>
                                </div>
                                <span className="text-[10px] flex-shrink-0 whitespace-nowrap" style={{ color: 'var(--text-3)' }}>{fmtDate(a.accessed_at)}</span>
                              </div>
                            ))}
                          </div>
                          </>
                        )
                    }
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {scopeEditor && (
          <ScopeEditorModal
            view={scopeEditor}
            currentConfig={currentConfig}
            visibleRecords={visibleRecords}
            onClose={() => setScopeEditor(null)}
            onSave={patch => saveScopeUpdate(scopeEditor, patch)}
          />
        )}
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
  const { dark } = useTheme()

  // ── Core data ──────────────────────────────────────────────────────────────
  const [records,     setRecords]     = useState([])
  const [statusPicklists, setStatusPicklists] = useState({})
  const [statusScopeOptions, setStatusScopeOptions] = useState({ clients: [], projects: [], projects_by_client: {} })
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
  const [allExpanded,   setAllExpanded]   = useState(false)  // global expand/collapse for cards
  const [selectedIds,   setSelectedIds]   = useState(new Set())
  const [modal,         setModal]         = useState(null)
  const [saving,        setSaving]        = useState(false)
  const [deletingId,    setDeletingId]    = useState(null)
  const [updatingIds,   setUpdatingIds]   = useState(new Set())  // kanban DnD in-flight
  const [detailRecord,      setDetailRecord]      = useState(null)
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
  // silent=true → background refresh; no spinner, no error banner reset
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) { setLoading(true); setError(null) }
    try {
      const res = await api.status.list()
      setRecords(res.records || [])
      if (!silent) setPendingStatusById({})
      api.status.picklists.get()
        .then(picklists => setStatusPicklists(picklists || {}))
        .catch(() => {})
      api.status.options()
        .then((opts) => setStatusScopeOptions(opts || { clients: [], projects: [], projects_by_client: {} }))
        .catch(() => {})
    }
    catch (e) { if (!silent) setError(e.message || 'Failed to load') }
    finally { if (!silent) setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  // ── Real-time SSE sync (zero-latency push from backend) ───────────────────
  // Backend fires a "changed" event whenever any status record is mutated —
  // whether the mutation came through this app OR directly in Teable.
  // On event we bust the local cache then silently reload so the UI updates
  // without any spinner / flash.
  useEffect(() => {
    const token = getAuthToken()
    if (!token) return

    let es = null
    let retryTimer = null
    let retryDelay = 3000  // start at 3 s, cap at 30 s
    let alive = true

    // IMPORTANT: use API_BASE_URL (absolute) because EventSource doesn't
    // go through the request() helper.  In production, VITE_API_URL is set
    // to the HuggingFace Space URL so we must prepend it explicitly.
    const streamUrl = `${API_BASE_URL}/api/status/stream?token=${encodeURIComponent(token)}`

    function silentReload() {
      // Bust both client-side 45 s cache AND ensure backend Valkey is bypassed
      // by appending a unique timestamp so the cache key never matches.
      clientCacheBust('/api/status')
      load({ silent: true })
    }

    function connect() {
      if (!alive) return
      try {
        es = new EventSource(streamUrl)

        es.addEventListener('connected', () => {
          retryDelay = 3000  // reset backoff on successful connection
        })

        es.addEventListener('changed', () => {
          silentReload()
        })

        es.onerror = () => {
          es?.close()
          es = null
          if (!alive) return
          // Reconnect with exponential backoff (3 s → 6 s → 12 s … max 30 s)
          retryTimer = setTimeout(() => {
            retryDelay = Math.min(retryDelay * 2, 30000)
            connect()
          }, retryDelay)
        }
      } catch {
        // EventSource not supported or network error — fall through to polling only
      }
    }

    connect()

    // Fallback polling — 30 s intervals in case SSE is blocked by proxy/CDN.
    // Also acts as a catch-all for missed events.
    const pollTimer = setInterval(silentReload, 30000)

    return () => {
      alive = false
      es?.close()
      clearTimeout(retryTimer)
      clearInterval(pollTimer)
    }
  }, [load])  // load is stable (useCallback with no deps)

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
  const statusCounts = useMemo(
    () => statusOptions.map(status => ({
      status,
      count: recordsForView.filter(r => (r.fields?.['Status'] || 'Not started') === status).length,
    })),
    [recordsForView, statusOptions]
  )
  const topStatusSignal = useMemo(() => {
    const activeCounts = statusCounts.filter(item => item.count > 0)
    if (!activeCounts.length) return null
    return [...activeCounts].sort((a, b) => b.count - a.count)[0]
  }, [statusCounts])
  const executiveVars = dark ? EXECUTIVE_VARS_DARK : EXECUTIVE_VARS_LIGHT
  const boardVars = useMemo(() => ({
    ...executiveVars,
    '--accent': theme.accent,
    '--accent-dim': theme.accentDim,
    '--accent-soft': theme.accentSoft,
  }), [theme, executiveVars])

  function toggleSelect(id) {
    setSelectedIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function selectAll() { setSelectedIds(new Set(filtered.map(r => r.id))) }
  function clearSelection() { setSelectedIds(new Set()) }
  // Toggling one card expands/collapses ALL cards simultaneously
  function toggleExpandAll() { setAllExpanded(v => !v) }

  // ── Share view — opens modal with all visible records + current view config ─
  function shareViewUrl() {
    if (filtered.length === 0) { showToast('No records visible to share.', 'error'); return }
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
    try {
      const { attachments, ...payload } = form
      const created = await api.status.create(payload)
      if (created?.id) {
        setRecords((current) => [created, ...current.filter((item) => item.id !== created.id)])
      }
      clientCacheBust('/api/status')
      showToast('Created. Any active shared status links will reflect it automatically.', 'success')
      setModal(null)
    }
    catch (e) { showToast(e.message || 'Failed', 'error') }
    finally { setSaving(false) }
  }
  async function handleEdit(form) {
    if (!modal?.id) return
    setSaving(true)
    try {
      const { attachments, ...payload } = form
      const updated = await api.status.update(modal.id, payload)
      if (updated?.id || updated?.fields) {
        setRecords((current) => current.map((record) => {
          if (record.id !== modal.id) return record
          return updated?.fields ? { ...record, ...updated, fields: { ...(record.fields || {}), ...updated.fields } } : record
        }))
      }
      clientCacheBust('/api/status')
      showToast('Saved. Any active shared status links will use the latest Teable data.', 'success')
      setModal(null)
    }
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
    allExpanded,   // ← include card expansion state so shared view matches
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
        <div
          className="rounded-[30px] border p-4 sm:p-5 space-y-5"
          style={{
            background: dark
              ? 'radial-gradient(circle at top left, rgba(125,149,255,0.14), transparent 24%), linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.015) 100%)'
              : 'radial-gradient(circle at top left, rgba(75,103,255,0.10), transparent 24%), linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(246,249,255,0.94) 100%)',
            borderColor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)',
            boxShadow: dark ? '0 24px 60px rgba(0,0,0,0.26)' : '0 24px 60px rgba(15,23,42,0.08)',
          }}
        >
          <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-12 h-12 rounded-[18px] flex items-center justify-center flex-shrink-0"
                style={{ background: dark ? 'rgba(125,149,255,0.16)' : 'rgba(75,103,255,0.10)', border: dark ? '1px solid rgba(125,149,255,0.24)' : '1px solid rgba(75,103,255,0.14)', boxShadow: dark ? 'inset 0 1px 0 rgba(255,255,255,0.06)' : 'inset 0 1px 0 rgba(255,255,255,0.8)' }}>
                <Activity size={19} style={{ color: 'var(--accent)' }} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] mb-2" style={{ color: 'var(--accent)' }}>
                  Portfolio command board
                </p>
                <h1 className="text-[32px] sm:text-[36px] font-semibold leading-[0.95] tracking-[-0.04em]" style={{ color: 'var(--text-1)' }}>
                  Status Board
                </h1>
                <p className="text-sm mt-3 leading-6 max-w-2xl" style={{ color: 'var(--text-3)' }}>
                  {loading
                    ? 'Loading current status distribution and project signals…'
                    : error
                      ? 'Status sync unavailable right now'
                      : `Track delivery momentum, blockers, and client-facing project movement across ${records.length} projects and ${allClients.length} clients.`}
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
                      <button
                        type="button"
                        onClick={toggleExpandAll}
                        className="rounded-2xl px-3 py-2 flex items-center gap-2 min-w-[170px] justify-between"
                        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
                        title={allExpanded ? 'Collapse all cards' : 'Expand all cards'}
                      >
                        <span className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--text-3)' }}>
                          Details
                        </span>
                        <span className="flex items-center gap-1.5 text-sm font-semibold">
                          {allExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          {allExpanded ? 'Collapse all' : 'Expand all'}
                        </span>
                      </button>
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

          {!loading && !error && records.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-[24px] p-4" style={{ background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(245,247,251,0.86)', border: dark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.06)' }}>
                <p className="text-[11px] uppercase tracking-[0.16em]" style={{ color: 'var(--text-3)' }}>All tracked</p>
                <p className="text-2xl font-semibold mt-2 tabular-nums" style={{ color: 'var(--text-1)' }}>{records.length}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{allClients.length} distinct clients</p>
              </div>
              <div className="rounded-[24px] p-4" style={{ background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(245,247,251,0.86)', border: dark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.06)' }}>
                <p className="text-[11px] uppercase tracking-[0.16em]" style={{ color: 'var(--text-3)' }}>Visible now</p>
                <p className="text-2xl font-semibold mt-2 tabular-nums" style={{ color: 'var(--text-1)' }}>{filtered.length}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{advancedConditions.length ? `${advancedConditions.length} advanced rule${advancedConditions.length !== 1 ? 's' : ''}` : 'No advanced rules'}</p>
              </div>
              <div className="rounded-[24px] p-4" style={{ background: dark ? 'rgba(132,226,84,0.08)' : 'rgba(22,145,95,0.08)', border: dark ? '1px solid rgba(132,226,84,0.12)' : '1px solid rgba(22,145,95,0.12)' }}>
                <p className="text-[11px] uppercase tracking-[0.16em]" style={{ color: 'var(--text-3)' }}>Main signal</p>
                <p className="text-lg font-semibold mt-2" style={{ color: 'var(--fin-positive)' }}>{topStatusSignal?.status || 'No active statuses'}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{topStatusSignal ? `${topStatusSignal.count} project${topStatusSignal.count === 1 ? '' : 's'} currently in this state` : 'Waiting for live status records'}</p>
              </div>
              <div className="rounded-[24px] p-4" style={{ background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(245,247,251,0.86)', border: dark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.06)' }}>
                <p className="text-[11px] uppercase tracking-[0.16em]" style={{ color: 'var(--text-3)' }}>Board mode</p>
                <p className="text-lg font-semibold mt-2" style={{ color: 'var(--text-1)' }}>
                  {viewType === 'card' ? 'Client cards' : viewType === 'list' ? 'Operational list' : 'Kanban board'}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                  {viewType === 'card'
                    ? `${cardGroupBy} grouping · ${cardRecordSort.replace('-', ' ')}`
                    : viewType === 'list'
                      ? `${listColumns.length} visible column${listColumns.length === 1 ? '' : 's'}`
                      : `${boardGroupBy} grouping${boardIsDraggable ? ' · drag enabled' : ' · drag disabled'}`}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Status Dashboard ── */}
        {!loading && records.length > 0 && showDashboard && (
          <StatusDashboard records={records} statusOptions={statusOptions} filterStatus={filterStatus} onFilterStatus={setFilterStatus} />
        )}

        {/* ── Filter bar ── */}
        <div className="rounded-[24px] p-3 sm:p-4" style={{ background: dark ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.78)', border: dark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(15,23,42,0.06)' }}>
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
        <p className="text-[11px] mt-2" style={{ color: 'var(--text-3)' }}>
          Search by project, client, headline, or detail. Use advanced filters when you need a narrower operational slice.
        </p>
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
          <EmptyState
            icon={<ClipboardList size={24} />}
            title="No status updates yet"
            subtitle="Add live project status entries to track what's happening across the portfolio."
            action={isEditor && (
              <button className="btn-primary" onClick={() => setModal('new')}>
                <Plus size={13} />Add first status
              </button>
            )}
          />
        )}

        {/* ── No results ── */}
        {!loading && !error && records.length > 0 && filtered.length === 0 && (
          <EmptyState
            icon={<ClipboardList size={22} />}
            title="No entries match your filter"
            subtitle="Try adjusting your search, client, or status filters."
            action={
              <button onClick={() => { setSearch(''); setFilterClient(''); setFilterStatus('') }} className="btn-ghost">
                Clear filters
              </button>
            }
            compact
          />
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
                        selected={selectedIds.has(r.id)}
                        onSelect={toggleSelect}
                        expanded={allExpanded}
                        onToggle={toggleExpandAll}
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
          <div className="rounded-[24px] overflow-hidden" style={{ border: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(15,23,42,0.08)', background: dark ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.94)', boxShadow: dark ? '0 18px 40px rgba(0,0,0,0.24)' : '0 18px 40px rgba(15,23,42,0.08)' }}>
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
          onClose={() => setDetailRecord(null)}
          onEdit={() => { setModal(detailRecord); setDetailRecord(null) }}
          onDelete={() => { handleDelete(detailRecord); setDetailRecord(null) }}
          isEditor={isEditor}
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
          options={statusScopeOptions}
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
        <ManageSharesModal
          onClose={() => setManageModal(false)}
          currentConfig={currentConfig}
          visibleCount={filtered.length}
          visibleRecords={filtered}
        />
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
