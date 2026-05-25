import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  Globe, RefreshCw, Plus, X, ChevronDown, AlertTriangle,
  Clock, CheckCircle2, XCircle, Search, ExternalLink, FileText,
  ArrowUpDown, Save, Trash2, Image as ImageIcon, Filter,
  AlertOctagon, User, Tag, Eye,
  IndianRupee, TrendingUp, Percent, CalendarClock, Receipt,
  Sun, Moon, LogOut, Check, Loader2, Upload, Paperclip,
  ChevronLeft, ChevronRight, Briefcase, Repeat2,
  Users, HelpCircle, Mail, BookOpen, X as XIcon,
  LayoutDashboard, Activity, ArrowRight, ShieldAlert
} from 'lucide-react'
import { api } from '../services/api'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { formatInr } from '../utils/format'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useToast } from '../context/ToastContext'
import { ProjectsWorkspace } from './WebProjects'
import { DocPreviewModal } from '../components/DocPreviewModal'
import { FilterSelect } from '../components/FilterSelect'
import { FilterBuilder, applyConditions } from '../components/FilterBuilder'
import clsx from 'clsx'

/* ── Constants ── */
// All picklist options are loaded live from Teable — no hardcoded fallbacks
const DEFAULT_PICKLISTS = {
  Project:     [],
  Category:    [],
  Milestone:   [],
  'Raised By': [],
}
const STATUSES = ['Paid', 'Pending', 'Cancelled']

const EMPTY_FORM = {
  invoice_number: '', project: '', category: '', description: '',
  milestone: '', raised_by: '', raised_date: '', cleared_date: '',
  amount_raised: '', amount_with_tax: '', amount_received: '',
  payment_status: 'Pending', remark: '', next_followup: '',
  reference: [], invoice_pdf: [],
  currency: 'RS',
}

// Currency helpers
const CURRENCY_SYMBOLS = { RS: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'د.إ' }
function currencySymbol(code) {
  return CURRENCY_SYMBOLS[code] || (code ? `${code} ` : '₹')
}
function fmtCurrency(n, currency) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '—'
  const sym = currencySymbol(currency || 'RS')
  const formatted = Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  return `${sym}${formatted}`
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

/* ── Field definitions for advanced filter builder ────────────────────────── */
const INVOICE_FIELDS = [
  { key: 'Project',          label: 'Project',         type: 'text' },
  { key: 'Category',         label: 'Category',        type: 'text' },
  { key: 'Milestone',        label: 'Milestone',       type: 'text' },
  { key: 'Raised By',        label: 'Raised By',       type: 'text' },
  { key: 'Payment Status',   label: 'Status',          type: 'text' },
  { key: 'Invoice Number',   label: 'Invoice #',       type: 'text' },
  { key: 'Description',      label: 'Description',     type: 'text' },
  { key: 'Remark',           label: 'Remark',          type: 'text' },
  { key: 'Amount Raised',    label: 'Amount Raised',   type: 'number' },
  { key: 'Amount with Tax',  label: 'Amount w/ Tax',   type: 'number' },
  { key: 'Amount Received',  label: 'Amount Received', type: 'number' },
  { key: 'Raised Date',      label: 'Raised Date',     type: 'date' },
  { key: 'Next followup',    label: 'Next Follow-up',  type: 'date' },
  { key: 'Cleared Date',     label: 'Cleared Date',    type: 'date' },
]

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
  { bg: 'var(--kpi-1-bg)', fg: 'var(--kpi-1-fg)' },
  { bg: 'var(--kpi-2-bg)', fg: 'var(--kpi-2-fg)' },
  { bg: 'var(--kpi-3-bg)', fg: 'var(--kpi-3-fg)' },
  { bg: 'var(--kpi-4-bg)', fg: 'var(--kpi-4-fg)' },
  { bg: 'var(--kpi-5-bg)', fg: 'var(--kpi-5-fg)' },
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

