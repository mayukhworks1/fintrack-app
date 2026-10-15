// Extracted from Invoices.jsx — presentational atoms.
import { api } from '../../services/api'
import { useMemo } from 'react'
import { AttachmentUploadField as SharedAttachmentUploadField } from './sharedUi'

export { AttachCard, AttachThumb, Field, MonthStatusPill, RaisedByBadge, SelectInput, StatusPill } from './sharedUi'

/* ── Aging badge ─────────────────────────────────────────────────────────── */
// Aging fallback: use Teable formula when available, else compute from Raised Date

export function AgingBadge({ days, status }) {
  // Only relevant for Pending invoices
  if (status && status !== 'Pending') return <span style={{ color: 'var(--text-3)' }}>—</span>
  if (days == null || days === '') return <span style={{ color: 'var(--text-3)' }}>—</span>
  const d = Number(days)
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

export function AttachmentUploadField(props) {
  return <SharedAttachmentUploadField {...props} upload={api.invoices.upload} />
}

export function SuggestInput({ value, onChange, options = [], placeholder = 'Type or select…', listId }) {
  const cleanOptions = useMemo(
    () => [...new Set(options.filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b)),
    [options]
  )
  return (
    <div className="relative">
      <input
        className="input"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        list={listId}
        autoComplete="off"
      />
      <datalist id={listId}>
        {cleanOptions.map(o => <option key={o} value={o} />)}
      </datalist>
    </div>
  )
}

export function ResizableHead({ width, children, onResizeStart, align = 'left' }) {
  // The flex layout here overrides any text-align set on the parent <th>, so
  // numeric columns have to opt in explicitly — otherwise their headers sit
  // left while the figures below them are right-aligned.
  return (
    <div className="relative flex items-center pr-3" style={{ width }}>
      <div className={`min-w-0 flex-1 flex ${align === 'right' ? 'justify-end' : ''}`}>{children}</div>
      <button
        type="button"
        aria-label="Resize column"
        onMouseDown={onResizeStart}
        className="absolute right-0 top-1/2 -translate-y-1/2 h-6 w-3 cursor-col-resize"
        style={{ background: 'transparent', border: 'none' }}
      >
        <span
          className="block mx-auto h-4 rounded-full transition-colors"
          style={{ width: 2, background: 'var(--glass-border)' }}
        />
      </button>
    </div>
  )
}

/* ── Skeleton row ─────────────────────────────────────────────────────────── */

export function SkeletonRow() {
  return (
    <tr aria-hidden="true" className="tbl-row">
      {[32, 80, 100, 90, 72, 72, 80, 100, 90, 90, 72, 72, 48, 64, 56, 60].map((w, i) => (
        <td key={i} className="tbl-cell">
          <div className="skeleton h-3 rounded" style={{ width: w }} />
        </td>
      ))}
    </tr>
  )
}
