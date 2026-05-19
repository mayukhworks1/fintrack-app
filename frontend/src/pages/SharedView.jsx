/**
 * SharedView — public manager view page
 *
 * Route: /view/:token  (no auth required)
 * Fetches status records via GET /api/public/view/:token
 * Renders in the view type stored in view_config (card / list / board)
 * Falls back to card view if view_config is absent.
 */

import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import {
  Activity, AlertCircle, Loader2, Clock,
  Shield, ChevronDown, ChevronUp,
} from 'lucide-react'
import { api } from '../services/api'

// ── Helpers ────────────────────────────────────────────────────────────────────
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

// ── Client colour palette ──────────────────────────────────────────────────────
const PALETTE = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#ec4899','#0ea5e9','#eab308','#14b8a6','#f97316']
const _cmap = {}
function clientColor(name) {
  if (!_cmap[name]) _cmap[name] = PALETTE[Object.keys(_cmap).length % PALETTE.length]
  return _cmap[name]
}
function hexRgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
  return `rgba(${r},${g},${b},${a})`
}

// ── Status colours ─────────────────────────────────────────────────────────────
const STATUS_CFG = {
  'Completed':      { bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.35)',  dot: '#10b981', text: '#059669' },
  'In progress':    { bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.35)',  dot: '#3b82f6', text: '#2563eb' },
  'On Hold':        { bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.35)',  dot: '#f59e0b', text: '#d97706' },
  'Input Pending':  { bg: 'rgba(249,115,22,0.12)',  border: 'rgba(249,115,22,0.35)',  dot: '#f97316', text: '#ea580c' },
  'Not started':    { bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.3)',  dot: '#94a3b8', text: '#64748b' },
}
const BOARD_ORDER = ['In progress','Input Pending','On Hold','Not started','Completed']

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

// ── Card (default view) ────────────────────────────────────────────────────────
function PublicStatusCard({ record }) {
  const [expanded, setExpanded] = useState(false)
  const f       = record.fields || {}
  const client  = f['Client']  || ''
  const project = f['Project'] || 'Unknown Project'
  const short   = f['Short Status'] || ''
  const detail  = f['Current Status (Detailed)'] || ''
  const status  = f['Status'] || ''
  const clr     = clientColor(client)
  const hasDetail = detail.trim() && detail.trim() !== short.trim()

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ background: '#ffffff', border: '1px solid #e5e7eb', boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
      <div className="h-1" style={{ background: clr }} />
      <div className="p-5">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="text-base font-bold text-gray-900 leading-snug">{project}</h3>
          {status && <StatusBadge status={status} />}
        </div>
        {short && <p className="text-sm font-semibold text-gray-800 leading-snug mb-3">{short}</p>}
        {hasDetail && (
          <>
            {expanded
              ? <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{detail}</p>
              : <p className="text-sm text-gray-500 leading-relaxed line-clamp-3">{detail}</p>
            }
            <button onClick={() => setExpanded(x => !x)}
              className="mt-2 flex items-center gap-1 text-xs font-semibold"
              style={{ color: clr }}>
              {expanded ? <><ChevronUp size={12} /> Show less</> : <><ChevronDown size={12} /> Show more</>}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Card view (grouped by client) ─────────────────────────────────────────────
function CardView({ records }) {
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
                style={{ background: hexRgba(clrHex, 0.1), border: `1.5px solid ${hexRgba(clrHex,0.3)}`, color: clrHex }}>
                <span className="w-2 h-2 rounded-full" style={{ background: clrHex }} />
                {client}
              </span>
              <span className="text-sm text-gray-400">{recs.length} project{recs.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {recs.map(r => <PublicStatusCard key={r.id} record={r} />)}
            </div>
          </section>
        )
      })}
    </div>
  )
}

// ── List view (table) ──────────────────────────────────────────────────────────
const ALL_COLS = ['Client','Project','Status','Short Status','Current Status (Detailed)','Last Modified']
const DEFAULT_COLS = ['Client','Project','Status','Short Status']
const COLUMN_ALIASES = {
  'Detailed Status': 'Current Status (Detailed)',
  'Current Status (Detailed)': 'Current Status (Detailed)',
  'Last Modified': 'Last Modified',
}