function AgingBadge({ days, status }) {
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

function AttachThumb({ a, size = 28, onPreview }) {
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

function AttachCard({ a, onPreview }) {
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

function KpiCard({ label, value, sub, icon: Icon, semantic, tone = 0 }) {
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

function DashboardMetric({ label, value, sub, icon: Icon, tone, accent, compact = false }) {
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
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: 'var(--text-3)' }}>{label}</p>
          <p
            className="mt-2 font-bold tracking-tight leading-none"
            style={{
              color: accent || 'var(--text-1)',
              fontSize: compact ? 'clamp(1.05rem, 1.4vw, 1.45rem)' : 'clamp(1.35rem, 2.2vw, 2.2rem)',
            }}>
            {value}
          </p>
          {sub && <p className="text-[11px] mt-2 leading-relaxed" style={{ color: 'var(--text-2)' }}>{sub}</p>}
        </div>
        {Icon && (
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

function DashboardSignal({ eyebrow, title, body, icon: Icon, tone = 'var(--bg-layer)', accent = 'var(--accent)' }) {
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
function InvoiceDetail({ invoice, onClose, onEdit, onPreview }) {
  if (!invoice) return null
  const f = invoice.fields || {}
  const refs = parseAttachments(f['Reference'])
  const pdfs = parseAttachments(f['Invoice PDF'])
  const allDetailFiles = [...refs, ...pdfs]
  const outstanding = Number(f['Outstanding Amount'] || 0)
  const cur = f['Currency'] || 'RS'

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }} onClick={onClose} aria-hidden="true" />
      <aside className="relative ml-auto flex flex-col h-full animate-slide-in"
        style={{ width: 'min(100vw,500px)', background: 'var(--sidebar-bg)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', borderLeft: '1px solid var(--glass-border)' }}>

        <div className="flex items-start justify-between px-5 py-4 gap-3" style={{ borderBottom: '1px solid var(--glass-border)' }}>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-bold text-sm" style={{ color: 'var(--text-1)', letterSpacing: '-0.01em' }}>{f['Invoice Number'] || '—'}</p>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}>
                {currencySymbol(cur)}{cur}
              </span>
            </div>
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {[
              ['Amount Raised',   f['Amount Raised'],      'var(--text-1)'],
              ['With GST',        f['Amount with Tax'],    'var(--text-1)'],
              ['Received',        f['Amount Received'],    'var(--fin-positive)'],
              ['Outstanding',     f['Outstanding Amount'], outstanding > 0 ? 'var(--fin-warning)' : 'var(--fin-positive)'],
            ].map(([lbl, val, clr]) => (
              <div key={lbl} className="rounded-xl p-3" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                <p className="label mb-1.5">{lbl}</p>
                <p className="font-bold tabular-nums text-base leading-none" style={{ color: clr }}>{fmtCurrency(val, cur)}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
                  <div className="space-y-2">{refs.map((a, i) => <AttachCard key={i} a={a} onPreview={onPreview ? () => onPreview(allDetailFiles, i) : undefined} />)}</div>
                </div>
              )}
              {pdfs.length > 0 && (
                <div>
                  <p className="label mb-2">Invoice PDF{pdfs.length > 1 ? 's' : ''}</p>
                  <div className="space-y-2">{pdfs.map((a, i) => <AttachCard key={i} a={a} onPreview={onPreview ? () => onPreview(allDetailFiles, refs.length + i) : undefined} />)}</div>
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
      currency:        f['Currency']        || 'RS',
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retainerCategoryOption, projectCategoryOption, retainerSelected, invoice?.id, draft?.category])

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

        <div className="h-1 w-full flex-shrink-0 rounded-t-[inherit]"
          style={{ background: 'linear-gradient(90deg, var(--accent), var(--accent-soft))' }} />
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FieldRow label="Invoice Number">
              <input className="input" value={form.invoice_number} onChange={setE('invoice_number')} placeholder="WM/25-26/001" />
            </FieldRow>
            <FieldRow label="Payment Status">
              <SelectInput value={form.payment_status} onChange={set('payment_status')} options={STATUSES} />
            </FieldRow>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FieldRow label="Currency">
              <PicklistSelect
                fieldName="Currency"
                value={form.currency}
                onChange={set('currency')}
                options={picklists?.Currency || ['RS', 'USD']}
                onOptionsUpdate={onOptionsUpdate}
                placeholder="Select currency…"
                canAddOptions={canEditPicklists}
                onPermissionError={onPicklistPermissionError}
              />
            </FieldRow>
            <div />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FieldRow label="Raised Date"><input type="date" className="input" value={form.raised_date} onChange={setE('raised_date')} /></FieldRow>
            <FieldRow label="Cleared Date"><input type="date" className="input" value={form.cleared_date} onChange={setE('cleared_date')} /></FieldRow>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <FieldRow label={`Raised (${currencySymbol(form.currency)})`}><input type="number" className="input" value={form.amount_raised}   onChange={setE('amount_raised')}   placeholder="0" /></FieldRow>
            <FieldRow label={`With GST (${currencySymbol(form.currency)})`}><input type="number" className="input" value={form.amount_with_tax} onChange={setE('amount_with_tax')} placeholder="0" /></FieldRow>
            <FieldRow label={`Received (${currencySymbol(form.currency)})`}><input type="number" className="input" value={form.amount_received} onChange={setE('amount_received')} placeholder="0" /></FieldRow>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FieldRow label="Next Followup"><input type="date" className="input" value={form.next_followup} onChange={setE('next_followup')} /></FieldRow>
          </div>
          <FieldRow label="Remark">
            <textarea className="input resize-none" rows={2} value={form.remark} onChange={setE('remark')} placeholder="Notes…" />
          </FieldRow>

          {paidSelected && (
            <div className="rounded-xl p-3 text-xs flex items-start gap-2"
              style={{ background: '#fef3c7', border: '1px solid #fbbf24', color: '#92400e' }}>
              <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" style={{ color: '#d97706' }} />
              <span>Paid invoices must include <strong>Amount Received</strong> and <strong>Cleared Date</strong>. Attach a payment reference screenshot before closing the entry.</span>
            </div>
          )}

          {retainerSelected && (
            <div className="rounded-xl p-3 text-xs"
              style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)', color: 'var(--text-2)' }}>
              Retainer mode uses the existing table only. Put the retainer/client name in `Project`. The latest retainer row becomes the monthly template, invoice number can be filled later by the account manager, and paused months are stored as zero-value cancelled records with a reason.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
      {[80, 100, 90, 72, 72, 80, 100, 90, 90, 72, 72, 48, 64, 56, 60].map((w, i) => (
        <td key={i} className="tbl-cell"><div className="skeleton h-3 rounded" style={{ width: w }} /></td>
      ))}
    </tr>
  )
}

/* ── Help Modal ── */
const HELP_CONTACT = 'Mayukh@theworks.in'

function HelpModal({ open, onClose }) {
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--card-border)', background: 'var(--sidebar-bg)' }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--accent-btn)' }}>
              <BookOpen size={14} className="text-white" />
            </div>
            <div>
              <p className="font-bold text-base" style={{ color: 'var(--text-1)' }}>App Guide</p>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>How to use TheWorks Web Tracker</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ color: 'var(--text-3)' }}>
            <XIcon size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Overview */}
          <section className="rounded-xl p-4" style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)' }}>
            <h3 className="font-bold text-sm mb-1.5 flex items-center gap-2" style={{ color: 'var(--accent)' }}>
              <Globe size={14} /> TheWorks Web Tracker
            </h3>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
              Your all-in-one billing and project management hub. Start in the new <strong style={{ color: 'var(--text-1)' }}>Dashboard</strong> for a live billing command view, then move into <strong style={{ color: 'var(--text-1)' }}>Invoices</strong>, <strong style={{ color: 'var(--text-1)' }}>Retainers</strong>, and <strong style={{ color: 'var(--text-1)' }}>Projects</strong> (admin only) as needed. Everything stays synced live to Teable.
            </p>
          </section>

          <div className="h-px" style={{ background: 'var(--card-border)' }} />

          {/* Invoices */}
          <section>
            <h3 className="font-bold text-sm mb-3 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
              <FileText size={14} style={{ color: 'var(--accent)' }} /> Invoices
            </h3>
            <div className="space-y-2">
              {[
                ['Raise Externally', 'Opens the Zoho invoice request form for official client-facing invoices. Always raise through Zoho for formal billing.'],
                ['New Invoice', 'Records an invoice directly in the tracker — use this for internal entries, bulk import, or pre-raising before Zoho.'],
                ['Filters & Search', 'Filter by project, month, category, raised by, or billing type (Project vs Retainer). The search bar matches invoice number, project, description, category, and milestone.'],
                ['Status', 'Mark as Pending, Paid, or Cancelled. Invoices unpaid for more than 30 days appear as overdue at the top of the list.'],
                ['Paid Invoice Rule', 'When marking an invoice Paid, Amount Received and Cleared Date are mandatory. Attach a payment screenshot to the Reference field.'],
                ['Attachments', 'Drag & drop or click to attach Invoice PDFs and Payment References. Files upload directly to Teable — no size limit from the app side.'],
                ['Project Snapshot', 'The project cards at the top show raised/collected/outstanding per client. Click any card to filter the list to that project instantly.'],
              ].map(([title, desc]) => (
                <div key={title} className="flex gap-3 text-sm">
                  <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: 'var(--accent)' }} />
                  <p style={{ color: 'var(--text-2)' }}><strong style={{ color: 'var(--text-1)' }}>{title}</strong> — {desc}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="h-px" style={{ background: 'var(--card-border)' }} />

          {/* Retainers */}
          <section>
            <h3 className="font-bold text-sm mb-3 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
              <Repeat2 size={14} style={{ color: 'var(--accent)' }} /> Retainers
            </h3>
            <div className="space-y-2">
              {[
                ['What is a Retainer?', 'A recurring monthly billing arrangement. The Project field holds the client name. All retainer entries use a "Retainer" category type.'],
                ['Record a month', 'Navigate to the target month using the arrow buttons, then click Record Invoice. The form pre-fills from last month\'s entry — update only what changed.'],
                ['Pause a month', 'If billing is skipped, click Pause Month to record a zero-value Cancelled entry. This keeps the retainer history clean and shows a "Paused" pill in the timeline.'],
                ['Invoice number', 'You can leave this blank initially. Once the Zoho invoice is formally raised, the account manager updates the number here.'],
                ['Timeline view', 'Each retainer shows a month-by-month status strip — green (Paid), orange (Pending), grey (Paused), dashed (not yet raised). Click any month cell to jump to that entry.'],
              ].map(([title, desc]) => (
                <div key={title} className="flex gap-3 text-sm">
                  <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: 'var(--accent)' }} />
                  <p style={{ color: 'var(--text-2)' }}><strong style={{ color: 'var(--text-1)' }}>{title}</strong> — {desc}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="h-px" style={{ background: 'var(--card-border)' }} />

          {/* Projects */}
          <section>
            <h3 className="font-bold text-sm mb-3 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
              <Briefcase size={14} style={{ color: 'var(--accent)' }} /> Projects
              <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>Admin only</span>
            </h3>
            <div className="space-y-2">
              {[
                ['Create a project', 'Click + New Project. Fill in name, client, status, priority, timeline, and budget. The profit preview updates live as you type amounts.'],
                ['Project cards', 'Each card shows live status badge, priority, progress bar, client charge, and estimated profit. Click to open the full project detail view.'],
                ['Project detail', 'Full KPI breakdown — total cost, profit, margin %, man hours vs planned, and revenue. Also shows all resources assigned and linked invoices.'],
                ['Linked Invoices', 'Invoices whose Project field exactly matches the project name are automatically listed with totals. Project name spelling must match precisely.'],
                ['Progress %', 'Use the slider in the edit form to update completion. This syncs directly to Teable and reflects on the project card.'],
              ].map(([title, desc]) => (
                <div key={title} className="flex gap-3 text-sm">
                  <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: 'var(--accent)' }} />
                  <p style={{ color: 'var(--text-2)' }}><strong style={{ color: 'var(--text-1)' }}>{title}</strong> — {desc}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="h-px" style={{ background: 'var(--card-border)' }} />

          {/* Resources */}
          <section>
            <h3 className="font-bold text-sm mb-3 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
              <Users size={14} style={{ color: 'var(--accent)' }} /> Resources
              <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>Admin only</span>
            </h3>
            <div className="space-y-2">
              {[
                ['What is a Resource?', 'Any person, tool, or vendor working on a project — Employee, Freelancer, Contractor, Tool/Software, or Cloud Infra.'],
                ['Add to a project', 'Open a project → click Add Resource or assign an existing one via the Assign Resources button. A resource can belong to multiple projects.'],
                ['Rate & cost', 'Set rate (₹), rate unit (Per Hour / Per Day / Per Month / Fixed), and units. Total cost is computed automatically in Teable.'],
                ['Man Hours', 'Log actual vs. planned hours. Teable computes the variance — red means over budget, green means under.'],
                ['Revenue tracking', 'Set a billing rate and billable units to track what you charge vs. what the resource costs. Gross margin is calculated automatically.'],
              ].map(([title, desc]) => (
                <div key={title} className="flex gap-3 text-sm">
                  <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: 'var(--accent)' }} />
                  <p style={{ color: 'var(--text-2)' }}><strong style={{ color: 'var(--text-1)' }}>{title}</strong> — {desc}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="h-px" style={{ background: 'var(--card-border)' }} />

          {/* Tips */}
          <section>
            <h3 className="font-bold text-sm mb-3 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
              💡 Quick Tips
            </h3>
            <div className="grid grid-cols-1 gap-2">
              {[
                ['Auto-sync', 'Invoice data refreshes every 10 seconds automatically — no manual refresh needed.'],
                ['Exact project names', 'Invoice ↔ Project linking is case-sensitive. "Riese Moto" ≠ "riese moto".'],
                ['Overdue alert', 'Pending invoices older than 30 days appear highlighted in red at the top.'],
                ['Follow-up filter', 'Use "Follow-up due" filter to surface invoices whose Next Followup date is today or past.'],
                ['Dropdown options', 'All dropdowns (Project, Category, Milestone, Raised By) pull live from Teable. Use the + button to add new options without leaving the form.'],
              ].map(([title, desc]) => (
                <div key={title} className="flex gap-2.5 items-start p-2.5 rounded-lg text-xs" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                  <Check size={11} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--fin-positive)' }} />
                  <p style={{ color: 'var(--text-2)' }}><strong style={{ color: 'var(--text-1)' }}>{title}:</strong> {desc}</p>
                </div>
              ))}
            </div>
          </section>

        </div>

        {/* Footer — contact */}
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderTop: '1px solid var(--card-border)', background: 'var(--sidebar-bg)' }}>
          <div>
            <p className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>Question or found a bug?</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>We'll get back to you within a day.</p>
          </div>
          <a href={`mailto:${HELP_CONTACT}`}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--accent-btn)', color: '#fff', textDecoration: 'none', boxShadow: '0 4px 12px rgba(37,99,235,0.25)' }}>
            <Mail size={14} /> Contact us
          </a>
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ── Mobile-only top header bar ── */
function MobileHeader({ onHelp, onLogout }) {
  const { dark, toggle } = useTheme()
  return (
    <div className="sm:hidden flex-shrink-0 flex items-center justify-between px-3"
      style={{
        height: 'calc(48px + env(safe-area-inset-top))',
        paddingTop: 'env(safe-area-inset-top)',
        background: 'var(--sidebar-bg)',
        borderBottom: '1px solid var(--sidebar-border)',
        zIndex: 10,
      }}>
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--accent-btn)', boxShadow: '0 2px 8px rgba(37,99,235,0.3)' }}>
          <Globe size={12} className="text-white" />
        </div>
        <div>
          <p className="font-bold text-sm leading-tight tracking-tight" style={{ color: 'var(--text-1)' }}>TheWorks</p>
          <p className="text-[9px] leading-none" style={{ color: 'var(--text-3)' }}>Web Tracker</p>
        </div>
      </div>
      <div className="flex items-center gap-0.5">
        <button onClick={onHelp} title="Help & Guide"
          className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors"
          style={{ color: 'var(--text-3)' }}>
          <HelpCircle size={16} />
        </button>
        <button onClick={toggle} title={dark ? 'Light mode' : 'Dark mode'}
          className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors"
          style={{ color: 'var(--text-3)' }}>
          {dark
            ? <Sun size={16} style={{ color: '#facc15' }} />
            : <Moon size={16} style={{ color: '#818cf8' }} />}
        </button>
        <button onClick={onLogout} title="Sign out"
          className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors"
          style={{ color: 'var(--text-3)' }}>
          <LogOut size={15} />
        </button>
      </div>
    </div>
  )
}

