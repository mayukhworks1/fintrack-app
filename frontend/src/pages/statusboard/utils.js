// Extracted from StatusBoard.jsx — pure helpers.

export const STATUS_OPTIONS_FALLBACK = ['In progress', 'Input Pending', 'On Hold', 'Not started', 'Completed']

export const THEME_PRESETS = {
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

export const STATUS_CONFIG = {
  'Completed':     { color: '#10b981', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.35)', dot: '#10b981', light: '#dcfce7' },
  'In progress':   { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.35)', dot: '#3b82f6', light: '#dbeafe' },
  'On Hold':       { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.35)', dot: '#f59e0b', light: '#fef3c7' },
  'Input Pending': { color: '#f97316', bg: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.35)', dot: '#f97316', light: '#ffedd5' },
  'Not started':   { color: '#94a3b8', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.30)', dot: '#94a3b8', light: '#f1f5f9' },
}

export function statusStyle(s) {
  return STATUS_CONFIG[s] || { color: '#94a3b8', bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.2)', dot: '#94a3b8', light: '#f1f5f9' }
}

// ── List view columns ─────────────────────────────────────────────────────────

export const ALL_COLUMNS = ['Client', 'Project', 'Status', 'Short Status', 'Detailed Status', 'Attachments', 'Last Modified']

export const DEFAULT_COLUMNS = ['Client', 'Project', 'Status', 'Short Status']

export const LIST_COLUMN_META = {
  'Client': { label: 'Client', track: 'minmax(150px, 1.05fr)', minWidth: 150 },
  'Project': { label: 'Project', track: 'minmax(240px, 1.6fr)', minWidth: 240 },
  'Status': { label: 'Status', track: '144px', minWidth: 144 },
  'Short Status': { label: 'Headline', track: 'minmax(260px, 1.55fr)', minWidth: 260 },
  'Detailed Status': { label: 'Detail', track: 'minmax(320px, 1.75fr)', minWidth: 320 },
  'Attachments': { label: 'Files', track: '120px', minWidth: 120 },
  'Last Modified': { label: 'Modified', track: '112px', minWidth: 112 },
}

export function getListLayout(columns, isEditor) {
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

export const PALETTE = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#ec4899','#0ea5e9','#eab308','#14b8a6','#f97316','#6366f1','#84cc16']

export const _clientMap = {}

export function clientColor(name) {
  if (!_clientMap[name]) { _clientMap[name] = PALETTE[Object.keys(_clientMap).length % PALETTE.length] }
  return _clientMap[name]
}

export function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
  return `rgba(${r},${g},${b},${a})`
}

export function parseAttachments(value) {
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

export function sanitizeAttachmentsForSave(value) {
  return parseAttachments(value).map((item) => {
    if (!item || typeof item !== 'object') return item
    const next = {}
    for (const key of ['id', 'name', 'filename', 'path', 'token', 'size', 'mimetype', 'mimeType', 'type', 'url', 'presignedUrl']) {
      if (item[key] != null) next[key] = item[key]
    }
    return next
  })
}

// ── Expiry presets ─────────────────────────────────────────────────────────────

export const EXPIRY_OPTS = [
  { label: 'Never',    value: 0   },
  { label: '1 hour',   value: 1   },
  { label: '24 hours', value: 24  },
  { label: '3 days',   value: 72  },
  { label: '7 days',   value: 168 },
  { label: '30 days',  value: 720 },
]

export const MAX_SHARED_VIEW_RECORDS = 50

export const STATUS_FILTER_FIELDS = [
  { key: 'Client', label: 'Client', type: 'text' },
  { key: 'Project', label: 'Project', type: 'text' },
  { key: 'Status', label: 'Status', type: 'text' },
  { key: 'Short Status', label: 'Headline', type: 'text' },
  { key: 'Current Status (Detailed)', label: 'Detail', type: 'text' },
  { key: 'lastModifiedTime', label: 'Last Modified', type: 'date' },
]

export const BOARD_GROUP_OPTIONS = [
  { value: 'Status', label: 'Status' },
  { value: 'Client', label: 'Client' },
]

export const CARD_GROUP_OPTIONS = [
  { value: 'Client', label: 'Client' },
  { value: 'Status', label: 'Status' },
]

export const CARD_GROUP_SORT_OPTIONS = [
  { value: 'count-desc', label: 'Most projects first' },
  { value: 'count-asc', label: 'Least projects first' },
  { value: 'name-asc', label: 'Group A-Z' },
  { value: 'name-desc', label: 'Group Z-A' },
]

export const CARD_RECORD_SORT_OPTIONS = [
  { value: 'project-asc', label: 'Project A-Z' },
  { value: 'project-desc', label: 'Project Z-A' },
  { value: 'modified-desc', label: 'Recently updated' },
  { value: 'modified-asc', label: 'Oldest updated' },
  { value: 'status-asc', label: 'Status A-Z' },
]

export const EXECUTIVE_VARS_DARK = {
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

export const EXECUTIVE_VARS_LIGHT = {
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

export function fmtDate(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' }) } catch { return iso }
}

export function fmtShortDate(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('en-IN', { day:'numeric', month:'short' }) } catch { return iso }
}

export function isExpired(iso) { return iso ? new Date(iso) < new Date() : false }

export function resolveTheme(themeId) { return THEME_PRESETS[themeId] || THEME_PRESETS.cobalt }

// ── View config helpers ───────────────────────────────────────────────────────

export function encodeViewConfig(cfg) {
  try { return btoa(JSON.stringify(cfg)) } catch { return '' }
}

export function decodeViewConfig(s) {
  try { return JSON.parse(atob(s)) } catch { return null }
}

export function getViewConfigFromUrl() {
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

export function summarizeShareScope(view, fallbackCount = 0) {
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
