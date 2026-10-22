// Extracted from AdminDashboard.jsx — pure helpers + admin data fetch/export.
import { api } from '../../services/api'
import { downloadBlob } from '../../utils/download'

export { ts } from '../../utils/dates'

// ── Module-level tab cache (TTL = 45s, stale-while-revalidate) ───────────────
const _tabCache = new Map() // key → { data, ts }
const TAB_CACHE_TTL = 45_000

export function cacheGet(key) {
  const entry = _tabCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > TAB_CACHE_TTL) return null
  return entry.data
}

export function cacheSet(key, data) { _tabCache.set(key, { data, ts: Date.now() }) }

// ── Tiny helpers ──────────────────────────────────────────────────────────────

export function fmt(n) {
  if (n == null) return '—'
  if (typeof n === 'number') return n.toLocaleString()
  return String(n)
}

export function relTime(v) {
  if (!v) return '—'
  try {
    const diff = Date.now() - new Date(v).getTime()
    if (diff < 60000)    return `${Math.round(diff / 1000)}s ago`
    if (diff < 3600000)  return `${Math.round(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`
    return `${Math.round(diff / 86400000)}d ago`
  } catch { return v }
}

export async function exportAdminDataset({
  pageKey,
  title,
  format,
  columns,
  rows,
  filters = {},
  metadata = {},
}) {
  const res = await api.insights.export({
    page_key: pageKey,
    source_key: `admin:${pageKey}`,
    title,
    export_format: format,
    columns: columns.map((col) => col.label),
    rows: rows.map((row) => columns.map((col) => row[col.key] ?? '')),
    filters,
    metadata,
  })
  downloadBlob(res.blob, res.filename || `${title}.${format === 'pdf' ? 'pdf' : 'xls'}`)
}

// The server names the file; the fallback follows the same pattern in case
// the name is missing from the response.
export async function exportUserTimeline(userId, email, format) {
  const res = await api.admin.userTimelineExport(userId, format)
  const safeEmail = (email || 'user').replace(/@/g, '_at_').replace(/\./g, '_')
  downloadBlob(res.blob, res.filename || `timeline_${safeEmail}.${format}`)
}

export async function fetchAdminAllPages(fetchPage, { pageSize = 500, maxPages = 100 } = {}) {
  let offset = 0
  let total = 0
  const rows = []

  for (let page = 0; page < maxPages; page += 1) {
    const res = await fetchPage({ limit: pageSize, offset })
    const chunk = Array.isArray(res?.rows) ? res.rows : []
    total = Number(res?.total || 0)
    rows.push(...chunk)
    if (!chunk.length || rows.length >= total || chunk.length < pageSize) break
    offset += pageSize
  }

  return { rows, total: total || rows.length }
}

export function countryFlag(code) {
  if (!code || code.length !== 2) return ''
  try {
    return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E0 - 65 + c.charCodeAt(0)))
  } catch { return '' }
}

// ── Shared form controls ──────────────────────────────────────────────────────

export function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[mGKHF]/g, '')
}

// Colour-code log lines by severity

export function logLineColor(text) {
  const t = text.toUpperCase()
  if (t.includes(' ERROR') || t.includes('[ERROR]') || t.includes('TRACEBACK') || t.includes('EXCEPTION'))
    return '#f87171'   // red
  if (t.includes(' WARNING') || t.includes('[WARNING]') || t.includes('[WARN]'))
    return '#fbbf24'   // amber
  if (t.includes(' INFO') || t.includes('[INFO]'))
    return '#86efac'   // green
  if (t.includes('DEBUG') || t.includes('[DEBUG]'))
    return '#94a3b8'   // slate
  return '#e2e8f0'     // default light
}