/* ── Mobile-only bottom navigation bar ── */
function MobileBottomNav({ workspace, setWorkspace, isAll }) {
  const navItems = [
    { value: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { value: 'invoices',  label: 'Invoices',  icon: FileText },
    { value: 'retainers', label: 'Retainers', icon: Repeat2 },
    ...(isAll ? [{ value: 'projects', label: 'Projects', icon: Briefcase }] : []),
  ]
  return (
    <nav className="sm:hidden flex-shrink-0 flex items-stretch border-t"
      style={{
        background: 'var(--sidebar-bg)',
        borderColor: 'var(--sidebar-border)',
        /* Push content above iPhone home indicator */
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
      {navItems.map(({ value, label, icon: Icon }) => {
        const active = workspace === value
        return (
          <button key={value} onClick={() => setWorkspace(value)}
            className="relative flex flex-col items-center justify-center gap-1 flex-1 py-2 transition-colors"
            style={{ color: active ? 'var(--accent)' : 'var(--text-3)', minHeight: 52 }}>
            {active && (
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full"
                style={{ background: 'var(--accent)' }} />
            )}
            <Icon size={18} style={{ color: active ? 'var(--accent)' : 'var(--text-3)' }} />
            <span className="text-[10px] font-medium leading-none">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}

/* ── Collapsible app sidebar ── */
function AppSidebar({ workspace, setWorkspace, isAll, open, onToggle, onHelp }) {
  const { logout } = useAuth()
  const { dark, toggle } = useTheme()

  const navItems = [
    { value: 'dashboard',  label: 'Dashboard',  icon: LayoutDashboard },
    { value: 'invoices',   label: 'Invoices',   icon: FileText },
    { value: 'retainers',  label: 'Retainers',  icon: Repeat2 },
    ...(isAll ? [
      { value: 'projects',  label: 'Projects',  icon: Briefcase },
    ] : []),
  ]

  return (
    <aside
      className="hidden sm:flex flex-col flex-shrink-0 transition-all duration-200 z-20"
      style={{
        width: open ? 220 : 56,
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--sidebar-border)',
        height: '100dvh',
        overflow: 'hidden',
      }}>

      {/* Brand + toggle */}
      <div className="flex items-center justify-between pl-3 pr-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--sidebar-border)', minHeight: 52 }}>
        <div className="flex items-center gap-2.5 min-w-0 overflow-hidden">
          <div className="flex items-center justify-center flex-shrink-0"
            style={{ width: 28, height: 28, borderRadius: 7, background: 'linear-gradient(135deg, #2f72f5 0%, #1d4ed8 100%)', boxShadow: '0 2px 6px rgba(37,99,235,0.35)' }}>
            <Globe size={12} className="text-white" />
          </div>
          {open && (
            <div className="min-w-0">
              <p className="font-bold text-sm leading-tight tracking-tight truncate" style={{ color: 'var(--text-1)' }}>TheWorks</p>
              <p className="text-[10px] leading-none truncate" style={{ color: 'var(--text-3)' }}>Web Tracker</p>
            </div>
          )}
        </div>
        <button onClick={onToggle} title={open ? 'Collapse' : 'Expand'}
          className="w-7 h-7 flex items-center justify-center rounded-md flex-shrink-0 transition-colors"
          style={{ color: 'var(--text-3)' }}>
          {open ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-2 space-y-0.5 px-2 overflow-y-auto">
        {navItems.map(({ value, label, icon: Icon }) => {
          const active = workspace === value
          return (
            <button key={value} onClick={() => setWorkspace(value)}
              title={!open ? label : undefined}
              className={`nav-item ${active ? 'active' : ''}`}>
              <Icon size={15} className="flex-shrink-0" style={{ flexShrink: 0 }} />
              {open && <span className="truncate">{label}</span>}
            </button>
          )
        })}
      </nav>

      {/* Footer: help + theme + logout */}
      <div className="px-2 pb-3 flex-shrink-0 space-y-0.5"
        style={{ borderTop: '1px solid var(--sidebar-border)', paddingTop: '0.5rem' }}>
        {onHelp && (
          <button onClick={onHelp} title="Help & Guide" className="nav-item">
            <HelpCircle size={14} style={{ flexShrink: 0 }} />
            {open && <span className="text-xs">Help & Guide</span>}
          </button>
        )}
        <button onClick={toggle} title={dark ? 'Light mode' : 'Dark mode'} className="nav-item">
          {dark
            ? <Sun size={14} style={{ color: '#fbbf24', flexShrink: 0 }} />
            : <Moon size={14} style={{ color: '#818cf8', flexShrink: 0 }} />}
          {open && <span className="text-xs">{dark ? 'Light mode' : 'Dark mode'}</span>}
        </button>
        <button onClick={logout} title="Sign out" className="nav-item">
          <LogOut size={13} style={{ flexShrink: 0 }} />
          {open && <span className="text-xs">Sign out</span>}
        </button>
      </div>
    </aside>
  )
}

/* ── Main page ── */
export default function WebInvoices() {
  const toast = useToast()
  const { isAll, logout } = useAuth()
  const { dark } = useTheme()
  const [sidebarOpen,    setSidebarOpen]    = useState(true)
  const [helpOpen,       setHelpOpen]       = useState(false)
  const [workspace,      setWorkspace]      = useState('dashboard')
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
  const [filterConditions, setFilterConditions] = useState([])
  const [sortCol,        setSortCol]        = useState('Raised Date')
  const [sortDir,        setSortDir]        = useState('desc')
  const [drawer,         setDrawer]         = useState(null)
  const [picklists,      setPicklists]      = useState(DEFAULT_PICKLISTS)
  const [canEditPicklists, setCanEditPicklists] = useState(true)
  const [picklistPermissionMsg, setPicklistPermissionMsg] = useState('')
  const [retainerActionBusy, setRetainerActionBusy] = useState('')
  const [previewDocs, setPreviewDocs] = useState(null)

  useEffect(() => {
    // 1. Load Category / Milestone / Raised By options from Teable field schema
    api.webInvoices.picklists.get()
      .then(data => {
        setPicklists(prev => ({
          ...prev,
          ...Object.fromEntries(
            Object.entries(data)
              .filter(([k]) => k !== 'Project')   // Project comes from real records, not schema
              .map(([k, v]) => [k, v.options])
          ),
        }))
      })
      .catch(() => {})

    // 2. Build Project list from three live sources, deduplicated and sorted
    Promise.allSettled([
      api.webInvoices.clientNames(),   // distinct Project values from actual invoice records
      api.webProjects.names(),          // project names from Web Projects table
    ]).then(([invoiceRes, projectRes]) => {
      const fromInvoices = invoiceRes.status === 'fulfilled' && Array.isArray(invoiceRes.value)
        ? invoiceRes.value
        : []
      const fromProjects = projectRes.status === 'fulfilled' && Array.isArray(projectRes.value)
        ? projectRes.value.map(p => p.name).filter(Boolean)
        : []
      const merged = [...new Set([...fromInvoices, ...fromProjects])].sort()
      if (merged.length > 0) {
        setPicklists(prev => ({ ...prev, Project: merged }))
      }
    })
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
      // overdueOnly is purely a client-side filter — never pass status='Pending'
      // server-side or it silently drops invoices with Outstanding > 0 but non-Pending status.
      status:   statusFilter || undefined,
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

  // Compute effective aging — prefer Teable's computed field, fallback to days since Raised Date
  function effectiveAging(f) {
    const teableVal = f['Agening (Days)']
    if (teableVal != null && teableVal !== '') return Number(teableVal)
    const raised = parseIsoDate(f['Raised Date'])
    if (!raised) return 0
    return Math.floor((Date.now() - raised.getTime()) / 86_400_000)
  }

  const baseRecords = allRecords.filter(r => {
    const f = r.fields || {}
    const retainer = isRetainerCategory(f['Category'])
    if (billingFilter === 'retainer' && !retainer) return false
    if (billingFilter === 'project' && retainer) return false
    if (categoryFilter && f['Category'] !== categoryFilter) return false
    if (raisedByFilter && f['Raised By'] !== raisedByFilter) return false
    if (monthFilter && monthKey(f['Raised Date']) !== monthFilter) return false
    // "Overdue only" = Pending status OR has an outstanding balance
    if (overdueOnly && !(f['Payment Status'] === 'Pending' || Number(f['Outstanding Amount'] || 0) > 0)) return false
    if (followupDueOnly) {
      // Show any invoice that has a Next followup date set — past, today, or future.
      // We intentionally don't exclude future dates: seeing upcoming follow-ups lets
      // you prepare. Users can sort by "Next Followup" column to see what's soonest.
      const raw = f['Next followup']
      if (!raw) return false
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
  const records = applyConditions(baseRecords, filterConditions, r => r.fields ?? {})

  const s        = summary
  const overdue  = s?.overdue_invoices || []
  const activeConditions = filterConditions.filter(c => c.field && c.op && (c.value !== '' || ['is_empty','is_not_empty'].includes(c.op)))
  const hasFilters = statusFilter || projectFilter || categoryFilter || raisedByFilter || billingFilter !== 'all' || monthFilter || overdueOnly || hasDocsOnly || followupDueOnly || search || activeConditions.length > 0
  const projectSummaryCards = useMemo(() => {
    const entries = Object.entries(s?.by_project || {})
      // Sort by total invoice count (universal — not RS-only raised)
      .sort(([, a], [, b]) => (b?.count || 0) - (a?.count || 0))
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
      // Build recordByMonth preferring active (non-cancelled) records when a month
      // has multiple invoices (e.g. original cancelled + re-raised paid replacement).
      const recordByMonth = {}
      for (const r of sorted) {
        const key = monthKey(r.fields?.['Raised Date'])
        if (!key) continue
        const existing = recordByMonth[key]
        const thisCancelled = r.fields?.['Payment Status'] === 'Cancelled'
        if (!existing || (existing.fields?.['Payment Status'] === 'Cancelled' && !thisCancelled)) {
          recordByMonth[key] = r
        }
      }
      // For the selected month, prefer the active record over a cancelled one
      const monthRecord =
        sorted.find(r => monthKey(r.fields?.['Raised Date']) === retainerMonth && r.fields?.['Payment Status'] !== 'Cancelled') ||
        sorted.find(r => monthKey(r.fields?.['Raised Date']) === retainerMonth)
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
  const dashboardStyles = useMemo(() => (
    dark
      ? {
          shell: 'linear-gradient(135deg, rgba(15,23,42,0.98) 0%, rgba(17,24,39,0.96) 58%, rgba(20,38,33,0.92) 100%)',
          panel: 'rgba(15,23,42,0.76)',
          panelSoft: 'rgba(30,41,59,0.68)',
          accentPanel: 'rgba(15,118,110,0.16)',
          warnPanel: 'rgba(120,53,15,0.18)',
          line: 'rgba(148,163,184,0.16)',
          glow: '0 30px 60px rgba(2,6,23,0.34)',
        }
      : {
          shell: 'linear-gradient(135deg, rgba(238,244,255,0.96) 0%, rgba(255,255,255,0.98) 52%, rgba(237,248,241,0.98) 100%)',
          panel: 'rgba(255,255,255,0.92)',
          panelSoft: 'rgba(248,250,252,0.92)',
          accentPanel: 'rgba(16,185,129,0.08)',
          warnPanel: 'rgba(245,158,11,0.10)',
          line: 'rgba(148,163,184,0.18)',
          glow: '0 28px 60px rgba(15,23,42,0.08)',
        }
  ), [dark])

  const visibleClientCount = useMemo(() => (
    new Set(records.map(r => String(r.fields?.['Project'] || '').trim()).filter(Boolean)).size
  ), [records])

  const upcomingFollowups = useMemo(() => (
    [...records]
      .filter(r => r.fields?.['Next followup'])
      .sort((a, b) => {
        const da = parseIsoDate(a.fields?.['Next followup'])?.getTime() || 0
        const db = parseIsoDate(b.fields?.['Next followup'])?.getTime() || 0
        return da - db
      })
      .slice(0, 5)
  ), [records])

  const latestInvoices = useMemo(() => sortByRaisedDateDesc(records).slice(0, 6), [records])
  const topOutstandingProject = useMemo(() => {
    return projectSummaryCards
      .slice()
      .sort((a, b) => {
        const aOut = Object.values(a.metrics?.by_currency || {}).reduce((sum, cur) => sum + Number(cur?.outstanding || 0), 0)
        const bOut = Object.values(b.metrics?.by_currency || {}).reduce((sum, cur) => sum + Number(cur?.outstanding || 0), 0)
        return bOut - aOut
      })[0] || null
  }, [projectSummaryCards])

  const dashboardStatusRows = useMemo(() => {
    const byStatus = s?.by_status || {}
    const total = Object.values(byStatus).reduce((sum, count) => sum + Number(count || 0), 0) || 1
    return Object.entries(byStatus)
      .map(([status, count]) => {
        const meta = STATUS_META[status] || {}
        return {
          status,
          count,
          pct: Math.round((Number(count || 0) / total) * 100),
          color: meta.color || 'var(--accent)',
        }
      })
      .sort((a, b) => Number(b.count) - Number(a.count))
  }, [s])

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
    const asc    = sortDir === 'asc'
    return (
      <button onClick={() => handleSort(col)}
        className="inline-flex items-center gap-1 cursor-pointer select-none section-title whitespace-nowrap group/sort"
        title={active ? (asc ? 'Sorted ascending — click for descending' : 'Sorted descending — click for ascending') : `Sort by ${col}`}
        style={{ color: active ? 'var(--accent)' : 'var(--text-3)', background: 'none', border: 'none', padding: 0 }}>
        {children}
        <ArrowUpDown size={10} style={{
          opacity: active ? 1 : 0.3,
          color: active ? 'var(--accent)' : undefined,
          transform: active && asc ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.15s',
        }} className="group-hover/sort:opacity-80" />
      </button>
    )
  }

  return (
    <div className="app-shell flex overflow-hidden" style={{ background: 'var(--bg-base)' }}>
      {/* ── Sidebar — desktop only ── */}
      <AppSidebar
        workspace={workspace}
        setWorkspace={setWorkspace}
        isAll={isAll}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen(v => !v)}
        onHelp={() => setHelpOpen(true)}
      />

      {/* ── Content area ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
      {/* Mobile top header — hidden sm+ */}
      <MobileHeader onHelp={() => setHelpOpen(true)} onLogout={logout} />
      <main className="flex-1 overflow-y-auto">
        <div className="p-3 sm:p-4 md:p-6 space-y-4 sm:space-y-5 animate-fade-in">

          {/* ── Invoices header ── */}
          {workspace === 'dashboard' && (
          <section
            className="rounded-[28px] p-4 sm:p-5 lg:p-6 space-y-4 sm:space-y-5"
            style={{
              background: dashboardStyles.shell,
              border: `1px solid ${dashboardStyles.line}`,
              boxShadow: dashboardStyles.glow,
            }}>
            <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1.15fr)_auto] gap-4 items-start">
              <div className="min-w-0">
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className="flex items-center justify-center rounded-[22px] flex-shrink-0"
                    style={{
                      width: 52,
                      height: 52,
                      background: dark ? 'rgba(79,70,229,0.16)' : 'rgba(99,102,241,0.12)',
                      border: `1px solid ${dashboardStyles.line}`,
                    }}>
                    <LayoutDashboard size={22} style={{ color: 'var(--accent)' }} />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em]" style={{ color: dark ? 'rgba(191,219,254,0.78)' : 'var(--accent)' }}>
                      Billing Command Deck
                    </p>
                    <h1 className="text-2xl lg:text-[2.6rem] font-bold tracking-tight mt-1" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>
                      Web Invoice Dashboard
                    </h1>
                  </div>
                </div>
                <p className="max-w-2xl text-sm sm:text-base leading-relaxed" style={{ color: dark ? 'rgba(226,232,240,0.82)' : 'var(--text-2)' }}>
                  Track cash movement, retainer coverage, overdue pressure, and project billing signals from one place.
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
                <button onClick={() => setWorkspace('invoices')} className="btn-ghost justify-center">
                  <FileText size={14} />Open invoices
                </button>
                <button onClick={() => setWorkspace('retainers')} className="btn-ghost justify-center">
                  <Repeat2 size={14} />Retainers
                </button>
                {isAll && (
                  <button onClick={() => setWorkspace('projects')} className="btn-ghost justify-center">
                    <Briefcase size={14} />Projects
                  </button>
                )}
                <button onClick={refresh} disabled={loading} className="btn-ghost justify-center">
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Refresh
                </button>
                <button onClick={() => window.open(INVOICE_REQUEST_FORM_URL, '_blank', 'noopener,noreferrer')} className="btn-primary justify-center">
                  <ExternalLink size={14} />Raise externally
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.95fr)] gap-4">
              <div
                className="rounded-[26px] p-4 sm:p-5"
                style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-3">
                  <DashboardMetric
                    label="Total raised"
                    value={sumLoading && !s ? '—' : fmt(s?.total_raised)}
                    sub={`${allRecords.length} invoices across all workspaces`}
                    icon={IndianRupee}
                    tone={dark ? 'rgba(30,41,59,0.68)' : 'rgba(255,255,255,0.92)'}
                    accent={dark ? '#f8fafc' : 'var(--text-1)'}
                  />
                  <DashboardMetric
                    label="Collected"
                    value={sumLoading && !s ? '—' : fmt(s?.total_received)}
                    sub={`${(s?.collection_rate ?? 0).toFixed(1)}% collection rate`}
                    icon={TrendingUp}
                    tone={dashboardStyles.accentPanel}
                    accent="var(--fin-positive)"
                    compact
                  />
                  <DashboardMetric
                    label="Outstanding"
                    value={sumLoading && !s ? '—' : fmt(s?.total_outstanding)}
                    sub={`${overdue.length} invoice${overdue.length === 1 ? '' : 's'} beyond 30 days`}
                    icon={AlertOctagon}
                    tone={dashboardStyles.warnPanel}
                    accent={Number(s?.total_outstanding || 0) > 0 ? 'var(--fin-warning)' : 'var(--fin-positive)'}
                    compact
                  />
                  <DashboardMetric
                    label="Retainer coverage"
                    value={`${retainerGroups.length}`}
                    sub={`${selectedRetainerGroup?.currentMonthRaised ? 'Current month covered' : 'Review current month gaps'}`}
                    icon={Repeat2}
                    tone={dark ? 'rgba(15,23,42,0.55)' : 'rgba(247,250,255,0.94)'}
                    accent={dark ? '#c4b5fd' : '#4f46e5'}
                    compact
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3">
                <DashboardSignal
                  eyebrow="Main signal"
                  title={topOutstandingProject ? topOutstandingProject.project : 'No project pressure'}
                  body={topOutstandingProject
                    ? `${fmt(Object.values(topOutstandingProject.metrics?.by_currency || {}).reduce((sum, cur) => sum + Number(cur?.outstanding || 0), 0))} currently open across ${topOutstandingProject.metrics?.count || 0} invoices.`
                    : 'No outstanding balance is currently visible in the filtered portfolio.'}
                  icon={Activity}
                  tone={dashboardStyles.accentPanel}
                  accent="var(--fin-positive)"
                />
                <DashboardSignal
                  eyebrow="Visible scope"
                  title={`${records.length} live invoices · ${visibleClientCount} projects`}
                  body={hasFilters ? 'Dashboard is currently respecting active invoice filters.' : 'No extra filters applied. This is your full live billing picture.'}
                  icon={Users}
                  tone={dashboardStyles.panelSoft}
                  accent="var(--accent)"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.95fr)] gap-4">
              <div
                className="rounded-[26px] p-4 sm:p-5"
                style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-3)' }}>Status distribution</p>
                    <h2 className="text-lg font-bold mt-1" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>Collection pulse</h2>
                  </div>
                  <button onClick={() => setWorkspace('invoices')} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.45rem 0.8rem' }}>
                    Open invoice table <ArrowRight size={12} />
                  </button>
                </div>
                <div className="space-y-3">
                  {dashboardStatusRows.map(row => (
                    <div key={row.status} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: row.color }} />
                          <span className="text-sm font-semibold truncate" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>{row.status}</span>
                        </div>
                        <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-3)' }}>
                          {row.count} · {row.pct}%
                        </span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: dark ? 'rgba(51,65,85,0.85)' : 'rgba(226,232,240,0.85)' }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${row.pct}%`, background: row.color }} />
                      </div>
                    </div>
                  ))}
                </div>

                {projectSummaryCards.length > 0 && (
                  <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${dashboardStyles.line}` }}>
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: 'var(--text-3)' }}>Project pulse</p>
                        <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>Highest invoice-bearing projects in the current scope.</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {projectSummaryCards.slice(0, 4).map(({ project, metrics }) => (
                        <button
                          key={project}
                          type="button"
                          onClick={() => { setProjectFilter(project); setWorkspace('invoices') }}
                          className="rounded-2xl p-4 text-left transition-all"
                          style={{
                            background: dark ? 'rgba(15,23,42,0.52)' : 'rgba(255,255,255,0.85)',
                            border: `1px solid ${dashboardStyles.line}`,
                          }}>
                          <p className="text-sm font-semibold truncate" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>{project}</p>
                          <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{metrics?.count || 0} invoices · click to filter</p>
                          <div className="grid grid-cols-3 gap-2 mt-3">
                            <div>
                              <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Raised</p>
                              <p className="text-xs font-semibold tabular-nums mt-1" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>
                                {fmt(Object.values(metrics?.by_currency || {}).reduce((sum, cur) => sum + Number(cur?.raised || 0), 0))}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Collected</p>
                              <p className="text-xs font-semibold tabular-nums mt-1" style={{ color: 'var(--fin-positive)' }}>
                                {fmt(Object.values(metrics?.by_currency || {}).reduce((sum, cur) => sum + Number(cur?.received || 0), 0))}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Open</p>
                              <p className="text-xs font-semibold tabular-nums mt-1" style={{ color: 'var(--fin-warning)' }}>
                                {fmt(Object.values(metrics?.by_currency || {}).reduce((sum, cur) => sum + Number(cur?.outstanding || 0), 0))}
                              </p>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div
                  className="rounded-[26px] p-4 sm:p-5"
                  style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-3)' }}>Attention queue</p>
                      <h2 className="text-lg font-bold mt-1" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>Upcoming follow-ups</h2>
                    </div>
                    <ShieldAlert size={18} style={{ color: 'var(--fin-warning)' }} />
                  </div>
                  <div className="space-y-2">
                    {upcomingFollowups.length === 0
                      ? <p className="text-sm" style={{ color: 'var(--text-3)' }}>No follow-up dates are set in the current scope.</p>
                      : upcomingFollowups.map(record => {
                          const f = record.fields || {}
                          return (
                            <button
                              key={record.id}
                              type="button"
                              onClick={() => { setWorkspace('invoices'); openView(record) }}
                              className="w-full text-left rounded-2xl p-3 transition-all"
                              style={{
                                background: dark ? 'rgba(15,23,42,0.52)' : 'rgba(255,255,255,0.86)',
                                border: `1px solid ${dashboardStyles.line}`,
                              }}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold truncate" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>
                                    {f['Project'] || 'Unnamed project'}
                                  </p>
                                  <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-3)' }}>
                                    {f['Invoice Number'] || 'Invoice number pending'} · {f['Raised By'] || 'Unassigned'}
                                  </p>
                                </div>
                                <span className="text-[11px] font-semibold tabular-nums flex-shrink-0" style={{ color: 'var(--fin-warning)' }}>
                                  {fmtDate(f['Next followup'])}
                                </span>
                              </div>
                            </button>
                          )
                        })}
                  </div>
                </div>

                <div
                  className="rounded-[26px] p-4 sm:p-5"
                  style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-3)' }}>Retainer desk</p>
                      <h2 className="text-lg font-bold mt-1" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>Coverage snapshot</h2>
                    </div>
                    <button onClick={() => setWorkspace('retainers')} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem' }}>
                      Open retainers
                    </button>
                  </div>
                  <div className="space-y-2">
                    {retainerGroups.slice(0, 4).map(group => (
                      <button
                        key={group.project}
                        type="button"
                        onClick={() => { setSelectedRetainer(group.project); setWorkspace('retainers') }}
                        className="w-full rounded-2xl p-3 text-left"
                        style={{
                          background: dark ? 'rgba(15,23,42,0.52)' : 'rgba(255,255,255,0.86)',
                          border: `1px solid ${dashboardStyles.line}`,
                        }}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>{group.project}</p>
                            <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-3)' }}>
                              {fmt(group.amount)} · next due {monthLabel(group.nextDueMonth)}
                            </p>
                          </div>
                          <MonthStatusPill status={group.monthStatus} />
                        </div>
                      </button>
                    ))}
                    {retainerGroups.length === 0 && (
                      <p className="text-sm" style={{ color: 'var(--text-3)' }}>No retainer templates available yet.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.95fr)] gap-4">
              <div
                className="rounded-[26px] p-4 sm:p-5"
                style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-3)' }}>Latest movement</p>
                    <h2 className="text-lg font-bold mt-1" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>Newest invoices</h2>
                  </div>
                  <button onClick={() => setWorkspace('invoices')} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem' }}>
                    Open all
                  </button>
                </div>
                <div className="space-y-2">
                  {latestInvoices.map(record => {
                    const f = record.fields || {}
                    const cur = f['Currency'] || 'RS'
                    return (
                      <button
                        key={record.id}
                        type="button"
                        onClick={() => { setWorkspace('invoices'); openView(record) }}
                        className="w-full rounded-2xl p-3 text-left transition-all"
                        style={{
                          background: dark ? 'rgba(15,23,42,0.52)' : 'rgba(255,255,255,0.86)',
                          border: `1px solid ${dashboardStyles.line}`,
                        }}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>
                              {f['Project'] || 'Unnamed project'}
                            </p>
                            <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-3)' }}>
                              {f['Invoice Number'] || 'Invoice number pending'} · {f['Category'] || 'Uncategorised'}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm font-semibold tabular-nums" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>{fmtCurrency(f['Amount Raised'], cur)}</p>
                            <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>{fmtDate(f['Raised Date'])}</p>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                  {latestInvoices.length === 0 && (
                    <p className="text-sm" style={{ color: 'var(--text-3)' }}>No invoices available yet.</p>
                  )}
                </div>
              </div>

              <div
                className="rounded-[26px] p-4 sm:p-5"
                style={{ background: dashboardStyles.panel, border: `1px solid ${dashboardStyles.line}` }}>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-3)' }}>Operating notes</p>
                    <h2 className="text-lg font-bold mt-1" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>How to use this desk</h2>
                  </div>
                  <BookOpen size={18} style={{ color: 'var(--accent)' }} />
                </div>
                <div className="space-y-3">
                  {[
                    ['Invoices', 'Track pending, overdue, and fully collected billing records with live filters and file previews.'],
                    ['Retainers', 'Raise externally in Zoho, then record the final invoice details internally for month-by-month continuity.'],
                    ['Projects', isAll ? 'Open the admin project workspace for linked project health, cashflow, and invoice association.' : 'Project workspace is only available to admin access.'],
                  ].map(([title, body]) => (
                    <div
                      key={title}
                      className="rounded-2xl p-3"
                      style={{
                        background: dark ? 'rgba(15,23,42,0.52)' : 'rgba(255,255,255,0.86)',
                        border: `1px solid ${dashboardStyles.line}`,
                      }}>
                      <p className="text-sm font-semibold" style={{ color: dark ? '#f8fafc' : 'var(--text-1)' }}>{title}</p>
                      <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'var(--text-2)' }}>{body}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
          )}

          {workspace === 'invoices' && (
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
          )}

          {/* ── Retainers header ── */}
          {workspace === 'retainers' && (
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.025em' }}>Retainers</h1>
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                Monthly retainer invoices — use the Zoho form to raise externally.
              </p>
            </div>
            <button onClick={() => window.open(INVOICE_REQUEST_FORM_URL, '_blank', 'noopener,noreferrer')} className="btn-ghost">
              <ExternalLink size={14} /><span className="hidden sm:inline">Raise Externally</span>
            </button>
          </div>
          )}

          {/* ── (Projects workspace has its own header inside ProjectsWorkspace) ── */}


          {/* Invoice KPIs, status chips, overdue — only on invoices / retainers tabs */}
          {(workspace === 'invoices' || workspace === 'retainers') && (
            <>
              {/* ── RS Primary KPIs ── */}
              <section aria-label="Invoice metrics (₹)" className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
                <KpiCard tone={0} label="Total Raised (₹)"   value={sumLoading && !s ? null : fmt(s?.total_raised)}    icon={IndianRupee} />
                <KpiCard tone={1} label="Incl. GST (₹)"      value={sumLoading && !s ? null : fmt(s?.total_with_tax)}  icon={Receipt} />
                <KpiCard tone={2} label="Collected (₹)"      value={sumLoading && !s ? null : fmt(s?.total_received)}  icon={TrendingUp} semantic="positive" />
                <KpiCard tone={3} label="Outstanding (₹)"
                  value={sumLoading && !s ? null : fmt(s?.total_outstanding)}
                  icon={CalendarClock}
                  semantic={(s?.total_outstanding || 0) > 0 ? 'warning' : 'positive'}
                  sub={(s?.total_outstanding || 0) > 0 ? `${s?.by_currency?.RS?.pending_count || s?.by_status?.Pending || 0} pending` : 'Fully collected'} />
                <KpiCard tone={4} label="Collection Rate (₹)"
                  value={sumLoading && !s ? null : s ? `${(s.collection_rate ?? 0).toFixed(1)}%` : '—'}
                  icon={Percent}
                  semantic={(s?.collection_rate || 0) >= 90 ? 'positive' : (s?.collection_rate || 0) >= 70 ? 'warning' : 'negative'} />
              </section>

              {/* ── Foreign Currency KPI rows (auto-appear when non-RS invoices exist) ── */}
              {s?.by_currency && Object.entries(s.by_currency)
                .filter(([cur]) => cur !== 'RS')
                .map(([cur, data]) => (
                  <section key={cur} aria-label={`Invoice metrics (${cur})`}
                    className="rounded-2xl p-3 grid grid-cols-2 sm:grid-cols-4 gap-3"
                    style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)' }}>
                    <div className="col-span-full flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold px-2 py-0.5 rounded-md" style={{ background: 'var(--accent-btn)', color: '#fff' }}>{cur}</span>
                      <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>{cur} Invoices — {data.count} total</span>
                    </div>
                    {[
                      { label: 'Raised',      val: data.raised,      tone: 0 },
                      { label: 'Incl. Tax',   val: data.with_tax,    tone: 1 },
                      { label: 'Collected',   val: data.received,    tone: 2, semantic: 'positive' },
                      { label: 'Outstanding', val: data.outstanding, tone: 3, semantic: data.outstanding > 0 ? 'warning' : 'positive',
                        sub: data.pending_count > 0 ? `${data.pending_count} pending` : 'Fully collected' },
                    ].map(({ label, val, tone, semantic, sub }) => (
                      <KpiCard key={label} tone={tone} label={`${label} (${currencySymbol(cur)})`}
                        value={fmtCurrency(val, cur)} semantic={semantic} sub={sub} />
                    ))}
                  </section>
                ))}

              {/* ── Status chips ── */}
              {s?.by_status && Object.keys(s.by_status).length > 0 && (
                <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {Object.entries(s.by_status).map(([status, count]) => {
                    const m = STATUS_META[status] || { color: 'var(--text-2)', bg: 'var(--fin-pos-bg)', border: 'var(--fin-pos-border)', icon: CheckCircle2 }
                    const Icon = m.icon
                    const active = statusFilter === status
                    // Show RS amount for this status from by_currency
                    const rsAmt = (() => {
                      if (!s?.by_currency?.RS) return null
                      if (status === 'Paid') return s.by_currency.RS.received
                      if (status === 'Pending') return s.by_currency.RS.outstanding
                      return null
                    })()
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
                          {rsAmt != null && (
                            <p className="text-[11px] tabular-nums mt-1 font-medium" style={{ color: 'var(--text-2)' }}>{fmt(rsAmt)}</p>
                          )}
                        </div>
                        {active && <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: m.color }} />}
                      </button>
                    )
                  })}
                </section>
              )}

              {/* ── Overdue alert (currency-aware amounts) ── */}
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
                      <div key={i} className="flex items-center gap-2 py-1.5 px-3 rounded-lg flex-wrap"
                        style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.10)' }}>
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <span className="font-mono text-xs font-semibold shrink-0" style={{ color: 'var(--text-1)' }}>{inv.invoice_no}</span>
                          <span className="text-xs truncate" style={{ color: 'var(--text-3)' }}>{inv.project}</span>
                          {inv.currency && inv.currency !== 'RS' && (
                            <span className="text-[10px] font-bold px-1 py-0.5 rounded shrink-0" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>{inv.currency}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--fin-warning)' }}>
                            {fmtCurrency(inv.amount, inv.currency || 'RS')}
                          </span>
                          <AgingBadge days={inv.aging} status="Pending" />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          {workspace === 'projects' && isAll && (
            <section>
              <ProjectsWorkspace />
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
                    className="input pl-7 py-1.5 text-xs appearance-none w-full" style={{ minWidth: 'min(100%, 170px)', paddingRight: '1.5rem' }}>
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

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
                              className="min-w-0 rounded-xl p-3 text-left transition-all min-h-[72px]"
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
                              <div key={key} className="rounded-xl p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                                style={{
                                  background: item.active ? 'var(--accent-dim)' : 'var(--bg-base)',
                                  border: `1px solid ${item.active ? 'var(--accent-soft)' : 'var(--card-border)'}`,
                                }}>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{item.fullLabel}</p>
                                    <MonthStatusPill status={item.status} active={item.active} />
                                  </div>
                                  <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                                    {rec
                                      ? `${f['Invoice Number'] || 'Invoice number pending'} · ${fmt(f['Amount Raised'])} · ${f['Remark'] || 'No remark'}`
                                      : 'No record created for this month yet'}
                                  </p>
                                </div>
                                <div className="flex gap-2 flex-wrap flex-shrink-0">
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
                        <div className="flex flex-col sm:flex-row gap-2 flex-wrap">
                          <button onClick={() => openInvoiceRequestForm(group, retainerMonth)}
                            className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
                            <ExternalLink size={12} />Open invoice request form
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

          {workspace === 'invoices' && projectSummaryCards.length > 0 && (
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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {projectSummaryCards.map(({ project, metrics }) => {
                  const active = projectFilter === project
                  // Currencies used by this project, RS first
                  const currencies = (metrics.currencies || []).slice().sort((a, b) => a === 'RS' ? -1 : b === 'RS' ? 1 : 0)
                  const byCur = metrics.by_currency || {}
                  const hasMultiCur = currencies.length > 1 || (currencies.length === 1 && currencies[0] !== 'RS')
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
                      {/* Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{project}</p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{metrics.count || 0} invoice{metrics.count === 1 ? '' : 's'}</p>
                            {hasMultiCur && currencies.filter(c => c !== 'RS').map(c => (
                              <span key={c} className="text-[10px] font-bold px-1 py-0.5 rounded"
                                style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}>
                                {c}
                              </span>
                            ))}
                          </div>
                        </div>
                        {active && <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />}
                      </div>

                      {/* Per-currency amount rows */}
                      <div className="mt-3 space-y-2">
                        {currencies.length === 0 ? (
                          <div className="grid grid-cols-3 sm:grid-cols-3 gap-2">
                            {['Raised','Received','Open'].map(lbl => (
                              <div key={lbl}><p className="label">{lbl}</p><p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-3)' }}>—</p></div>
                            ))}
                          </div>
                        ) : currencies.map((cur) => {
                          const d = byCur[cur] || { raised: 0, received: 0, outstanding: 0 }
                          return (
                            <div key={cur}>
                              {hasMultiCur && (
                                <p className="text-[10px] font-bold mb-1 uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                                  {cur} {currencySymbol(cur)}
                                </p>
                              )}
                              <div className="grid grid-cols-3 sm:grid-cols-3 gap-2">
                                <div>
                                  <p className="label">Raised</p>
                                  <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-1)' }}>{fmtCurrency(d.raised, cur)}</p>
                                </div>
                                <div>
                                  <p className="label">Received</p>
                                  <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--fin-positive)' }}>{fmtCurrency(d.received, cur)}</p>
                                </div>
                                <div>
                                  <p className="label">Open</p>
                                  <p className="text-xs font-semibold tabular-nums" style={{ color: d.outstanding > 0 ? 'var(--fin-warning)' : 'var(--fin-positive)' }}>
                                    {fmtCurrency(d.outstanding, cur)}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {/* Filter bar + invoice table — only on invoices / retainers tabs */}
          {(workspace === 'invoices' || workspace === 'retainers') && <div className="card space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Invoice Filters</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                  {records.length} result{records.length !== 1 ? 's' : ''}
                </p>
              </div>
              {/* Billing type filter pills */}
              <div className="inline-flex items-center p-0.5 rounded-lg flex-shrink-0" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                {[['all','All'],['project','Projects'],['retainer','Retainers']].map(([v, l]) => (
                  <button key={v} onClick={() => setBillingFilter(v)}
                    className="text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
                    style={billingFilter === v
                      ? { background: 'var(--card-bg)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }
                      : { color: 'var(--text-3)' }}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[140px] sm:min-w-[180px]">
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
              {monthFilter && (
                <button onClick={() => setMonthFilter('')}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold"
                  style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}>
                  {monthLabel(monthFilter)}<X size={10} />
                </button>
              )}
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
                  setFilterConditions([])
                }}
                  className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.625rem' }}>
                  <X size={11} />Clear
                </button>
              )}
            </div>

            {showFilters && (
              <div className="flex flex-wrap gap-2 p-3 rounded-xl animate-slide-down"
                style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.04)' }}>
                <FilterSelect
                  value={projectFilter}
                  onChange={setProjectFilter}
                  options={picklists.Project || []}
                  placeholder="All projects"
                  icon={User}
                  width={150}
                />
                <FilterSelect
                  value={monthFilter}
                  onChange={setMonthFilter}
                  options={monthOptions.map(m => ({ value: m, label: monthLabel(m) }))}
                  placeholder="All months"
                  icon={CalendarClock}
                  width={150}
                />
                <FilterSelect
                  value={categoryFilter}
                  onChange={setCategoryFilter}
                  options={picklists.Category || []}
                  placeholder="All categories"
                  icon={Tag}
                  width={155}
                />
                <FilterSelect
                  value={raisedByFilter}
                  onChange={setRaisedByFilter}
                  options={picklists['Raised By'] || []}
                  placeholder="Anyone"
                  icon={User}
                  width={135}
                />
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
                  Pending / Outstanding
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
                {/* Divider */}
                <div className="w-full" style={{ borderTop: '1px solid var(--card-border)', margin: '0.25rem 0' }} />
                {/* Advanced filter builder */}
                <div className="w-full">
                  <p className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>
                    Advanced filters
                  </p>
                  <FilterBuilder
                    fields={INVOICE_FIELDS}
                    records={allRecords}
                    getFieldValue={r => r.fields ?? {}}
                    conditions={filterConditions}
                    onChange={setFilterConditions}
                    label="Add condition"
                  />
                </div>
              </div>
            )}
          </div>}

          {(workspace === 'invoices' || workspace === 'retainers') && <>
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
          <div className="md:hidden space-y-2">
            {loading && !listData
              ? Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="card animate-pulse p-3.5">
                    <div className="flex justify-between mb-2.5">
                      <div className="skeleton h-3 w-2/5 rounded" />
                      <div className="skeleton h-5 w-14 rounded-full" />
                    </div>
                    <div className="skeleton h-3 w-3/5 mb-3 rounded" />
                    <div className="grid grid-cols-3 gap-2">
                      <div className="skeleton h-8 rounded" />
                      <div className="skeleton h-8 rounded" />
                      <div className="skeleton h-8 rounded" />
                    </div>
                    <div className="flex justify-between mt-2.5">
                      <div className="skeleton h-3 w-1/4 rounded" />
                      <div className="skeleton h-3 w-1/5 rounded" />
                    </div>
                  </div>
                ))
              : records.length === 0
                ? <div className="card flex flex-col items-center py-12 gap-3" style={{ color: 'var(--text-3)' }}>
                    <Receipt size={32} style={{ opacity: 0.3 }} />
                    <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>No invoices found</p>
                    <p className="text-xs text-center max-w-[240px]">Try adjusting your filters, or create a new invoice to get started.</p>
                    <button onClick={openNew} className="btn-primary mt-2" style={{ fontSize: '0.75rem', padding: '0.45rem 0.9rem' }}>
                      <Plus size={13} />Create invoice
                    </button>
                  </div>
                : records.map(r => {
                    const f = r.fields || {}
                    const cur = f['Currency'] || 'RS'
                    const raised = Number(f['Amount Raised'] || 0)
                    const received = Number(f['Amount Received'] || 0)
                    const outstanding = Number(f['Outstanding Amount'] || 0)
                    const refs = parseAttachments(f['Reference'])
                    const pdfs = parseAttachments(f['Invoice PDF'])
                    const allFiles = [...refs, ...pdfs]
                    const aging = effectiveAging(f)
                    return (
                      <button key={r.id} onClick={() => openView(r)}
                        className="card-hover w-full text-left"
                        style={{ padding: '0.875rem 1rem' }}>

                        {/* Row 1: Invoice # + currency badge + status */}
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-mono text-[13px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
                              {f['Invoice Number'] || <span style={{ color: 'var(--text-3)' }}>No number</span>}
                            </span>
                            {cur !== 'RS' && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                                style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}>
                                {cur}
                              </span>
                            )}
                          </div>
                          <StatusPill status={f['Payment Status']} />
                        </div>

                        {/* Row 2: Project · Category */}
                        <p className="text-[11px] truncate mb-2.5" style={{ color: 'var(--text-3)' }}>
                          <span style={{ color: 'var(--text-2)', fontWeight: 500 }}>{f['Project'] || '—'}</span>
                          {f['Category'] ? <span> · {f['Category']}</span> : null}
                          {f['Milestone'] ? <span> · {f['Milestone']}</span> : null}
                        </p>

                        {/* Row 3: Amounts — always show Raised; show Received if > 0; Outstanding in warning */}
                        <div className="grid gap-2 mb-2.5"
                          style={{ gridTemplateColumns: received > 0 && outstanding > 0 ? 'repeat(3,1fr)' : received > 0 || outstanding > 0 ? 'repeat(2,1fr)' : '1fr' }}>
                          <div>
                            <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-3)' }}>Raised</p>
                            <p className="text-sm font-bold tabular-nums leading-tight" style={{ color: 'var(--text-1)' }}>
                              {fmtCurrency(raised, cur)}
                            </p>
                          </div>
                          {received > 0 && (
                            <div>
                              <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-3)' }}>Received</p>
                              <p className="text-sm font-semibold tabular-nums leading-tight" style={{ color: 'var(--fin-positive)' }}>
                                {fmtCurrency(received, cur)}
                              </p>
                            </div>
                          )}
                          {outstanding > 0 && (
                            <div>
                              <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-3)' }}>Outstanding</p>
                              <p className="text-sm font-semibold tabular-nums leading-tight" style={{ color: 'var(--fin-warning)' }}>
                                {fmtCurrency(outstanding, cur)}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Row 4: Meta bar — date, raised by, followup, files, aging */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap min-w-0">
                            <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-3)' }}>
                              {fmtDate(f['Raised Date'])}
                            </span>
                            {f['Raised By'] && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0"
                                style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-2)' }}>
                                <User size={8} />{f['Raised By']}
                              </span>
                            )}
                            {f['Next followup'] && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] flex-shrink-0"
                                style={{ color: 'var(--fin-warning)' }}>
                                <CalendarClock size={9} />{fmtDate(f['Next followup'])}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {allFiles.length > 0 && (
                              <span className="flex items-center gap-0.5 text-[10px]" style={{ color: 'var(--text-3)' }}>
                                <FileText size={10} />{allFiles.length}
                              </span>
                            )}
                            {aging > 0 && <AgingBadge days={aging} status={f['Payment Status']} />}
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
              <table className="w-full" style={{ minWidth: 1200 }}>
                <thead>
                  <tr>
                    <th className="tbl-head"><SortLabel col="Invoice Number">Invoice #</SortLabel></th>
                    <th className="tbl-head"><SortLabel col="Project">Project</SortLabel></th>
                    <th className="tbl-head"><SortLabel col="Category">Category</SortLabel></th>
                    <th className="tbl-head"><SortLabel col="Milestone">Milestone</SortLabel></th>
                    <th className="tbl-head"><SortLabel col="Raised By">Raised By</SortLabel></th>
                    <th className="tbl-head"><SortLabel col="Raised Date">Raised</SortLabel></th>
                    <th className="tbl-head"><SortLabel col="Amount Raised">Amount</SortLabel></th>
                    <th className="tbl-head"><SortLabel col="Amount with Tax">GST Total</SortLabel></th>
                    <th className="tbl-head"><SortLabel col="Amount Received">Received</SortLabel></th>
                    <th className="tbl-head"><SortLabel col="Outstanding Amount">Outstanding</SortLabel></th>
                    <th className="tbl-head"><SortLabel col="Payment Status">Status</SortLabel></th>
                    <th className="tbl-head"><SortLabel col="Agening (Days)">Aging</SortLabel></th>
                    <th className="tbl-head"><SortLabel col="Next followup">Next Followup</SortLabel></th>
                    <th className="tbl-head">Docs</th>
                    <th className="tbl-head" style={{ width: 80 }} />
                  </tr>
                </thead>
                <tbody>
                  {loading && !listData
                    ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
                    : records.length === 0
                      ? <tr><td colSpan={15} className="px-4 py-14 text-center" style={{ color: 'var(--text-3)' }}>
                          <div className="flex flex-col items-center gap-2">
                            <Receipt size={28} style={{ opacity: 0.3 }} />
                            <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>No invoices found</p>
                            <p className="text-xs">Adjust your filters or{' '}
                              <button onClick={openNew} style={{ color: 'var(--accent)' }} className="underline">create one</button>
                            </p>
                          </div>
                        </td></tr>
                      : records.map(r => {
                          const f = r.fields || {}
                          const outstanding = Number(f['Outstanding Amount'] || 0)
                          const refs = parseAttachments(f['Reference'])
                          const pdfs = parseAttachments(f['Invoice PDF'])
                          const allFiles = [...refs, ...pdfs]
                          const cur = f['Currency'] || 'RS'
                          return (
                            <tr key={r.id} className="tbl-row" style={{ cursor: 'pointer' }} onClick={() => openView(r)}
                              onMouseEnter={e => e.currentTarget.style.borderLeft = '2px solid var(--accent)'}
                              onMouseLeave={e => e.currentTarget.style.borderLeft = ''}>
                              <td className="tbl-cell">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-xs font-bold" style={{ color: 'var(--text-1)' }}>{f['Invoice Number'] || '—'}</span>
                                  {cur !== 'RS' && (
                                    <span className="text-[10px] font-bold px-1 py-0.5 rounded" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>{cur}</span>
                                  )}
                                </div>
                              </td>
                              <td className="tbl-cell"><span className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>{f['Project'] || '—'}</span></td>
                              <td className="tbl-cell"><span className="text-[11px]" style={{ color: 'var(--text-2)' }}>{f['Category'] || '—'}</span></td>
                              <td className="tbl-cell"><span className="text-[11px]" style={{ color: 'var(--text-2)' }}>{f['Milestone'] || '—'}</span></td>
                              <td className="tbl-cell">
                                {f['Raised By']
                                  ? <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-2)' }}>
                                      <User size={9} />{f['Raised By']}
                                    </span>
                                  : <span style={{ color: 'var(--text-3)' }}>—</span>}
                              </td>
                              <td className="tbl-cell"><span className="text-xs tabular-nums" style={{ color: 'var(--text-2)' }}>{fmtDate(f['Raised Date'])}</span></td>
                              <td className="tbl-cell"><span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--text-1)' }}>{fmtCurrency(f['Amount Raised'], cur)}</span></td>
                              <td className="tbl-cell"><span className="text-xs tabular-nums" style={{ color: 'var(--text-2)' }}>{fmtCurrency(f['Amount with Tax'], cur)}</span></td>
                              <td className="tbl-cell"><span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--fin-positive)' }}>{fmtCurrency(f['Amount Received'], cur)}</span></td>
                              <td className="tbl-cell">
                                {outstanding > 0
                                  ? <span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--fin-warning)' }}>{fmtCurrency(outstanding, cur)}</span>
                                  : <span className="text-xs" style={{ color: 'var(--text-3)' }}>—</span>}
                              </td>
                              <td className="tbl-cell"><StatusPill status={f['Payment Status']} /></td>
                              <td className="tbl-cell"><AgingBadge days={effectiveAging(f)} status={f['Payment Status']} /></td>
                              <td className="tbl-cell">
                                {f['Next followup']
                                  ? <span className="text-xs tabular-nums" style={{ color: effectiveAging(f) > 0 && f['Payment Status'] === 'Pending' ? 'var(--fin-warning)' : 'var(--text-2)' }}>
                                      {fmtDate(f['Next followup'])}
                                    </span>
                                  : <span style={{ color: 'var(--text-3)' }}>—</span>}
                              </td>
                              <td className="tbl-cell" onClick={e => e.stopPropagation()}>
                                {allFiles.length > 0 ? (
                                  <div className="flex items-center gap-1">
                                    {allFiles.slice(0, 2).map((a, i) => <AttachThumb key={i} a={a} size={28} onPreview={() => setPreviewDocs({ docs: allFiles, index: i })} />)}
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
          </>}

        </div>
      </main>
      {/* Mobile bottom nav — hidden sm+ */}
      <MobileBottomNav workspace={workspace} setWorkspace={setWorkspace} isAll={isAll} />

      {/* Drawers */}
      {drawer?.mode === 'view' && createPortal(
        <InvoiceDetail invoice={drawer.invoice} onClose={closeDrawer} onEdit={() => setDrawer({ mode: 'edit', invoice: drawer.invoice })} onPreview={(docs, idx) => setPreviewDocs({ docs, index: idx })} />,
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
      {helpOpen && createPortal(
        <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />,
        document.body
      )}
      <DocPreviewModal state={previewDocs} onClose={() => setPreviewDocs(null)} />
      </div>
    </div>
  )
}
