import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  Globe, RefreshCw, Plus, X, ChevronDown, AlertTriangle,
  Clock, CheckCircle2, XCircle, Search, ExternalLink, FileText,
  ArrowUpDown, Save, Trash2, Image as ImageIcon, Filter,
  AlertOctagon, User, Tag, Eye,
  IndianRupee, TrendingUp, Percent, CalendarClock, Receipt,
  Sun, Moon, LogOut, Check, Loader2, Upload, Paperclip
} from 'lucide-react'
import { api } from '../services/api'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { formatInr } from '../utils/format'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useToast } from '../context/ToastContext'
import clsx from 'clsx'

/* ── Constants ── */
// Fallback defaults used before picklists load from Teable
const DEFAULT_PICKLISTS = {
  Project:    ['Innovine', 'PMS', 'Maitrimetal Workspace migration'],
  Category:   ['BUG Fixing', 'Development- Retainer', 'Phase 1.1', 'Phase 1.2', 'Change Request', 'ZOHO', 'Overtime', 'Phase 1.3', 'Project Management'],
  Milestone:  ['Advance', 'Prehandover', 'Post go Live', 'Bug Fix', 'Presales'],
  'Raised By': ['Mayukh', 'Hardik'],
}
const STATUSES = ['Paid', 'Pending', 'Cancelled']

const EMPTY_FORM = {
  invoice_number: '', project: '', category: '', description: '',
  milestone: '', raised_by: '', raised_date: '', cleared_date: '',
  amount_raised: '', amount_with_tax: '', amount_received: '',
  payment_status: 'Pending', remark: '', next_followup: '',
  reference: [], invoice_pdf: [],
}

const monthKey = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const monthLabel = (key) => {
  if (!key) return 'All months'
  const [year, month] = key.split('-')
  const d = new Date(Number(year), Number(month) - 1, 1)
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

const shiftMonthKey = (key, delta) => {
  const [year, month] = key.split('-').map(Number)
  const d = new Date(year, month - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const shortMonthLabel = (key) => {
  const [year, month] = key.split('-')
  const d = new Date(Number(year), Number(month) - 1, 1)
  return d.toLocaleDateString('en-IN', { month: 'short' })
}

const isRetainerCategory = (value) => /retainer/i.test(String(value || ''))
const currentMonthKey = () => monthKey(new Date().toISOString())
const firstDayIso = (key) => `${key}-01T00:00:00.000Z`
const INVOICE_REQUEST_FORM_URL = 'https://forms.zohopublic.com/theworks/form/TheWorksInvoiceRequest/formperma/EeBkA0aaMt64sMe9n3mxlKggjA-QmVDmTVwrqMHPGOY'

function getRetainerCategoryOption(options = []) {
  return options.find(isRetainerCategory) || 'Development- Retainer'
}

function getProjectCategoryOption(options = [], current = '') {
  if (current && !isRetainerCategory(current)) return current
  const explicit = options.find(o => /^project$/i.test(String(o || '').trim()))
  if (explicit) return explicit
  return options.find(o => !isRetainerCategory(o)) || ''
}

function parseIsoDate(value) {
  const d = new Date(value || '')
  return Number.isNaN(d.getTime()) ? null : d
}

function sortByRaisedDateDesc(records = []) {
  return [...records].sort((a, b) => {
    const da = parseIsoDate(a.fields?.['Raised Date'])?.getTime() || 0
    const db = parseIsoDate(b.fields?.['Raised Date'])?.getTime() || 0
    return db - da
  })
}

function MonthStatusPill({ status, active }) {
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

const KPI_PALETTE = [
  { bg: '#fef3c7', fg: '#d97706' },
  { bg: '#dbeafe', fg: '#2563eb' },
  { bg: '#dcfce7', fg: '#16a34a' },
  { bg: '#fce7f3', fg: '#db2777' },
  { bg: '#ede9fe', fg: '#7c3aed' },
]

/* ── Helpers ── */
const fmt     = (n) => formatInr(n)
const fmtDate = (d) => {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) }
  catch { return String(d).slice(0, 10) }
}
const fmtDateFull = (d) => {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) }
  catch { return String(d).slice(0, 10) }
}

function parseAttachments(cell) {
  if (!cell) return []
  if (Array.isArray(cell)) {
    return cell.map(a => ({ name: a.name || a.filename || 'Attachment', url: a.url || a.presignedUrl || '', mime: a.mimeType || a.mimetype || '' }))
  }
  const parts = String(cell).split(/\s+/)
  const out = []
  for (let i = 0; i < parts.length; i += 2) {
    if (parts[i + 1]) out.push({ name: decodeURIComponent(parts[i].replace(/_x20_/g, ' ')).replace(/_x2D_/g, '-'), url: parts[i + 1], mime: '' })
  }
  return out
}

const isImage = (a) => {
  if (a.mime?.startsWith('image/')) return true
  return /\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i.test(a.url) || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(a.name)
}
const isPdf = (a) => a.mime === 'application/pdf' || /\.pdf(\?|$)/i.test(a.url) || a.name?.toLowerCase().endsWith('.pdf')

/* ── Status config ── */
const STATUS_META = {
  Paid:      { color: 'var(--fin-positive)', bg: 'var(--fin-pos-bg)',  border: 'var(--fin-pos-border)',  icon: CheckCircle2 },
  Pending:   { color: 'var(--fin-warning)',  bg: 'var(--fin-warn-bg)', border: 'var(--fin-warn-border)', icon: Clock },
  Cancelled: { color: 'var(--fin-negative)', bg: 'var(--fin-neg-bg)', border: 'var(--fin-neg-border)',  icon: XCircle },
}

function StatusPill({ status }) {
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

function AgingBadge({ days }) {
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

function AttachThumb({ a, size = 28 }) {
  const [err, setErr] = useState(false)
  return (
    <a href={a.url} target="_blank" rel="noopener noreferrer" title={a.name}
      className="flex-shrink-0 rounded-lg overflow-hidden flex items-center justify-center border transition-opacity hover:opacity-75"
      style={{ width: size, height: size, border: '1px solid var(--glass-border)', background: isPdf(a) ? 'rgba(248,113,113,0.08)' : 'var(--glass-bg)' }}
      onClick={e => e.stopPropagation()}>
      {isImage(a) && !err
        ? <img src={a.url} alt={a.name} className="w-full h-full object-cover" onError={() => setErr(true)} />
        : isPdf(a)
          ? <FileText size={Math.round(size * 0.45)} style={{ color: '#f87171' }} />
          : <ImageIcon size={Math.round(size * 0.45)} style={{ color: 'var(--text-3)' }} />}
    </a>
  )
}

function AttachCard({ a }) {
  const [err, setErr] = useState(false)
  return (
    <a href={a.url} target="_blank" rel="noopener noreferrer"
      className="group flex items-center gap-3 p-2.5 rounded-xl border transition-all"
      style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--glass-bg-hover)'; e.currentTarget.style.borderColor = 'var(--glass-border-hi)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'var(--glass-bg)';       e.currentTarget.style.borderColor = 'var(--glass-border)' }}>
      <div className="rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
        style={{ width: 44, height: 44, border: '1px solid var(--glass-border)', background: isPdf(a) ? 'rgba(248,113,113,0.10)' : 'var(--bg-input)' }}>
        {isImage(a) && !err
          ? <img src={a.url} alt={a.name} className="w-full h-full object-cover" onError={() => setErr(true)} />
          : isPdf(a)
            ? <FileText size={20} style={{ color: '#f87171' }} />
            : <ImageIcon size={20} style={{ color: 'var(--text-3)' }} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate" style={{ color: 'var(--text-1)' }}>{a.name}</p>
        <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{isPdf(a) ? 'PDF Document' : 'Image'} · click to open</p>
      </div>
      <ExternalLink size={12} className="flex-shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: 'var(--text-2)' }} />
    </a>
  )
}

