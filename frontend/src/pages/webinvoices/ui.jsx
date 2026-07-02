// Extracted from WebInvoices.jsx — presentational atoms.
import { useAvatarSrc } from '../../hooks/useAvatarSrc'
import { api } from '../../services/api'
import { AlertTriangle, Check, ChevronDown, ExternalLink, FileText, Image as ImageIcon, Loader2, Paperclip, Plus, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { KPI_PALETTE, STATUS_META, isImage, isPdf } from './utils'

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

export function MonthStatusPill({ status, active }) {
  const map = {
    Raised:   { bg: 'var(--fin-pos-bg)',  fg: 'var(--fin-positive)', border: 'var(--fin-pos-border)' },
    Pending:  { bg: 'var(--fin-warn-bg)', fg: 'var(--fin-warning)',  border: 'var(--fin-warn-border)' },
    Paused:   { bg: 'var(--fin-neg-bg)',  fg: 'var(--fin-negative)', border: 'var(--fin-neg-border)' },
    Missing:  { bg: 'var(--accent-dim)',  fg: 'var(--accent)',       border: 'var(--accent-soft)' },
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

export function KpiCard({ label, value, sub, icon: Icon, semantic, tone = 0 }) {
  const palette = KPI_PALETTE[tone % KPI_PALETTE.length]
  const color = semantic === 'positive' ? 'var(--fin-positive)' : semantic === 'warning' ? 'var(--fin-warning)' : semantic === 'negative' ? 'var(--fin-negative)' : 'var(--text-1)'
  return (
    <div className="card flex items-center gap-3 animate-scale-in hover:shadow-md transition-shadow">
      {Icon && (
        <div className="flex items-center justify-center flex-shrink-0"
          style={{ width: 38, height: 38, borderRadius: 8, background: palette.bg, color: palette.fg }}>
          <Icon size={17} aria-hidden="true" />
        </div>
      )}
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

export function DashboardMetric({ label, value, sub, icon: Icon, tone, accent, compact = false, iconSlot = true }) {
  const display = value == null ? '—' : String(value)
  const currencyMatch = display.match(/^([^\d-]+)([\d,.\-]+)$/)
  return (
    <div
      className="rounded-2xl p-4 transition-shadow min-w-0"
      style={{
        background: tone,
        border: '1px solid color-mix(in srgb, var(--card-border) 78%, transparent)',
        boxShadow: '0 10px 24px rgba(15,23,42,0.06)',
      }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase" style={{ color: 'var(--text-3)', letterSpacing: '0.1em', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{label}</p>
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
                {currencyMatch[2]}
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
              {display}
            </p>
          )}
          {sub && <p className="text-[11px] mt-2 leading-relaxed" style={{ color: 'var(--text-2)' }}>{sub}</p>}
        </div>
        {iconSlot && Icon && (
          <div
            className="flex items-center justify-center flex-shrink-0 rounded-2xl"
            style={{
              width: compact ? 40 : 48,
              height: compact ? 40 : 48,
              background: 'rgba(255,255,255,0.78)',
              color: accent || 'var(--accent)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7)',
            }}>
            <Icon size={compact ? 18 : 21} />
          </div>
        )}
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
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: 'var(--text-3)' }}>{eyebrow}</p>
          <p className="mt-2 text-base sm:text-lg font-bold leading-tight" style={{ color: 'var(--text-1)' }}>{title}</p>
          {body && <p className="text-[13px] mt-2 leading-relaxed" style={{ color: 'var(--text-2)' }}>{body}</p>}
        </div>
        {Icon && (
          <div
            className="flex items-center justify-center flex-shrink-0 rounded-2xl"
            style={{ width: 42, height: 42, background: 'rgba(255,255,255,0.76)', color: accent }}>
            <Icon size={18} />
          </div>
        )}
      </div>
    </div>
  )
}

export function SelectInput({ value, onChange, options, placeholder = 'Select…' }) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)}
        className="input appearance-none" style={{ paddingRight: '1.75rem', width: 'auto' }}>
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
    </div>
  )
}

/**
 * ProjectInput — free-text input with datalist autocomplete.
 * Works even when the options list is empty (user can always type).
 * Used for the Project field which is a plain text field in Teable,
 * not a single-select — so PicklistSelect (which renders a <select>)
 * shows blank when options haven't loaded yet.
 */

export function ProjectInput({ value, onChange, options = [], placeholder = 'Type or select project…' }) {
  const listId = 'wb-project-datalist'
  return (
    <div className="relative">
      <input
        type="text"
        list={listId}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="input w-full"
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.map(o => <option key={o} value={o} />)}
      </datalist>
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
        {addErr && <p className="text-[10px]" style={{ color: '#f87171' }}>{addErr}</p>}
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

/* ── Attachment upload field (for Reference + Invoice PDF in form drawer) ── */

export function AttachmentUploadField({ label, fieldKey, value, onChange, recordId, ensureRecord }) {
  const [uploading,  setUploading]  = useState(false)
  const [uploadErr,  setUploadErr]  = useState('')
  const [dragOver,   setDragOver]   = useState(false)
  const fileInputRef = useRef(null)
  const attachments  = Array.isArray(value) ? value : []
  const fieldNameMap = { invoice_pdf: 'Invoice PDF', reference: 'Reference' }

  async function processFiles(files) {
    if (!files?.length) return
    setUploading(true); setUploadErr('')
    try {
      const resolvedRecordId = recordId || await ensureRecord?.()
      if (!resolvedRecordId) throw new Error('Could not prepare invoice record for upload')
      let latest = attachments
      for (const file of files) {
        const result = await api.webInvoices.upload(resolvedRecordId, fieldNameMap[fieldKey], file)
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
    e.preventDefault(); setDragOver(false)
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

      {/* Existing / just-uploaded files */}
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

      {/* Drop zone / upload button */}
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
          id={`upload-${fieldKey}`}
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

/* ── Detail panel ── */

export function FieldRow({ label, children }) {
  return <div><label className="label">{label}</label>{children}</div>
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

/* ── Help Modal ── */
