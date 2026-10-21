// Extracted from StatusBoard.jsx — pure helpers.
export { hexToRgba } from '../../utils/color'
export { EXPIRY_OPTS, isExpired } from '../../utils/dates'

export const STATUS_OPTIONS_FALLBACK = ['In progress', 'Input Pending', 'On Hold', 'Not started', 'Completed']

export const THEME_PRESETS = {
  cobalt: {
    id: 'cobalt',
    label: 'Cobalt',
    accent: '#2563eb',
    accentDim: 'rgba(37,99,235,0.12)',
    accentSoft: 'rgba(37,99,235,0.24)',
    accentGradient: '#2563eb',
  },
  emerald: {
    id: 'emerald',
    label: 'Emerald',
    accent: '#059669',
    accentDim: 'rgba(5,150,105,0.12)',
    accentSoft: 'rgba(5,150,105,0.24)',
    accentGradient: '#059669',
  },
  amber: {
    id: 'amber',
    label: 'Amber',
    accent: '#d97706',
    accentDim: 'rgba(217,119,6,0.12)',
    accentSoft: 'rgba(217,119,6,0.24)',
    accentGradient: '#f59e0b',
  },
  rose: {
    id: 'rose',
    label: 'Rose',
    accent: '#e11d48',
    accentDim: 'rgba(225,29,72,0.12)',
    accentSoft: 'rgba(225,29,72,0.24)',
    accentGradient: '#f43f5e',
  },
  slate: {
    id: 'slate',
    label: 'Slate',
    accent: '#475569',
    accentDim: 'rgba(71,85,105,0.12)',
    accentSoft: 'rgba(71,85,105,0.24)',
    accentGradient: '#64748b',
  },
}

// Status tones map onto the palette's semantic tokens, so the chips keep AA
// contrast and follow the palette in both modes.
const STATUS_CONFIG = {
  'Completed':     { color: 'var(--fin-positive)', bg: 'var(--fin-pos-bg)', border: 'var(--fin-pos-border)', dot: 'var(--fin-positive)', light: 'var(--fin-pos-bg)' },
  'In progress':   { color: 'var(--accent-ink)', bg: 'var(--accent-dim)', border: 'var(--accent-soft)', dot: 'var(--accent)', light: 'var(--accent-dim)' },
  'On Hold':       { color: 'var(--fin-warning)', bg: 'var(--fin-warn-bg)', border: 'var(--fin-warn-border)', dot: 'var(--fin-warning)', light: 'var(--fin-warn-bg)' },
  'Input Pending': { color: 'color-mix(in srgb, var(--fin-warning) 60%, var(--fin-negative))', bg: 'color-mix(in srgb, color-mix(in srgb, var(--fin-warning) 60%, var(--fin-negative)) 12%, transparent)', border: 'color-mix(in srgb, color-mix(in srgb, var(--fin-warning) 60%, var(--fin-negative)) 35%, transparent)', dot: 'color-mix(in srgb, var(--fin-warning) 60%, var(--fin-negative))', light: 'color-mix(in srgb, color-mix(in srgb, var(--fin-warning) 60%, var(--fin-negative)) 12%, transparent)' },
  'Not started':   { color: 'var(--text-3)', bg: 'color-mix(in srgb, var(--text-3) 10%, transparent)', border: 'color-mix(in srgb, var(--text-3) 30%, transparent)', dot: 'var(--text-3)', light: 'var(--bg-2)' },
}

export function statusStyle(s) {
  return STATUS_CONFIG[s] || { color: 'var(--text-3)', bg: 'color-mix(in srgb, var(--text-3) 8%, transparent)', border: 'color-mix(in srgb, var(--text-3) 20%, transparent)', dot: 'var(--text-3)', light: 'var(--bg-2)' }
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

// Clients are told apart by name, not by hue: one neutral ink for every
// client keeps colour free to mean status (paid, overdue, at risk).
export function clientColor() {
  return 'var(--text-2)'
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

export function fmtDate(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' }) } catch { return iso }
}

export function fmtShortDate(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('en-IN', { day:'numeric', month:'short' }) } catch { return iso }
}

export function resolveTheme(themeId) { return THEME_PRESETS[themeId] || THEME_PRESETS.cobalt }

// ── View config helpers ───────────────────────────────────────────────────────

export function encodeViewConfig(cfg) {
  try { return btoa(JSON.stringify(cfg)) } catch { return '' }
}

function decodeViewConfig(s) {
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
    // Saved links store the rules as filterConditions; the board calls them advancedConditions.
    const rules = [vc.filterConditions, vc.advancedConditions].flatMap(list => (Array.isArray(list) ? list : []))
      .filter(c => c?.field && c?.op && (['is_empty', 'is_not_empty'].includes(c.op) || (c.value ?? '') !== '')).length
    if (rules) parts.push(`${rules} advanced rule${rules === 1 ? '' : 's'}`)
  } else {
    const count = Array.isArray(view?.record_ids) ? view.record_ids.length : fallbackCount
    parts.push(`Snapshot · ${count} project${count === 1 ? '' : 's'}`)
  }
  return parts.join(' · ')
}