function KpiCard({ label, value, sub, icon: Icon, semantic, tone = 0 }) {
  const palette = KPI_PALETTE[tone % KPI_PALETTE.length]
  const color = semantic === 'positive' ? 'var(--fin-positive)' : semantic === 'warning' ? 'var(--fin-warning)' : semantic === 'negative' ? 'var(--fin-negative)' : 'var(--text-1)'
  return (
    <div className="card flex items-center gap-3 animate-scale-in">
      {Icon && (
        <div className="rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ width: 40, height: 40, background: palette.bg, color: palette.fg }}>
          <Icon size={18} aria-hidden="true" />
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

function SelectInput({ value, onChange, options, placeholder = 'Select…' }) {
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

/* Picklist select with inline "add new option" for Teable-backed fields */
function PicklistSelect({
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
function AttachmentUploadField({ label, fieldKey, value, onChange, recordId, ensureRecord }) {
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
function InvoiceDetail({ invoice, onClose, onEdit }) {
  if (!invoice) return null
  const f = invoice.fields || {}
  const refs = parseAttachments(f['Reference'])
  const pdfs = parseAttachments(f['Invoice PDF'])
  const outstanding = Number(f['Outstanding Amount'] || 0)

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }} onClick={onClose} aria-hidden="true" />
      <aside className="relative ml-auto flex flex-col h-full animate-slide-in"
        style={{ width: 'min(100vw,500px)', background: 'var(--sidebar-bg)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', borderLeft: '1px solid var(--glass-border)' }}>

        <div className="flex items-start justify-between px-5 py-4 gap-3" style={{ borderBottom: '1px solid var(--glass-border)' }}>
          <div className="min-w-0">
            <p className="font-bold text-sm" style={{ color: 'var(--text-1)', letterSpacing: '-0.01em' }}>{f['Invoice Number'] || '—'}</p>
            <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
              {[f['Project'], f['Category'], f['Milestone']].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={onEdit} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>Edit</button>
            <button onClick={onClose} className="btn-icon" aria-label="Close"><X size={14} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusPill status={f['Payment Status']} />
            {f['Speed'] && (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-2)' }}>
                {f['Speed']}
              </span>
            )}
            {f['Raised By'] && (
              <span className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-2)' }}>
                <User size={9} />{f['Raised By']}
              </span>
            )}
          </div>

          {f['Description'] && (
            <div className="rounded-xl p-3.5" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
              <p className="label mb-2">Description</p>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-1)', whiteSpace: 'pre-wrap' }}>{f['Description']}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            {[
              ['Amount Raised',   f['Amount Raised'],      'var(--text-1)'],
              ['With GST (18%)',  f['Amount with Tax'],    'var(--text-1)'],
              ['Received',        f['Amount Received'],    'var(--fin-positive)'],
              ['Outstanding',     f['Outstanding Amount'], outstanding > 0 ? 'var(--fin-warning)' : 'var(--fin-positive)'],
            ].map(([lbl, val, clr]) => (
              <div key={lbl} className="rounded-xl p-3" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                <p className="label mb-1.5">{lbl}</p>
                <p className="font-bold tabular-nums text-base leading-none" style={{ color: clr }}>{fmt(val)}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              ['Raised',        fmtDateFull(f['Raised Date'])],
              ['Cleared',       fmtDateFull(f['Cleared Date'])],
              ['Next Followup', fmtDateFull(f['Next followup'])],
              ['Days to Clear', f['Days To Clear']   != null ? `${f['Days To Clear']} days`   : '—'],
              ['Aging',         f['Agening (Days)']  != null ? `${f['Agening (Days)']} days`  : '—'],
              ['Milestone',     f['Milestone']       || '—'],
            ].map(([lbl, val]) => (
              <div key={lbl}>
                <p className="label">{lbl}</p>
                <p className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>{val}</p>
              </div>
            ))}
          </div>

          {f['Remark'] && (
            <div>
              <p className="label">Remark</p>
              <p className="text-sm leading-relaxed mt-1" style={{ color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>{f['Remark']}</p>
            </div>
          )}

          {(refs.length > 0 || pdfs.length > 0) && (
            <div className="space-y-3">
              {refs.length > 0 && (
                <div>
                  <p className="label mb-2">Payment Reference{refs.length > 1 ? 's' : ''}</p>
                  <div className="space-y-2">{refs.map((a, i) => <AttachCard key={i} a={a} />)}</div>
                </div>
              )}
              {pdfs.length > 0 && (
                <div>
                  <p className="label mb-2">Invoice PDF{pdfs.length > 1 ? 's' : ''}</p>
                  <div className="space-y-2">{pdfs.map((a, i) => <AttachCard key={i} a={a} />)}</div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3" style={{ borderTop: '1px solid var(--glass-border)' }}>
          <button onClick={onClose} className="btn-ghost w-full text-xs" style={{ justifyContent: 'center' }}>Close</button>
        </div>
      </aside>
    </div>
  )
}

/* ── Form drawer ── */
function FieldRow({ label, children }) {
  return <div><label className="label">{label}</label>{children}</div>
}

function InvoiceDrawer({
  invoice,
  draft,
  onClose,
  onSaved,
  onDeleted,
  picklists,
  onOptionsUpdate,
  canEditPicklists,
  onPicklistPermissionError,
}) {
  const isEdit = Boolean(invoice?.id)
  const [form,       setForm]       = useState(EMPTY_FORM)
  const [saving,     setSaving]     = useState(false)
  const [deleting,   setDeleting]   = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [error,      setError]      = useState('')
  const [workingRecordId, setWorkingRecordId] = useState(invoice?.id || null)
  const [categoryLocked, setCategoryLocked] = useState(false)
  const paidSelected = form.payment_status === 'Paid'
  const retainerSelected = isRetainerCategory(form.category)
  const retainerCategoryOption = getRetainerCategoryOption(picklists?.Category || [])
  const projectCategoryOption = getProjectCategoryOption(picklists?.Category || [], form.category)
  const currentRecordId = invoice?.id || workingRecordId

  useEffect(() => {
    if (!invoice && !draft) { setForm(EMPTY_FORM); return }
    if (!invoice && draft) {
      setForm({
        ...EMPTY_FORM,
        ...draft,
      })
      return
    }
    const f = invoice.fields || {}
    setForm({
      invoice_number:  f['Invoice Number']  || '',
      project:         f['Project']         || '',
      category:        f['Category']        || '',
      description:     f['Description']     || '',
      milestone:       f['Milestone']       || '',
      raised_by:       f['Raised By']       || '',
      raised_date:     f['Raised Date']   ? String(f['Raised Date']).slice(0, 10)   : '',
      cleared_date:    f['Cleared Date']  ? String(f['Cleared Date']).slice(0, 10)  : '',
      amount_raised:   f['Amount Raised']   ?? '',
      amount_with_tax: f['Amount with Tax'] ?? '',
      amount_received: f['Amount Received'] ?? '',
      payment_status:  f['Payment Status']  || 'Pending',
      remark:          f['Remark']          || '',
      next_followup:   f['Next followup'] ? String(f['Next followup']).slice(0, 10) : '',
      reference:       Array.isArray(f['Reference'])   ? f['Reference']   : [],
      invoice_pdf:     Array.isArray(f['Invoice PDF']) ? f['Invoice PDF'] : [],
    })
  }, [invoice, draft])

  useEffect(() => {
    setWorkingRecordId(invoice?.id || null)
    setCategoryLocked(Boolean(invoice?.id))
  }, [invoice?.id])

  const set  = k => v  => setForm(f => ({ ...f, [k]: v }))
  const setE = k => ev => setForm(f => ({ ...f, [k]: ev.target.value }))
  const setCategoryValue = (next) => {
    setCategoryLocked(true)
    setForm(f => ({ ...f, category: next }))
  }
  const setRetainerMode = (enabled, { force = true } = {}) => {
    const nextCategory = enabled ? retainerCategoryOption : getProjectCategoryOption(picklists?.Category || [], form.category)
    if (!force && categoryLocked) return
    setForm(f => ({
      ...f,
      category: nextCategory,
    }))
    if (force) setCategoryLocked(false)
  }

  useEffect(() => {
    if (!invoice?.id && draft?.category == null) {
      setRetainerMode(retainerSelected, { force: false })
    }
  }, [retainerCategoryOption, projectCategoryOption])

  async function persistDraftRecord() {
    if (currentRecordId) return currentRecordId
    const paidDraftIncomplete = form.payment_status === 'Paid' && (!String(form.amount_received).trim() || !form.cleared_date)
    const payload = {
      ...form,
      amount_raised:   form.amount_raised   !== '' ? Number(form.amount_raised)   : undefined,
      amount_with_tax: form.amount_with_tax !== '' ? Number(form.amount_with_tax) : undefined,
      amount_received: form.amount_received !== '' ? Number(form.amount_received) : undefined,
      raised_date:     form.raised_date   ? `${form.raised_date}T00:00:00.000Z`   : undefined,
      cleared_date:    form.cleared_date  ? `${form.cleared_date}T00:00:00.000Z`  : undefined,
      next_followup:   form.next_followup ? `${form.next_followup}T00:00:00.000Z` : undefined,
      payment_status:  paidDraftIncomplete ? 'Pending' : form.payment_status,
      remark: paidDraftIncomplete
        ? [form.remark, 'Draft created for attachment upload. Complete paid details before final save.'].filter(Boolean).join(' ')
        : form.remark,
    }
    const created = await api.webInvoices.create(payload)
    const createdId = created?.id
    if (!createdId) throw new Error('Invoice draft was created but no record id was returned')
    setWorkingRecordId(createdId)
    return createdId
  }

  async function handleSave() {
    if (paidSelected && !String(form.amount_received).trim()) {
      setError('Amount received is required when status is Paid')
      return
    }
    if (paidSelected && !form.cleared_date) {
      setError('Cleared date is required when status is Paid')
      return
    }
    setSaving(true); setError('')
    try {
      const payload = {
        ...form,
        amount_raised:   form.amount_raised   !== '' ? Number(form.amount_raised)   : undefined,
        amount_with_tax: form.amount_with_tax !== '' ? Number(form.amount_with_tax) : undefined,
        amount_received: form.amount_received !== '' ? Number(form.amount_received) : undefined,
        raised_date:     form.raised_date   ? `${form.raised_date}T00:00:00.000Z`   : undefined,
        cleared_date:    form.cleared_date  ? `${form.cleared_date}T00:00:00.000Z`  : undefined,
        next_followup:   form.next_followup ? `${form.next_followup}T00:00:00.000Z` : undefined,
      }
      if (currentRecordId) await api.webInvoices.update(currentRecordId, payload)
      else                 await api.webInvoices.create(payload)
      onSaved()
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirmDel) { setConfirmDel(true); return }
    setDeleting(true)
    try { await api.webInvoices.delete(invoice.id); onDeleted() }
    catch (e) { setError(e.message || 'Delete failed') }
    finally { setDeleting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }} onClick={onClose} aria-hidden="true" />
      <aside className="relative ml-auto flex flex-col h-full overflow-hidden animate-slide-in"
        style={{ width: 'min(100vw,520px)', background: 'var(--sidebar-bg)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', borderLeft: '1px solid var(--glass-border)' }}>

        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--glass-border)' }}>
          <h2 className="font-bold text-sm" style={{ color: 'var(--text-1)' }}>
            {isEdit ? `Edit · ${invoice.fields?.['Invoice Number'] || 'Invoice'}` : 'New Invoice'}
          </h2>
          <button onClick={onClose} className="btn-icon" aria-label="Close"><X size={14} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3.5">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl text-xs"
              style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.20)', color: '#f87171' }}>
              <AlertTriangle size={13} />{error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Invoice Number">
              <input className="input" value={form.invoice_number} onChange={setE('invoice_number')} placeholder="WM/25-26/001" />
            </FieldRow>
            <FieldRow label="Payment Status">
              <SelectInput value={form.payment_status} onChange={set('payment_status')} options={STATUSES} />
            </FieldRow>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Project">
              <PicklistSelect fieldName="Project" value={form.project} onChange={set('project')}
                options={picklists?.Project || []} onOptionsUpdate={onOptionsUpdate} placeholder="Select project…"
                canAddOptions={canEditPicklists} onPermissionError={onPicklistPermissionError} />
            </FieldRow>
            <FieldRow label="Category">
              <PicklistSelect fieldName="Category" value={form.category} onChange={setCategoryValue}
                options={picklists?.Category || []} onOptionsUpdate={onOptionsUpdate} placeholder="Select…"
                canAddOptions={canEditPicklists} onPermissionError={onPicklistPermissionError} />
            </FieldRow>
          </div>

          <div>
            <label className="label">Billing Type</label>
            <div className="inline-flex items-center p-1 rounded-lg" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
              <button
                type="button"
                onClick={() => setRetainerMode(false)}
                className="text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
                style={!retainerSelected
                  ? { background: 'var(--card-bg)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }
                  : { color: 'var(--text-3)' }}>
                Project
              </button>
              <button
                type="button"
                onClick={() => setRetainerMode(true)}
                className="text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
                style={retainerSelected
                  ? { background: 'var(--card-bg)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }
                  : { color: 'var(--text-3)' }}>
                Retainer
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Milestone">
              <PicklistSelect fieldName="Milestone" value={form.milestone} onChange={set('milestone')}
                options={picklists?.Milestone || []} onOptionsUpdate={onOptionsUpdate} placeholder="Select…"
                canAddOptions={canEditPicklists} onPermissionError={onPicklistPermissionError} />
            </FieldRow>
            <FieldRow label="Raised By">
              <PicklistSelect fieldName="Raised By" value={form.raised_by} onChange={set('raised_by')}
                options={picklists?.['Raised By'] || []} onOptionsUpdate={onOptionsUpdate} placeholder="Select…"
                canAddOptions={canEditPicklists} onPermissionError={onPicklistPermissionError} />
            </FieldRow>
          </div>
          <FieldRow label="Description">
            <textarea className="input resize-none" rows={2} value={form.description} onChange={setE('description')} placeholder="Brief description…" />
          </FieldRow>
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Raised Date"><input type="date" className="input" value={form.raised_date} onChange={setE('raised_date')} /></FieldRow>
            <FieldRow label="Cleared Date"><input type="date" className="input" value={form.cleared_date} onChange={setE('cleared_date')} /></FieldRow>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <FieldRow label="Raised (₹)"><input type="number" className="input" value={form.amount_raised}   onChange={setE('amount_raised')}   placeholder="0" /></FieldRow>
            <FieldRow label="With GST (₹)"><input type="number" className="input" value={form.amount_with_tax} onChange={setE('amount_with_tax')} placeholder="0" /></FieldRow>
            <FieldRow label="Received (₹)"><input type="number" className="input" value={form.amount_received} onChange={setE('amount_received')} placeholder="0" /></FieldRow>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Next Followup"><input type="date" className="input" value={form.next_followup} onChange={setE('next_followup')} /></FieldRow>
          </div>
          <FieldRow label="Remark">
            <textarea className="input resize-none" rows={2} value={form.remark} onChange={setE('remark')} placeholder="Notes…" />
          </FieldRow>

          {paidSelected && (
            <div className="rounded-xl p-3 text-xs"
              style={{ background: 'var(--fin-warn-bg)', border: '1px solid var(--fin-warn-border)', color: 'var(--text-2)' }}>
              Paid invoices must include `Amount Received` and `Cleared Date`. It is also recommended to attach a payment reference screenshot before closing the entry.
            </div>
          )}

          {retainerSelected && (
            <div className="rounded-xl p-3 text-xs"
              style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)', color: 'var(--text-2)' }}>
              Retainer mode uses the existing table only. Put the retainer/client name in `Project`. The latest retainer row becomes the monthly template, invoice number can be filled later by the account manager, and paused months are stored as zero-value cancelled records with a reason.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <AttachmentUploadField
              label="Invoice PDF"
              fieldKey="invoice_pdf"
              value={form.invoice_pdf}
              onChange={v => setForm(f => ({ ...f, invoice_pdf: v }))}
              recordId={currentRecordId}
              ensureRecord={persistDraftRecord}
            />
            <AttachmentUploadField
              label="Payment Reference"
              fieldKey="reference"
              value={form.reference}
              onChange={v => setForm(f => ({ ...f, reference: v }))}
              recordId={currentRecordId}
              ensureRecord={persistDraftRecord}
            />
          </div>
        </div>

        <div className="px-5 py-4 flex items-center justify-between gap-3" style={{ borderTop: '1px solid var(--glass-border)' }}>
          {isEdit ? (
            <button onClick={handleDelete} disabled={deleting} className="btn-danger" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
              <Trash2 size={12} />{deleting ? 'Deleting…' : confirmDel ? 'Confirm?' : 'Delete'}
            </button>
          ) : <div />}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
              <Save size={12} />{saving ? 'Saving…' : currentRecordId ? 'Save changes' : 'Create invoice'}
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}

function SkeletonRow() {
  return (
    <tr aria-hidden="true" className="tbl-row">
      {[80, 100, 90, 80, 100, 90, 90, 72, 72, 48, 56, 60].map((w, i) => (
        <td key={i} className="tbl-cell"><div className="skeleton h-3 rounded" style={{ width: w }} /></td>
      ))}
    </tr>
  )
}

/* ── Minimal top bar for the web role ── */
function WebTopBar() {
  const { logout } = useAuth()
  const { dark, toggle } = useTheme()
  return (
    <header className="flex items-center justify-between px-5 py-3 flex-shrink-0 sticky top-0 z-30"
      style={{ background: 'var(--sidebar-bg)', borderBottom: '1px solid var(--sidebar-border)', backdropFilter: 'blur(12px)' }}>
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--accent-btn)', boxShadow: '0 2px 8px rgba(37,99,235,0.3)' }}>
          <Globe size={13} className="text-white" aria-hidden="true" />
        </div>
        <div>
          <p className="font-bold text-sm leading-tight tracking-tight" style={{ color: 'var(--text-1)' }}>Web Invoice Tracker</p>
          <p className="text-[10px] leading-none" style={{ color: 'var(--text-3)' }}>TheWorks</p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button onClick={toggle} className="btn-icon" aria-label={dark ? 'Light mode' : 'Dark mode'} title={dark ? 'Light mode' : 'Dark mode'}>
          {dark ? <Sun size={14} style={{ color: '#facc15' }} /> : <Moon size={14} style={{ color: '#818cf8' }} />}
        </button>
        <button onClick={logout} className="btn-icon" aria-label="Sign out" title="Sign out">
          <LogOut size={13} />
        </button>
      </div>
    </header>
  )
}

/* ── Main page ── */
export default function WebInvoices() {
  const toast = useToast()
  const [workspace,      setWorkspace]      = useState('invoices')
  const [selectedRetainer, setSelectedRetainer] = useState('')
  const [statusFilter,   setStatusFilter]   = useState('')
  const [projectFilter,  setProjectFilter]  = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [raisedByFilter, setRaisedByFilter] = useState('')
  const [billingFilter,  setBillingFilter]  = useState('all')
  const [monthFilter,    setMonthFilter]    = useState('')
  const [retainerMonth,  setRetainerMonth]  = useState(currentMonthKey())
  const [search,         setSearch]         = useState('')
  const [overdueOnly,    setOverdueOnly]    = useState(false)
  const [hasDocsOnly,    setHasDocsOnly]    = useState(false)
  const [followupDueOnly,setFollowupDueOnly]= useState(false)
  const [showFilters,    setShowFilters]    = useState(true)
  const [sortCol,        setSortCol]        = useState('Raised Date')
  const [sortDir,        setSortDir]        = useState('desc')
  const [drawer,         setDrawer]         = useState(null)
  const [picklists,      setPicklists]      = useState(DEFAULT_PICKLISTS)
  const [canEditPicklists, setCanEditPicklists] = useState(true)
  const [picklistPermissionMsg, setPicklistPermissionMsg] = useState('')
  const [retainerActionBusy, setRetainerActionBusy] = useState('')

  useEffect(() => {
    api.webInvoices.picklists.get()
      .then(data => {
        setPicklists(prev => ({
          ...prev,
          ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.options])),
        }))
      })
      .catch(() => {})  // keep fallback defaults on error
  }, [])

  function handleOptionsUpdate(fieldName, newOptions) {
    setPicklists(prev => ({ ...prev, [fieldName]: newOptions }))
  }

  function handlePicklistPermissionError(message) {
    setCanEditPicklists(false)
    setPicklistPermissionMsg(message)
  }

  const fetchSummary = useCallback(() => api.webInvoices.summary(), [])
  const { data: summary, loading: sumLoading } = useAutoRefresh(fetchSummary, 10_000)

  const fetchRecords = useCallback(() =>
    api.webInvoices.list({
      status:   statusFilter  || undefined,
      project:  projectFilter || undefined,
      limit:    500,
      order_by: sortCol,
      order:    sortDir,
    }), [statusFilter, projectFilter, sortCol, sortDir])

  const { data: listData, loading, error, refresh, syncing } = useAutoRefresh(fetchRecords, 10_000)
  const allRecords = listData?.records || []

  const monthOptions = useMemo(() => (
    [...new Set(
      allRecords
        .map(r => monthKey(r.fields?.['Raised Date']))
        .filter(Boolean)
    )].sort().reverse()
  ), [allRecords])

  const retainerMonthOptions = useMemo(() => (
    [...new Set([currentMonthKey(), ...monthOptions])].sort().reverse()
  ), [monthOptions])

  const todayIso = new Date().toISOString().slice(0, 10)

  const records = allRecords.filter(r => {
    const f = r.fields || {}
    const retainer = isRetainerCategory(f['Category'])
    if (billingFilter === 'retainer' && !retainer) return false
    if (billingFilter === 'project' && retainer) return false
    if (categoryFilter && f['Category'] !== categoryFilter) return false
    if (raisedByFilter && f['Raised By'] !== raisedByFilter) return false
    if (monthFilter && monthKey(f['Raised Date']) !== monthFilter) return false
    if (overdueOnly && !(f['Payment Status'] === 'Pending' && Number(f['Agening (Days)'] || 0) > 30)) return false
    if (followupDueOnly) {
      const nextFollowup = String(f['Next followup'] || '').slice(0, 10)
      if (!nextFollowup || nextFollowup > todayIso) return false
    }
    if (hasDocsOnly) {
      const refs = parseAttachments(f['Reference'])
      const pdfs = parseAttachments(f['Invoice PDF'])
      if (refs.length + pdfs.length === 0) return false
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      return (
        (f['Invoice Number'] || '').toLowerCase().includes(q) ||
        (f['Project']        || '').toLowerCase().includes(q) ||
        (f['Description']    || '').toLowerCase().includes(q) ||
        (f['Category']       || '').toLowerCase().includes(q) ||
        (f['Milestone']      || '').toLowerCase().includes(q)
      )
    }
    return true
  })

  const s        = summary
  const overdue  = s?.overdue_invoices || []
  const hasFilters = statusFilter || projectFilter || categoryFilter || raisedByFilter || billingFilter !== 'all' || monthFilter || overdueOnly || hasDocsOnly || followupDueOnly || search
  const projectSummaryCards = useMemo(() => {
    const entries = Object.entries(s?.by_project || {})
      .sort(([, a], [, b]) => (b?.raised || 0) - (a?.raised || 0))
      .slice(0, 8)
    return entries.map(([project, metrics]) => ({ project, metrics }))
  }, [s])

  const retainerGroups = useMemo(() => {
    const retainerRecords = allRecords.filter(r => isRetainerCategory(r.fields?.['Category']))
    const grouped = new Map()
    for (const record of retainerRecords) {
      const project = String(record.fields?.['Project'] || '').trim() || 'Unnamed Retainer'
      if (!grouped.has(project)) grouped.set(project, [])
      grouped.get(project).push(record)
    }

    return [...grouped.entries()].map(([project, items]) => {
      const sorted = sortByRaisedDateDesc(items)
      const latestActive = sorted.find(r => r.fields?.['Payment Status'] !== 'Cancelled') || sorted[0]
      const monthRecord = sorted.find(r => monthKey(r.fields?.['Raised Date']) === retainerMonth)
      const recordByMonth = Object.fromEntries(
        sorted
          .map(r => [monthKey(r.fields?.['Raised Date']), r])
          .filter(([k]) => Boolean(k))
      )
      const amount = Number(latestActive?.fields?.['Amount Raised'] || 0)
      const withTax = Number(latestActive?.fields?.['Amount with Tax'] || 0)
      const monthStatus = !monthRecord
        ? 'Missing'
        : monthRecord.fields?.['Payment Status'] === 'Cancelled'
          ? 'Paused'
          : monthRecord.fields?.['Payment Status'] || 'Pending'
      const timelineMonths = Array.from({ length: 8 }, (_, i) => shiftMonthKey(currentMonthKey(), i - 3))
      const timeline = timelineMonths.map((key) => {
        const rec = recordByMonth[key]
        const recStatus = !rec
          ? 'Missing'
          : rec.fields?.['Payment Status'] === 'Cancelled'
            ? 'Paused'
            : rec.fields?.['Payment Status'] === 'Paid'
              ? 'Raised'
              : 'Pending'
        return {
          key,
          label: shortMonthLabel(key),
          fullLabel: monthLabel(key),
          record: rec,
          status: recStatus,
          active: key === retainerMonth,
          current: key === currentMonthKey(),
        }
      })
      const currentTimeline = timeline.find(t => t.current)
      const currentMonthRaised = currentTimeline ? currentTimeline.status !== 'Missing' : false
      let nextDueMonth = currentMonthKey()
      for (let i = 0; i < 12; i++) {
        const key = shiftMonthKey(currentMonthKey(), i)
        const rec = recordByMonth[key]
        const paused = rec?.fields?.['Payment Status'] === 'Cancelled'
        if (!rec || paused) {
          nextDueMonth = paused ? shiftMonthKey(key, 1) : key
          break
        }
        nextDueMonth = shiftMonthKey(key, 1)
      }

      return {
        project,
        records: sorted,
        latestActive,
        recordByMonth,
        monthRecord,
        amount,
        withTax,
        monthStatus,
        timeline,
        currentMonthRaised,
        nextDueMonth,
        raisedBy: latestActive?.fields?.['Raised By'] || '',
        description: latestActive?.fields?.['Description'] || '',
      }
    }).sort((a, b) => a.project.localeCompare(b.project))
  }, [allRecords, retainerMonth])

  useEffect(() => {
    if (!retainerGroups.length) {
      setSelectedRetainer('')
      return
    }
    if (!selectedRetainer || !retainerGroups.some(g => g.project === selectedRetainer)) {
      setSelectedRetainer(retainerGroups[0].project)
    }
  }, [retainerGroups, selectedRetainer])

  const selectedRetainerGroup = retainerGroups.find(g => g.project === selectedRetainer) || null

  async function createRetainerMonth(group, mode) {
    if (!group?.latestActive) {
      toast('No existing retainer template found for this project', 'warning')
      return
    }
    const isPause = mode === 'pause'
    const monthName = monthLabel(retainerMonth)
    const pauseReason = isPause
      ? window.prompt(`Why is ${group.project} paused for ${monthName}?`, '')
      : null
    if (isPause && pauseReason == null) return
    const key = `${mode}:${group.project}:${retainerMonth}`
    setRetainerActionBusy(key)
    try {
      const base = group.latestActive.fields || {}
      const payload = {
        invoice_number: '',
        project: group.project,
        category: base['Category'] || getRetainerCategoryOption(picklists?.Category || []),
        description: isPause
          ? `Retainer paused for ${monthName}`
          : `Recurring retainer invoice for ${monthName}. Update invoice number before sharing.`,
        milestone: base['Milestone'] || null,
        raised_by: base['Raised By'] || null,
        raised_date: firstDayIso(retainerMonth),
        amount_raised: isPause ? 0 : Number(base['Amount Raised'] || 0),
        amount_with_tax: isPause ? 0 : Number(base['Amount with Tax'] || 0),
        amount_received: isPause ? 0 : undefined,
        payment_status: isPause ? 'Cancelled' : 'Pending',
        remark: isPause
          ? `Paused for ${monthName}. Reason: ${(pauseReason || 'Not specified').trim()}`
          : `Recurring retainer for ${monthName}. Invoice number to be updated by account manager.`,
      }
      await api.webInvoices.create(payload)
      toast(isPause ? `Paused ${group.project} for ${monthName}` : `Created ${monthName} retainer for ${group.project}`, 'success')
      refresh()
    } catch (e) {
      toast(e.message || 'Failed to create retainer month', 'error')
    } finally {
      setRetainerActionBusy('')
    }
  }

  function openInvoiceRequestForm(group, monthKeyValue) {
    const label = monthLabel(monthKeyValue)
    const confirmed = window.confirm(
      `Open the external invoice request form for ${group.project} (${label})?`
    )
    if (!confirmed) return
    window.open(INVOICE_REQUEST_FORM_URL, '_blank', 'noopener,noreferrer')
  }

  function openRetainerRecordForm(group, monthKeyValue) {
    const base = group?.latestActive?.fields || {}
    const label = monthLabel(monthKeyValue)
    setDrawer({
      mode: 'new',
      invoice: null,
      draft: {
        invoice_number: '',
        project: group.project,
        category: base['Category'] || getRetainerCategoryOption(picklists?.Category || []),
        description: `Retainer invoice recorded for ${label}`,
        milestone: base['Milestone'] || '',
        raised_by: base['Raised By'] || '',
        raised_date: `${monthKeyValue}-01`,
        cleared_date: '',
        amount_raised: base['Amount Raised'] ?? '',
        amount_with_tax: base['Amount with Tax'] ?? '',
        amount_received: '',
        payment_status: 'Pending',
        remark: `Invoice already raised via Zoho form for ${label}. Enter invoice number and final details here.`,
        next_followup: '',
        reference: [],
        invoice_pdf: [],
      },
    })
  }

  const openNew     = () => setDrawer({ mode: 'new',  invoice: null, draft: null })
  const openView    = r  => setDrawer({ mode: 'view', invoice: r   })
  const closeDrawer = () => setDrawer(null)
  const handleSaved   = () => { refresh(); closeDrawer() }
  const handleDeleted = () => { refresh(); closeDrawer() }

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  function SortLabel({ col, children }) {
    const active = sortCol === col
    return (
      <button onClick={() => handleSort(col)}
        className="inline-flex items-center gap-1 cursor-pointer select-none section-title"
        style={{ color: active ? 'var(--text-2)' : 'var(--text-3)', background: 'none', border: 'none', padding: 0 }}>
        {children}<ArrowUpDown size={10} style={{ opacity: active ? 0.9 : 0.25 }} />
      </button>
    )
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'var(--bg-base)' }}>
      <WebTopBar />

      <main className="flex-1 overflow-y-auto">
        <div className="p-4 sm:p-6 space-y-5 animate-fade-in">

          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.025em' }}>Invoices</h1>
              <p className="text-xs mt-1 flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
                <span className="live-dot" />
                <span>Live sync · {allRecords.length} invoice{allRecords.length !== 1 ? 's' : ''}</span>
                {syncing && <span style={{ color: 'var(--fin-warning)' }}>· syncing…</span>}
              </p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={() => window.open(INVOICE_REQUEST_FORM_URL, '_blank', 'noopener,noreferrer')} className="btn-ghost">
                <ExternalLink size={14} />
                <span className="hidden sm:inline">Raise Externally</span>
                <span className="sm:hidden">Raise</span>
              </button>
              <button onClick={refresh} disabled={loading} aria-label="Refresh" className="btn-icon">
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
              <button onClick={openNew} className="btn-primary">
                <Plus size={14} />
                <span className="hidden sm:inline">New Invoice</span>
                <span className="sm:hidden">New</span>
              </button>
            </div>
          </div>

          <div className="card flex items-center justify-between gap-4 flex-wrap" style={{ padding: '0.85rem 1rem' }}>
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex items-center p-1 rounded-lg" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
              {[
                ['invoices', 'Invoices'],
                ['retainers', 'Retainers'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setWorkspace(value)}
                  className="text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
                  style={workspace === value
                    ? { background: 'var(--card-bg)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }
                    : { color: 'var(--text-3)' }}>
                  {label}
                </button>
              ))}
            </div>
            <div className="inline-flex items-center p-1 rounded-lg" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
              {[
                ['all', 'All'],
                ['project', 'Projects'],
                ['retainer', 'Retainers'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setBillingFilter(value)}
                  className="text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
                  style={billingFilter === value
                    ? { background: 'var(--card-bg)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }
                    : { color: 'var(--text-3)' }}>
                  {label}
                </button>
              ))}
            </div>
              </div>
              <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                Retainer workflow uses `Project` as the retainer/client name for now. Category follows the selected billing type until the user overrides it manually.
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Quick Actions</span>
              <button onClick={openNew} className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.45rem 0.8rem' }}>
                <Plus size={13} />New invoice
              </button>
              <button onClick={() => window.open(INVOICE_REQUEST_FORM_URL, '_blank', 'noopener,noreferrer')} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.45rem 0.8rem' }}>
                <ExternalLink size={13} />Open request form
              </button>
            </div>
          </div>

          {/* KPIs */}
          <section aria-label="Invoice metrics" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            <KpiCard tone={0} label="Total Raised"    value={sumLoading && !s ? null : fmt(s?.total_raised)}    icon={IndianRupee} />
            <KpiCard tone={1} label="Incl. GST"       value={sumLoading && !s ? null : fmt(s?.total_with_tax)}  icon={Receipt} />
            <KpiCard tone={2} label="Collected"       value={sumLoading && !s ? null : fmt(s?.total_received)}  icon={TrendingUp} semantic="positive" />
            <KpiCard tone={3} label="Outstanding"
              value={sumLoading && !s ? null : fmt(s?.total_outstanding)}
              icon={CalendarClock}
              semantic={(s?.total_outstanding || 0) > 0 ? 'warning' : 'positive'}
              sub={(s?.total_outstanding || 0) > 0 ? `${s?.by_status?.Pending || 0} pending` : 'Fully collected'} />
            <KpiCard tone={4} label="Collection Rate"
              value={sumLoading && !s ? null : s ? `${(s.collection_rate ?? 0).toFixed(1)}%` : '—'}
              icon={Percent}
              semantic={(s?.collection_rate || 0) >= 90 ? 'positive' : (s?.collection_rate || 0) >= 70 ? 'warning' : 'negative'} />
          </section>

          {/* Status chips */}
          {s?.by_status && Object.keys(s.by_status).length > 0 && (
            <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {Object.entries(s.by_status).map(([status, count]) => {
                const m = STATUS_META[status] || { color: 'var(--text-2)', bg: 'var(--fin-pos-bg)', border: 'var(--fin-pos-border)', icon: CheckCircle2 }
                const Icon = m.icon
                const active = statusFilter === status
                const amount = s?.by_status_amounts?.[status]
                return (
                  <button key={status}
                    onClick={() => setStatusFilter(active ? '' : status)}
                    className="card flex items-center gap-4 p-4 cursor-pointer text-left transition-all"
                    style={{
                      borderColor: active ? m.color : 'var(--card-border)',
                      background: active ? `${m.color}10` : 'var(--card-bg)',
                      boxShadow: active ? `0 0 0 2px ${m.color}30, var(--card-shadow)` : 'var(--card-shadow)',
                    }}
                    aria-pressed={active}>
                    <div className="kpi-icon flex-shrink-0" style={{ background: `${m.color}18` }}>
                      {Icon && <Icon size={18} style={{ color: m.color }} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>{status}</p>
                      <p className="font-bold text-2xl tabular-nums leading-none" style={{ color: m.color }}>{count}</p>
                      {amount != null && (
                        <p className="text-[11px] tabular-nums mt-1 font-medium" style={{ color: 'var(--text-2)' }}>{fmt(amount)}</p>
                      )}
                    </div>
                    {active && <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: m.color }} />}
                  </button>
                )
              })}
            </section>
          )}

          {/* Overdue alert */}
          {overdue.length > 0 && (
            <section className="rounded-2xl p-4 animate-slide-down"
              style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.16)' }}>
              <div className="flex items-center gap-2 mb-3">
                <AlertOctagon size={14} style={{ color: '#f87171' }} />
                <p className="text-sm font-semibold" style={{ color: '#f87171' }}>
                  {overdue.length} Overdue — pending more than 30 days
                </p>
              </div>
              <div className="space-y-1.5">
                {overdue.map((inv, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 px-3 rounded-lg"
                    style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.10)' }}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-xs font-semibold shrink-0" style={{ color: 'var(--text-1)' }}>{inv.invoice_no}</span>
                      <span className="text-xs truncate" style={{ color: 'var(--text-3)' }}>{inv.project}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--fin-warning)' }}>{fmt(inv.amount)}</span>
                      <AgingBadge days={inv.aging} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {workspace === 'retainers' && (
            <section className="card space-y-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-lg font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.02em' }}>Retainer Workspace</h2>
                  <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
                    <strong style={{ color: 'var(--text-1)' }}>Raise externally.</strong> Use the Zoho invoice request form when a retainer invoice needs to be raised.
                    <span> </span>
                    <strong style={{ color: 'var(--text-1)' }}>Record internally.</strong> Once it has been raised, store the final invoice number and details here.
                  </p>
                </div>
                <div className="relative">
                  <CalendarClock size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
                  <select value={retainerMonth} onChange={e => setRetainerMonth(e.target.value)}
                    className="input pl-7 py-1.5 text-xs appearance-none" style={{ width: 'auto', minWidth: 170, paddingRight: '1.5rem' }}>
                    {retainerMonthOptions.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
                  </select>
                  <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
                </div>
              </div>

              {retainerGroups.length === 0 ? (
                <div className="rounded-xl p-8 text-center" style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)' }}>
                  <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>No retainer templates found</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                    Create a normal invoice and set the category to your retainer category first.
                  </p>
                </div>
              ) : (
              <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-4">
                <div className="space-y-3">
                  {retainerGroups.map(group => (
                    <button
                      key={group.project}
                      type="button"
                      onClick={() => setSelectedRetainer(group.project)}
                      className="w-full text-left rounded-xl p-4 transition-all"
                      style={{
                        background: selectedRetainer === group.project ? 'var(--accent-dim)' : 'var(--bg-layer)',
                        border: `1px solid ${selectedRetainer === group.project ? 'var(--accent)' : 'var(--card-border)'}`,
                        boxShadow: selectedRetainer === group.project ? '0 0 0 2px rgba(37,99,235,0.10)' : 'none',
                      }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate" style={{ color: 'var(--text-1)' }}>{group.project}</p>
                          <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                            {fmt(group.amount)} template · next due {monthLabel(group.nextDueMonth)}
                          </p>
                        </div>
                        <MonthStatusPill status={group.monthStatus} active={selectedRetainer === group.project} />
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-3">
                        <div>
                          <p className="label">Current month</p>
                          <p className="text-xs font-medium" style={{ color: group.currentMonthRaised ? 'var(--fin-positive)' : 'var(--fin-warning)' }}>
                            {group.currentMonthRaised ? 'Raised / planned' : 'Missing'}
                          </p>
                        </div>
                        <div>
                          <p className="label">Raised by</p>
                          <p className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>{group.raisedBy || '—'}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>

                {selectedRetainerGroup && (() => {
                  const group = selectedRetainerGroup
                  const monthRec = group.monthRecord?.fields || null
                  const missing = !monthRec
                  const busyCreate = retainerActionBusy === `create:${group.project}:${retainerMonth}`
                  const busyPause = retainerActionBusy === `pause:${group.project}:${retainerMonth}`
                  return (
                    <div className="rounded-xl p-4 space-y-4" style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)' }}>
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <p className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>{group.project}</p>
                          <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
                            Template amount {fmt(group.amount)}{group.withTax ? ` · GST total ${fmt(group.withTax)}` : ''} · Next due {monthLabel(group.nextDueMonth)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <MonthStatusPill status={group.monthStatus} active />
                          <span className="text-xs px-2 py-1 rounded-full"
                            style={{
                              background: group.currentMonthRaised ? 'var(--fin-pos-bg)' : 'var(--fin-warn-bg)',
                              color: group.currentMonthRaised ? 'var(--fin-positive)' : 'var(--fin-warning)',
                              border: `1px solid ${group.currentMonthRaised ? 'var(--fin-pos-border)' : 'var(--fin-warn-border)'}`,
                            }}>
                            {group.currentMonthRaised ? 'Current month covered' : 'Current month not raised'}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <div className="card p-3">
                          <p className="label">Tracking month</p>
                          <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{monthLabel(retainerMonth)}</p>
                        </div>
                        <div className="card p-3">
                          <p className="label">Month invoice #</p>
                          <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{monthRec?.['Invoice Number'] || 'Pending update'}</p>
                        </div>
                        <div className="card p-3">
                          <p className="label">Raised by</p>
                          <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{group.raisedBy || '—'}</p>
                        </div>
                        <div className="card p-3">
                          <p className="label">Month remark</p>
                          <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{monthRec?.['Remark'] || '—'}</p>
                        </div>
                      </div>

                      <div>
                        <p className="label mb-2">Month Timeline</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2">
                          {group.timeline.map(item => (
                            <button
                              key={item.key}
                              type="button"
                              onClick={() => setRetainerMonth(item.key)}
                              className="rounded-xl p-3 text-left transition-all"
                              style={{
                                background: item.current ? 'var(--accent-dim)' : 'var(--bg-base)',
                                border: `1px solid ${item.active ? 'var(--accent)' : 'var(--card-border)'}`,
                                boxShadow: item.active ? '0 0 0 2px rgba(37,99,235,0.12)' : 'none',
                              }}>
                              <div className="flex items-center justify-between gap-2 mb-2">
                                <p className="text-[11px] font-semibold" style={{ color: item.current ? 'var(--accent)' : 'var(--text-2)' }}>
                                  {item.label}
                                </p>
                                {item.current && <span className="text-[9px] font-bold" style={{ color: 'var(--accent)' }}>NOW</span>}
                              </div>
                              <MonthStatusPill status={item.status} active={item.active} />
                              <p className="text-[10px] mt-2 truncate" style={{ color: 'var(--text-3)' }}>
                                {item.record?.fields?.['Invoice Number'] || 'No record'}
                              </p>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <p className="label mb-0">Monthly Records</p>
                          <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                            Bold month cards with direct record access
                          </span>
                        </div>
                        <div className="space-y-2">
                          {group.timeline.map(item => {
                            const rec = item.record
                            const f = rec?.fields || {}
                            const key = `${item.key}-${group.project}`
                            return (
                              <div key={key} className="rounded-xl p-3 flex items-center justify-between gap-3"
                                style={{
                                  background: item.active ? 'var(--accent-dim)' : 'var(--bg-base)',
                                  border: `1px solid ${item.active ? 'var(--accent-soft)' : 'var(--card-border)'}`,
                                }}>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{item.fullLabel}</p>
                                    <MonthStatusPill status={item.status} active={item.active} />
                                  </div>
                                  <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-3)' }}>
                                    {rec
                                      ? `${f['Invoice Number'] || 'Invoice number pending'} · ${fmt(f['Amount Raised'])} · ${f['Remark'] || 'No remark'}`
                                      : 'No record created for this month yet'}
                                  </p>
                                </div>
                                <div className="flex gap-2 flex-shrink-0">
                                  {rec ? (
                                    <button onClick={() => openView(rec)}
                                      className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
                                      View
                                    </button>
                                  ) : item.key === retainerMonth ? (
                                    <>
                                      <button onClick={() => openInvoiceRequestForm(group, item.key)}
                                        className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
                                        Open request form
                                      </button>
                                      <button onClick={() => openRetainerRecordForm(group, item.key)}
                                        className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
                                        Record raised invoice
                                      </button>
                                      <button onClick={() => createRetainerMonth(group, 'pause')} disabled={busyPause || !!retainerActionBusy}
                                        className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem', color: 'var(--fin-negative)' }}>
                                        {busyPause ? 'Pausing…' : 'Pause month'}
                                      </button>
                                    </>
                                  ) : (
                                    <button onClick={() => setRetainerMonth(item.key)}
                                      className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
                                      Track month
                                    </button>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      {group.description && (
                        <div className="rounded-xl p-3" style={{ background: 'var(--bg-base)', border: '1px solid var(--card-border)' }}>
                          <p className="label">Template Note</p>
                          <p className="text-sm" style={{ color: 'var(--text-2)' }}>{group.description}</p>
                        </div>
                      )}

                      {missing && (
                        <div className="flex gap-2 flex-wrap">
                          <button onClick={() => openInvoiceRequestForm(group, retainerMonth)}
                            className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
                            Open invoice request form
                          </button>
                          <button onClick={() => openRetainerRecordForm(group, retainerMonth)}
                            className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
                            Record already raised invoice
                          </button>
                          <button onClick={() => createRetainerMonth(group, 'pause')} disabled={busyPause || !!retainerActionBusy}
                            className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem', color: 'var(--fin-negative)' }}>
                            {busyPause ? 'Pausing…' : 'Pause month'}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
              )}
            </section>
          )}

          {workspace === 'invoices' && (
          <>
          {projectSummaryCards.length > 0 && (
            <section className="card space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Project Snapshot</h2>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                    Click any project card to filter the invoice list.
                  </p>
                </div>
                {projectFilter && (
                  <button
                    onClick={() => setProjectFilter('')}
                    className="btn-ghost"
                    style={{ fontSize: '0.75rem', padding: '0.375rem 0.625rem' }}>
                    <X size={11} />Clear project filter
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                {projectSummaryCards.map(({ project, metrics }) => {
                  const active = projectFilter === project
                  return (
                    <button
                      key={project}
                      type="button"
                      onClick={() => setProjectFilter(active ? '' : project)}
                      className="rounded-xl p-4 text-left transition-all"
                      style={{
                        background: active ? 'var(--accent-dim)' : 'var(--bg-layer)',
                        border: `1px solid ${active ? 'var(--accent)' : 'var(--card-border)'}`,
                        boxShadow: active ? '0 0 0 2px rgba(37,99,235,0.10)' : 'var(--shadow-sm)',
                      }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{project}</p>
                          <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>{metrics.count || 0} invoice{metrics.count === 1 ? '' : 's'}</p>
                        </div>
                        {active && <CheckCircle2 size={14} style={{ color: 'var(--accent)' }} />}
                      </div>
                      <div className="grid grid-cols-3 gap-2 mt-4">
                        <div>
                          <p className="label">Raised</p>
                          <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-1)' }}>{fmt(metrics.raised)}</p>
                        </div>
                        <div>
                          <p className="label">Received</p>
                          <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--fin-positive)' }}>{fmt(metrics.received)}</p>
                        </div>
                        <div>
                          <p className="label">Open</p>
                          <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--fin-warning)' }}>{fmt(metrics.outstanding)}</p>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {/* Filter bar */}
          <div className="card space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Invoice Filters</h2>
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                  Filters stay open by default for quicker scanning across monthly and project billing.
                </p>
              </div>
              <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-3)' }}>
                {records.length} result{records.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search invoice #, project, description…"
                  className="input pl-8 py-1.5 text-xs" />
              </div>
              <button onClick={() => setShowFilters(f => !f)} aria-expanded={showFilters}
                className={clsx('btn-icon flex items-center gap-1.5 px-3', showFilters && 'border-opacity-60')}
                style={{ borderColor: hasFilters ? 'var(--accent)' : undefined }}>
                <Filter size={13} /><span className="text-xs">Filters</span>
                {hasFilters && <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)' }} />}
              </button>
              {hasFilters && (
                <button onClick={() => {
                  setStatusFilter('')
                  setProjectFilter('')
                  setCategoryFilter('')
                  setRaisedByFilter('')
                  setBillingFilter('all')
                  setMonthFilter('')
                  setOverdueOnly(false)
                  setHasDocsOnly(false)
                  setFollowupDueOnly(false)
                  setSearch('')
                }}
                  className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.625rem' }}>
                  <X size={11} />Clear
                </button>
              )}
            </div>

            {showFilters && (
              <div className="flex flex-wrap gap-2 p-3 rounded-xl animate-slide-down"
                style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                <div className="relative">
                  <User size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
                  <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)}
                    className="input pl-7 py-1.5 text-xs appearance-none" style={{ width: 'auto', minWidth: 140, paddingRight: '1.5rem' }}>
                    <option value="">All projects</option>
                    {(picklists.Project || []).map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
                </div>
                <div className="relative">
                  <CalendarClock size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
                  <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)}
                    className="input pl-7 py-1.5 text-xs appearance-none" style={{ width: 'auto', minWidth: 170, paddingRight: '1.5rem' }}>
                    <option value="">All months</option>
                    {monthOptions.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
                  </select>
                  <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
                </div>
                <div className="relative">
                  <Tag size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
                  <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
                    className="input pl-7 py-1.5 text-xs appearance-none" style={{ width: 'auto', minWidth: 160, paddingRight: '1.5rem' }}>
                    <option value="">All categories</option>
                    {(picklists.Category || []).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
                </div>
                <div className="relative">
                  <User size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
                  <select value={raisedByFilter} onChange={e => setRaisedByFilter(e.target.value)}
                    className="input pl-7 py-1.5 text-xs appearance-none" style={{ width: 'auto', minWidth: 130, paddingRight: '1.5rem' }}>
                    <option value="">Anyone</option>
                    {(picklists['Raised By'] || []).map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
                </div>
                <button
                  onClick={() => setOverdueOnly(v => !v)}
                  className="btn-ghost"
                  style={{
                    fontSize: '0.75rem',
                    padding: '0.375rem 0.625rem',
                    color: overdueOnly ? 'var(--fin-negative)' : 'var(--text-2)',
                    borderColor: overdueOnly ? 'var(--fin-neg-border)' : 'var(--card-border)',
                    background: overdueOnly ? 'var(--fin-neg-bg)' : 'var(--card-bg)',
                  }}>
                  Overdue only
                </button>
                <button
                  onClick={() => setFollowupDueOnly(v => !v)}
                  className="btn-ghost"
                  style={{
                    fontSize: '0.75rem',
                    padding: '0.375rem 0.625rem',
                    color: followupDueOnly ? 'var(--fin-warning)' : 'var(--text-2)',
                    borderColor: followupDueOnly ? 'var(--fin-warn-border)' : 'var(--card-border)',
                    background: followupDueOnly ? 'var(--fin-warn-bg)' : 'var(--card-bg)',
                  }}>
                  Follow-up due
                </button>
                <button
                  onClick={() => setHasDocsOnly(v => !v)}
                  className="btn-ghost"
                  style={{
                    fontSize: '0.75rem',
                    padding: '0.375rem 0.625rem',
                    color: hasDocsOnly ? 'var(--accent)' : 'var(--text-2)',
                    borderColor: hasDocsOnly ? 'var(--accent-soft)' : 'var(--card-border)',
                    background: hasDocsOnly ? 'var(--accent-dim)' : 'var(--card-bg)',
                  }}>
                  Has docs
                </button>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div role="alert" className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs"
              style={{ background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.18)', color: '#f87171' }}>
              <AlertTriangle size={13} className="shrink-0" />{error}
              <button onClick={refresh} className="underline ml-1">retry</button>
            </div>
          )}

          {picklistPermissionMsg && (
            <div className="flex items-start gap-2 px-4 py-3 rounded-xl text-xs"
              style={{ background: 'var(--fin-warn-bg)', border: '1px solid var(--fin-warn-border)', color: 'var(--text-2)' }}>
              <AlertTriangle size={13} className="shrink-0 mt-0.5" style={{ color: 'var(--fin-warning)' }} />
              <span>{picklistPermissionMsg}</span>
            </div>
          )}

          {/* Mobile card list */}
          <div className="md:hidden space-y-2.5">
            {loading && !listData
              ? Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="card animate-pulse">
                    <div className="skeleton h-3 w-2/5 mb-3 rounded" />
                    <div className="skeleton h-5 w-3/5 rounded" />
                  </div>
                ))
              : records.length === 0
                ? <div className="card text-center py-10 text-sm" style={{ color: 'var(--text-3)' }}>
                    No invoices found.{' '}
                    <button onClick={openNew} style={{ color: 'var(--accent)' }} className="underline font-medium">Create one</button>
                  </div>
                : records.map(r => {
                    const f = r.fields || {}
                    const outstanding = Number(f['Outstanding Amount'] || 0)
                    const refs = parseAttachments(f['Reference'])
                    const pdfs = parseAttachments(f['Invoice PDF'])
                    const allFiles = [...refs, ...pdfs]
                    return (
                      <button key={r.id} onClick={() => openView(r)} className="card-hover w-full text-left animate-slide-up" style={{ padding: '0.875rem 1rem' }}>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="min-w-0 flex-1">
                            <p className="font-mono text-[12px] font-bold truncate" style={{ color: 'var(--text-1)' }}>{f['Invoice Number'] || '—'}</p>
                            <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-3)' }}>
                              {f['Project'] || '—'}{f['Category'] ? ` · ${f['Category']}` : ''}
                            </p>
                          </div>
                          <StatusPill status={f['Payment Status']} />
                        </div>
                        <div className="flex items-end justify-between gap-3 mb-2">
                          <div>
                            <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Amount</p>
                            <p className="font-bold tabular-nums text-base" style={{ color: 'var(--text-1)' }}>{fmt(f['Amount Raised'])}</p>
                          </div>
                          {outstanding > 0 && (
                            <div className="text-right">
                              <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Outstanding</p>
                              <p className="font-bold tabular-nums text-sm" style={{ color: 'var(--fin-warning)' }}>{fmt(outstanding)}</p>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-3)' }}>
                          <span className="tabular-nums">{fmtDate(f['Raised Date'])}</span>
                          <div className="flex items-center gap-2">
                            {allFiles.length > 0 && <span className="flex items-center gap-0.5"><FileText size={10} />{allFiles.length}</span>}
                            <AgingBadge days={f['Agening (Days)']} />
                          </div>
                        </div>
                      </button>
                    )
                  })
            }
          </div>

          {/* Desktop table */}
          <div className="hidden md:block card p-0 overflow-hidden" style={{ borderRadius: 14 }}>
            <div className="overflow-x-auto">
              <table className="w-full" style={{ minWidth: 960 }}>
                <thead>
                  <tr>
                    <th className="tbl-head"><SortLabel col="Invoice Number">Invoice #</SortLabel></th>
                    <th className="tbl-head"><SortLabel col="Project">Project</SortLabel></th>
                    <th className="tbl-head">Category</th>
                    <th className="tbl-head"><SortLabel col="Raised Date">Raised</SortLabel></th>
                    <th className="tbl-head"><SortLabel col="Amount Raised">Amount</SortLabel></th>
                    <th className="tbl-head">GST Total</th>
                    <th className="tbl-head">Received</th>
                    <th className="tbl-head">Outstanding</th>
                    <th className="tbl-head">Status</th>
                    <th className="tbl-head"><SortLabel col="Agening (Days)">Aging</SortLabel></th>
                    <th className="tbl-head">Docs</th>
                    <th className="tbl-head" style={{ width: 80 }} />
                  </tr>
                </thead>
                <tbody>
                  {loading && !listData
                    ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
                    : records.length === 0
                      ? <tr><td colSpan={12} className="px-4 py-14 text-center text-sm" style={{ color: 'var(--text-3)' }}>
                          No invoices found.{' '}
                          <button onClick={openNew} style={{ color: 'var(--accent)' }} className="underline">Create one</button>
                        </td></tr>
                      : records.map(r => {
                          const f = r.fields || {}
                          const outstanding = Number(f['Outstanding Amount'] || 0)
                          const refs = parseAttachments(f['Reference'])
                          const pdfs = parseAttachments(f['Invoice PDF'])
                          const allFiles = [...refs, ...pdfs]
                          return (
                            <tr key={r.id} className="tbl-row" style={{ cursor: 'pointer' }} onClick={() => openView(r)}>
                              <td className="tbl-cell"><span className="font-mono text-xs font-bold" style={{ color: 'var(--text-1)' }}>{f['Invoice Number'] || '—'}</span></td>
                              <td className="tbl-cell"><span className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>{f['Project'] || '—'}</span></td>
                              <td className="tbl-cell"><span className="text-[11px]" style={{ color: 'var(--text-2)' }}>{f['Category'] || '—'}</span></td>
                              <td className="tbl-cell"><span className="text-xs tabular-nums" style={{ color: 'var(--text-2)' }}>{fmtDate(f['Raised Date'])}</span></td>
                              <td className="tbl-cell"><span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--text-1)' }}>{fmt(f['Amount Raised'])}</span></td>
                              <td className="tbl-cell"><span className="text-xs tabular-nums" style={{ color: 'var(--text-2)' }}>{fmt(f['Amount with Tax'])}</span></td>
                              <td className="tbl-cell"><span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--fin-positive)' }}>{fmt(f['Amount Received'])}</span></td>
                              <td className="tbl-cell">
                                {outstanding > 0
                                  ? <span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--fin-warning)' }}>{fmt(outstanding)}</span>
                                  : <span className="text-xs" style={{ color: 'var(--text-3)' }}>—</span>}
                              </td>
                              <td className="tbl-cell"><StatusPill status={f['Payment Status']} /></td>
                              <td className="tbl-cell"><AgingBadge days={f['Agening (Days)']} /></td>
                              <td className="tbl-cell" onClick={e => e.stopPropagation()}>
                                {allFiles.length > 0 ? (
                                  <div className="flex items-center gap-1">
                                    {allFiles.slice(0, 2).map((a, i) => <AttachThumb key={i} a={a} size={28} />)}
                                    {allFiles.length > 2 && <span className="text-[10px] px-1" style={{ color: 'var(--text-3)' }}>+{allFiles.length - 2}</span>}
                                  </div>
                                ) : <span className="text-xs" style={{ color: 'var(--text-3)' }}>—</span>}
                              </td>
                              <td className="tbl-cell" onClick={e => e.stopPropagation()}>
                                <button onClick={() => openView(r)}
                                  className="btn-ghost flex items-center gap-1.5"
                                  style={{ fontSize: '0.6875rem', padding: '0.3rem 0.65rem', color: 'var(--accent)', borderColor: 'rgba(79,70,229,0.3)' }}>
                                  <Eye size={12} /><span className="text-[11px] font-semibold">View</span>
                                </button>
                              </td>
                            </tr>
                          )
                        })
                  }
                </tbody>
              </table>
            </div>
          </div>
          </>
          )}

        </div>
      </main>

      {/* Drawers */}
      {drawer?.mode === 'view' && createPortal(
        <InvoiceDetail invoice={drawer.invoice} onClose={closeDrawer} onEdit={() => setDrawer({ mode: 'edit', invoice: drawer.invoice })} />,
        document.body
      )}
      {(drawer?.mode === 'new' || drawer?.mode === 'edit') && createPortal(
        <InvoiceDrawer
          invoice={drawer.mode === 'edit' ? drawer.invoice : null}
          draft={drawer.mode === 'new' ? drawer.draft : null}
          onClose={closeDrawer}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          picklists={picklists}
          onOptionsUpdate={handleOptionsUpdate}
          canEditPicklists={canEditPicklists}
          onPicklistPermissionError={handlePicklistPermissionError}
        />,
        document.body
      )}
    </div>
  )
}
