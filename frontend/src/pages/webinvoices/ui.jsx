// Extracted from WebInvoices.jsx — presentational atoms.
import { api } from '../../services/api'
import { Check, ChevronDown, Loader2, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { LiveValue } from '../../components/LiveFigures'
import { AttachmentUploadField as SharedAttachmentUploadField } from '../invoices/sharedUi'

export { AttachCard, AttachThumb, Field as FieldRow, MonthStatusPill, RaisedByBadge, SelectInput, StatusPill } from '../invoices/sharedUi'

export function AgingBadge({ days, status }) {
  // Only show aging for Pending invoices — Paid/Cancelled don't need it
  if (status && status !== 'Pending') return <span style={{ color: 'var(--text-3)' }}>—</span>
  const d = Number(days)
  if (!d && d !== 0) return <span style={{ color: 'var(--text-3)' }}>—</span>
  const color = d > 30 ? 'var(--fin-negative)' : d > 14 ? 'var(--fin-warning)' : 'var(--fin-positive)'
  const bg    = d > 30 ? 'var(--fin-neg-bg)'   : d > 14 ? 'var(--fin-warn-bg)' : 'var(--fin-pos-bg)'
  const bdr   = d > 30 ? 'var(--fin-neg-border)': d > 14 ? 'var(--fin-warn-border)': 'var(--fin-pos-border)'
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold tabular-nums"
      style={{ background: bg, color, border: `1px solid ${bdr}` }}>
      {d}d
    </span>
  )
}

export function KpiCard({ label, value, sub, icon: Icon, semantic, tone = 0 }) {
  const color = semantic === 'positive' ? 'var(--fin-positive)' : semantic === 'warning' ? 'var(--fin-warning)' : semantic === 'negative' ? 'var(--fin-negative)' : 'var(--text-1)'
  return (
    <div className="card flex items-center gap-3 animate-scale-in">
      <div className="min-w-0 flex-1">
        <p className="display-num tabular-nums break-words leading-tight"
          style={{ color, fontSize: 'clamp(0.95rem, 2.4vw, 1.35rem)', wordBreak: 'break-word' }}>
          {value ?? '—'}
        </p>
        <p className="text-[11px] mt-1 leading-tight" style={{ color: 'var(--text-3)' }}>{label}</p>
        {sub && <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{sub}</p>}
      </div>
    </div>
  )
}

/**
 * `amount` + `format` make the figure live: it travels to its new value when
 * the poll brings one back. `value` stays for everything that is not a single
 * number, and is stringified — passing a node to it renders "[object Object]",
 * which is why the live path is a separate pair of props rather than a node.
 */
