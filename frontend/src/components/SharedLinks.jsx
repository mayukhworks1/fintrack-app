import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Check, CheckCheck, Clock, Copy, ExternalLink, Eye, Globe, Link2,
  Loader2, MapPin, Monitor, Pencil, Shield, Smartphone, ToggleLeft,
  ToggleRight, Trash2, X, Share2, Search, Filter, CheckSquare, Square, RefreshCw,
} from 'lucide-react'
import { api } from '../services/api'
import { useToast } from '../context/ToastContext'

const EXPIRY_OPTS = [
  { label: 'Never', value: 0 },
  { label: '1 hour', value: 1 },
  { label: '24 hours', value: 24 },
  { label: '3 days', value: 72 },
  { label: '7 days', value: 168 },
  { label: '30 days', value: 720 },
]

const MAX_SHARED_VIEW_RECORDS = 50

const DEFAULT_LABELS = {
  status: 'project',
  projects: 'project',
  invoices: 'invoice',
  'tax-ledger': 'invoice',
}

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

function isExpired(iso) {
  if (!iso) return false
  return new Date(iso) < new Date()
}

function defaultRecordChip(record, resourceType) {
  const f = record?.fields || {}
  if (resourceType === 'invoices' || resourceType === 'tax-ledger') {
    return `${f['Invoice Number'] || 'No number'} · ${f['Project'] || 'No project'}`
  }
  if (resourceType === 'projects') {
    return `${f['Client'] || 'No client'} · ${f['Project Name'] || 'No project'}`
  }
  return `${f['Client'] || 'No client'} · ${f['Project'] || 'No project'}`
}

function summarizeShareScope(view, resourceType = 'status', fallbackCount = 0) {
  const noun = DEFAULT_LABELS[resourceType] || 'record'
  const vc = view?.view_config || {}
  const parts = []
  if (view?.is_dynamic) {
    parts.push('Live')
    if (vc.filterClient) parts.push(`Client: ${vc.filterClient}`)
    if (vc.filterProject) parts.push(`Project: ${vc.filterProject}`)
    if (vc.filterCategory) parts.push(`Category: ${vc.filterCategory}`)
    if (vc.filterStatus) parts.push(`Status: ${vc.filterStatus}`)
    if (vc.raisedByFilter) parts.push(`Raised by: ${vc.raisedByFilter}`)
    if (vc.monthFilter) parts.push(`Month: ${vc.monthFilter}`)
    if (vc.agingBandFilter) parts.push(`Aging: ${vc.agingBandFilter}`)
    if (vc.dateFieldFilter && (vc.dateFrom || vc.dateTo)) {
      parts.push(`${vc.dateFieldFilter}: ${vc.dateFrom || '…'} → ${vc.dateTo || '…'}`)
    }
    if (vc.billingFilter && vc.billingFilter !== 'all') parts.push(`Scope: ${vc.billingFilter}`)
    if (vc.invoiceScope && vc.invoiceScope !== 'tax') parts.push(`Invoice scope: ${vc.invoiceScope}`)
    if (vc.periodLabel) parts.push(`Period: ${vc.periodLabel}`)
    if (vc.periodFrom || vc.periodTo) parts.push(`Date: ${vc.periodFrom || '…'} → ${vc.periodTo || '…'}`)
    if (vc.overdueOnly) parts.push('Outstanding only')
    if (vc.hasDocsOnly) parts.push('With docs only')
    if (vc.followupDueOnly) parts.push('Follow-up due')
    const safeSearch = normalizeSearchSummary(vc.search)
    if (safeSearch) parts.push(`Search: "${safeSearch}"`)
  } else {
    const count = Array.isArray(view?.record_ids) ? view.record_ids.length : fallbackCount
    parts.push(`Snapshot · ${count} ${noun}${count === 1 ? '' : 's'}`)
  }
  return parts.join(' · ')
}

function normalizeSearchSummary(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.includes('[native code]')) return ''
  if (/^function\s+\w*\s*\(/i.test(trimmed)) return ''
  return trimmed.slice(0, 120)
}

function normalizeHighlightColumns(columns, allowedColumns = []) {
  if (!Array.isArray(columns) || !allowedColumns.length) return []
  const allowed = new Set(allowedColumns)
  return columns.filter((col, index) => typeof col === 'string' && allowed.has(col) && columns.indexOf(col) === index)
}

