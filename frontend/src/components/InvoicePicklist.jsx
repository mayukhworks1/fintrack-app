/**
 * InvoicePicklist — multi-select invoice linker
 *
 * Props
 * -----
 * projectId    string   — teable_id of the project/record being edited
 * projectName  string   — display name (modal title)
 * linkedIds    string[] — already-linked invoice teable_ids (hidden from list)
 * onLink       (invoiceTId, source) => Promise
 * onClose      () => void
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, X, Link2, Loader2, Receipt, Check, AlertCircle } from 'lucide-react'
import { api } from '../services/api'
import { formatInr } from '../utils/format'

const STATUS_COLORS = {
  'Paid':           { bg: 'rgba(16,185,129,0.12)',  color: '#10b981' },
  'Received':       { bg: 'rgba(16,185,129,0.12)',  color: '#10b981' },
  'Partially Paid': { bg: 'rgba(245,158,11,0.12)',  color: '#f59e0b' },
  'Pending':        { bg: 'rgba(249,115,22,0.12)',  color: '#f97316' },
  'Overdue':        { bg: 'rgba(239,68,68,0.12)',   color: '#ef4444' },
  'Raised':         { bg: 'rgba(99,102,241,0.12)',  color: '#6366f1' },
  'Cancelled':      { bg: 'rgba(100,116,139,0.12)', color: '#94a3b8' },
}

function StatusChip({ status }) {
  const cfg = STATUS_COLORS[status] || { bg: 'var(--bg-input)', color: 'var(--text-3)' }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold"
      style={{ background: cfg.bg, color: cfg.color }}>
      {status || '—'}
    </span>
  )
}

export default function InvoicePicklist({ projectId, projectName, linkedIds = [], onLink, onClose }) {
  const [source,     setSource]     = useState('invoices')
  const [q,          setQ]          = useState('')
  const [invoices,   setInvoices]   = useState([])
  const [loading,    setLoading]    = useState(false)
  const [selected,   setSelected]   = useState(new Set())   // multi-select
  const [linking,    setLinking]    = useState(false)       // bulk link in progress
  const [error,      setError]      = useState(null)
  const searchRef  = useRef(null)
  const debounceRef = useRef(null)

  // ── Load picklist ──────────────────────────────────────────────────────
  const loadPicklist = useCallback(async (searchQ = '', src = source) => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.projectInvoices.picklist(src, searchQ, linkedIds)
      setInvoices(res.invoices || [])
      // Clear selection when list refreshes
      setSelected(new Set())
    } catch (err) {
      setError(err.message || 'Failed to load invoices')
    } finally {
      setLoading(false)
    }
  }, [source, linkedIds]) // eslint-disable-line

  useEffect(() => { loadPicklist(q, source) }, [source]) // eslint-disable-line

  useEffect(() => {
    const t = setTimeout(() => searchRef.current?.focus(), 80)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const handleSearch = (val) => {
    setQ(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => loadPicklist(val, source), 280)
  }

  // ── Selection helpers ─────────────────────────────────────────────────
  const toggleOne = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === invoices.length && invoices.length > 0) {
      setSelected(new Set())
    } else {
      setSelected(new Set(invoices.map(i => i.teable_id)))
    }
  }

  const allSelected = invoices.length > 0 && selected.size === invoices.length
  const someSelected = selected.size > 0

  // ── Link selected ──────────────────────────────────────────────────────
  const handleLinkSelected = async () => {
    if (!someSelected) return
    setLinking(true)
    setError(null)
    let failed = 0
    for (const tid of selected) {
      try {
        await onLink(tid, source)
      } catch {
        failed++
      }
    }
    if (failed > 0) setError(`${failed} invoice${failed > 1 ? 's' : ''} failed to link`)
    await loadPicklist(q, source)
    setLinking(false)
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(6px)', zIndex: 80 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-2xl flex flex-col rounded-2xl overflow-hidden"
        style={{
          background: 'var(--card-bg)',
          border: '1px solid var(--border)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.3)',
          maxHeight: '85vh',
        }}
        role="dialog"
        aria-modal="true"
        aria-label={`Link invoices to ${projectName || 'project'}`}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)', background: 'var(--accent-dim)' }}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--accent-btn)' }}>
              <Receipt size={15} style={{ color: '#fff' }} />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm" style={{ color: 'var(--text-1)' }}>Link Invoices</p>
              {projectName && (
                <p className="text-xs truncate" style={{ color: 'var(--text-3)' }}>
                  to <strong style={{ color: 'var(--text-2)' }}>{projectName}</strong>
                </p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="btn-icon p-2" style={{ color: 'var(--text-3)' }} aria-label="Close">
            <X size={15} />
          </button>
        </div>

        {/* ── Source tabs + Search ── */}
        <div className="px-4 pt-3 pb-3 space-y-2.5 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex gap-1.5">
            {[
              { value: 'invoices',     label: 'Main Invoices' },
              { value: 'web_invoices', label: 'Web Invoices'  },
            ].map(({ value, label }) => (
              <button key={value} onClick={() => setSource(value)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                style={{
                  background: source === value ? 'var(--accent-btn)' : 'var(--bg-input)',
                  color:      source === value ? '#fff' : 'var(--text-2)',
                }}>{label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--text-3)' }} />
            <input
              ref={searchRef}
              type="text"
              value={q}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search invoice number or project name…"
              className="input w-full pl-8 pr-8 py-2 text-sm"
              aria-label="Search invoices"
            />
            {q && (
              <button onClick={() => { setQ(''); loadPicklist('', source) }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 btn-icon p-0.5"
                aria-label="Clear search">
                <X size={11} />
              </button>
            )}
          </div>
        </div>

        {/* ── Select-all bar (when invoices loaded) ── */}
        {!loading && invoices.length > 0 && (
          <div className="flex items-center justify-between px-4 py-2 flex-shrink-0"
            style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-input)' }}>
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <div
                onClick={toggleAll}
                className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 cursor-pointer transition-all"
                style={{
                  background: allSelected ? 'var(--accent-btn)' : someSelected ? 'rgba(37,99,235,0.3)' : 'transparent',
                  border: `2px solid ${allSelected || someSelected ? 'var(--accent-btn)' : 'var(--border)'}`,
                }}
                role="checkbox"
                aria-checked={allSelected ? 'true' : someSelected ? 'mixed' : 'false'}
                aria-label="Select all invoices"
              >
                {allSelected && <Check size={9} color="#fff" strokeWidth={3} />}
                {someSelected && !allSelected && (
                  <div className="w-2 h-0.5 rounded-full" style={{ background: '#fff' }} />
                )}
              </div>
              <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                {someSelected
                  ? `${selected.size} of ${invoices.length} selected`
                  : `Select all (${invoices.length})`}
              </span>
            </label>
            {someSelected && (
              <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                ✓ Check rows below then click "Link Selected"
              </span>
            )}
          </div>
        )}

        {/* ── Invoice list ── */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12 gap-2" style={{ color: 'var(--text-3)' }}>
              <Loader2 size={16} className="animate-spin" />
              <span className="text-sm">Loading invoices…</span>
            </div>
          )}

          {!loading && error && (
            <div className="flex items-center gap-2 m-4 px-3 py-2.5 rounded-xl text-sm"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
              <AlertCircle size={14} className="flex-shrink-0" />
              {error}
            </div>
          )}

          {!loading && !error && invoices.length === 0 && (
            <div className="flex flex-col items-center justify-center py-14 gap-3">
              <Receipt size={32} style={{ color: 'var(--text-3)', opacity: 0.3 }} />
              <p className="text-sm font-medium" style={{ color: 'var(--text-3)' }}>
                {q ? 'No invoices match your search' : 'No unlinked invoices found'}
              </p>
              {q && (
                <button onClick={() => { setQ(''); loadPicklist('', source) }}
                  className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>
                  Clear search
                </button>
              )}
            </div>
          )}

          {!loading && invoices.map((inv) => {
            const isSelected = selected.has(inv.teable_id)
            const statusCfg = STATUS_COLORS[inv.payment_status] || { bg: 'var(--bg-input)', color: 'var(--text-3)' }
            return (
              <div
                key={inv.teable_id}
                onClick={() => toggleOne(inv.teable_id)}
                className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors"
                style={{
                  borderBottom: '1px solid var(--border)',
                  background: isSelected ? 'rgba(37,99,235,0.06)' : '',
                  borderLeft: isSelected ? '3px solid var(--accent-btn)' : '3px solid transparent',
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-input)' }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = '' }}
              >
                {/* Checkbox */}
                <div
                  className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-all"
                  style={{
                    background: isSelected ? 'var(--accent-btn)' : 'transparent',
                    border: `2px solid ${isSelected ? 'var(--accent-btn)' : 'var(--border)'}`,
                  }}
                >
                  {isSelected && <Check size={9} color="#fff" strokeWidth={3} />}
                </div>

                {/* Invoice icon */}
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: isSelected ? 'rgba(37,99,235,0.12)' : 'var(--bg-input)' }}>
                  <Receipt size={13} style={{ color: isSelected ? 'var(--accent)' : 'var(--text-3)' }} />
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>
                      {inv.invoice_number || '—'}
                    </span>
                    {inv.payment_status && <StatusChip status={inv.payment_status} />}
                    {inv.source === 'web_invoices' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8' }}>Web</span>
                    )}
                  </div>
                  <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-3)' }}>
                    {inv.project_name || '—'}
                    {inv.raised_date && (
                      <span className="ml-1.5 opacity-70">
                        · {new Date(inv.raised_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    )}
                  </p>
                </div>

                {/* Amount */}
                <div className="flex-shrink-0 text-right">
                  <p className="text-sm font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>
                    {inv.amount_raised != null ? formatInr(inv.amount_raised) : '—'}
                  </p>
                  {inv.amount_with_tax != null && inv.amount_with_tax !== inv.amount_raised && (
                    <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                      +tax {formatInr(inv.amount_with_tax)}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* ── Footer ── */}
        <div className="px-4 py-3 flex items-center justify-between gap-3 flex-shrink-0"
          style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-input)' }}>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>
            {!loading && invoices.length > 0
              ? `${invoices.length} invoice${invoices.length !== 1 ? 's' : ''} available${someSelected ? ` · ${selected.size} selected` : ''}`
              : !loading ? 'No invoices available' : ''}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: 'var(--card-bg)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
              {someSelected ? 'Cancel' : 'Close'}
            </button>
            {someSelected && (
              <button
                onClick={handleLinkSelected}
                disabled={linking}
                className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all"
                style={{
                  background: linking ? 'var(--bg-input)' : 'var(--accent-btn)',
                  color: linking ? 'var(--text-3)' : '#fff',
                  boxShadow: linking ? 'none' : '0 2px 8px rgba(37,99,235,0.35)',
                }}
              >
                {linking
                  ? <><Loader2 size={11} className="animate-spin" /> Linking…</>
                  : <><Link2 size={11} /> Link {selected.size} invoice{selected.size !== 1 ? 's' : ''}</>
                }
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
