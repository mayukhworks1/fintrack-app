/**
 * InvoicePicklist — modal for linking invoices to a project.
 *
 * Props
 * -----
 * projectId    string   — teable_id of the project being edited
 * projectName  string   — display name (for the modal title)
 * linkedIds    string[] — already-linked invoice teable_ids (hidden from picklist)
 * onLink       (invoiceTId, source) => Promise  — called when user clicks "Link"
 * onClose      () => void
 *
 * The component loads the picklist from /api/project-invoices/picklist and
 * lets the user search / filter / select one invoice at a time.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, X, Link2, Loader2, Receipt, CheckCircle2, AlertCircle } from 'lucide-react'
import { api } from '../services/api'
import { formatInr } from '../utils/format'

const STATUS_COLORS = {
  'Paid':           { bg: 'rgba(16,185,129,0.12)', color: '#10b981', label: 'Paid' },
  'Received':       { bg: 'rgba(16,185,129,0.12)', color: '#10b981', label: 'Received' },
  'Partially Paid': { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b', label: 'Partial' },
  'Pending':        { bg: 'rgba(249,115,22,0.12)', color: '#f97316', label: 'Pending' },
  'Overdue':        { bg: 'rgba(239,68,68,0.12)',  color: '#ef4444', label: 'Overdue' },
  'Raised':         { bg: 'rgba(99,102,241,0.12)', color: '#6366f1', label: 'Raised' },
}

function StatusChip({ status }) {
  const cfg = STATUS_COLORS[status] || { bg: 'var(--bg-input)', color: 'var(--text-3)', label: status || '—' }
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {cfg.label}
    </span>
  )
}

export default function InvoicePicklist({ projectId, projectName, linkedIds = [], onLink, onClose }) {
  const [source,    setSource]    = useState('invoices')
  const [q,         setQ]         = useState('')
  const [invoices,  setInvoices]  = useState([])
  const [loading,   setLoading]   = useState(false)
  const [linking,   setLinking]   = useState(null)   // teable_id of invoice being linked
  const [error,     setError]     = useState(null)
  const searchRef = useRef(null)
  const debounceRef = useRef(null)

  // ── Load picklist ──────────────────────────────────────────────────────
  const loadPicklist = useCallback(async (searchQ = '', src = source) => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.projectInvoices.picklist(src, searchQ, linkedIds)
      setInvoices(res.invoices || [])
    } catch (err) {
      setError(err.message || 'Failed to load invoices')
    } finally {
      setLoading(false)
    }
  }, [source, linkedIds])

  // Load on mount and when source changes
  useEffect(() => {
    loadPicklist(q, source)
  }, [source]) // eslint-disable-line

  // Auto-focus search on open
  useEffect(() => {
    const t = setTimeout(() => searchRef.current?.focus(), 80)
    return () => clearTimeout(t)
  }, [])

  // ESC closes modal
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Debounced search
  const handleSearch = (val) => {
    setQ(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => loadPicklist(val, source), 280)
  }

  // ── Link handler ───────────────────────────────────────────────────────
  const handleLink = async (inv) => {
    setLinking(inv.teable_id)
    setError(null)
    try {
      await onLink(inv.teable_id, source)
      // Refresh picklist to hide the newly linked invoice
      await loadPicklist(q, source)
    } catch (err) {
      setError(err.message || 'Failed to link invoice')
    } finally {
      setLinking(null)
    }
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-60 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Modal */}
      <div
        className="w-full max-w-xl flex flex-col rounded-2xl overflow-hidden"
        style={{
          background: 'var(--card-bg)',
          border: '1px solid var(--card-border)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
          maxHeight: '80vh',
        }}
        role="dialog"
        aria-modal="true"
        aria-label={`Link invoice to ${projectName || 'project'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(37,99,235,0.1)' }}>
              <Link2 size={14} style={{ color: 'var(--accent)' }} />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>Link Invoice</p>
              {projectName && (
                <p className="text-xs truncate" style={{ color: 'var(--text-3)' }}>to {projectName}</p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="btn-icon flex-shrink-0" aria-label="Close">
            <X size={14} />
          </button>
        </div>

        {/* Source toggle + search */}
        <div className="px-4 py-3 space-y-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
          {/* Source tabs */}
          <div className="flex gap-1.5">
            {[
              { value: 'invoices',     label: 'Main Invoices' },
              { value: 'web_invoices', label: 'Web Invoices'  },
            ].map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setSource(value)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{
                  background: source === value ? 'var(--accent-btn)' : 'var(--bg-input)',
                  color:      source === value ? '#fff' : 'var(--text-2)',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Search box */}
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--text-3)' }} />
            <input
              ref={searchRef}
              type="text"
              value={q}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search invoice number or project…"
              className="input w-full pl-8 pr-3 py-2 text-sm"
              aria-label="Search invoices"
            />
            {q && (
              <button
                onClick={() => { setQ(''); loadPicklist('', source) }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 btn-icon p-0.5"
                aria-label="Clear search"
              >
                <X size={11} />
              </button>
            )}
          </div>
        </div>

        {/* Invoice list */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-10 gap-2" style={{ color: 'var(--text-3)' }}>
              <Loader2 size={16} className="animate-spin" />
              <span className="text-sm">Loading invoices…</span>
            </div>
          )}

          {!loading && error && (
            <div className="flex items-center gap-2 mx-4 my-4 px-3 py-2.5 rounded-xl text-sm"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          {!loading && !error && invoices.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <Receipt size={28} style={{ color: 'var(--text-3)', opacity: 0.4 }} />
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>
                {q ? 'No invoices match your search' : 'No unlinked invoices found'}
              </p>
            </div>
          )}

          {!loading && invoices.map((inv) => {
            const isLinking = linking === inv.teable_id
            return (
              <div
                key={inv.teable_id}
                className="flex items-center gap-3 px-4 py-3 transition-colors"
                style={{ borderBottom: '1px solid var(--border)', opacity: isLinking ? 0.6 : 1 }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
                onMouseLeave={e => e.currentTarget.style.background = ''}
              >
                {/* Icon */}
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: 'var(--bg-input)' }}>
                  <Receipt size={13} style={{ color: 'var(--text-3)' }} />
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>
                      {inv.invoice_number || '—'}
                    </span>
                    {inv.payment_status && <StatusChip status={inv.payment_status} />}
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
                <div className="flex-shrink-0 text-right mr-2">
                  <p className="text-sm font-semibold tabular-nums" style={{ color: 'var(--text-1)' }}>
                    {inv.amount_raised != null ? formatInr(inv.amount_raised) : '—'}
                  </p>
                  {inv.amount_with_tax != null && inv.amount_with_tax !== inv.amount_raised && (
                    <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                      +tax {formatInr(inv.amount_with_tax)}
                    </p>
                  )}
                </div>

                {/* Link button */}
                <button
                  onClick={() => handleLink(inv)}
                  disabled={isLinking}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex-shrink-0"
                  style={{
                    background: isLinking ? 'var(--bg-input)' : 'var(--accent-btn)',
                    color: isLinking ? 'var(--text-3)' : '#fff',
                    cursor: isLinking ? 'not-allowed' : 'pointer',
                  }}
                  aria-label={`Link ${inv.invoice_number}`}
                >
                  {isLinking
                    ? <Loader2 size={11} className="animate-spin" />
                    : <Link2 size={11} />}
                  {isLinking ? 'Linking…' : 'Link'}
                </button>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderTop: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>
            {!loading && `${invoices.length} invoice${invoices.length !== 1 ? 's' : ''} available`}
          </p>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: 'var(--bg-input)', color: 'var(--text-2)' }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