function ListView({ records, columns }) {
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
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => {
            const f = r.fields || {}
            const clr = clientColor(f['Client'] || '')
            return (
              <tr key={r.id}
                style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? '#ffffff' : '#fafafa' }}>
                {cols.map(col => (
                  <td key={col} className="px-4 py-3 align-top">
                    {col === 'Client' && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: hexRgba(clr, 0.1), color: clr }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: clr }} />
                        {f['Client'] || '—'}
                      </span>
                    )}
                    {col === 'Project' && (
                      <span className="font-semibold text-gray-900">{f['Project'] || '—'}</span>
                    )}
                    {col === 'Status' && <StatusBadge status={f['Status']} />}
                    {col === 'Short Status' && (
                      <span className="text-gray-700">{f['Short Status'] || '—'}</span>
                    )}
                    {col === 'Current Status (Detailed)' && (
                      <span className="text-gray-500 text-xs leading-relaxed line-clamp-2">
                        {f['Current Status (Detailed)'] || '—'}
                      </span>
                    )}
                    {col === 'Last Modified' && (
                      <span className="text-gray-500 text-xs whitespace-nowrap">
                        {fmtDateTime(f['lastModifiedTime'] || r.createdTime || '') || '—'}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Board view (grouped by Status) ────────────────────────────────────────────
function BoardView({ records }) {
  const byStatus = BOARD_ORDER.reduce((acc, s) => { acc[s] = []; return acc }, {})
  records.forEach(r => {
    const s = r.fields?.['Status'] || 'Not started'
    if (!byStatus[s]) byStatus[s] = []
    byStatus[s].push(r)
  })

  return (
    <div className="flex gap-4 overflow-x-auto pb-2" style={{ minHeight: 200 }}>
      {BOARD_ORDER.map(status => {
        const recs = byStatus[status] || []
        const st = statusStyle(status)
        return (
          <div key={status} className="flex-shrink-0 w-72 rounded-2xl overflow-hidden"
            style={{ background: '#ffffff', border: '1px solid #e5e7eb' }}>
            {/* Column header */}
            <div className="px-4 py-3 flex items-center justify-between"
              style={{ background: st.bg, borderBottom: `1px solid ${st.border}` }}>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: st.dot }} />
                <span className="text-sm font-bold" style={{ color: st.text }}>{status}</span>
              </div>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                style={{ background: st.border, color: st.text }}>
                {recs.length}
              </span>
            </div>
            {/* Cards */}
            <div className="p-3 space-y-3" style={{ minHeight: 80 }}>
              {recs.length === 0 && (
                <p className="text-xs text-center py-4 text-gray-400">No projects</p>
              )}
              {recs.map(r => {
                const f = r.fields || {}
                const clr = clientColor(f['Client'] || '')
                return (
                  <div key={r.id} className="rounded-xl p-3"
                    style={{ background: '#f8fafc', border: '1px solid #e5e7eb' }}>
                    <div className="text-xs font-semibold mb-1" style={{ color: clr }}>
                      {f['Client'] || ''}
                    </div>
                    <div className="text-sm font-bold text-gray-900 mb-1 leading-tight">
                      {f['Project'] || 'Unknown Project'}
                    </div>
                    {f['Short Status'] && (
                      <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">
                        {f['Short Status']}
                      </p>
                    )}
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

function FilterSummary({ viewConfig }) {
  const chips = [
    viewConfig?.filterClient ? `Client: ${viewConfig.filterClient}` : null,
    viewConfig?.filterStatus ? `Status: ${viewConfig.filterStatus}` : null,
    viewConfig?.search ? `Search: "${viewConfig.search}"` : null,
  ].filter(Boolean)

  if (!chips.length) return null

  return (
    <div className="flex flex-wrap gap-2 mb-5">
      {chips.map(chip => (
        <span
          key={chip}
          className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold"
          style={{ background: '#ffffff', border: '1px solid #e5e7eb', color: '#475569' }}
        >
          {chip}
        </span>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SharedView() {
  const { token } = useParams()
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    if (!token) return
    setLoading(true)
    api.sharedViews.publicGet(token)
      .then(res => { setData(res); setLoading(false) })
      .catch(e  => { setError(e.message || 'This link is unavailable'); setLoading(false) })
  }, [token])

  // Loading
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

  // Error — differentiated messages
  if (error) {
    const isDisabled   = /disabled/i.test(error)
    const isExpiredLink = /expired/i.test(error)

    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#f8fafc' }}>
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-2xl p-8 text-center shadow-sm" style={{ border: '1px solid #e5e7eb' }}>
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5 ${isDisabled ? 'bg-amber-50' : 'bg-red-50'}`}
              style={{ border: `1px solid ${isDisabled ? 'rgba(245,158,11,0.25)' : 'rgba(239,68,68,0.2)'}` }}>
              <AlertCircle size={28} className={isDisabled ? 'text-amber-500' : 'text-red-500'} />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">
              {isExpiredLink ? 'Link Expired' : 'Access Restricted'}
            </h1>
            <p className="text-sm text-gray-600 leading-relaxed">
              {isDisabled
                ? 'This link has been disabled by the admin.'
                : isExpiredLink
                  ? 'This link has passed its expiry date.'
                  : 'This page is not accessible.'}
            </p>
            <p className="text-sm text-gray-500 mt-2">
              Please contact the admin who shared this link.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!data) return null

  const title      = data.title || 'Project Status Update'
  const expiresAt  = data.expires_at
  const createdAt  = data.created_at
  const expired    = isExpired(expiresAt)
  const vc         = data.view_config || {}
  const viewType   = vc.type || 'card'
  const columns    = vc.columns || DEFAULT_COLS
  const records    = data.records || []

  const viewLabel = viewType === 'list' ? 'List View' : viewType === 'board' ? 'Board View' : 'Card View'

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>
      {/* ── Header ── */}
      <header style={{ background: '#ffffff', borderBottom: '1px solid #e5e7eb' }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.2)' }}>
                <Activity size={18} style={{ color: '#3b82f6' }} />
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900 leading-tight">{title}</h1>
                <p className="text-xs text-gray-500 mt-0.5">
                  {data.total} project update{data.total !== 1 ? 's' : ''}
                  {createdAt && ` · ${fmtDate(createdAt)}`}
                  {' · '}
                  <span className="font-medium">{viewLabel}</span>
                </p>
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-gray-400">
              <Shield size={11} />
              FinTrack
            </div>
          </div>
        </div>
      </header>

      {/* ── Expiry notice ── */}
      {expiresAt && (
        <div className={`py-2 text-center text-xs font-medium ${expired ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>
          <Clock className="inline mr-1" size={11} />
          {expired
            ? `This link expired on ${fmtDateTime(expiresAt)}`
            : `This link expires on ${fmtDateTime(expiresAt)}`
          }
        </div>
      )}

      {/* ── Body ── */}
      <main className={`mx-auto px-4 sm:px-6 py-8 ${viewType === 'board' ? 'max-w-full' : 'max-w-5xl'}`}>
        <FilterSummary viewConfig={vc} />

        {records.length === 0 && (
          <div className="text-center py-16">
            <p className="text-gray-500 text-sm">No project updates included in this link.</p>
          </div>
        )}

        {records.length > 0 && viewType === 'card'  && <CardView  records={records} />}
        {records.length > 0 && viewType === 'list'  && <ListView  records={records} columns={columns} />}
        {records.length > 0 && viewType === 'board' && <BoardView records={records} />}
      </main>

      {/* ── Footer ── */}
      <footer className="py-8 text-center" style={{ borderTop: '1px solid #e5e7eb' }}>
        <div className="flex items-center justify-center gap-1.5 text-xs text-gray-400 mb-1">
          <Shield size={11} />
          <span>FinTrack · Project Status</span>
        </div>
        {createdAt && (
          <p className="text-[11px] text-gray-300">Generated {fmtDateTime(createdAt)}</p>
        )}
      </footer>
    </div>
  )
}
