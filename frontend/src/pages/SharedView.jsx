/**
 * SharedView — public manager view page
 *
 * Route: /view/:token  (no auth required)
 * Fetches status records via GET /api/public/view/:token
 * Shows a clean, professional executive-report style layout.
 * Fully mobile-responsive.
 */

import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import {
  Activity, AlertCircle, Loader2, Clock,
  MapPin, Calendar, Shield, ChevronDown, ChevronUp,
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

// Status type detector
function detectStatusType(short = '', detail = '') {
  const t = (short + ' ' + detail).toLowerCase()
  if (/complet|closed|delivered|done|cleared|launched/i.test(t))
    return { label: 'Complete',    color: '#10b981', bg: 'rgba(16,185,129,0.08)',  border: 'rgba(16,185,129,0.2)' }
  if (/block|critical|issue|fail|error|escalat/i.test(t))
    return { label: 'Needs Attention', color: '#ef4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)' }
  if (/hold|await|wait|pending client|pause|dormant/i.test(t))
    return { label: 'On Hold',     color: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.2)' }
  if (/uat|testing|qa|test\s/i.test(t))
    return { label: 'In Testing',  color: '#0ea5e9', bg: 'rgba(14,165,233,0.08)',  border: 'rgba(14,165,233,0.2)' }
  if (/invoice|billing|payment|presale/i.test(t))
    return { label: 'Billing',     color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)', border: 'rgba(139,92,246,0.2)' }
  if (/new business|discovery|demo|poc|lead/i.test(t))
    return { label: 'Biz Dev',     color: '#ec4899', bg: 'rgba(236,72,153,0.08)', border: 'rgba(236,72,153,0.2)' }
  if (/dev|develop|build|implement|progress|config/i.test(t))
    return { label: 'In Progress', color: '#3b82f6', bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.2)' }
  return   { label: 'Active',      color: '#6b7280', bg: 'rgba(107,114,128,0.08)', border: 'rgba(107,114,128,0.2)' }
}

// Client colour palette
const PALETTE = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#ec4899','#0ea5e9','#eab308','#14b8a6','#f97316']
const _cmap = {}
function clientColor(name) {
  if (!_cmap[name]) { _cmap[name] = PALETTE[Object.keys(_cmap).length % PALETTE.length] }
  return _cmap[name]
}
function hexRgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
  return `rgba(${r},${g},${b},${a})`
}

// ── Status card ────────────────────────────────────────────────────────────────
function PublicStatusCard({ record }) {
  const [expanded, setExpanded] = useState(false)
  const f = record.fields || {}
  const project = f['Project'] || 'Unknown Project'
  const short   = f['Short Status'] || ''
  const detail  = f['Current Status (Detailed)'] || ''
  const st      = detectStatusType(short, detail)
  const hasDetail = detail.trim() && detail.trim() !== short.trim()

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{
        background: '#ffffff',
        border: '1px solid #e5e7eb',
        boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
      }}>
      {/* Status type color bar */}
      <div className="h-1" style={{ background: st.color }} />

      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <h3 className="text-base font-bold text-gray-900 leading-snug">{project}</h3>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold flex-shrink-0"
            style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: st.color }} />
            {st.label}
          </span>
        </div>

        {/* Short status */}
        {short && (
          <p className="text-sm font-semibold text-gray-800 leading-snug mb-3">{short}</p>
        )}

        {/* Detail */}
        {hasDetail && (
          <>
            {expanded ? (
              <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{detail}</p>
            ) : (
              <p className="text-sm text-gray-500 leading-relaxed line-clamp-3">{detail}</p>
            )}
            <button
              onClick={() => setExpanded(x => !x)}
              className="mt-2 flex items-center gap-1 text-xs font-semibold"
              style={{ color: st.color }}>
              {expanded ? <><ChevronUp size={12} /> Show less</> : <><ChevronDown size={12} /> Show more</>}
            </button>
          </>
        )}
      </div>
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

  // Error — map known backend messages to user-friendly copy
  if (error) {
    const isDisabled = /disabled/i.test(error)
    const isExpiredLink = /expired/i.test(error)
    const isNotFound = /not found/i.test(error)

    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#f8fafc' }}>
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-2xl p-8 text-center shadow-sm" style={{ border: '1px solid #e5e7eb' }}>
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5 ${isDisabled ? 'bg-amber-50' : 'bg-red-50'}`}
              style={{ border: `1px solid ${isDisabled ? 'rgba(245,158,11,0.25)' : 'rgba(239,68,68,0.2)'}` }}>
              <AlertCircle size={28} className={isDisabled ? 'text-amber-500' : 'text-red-500'} />
            </div>

            {isDisabled && (
              <>
                <h1 className="text-xl font-bold text-gray-900 mb-2">Link Disabled</h1>
                <p className="text-sm text-gray-600 leading-relaxed">
                  This status update link has been disabled by the owner.
                </p>
                <p className="text-sm text-gray-500 mt-2">
                  Please contact the person who shared this link to request an updated one.
                </p>
              </>
            )}

            {isExpiredLink && (
              <>
                <h1 className="text-xl font-bold text-gray-900 mb-2">Link Expired</h1>
                <p className="text-sm text-gray-600 leading-relaxed">
                  This status update link has passed its expiry date.
                </p>
                <p className="text-sm text-gray-500 mt-2">
                  Please contact the person who shared this link to request a fresh one.
                </p>
              </>
            )}

            {isNotFound && (
              <>
                <h1 className="text-xl font-bold text-gray-900 mb-2">Link Not Found</h1>
                <p className="text-sm text-gray-600">
                  This link doesn't exist or may have been deleted.
                </p>
              </>
            )}

            {!isDisabled && !isExpiredLink && !isNotFound && (
              <>
                <h1 className="text-xl font-bold text-gray-900 mb-2">Unavailable</h1>
                <p className="text-sm text-gray-500">{error}</p>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (!data) return null

  // Group by client
  const grouped = (data.records || []).reduce((acc, r) => {
    const cl = r.fields?.['Client'] || 'Unknown'
    if (!acc[cl]) acc[cl] = []
    acc[cl].push(r)
    return acc
  }, {})

  const title     = data.title || 'Project Status Update'
  const expiresAt = data.expires_at
  const createdAt = data.created_at
  const expired   = isExpired(expiresAt)

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc' }}>
      {/* ── Header ── */}
      <header style={{ background: '#ffffff', borderBottom: '1px solid #e5e7eb' }}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5">
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
                </p>
              </div>
            </div>
            {/* App branding */}
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
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {data.records?.length === 0 && (
          <div className="text-center py-16">
            <p className="text-gray-500 text-sm">No project updates included in this link.</p>
          </div>
        )}

        {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([client, recs]) => {
          const clrHex = clientColor(client)
          return (
            <section key={client}>
              {/* Client header */}
              <div className="flex items-center gap-3 mb-4">
                <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold"
                  style={{
                    background: hexRgba(clrHex, 0.1),
                    border: `1.5px solid ${hexRgba(clrHex, 0.3)}`,
                    color: clrHex,
                  }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: clrHex }} />
                  {client}
                </span>
                <span className="text-sm text-gray-400">
                  {recs.length} project{recs.length !== 1 ? 's' : ''}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {recs.map(r => (
                  <PublicStatusCard key={r.id} record={r} />
                ))}
              </div>
            </section>
          )
        })}
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
