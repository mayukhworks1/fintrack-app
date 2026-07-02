// Extracted from Invoices.jsx — presentational atoms.
import { useAvatarSrc } from '../../hooks/useAvatarSrc'
import { api } from '../../services/api'
import { AlertTriangle, ChevronDown, ExternalLink, FileText, Image as ImageIcon, Loader2, Paperclip, Upload, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { STATUS_META, isImage, isPdf } from './utils'

export function RaisedByBadge({ email, avatarMap = {}, size = 16, className = '' }) {
  const entry = avatarMap[email?.toLowerCase()] || {}
  const resolvedSrc = useAvatarSrc(entry.avatar_url || null)
  if (!email) return null
  const label = entry.name || email
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {resolvedSrc ? (
        <img src={resolvedSrc} alt=""
          style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
      ) : (
        <span style={{
          width: size, height: size, borderRadius: '50%', flexShrink: 0,
          background: 'var(--accent-dim)', display: 'inline-flex', alignItems: 'center',
          justifyContent: 'center', fontSize: size * 0.5, color: 'var(--accent)', fontWeight: 600,
        }}>
          {label[0].toUpperCase()}
        </span>
      )}
      <span style={{ fontSize: '0.75em' }}>{label}</span>
    </span>
  )
}

/* ── Constants ──────────────────────────────────────────────────────────── */
// Dropdown options are derived live from invoice records — no hardcoded fallbacks

export function MonthStatusPill({ status, active }) {
  const map = {
    Raised:  { bg: 'var(--fin-pos-bg)',  fg: 'var(--fin-positive)', border: 'var(--fin-pos-border)' },
    Pending: { bg: 'var(--fin-warn-bg)', fg: 'var(--fin-warning)',  border: 'var(--fin-warn-border)' },
    Paused:  { bg: 'var(--fin-neg-bg)',  fg: 'var(--fin-negative)', border: 'var(--fin-neg-border)' },
    Missing: { bg: 'var(--accent-dim)',  fg: 'var(--accent)',       border: 'var(--accent-soft)' },
  }
  const m = map[status] || map.Missing
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{
        background: m.bg,
        color: m.fg,
        border: `1px solid ${m.border}`,
        boxShadow: active ? `0 0 0 2px ${m.border}` : 'none',
      }}>
      {status}
    </span>
  )
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

export function StatusPill({ status }) {
  if (!status) return <span style={{ color: 'var(--text-3)' }}>—</span>
  const m = STATUS_META[status] || { color: 'var(--text-3)', bg: 'var(--glass-bg)', border: 'var(--glass-border)' }
  const Icon = m.icon
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={{ background: m.bg, color: m.color }}>
      {Icon && <Icon size={11} strokeWidth={2.5} />}{status}
    </span>
  )
}

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

/* ── Overdue collection alert panel ─────────────────────────────────────── */

export function AttachThumb({ a, size = 28, onPreview }) {
  const [err, setErr] = useState(false)
  const inner = isImage(a) && !err
    ? <img src={a.url} alt={a.name} className="w-full h-full object-cover" onError={() => setErr(true)} />
    : isPdf(a)
      ? <FileText size={Math.round(size * 0.45)} style={{ color: '#f87171' }} />
      : <ImageIcon size={Math.round(size * 0.45)} style={{ color: 'var(--text-3)' }} />
  const sharedStyle = { width: size, height: size, border: '1px solid var(--glass-border)', background: isPdf(a) ? 'rgba(248,113,113,0.08)' : 'var(--glass-bg)' }
  const sharedClass = 'flex-shrink-0 rounded-lg overflow-hidden flex items-center justify-center border transition-opacity hover:opacity-75'
  if (onPreview) {
    return (
      <button type="button" title={a.name} className={sharedClass} style={sharedStyle}
        onClick={e => { e.stopPropagation(); onPreview() }}>
        {inner}
      </button>
    )
  }
  return (
    <a href={a.url} target="_blank" rel="noopener noreferrer" title={a.name}
      className={sharedClass} style={sharedStyle}
      onClick={e => e.stopPropagation()}>
      {inner}
    </a>
  )
}

/* ── Full Attachment card ────────────────────────────────────────────────── */