export function ShareLinkModal({
  resourceType = 'status',
  selectedRecords = [],
  viewConfig = null,
  title: defaultTitle = '',
  recordLabel,
  highlightableColumns = [],
  enableLiveMode = false,
  allowEdit = true,
  onClose,
}) {
  const [step, setStep] = useState('form')
  const [title, setTitle] = useState(defaultTitle)
  const [expiry, setExpiry] = useState(0)
  const [accessMode, setAccessMode] = useState('read')
  const [mode, setMode] = useState(enableLiveMode ? 'live' : 'snapshot')
  const [highlightColumns, setHighlightColumns] = useState(() => normalizeHighlightColumns(viewConfig?.highlightColumns, highlightableColumns))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [shareData, setShareData] = useState(null)
  const [copied, setCopied] = useState(false)
  const noun = recordLabel || DEFAULT_LABELS[resourceType] || 'record'
  const shareUrl = shareData ? `${window.location.origin}/view/${shareData.token}` : ''

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  useEffect(() => {
    setHighlightColumns(normalizeHighlightColumns(viewConfig?.highlightColumns, highlightableColumns))
  }, [viewConfig, highlightableColumns])

  async function createShare() {
    setSaving(true)
    setError(null)
    try {
      const isLive = enableLiveMode && mode === 'live'
      if (!isLive && !selectedRecords.length) throw new Error(`No ${noun}s selected to share.`)
      if (!isLive && selectedRecords.length > MAX_SHARED_VIEW_RECORDS) {
        throw new Error(`Public sharing is limited to ${MAX_SHARED_VIEW_RECORDS} records. Narrow the current view first.`)
      }
      const payload = {
        title: title.trim() || null,
        record_ids: isLive ? ['__dynamic__'] : selectedRecords.map(r => r.id),
        expires_hours: expiry || null,
        access_mode: accessMode,
        resource_type: resourceType,
      }
      if (viewConfig) payload.view_config = { ...viewConfig, highlightColumns }
      const data = await api.sharedViews.create(payload)
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
    setTimeout(() => setCopied(false), 2200)
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(5,10,20,0.82)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', maxHeight: '92vh' }}>
        {/* sticky header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.25)' }}>
              <Share2 size={15} style={{ color: '#0ea5e9' }} />
            </div>
            <div>
              <h2 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{step === 'form' ? 'Share Current View' : 'Link Ready'}</h2>
              <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                {selectedRecords.length} {noun}{selectedRecords.length !== 1 ? 's' : ''} · no login needed
              </p>
            </div>
          </div>
          <button aria-label="Close" onClick={onClose} className="btn-icon p-1.5" style={{ color: 'var(--text-3)' }}><X size={16} /></button>
        </div>

        {/* scrollable body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4" style={{ WebkitOverflowScrolling: 'touch' }}>
          {step === 'form' && (
            <>
              {enableLiveMode && viewConfig && (
                <div>
                  <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-2)' }}>Scope mode</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { id: 'live', label: 'Live current view', hint: 'Same URL always re-fetches matching Teable data.' },
                      { id: 'snapshot', label: 'Snapshot current view', hint: `Freeze the ${selectedRecords.length} visible ${noun}${selectedRecords.length === 1 ? '' : 's'} right now.` },
                    ].map(opt => (
                      <button key={opt.id} type="button" onClick={() => setMode(opt.id)}
                        className="rounded-xl px-3 py-2 text-left transition-all"
                        style={{
                          background: mode === opt.id ? 'var(--accent-dim)' : 'var(--bg-input)',
                          border: `1px solid ${mode === opt.id ? 'var(--accent-soft)' : 'var(--border)'}`,
                        }}>
                        <p className="text-xs font-semibold" style={{ color: mode === opt.id ? 'var(--accent)' : 'var(--text-2)' }}>{opt.label}</p>
                        <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>{opt.hint}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {selectedRecords.slice(0, 8).map(r => (
                  <span key={r.id} className="text-[11px] px-2 py-0.5 rounded-lg font-medium"
                    style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                    {defaultRecordChip(r, resourceType)}
                  </span>
                ))}
                {selectedRecords.length > 8 && <span className="text-[11px] px-2 py-0.5 rounded-lg" style={{ color: 'var(--text-3)' }}>+{selectedRecords.length - 8} more</span>}
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>Link title</label>
                <div
                  className="rounded-2xl p-2"
                  style={{ background: 'rgba(37,99,235,0.04)', border: '1px solid rgba(37,99,235,0.16)' }}
                >
                  <input type="text" className="input-field w-full text-sm font-medium" value={title}
                    onChange={e => setTitle(e.target.value)} placeholder={`e.g. Shared ${noun} view`} maxLength={200}
                    style={{ borderColor: 'rgba(37,99,235,0.18)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45)' }} />
                </div>
              </div>
              {highlightableColumns.length > 0 && (
                <div
                  className="rounded-2xl p-3"
                  style={{ background: 'rgba(15,23,42,0.025)', border: '1px solid var(--border)' }}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <label className="block text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                        Highlight columns in shared view
                      </label>
                      <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>
                        Pick the columns you want visually emphasized on the shared invoice page.
                      </p>
                    </div>
                    <span className="text-[10px] px-2 py-1 rounded-full"
                      style={{ background: 'var(--bg-input)', color: 'var(--text-3)', border: '1px solid var(--border)' }}>
                      {highlightColumns.length} selected
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {highlightableColumns.map((column) => {
                      const active = highlightColumns.includes(column)
                      return (
                        <button
                          key={column}
                          type="button"
                          onClick={() => setHighlightColumns((current) => active ? current.filter((item) => item !== column) : [...current, column])}
                          className="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-all"
                          style={{
                            background: active ? 'var(--accent-dim)' : 'var(--bg-input)',
                            color: active ? 'var(--accent)' : 'var(--text-2)',
                            border: `1px solid ${active ? 'var(--accent-soft)' : 'var(--border)'}`,
                          }}
                        >
                          {column}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-2)' }}>Expires</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {EXPIRY_OPTS.map(opt => (
                    <button key={opt.value} type="button" onClick={() => setExpiry(opt.value)}
                      className="py-1.5 rounded-xl text-xs font-semibold transition-all"
                      style={{
                        background: expiry === opt.value ? 'var(--accent)' : 'var(--bg-input)',
                        color: expiry === opt.value ? '#fff' : 'var(--text-2)',
                        border: `1px solid ${expiry === opt.value ? 'var(--accent)' : 'var(--border)'}`,
                      }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-2)' }}>Access</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { id: 'read', label: 'Read only', hint: 'Recipients can view, filter, and switch layouts.' },
                    allowEdit ? { id: 'edit', label: 'Can edit', hint: 'Recipients can update the fields allowed for this module.' } : null,
                  ].filter(Boolean).map(opt => (
                    <button key={opt.id} type="button" onClick={() => setAccessMode(opt.id)}
                      className="rounded-xl px-3 py-2 text-left transition-all"
                      style={{
                        background: accessMode === opt.id ? 'var(--accent-dim)' : 'var(--bg-input)',
                        border: `1px solid ${accessMode === opt.id ? 'var(--accent-soft)' : 'var(--border)'}`,
                      }}>
                      <p className="text-xs font-semibold" style={{ color: accessMode === opt.id ? 'var(--accent)' : 'var(--text-2)' }}>{opt.label}</p>
                      <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>{opt.hint}</p>
                    </button>
                  ))}
                </div>
              </div>
              {error && <p className="text-xs p-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>{error}</p>}
              <div className="flex items-start gap-2 p-3 rounded-xl" style={{ background: 'rgba(14,165,233,0.06)', border: '1px solid rgba(14,165,233,0.15)' }}>
                <Shield size={13} style={{ color: '#0ea5e9', marginTop: 1, flexShrink: 0 }} />
                <p className="text-[11px]" style={{ color: 'var(--text-2)' }}>
                  {enableLiveMode && mode === 'live'
                    ? `This creates a live public view of the current ${noun} filters. It re-fetches matching Teable data automatically, and logs unique viewers and edit events separately.`
                    : `This creates a public snapshot of the currently visible ${noun}${selectedRecords.length !== 1 ? 's' : ''}. Unique viewers are counted without inflating on every refresh, and edit events are logged separately.`}
                </p>
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
                  <p className="font-bold text-base" style={{ color: 'var(--text-1)' }}>Link ready</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Share this URL — no login required.</p>
                  {enableLiveMode && mode === 'live' && (
                    <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full text-[10px] font-bold"
                      style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Live · updates from Teable
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-xl" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                <Link2 size={13} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                <p className="text-xs font-mono flex-1 truncate" style={{ color: 'var(--text-1)' }}>{shareUrl}</p>
                <button onClick={copyUrl} className="flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg"
                  style={{ background: copied ? 'rgba(16,185,129,0.12)' : 'var(--card-bg)', color: copied ? '#10b981' : 'var(--accent)', border: '1px solid var(--border)' }}>
                  {copied ? <CheckCheck size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              {shareData.expires_at && (
                <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
                  <Clock size={11} /> Expires {fmtDate(shareData.expires_at)}
                </p>
              )}
            </>
          )}
        </div>

        {/* sticky footer — always visible */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          {step === 'form' && (
            <>
              <button onClick={onClose} className="btn-ghost text-sm px-4 py-2">Cancel</button>
              <button onClick={createShare} disabled={saving || (mode === 'snapshot' && (selectedRecords.length > MAX_SHARED_VIEW_RECORDS || selectedRecords.length === 0))} className="btn-primary flex items-center gap-2 text-sm px-4 py-2">
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />} Generate Link
              </button>
            </>
          )}
          {step === 'created' && shareData && (
            <>
              <a href={shareUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--accent)' }}>
                <ExternalLink size={11} /> Preview
              </a>
              <button onClick={onClose} className="btn-primary text-sm px-4 py-2">Done</button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

function ScopeEditorModal({ view, resourceType, currentViewConfig, visibleRecords, recordLabel, highlightableColumns = [], onClose, onSave }) {
  const [mode, setMode] = useState(view?.is_dynamic ? 'live' : 'snapshot')
  const [highlightColumns, setHighlightColumns] = useState(() => normalizeHighlightColumns(view?.view_config?.highlightColumns || currentViewConfig?.highlightColumns, highlightableColumns))
  const [saving, setSaving] = useState(false)
  const { showToast } = useToast()
  if (!view) return null
  const noun = recordLabel || DEFAULT_LABELS[resourceType] || 'record'
  const visibleCount = visibleRecords.length
  const snapshotTooLarge = visibleCount > MAX_SHARED_VIEW_RECORDS
  const currentScope = summarizeShareScope(view, resourceType)
  const newScope = mode === 'live'
    ? summarizeShareScope({ is_dynamic: true, view_config: currentViewConfig }, resourceType)
    : `Snapshot · ${visibleCount} ${noun}${visibleCount === 1 ? '' : 's'}`

  useEffect(() => {
    setHighlightColumns(normalizeHighlightColumns(view?.view_config?.highlightColumns || currentViewConfig?.highlightColumns, highlightableColumns))
  }, [view, currentViewConfig, highlightableColumns])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  async function handleSave() {
    if (!currentViewConfig) {
      showToast('Current view is unavailable.', 'error')
      return
    }
    if (visibleCount <= 0) {
      showToast(`No visible ${noun}s in the current view to save.`, 'error')
      return
    }
    if (mode === 'snapshot' && snapshotTooLarge) {
      showToast(`Snapshot links are limited to ${MAX_SHARED_VIEW_RECORDS} ${noun}s. Narrow the current view first.`, 'error')
      return
    }
    setSaving(true)
    try {
      const nextViewConfig = { ...(currentViewConfig || {}), highlightColumns }
      const patch = mode === 'live'
        ? { record_ids: ['__dynamic__'], view_config: nextViewConfig }
        : { record_ids: visibleRecords.map(r => r.id), view_config: nextViewConfig }
      await onSave(patch)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(5,10,20,0.82)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', maxHeight: '92vh' }}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <h3 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Edit Link Scope</h3>
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>You are updating one existing public URL, not creating a new one.</p>
          </div>
          <button aria-label="Close" onClick={onClose} className="btn-icon p-1.5" style={{ color: 'var(--text-3)' }}><X size={16} /></button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-4" style={{ WebkitOverflowScrolling: 'touch' }}>
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
              <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>{visibleCount} visible {noun}{visibleCount === 1 ? '' : 's'}</p>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-2)' }}>Replace with</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {[
                { id: 'live', label: 'Live current view', hint: 'Same URL, always re-fetches matching Teable data from this view.' },
                { id: 'snapshot', label: 'Snapshot current view', hint: `Same URL, fixed to the ${visibleCount} visible ${noun}${visibleCount === 1 ? '' : 's'} right now.` },
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
                  }}>
                  <p className="text-xs font-semibold" style={{ color: mode === opt.id ? 'var(--accent)' : 'var(--text-2)' }}>{opt.label}</p>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>{opt.hint}</p>
                </button>
              ))}
            </div>
            {snapshotTooLarge && (
              <p className="text-[11px] mt-2" style={{ color: '#ef4444' }}>
                Snapshot update is limited to {MAX_SHARED_VIEW_RECORDS} {noun}s. Narrow the current view or use a live scope.
              </p>
            )}
          </div>
          <div className="rounded-xl p-3" style={{ background: 'rgba(14,165,233,0.06)', border: '1px solid rgba(14,165,233,0.15)' }}>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>New scope summary</p>
            <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>{newScope}</p>
          </div>
          {highlightableColumns.length > 0 && (
            <div className="rounded-2xl p-3" style={{ background: 'rgba(15,23,42,0.025)', border: '1px solid var(--border)' }}>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <label className="block text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                    Highlight columns in shared view
                  </label>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>
                    Update the same link so these columns stay emphasized in the public invoice view.
                  </p>
                </div>
                <span className="text-[10px] px-2 py-1 rounded-full"
                  style={{ background: 'var(--bg-input)', color: 'var(--text-3)', border: '1px solid var(--border)' }}>
                  {highlightColumns.length} selected
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {highlightableColumns.map((column) => {
                  const active = highlightColumns.includes(column)
                  return (
                    <button
                      key={column}
                      type="button"
                      onClick={() => setHighlightColumns((current) => active ? current.filter((item) => item !== column) : [...current, column])}
                      className="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-all"
                      style={{
                        background: active ? 'var(--accent-dim)' : 'var(--bg-input)',
                        color: active ? 'var(--accent)' : 'var(--text-2)',
                        border: `1px solid ${active ? 'var(--accent-soft)' : 'var(--border)'}`,
                      }}
                    >
                      {column}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
        {/* sticky footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} className="btn-ghost text-sm px-4 py-2">Cancel</button>
          <button onClick={handleSave} disabled={saving || visibleCount <= 0 || (mode === 'snapshot' && snapshotTooLarge)} className="btn-primary flex items-center gap-2 text-sm px-4 py-2">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Update Link
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export function ManageSharedLinksModal({ resourceType = 'status', currentViewConfig = null, visibleRecords = [], recordLabel, highlightableColumns = [], onClose }) {
  const { showToast } = useToast()
  const [views, setViews] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [scopeEditor, setScopeEditor] = useState(null)
  const [accessesByToken, setAccessesByToken] = useState({})
  const [loadingAccessToken, setLoadingAccessToken] = useState('')
  const [updatingTokens, setUpdatingTokens] = useState(() => new Set())
  const [togglingTokens, setTogglingTokens] = useState(() => new Set())
  const [deletingTokens, setDeletingTokens] = useState(() => new Set())
  const [accessFiltersByToken, setAccessFiltersByToken] = useState({})
  const [selectedAccessIdsByToken, setSelectedAccessIdsByToken] = useState({})
  const [deletingAccessesByToken, setDeletingAccessesByToken] = useState(() => new Set())

  useEffect(() => { loadViews() }, [resourceType])
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  async function loadViews() {
    setLoading(true)
    try {
      const r = await api.sharedViews.list(resourceType)
      setViews(r.views || [])
    } finally {
      setLoading(false)
    }
  }

  async function toggleActive(view) {
    const next = !view.is_active
    setTogglingTokens(tokens => new Set(tokens).add(view.token))
    setViews(vs => vs.map(v => v.token === view.token ? { ...v, is_active: next } : v))
    try {
      const updated = await api.sharedViews.update(view.token, { is_active: next })
      setViews(vs => vs.map(v => v.token === view.token ? { ...v, ...(updated || {}), is_active: updated?.is_active ?? next } : v))
      showToast(next ? 'Link enabled' : 'Link disabled', 'success')
    } catch (e) {
      setViews(vs => vs.map(v => v.token === view.token ? { ...v, is_active: view.is_active } : v))
      showToast(e.message || 'Failed', 'error')
    } finally {
      setTogglingTokens(tokens => {
        const nextTokens = new Set(tokens)
        nextTokens.delete(view.token)
        return nextTokens
      })
    }
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
    if (!confirm('Delete this share link?')) return
    const prev = views
    setDeletingTokens(tokens => new Set(tokens).add(token))
    setViews(vs => vs.filter(v => v.token !== token))
    if (selected === token) setSelected(null)
    try {
      await api.sharedViews.delete(token)
      showToast('Deleted', 'success')
    } catch (e) {
      setViews(prev)
      showToast(e.message || 'Failed', 'error')
    } finally {
      setDeletingTokens(tokens => {
        const nextTokens = new Set(tokens)
        nextTokens.delete(token)
        return nextTokens
      })
    }
  }

  async function viewAccesses(token) {
    if (selected === token) { setSelected(null); return }
    setSelected(token)
    if (accessesByToken[token]) return
    setLoadingAccessToken(token)
    try {
      const r = await api.sharedViews.accesses(token)
      setAccessesByToken(prev => ({ ...prev, [token]: r.accesses || [] }))
    } finally {
      setLoadingAccessToken('')
    }
  }

  function accessFilterState(token) {
    return accessFiltersByToken[token] || { q: '', event: '' }
  }

  function setAccessFilter(token, patch) {
    setAccessFiltersByToken(prev => ({
      ...prev,
      [token]: { ...accessFilterState(token), ...patch },
    }))
  }

  function selectedAccessIds(token) {
    return selectedAccessIdsByToken[token] || []
  }

  function filteredAccesses(token) {
    const filters = accessFilterState(token)
    const q = (filters.q || '').trim().toLowerCase()
    const event = filters.event || ''
    const accesses = accessesByToken[token] || []
    return accesses.filter(a => {
      if (event && String(a.event_type || 'view') !== event) return false
      if (!q) return true
      const hay = [
        a.ip,
        a.city,
        a.region,
        a.country,
        a.device_label,
        a.os,
        a.browser,
        a.device_type,
        a.record_id,
        a.geo_source,
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }

  function toggleAccessRow(token, id) {
    setSelectedAccessIdsByToken(prev => {
      const next = new Set(prev[token] || [])
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ...prev, [token]: [...next] }
    })
  }

  function toggleSelectAllFiltered(token) {
    const filtered = filteredAccesses(token)
    const filteredIds = filtered.map(a => a.id)
    const current = new Set(selectedAccessIds(token))
    const allSelected = filteredIds.length > 0 && filteredIds.every(id => current.has(id))
    setSelectedAccessIdsByToken(prev => ({
      ...prev,
      [token]: allSelected ? (prev[token] || []).filter(id => !filteredIds.includes(id)) : [...new Set([...(prev[token] || []), ...filteredIds])],
    }))
  }

  async function deleteSelectedAccesses(token) {
    const ids = selectedAccessIds(token)
    if (!ids.length) return
    if (!confirm(`Delete ${ids.length} selected activity record${ids.length !== 1 ? 's' : ''}?`)) return
    setDeletingAccessesByToken(tokens => new Set(tokens).add(token))
    try {
      await api.sharedViews.deleteAccesses(token, ids)
      setAccessesByToken(prev => ({
        ...prev,
        [token]: (prev[token] || []).filter(a => !ids.includes(a.id)),
      }))
      setSelectedAccessIdsByToken(prev => ({ ...prev, [token]: [] }))
      showToast(`Deleted ${ids.length} activity record${ids.length !== 1 ? 's' : ''}`, 'success')
    } catch (e) {
      showToast(e.message || 'Failed to delete activity', 'error')
    } finally {
      setDeletingAccessesByToken(tokens => {
        const next = new Set(tokens)
        next.delete(token)
        return next
      })
    }
  }

  async function saveScopeUpdate(view, patch) {
    const prev = { ...view }
    const nextView = {
      ...view,
      ...patch,
      is_dynamic: Array.isArray(patch.record_ids) && patch.record_ids.length === 1 && patch.record_ids[0] === '__dynamic__',
    }
    setViews(vs => vs.map(v => v.token === view.token ? nextView : v))
    try {
      const updated = await api.sharedViews.update(view.token, patch)
      setViews(vs => vs.map(v => v.token === view.token ? { ...v, ...(updated || nextView) } : v))
      showToast('Link scope updated', 'success')
    } catch (e) {
      setViews(vs => vs.map(v => v.token === view.token ? prev : v))
      showToast(e.message || 'Failed to update scope', 'error')
    }
  }

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
          <button aria-label="Close" onClick={onClose} className="btn-icon p-1.5" style={{ color: 'var(--text-3)' }}><X size={16} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-2">
          {loading && <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--text-3)' }} /></div>}
          {!loading && views.length === 0 && <div className="text-center py-10 text-sm" style={{ color: 'var(--text-3)' }}>No share links yet.</div>}
          {views.map(v => {
            const expired = isExpired(v.expires_at)
            const inactive = !v.is_active
            const updatingMode = updatingTokens.has(v.token)
            const toggling = togglingTokens.has(v.token)
            const deleting = deletingTokens.has(v.token)
            const url = `${window.location.origin}/view/${v.token}`
            const accesses = accessesByToken[v.token] || []
            const filtered = filteredAccesses(v.token)
            const selectedIds = selectedAccessIds(v.token)
            const deletingAccesses = deletingAccessesByToken.has(v.token)
            const allFilteredSelected = filtered.length > 0 && filtered.every(a => selectedIds.includes(a.id))
            return (
              <div key={v.token}>
                <div className="rounded-xl p-3 transition-all"
                  style={{ background: (expired || inactive) ? 'var(--bg-input)' : 'var(--card-bg)', border: '1px solid var(--border)', opacity: (expired || inactive) ? 0.7 : 1 }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                          {v.title || `${Array.isArray(v.record_ids) ? v.record_ids.length : '?'} records`}
                        </p>
                        {inactive && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>DISABLED</span>}
                        {expired && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>EXPIRED</span>}
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(148,163,184,0.12)', color: 'var(--text-3)' }}>
                          {(v.resource_type || resourceType || 'status').toUpperCase()}
                        </span>
                        {v.is_dynamic && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>LIVE</span>}
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: v.access_mode === 'edit' ? 'rgba(59,130,246,0.1)' : 'rgba(148,163,184,0.12)', color: v.access_mode === 'edit' ? '#2563eb' : 'var(--text-3)' }}>
                          {v.access_mode === 'edit' ? 'CAN EDIT' : 'READ ONLY'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        <span className="text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>…/{v.token}</span>
                        <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>Unique viewers {v.access_count || 0}</span>
                        <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>Created {fmtDate(v.created_at)}</span>
                        <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>{summarizeShareScope(v, resourceType)}</span>
                        {v.expires_at && <span className="text-[11px] flex items-center gap-0.5" style={{ color: expired ? '#f59e0b' : 'var(--text-3)' }}><Clock size={9} /> {expired ? 'Expired' : 'Expires'} {fmtDate(v.expires_at)}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <a href={url} target="_blank" rel="noopener noreferrer" className="btn-icon p-1.5" style={{ color: 'var(--text-3)' }}><ExternalLink size={12} /></a>
                      <button onClick={() => toggleActive(v)} disabled={toggling || deleting} className="btn-icon p-1.5" style={{ color: v.is_active ? '#10b981' : 'var(--text-3)', opacity: toggling ? 0.75 : 1 }} title={v.is_active ? 'Disable' : 'Enable'}>
                        {toggling ? <Loader2 size={14} className="animate-spin" /> : (v.is_active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />)}
                      </button>
                      <div className="flex items-center rounded-lg p-0.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                        <button onClick={() => setAccessMode(v, 'read')} disabled={updatingMode || deleting}
                          className="px-2 py-1 rounded-md text-[10px] font-semibold transition"
                          style={{ color: v.access_mode === 'read' ? '#1f2937' : 'var(--text-3)', background: v.access_mode === 'read' ? 'var(--card-bg)' : 'transparent', opacity: updatingMode ? 0.72 : 1 }}>
                          View
                        </button>
                        <button onClick={() => setAccessMode(v, 'edit')} disabled={updatingMode || deleting}
                          className="px-2 py-1 rounded-md text-[10px] font-semibold transition flex items-center gap-1"
                          style={{ color: v.access_mode === 'edit' ? '#2563eb' : 'var(--text-3)', background: v.access_mode === 'edit' ? 'rgba(59,130,246,0.12)' : 'transparent', opacity: updatingMode ? 0.72 : 1 }}>
                          Edit
                          {updatingMode && <Loader2 size={9} className="animate-spin" />}
                        </button>
                      </div>
                      <button onClick={() => viewAccesses(v.token)} className="btn-icon p-1.5" style={{ color: selected === v.token ? 'var(--accent)' : 'var(--text-3)' }}>
                        {loadingAccessToken === v.token ? <Loader2 size={12} className="animate-spin" /> : <MapPin size={12} />}
                      </button>
                      {currentViewConfig && (
                        <button onClick={() => setScopeEditor(v)} className="btn-icon p-1.5" style={{ color: 'var(--accent)' }} title="Edit link scope">
                          <RefreshCw size={12} />
                        </button>
                      )}
                      <button onClick={() => deleteView(v.token)} disabled={deleting} className="btn-icon p-1.5" style={{ color: 'rgba(239,68,68,0.6)', opacity: deleting ? 0.75 : 1 }}>
                        {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      </button>
                    </div>
                  </div>
                </div>
                {selected === v.token && (
                  <div className="ml-3 mt-1 rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)', background: 'var(--bg-input)' }}>
                    <div className="px-3 py-2 space-y-2" style={{ borderBottom: '1px solid var(--border)' }}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-bold" style={{ color: 'var(--text-2)' }}>
                          Events — {filtered.length}/{accesses.length} entries
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => toggleSelectAllFiltered(v.token)} className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg"
                            style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                            {allFilteredSelected ? <CheckSquare size={12} /> : <Square size={12} />}
                            {allFilteredSelected ? 'Unselect all' : 'Select all'}
                          </button>
                          <button onClick={() => deleteSelectedAccesses(v.token)} disabled={!selectedIds.length || deletingAccesses}
                            className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg"
                            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#ef4444', opacity: (!selectedIds.length || deletingAccesses) ? 0.5 : 1 }}>
                            {deletingAccesses ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                            Delete selected
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <div className="relative flex-1">
                          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
                          <input
                            value={accessFilterState(v.token).q}
                            onChange={e => setAccessFilter(v.token, { q: e.target.value })}
                            placeholder="Filter by IP, location, device, browser…"
                            className="w-full rounded-lg pl-7 pr-2 py-1.5 text-[11px]"
                            style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
                          />
                        </div>
                        <div className="relative">
                          <Filter size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
                          <select
                            value={accessFilterState(v.token).event}
                            onChange={e => setAccessFilter(v.token, { event: e.target.value })}
                            className="rounded-lg pl-7 pr-7 py-1.5 text-[11px]"
                            style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', color: 'var(--text-1)' }}>
                            <option value="">All events</option>
                            <option value="view">View</option>
                            <option value="edit">Edit</option>
                          </select>
                        </div>
                      </div>
                    </div>
                    {loadingAccessToken === v.token ? <div className="flex justify-center py-6"><Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-3)' }} /></div>
                    : filtered.length === 0 ? <p className="text-xs text-center py-4" style={{ color: 'var(--text-3)' }}>No entries match the current filters</p>
                    : (
                      <div className="max-h-56 overflow-y-auto divide-y" style={{ borderColor: 'var(--border)' }}>
                        {filtered.map((a, i) => (
                          <div key={a.id || i} className="px-3 py-2 flex items-start gap-3">
                            <button onClick={() => toggleAccessRow(v.token, a.id)} className="mt-0.5 flex-shrink-0" style={{ color: selectedIds.includes(a.id) ? 'var(--accent)' : 'var(--text-3)' }}>
                              {selectedIds.includes(a.id) ? <CheckSquare size={13} /> : <Square size={13} />}
                            </button>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                                  style={{ background: a.event_type === 'edit' ? 'rgba(59,130,246,0.08)' : 'rgba(16,185,129,0.08)', color: a.event_type === 'edit' ? '#2563eb' : '#059669' }}>
                                  {String(a.event_type || 'view').toUpperCase()}
                                </span>
                                <span className="text-[11px] font-mono" style={{ color: 'var(--text-1)' }}>{a.ip || '?'}</span>
                                {(a.city || a.region || a.country) && <span className="text-[11px]" style={{ color: 'var(--text-2)' }}>{[a.city, a.region, a.country].filter(Boolean).join(', ')}</span>}
                                {a.geo_source && <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{a.geo_source === 'browser' ? 'GPS' : 'IP Geo'}</span>}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                {a.device_label && <span className="text-[10px] font-medium" style={{ color: 'var(--text-2)' }}>{a.device_label}</span>}
                                {a.os && <span className="text-[10px] flex items-center gap-0.5" style={{ color: 'var(--text-3)' }}><Monitor size={8} /> {a.os}</span>}
                                {a.browser && <span className="text-[10px] flex items-center gap-0.5" style={{ color: 'var(--text-3)' }}><Globe size={8} /> {a.browser}</span>}
                                {a.device_type && <span className="text-[10px] flex items-center gap-0.5" style={{ color: 'var(--text-3)' }}><Smartphone size={8} /> {a.device_type}</span>}
                                {a.record_id && <span className="text-[10px] font-mono" style={{ color: 'var(--text-3)' }}>{a.record_id}</span>}
                              </div>
                            </div>
                            <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--text-3)' }}>{fmtDateTime(a.accessed_at)}</span>
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
      {scopeEditor && (
        <ScopeEditorModal
          view={scopeEditor}
          resourceType={resourceType}
          currentViewConfig={currentViewConfig}
          visibleRecords={visibleRecords}
          recordLabel={recordLabel}
          highlightableColumns={highlightableColumns}
          onClose={() => setScopeEditor(null)}
          onSave={(patch) => saveScopeUpdate(scopeEditor, patch)}
        />
      )}
    </div>
  )
}