export function DashboardMetric({ label, value, amount, format, sub, icon: Icon, tone, accent, compact = false, iconSlot = true }) {
  const live = Number.isFinite(amount) && typeof format === 'function'
  const display = live ? format(amount) : value == null ? '—' : String(value)
  const currencyMatch = display.match(/^([^\d-]+)([\d,.\-]+)$/)
  // The layout below prints the currency symbol and the digits at different
  // sizes, so the travelling figure has to be the digits alone.
  const digitsOnly = v => {
    const t = format(v)
    const m = t.match(/^([^\d-]+)([\d,.\-]+)$/)
    return m ? m[2] : t
  }
  return (
    <div
      className="rounded-2xl p-4 transition-shadow min-w-0"
      style={{
        background: tone,
        border: '1px solid color-mix(in srgb, var(--card-border) 78%, transparent)',
        boxShadow: 'var(--card-shadow)',
      }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase" style={{ color: 'var(--text-3)', letterSpacing: '0.06em', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{label}</p>
          {currencyMatch ? (
            <div
              className="mt-2 inline-flex items-end gap-1 font-bold tracking-tight min-w-0"
              style={{ color: accent || 'var(--text-1)' }}>
              <span
                className="flex-shrink-0"
                style={{
                  fontSize: compact ? '0.95rem' : '1.05rem',
                  lineHeight: 1,
                  transform: 'translateY(-1px)',
                }}>
                {currencyMatch[1]}
              </span>
              <span
                className="tabular-nums min-w-0"
                style={{
                  fontSize: compact ? 'clamp(1rem, 1.2vw, 1.35rem)' : 'clamp(1.45rem, 1.95vw, 2.05rem)',
                  whiteSpace: 'nowrap',
                  lineHeight: 1,
                }}>
                {live ? <LiveValue value={amount} format={digitsOnly} /> : currencyMatch[2]}
              </span>
            </div>
          ) : (
            <p
              className="mt-2 font-bold tracking-tight leading-none tabular-nums"
              style={{
                color: accent || 'var(--text-1)',
                fontSize: compact ? 'clamp(1rem, 1.2vw, 1.35rem)' : 'clamp(1.15rem, 1.7vw, 1.9rem)',
                whiteSpace: 'nowrap',
              }}>
              {live ? <LiveValue value={amount} format={format} /> : display}
            </p>
          )}
          {sub && <p className="text-[11px] mt-2 leading-relaxed" style={{ color: 'var(--text-2)' }}>{sub}</p>}
        </div>
      </div>
    </div>
  )
}

export function DashboardSignal({ eyebrow, title, body, icon: Icon, tone = 'var(--bg-layer)', accent = 'var(--accent)' }) {
  return (
    <div
      className="rounded-2xl p-4 min-w-0"
      style={{
        background: tone,
        border: '1px solid color-mix(in srgb, var(--card-border) 82%, transparent)',
        boxShadow: '0 10px 24px rgba(15,23,42,0.05)',
      }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--text-3)' }}>{eyebrow}</p>
          <p className="mt-2 text-base sm:text-lg font-bold leading-tight" style={{ color: 'var(--text-1)' }}>{title}</p>
          {body && <p className="text-[13px] mt-2 leading-relaxed" style={{ color: 'var(--text-2)' }}>{body}</p>}
        </div>
        {Icon && (
          <div
            className="flex items-center justify-center flex-shrink-0 rounded-2xl"
            style={{ width: 42, height: 42, background: 'color-mix(in srgb, var(--card-bg) 76%, transparent)', color: accent }}>
            <Icon size={18} />
          </div>
        )}
      </div>
    </div>
  )
}

/* Picklist select with inline "add new option" for Teable-backed fields */

export function PicklistSelect({
  fieldName,
  value,
  onChange,
  options,
  onOptionsUpdate,
  placeholder = 'Select…',
  canAddOptions = true,
  onPermissionError,
}) {
  const [adding, setAdding]   = useState(false)
  const [newVal, setNewVal]   = useState('')
  const [saving, setSaving]   = useState(false)
  const [addErr, setAddErr]   = useState('')
  const inputRef              = useRef(null)

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  async function handleAdd(e) {
    e.preventDefault()
    const trimmed = newVal.trim()
    if (!trimmed) return
    setSaving(true); setAddErr('')
    try {
      const res = await api.webInvoices.picklists.add(fieldName, trimmed)
      onOptionsUpdate(fieldName, res.options)
      onChange(trimmed)
      setAdding(false); setNewVal('')
    } catch (err) {
      const msg = err.message || 'Failed to add'
      setAddErr(msg)
      if (/cannot change dropdown schema|required.*field\/schema edit permission/i.test(msg)) {
        onPermissionError?.(msg)
        setAdding(false)
        setNewVal('')
      }
    } finally {
      setSaving(false)
    }
  }

  if (!canAddOptions) {
    return (
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <select value={value} onChange={e => onChange(e.target.value)}
            className="input appearance-none w-full" style={{ paddingRight: '1.75rem' }}>
            <option value="">{placeholder}</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
        </div>
        <button type="button" disabled className="btn-icon flex-shrink-0 opacity-50 cursor-not-allowed"
          title={`New ${fieldName} options must be added in Teable because this token cannot edit schema`}
          aria-label={`Add ${fieldName} disabled`}>
          <Plus size={12} />
        </button>
      </div>
    )
  }

  if (adding) {
    return (
      <div className="space-y-1">
        <form onSubmit={handleAdd} className="flex gap-1">
          <input ref={inputRef}
            className="input flex-1 text-xs" style={{ height: 32 }}
            value={newVal} onChange={e => setNewVal(e.target.value)}
            placeholder={`New ${fieldName.toLowerCase()}…`}
            disabled={saving} />
          <button type="submit" disabled={saving || !newVal.trim()} className="btn-primary flex-shrink-0"
            style={{ padding: '0 0.5rem', height: 32 }} aria-label="Confirm add">
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          </button>
          <button type="button" onClick={() => { setAdding(false); setNewVal(''); setAddErr('') }}
            className="btn-icon flex-shrink-0" style={{ height: 32, width: 32 }} aria-label="Cancel">
            <X size={11} />
          </button>
        </form>
        {addErr && <p className="text-[10px]" style={{ color: 'var(--fin-negative)' }}>{addErr}</p>}
      </div>
    )
  }

  return (
    <div className="flex gap-1.5">
      <div className="relative flex-1">
        <select value={value} onChange={e => onChange(e.target.value)}
          className="input appearance-none w-full" style={{ paddingRight: '1.75rem' }}>
          <option value="">{placeholder}</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
      </div>
      <button type="button" onClick={() => setAdding(true)} className="btn-icon flex-shrink-0"
        title={`Add new ${fieldName} (requires Teable field-edit permission)`} aria-label={`Add new ${fieldName}`}>
        <Plus size={12} />
      </button>
    </div>
  )
}

export function AttachmentUploadField(props) {
  return <SharedAttachmentUploadField {...props} upload={api.webInvoices.upload} inputId={`upload-${props.fieldKey}`} />
}

export function SkeletonRow() {
  return (
    <tr aria-hidden="true" className="tbl-row">
      {[80, 100, 90, 72, 72, 80, 100, 90, 90, 72, 72, 48, 64, 56, 60].map((w, i) => (
        <td key={i} className="tbl-cell"><div className="skeleton h-3 rounded" style={{ width: w }} /></td>
      ))}
    </tr>
  )
}