export function AttachCard({ a, onPreview }) {
  const [err, setErr] = useState(false)
  const thumb = (
    <div className="rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
      style={{ width: 44, height: 44, border: '1px solid var(--glass-border)', background: isPdf(a) ? 'rgba(248,113,113,0.10)' : 'var(--bg-input)' }}>
      {isImage(a) && !err
        ? <img src={a.url} alt={a.name} className="w-full h-full object-cover" onError={() => setErr(true)} />
        : isPdf(a)
          ? <FileText size={20} style={{ color: '#f87171' }} />
          : <ImageIcon size={20} style={{ color: 'var(--text-3)' }} />}
    </div>
  )
  const content = (
    <>
      {thumb}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate" style={{ color: 'var(--text-1)' }}>{a.name}</p>
        <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{isPdf(a) ? 'PDF Document' : 'Image'} · click to preview</p>
      </div>
      <ExternalLink size={12} className="flex-shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: 'var(--text-2)' }} />
    </>
  )
  const sharedProps = {
    className: 'group flex items-center gap-3 p-2.5 rounded-xl border transition-all w-full text-left',
    style: { background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' },
    onMouseEnter: e => { e.currentTarget.style.background = 'var(--glass-bg-hover)'; e.currentTarget.style.borderColor = 'var(--glass-border-hi)' },
    onMouseLeave: e => { e.currentTarget.style.background = 'var(--glass-bg)';       e.currentTarget.style.borderColor = 'var(--glass-border)' },
  }
  if (onPreview) {
    return <button type="button" {...sharedProps} onClick={onPreview}>{content}</button>
  }
  return <a href={a.url} target="_blank" rel="noopener noreferrer" {...sharedProps}>{content}</a>
}

export function AttachmentUploadField({ label, fieldKey, value, onChange, recordId, ensureRecord }) {
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)
  const attachments = Array.isArray(value) ? value : []
  const fieldNameMap = { invoice_pdf: 'Invoice PDF', reference: 'Reference' }

  async function processFiles(files) {
    if (!files?.length) return
    setUploading(true)
    setUploadErr('')
    try {
      const resolvedRecordId = recordId || await ensureRecord?.()
      if (!resolvedRecordId) throw new Error('Could not prepare invoice record for upload')
      let latest = attachments
      for (const file of files) {
        const result = await api.invoices.upload(resolvedRecordId, fieldNameMap[fieldKey], file)
        latest = result?.attachments || latest
      }
      onChange(latest)
    } catch (e) {
      setUploadErr(e.message || 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function onDrop(e) {
    e.preventDefault()
    setDragOver(false)
    processFiles(Array.from(e.dataTransfer.files))
  }

  function removeAt(i) {
    onChange(attachments.filter((_, idx) => idx !== i))
  }

  return (
    <div>
      <label className="label flex items-center gap-1.5">
        <Paperclip size={10} style={{ color: 'var(--text-3)' }} />{label}
      </label>

      {attachments.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {attachments.map((a, i) => {
            const norm = { name: a.name || a.filename || 'Attachment', url: a.url || a.presignedUrl || '', mime: a.mimeType || '' }
            return (
              <div key={i} className="flex items-center gap-2 px-2.5 py-2 rounded-lg"
                style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                {isPdf(norm)
                  ? <FileText size={13} className="flex-shrink-0" style={{ color: '#f87171' }} />
                  : isImage(norm)
                    ? <ImageIcon size={13} className="flex-shrink-0" style={{ color: '#60a5fa' }} />
                    : <Paperclip size={13} className="flex-shrink-0" style={{ color: 'var(--text-3)' }} />}
                <span className="flex-1 truncate text-xs" style={{ color: 'var(--text-2)' }}>{norm.name}</span>
                {norm.url && (
                  <a href={norm.url} target="_blank" rel="noopener noreferrer" title="Open"
                    className="flex-shrink-0 btn-icon" style={{ width: 22, height: 22 }}
                    onClick={e => e.stopPropagation()}>
                    <ExternalLink size={10} />
                  </a>
                )}
                <button type="button" onClick={() => removeAt(i)} className="flex-shrink-0 btn-icon"
                  style={{ width: 22, height: 22 }} aria-label="Remove attachment">
                  <X size={10} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
        role="button" tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && fileInputRef.current?.click()}
        className="flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed cursor-pointer transition-all py-4 select-none"
        style={{
          borderColor: dragOver ? 'var(--accent)' : 'var(--glass-border)',
          background: dragOver ? 'rgba(99,102,241,0.06)' : 'var(--glass-bg)',
          opacity: uploading ? 0.7 : 1,
        }}
        aria-label={`Upload ${label}`}>
        {uploading
          ? <><Loader2 size={16} className="animate-spin" style={{ color: 'var(--accent)' }} />
              <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>Uploading…</span></>
          : <><Upload size={16} style={{ color: 'var(--text-3)' }} />
              <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                {recordId ? 'Click or drag to upload · PDF, images' : 'Click to save draft and upload · PDF, images'}
              </span></>}
        <input ref={fileInputRef} type="file" multiple className="hidden"
          accept=".pdf,.png,.jpg,.jpeg,.gif,.webp"
          onChange={e => processFiles(Array.from(e.target.files || []))} />
      </div>

      {uploadErr && (
        <p className="text-[10px] mt-1 flex items-center gap-1" style={{ color: '#f87171' }}>
          <AlertTriangle size={10} />{uploadErr}
        </p>
      )}
    </div>
  )
}

/* ── Select wrapper ──────────────────────────────────────────────────────── */

export function SelectInput({ value, onChange, options, placeholder = 'Select…', compact = false }) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)}
        className={`input appearance-none ${compact ? 'py-1.5 text-xs' : ''}`}
        style={{ paddingRight: '1.75rem', width: 'auto' }}>
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
    </div>
  )
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

/* ── Invoice detail drawer ───────────────────────────────────────────────── */

export function Field({ label, children }) {
  return <div><label className="label">{label}</label>{children}</div>
}

export function ResizableHead({ width, children, onResizeStart }) {
  return (
    <div className="relative flex items-center pr-3" style={{ width }}>
      <div className="min-w-0 flex-1">{children}</div>
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

/* ── Main page ────────────────────────────────────────────────────────────── */
