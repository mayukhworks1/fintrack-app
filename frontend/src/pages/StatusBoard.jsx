/**
 * Status Board v2 — redesigned with:
 * • Multi-select with floating action bar
 * • AI-generated status update narrative
 * • Shareable manager view links (expiry + tracking)
 * • Status-type colour coding
 * • Fully mobile-responsive
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Activity, Plus, Pencil, Trash2, X, Check,
  ChevronDown, ChevronUp, RefreshCw, Search,
  AlertCircle, Loader2, ClipboardList, Sparkles,
  Share2, Copy, CheckCheck, ExternalLink, Eye,
  Clock, ToggleLeft, ToggleRight, Link2, Zap,
  MapPin, Monitor, Smartphone, Globe, Shield,
  LayoutGrid, List, Columns,
} from 'lucide-react'
import { api } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

// ── Status field config ───────────────────────────────────────────────────────
const STATUS_OPTIONS = ['Completed', 'On Hold', 'Input Pending', 'In progress', 'Not started']
const STATUS_CONFIG = {
  'Completed':     { color: '#10b981', bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.30)', dot: '#10b981' },
  'In progress':   { color: '#3b82f6', bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.30)', dot: '#3b82f6' },
  'On Hold':       { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.30)',  dot: '#f59e0b' },
  'Input Pending': { color: '#f97316', bg: 'rgba(249,115,22,0.10)', border: 'rgba(249,115,22,0.30)', dot: '#f97316' },
  'Not started':   { color: '#94a3b8', bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.25)', dot: '#94a3b8' },
}
function statusStyle(s) {
  return STATUS_CONFIG[s] || { color: '#94a3b8', bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.2)', dot: '#94a3b8' }
}

// ── Client colour palette ────────────────────────────────────────────────────
const PALETTE = [
  '#3b82f6','#8b5cf6','#10b981','#f59e0b',
  '#ef4444','#ec4899','#0ea5e9','#eab308',
  '#14b8a6','#f97316','#6366f1','#84cc16',
]
const _clientMap = {}
function clientColor(name) {
  if (!_clientMap[name]) {
    const idx = Object.keys(_clientMap).length % PALETTE.length
    _clientMap[name] = PALETTE[idx]
  }
  return _clientMap[name]
}
function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16)
  const g = parseInt(hex.slice(3,5),16)
  const b = parseInt(hex.slice(5,7),16)
  return `rgba(${r},${g},${b},${a})`
}

// ── Expiry presets for share links ────────────────────────────────────────────
const EXPIRY_OPTS = [
  { label: 'Never',   value: 0   },
  { label: '1 hour',  value: 1   },
  { label: '24 hours',value: 24  },
  { label: '3 days',  value: 72  },
  { label: '7 days',  value: 168 },
  { label: '30 days', value: 720 },
]

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' }) }
  catch { return iso }
}
function isExpired(iso) {
  if (!iso) return false
  return new Date(iso) < new Date()
}

// ═══════════════════════════════════════════════════════════════════════════════
// Status Card
// ═══════════════════════════════════════════════════════════════════════════════
function StatusCard({ record, isEditor, onEdit, onDelete, selected, onSelect, expanded, onToggle, deleting }) {
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
      className="relative rounded-2xl overflow-hidden transition-all duration-200 group"
      style={{
        background: selected ? hexToRgba(clrHex, 0.07) : 'var(--card-bg)',
        border: selected ? `1.5px solid ${clrHex}` : '1px solid var(--border)',
        boxShadow: selected
          ? `0 0 0 3px ${hexToRgba(clrHex, 0.18)}, 0 2px 8px rgba(15,23,42,0.08)`
          : '0 1px 4px rgba(15,23,42,0.05)',
      }}
    >
      {/* Client-coloured left bar */}
      <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: clrHex }} />

      <div className="pl-4 pr-3 pt-3 pb-3">
        {/* ── Top row: checkbox · badges · actions ── */}
        <div className="flex items-start gap-2.5 mb-2.5">

          {/* Always-visible checkbox — large touch target */}
          <button
            onClick={() => onSelect(record.id)}
            className="flex-shrink-0 mt-0.5 rounded-md transition-all focus:outline-none focus-visible:ring-2"
            style={{
              width: 20, height: 20,
              background: selected ? clrHex : 'transparent',
              border: `2px solid ${selected ? clrHex : 'var(--border)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-label={selected ? 'Deselect' : 'Select'}
            title={selected ? 'Deselect' : 'Select this project'}
          >
            {selected && <Check size={11} color="#fff" strokeWidth={3} />}
          </button>

          {/* Badges */}
          <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold"
              style={{ background: hexToRgba(clrHex, 0.12), color: clrHex, border: `1px solid ${hexToRgba(clrHex, 0.3)}` }}>
              {client}
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
              {project}
            </span>
            {status && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.dot }} />
                {status}
              </span>
            )}
          </div>

          {/* Actions — always visible on mobile, hover on desktop */}
          <div className="flex items-center gap-0.5 flex-shrink-0 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
            {hasDetail && (
              <button onClick={onToggle} className="btn-icon p-1.5" title={expanded ? 'Collapse' : 'Expand'}
                style={{ color: 'var(--text-3)' }}>
                {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
            )}
            {isEditor && !deleting && (
              <>
                <button onClick={onEdit} className="btn-icon p-1.5" title="Edit"
                  style={{ color: 'var(--text-3)' }}>
                  <Pencil size={13} />
                </button>
                <button onClick={onDelete} className="btn-icon p-1.5" title="Delete"
                  style={{ color: 'rgba(239,68,68,0.55)' }}
                  onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                  onMouseLeave={e => e.currentTarget.style.color = 'rgba(239,68,68,0.55)'}>
                  <Trash2 size={13} />
                </button>
              </>
            )}
            {deleting && <Loader2 size={13} className="animate-spin" style={{ color: 'var(--text-3)' }} />}
          </div>
        </div>

        {/* ── Short status ── */}
        {short && (
          <p className="text-sm font-semibold leading-snug mb-2" style={{ color: 'var(--text-1)' }}>
            {short}
          </p>
        )}

        {/* ── Detail — collapsible ── */}
        {hasDetail && (
          <div className="mt-2.5">
            {expanded ? (
              <p className="text-[12px] leading-relaxed whitespace-pre-wrap"
                style={{ color: 'var(--text-2)', borderTop: '1px solid var(--border)', paddingTop: '0.5rem' }}>
                {detail}
              </p>
            ) : (
              <p className="text-[12px] leading-snug"
                style={{ color: 'var(--text-3)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {detail}
              </p>
            )}
            <button
              onClick={onToggle}
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

// ═══════════════════════════════════════════════════════════════════════════════
// Status Modal (create / edit)
// ═══════════════════════════════════════════════════════════════════════════════
function StatusModal({ initial, onClose, onSave, saving, allRecords }) {
  const isEdit = !!initial
  const [form, setForm] = useState({
    client:                   initial?.fields?.['Client'] || '',
    project:                  initial?.fields?.['Project'] || '',
    status:                   initial?.fields?.['Status'] || '',
    short_status:             initial?.fields?.['Short Status'] || '',
    current_status_detailed:  initial?.fields?.['Current Status (Detailed)'] || '',
  })

  // Derive unique clients + projects from existing records
  const allClients  = [...new Set(allRecords.map(r => r.fields?.['Client']).filter(Boolean))].sort()
  const allProjects = [...new Set(allRecords.map(r => r.fields?.['Project']).filter(Boolean))].sort()

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', maxHeight: '90vh', overflow: 'auto' }}>

        <div className="flex items-center justify-between px-5 pt-5 pb-3 sticky top-0"
          style={{ background: 'var(--card-bg)', borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>
            {isEdit ? 'Edit Status' : '+ New Status Update'}
          </h2>
          <button onClick={onClose} className="btn-icon p-1.5" style={{ color: 'var(--text-3)' }}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={e => { e.preventDefault(); if (form.client && form.project) onSave(form) }}
          className="px-5 py-4 space-y-4">

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
                Client <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input list="client-list" className="input-field w-full text-sm"
                placeholder="Type or select…"
                value={form.client} onChange={e => set('client', e.target.value)} required />
              <datalist id="client-list">
                {allClients.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
                Project <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input list="project-list" className="input-field w-full text-sm"
                placeholder="Type or select…"
                value={form.project} onChange={e => set('project', e.target.value)} required />
              <datalist id="project-list">
                {allProjects.map(p => <option key={p} value={p} />)}
              </datalist>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
              Status
            </label>
            <div className="grid grid-cols-5 gap-1.5">
              {STATUS_OPTIONS.map(opt => {
                const sc = statusStyle(opt)
                const active = form.status === opt
                return (
                  <button key={opt} type="button"
                    onClick={() => set('status', active ? '' : opt)}
                    className="py-1.5 px-1 rounded-xl text-[10px] font-semibold text-center transition-all leading-tight"
                    style={{
                      background: active ? sc.bg : 'var(--bg-input)',
                      color:      active ? sc.color : 'var(--text-3)',
                      border:     `1.5px solid ${active ? sc.border : 'var(--border)'}`,
                    }}>
                    {opt}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
              Short Status
              <span className="ml-1.5 text-[10px] font-normal" style={{ color: 'var(--text-3)' }}>one-line headline</span>
            </label>
            <input type="text" className="input-field w-full text-sm"
              placeholder="e.g. UAT in progress — awaiting sign-off"
              value={form.short_status} onChange={e => set('short_status', e.target.value)} maxLength={200} />
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
              Detailed Status
            </label>
            <textarea className="input-field w-full text-sm resize-none"
              placeholder="Full narrative — blockers, next steps, billing notes…"
              rows={5} value={form.current_status_detailed}
              onChange={e => set('current_status_detailed', e.target.value)} />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1 pb-1">
            <button type="button" className="btn-ghost text-sm px-4 py-2" onClick={onClose} disabled={saving}>
              Cancel
            </button>
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

// ═══════════════════════════════════════════════════════════════════════════════
// AI Update Modal
// ═══════════════════════════════════════════════════════════════════════════════
function AIUpdateModal({ selectedRecords, onClose, onShare }) {
  const [loading, setLoading]   = useState(false)
  const [result,  setResult]    = useState(null)
  const [error,   setError]     = useState(null)
  const [context, setContext]   = useState('')
  const [copied,  setCopied]    = useState(false)

  async function generate() {
    setLoading(true); setError(null); setResult(null)
    try {
      const ids = selectedRecords.map(r => r.id)
      const res = await api.status.aiUpdate(ids, context)
      setResult(res)
    } catch (e) {
      setError(e.message || 'AI generation failed')
    } finally {
      setLoading(false)
    }
  }

  function copyText() {
    navigator.clipboard.writeText(result?.text || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)' }}>
              <Sparkles size={15} style={{ color: '#8b5cf6' }} />
            </div>
            <div>
              <h2 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>AI Status Update</h2>
              <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                {selectedRecords.length} project{selectedRecords.length !== 1 ? 's' : ''} selected
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn-icon p-1.5" style={{ color: 'var(--text-3)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* Selected projects summary */}
          <div className="flex flex-wrap gap-1.5">
            {selectedRecords.map(r => {
              const f = r.fields || {}
              return (
                <span key={r.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium"
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                  <span className="font-semibold" style={{ color: 'var(--text-1)' }}>{f['Client']}</span>
                  <span style={{ color: 'var(--text-3)' }}>·</span>
                  {f['Project']}
                </span>
              )
            })}
          </div>

          {/* Optional context */}
          {!result && (
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
                Additional context <span className="font-normal" style={{ color: 'var(--text-3)' }}>(optional)</span>
              </label>
              <textarea className="input-field w-full text-sm resize-none" rows={2}
                placeholder="e.g. Focus on billing status, ignore in-progress items…"
                value={context} onChange={e => setContext(e.target.value)} />
            </div>
          )}

          {/* Generate button */}
          {!result && !loading && (
            <button onClick={generate}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all"
              style={{ background: 'linear-gradient(135deg, #8b5cf6, #6366f1)', color: '#fff', boxShadow: '0 2px 8px rgba(99,102,241,0.35)' }}>
              <Sparkles size={14} />
              Generate Status Update
            </button>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="flex gap-1.5">
                {[0,1,2].map(i => (
                  <span key={i} className="w-2 h-2 rounded-full animate-bounce"
                    style={{ background: '#8b5cf6', animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>Generating status update…</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-xl"
              style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)' }}>
              <AlertCircle size={14} style={{ color: '#ef4444', marginTop: 1 }} />
              <div>
                <p className="text-sm font-medium" style={{ color: '#ef4444' }}>Generation failed</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{error}</p>
                <button onClick={generate} className="text-xs font-semibold mt-2" style={{ color: '#ef4444' }}>Retry</button>
              </div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                  Generated via {result.model || 'AI'}
                </p>
                <div className="flex items-center gap-1.5">
                  <button onClick={generate} className="btn-ghost text-xs px-2 py-1 flex items-center gap-1">
                    <RefreshCw size={10} /> Regenerate
                  </button>
                  <button onClick={copyText}
                    className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg transition-all"
                    style={{ background: copied ? 'rgba(16,185,129,0.12)' : 'var(--bg-input)', color: copied ? '#10b981' : 'var(--text-2)', border: '1px solid var(--border)' }}>
                    {copied ? <CheckCheck size={11} /> : <Copy size={11} />}
                    {copied ? 'Copied!' : 'Copy'}
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

        {/* Footer */}
        {result && (
          <div className="flex items-center justify-between gap-2 px-5 py-3 flex-shrink-0"
            style={{ borderTop: '1px solid var(--border)' }}>
            <button onClick={onClose} className="btn-ghost text-sm px-4 py-2">Done</button>
            <button onClick={() => { onClose(); onShare() }}
              className="flex items-center gap-2 btn-primary text-sm px-4 py-2">
              <Share2 size={13} /> Share These Projects
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Share Modal
// ═══════════════════════════════════════════════════════════════════════════════
function ShareModal({ selectedRecords, onClose }) {
  const [step,      setStep]      = useState('form')   // 'form' | 'created'
  const [title,     setTitle]     = useState('')
  const [expiry,    setExpiry]    = useState(0)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState(null)
  const [shareData, setShareData] = useState(null)
  const [copied,    setCopied]    = useState(false)

  const shareUrl = shareData ? `${window.location.origin}/view/${shareData.token}` : ''

  async function createShare() {
    setSaving(true); setError(null)
    try {
      const ids = selectedRecords.map(r => r.id)
      const data = await api.sharedViews.create({
        title: title.trim() || null,
        record_ids: ids,
        expires_hours: expiry || null,
      })
      setShareData(data)
      setStep('created')
    } catch (e) {
      setError(e.message || 'Failed to create share link')
    } finally {
      setSaving(false)
    }
  }

  function copyUrl() {
    navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

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

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3"
          style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.25)' }}>
              <Share2 size={15} style={{ color: '#0ea5e9' }} />
            </div>
            <div>
              <h2 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
                {step === 'form' ? 'Share with Manager' : 'Link Created!'}
              </h2>
              <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                {selectedRecords.length} project{selectedRecords.length !== 1 ? 's' : ''} · anyone with link can view
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn-icon p-1.5" style={{ color: 'var(--text-3)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {step === 'form' && (
            <>
              {/* Projects preview */}
              <div className="flex flex-wrap gap-1.5">
                {selectedRecords.slice(0, 8).map(r => (
                  <span key={r.id} className="text-[11px] px-2 py-0.5 rounded-lg font-medium"
                    style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                    {r.fields?.['Client']} · {r.fields?.['Project']}
                  </span>
                ))}
                {selectedRecords.length > 8 && (
                  <span className="text-[11px] px-2 py-0.5 rounded-lg" style={{ color: 'var(--text-3)' }}>
                    +{selectedRecords.length - 8} more
                  </span>
                )}
              </div>

              {/* Title */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
                  Link title <span className="font-normal" style={{ color: 'var(--text-3)' }}>(shown to viewer)</span>
                </label>
                <input type="text" className="input-field w-full text-sm"
                  placeholder="e.g. May 2026 Status Update"
                  value={title} onChange={e => setTitle(e.target.value)} maxLength={200} />
              </div>

              {/* Expiry */}
              <div>
                <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-2)' }}>
                  Link expires
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {EXPIRY_OPTS.map(opt => (
                    <button key={opt.value}
                      onClick={() => setExpiry(opt.value)}
                      className="py-1.5 rounded-xl text-xs font-semibold transition-all"
                      style={{
                        background: expiry === opt.value ? 'var(--accent)' : 'var(--bg-input)',
                        color:      expiry === opt.value ? '#fff' : 'var(--text-2)',
                        border: `1px solid ${expiry === opt.value ? 'var(--accent)' : 'var(--border)'}`,
                      }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <p className="text-xs p-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
                  {error}
                </p>
              )}

              {/* Info */}
              <div className="flex items-start gap-2 p-3 rounded-xl"
                style={{ background: 'rgba(14,165,233,0.06)', border: '1px solid rgba(14,165,233,0.15)' }}>
                <Shield size={13} style={{ color: '#0ea5e9', marginTop: 1, flexShrink: 0 }} />
                <p className="text-[11px]" style={{ color: 'var(--text-2)' }}>
                  All accesses are tracked with IP, location, device, and browser. You can disable or delete the link anytime.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button onClick={onClose} className="btn-ghost text-sm px-4 py-2">Cancel</button>
                <button onClick={createShare} disabled={saving}
                  className="flex items-center gap-2 btn-primary text-sm px-4 py-2">
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
                  Generate Link
                </button>
              </div>
            </>
          )}

          {step === 'created' && shareData && (
            <>
              {/* Success icon */}
              <div className="flex flex-col items-center py-2 gap-3">
                <div className="w-14 h-14 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(16,185,129,0.12)', border: '2px solid rgba(16,185,129,0.3)' }}>
                  <CheckCheck size={24} style={{ color: '#10b981' }} />
                </div>
                <div className="text-center">
                  <p className="font-bold text-base" style={{ color: 'var(--text-1)' }}>Link ready!</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                    Share this URL with your manager — no login needed.
                  </p>
                </div>
              </div>

              {/* URL box */}
              <div className="flex items-center gap-2 p-3 rounded-xl"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                <Link2 size={13} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                <p className="text-xs font-mono flex-1 truncate" style={{ color: 'var(--text-1)' }}>
                  {shareUrl}
                </p>
                <button onClick={copyUrl}
                  className="flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg transition-all"
                  style={{ background: copied ? 'rgba(16,185,129,0.12)' : 'var(--card-bg)', color: copied ? '#10b981' : 'var(--accent)', border: '1px solid var(--border)' }}>
                  {copied ? <CheckCheck size={11} /> : <Copy size={11} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>

              {/* Expiry info */}
              {shareData.expires_at && (
                <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
                  <Clock size={11} />
                  Expires {fmtDate(shareData.expires_at)}
                </div>
              )}

              <div className="flex items-center justify-between gap-2 pt-1">
                <a href={shareUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs font-medium"
                  style={{ color: 'var(--accent)' }}>
                  <ExternalLink size={11} /> Preview link
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

// ═══════════════════════════════════════════════════════════════════════════════
// Manage Shares Modal
// ═══════════════════════════════════════════════════════════════════════════════
function ManageSharesModal({ onClose }) {
  const { showToast } = useToast()
  const [views,    setViews]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState(null)  // token for access log view
  const [accesses, setAccesses] = useState([])
  const [loadingAccesses, setLoadingAccesses] = useState(false)

  useEffect(() => { loadViews() }, [])

  async function loadViews() {
    setLoading(true)
    try {
      const res = await api.sharedViews.list()
      setViews(res.views || [])
    } catch {} finally { setLoading(false) }
  }

  async function toggleActive(view) {
    // Optimistic update — flip immediately, revert on error
    const next = !view.is_active
    setViews(vs => vs.map(v => v.token === view.token ? { ...v, is_active: next } : v))
    try {
      await api.sharedViews.update(view.token, { is_active: next })
      showToast(next ? 'Link enabled' : 'Link disabled', 'success')
    } catch (e) {
      // Revert
      setViews(vs => vs.map(v => v.token === view.token ? { ...v, is_active: view.is_active } : v))
      showToast(e.message || 'Failed to update', 'error')
    }
  }

  async function deleteView(token) {
    if (!confirm('Delete this share link? This cannot be undone.')) return
    // Optimistic remove
    const prev = views
    setViews(vs => vs.filter(v => v.token !== token))
    if (selected === token) setSelected(null)
    try {
      await api.sharedViews.delete(token)
      showToast('Link deleted', 'success')
    } catch (e) {
      setViews(prev)  // revert
      showToast(e.message || 'Failed to delete', 'error')
    }
  }

  async function viewAccesses(token) {
    if (selected === token) { setSelected(null); return }
    setSelected(token)
    setLoadingAccesses(true)
    try {
      const res = await api.sharedViews.accesses(token)
      setAccesses(res.accesses || [])
    } catch {} finally { setLoadingAccesses(false) }
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
              style={{ background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.25)' }}>
              <Link2 size={15} style={{ color: '#0ea5e9' }} />
            </div>
            <h2 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Manage Share Links</h2>
          </div>
          <button onClick={onClose} className="btn-icon p-1.5" style={{ color: 'var(--text-3)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-2">
          {loading && (
            <div className="flex justify-center py-10">
              <Loader2 size={20} className="animate-spin" style={{ color: 'var(--text-3)' }} />
            </div>
          )}

          {!loading && views.length === 0 && (
            <div className="text-center py-10 text-sm" style={{ color: 'var(--text-3)' }}>
              No share links created yet.
            </div>
          )}

          {views.map(v => {
            const expired  = isExpired(v.expires_at)
            const inactive = !v.is_active
            const url = `${window.location.origin}/view/${v.token}`
            return (
              <div key={v.token}>
                <div className="rounded-xl p-3 transition-all"
                  style={{
                    background: (expired || inactive) ? 'var(--bg-input)' : 'var(--card-bg)',
                    border: '1px solid var(--border)',
                    opacity: (expired || inactive) ? 0.7 : 1,
                  }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                          {v.title || `${Array.isArray(v.record_ids) ? v.record_ids.length : '?'} projects`}
                        </p>
                        {inactive && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                            style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>DISABLED</span>
                        )}
                        {expired && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                            style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>EXPIRED</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        <span className="text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>…/{v.token}</span>
                        <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                          Created {fmtDate(v.created_at)}
                        </span>
                        {v.expires_at && (
                          <span className="text-[11px] flex items-center gap-0.5" style={{ color: expired ? '#f59e0b' : 'var(--text-3)' }}>
                            <Clock size={9} /> {expired ? 'Expired' : 'Expires'} {fmtDate(v.expires_at)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                        <Eye size={11} /> {v.access_count}
                      </span>
                      <a href={url} target="_blank" rel="noopener noreferrer"
                        className="btn-icon p-1.5" title="Open" style={{ color: 'var(--text-3)' }}>
                        <ExternalLink size={12} />
                      </a>
                      <button onClick={() => toggleActive(v)} className="btn-icon p-1.5"
                        title={v.is_active ? 'Disable' : 'Enable'} style={{ color: v.is_active ? '#10b981' : 'var(--text-3)' }}>
                        {v.is_active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                      </button>
                      <button onClick={() => viewAccesses(v.token)} className="btn-icon p-1.5"
                        title="Access log" style={{ color: selected === v.token ? 'var(--accent)' : 'var(--text-3)' }}>
                        <MapPin size={12} />
                      </button>
                      <button onClick={() => deleteView(v.token)} className="btn-icon p-1.5" title="Delete"
                        style={{ color: 'rgba(239,68,68,0.6)' }}
                        onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                        onMouseLeave={e => e.currentTarget.style.color = 'rgba(239,68,68,0.6)'}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Access log expansion */}
                {selected === v.token && (
                  <div className="ml-3 mt-1 rounded-xl overflow-hidden"
                    style={{ border: '1px solid var(--border)', background: 'var(--bg-input)' }}>
                    <div className="px-3 py-2 text-xs font-bold" style={{ color: 'var(--text-2)', borderBottom: '1px solid var(--border)' }}>
                      Access Log — {accesses.length} entries
                    </div>
                    {loadingAccesses ? (
                      <div className="flex justify-center py-6">
                        <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-3)' }} />
                      </div>
                    ) : accesses.length === 0 ? (
                      <p className="text-xs text-center py-4" style={{ color: 'var(--text-3)' }}>No accesses yet</p>
                    ) : (
                      <div className="max-h-48 overflow-y-auto divide-y" style={{ borderColor: 'var(--border)' }}>
                        {accesses.map((a, i) => (
                          <div key={i} className="px-3 py-2 flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[11px] font-mono" style={{ color: 'var(--text-1)' }}>{a.ip || 'Unknown IP'}</span>
                                {a.country && <span className="text-[11px]" style={{ color: 'var(--text-2)' }}>{a.city ? `${a.city}, ` : ''}{a.country}</span>}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                {a.os     && <span className="text-[10px] flex items-center gap-0.5" style={{ color: 'var(--text-3)' }}><Monitor size={8} /> {a.os}</span>}
                                {a.browser && <span className="text-[10px] flex items-center gap-0.5" style={{ color: 'var(--text-3)' }}><Globe size={8} /> {a.browser}</span>}
                                {a.device_type && <span className="text-[10px] flex items-center gap-0.5" style={{ color: 'var(--text-3)' }}><Smartphone size={8} /> {a.device_type}</span>}
                                {a.isp    && <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>· {a.isp}</span>}
                              </div>
                            </div>
                            <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--text-3)' }}>
                              {fmtDate(a.accessed_at)}
                            </span>
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
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════════════════════════
export default function StatusBoard() {
  const { isEditor } = useAuth()
  const { showToast } = useToast()

  const [records,       setRecords]       = useState([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState(null)
  const [search,        setSearch]        = useState('')
  const [filterClient,  setFilterClient]  = useState('')
  const [expandedIds,   setExpandedIds]   = useState(new Set())
  const [selectedIds,   setSelectedIds]   = useState(new Set())
  const [modal,         setModal]         = useState(null)  // null | 'new' | record-obj
  const [saving,        setSaving]        = useState(false)
  const [deletingId,    setDeletingId]    = useState(null)
  const [aiModal,       setAiModal]       = useState(false)
  const [shareModal,    setShareModal]    = useState(false)
  const [manageModal,   setManageModal]   = useState(false)
  const [viewMode,      setViewMode]      = useState('card')  // 'card' | 'list' | 'board'
  const [filterStatus,  setFilterStatus]  = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await api.status.list()
      setRecords(res.records || [])
    } catch (e) {
      setError(e.message || 'Failed to load')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // Filtering
  const filtered = records.filter(r => {
    const f = r.fields || {}
    if (filterClient && f['Client'] !== filterClient) return false
    if (filterStatus && f['Status'] !== filterStatus) return false
    if (search) {
      const q = search.toLowerCase()
      const hay = [f['Client'], f['Project'], f['Short Status'], f['Current Status (Detailed)'], f['Status']].join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  // Group by client
  const grouped = filtered.reduce((acc, r) => {
    const cl = r.fields?.['Client'] || 'Unknown'
    if (!acc[cl]) acc[cl] = []
    acc[cl].push(r)
    return acc
  }, {})

  // Unique clients for filter
  const allClients = [...new Set(records.map(r => r.fields?.['Client']).filter(Boolean))].sort()

  // Selected records objects
  const selectedRecords = records.filter(r => selectedIds.has(r.id))

  function toggleSelect(id) {
    setSelectedIds(s => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function selectAll() {
    setSelectedIds(new Set(filtered.map(r => r.id)))
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  function toggleExpand(id) {
    setExpandedIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  // CRUD
  async function handleCreate(form) {
    setSaving(true)
    try {
      await api.status.create(form)
      showToast('Status update created', 'success')
      setModal(null)
      await load()
    } catch (e) { showToast(e.message || 'Failed to create', 'error') }
    finally { setSaving(false) }
  }

  async function handleEdit(form) {
    if (!modal?.id) return
    setSaving(true)
    try {
      await api.status.update(modal.id, form)
      showToast('Status update saved', 'success')
      setModal(null)
      await load()
    } catch (e) { showToast(e.message || 'Failed to save', 'error') }
    finally { setSaving(false) }
  }

  async function handleDelete(record) {
    if (!window.confirm(`Delete status for ${record.fields?.['Client']} / ${record.fields?.['Project']}?`)) return
    setDeletingId(record.id)
    try {
      await api.status.delete(record.id)
      showToast('Deleted', 'success')
      setRecords(rs => rs.filter(r => r.id !== record.id))
      setSelectedIds(s => { const n = new Set(s); n.delete(record.id); return n })
    } catch (e) { showToast(e.message || 'Failed to delete', 'error') }
    finally { setDeletingId(null) }
  }

  const hasSelection = selectedIds.size > 0

  return (
    <div className="relative min-h-screen">
      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5 pb-28">

        {/* ── Page header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(37,99,235,0.10)', border: '1px solid rgba(37,99,235,0.20)' }}>
              <Activity size={18} style={{ color: 'var(--accent)' }} />
            </div>
            <div>
              <h1 className="text-xl font-bold leading-tight" style={{ color: 'var(--text-1)' }}>Current Status</h1>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                {records.length} projects · {allClients.length} clients
                {hasSelection && <span className="ml-2 font-semibold" style={{ color: 'var(--accent)' }}>
                  · {selectedIds.size} selected
                </span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* View mode toggle */}
            <div className="flex items-center rounded-lg overflow-hidden"
              style={{ border: '1px solid var(--border)', background: 'var(--bg-input)' }}>
              {[
                { id: 'card',  Icon: LayoutGrid, title: 'Card view' },
                { id: 'list',  Icon: List,        title: 'List view' },
                { id: 'board', Icon: Columns,     title: 'Board view by status' },
              ].map(({ id, Icon, title }) => (
                <button key={id} onClick={() => setViewMode(id)} title={title}
                  className="p-1.5 transition-all"
                  style={{
                    color:      viewMode === id ? 'var(--accent)' : 'var(--text-3)',
                    background: viewMode === id ? 'var(--card-bg)' : 'transparent',
                  }}>
                  <Icon size={14} />
                </button>
              ))}
            </div>
            {isEditor && (
              <button onClick={() => setManageModal(true)}
                className="btn-ghost flex items-center gap-1.5 text-xs px-3 py-1.5">
                <Link2 size={12} /> <span className="hidden sm:inline">Manage Links</span>
              </button>
            )}
            <button onClick={load} disabled={loading} className="btn-icon p-2" title="Refresh" style={{ color: 'var(--text-3)' }}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            {isEditor && (
              <button onClick={() => setModal('new')} className="btn-primary flex items-center gap-2 text-sm px-3 py-1.5">
                <Plus size={13} /> Add
              </button>
            )}
          </div>
        </div>

        {/* ── Filter bar ── */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
            <input type="text" className="input-field w-full pl-8 text-sm"
              placeholder="Search client, project, or status…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="input-field text-sm sm:w-40"
            value={filterClient} onChange={e => setFilterClient(e.target.value)}>
            <option value="">All clients</option>
            {allClients.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input-field text-sm sm:w-40"
            value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {/* Select All toggle */}
          {filtered.length > 0 && isEditor && (
            <button
              onClick={hasSelection && selectedIds.size === filtered.length ? clearSelection : selectAll}
              className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5 whitespace-nowrap">
              <div className="w-3.5 h-3.5 rounded flex items-center justify-center"
                style={{
                  background: hasSelection && selectedIds.size === filtered.length ? 'var(--accent)' : 'var(--bg-input)',
                  border: `1.5px solid ${hasSelection && selectedIds.size === filtered.length ? 'var(--accent)' : 'var(--border)'}`,
                }}>
                {hasSelection && selectedIds.size === filtered.length && <Check size={9} color="#fff" strokeWidth={3} />}
              </div>
              {hasSelection && selectedIds.size === filtered.length ? 'Deselect all' : 'Select all'}
            </button>
          )}
        </div>

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

        {/* ── Empty ── */}
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

        {/* ── No filter results ── */}
        {!loading && !error && records.length > 0 && filtered.length === 0 && (
          <div className="text-center py-12">
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>No entries match your filter.</p>
            <button onClick={() => { setSearch(''); setFilterClient(''); setFilterStatus('') }}
              className="text-xs font-semibold mt-2" style={{ color: 'var(--accent)' }}>
              Clear filters
            </button>
          </div>
        )}

        {/* ── Card view (grouped by client) ── */}
        {!loading && !error && filtered.length > 0 && viewMode === 'card' &&
          Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([client, recs]) => {
            const clrHex = clientColor(client)
            const groupSelected = recs.filter(r => selectedIds.has(r.id)).length
            return (
              <section key={client} className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
                      style={{ background: hexToRgba(clrHex, 0.1), border: `1px solid ${hexToRgba(clrHex, 0.3)}`, color: clrHex }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: clrHex }} />
                      {client}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                      {recs.length} project{recs.length !== 1 ? 's' : ''}
                      {groupSelected > 0 && <span className="ml-1 font-semibold" style={{ color: clrHex }}>· {groupSelected} selected</span>}
                    </span>
                  </div>
                  {isEditor && recs.length > 1 && (
                    <button
                      onClick={() => {
                        const allGroupSelected = recs.every(r => selectedIds.has(r.id))
                        setSelectedIds(s => {
                          const n = new Set(s)
                          recs.forEach(r => allGroupSelected ? n.delete(r.id) : n.add(r.id))
                          return n
                        })
                      }}
                      className="text-[11px] font-medium px-2 py-0.5 rounded-lg transition-all"
                      style={{ color: 'var(--text-3)', background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                      {recs.every(r => selectedIds.has(r.id)) ? 'Deselect group' : 'Select group'}
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {recs.map(r => (
                    <StatusCard
                      key={r.id}
                      record={r}
                      isEditor={isEditor}
                      onEdit={() => setModal(r)}
                      onDelete={() => handleDelete(r)}
                      selected={selectedIds.has(r.id)}
                      onSelect={toggleSelect}
                      expanded={expandedIds.has(r.id)}
                      onToggle={() => toggleExpand(r.id)}
                      deleting={deletingId === r.id}
                    />
                  ))}
                </div>
              </section>
            )
          })
        }

        {/* ── List view ── */}
        {!loading && !error && filtered.length > 0 && viewMode === 'list' && (
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {/* Header row */}
            <div className="grid text-[11px] font-semibold uppercase tracking-wider px-4 py-2.5"
              style={{ background: 'var(--bg-input)', color: 'var(--text-3)', borderBottom: '1px solid var(--border)',
                gridTemplateColumns: '28px 1fr 1fr 130px 1fr auto' }}>
              <span />
              <span>Client</span>
              <span>Project</span>
              <span>Status</span>
              <span>Short Status</span>
              <span />
            </div>
            {filtered.map((r, i) => {
              const f = r.fields || {}
              const client  = f['Client']  || '?'
              const project = f['Project'] || '?'
              const short   = f['Short Status'] || ''
              const status  = f['Status'] || ''
              const clrHex  = clientColor(client)
              const sc      = statusStyle(status)
              const sel     = selectedIds.has(r.id)
              return (
                <div key={r.id}
                  className="grid items-center px-4 py-2.5 gap-2 transition-colors"
                  style={{
                    gridTemplateColumns: '28px 1fr 1fr 130px 1fr auto',
                    background: sel ? hexToRgba(clrHex, 0.06) : (i % 2 === 0 ? 'var(--card-bg)' : 'var(--bg-input)'),
                    borderBottom: '1px solid var(--border)',
                  }}>
                  {/* Checkbox */}
                  {isEditor ? (
                    <button onClick={() => toggleSelect(r.id)}
                      className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-all"
                      style={{ background: sel ? clrHex : 'transparent', border: `2px solid ${sel ? clrHex : 'var(--border)'}` }}>
                      {sel && <Check size={10} color="#fff" strokeWidth={3} />}
                    </button>
                  ) : <span />}
                  {/* Client */}
                  <span className="text-xs font-bold truncate" style={{ color: clrHex }}>{client}</span>
                  {/* Project */}
                  <span className="text-xs font-medium truncate" style={{ color: 'var(--text-1)' }}>{project}</span>
                  {/* Status badge */}
                  <span>
                    {status && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                        style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.dot }} />
                        {status}
                      </span>
                    )}
                  </span>
                  {/* Short status */}
                  <span className="text-xs truncate" style={{ color: 'var(--text-2)' }}>{short}</span>
                  {/* Actions */}
                  {isEditor && (
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => setModal(r)} className="btn-icon p-1" title="Edit" style={{ color: 'var(--text-3)' }}>
                        <Pencil size={12} />
                      </button>
                      <button onClick={() => handleDelete(r)} className="btn-icon p-1" title="Delete"
                        style={{ color: 'rgba(239,68,68,0.5)' }}
                        onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                        onMouseLeave={e => e.currentTarget.style.color = 'rgba(239,68,68,0.5)'}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ── Board view (kanban by Status) ── */}
        {!loading && !error && filtered.length > 0 && viewMode === 'board' && (
          <div className="overflow-x-auto -mx-4 px-4 pb-4">
            <div className="flex gap-3" style={{ minWidth: `${STATUS_OPTIONS.length * 240}px` }}>
              {STATUS_OPTIONS.map(statusKey => {
                const sc   = statusStyle(statusKey)
                const recs = filtered.filter(r => (r.fields?.['Status'] || 'Not started') === statusKey)
                return (
                  <div key={statusKey} className="flex-1 min-w-[220px]">
                    {/* Column header */}
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl mb-2"
                      style={{ background: sc.bg, border: `1px solid ${sc.border}` }}>
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: sc.dot }} />
                      <span className="text-xs font-bold flex-1 truncate" style={{ color: sc.color }}>{statusKey}</span>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                        style={{ background: 'rgba(255,255,255,0.2)', color: sc.color }}>{recs.length}</span>
                    </div>
                    {/* Cards in column */}
                    <div className="space-y-2">
                      {recs.length === 0 && (
                        <div className="text-center py-6 text-[11px]" style={{ color: 'var(--text-3)' }}>
                          No projects
                        </div>
                      )}
                      {recs.map(r => {
                        const f = r.fields || {}
                        const client  = f['Client']  || '?'
                        const project = f['Project'] || '?'
                        const short   = f['Short Status'] || ''
                        const clrHex  = clientColor(client)
                        const sel     = selectedIds.has(r.id)
                        return (
                          <div key={r.id} className="rounded-xl p-3 transition-all"
                            style={{
                              background: sel ? hexToRgba(clrHex, 0.08) : 'var(--card-bg)',
                              border: sel ? `1.5px solid ${clrHex}` : '1px solid var(--border)',
                              boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                            }}>
                            <div className="flex items-start gap-2 mb-1.5">
                              {isEditor && (
                                <button onClick={() => toggleSelect(r.id)}
                                  className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center mt-0.5 transition-all"
                                  style={{ background: sel ? clrHex : 'transparent', border: `1.5px solid ${sel ? clrHex : 'var(--border)'}` }}>
                                  {sel && <Check size={8} color="#fff" strokeWidth={3} />}
                                </button>
                              )}
                              <div className="flex-1 min-w-0">
                                <span className="text-[10px] font-bold" style={{ color: clrHex }}>{client}</span>
                                <p className="text-xs font-semibold leading-snug mt-0.5" style={{ color: 'var(--text-1)' }}>{project}</p>
                              </div>
                              {isEditor && (
                                <button onClick={() => setModal(r)} className="btn-icon p-0.5 flex-shrink-0" style={{ color: 'var(--text-3)' }}>
                                  <Pencil size={11} />
                                </button>
                              )}
                            </div>
                            {short && (
                              <p className="text-[11px] leading-snug" style={{ color: 'var(--text-2)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                {short}
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
          </div>
        )}
      </div>

      {/* ── Floating action bar (shows when items selected) ── */}
      {hasSelection && isEditor && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 pointer-events-none"
          style={{ width: 'calc(100% - 2rem)', maxWidth: '560px' }}>
          <div className="pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-2xl shadow-xl"
            style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--border)',
              boxShadow: '0 8px 32px rgba(15,23,42,0.2), 0 0 0 1px rgba(255,255,255,0.05)',
            }}>
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
                style={{ background: 'rgba(139,92,246,0.12)', color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.25)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(139,92,246,0.2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(139,92,246,0.12)'}>
                <Sparkles size={13} /> AI Update
              </button>
              <button onClick={() => setShareModal(true)}
                className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-xl transition-all"
                style={{ background: 'rgba(14,165,233,0.12)', color: '#0ea5e9', border: '1px solid rgba(14,165,233,0.25)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(14,165,233,0.2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(14,165,233,0.12)'}>
                <Share2 size={13} /> Share
              </button>
              <button onClick={clearSelection} className="btn-icon p-1.5" title="Clear selection" style={{ color: 'var(--text-3)' }}>
                <X size={15} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modals ── */}
      {modal && (
        <StatusModal
          initial={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSave={modal === 'new' ? handleCreate : handleEdit}
          saving={saving}
          allRecords={records}
        />
      )}
      {aiModal && (
        <AIUpdateModal
          selectedRecords={selectedRecords}
          onClose={() => setAiModal(false)}
          onShare={() => setShareModal(true)}
        />
      )}
      {shareModal && (
        <ShareModal
          selectedRecords={selectedRecords}
          onClose={() => setShareModal(false)}
        />
      )}
      {manageModal && (
        <ManageSharesModal onClose={() => setManageModal(false)} />
      )}
    </div>
  )
}
