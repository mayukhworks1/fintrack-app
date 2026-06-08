import { useState, useCallback, useRef, useEffect, useMemo, useDeferredValue } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Drawer from '../components/Drawer'
import {
  Receipt, RefreshCw, Plus, X, ChevronDown, AlertTriangle,
  Clock, CheckCircle2, XCircle, Search, ExternalLink, FileText,
  ArrowUpDown, Save, Trash2, Image as ImageIcon, Filter,
  AlertOctagon, CalendarDays, User, Tag, ArrowRight, Eye,
  IndianRupee, TrendingUp, Percent, CalendarClock, Briefcase, RotateCcw,
  Sparkles, Upload, Loader2, Paperclip, Mail
} from 'lucide-react'
import { api } from '../services/api'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { formatInr } from '../utils/format'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { FilterSelect } from '../components/FilterSelect'
import { FilterBuilder, applyConditions } from '../components/FilterBuilder'
import { DocPreviewModal } from '../components/DocPreviewModal'
import { ManageSharedLinksModal, ShareLinkModal } from '../components/SharedLinks'
import clsx from 'clsx'
import { ExecutiveShell, ExecutiveHero, ExecutiveStatGrid, ExecutiveStatCard, ExecutivePanel, ExecutiveFilterBar, ExecutiveChip, ExecutiveMetricList } from '../components/ExecutiveUI'
import EmptyState from '../components/EmptyState'
import InvoiceActivityChart from '../components/InvoiceActivityChart'

/* ── Constants ──────────────────────────────────────────────────────────── */
// Dropdown options are derived live from invoice records — no hardcoded fallbacks
const STATUSES = ['Paid', 'Pending', 'Cancelled']

const EMPTY_FORM = {
  invoice_number: '', project: '', client_name: '', category: '', description: '',
  milestone: '', raised_by: '', raised_date: '', cleared_date: '',
  amount_raised: '', amount_with_tax: '', amount_received: '',
  payment_status: 'Pending', remark: '', next_followup: '',
  reference: [], invoice_pdf: [],
}

const INVOICE_PARSE_FIELD_LABELS = {
  invoice_number: 'Invoice Number',
  project: 'Project',
  category: 'Category',
  description: 'Description',
  milestone: 'Milestone',
  raised_by: 'Raised By',
  raised_date: 'Raised Date',
  cleared_date: 'Cleared Date',
  amount_raised: 'Amount Raised',
  amount_with_tax: 'Amount with Tax',
  amount_received: 'Amount Received',
  payment_status: 'Payment Status',
  remark: 'Remark',
  next_followup: 'Next Followup',
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

const projectInitials = (value) => String(value || 'NA')
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0]?.toUpperCase())
  .join('') || 'NA'

const INVOICE_SCALAR_FORM_KEYS = [
  'invoice_number',
  'project',
  'client_name',
  'category',
  'description',
  'milestone',
  'raised_by',
  'raised_date',
  'cleared_date',
  'amount_raised',
  'amount_with_tax',
  'amount_received',
  'payment_status',
  'remark',
  'next_followup',
]

const normalizeInvoiceScalarForm = (form) => INVOICE_SCALAR_FORM_KEYS.reduce((acc, key) => {
  const value = form?.[key]
  acc[key] = value == null ? '' : String(value).trim()
  return acc
}, {})

const invoiceAmountParts = (fields = {}) => {
  const base = Number(fields['Amount Raised'] || 0)
  const gross = Number(fields['Amount with Tax'] || base)
  const received = Number(fields['Amount Received'] || 0)
  const status = String(fields['Payment Status'] || '').trim()
  const isPaid = status === 'Paid'
  const gst = Math.max(0, gross - base)
  const variance = Math.max(0, gross - received)
  return {
    base,
    gross,
    gst,
    received,
    deduction: isPaid ? variance : 0,
    outstanding: isPaid || status === 'Cancelled' ? 0 : variance,
    isPaid,
  }
}

const buildInvoiceScalarPayload = (form, { isEdit = false, paymentOnly = false } = {}) => ({
  invoice_number:   form.invoice_number,
  project:          form.project,
  client_name:      form.client_name || undefined,
  category:         form.category,
  description:      form.description,
  milestone:        form.milestone,
  raised_by:        form.raised_by,
  payment_status:   form.payment_status,
  remark:           form.remark,
  amount_raised:    form.amount_raised !== '' ? Number(form.amount_raised) : undefined,
  amount_with_tax:  form.amount_with_tax !== '' ? Number(form.amount_with_tax) : undefined,
  amount_received:  form.amount_received !== '' ? Number(form.amount_received) : undefined,
  raised_date:      form.raised_date ? `${form.raised_date}T00:00:00.000Z` : (isEdit ? null : undefined),
  cleared_date:     form.cleared_date ? `${form.cleared_date}T00:00:00.000Z` : (isEdit ? null : undefined),
  next_followup:    paymentOnly
    ? null
    : form.next_followup
      ? `${form.next_followup}T00:00:00.000Z`
      : (isEdit ? null : undefined),
})

const isRetainerCategory = (value) => /retainer/i.test(String(value || ''))
const currentMonthKey = () => monthKey(new Date().toISOString())
const firstDayIso = (key) => `${key}-01T00:00:00.000Z`

const INVOICE_REQUEST_FORM_URL = 'https://forms.zohopublic.com/theworks/form/TheWorksInvoiceRequest/formperma/EeBkA0aaMt64sMe9n3mxlKggjA-QmVDmTVwrqMHPGOY'
const INVOICE_SHARE_COLUMNS = [
  'Invoice Number',
  'Client Name',
  'Project',
  'Category',
  'Payment Status',
  'Milestone',
  'Raised By',
  'Amount Raised',
  'Amount with Tax',
  'Amount Received',
  'Outstanding Amount',
  'Raised Date',
  'Cleared Date',
  'Next followup',
  'Description',
  'Remark',
]

const DEFAULT_INVOICE_COLUMN_WIDTHS = {
  row: 56,
  invoice_number: 150,
  client_name: 190,
  project: 300,
  category: 150,
  milestone: 150,
  raised_by: 220,
  raised_date: 120,
  amount_raised: 130,
  amount_with_tax: 130,
  amount_received: 130,
  outstanding_amount: 140,
  payment_status: 120,
  aging: 95,
  next_followup: 125,
  docs: 110,
  actions: 130,
}

/* ── Field definitions for advanced filter builder ────────────────────────── */
const INVOICE_FIELDS = [
  { key: 'Client Name',      label: 'Client Name',     type: 'text' },
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
    return cell.map(a => ({
      name: a.name || a.filename || 'Attachment',
      url:  a.url  || a.presignedUrl || '',
      mime: a.mimeType || a.mimetype || '',
    }))
  }
  const parts = String(cell).split(/\s+/)
  const out = []
  for (let i = 0; i < parts.length; i += 2) {
    if (parts[i + 1]) out.push({
      name: decodeURIComponent(parts[i].replace(/_x20_/g, ' ')).replace(/_x2D_/g, '-'),
      url:  parts[i + 1],
      mime: '',
    })
  }
  return out
}

const isImage = (a) => {
  if (a.mime?.startsWith('image/')) return true
  return /\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i.test(a.url) || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(a.name)
}
const isPdf = (a) =>
  a.mime === 'application/pdf' ||
  /\.pdf(\?|$)/i.test(a.url) ||
  a.name?.toLowerCase().endsWith('.pdf')

/* ── Status config ───────────────────────────────────────────────────────── */
const STATUS_META = {
  Paid:      { color: 'var(--fin-positive)', bg: 'var(--fin-pos-bg)',  border: 'var(--fin-pos-border)',  icon: CheckCircle2 },
  Pending:   { color: 'var(--fin-warning)',  bg: 'var(--fin-warn-bg)', border: 'var(--fin-warn-border)', icon: Clock },
  Cancelled: { color: 'var(--fin-negative)', bg: 'var(--fin-neg-bg)', border: 'var(--fin-neg-border)',  icon: XCircle },
}

function classifyAgingBand(days) {
  const d = Number(days || 0)
  if (d <= 14) return '0-14d'
  if (d <= 30) return '15-30d'
  if (d <= 60) return '31-60d'
  return '60d+'
}

function dateOnlyValue(value) {
  if (!value) return ''
  return String(value).slice(0, 10)
}

function endOfMonthIso(key) {
  const [year, month] = key.split('-').map(Number)
  const d = new Date(year, month, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

/* ── Aging badge ─────────────────────────────────────────────────────────── */
// Aging fallback: use Teable formula when available, else compute from Raised Date
function effectiveAging(f) {
  const teableVal = f['Agening (Days)']
  if (teableVal != null && teableVal !== '' && Number(teableVal) > 0) return Number(teableVal)
  const raised = parseIsoDate(f['Raised Date'])
  if (!raised) return 0
  return Math.floor((Date.now() - raised.getTime()) / 86_400_000)
}

function AgingBadge({ days, status }) {
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

/* ── Attachment thumbnail ────────────────────────────────────────────────── */
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

/* ── Full Attachment card ────────────────────────────────────────────────── */
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

function AttachmentUploadField({ label, fieldKey, value, onChange, recordId, ensureRecord }) {
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
function SelectInput({ value, onChange, options, placeholder = 'Select…', compact = false }) {
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

function SuggestInput({ value, onChange, options = [], placeholder = 'Type or select…', listId }) {
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
function InvoiceDetail({ open, invoice, onClose, onEdit, onRecordPayment, isEditor, onPreview }) {
  const navigate = useNavigate()
  const f = (open && invoice) ? (invoice.fields || {}) : {}
  const refs = parseAttachments(f['Reference'])
  const pdfs = parseAttachments(f['Invoice PDF'])
  const allDetailFiles = [...refs, ...pdfs]
  const outstanding = Number(f['Outstanding Amount'] || 0)
  const openProjects = () => {
    const params = new URLSearchParams()
    if (f['Client Name']) params.set('client', f['Client Name'])
    if (f['Project']) params.set('q', f['Project'])
    navigate(`/projects?${params.toString()}`)
  }
  const openStatus = () => {
    const cfg = {
      type: 'card',
      filterClient: f['Client Name'] || '',
      filterStatus: '',
      search: f['Project'] || '',
      columns: ['Client', 'Project', 'Status', 'Short Status'],
      boardGroupBy: 'Status',
      cardGroupBy: 'Client',
      cardGroupSort: 'count-desc',
      cardRecordSort: 'project-asc',
      advancedConditions: [],
      theme: 'cobalt',
      density: 'comfortable',
      showDashboard: true,
      showClientAccents: true,
    }
    navigate(`/status?v=${encodeURIComponent(btoa(JSON.stringify(cfg)))}`)
  }

  const actions = open && invoice ? (
    <>
      {isEditor && f['Payment Status'] === 'Pending' && (
        <button onClick={onRecordPayment} className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
          <CheckCircle2 size={12} />Record Payment
        </button>
      )}
      {isEditor && (
        <button onClick={onEdit} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
          Edit
        </button>
      )}
    </>
  ) : null

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={f['Invoice Number'] || '—'}
      subtitle={[f['Project'], f['Category'], f['Milestone']].filter(Boolean).join(' · ')}
      width={500}
      accent={false}
      actions={actions}
      footer={
        <button onClick={onClose} className="btn-ghost w-full text-xs" style={{ justifyContent: 'center' }}>Close</button>
      }
    >
      <div className="p-5 space-y-5">
          {/* Status row */}
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

          {/* Description */}
          {f['Description'] && (
            <div className="rounded-xl p-3.5" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
              <p className="label mb-2">Description</p>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-1)', whiteSpace: 'pre-wrap' }}>
                {f['Description']}
              </p>
            </div>
          )}

          {(f['Project'] || f['Client Name']) && (
            <div className="rounded-xl p-3.5" style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Briefcase size={13} style={{ color: 'var(--accent)' }} />
                <p className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>Record context</p>
              </div>
              <div className="space-y-1 text-xs" style={{ color: 'var(--text-2)' }}>
                {f['Project'] && <p><strong style={{ color: 'var(--text-1)' }}>Project:</strong> {f['Project']}</p>}
                {f['Client Name'] && <p><strong style={{ color: 'var(--text-1)' }}>Client:</strong> {f['Client Name']}</p>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={openProjects} className="btn-ghost text-xs" style={{ padding: '0.45rem 0.75rem' }}>Open projects</button>
                <button onClick={openStatus} className="btn-ghost text-xs" style={{ padding: '0.45rem 0.75rem' }}>Open status board</button>
              </div>
            </div>
          )}

          {/* Amount grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {[
              ['Amount Raised',   f['Amount Raised'],       'var(--text-1)'],
              ['With GST (18%)',  f['Amount with Tax'],     'var(--text-1)'],
              ['Received',        f['Amount Received'],     'var(--fin-positive)'],
              ['Outstanding',     f['Outstanding Amount'],  outstanding > 0 ? 'var(--fin-warning)' : 'var(--fin-positive)'],
            ].map(([lbl, val, clr]) => (
              <div key={lbl} className="rounded-xl p-3" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                <p className="label mb-1.5">{lbl}</p>
                <p className="font-bold tabular-nums text-base leading-none" style={{ color: clr }}>{fmt(val)}</p>
              </div>
            ))}
          </div>

          {/* Dates + computed */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              ['Raised',      fmtDateFull(f['Raised Date'])],
              ['Cleared',     fmtDateFull(f['Cleared Date'])],
              ['Next Followup', fmtDateFull(f['Next followup'])],
              ['Days to Clear', f['Days To Clear']    != null ? `${f['Days To Clear']} days`    : '—'],
              ['Aging',         f['Agening (Days)']   != null ? `${f['Agening (Days)']} days`   : '—'],
              ['Milestone',     f['Milestone']        || '—'],
            ].map(([lbl, val]) => (
              <div key={lbl}>
                <p className="label">{lbl}</p>
                <p className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>{val}</p>
              </div>
            ))}
          </div>

          {/* Remark */}
          {f['Remark'] && (
            <div>
              <p className="label">Remark</p>
              <p className="text-sm leading-relaxed mt-1" style={{ color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>{f['Remark']}</p>
            </div>
          )}

          {/* Attachments */}
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
    </Drawer>
  )
}

/* ── Invoice form drawer ─────────────────────────────────────────────────── */
function Field({ label, children }) {
  return <div><label className="label">{label}</label>{children}</div>
}

function InvoiceDrawer({ open, invoice, prefill, paymentOnly = false, onClose, onSaved, onDeleted, options = {} }) {
  const { userEmail, authRole, isEmailAuth } = useAuth()
  const isEdit = Boolean(invoice?.id)
  const ownerLocked = Boolean(isEmailAuth && userEmail && !['superadmin', 'admin', 'manager', 'finance'].includes(authRole))
  const [form,       setForm]      = useState(EMPTY_FORM)
  const [initialForm, setInitialForm] = useState(EMPTY_FORM)
  const [workingRecordId, setWorkingRecordId] = useState(invoice?.id || null)
  const [saving,     setSaving]    = useState(false)
  const [deleting,   setDeleting]  = useState(false)
  const [confirmDel, setConfirmDel]= useState(false)
  const [error,      setError]     = useState('')
  const [parsing,    setParsing]   = useState(false)
  const [parseNote,  setParseNote] = useState('')   // "Filled N fields" banner text
  const [parseError, setParseError]= useState('')
  const [parseApplied, setParseApplied] = useState([])
  const parseFileRef = useRef(null)
  const currentRecordId = invoice?.id || workingRecordId
  const paidSelected = form.payment_status === 'Paid'
  const projectOptions    = options.projects    || []
  const clientNameOptions = options.clientNames || []
  const categoryOptions   = options.categories  || []
  const milestoneOptions  = options.milestones  || []
  const raisedByOptions   = options.raisedBy    || []
  const retainerCategoryOption = categoryOptions.find(c => /retainer/i.test(c)) || 'Development- Retainer'
  const retainerSelected = isRetainerCategory(form.category)
  const hasPaymentAttempt = form.payment_status === 'Paid' || String(form.amount_received).trim() || form.cleared_date
  const hasFormChanges = useMemo(
    () => JSON.stringify(normalizeInvoiceScalarForm(form)) !== JSON.stringify(normalizeInvoiceScalarForm(initialForm)),
    [form, initialForm]
  )
  const canSubmit = !saving && (!isEdit || paymentOnly || hasFormChanges)

  useEffect(() => {
    const ownerPatch = ownerLocked ? { raised_by: userEmail } : {}
    if (!invoice && !prefill) {
      const next = { ...EMPTY_FORM, ...ownerPatch }
      setForm(next)
      setInitialForm(next)
      return
    }
    if (!invoice && prefill) {
      const next = { ...EMPTY_FORM, ...prefill, ...ownerPatch }
      setForm(next)
      setInitialForm(next)
      return
    }
    const f = invoice.fields || {}
    const next = {
      invoice_number:  f['Invoice Number']  || '',
      project:         f['Project']         || '',
      client_name:     f['Client Name']     || '',
      category:        f['Category']        || '',
      description:     f['Description']     || '',
      milestone:       f['Milestone']       || '',
      raised_by:       ownerLocked ? userEmail : (f['Raised By'] || ''),
      raised_date:     f['Raised Date']   ? String(f['Raised Date']).slice(0, 10)   : '',
      cleared_date:    f['Cleared Date']  ? String(f['Cleared Date']).slice(0, 10)  : '',
      amount_raised:   f['Amount Raised']   ?? '',
      amount_with_tax: f['Amount with Tax'] ?? '',
      amount_received: f['Amount Received'] ?? '',
      payment_status:  f['Payment Status']  || 'Pending',
      remark:          f['Remark']          || '',
      next_followup:   f['Next followup'] ? String(f['Next followup']).slice(0, 10) : '',
      reference:       Array.isArray(f['Reference']) ? f['Reference'] : [],
      invoice_pdf:     Array.isArray(f['Invoice PDF']) ? f['Invoice PDF'] : [],
      ...(prefill || {}),
      ...ownerPatch,
    }
    setForm(next)
    setInitialForm(next)
  }, [invoice, prefill, ownerLocked, userEmail])

  useEffect(() => {
    setWorkingRecordId(invoice?.id || null)
  }, [invoice?.id])

  const set  = k => v   => setForm(f => ({ ...f, [k]: v }))
  const setE = k => ev  => setForm(f => ({ ...f, [k]: ev.target.value }))

  async function persistDraftRecord() {
    if (currentRecordId) return currentRecordId
    const payload = {
      ...buildInvoiceScalarPayload(form),
      payment_status:  form.payment_status === 'Paid' && (!String(form.amount_received).trim() || !form.cleared_date) ? 'Pending' : form.payment_status,
      remark: form.payment_status === 'Paid' && (!String(form.amount_received).trim() || !form.cleared_date)
        ? [form.remark, 'Draft created for attachment upload. Complete paid details before final save.'].filter(Boolean).join(' ')
        : form.remark,
    }
    const created = await api.invoices.create(payload)
    const createdId = created?.id
    if (!createdId) throw new Error('Invoice draft was created but no record id was returned')
    setWorkingRecordId(createdId)
    return createdId
  }

  async function handleSave() {
    if (isEdit && !paymentOnly && !hasFormChanges) {
      setError('')
      return
    }
    if (hasPaymentAttempt && form.payment_status !== 'Paid') {
      setError('Payment Status must be Paid when recording received amount or cleared date')
      return
    }
    if (hasPaymentAttempt && !String(form.amount_received).trim()) {
      setError('Amount received is required when status is Paid')
      return
    }
    if (hasPaymentAttempt && !form.cleared_date) {
      setError('Cleared date is required when status is Paid')
      return
    }
    setSaving(true); setError('')
    try {
      const payload = buildInvoiceScalarPayload(form, { isEdit, paymentOnly })
      const saved = currentRecordId ? await api.invoices.update(currentRecordId, payload) : await api.invoices.create(payload)
      setInitialForm(form)
      onSaved(saved)
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirmDel) { setConfirmDel(true); return }
    setDeleting(true)
    try { await api.invoices.delete(invoice.id); onDeleted(invoice.id) }
    catch (e) { setError(e.message || 'Delete failed') }
    finally { setDeleting(false) }
  }

  async function handleParseFile(file) {
    if (!file) return
    setParsing(true); setParseError(''); setParseNote(''); setParseApplied([])
    try {
      const { fields } = await api.invoices.parse(file)
      if (!fields || Object.keys(fields).length === 0) {
        setParseError('AI could not extract any fields from this document. Please fill manually.')
        return
      }
      // Map returned fields onto the form — only overwrite blank fields (preserve user edits)
      const FIELD_MAP = {
        invoice_number:  'invoice_number',
        project:         'project',
        description:     'description',
        raised_date:     'raised_date',
        cleared_date:    'cleared_date',
        amount_raised:   'amount_raised',
        amount_with_tax: 'amount_with_tax',
        amount_received: 'amount_received',
        payment_status:  'payment_status',
        milestone:       'milestone',
        raised_by:       'raised_by',
        remark:          'remark',
      }
      const next = { ...form }
      const applied = []
      let filled = 0
      for (const [aiKey, formKey] of Object.entries(FIELD_MAP)) {
        const val = fields[aiKey]
        if (val == null || val === '') continue
        const cur = form[formKey]
        const isEmpty = cur === '' || cur === null || cur === undefined || cur === 'Pending'
        if (formKey === 'payment_status' || isEmpty) {
          const normalised = (formKey.endsWith('_date') && typeof val === 'string')
            ? val.slice(0, 10)
            : val
          next[formKey] = String(normalised)
          applied.push({
            key: formKey,
            label: INVOICE_PARSE_FIELD_LABELS[formKey] || formKey,
            value: String(normalised),
          })
          if (isEmpty) filled++
        }
      }
      setForm(next)
      setParseApplied(applied)
      setParseNote(`AI filled ${filled} field${filled !== 1 ? 's' : ''} — please review and correct`)
    } catch (e) {
      const status = e.status
      const msg = status === 400 ? e.message               // our explicit error (bad file, unreadable PDF, etc.)
               : status === 413 ? 'File too large (max 10 MB)'
               : status === 403 ? 'Not authorized to use this feature'
               : e.message && !e.message.startsWith('[') ? e.message
               : 'AI parse failed — try a clearer image or a text-based PDF'
      setParseError(msg)
    } finally {
      setParsing(false)
      if (parseFileRef.current) parseFileRef.current.value = ''
    }
  }

  const drawerTitle = paymentOnly
    ? `Record Payment · ${invoice?.fields?.['Invoice Number'] || 'Invoice'}`
    : isEdit ? `Edit · ${invoice?.fields?.['Invoice Number'] || 'Invoice'}` : 'New Invoice'

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={drawerTitle}
      width={520}
      accent
      footer={
        <div className="flex items-center justify-between gap-3">
          {isEdit ? (
            <button onClick={handleDelete} disabled={deleting} className="btn-danger" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>
              <Trash2 size={12} />{deleting ? 'Deleting…' : confirmDel ? 'Confirm?' : 'Delete'}
            </button>
          ) : <div />}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>Cancel</button>
            <button
              onClick={handleSave}
              disabled={!canSubmit}
              className={canSubmit ? 'btn-primary' : 'btn-ghost'}
              style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem', opacity: canSubmit ? 1 : 0.62 }}
              title={!canSubmit ? 'No form changes to save' : undefined}
            >
              <Save size={12} />{saving ? 'Saving…' : !canSubmit ? 'No changes' : paymentOnly ? 'Record payment' : isEdit ? 'Save changes' : 'Create invoice'}
            </button>
          </div>
        </div>
      }
    >
      <div className="p-5 space-y-3.5">

          {/* ── AI Invoice Scanner ── */}
          <div>
            <input
              ref={parseFileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              className="hidden"
              onChange={e => handleParseFile(e.target.files?.[0])}
            />
            {parsing ? (
              <div className="flex items-center justify-center gap-2.5 p-4 rounded-xl"
                style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)' }}>
                <Loader2 size={15} className="animate-spin flex-shrink-0" style={{ color: 'var(--accent)' }} />
                <span className="text-xs font-medium" style={{ color: 'var(--accent)' }}>
                  AI is reading your invoice…
                </span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => parseFileRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 p-3.5 rounded-xl border-2 border-dashed transition-all hover:opacity-90 active:scale-[0.98]"
                style={{ borderColor: 'var(--accent-soft)', background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                <Sparkles size={14} />
                <span className="text-xs font-semibold">Scan Invoice with AI</span>
                <Upload size={12} className="opacity-60" />
                <span className="text-[11px] opacity-60">PDF · PNG · JPG</span>
              </button>
            )}
            {parseNote && !parsing && (
              <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg text-xs"
                style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', color: '#22c55e' }}>
                <CheckCircle2 size={12} className="flex-shrink-0" />
                {parseNote}
              </div>
            )}
            {parseApplied.length > 0 && !parsing && (
              <div className="mt-2 rounded-xl p-3 space-y-2"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                  AI filled these fields
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {parseApplied.map((item) => (
                    <div key={item.key} className="rounded-lg px-2.5 py-2"
                      style={{ background: 'var(--card-bg)', border: '1px solid var(--glass-border)' }}>
                      <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>{item.label}</p>
                      <p className="text-xs mt-1 break-words" style={{ color: 'var(--text-1)' }}>{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {parseError && !parsing && (
              <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg text-xs"
                style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.20)', color: '#f87171' }}>
                <AlertTriangle size={12} className="flex-shrink-0" />
                {parseError}
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl text-xs"
              style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.20)', color: '#f87171' }}>
              <AlertTriangle size={13} />{error}
            </div>
          )}

          {paymentOnly ? (
            <>
              <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Invoice context</p>
                <p className="text-sm font-semibold mt-2" style={{ color: 'var(--text-1)' }}>{form.invoice_number || invoice?.fields?.['Invoice Number'] || '—'}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                  {[form.project || invoice?.fields?.['Project'], form.category || invoice?.fields?.['Category'], form.milestone || invoice?.fields?.['Milestone']].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Payment Status">
                  <SelectInput value={form.payment_status} onChange={set('payment_status')} options={STATUSES} />
                </Field>
                <Field label="Cleared Date">
                  <input type="date" className="input" value={form.cleared_date} onChange={setE('cleared_date')} />
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Received (₹)">
                  <input type="number" className="input" value={form.amount_received} onChange={setE('amount_received')} placeholder="0" />
                </Field>
                <Field label="Remark">
                  <input className="input" value={form.remark} onChange={setE('remark')} placeholder="Payment note or settlement details…" />
                </Field>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Invoice Number">
                  <input className="input" value={form.invoice_number} onChange={setE('invoice_number')} placeholder="WM/25-26/001" />
                </Field>
                <Field label="Payment Status">
                  <SelectInput value={form.payment_status} onChange={set('payment_status')} options={STATUSES} />
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Client Name">
                  <SelectInput value={form.client_name} onChange={set('client_name')} options={clientNameOptions} placeholder="Select client..." />
                </Field>
                <Field label="Project">
                  <SelectInput value={form.project} onChange={set('project')} options={projectOptions} placeholder="Select project..." />
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Category">
                  <SuggestInput value={form.category} onChange={set('category')} options={categoryOptions} placeholder="Type or select category..." listId="invoice-category-options" />
                </Field>
              </div>
              <div>
                <label className="label">Billing Type</label>
                <div className="inline-flex items-center p-1 rounded-lg" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, category: categoryOptions.find(c => !isRetainerCategory(c)) || '' }))}
                    className="text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
                    style={!retainerSelected
                      ? { background: 'var(--card-bg)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }
                      : { color: 'var(--text-3)' }}>
                    Project
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, category: retainerCategoryOption }))}
                    className="text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
                    style={retainerSelected
                      ? { background: 'var(--card-bg)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }
                      : { color: 'var(--text-3)' }}>
                    Retainer
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Milestone">
                  <SuggestInput value={form.milestone} onChange={set('milestone')} options={milestoneOptions} placeholder="Type or select milestone..." listId="invoice-milestone-options" />
                </Field>
                <Field label="Raised By">
                  {ownerLocked ? (
                    <div className="input flex items-center gap-2" style={{ color: 'var(--text-1)', background: 'var(--bg-input)' }}>
                      <Mail size={13} style={{ color: 'var(--accent)' }} />
                      <span className="truncate">{userEmail}</span>
                    </div>
                  ) : (
                    <SuggestInput value={form.raised_by} onChange={set('raised_by')} options={raisedByOptions} placeholder="Type or select owner..." listId="invoice-raised-by-options" />
                  )}
                </Field>
              </div>
              <Field label="Description">
                <textarea className="input resize-none" rows={2} value={form.description} onChange={setE('description')} placeholder="Brief description…" />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Raised Date"><input type="date" className="input" value={form.raised_date} onChange={setE('raised_date')} /></Field>
                <Field label="Cleared Date"><input type="date" className="input" value={form.cleared_date} onChange={setE('cleared_date')} /></Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Raised (₹)"><input type="number" className="input" value={form.amount_raised}   onChange={setE('amount_raised')}   placeholder="0" /></Field>
                <Field label="With GST (₹)"><input type="number" className="input" value={form.amount_with_tax} onChange={setE('amount_with_tax')} placeholder="0" /></Field>
                <Field label="Received (₹)"><input type="number" className="input" value={form.amount_received} onChange={setE('amount_received')} placeholder="0" /></Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Next Followup">
                  <div className="flex items-center gap-2">
                    <input type="date" className="input" value={form.next_followup} onChange={setE('next_followup')} />
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, next_followup: '' }))}
                      className="btn-ghost flex-shrink-0"
                      style={{ fontSize: '0.75rem', padding: '0.55rem 0.75rem' }}
                      title="Clear follow-up date"
                    >
                      <RotateCcw size={12} />Clear
                    </button>
                  </div>
                </Field>
              </div>
              <Field label="Remark">
                <textarea className="input resize-none" rows={2} value={form.remark} onChange={setE('remark')} placeholder="Notes…" />
              </Field>
            </>
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

          {paidSelected && (
            <div className="rounded-xl p-3 text-xs flex items-start gap-2"
              style={{ background: 'var(--fin-warn-bg)', border: '1px solid var(--fin-warn-border)', color: 'var(--text-2)' }}>
              <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--fin-warning)' }} />
              Paid invoices must include Amount Received and Cleared Date. It is also recommended to attach a payment reference screenshot before closing the entry.
            </div>
          )}

          {retainerSelected && (
            <div className="rounded-xl p-3 text-xs"
              style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-soft)', color: 'var(--text-2)' }}>
              Retainer mode — put the retainer/client name in Project. The latest retainer row becomes the monthly template; invoice number can be filled later.
            </div>
          )}
        </div>
    </Drawer>
  )
}

function ResizableHead({ width, children, onResizeStart }) {
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
function SkeletonRow() {
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
export default function Invoices() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { isEditor } = useAuth()
  const toast = useToast()
  const initialStatus = searchParams.get('status') || ''
  const initialProject = searchParams.get('project') || ''
  const initialClient = searchParams.get('client') || ''
  const initialQuery = searchParams.get('q') || ''
  const [workspace,       setWorkspace]       = useState('invoices')
  const [selectedRetainer,setSelectedRetainer]= useState('')
  const [retainerMonth,   setRetainerMonth]   = useState(currentMonthKey())
  const [billingFilter,   setBillingFilter]   = useState('all')
  const [retainerActionBusy, setRetainerActionBusy] = useState('')
  const [statusFilter,   setStatusFilter]   = useState(initialStatus)
  const [projectFilter,  setProjectFilter]  = useState(initialProject)
  const [clientFilter,   setClientFilter]   = useState(initialClient)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [raisedByFilter, setRaisedByFilter] = useState('')
  const [monthFilter,    setMonthFilter]    = useState('')
  const [agingBandFilter,setAgingBandFilter]= useState('')
  const [dateFieldFilter,setDateFieldFilter]= useState('Raised Date')
  const [dateFrom,       setDateFrom]       = useState('')
  const [dateTo,         setDateTo]         = useState('')
  const [search,         setSearch]         = useState(initialQuery)
  const [overdueOnly,    setOverdueOnly]    = useState(false)
  const [hasDocsOnly,    setHasDocsOnly]    = useState(false)
  const [followupDueOnly,setFollowupDueOnly]= useState(false)
  const [showFilters,    setShowFilters]    = useState(false)
  const [filterConditions, setFilterConditions] = useState([])
  const [sortCol,        setSortCol]        = useState('Raised Date')
  const [sortDir,        setSortDir]        = useState('desc')
  const [drawer, setDrawer] = useState(null)
  const [previewDocs, setPreviewDocs] = useState(null)
  const [shareModal, setShareModal] = useState(false)
  const [manageModal, setManageModal] = useState(false)
  const [columnWidths, setColumnWidths] = useState(DEFAULT_INVOICE_COLUMN_WIDTHS)
  const [tableDensity, setTableDensity] = useState('comfortable')
  const deferredSearch = useDeferredValue(search)
  const resizeRef = useRef(null)

  useEffect(() => { setStatusFilter(searchParams.get('status') || '') }, [searchParams])
  useEffect(() => { setProjectFilter(searchParams.get('project') || '') }, [searchParams])
  useEffect(() => { setClientFilter(searchParams.get('client') || '') }, [searchParams])
  useEffect(() => { setSearch(searchParams.get('q') || '') }, [searchParams])

  const updateFilterParam = useCallback((key, value) => {
    const next = new URLSearchParams(searchParams)
    const current = searchParams.get(key) || ''
    const target = value || ''
    if (current === target) return
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    updateFilterParam('q', deferredSearch.trim())
  }, [deferredSearch, updateFilterParam])

  /* ── Fetch summary ── */
  const fetchSummary = useCallback((opts = {}) => api.invoices.summary(opts), [])
  const { data: summary, loading: sumLoading } = useAutoRefresh(fetchSummary, 10_000)

  /* ── Fetch ALL records from Teable (no server-side status/project filter) ──
   * Filtering by status/project happens client-side in scopedRecords so that
   * dashboard widgets (Last 3 Months, Recent Projects) always use the full
   * dataset and don't show ₹0 for months that have paid/non-matching invoices. */
  const fetchRecords = useCallback((opts = {}) =>
    api.invoices.list({
      limit:    1000,
      order_by: sortCol,
      order:    sortDir,
      ...opts,
    }), [sortCol, sortDir])

  const { data: listData, loading, error, refresh, syncing } = useAutoRefresh(fetchRecords, 10_000)
  const [recordsState, setRecordsState] = useState([])
  useEffect(() => {
    setRecordsState(listData?.records || [])
  }, [listData?.records])
  const allRecords = recordsState

  /* ── Live project names from Projects table ──────────────────────────────
   * Merges names from actual invoices (already loaded) with names from the
   * Projects module so brand-new projects appear in the dropdown immediately,
   * even before any invoice is raised for them.  Refreshes every 30 s so
   * projects added by another session also show up without a page reload.   */
  const [liveProjectNames, setLiveProjectNames] = useState([])
  useEffect(() => {
    let cancelled = false
    async function fetchProjectNames() {
      try {
        const list = await api.projects.names({ fresh: true })
        if (cancelled) return
        const names = (list || []).map(p => p.name).filter(Boolean)
        setLiveProjectNames(names)
      } catch { /* non-fatal — invoice-derived list is still shown */ }
    }
    fetchProjectNames()
    const t = setInterval(fetchProjectNames, 30_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  /* ── Picklists from Teable schema (Project, Client Name, Category, etc.) ── */
  const [invoicePicklists, setInvoicePicklists] = useState({})
  useEffect(() => {
    api.invoices.picklists().then(setInvoicePicklists).catch(() => {})
  }, [])

  /* ── Dynamic filter/form options — prefer Teable schema, supplement from records ── */
  const projectOptions = useMemo(() => {
    const fromSchema  = invoicePicklists['Project'] || []
    const fromRecords = allRecords.map(r => r.fields?.['Project']).filter(Boolean)
    return [...new Set([...fromSchema, ...fromRecords, ...liveProjectNames])].sort()
  }, [invoicePicklists, allRecords, liveProjectNames])

  const clientNameOptions = useMemo(() => {
    const fromSchema  = invoicePicklists['Client Name'] || []
    const fromRecords = allRecords.map(r => r.fields?.['Client Name']).filter(Boolean)
    return [...new Set([...fromSchema, ...fromRecords])].sort()
  }, [invoicePicklists, allRecords])

  const categoryOptions = useMemo(() => {
    const fromSchema  = invoicePicklists['Category'] || []
    const fromRecords = allRecords.map(r => r.fields?.['Category']).filter(Boolean)
    return [...new Set([...fromSchema, ...fromRecords])].sort()
  }, [invoicePicklists, allRecords])

  const milestoneOptions = useMemo(() => {
    const fromSchema  = invoicePicklists['Milestone'] || []
    const fromRecords = allRecords.map(r => r.fields?.['Milestone']).filter(Boolean)
    return [...new Set([...fromSchema, ...fromRecords])].sort()
  }, [invoicePicklists, allRecords])

  const raisedByOptions = useMemo(() => {
    const fromSchema  = invoicePicklists['Raised By'] || []
    const fromRecords = allRecords.map(r => r.fields?.['Raised By']).filter(Boolean)
    return [...new Set([...fromSchema, ...fromRecords])].sort()
  }, [invoicePicklists, allRecords])

  // Bundle for InvoiceDrawer
  const formOptions = useMemo(() => ({
    projects:    projectOptions,
    clientNames: clientNameOptions,
    categories:  categoryOptions,
    milestones:  milestoneOptions,
    raisedBy:    raisedByOptions,
  }), [projectOptions, clientNameOptions, categoryOptions, milestoneOptions, raisedByOptions])

  /* ── Client-side filter (category, raisedBy, freetext) ── */
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
    if (!retainerGroups.length) { setSelectedRetainer(''); return }
    if (!selectedRetainer || !retainerGroups.some(g => g.project === selectedRetainer)) {
      setSelectedRetainer(retainerGroups[0].project)
    }
  }, [retainerGroups, selectedRetainer])

  const selectedRetainerGroup = retainerGroups.find(g => g.project === selectedRetainer) || null

  const todayIso = new Date().toISOString().slice(0, 10)

  const scopedRecords = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase()
    return allRecords.filter((r) => {
      const f = r.fields || {}
      // Server-side filters moved client-side (API now fetches all records)
      if (statusFilter && f['Payment Status'] !== statusFilter) return false
      if (projectFilter && f['Project'] !== projectFilter) return false
      if (clientFilter && (f['Client Name'] || f['Client']) !== clientFilter) return false
      if (billingFilter === 'retainer' && !isRetainerCategory(f['Category'])) return false
      if (billingFilter === 'project' && isRetainerCategory(f['Category'])) return false
      if (categoryFilter && f['Category'] !== categoryFilter) return false
      if (raisedByFilter && f['Raised By'] !== raisedByFilter) return false
      if (monthFilter && monthKey(f['Raised Date']) !== monthFilter) return false
      if (dateFrom || dateTo) {
        const candidate = dateOnlyValue(f[dateFieldFilter])
        if (!candidate) return false
        if (dateFrom && candidate < dateFrom) return false
        if (dateTo && candidate > dateTo) return false
      }
      if (overdueOnly && !(f['Payment Status'] === 'Pending' || Number(f['Outstanding Amount'] || 0) > 0)) return false
      if (followupDueOnly) {
        const raw = f['Next followup']
        if (!raw) return false
        const nextFollowup = String(raw).slice(0, 10)
        if (nextFollowup > todayIso) return false
      }
      if (hasDocsOnly) {
        const refs = parseAttachments(f['Reference'])
        const pdfs = parseAttachments(f['Invoice PDF'])
        if (refs.length + pdfs.length === 0) return false
      }
      if (agingBandFilter) {
        if (f['Payment Status'] !== 'Pending') return false
        const band = classifyAgingBand(effectiveAging(f))
        if (band !== agingBandFilter) return false
      }
      if (!q) return true
      return (
        (f['Invoice Number'] || '').toLowerCase().includes(q) ||
        (f['Client Name']    || '').toLowerCase().includes(q) ||
        (f['Client']         || '').toLowerCase().includes(q) ||
        (f['Project']        || '').toLowerCase().includes(q) ||
        (f['Description']    || '').toLowerCase().includes(q) ||
        (f['Category']       || '').toLowerCase().includes(q) ||
        (f['Milestone']      || '').toLowerCase().includes(q)
      )
    })
  }, [
    allRecords,
    agingBandFilter,
    billingFilter,
    categoryFilter,
    clientFilter,
    dateFieldFilter,
    dateFrom,
    dateTo,
    deferredSearch,
    followupDueOnly,
    hasDocsOnly,
    monthFilter,
    overdueOnly,
    projectFilter,
    raisedByFilter,
    statusFilter,
    todayIso,
  ])

  const records = useMemo(
    () => applyConditions(scopedRecords, filterConditions, r => r.fields ?? {}),
    [filterConditions, scopedRecords]
  )

  const s = summary
  const agingBuckets = useMemo(() => {
    const buckets = { '0-14d': 0, '15-30d': 0, '31-60d': 0, '60d+': 0 }
    for (const r of scopedRecords) {
      const f = r.fields || {}
      if (f['Payment Status'] !== 'Pending') continue
      buckets[classifyAgingBand(effectiveAging(f))] += 1
    }
    return buckets
  }, [scopedRecords])
  const overdue = s?.overdue_invoices || []
  const activeConditions = filterConditions.filter(c => c.field && c.op && (c.value !== '' || ['is_empty','is_not_empty'].includes(c.op)))
  const hasFilters = statusFilter || projectFilter || clientFilter || categoryFilter || raisedByFilter || billingFilter !== 'all' || monthFilter || agingBandFilter || dateFrom || dateTo || overdueOnly || hasDocsOnly || followupDueOnly || search || activeConditions.length > 0

  const clearAllFilters = useCallback(() => {
    setStatusFilter('')
    updateFilterParam('status', '')
    setProjectFilter('')
    updateFilterParam('project', '')
    setClientFilter('')
    updateFilterParam('client', '')
    setCategoryFilter('')
    setRaisedByFilter('')
    setMonthFilter('')
    setDateFieldFilter('Raised Date')
    setDateFrom('')
    setDateTo('')
    setAgingBandFilter('')
    setBillingFilter('all')
    setOverdueOnly(false)
    setHasDocsOnly(false)
    setFollowupDueOnly(false)
    setSearch('')
    setFilterConditions([])
  }, [updateFilterParam])

  const activeFilterChips = useMemo(() => {
    const chips = []
    if (search) chips.push({ key: 'search', label: `Search: ${search}`, onClear: () => setSearch('') })
    if (statusFilter) chips.push({ key: 'status', label: `Status: ${statusFilter}`, onClear: () => { setStatusFilter(''); updateFilterParam('status', '') } })
    if (projectFilter) chips.push({ key: 'project', label: `Project: ${projectFilter}`, onClear: () => { setProjectFilter(''); updateFilterParam('project', '') } })
    if (clientFilter) chips.push({ key: 'client', label: `Client: ${clientFilter}`, onClear: () => { setClientFilter(''); updateFilterParam('client', '') } })
    if (categoryFilter) chips.push({ key: 'category', label: `Category: ${categoryFilter}`, onClear: () => setCategoryFilter('') })
    if (raisedByFilter) chips.push({ key: 'raised_by', label: `Owner: ${raisedByFilter}`, onClear: () => setRaisedByFilter('') })
    if (billingFilter !== 'all') chips.push({ key: 'billing', label: `Billing: ${billingFilter === 'retainer' ? 'Retainers' : 'Projects'}`, onClear: () => setBillingFilter('all') })
    if (monthFilter) chips.push({ key: 'month', label: `Raised: ${monthLabel(monthFilter)}`, onClear: () => setMonthFilter('') })
    if (dateFrom || dateTo) chips.push({ key: 'date', label: `${dateFieldFilter}: ${dateFrom || 'Start'} to ${dateTo || 'Today'}`, onClear: () => { setDateFrom(''); setDateTo(''); setDateFieldFilter('Raised Date') } })
    if (agingBandFilter) chips.push({ key: 'aging', label: `Aging: ${agingBandFilter}`, onClear: () => setAgingBandFilter('') })
    if (overdueOnly) chips.push({ key: 'overdue', label: 'Open collections', onClear: () => setOverdueOnly(false) })
    if (hasDocsOnly) chips.push({ key: 'docs', label: 'Has documents', onClear: () => setHasDocsOnly(false) })
    if (followupDueOnly) chips.push({ key: 'followup', label: 'Follow-up due', onClear: () => setFollowupDueOnly(false) })
    if (activeConditions.length) chips.push({ key: 'advanced', label: `${activeConditions.length} advanced rule${activeConditions.length !== 1 ? 's' : ''}`, onClear: () => setFilterConditions([]) })
    return chips
  }, [
    activeConditions.length,
    agingBandFilter,
    billingFilter,
    categoryFilter,
    clientFilter,
    dateFieldFilter,
    dateFrom,
    dateTo,
    followupDueOnly,
    hasDocsOnly,
    monthFilter,
    overdueOnly,
    projectFilter,
    raisedByFilter,
    search,
    statusFilter,
    updateFilterParam,
  ])

  const projectSummaryCards = useMemo(() => {
    const entries = Object.entries(s?.by_project || {})
      .sort(([, a], [, b]) => (b?.count || 0) - (a?.count || 0))
      .slice(0, 8)
    return entries.map(([project, metrics]) => ({ project, metrics }))
  }, [s])
  const raisedTimeline = useMemo(() => {
    const buckets = new Map()
    for (const record of scopedRecords) {
      const key = monthKey(record.fields?.['Raised Date'])
      if (!key) continue
      const current = buckets.get(key) || { key, count: 0, amount: 0 }
      current.count += 1
      current.amount += Number(record.fields?.['Amount Raised'] || 0)
      buckets.set(key, current)
    }
    return [...buckets.values()].sort((a, b) => b.key.localeCompare(a.key)).slice(0, 6)
  }, [scopedRecords])
  const clearedTimeline = useMemo(() => {
    const buckets = new Map()
    for (const record of scopedRecords) {
      const key = monthKey(record.fields?.['Cleared Date'])
      if (!key) continue
      const current = buckets.get(key) || { key, count: 0, amount: 0 }
      current.count += 1
      current.amount += Number(record.fields?.['Amount Received'] || record.fields?.['Amount Raised'] || 0)
      buckets.set(key, current)
    }
    return [...buckets.values()].sort((a, b) => b.key.localeCompare(a.key)).slice(0, 6)
  }, [scopedRecords])
  const lastThreeMonthBalance = useMemo(() => {
    const current = currentMonthKey()
    const keys = [shiftMonthKey(current, -2), shiftMonthKey(current, -1), current]
    // Use allRecords (not scopedRecords) so this widget always shows complete
    // monthly totals regardless of any status/project/category filter the user
    // has active on the table view.
    return keys.map((key, index) => {
      let base = 0
      let gross = 0
      let gst = 0
      let received = 0
      let deduction = 0
      let outstanding = 0
      let invoiceCount = 0
      for (const record of allRecords) {
        const fields = record.fields || {}
        if (monthKey(fields['Raised Date']) === key) {
          const parts = invoiceAmountParts(fields)
          base += parts.base
          gross += parts.gross
          gst += parts.gst
          received += parts.received
          deduction += parts.deduction
          outstanding += parts.outstanding
          invoiceCount += 1
        }
      }
      const previous = index > 0 ? keys[index - 1] : ''
      let previousGross = 0
      if (previous) {
        for (const record of allRecords) {
          const fields = record.fields || {}
          if (monthKey(fields['Raised Date']) === previous) previousGross += invoiceAmountParts(fields).gross
        }
      }
      const change = previous && previousGross
        ? ((gross - previousGross) / Math.abs(previousGross)) * 100
        : null
      const collectionRate = gross > 0 ? Math.min(100, Math.max(0, (received / gross) * 100)) : 0
      return { key, label: shortMonthLabel(key), base, gross, gst, received, deduction, outstanding, invoiceCount, collectionRate, change }
    })
  }, [allRecords])
  const maxMonthlyBalanceMagnitude = useMemo(
    () => Math.max(1, ...lastThreeMonthBalance.map((entry) => entry.gross)),
    [lastThreeMonthBalance]
  )
  const recentProjectCards = useMemo(() => {
    // Use allRecords so "Recent Projects" always shows all-time project totals
    // regardless of any status/date/category filter active on the table.
    const buckets = new Map()
    for (const record of allRecords) {
      const fields = record.fields || {}
      const project = fields.Project || 'Unassigned'
      const current = buckets.get(project) || { project, base: 0, gross: 0, gst: 0, received: 0, deduction: 0, outstanding: 0, count: 0 }
      const parts = invoiceAmountParts(fields)
      current.base += parts.base
      current.gross += parts.gross
      current.gst += parts.gst
      current.received += parts.received
      current.deduction += parts.deduction
      current.outstanding += parts.outstanding
      current.count += 1
      buckets.set(project, current)
    }
    return [...buckets.values()]
      .map((entry) => ({
        ...entry,
        progress: entry.gross > 0 ? Math.max(0, Math.min(100, Math.round((entry.received / entry.gross) * 100))) : 0,
      }))
      .sort((a, b) => (b.outstanding - a.outstanding) || (b.gross - a.gross))
      .slice(0, 4)
  }, [allRecords])
  const followupsDueCount = useMemo(
    () => records.filter((r) => {
      const raw = r.fields?.['Next followup']
      return raw && String(raw).slice(0, 10) <= todayIso
    }).length,
    [records, todayIso]
  )
  const missingDocsCount = useMemo(
    () => records.filter((r) => parseAttachments(r.fields?.['Reference']).length + parseAttachments(r.fields?.['Invoice PDF']).length === 0).length,
    [records]
  )
  const pendingCount = s?.by_status?.Pending || 0
  const currentScopeOutstanding = useMemo(
    () => records.reduce((sum, r) => sum + Number(r.fields?.['Outstanding Amount'] || 0), 0),
    [records]
  )
  const applyMonthDrilldown = useCallback((field, key) => {
    setDateFieldFilter(field)
    setDateFrom(`${key}-01`)
    setDateTo(endOfMonthIso(key))
    setMonthFilter(field === 'Raised Date' ? key : '')
  }, [])

  const shareTitle = useMemo(() => {
    const parts = ['Invoices']
    if (projectFilter) parts.push(projectFilter)
    if (clientFilter) parts.push(clientFilter)
    if (statusFilter) parts.push(statusFilter)
    if (categoryFilter) parts.push(categoryFilter)
    if (!projectFilter && !clientFilter && !statusFilter && !categoryFilter) parts.push('Current View')
    return parts.join(' · ')
  }, [projectFilter, clientFilter, statusFilter, categoryFilter])

  const sharedViewConfig = useMemo(() => ({
    type: 'list',
    filterClient: clientFilter || '',
    filterProject: projectFilter || '',
    filterCategory: categoryFilter || '',
    filterStatus: statusFilter || '',
    raisedByFilter: raisedByFilter || '',
    billingFilter,
    monthFilter: monthFilter || '',
    dateFieldFilter,
    dateFrom: dateFrom || '',
    dateTo: dateTo || '',
    agingBandFilter: agingBandFilter || '',
    overdueOnly,
    hasDocsOnly,
    followupDueOnly,
    search,
    columns: INVOICE_SHARE_COLUMNS,
  }), [
    agingBandFilter,
    billingFilter,
    categoryFilter,
    clientFilter,
    dateFieldFilter,
    dateFrom,
    dateTo,
    followupDueOnly,
    hasDocsOnly,
    monthFilter,
    overdueOnly,
    projectFilter,
    raisedByFilter,
    search,
    statusFilter,
  ])

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
      const retainerCat = categoryOptions.find(c => /retainer/i.test(c)) || base['Category'] || 'Development- Retainer'
      const payload = {
        invoice_number: '',
        project: group.project,
        category: base['Category'] || retainerCat,
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
          : `Recurring retainer for ${monthName}. Invoice number to be updated.`,
      }
      await api.invoices.create(payload)
      toast(isPause ? `Paused ${group.project} for ${monthName}` : `Created ${monthName} retainer for ${group.project}`, 'success')
      refresh()
    } catch (e) {
      toast(e.message || 'Failed to create retainer month', 'error')
    } finally {
      setRetainerActionBusy('')
    }
  }

  function openInvoiceRequestForm(group, monthKeyValue) {
    window.open(INVOICE_REQUEST_FORM_URL, '_blank', 'noopener,noreferrer')
  }

  function openRetainerRecordForm(group, monthKeyValue) {
    const base = group?.latestActive?.fields || {}
    const label = monthLabel(monthKeyValue)
    const retainerCat = categoryOptions.find(c => /retainer/i.test(c)) || base['Category'] || 'Development- Retainer'
    setDrawer({
      mode: 'new',
      invoice: null,
      prefill: {
        invoice_number: '',
        project: group.project,
        category: base['Category'] || retainerCat,
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
      },
    })
  }

  /* ── Helpers ── */
  const openNew     = () => setDrawer({ mode: 'new',  invoice: null })
  const openView    = r  => setDrawer({ mode: 'view', invoice: r   })

  // Open new drawer when navigated here with ?new=1 (works even if already on /invoices)
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setDrawer({ mode: 'new', invoice: null })
      const next = new URLSearchParams(searchParams)
      next.delete('new')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps
  const openRecordPayment = r => setDrawer({
    mode: 'payment',
    invoice: r,
    prefill: {
      payment_status: 'Paid',
      amount_received: r?.fields?.['Amount Raised'] ?? '',
      cleared_date: new Date().toISOString().slice(0, 10),
      reference: Array.isArray(r?.fields?.['Reference']) ? r.fields['Reference'] : [],
      remark: r?.fields?.['Remark'] || '',
    },
  })
  const closeDrawer = () => setDrawer(null)
  const handleSaved = (savedRecord) => {
    if (savedRecord?.id) {
      setRecordsState((prev) => {
        const idx = prev.findIndex((row) => row.id === savedRecord.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = savedRecord
          return next
        }
        return [savedRecord, ...prev]
      })
    }
    refresh()
    closeDrawer()
  }
  const handleDeleted = (deletedId) => {
    if (deletedId) setRecordsState((prev) => prev.filter((row) => row.id !== deletedId))
    refresh()
    closeDrawer()
  }

  useEffect(() => () => {
    if (resizeRef.current?.stop) resizeRef.current.stop()
  }, [])

  const startColumnResize = useCallback((key, event) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = columnWidths[key] || DEFAULT_INVOICE_COLUMN_WIDTHS[key] || 120
    const minWidth = key === 'project' ? 220 : key === 'actions' ? 120 : 90
    const onMove = (moveEvent) => {
      const nextWidth = Math.max(minWidth, startWidth + (moveEvent.clientX - startX))
      setColumnWidths((prev) => ({ ...prev, [key]: nextWidth }))
    }
    const stop = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', stop)
      resizeRef.current = null
    }
    resizeRef.current = { stop }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', stop)
  }, [columnWidths])

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  // Inline sort-label used inside <th className="tbl-head">
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
    <ExecutiveShell className="invoice-workspace">

      <ExecutiveHero
        eyebrow="Receivables Command Deck"
        title="Invoices"
        description="Operate collections, aging, retainer billing, and project context from a denser finance workspace."
        icon={Receipt}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <ExecutiveChip accent>{allRecords.length} live invoice{allRecords.length !== 1 ? 's' : ''}</ExecutiveChip>
            <ExecutiveChip>{syncing ? 'syncing…' : 'mirror-fast · Teable-backed'}</ExecutiveChip>
            {hasFilters && <ExecutiveChip>{records.length} in current scope</ExecutiveChip>}
          </div>
        }
        actions={
          <>
            {isEditor && workspace === 'invoices' && (
              <>
                <button onClick={() => setShareModal(true)} className="btn-ghost"><ExternalLink size={14} />Share View</button>
                <button onClick={() => setManageModal(true)} className="btn-ghost"><Eye size={14} />Links</button>
              </>
            )}
            <button onClick={() => window.open(INVOICE_REQUEST_FORM_URL, '_blank', 'noopener,noreferrer')} className="btn-ghost">
              <ExternalLink size={14} />Raise Externally
            </button>
            <button onClick={refresh} disabled={loading} aria-label="Refresh" className="btn-ghost">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Refresh
            </button>
            {isEditor && (
              <button onClick={openNew} className="btn-primary"><Plus size={14} />New Invoice</button>
            )}
          </>
        }
      >
        <ExecutiveStatGrid className="mt-5">
          <ExecutiveStatCard label="Total raised" value={sumLoading && !s ? '—' : fmt(s?.total_raised)} icon={IndianRupee} />
          <ExecutiveStatCard label="Incl. GST" value={sumLoading && !s ? '—' : fmt(s?.total_with_tax)} icon={Receipt} />
          <ExecutiveStatCard label="Collected" value={sumLoading && !s ? '—' : fmt(s?.total_received)} sub={s ? `${s?.by_status?.Paid || 0} paid invoices` : ''} accent="positive" icon={TrendingUp} />
          <ExecutiveStatCard label="Outstanding" value={sumLoading && !s ? '—' : fmt(s?.total_outstanding)} sub={`${s?.by_status?.Pending || 0} pending invoices`} accent={(s?.total_outstanding || 0) > 0 ? 'warning' : 'positive'} icon={CalendarClock} />
          <ExecutiveStatCard
            label="Collection rate"
            value={sumLoading && !s ? '—' : s ? `${(s.collection_rate ?? 0).toFixed(1)}%` : '—'}
            sub={s ? `${s?.active_invoices || 0} active invoices in scope` : ''}
            accent={(s?.collection_rate || 0) >= 90 ? 'positive' : (s?.collection_rate || 0) >= 70 ? 'warning' : 'negative'}
            icon={Percent}
          />
        </ExecutiveStatGrid>
      </ExecutiveHero>

      {/* ── Invoice activity chart ── */}
      {allRecords.length > 0 && (
        <div className="card overflow-hidden" style={{ padding: 0 }}>
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <div>
              <p className="text-sm font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.01em' }}>Invoice activity · last 60 days</p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                Cumulative billing · bar height = amount ·&nbsp;
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#22c55e' }} />paid&nbsp;
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#fb7185' }} />overdue&nbsp;
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#94a3b8' }} />pending
                </span>
              </p>
            </div>
          </div>
          <InvoiceActivityChart records={allRecords} days={60} className="px-2 pb-1" />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.3fr)_340px] gap-4">
        <ExecutivePanel
          title="Workspace controls"
          subtitle="Switch billing mode, tighten the scope, and keep the current receivables picture focused on real collections work."
        >
          <ExecutiveFilterBar className="mb-3">
            <div className="inline-flex items-center p-1 rounded-lg" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
              {[['invoices', 'Invoices'], ['retainers', 'Retainers']].map(([value, label]) => (
                <button key={value} onClick={() => setWorkspace(value)}
                  className="text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
                  style={workspace === value
                    ? { background: 'var(--card-bg)', color: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }
                    : { color: 'var(--text-3)' }}>
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                setWorkspace('invoices')
                setFollowupDueOnly(true)
                setOverdueOnly(false)
                setAgingBandFilter('')
              }}
              className="btn-ghost"
              style={{ fontSize: '0.75rem', padding: '0.45rem 0.7rem', borderColor: followupDueOnly ? 'var(--accent)' : undefined }}
            >
              <CalendarDays size={12} />Follow-ups due
            </button>
            <button
              onClick={() => {
                setWorkspace('invoices')
                setOverdueOnly(true)
                setFollowupDueOnly(false)
                setAgingBandFilter('31-60d')
              }}
              className="btn-ghost"
              style={{ fontSize: '0.75rem', padding: '0.45rem 0.7rem', borderColor: overdueOnly || agingBandFilter ? 'var(--accent)' : undefined }}
            >
              <AlertTriangle size={12} />Collections pressure
            </button>
            <button
              onClick={() => {
                setWorkspace('invoices')
                setHasDocsOnly(true)
              }}
              className="btn-ghost"
              style={{ fontSize: '0.75rem', padding: '0.45rem 0.7rem', borderColor: hasDocsOnly ? 'var(--accent)' : undefined }}
            >
              <FileText size={12} />Docs attached
            </button>
          </ExecutiveFilterBar>
          <div className="rounded-2xl p-4" style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)' }}>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="label">Open in scope</p>
                <p className="text-lg font-bold tabular-nums" style={{ color: 'var(--fin-warning)' }}>{fmt(currentScopeOutstanding)}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{pendingCount} pending invoices currently visible</p>
              </div>
              <div>
                <p className="label">Follow-up load</p>
                <p className="text-lg font-bold tabular-nums" style={{ color: followupsDueCount ? 'var(--fin-warning)' : 'var(--fin-positive)' }}>{followupsDueCount}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Due today or already overdue</p>
              </div>
              <div>
                <p className="label">Missing proof/docs</p>
                <p className="text-lg font-bold tabular-nums" style={{ color: missingDocsCount ? 'var(--fin-negative)' : 'var(--fin-positive)' }}>{missingDocsCount}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Invoices without PDF or payment reference</p>
              </div>
            </div>
          </div>
        </ExecutivePanel>

        <ExecutivePanel title="Aging buckets" subtitle="Quick receivables heat map for the current invoice scope.">
          <div className="space-y-2">
            {Object.entries(agingBuckets).map(([label, value]) => {
              const active = agingBandFilter === label
              const accent = label === '60d+' ? 'negative' : label === '31-60d' ? 'warning' : undefined
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setAgingBandFilter(active ? '' : label)}
                  className="w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-all"
                  style={{
                    background: active ? 'var(--accent-dim)' : 'var(--bg-input)',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--card-border)'}`,
                    boxShadow: active ? '0 0 0 2px rgba(37,99,235,0.08)' : 'none',
                  }}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>{label}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Pending invoices</p>
                  </div>
                  <span className={clsx('text-sm font-bold tabular-nums', accent === 'warning' && 'executive-stat-warning', accent === 'negative' && 'executive-stat-negative')} style={{ color: accent ? undefined : 'var(--text-1)' }}>
                    {value}
                  </span>
                </button>
              )
            })}
          </div>
        </ExecutivePanel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ExecutivePanel
          title="Raised by month"
          subtitle="Click a month to drill the workspace into invoices raised in that exact month-year."
          action={<ExecutiveChip accent>{raisedTimeline.length} month{raisedTimeline.length !== 1 ? 's' : ''}</ExecutiveChip>}
        >
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {raisedTimeline.length === 0 ? (
              <div className="rounded-xl px-3 py-3 text-xs" style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)', color: 'var(--text-3)' }}>
                No raised-date distribution is available in the current scope.
              </div>
            ) : raisedTimeline.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => applyMonthDrilldown('Raised Date', entry.key)}
                className="rounded-2xl p-3 text-left transition-all"
                style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)' }}
              >
                <p className="label">{monthLabel(entry.key)}</p>
                <p className="text-base font-bold mt-2 tabular-nums" style={{ color: 'var(--text-1)' }}>{fmt(entry.amount)}</p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>{entry.count} raised invoice{entry.count !== 1 ? 's' : ''}</p>
              </button>
            ))}
          </div>
        </ExecutivePanel>

        <ExecutivePanel
          title="Cleared by month"
          subtitle="Click a month to isolate invoices cleared in that month-year and inspect actual collections."
          action={<ExecutiveChip accent>{clearedTimeline.length} month{clearedTimeline.length !== 1 ? 's' : ''}</ExecutiveChip>}
        >
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {clearedTimeline.length === 0 ? (
              <div className="rounded-xl px-3 py-3 text-xs" style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)', color: 'var(--text-3)' }}>
                No cleared-date distribution is available in the current scope.
              </div>
            ) : clearedTimeline.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => applyMonthDrilldown('Cleared Date', entry.key)}
                className="rounded-2xl p-3 text-left transition-all"
                style={{ background: 'var(--bg-layer)', border: '1px solid var(--card-border)' }}
              >
                <p className="label">{monthLabel(entry.key)}</p>
                <p className="text-base font-bold mt-2 tabular-nums" style={{ color: 'var(--fin-positive)' }}>{fmt(entry.amount)}</p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>{entry.count} cleared invoice{entry.count !== 1 ? 's' : ''}</p>
              </button>
            ))}
          </div>
        </ExecutivePanel>
      </div>

      {workspace === 'invoices' && (
        <div className="invoice-runey-widgets">
          <section className="invoice-runey-card invoice-month-balance-card" aria-label="Last 3 months invoice balance">
            <div>
              <h2>Last 3 Months</h2>
              <p>GST-aware receivables</p>
            </div>
            <div className="invoice-month-bars">
              {lastThreeMonthBalance.map((entry) => {
                const height = Math.max(12, Math.round((entry.gross / maxMonthlyBalanceMagnitude) * 112))
                const isSettled = entry.outstanding <= 0 && entry.gross > 0
                return (
                  <button
                    key={entry.key}
                    type="button"
                    className="invoice-month-bar-item"
                    onClick={() => applyMonthDrilldown('Raised Date', entry.key)}
                    title={`Filter raised invoices for ${monthLabel(entry.key)}`}
                  >
                    <span className="invoice-month-bar-wrap" aria-hidden="true">
                      <span
                        className={clsx('invoice-month-bar', isSettled ? 'is-positive' : 'is-negative')}
                        style={{
                          height: `${height}px`,
                          width: entry.invoiceCount > 1 ? '4.8rem' : '3.6rem',
                        }}
                      />
                    </span>
                    <span className="invoice-month-label">{entry.label}</span>
                    <strong className="invoice-month-value">{entry.gross === 0 ? '-' : fmt(entry.gross)}</strong>
                    <small className="invoice-month-subvalue">
                      {entry.received > 0 ? `${fmt(entry.received)} received` : `${fmt(entry.base)} raised`}
                    </small>
                    <span className="invoice-month-mini-grid">
                      <span>GST {fmt(entry.gst)}</span>
                      <span>Open {fmt(entry.outstanding)}</span>
                      <span>TDS {fmt(entry.deduction)}</span>
                    </span>
                    <em className={clsx('invoice-month-change', entry.change == null ? 'is-neutral' : entry.change >= 0 ? 'is-up' : 'is-down')}>
                      {entry.change == null ? `${entry.collectionRate.toFixed(0)}% collected` : `${entry.change >= 0 ? 'up' : 'down'} ${Math.abs(entry.change).toFixed(0)}%`}
                    </em>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="invoice-runey-card invoice-recent-projects-card" aria-label="Recent invoice projects">
            <div className="invoice-runey-card-head">
              <div>
                <h2>Recent Projects</h2>
                <p>Active invoice pressure</p>
              </div>
              {projectFilter && (
                <button
                  type="button"
                  onClick={() => { setProjectFilter(''); updateFilterParam('project', '') }}
                >
                  View all -&gt;
                </button>
              )}
            </div>
            <div className="invoice-recent-project-list">
              {recentProjectCards.length === 0 ? (
                <p className="invoice-runey-empty">No project invoice movement in this scope.</p>
              ) : recentProjectCards.map((entry) => {
                const active = projectFilter === entry.project
                return (
                  <button
                    key={entry.project}
                    type="button"
                    className={clsx('invoice-recent-project-row', active && 'is-active')}
                    onClick={() => {
                      const next = active ? '' : entry.project
                      setProjectFilter(next)
                      updateFilterParam('project', next)
                    }}
                  >
                    <span className="invoice-project-avatar">{projectInitials(entry.project)}</span>
                    <span className="invoice-project-meta">
                      <strong>{entry.project}</strong>
                      <small>{entry.count} invoice{entry.count === 1 ? '' : 's'} | {fmt(entry.outstanding)} open | {fmt(entry.deduction)} TDS</small>
                    </span>
                    <span className="invoice-project-progress" aria-hidden="true">
                      <span style={{ width: `${entry.progress}%` }} />
                    </span>
                    <span className="invoice-project-amount">{fmt(entry.gross)}</span>
                    <span className="invoice-project-percent">{entry.progress}%</span>
                  </button>
                )
              })}
            </div>
          </section>
        </div>
      )}

      {/* ── Status chips — click to filter, shows count + total amount ── */}
      {s?.by_status && Object.keys(s.by_status).length > 0 && (
        <section className="status-card-grid">
          {Object.entries(s.by_status).map(([status, count]) => {
            const m = STATUS_META[status] || { color: 'var(--text-2)', bg: 'var(--fin-pos-bg)', border: 'var(--fin-pos-border)', icon: CheckCircle2 }
            const Icon = m.icon
            const active = statusFilter === status
            const amount = s?.by_status_amounts?.[status]
            return (
              <button key={status}
                onClick={() => {
                  const next = active ? '' : status
                  setStatusFilter(next)
                  updateFilterParam('status', next)
                }}
                className="card flex items-center gap-4 p-4 cursor-pointer text-left transition-all"
                style={{
                  borderColor: active ? m.color : 'var(--card-border)',
                  background: active ? `${m.color}10` : 'var(--card-bg)',
                  boxShadow: active ? `0 0 0 2px ${m.color}30, var(--card-shadow)` : 'var(--card-shadow)',
                }}
                aria-pressed={active}>
                {/* Icon tile */}
                <div className="kpi-icon flex-shrink-0"
                  style={{ background: `${m.color}18` }}>
                  {Icon && <Icon size={18} style={{ color: m.color }} />}
                </div>
                {/* Text */}
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>{status}</p>
                  <p className="font-bold text-2xl tabular-nums leading-none" style={{ color: m.color }}>{count}</p>
                  {amount != null && (
                    <p className="text-[11px] tabular-nums mt-1 font-medium" style={{ color: 'var(--text-2)' }}>
                      {fmt(amount)}
                    </p>
                  )}
                </div>
                {/* Active indicator */}
                {active && (
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: m.color }} />
                )}
              </button>
            )
          })}
        </section>
      )}

      {/* ── Overdue alert ── */}
      {overdue.length > 0 && (
        <section className="rounded-2xl p-4 animate-slide-down"
          style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.16)' }}>
          <div className="flex items-center gap-2 mb-3">
            <AlertOctagon size={14} style={{ color: '#f87171' }} />
            <p className="text-sm font-semibold" style={{ color: '#f87171' }}>
              {overdue.length} Pending Invoice{overdue.length !== 1 ? 's' : ''} Awaiting Collection
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
                  <AgingBadge days={inv.aging} status="Pending" />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Retainer Workspace ── */}
      {workspace === 'retainers' && (
        <section className="card space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.02em' }}>Retainer Workspace</h2>
              <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
                <strong style={{ color: 'var(--text-1)' }}>Raise externally.</strong> Use the Zoho invoice request form when a retainer invoice needs to be raised.
                {' '}
                <strong style={{ color: 'var(--text-1)' }}>Record internally.</strong> Once raised, store the final invoice number and details here.
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
                Create a normal invoice and set the category to a retainer category first.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-[300px_minmax(0,1fr)] gap-4">
              <div className="space-y-3">
                {retainerGroups.map(group => (
                  <button key={group.project} type="button"
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
                      {[
                        ['Tracking month', monthLabel(retainerMonth)],
                        ['Month invoice #', monthRec?.['Invoice Number'] || 'Pending update'],
                        ['Raised by', group.raisedBy || '—'],
                        ['Month remark', monthRec?.['Remark'] || '—'],
                      ].map(([lbl, val]) => (
                        <div key={lbl} className="card p-3">
                          <p className="label">{lbl}</p>
                          <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{val}</p>
                        </div>
                      ))}
                    </div>

                    <div>
                      <p className="label mb-2">Month Timeline</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2">
                        {group.timeline.map(item => (
                          <button key={item.key} type="button"
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
                      <p className="label mb-2">Monthly Records</p>
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
                              <div className="flex gap-2 flex-shrink-0 flex-wrap">
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
      {/* ── Project Snapshot ── */}
      {projectSummaryCards.length > 0 && (
        <ExecutivePanel title="Project billing" subtitle="Project cards behave as filters and surface raised, received, and open value at a glance.">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Project Snapshot</h2>
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Click any project card to filter the invoice list.</p>
            </div>
            {projectFilter && (
              <button onClick={() => { setProjectFilter(''); updateFilterParam('project', '') }}
                className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.625rem' }}>
                <X size={11} />Clear project filter
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {projectSummaryCards.map(({ project, metrics }) => {
              const active = projectFilter === project
              return (
                <button key={project} type="button"
                  onClick={() => {
                    const next = active ? '' : project
                    setProjectFilter(next)
                    updateFilterParam('project', next)
                  }}
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
                  <div className="grid grid-cols-3 sm:grid-cols-3 gap-2 mt-4">
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
        </ExecutivePanel>
      )}

      {/* ── Filter bar ── */}
      <ExecutivePanel title="Filters and search" subtitle="Owner, overdue band, month, category, docs, and advanced rules follow one unified filter pattern.">
        <div className="space-y-2">
        <ExecutiveFilterBar className="executive-filter-bar-toolbar">
          <div className="executive-search relative flex-1 min-w-[140px] sm:min-w-[220px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-3)' }} />
            <input value={search} onChange={e => {
              setSearch(e.target.value)
            }}
              placeholder="Search invoice #, project, description…"
              className="input pl-8 py-1.5 text-xs"
              style={{ background: 'transparent', border: 'none', color: 'var(--text-1)' }} />
          </div>
          <button onClick={() => setShowFilters(f => !f)} aria-expanded={showFilters}
            className={clsx('btn-icon flex items-center justify-center gap-1.5 px-3', showFilters && 'border-opacity-60')}
            style={{ borderColor: hasFilters ? 'var(--accent)' : undefined }}>
            <Filter size={13} />
            <span className="text-xs">Filters</span>
            {hasFilters && <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)' }} />}
          </button>
          {hasFilters && (
            <button onClick={clearAllFilters}
              className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.375rem 0.625rem' }}>
              <X size={11} />Clear
            </button>
          )}
          <ExecutiveChip accent>{records.length} result{records.length !== 1 ? 's' : ''}</ExecutiveChip>
        </ExecutiveFilterBar>

        {activeFilterChips.length > 0 && (
          <div className="invoice-active-filters" aria-label="Active invoice filters">
            {activeFilterChips.map(chip => (
              <button
                key={chip.key}
                type="button"
                onClick={chip.onClear}
                className="invoice-filter-chip"
                title={`Remove ${chip.label}`}
              >
                <span>{chip.label}</span>
                <X size={11} />
              </button>
            ))}
          </div>
        )}

        <div className="invoice-scope-strip" aria-label="Current invoice scope">
          <div>
            <span>Scope</span>
            <strong>{records.length}</strong>
            <small>of {allRecords.length} invoices</small>
          </div>
          <div>
            <span>Open</span>
            <strong style={{ color: currentScopeOutstanding ? 'var(--fin-warning)' : 'var(--fin-positive)' }}>{fmt(currentScopeOutstanding)}</strong>
            <small>{records.filter(r => r.fields?.['Payment Status'] === 'Pending').length} pending</small>
          </div>
          <div>
            <span>Due follow-up</span>
            <strong style={{ color: followupsDueCount ? 'var(--fin-warning)' : 'var(--fin-positive)' }}>{followupsDueCount}</strong>
            <small>today or overdue</small>
          </div>
          <div>
            <span>Missing docs</span>
            <strong style={{ color: missingDocsCount ? 'var(--fin-negative)' : 'var(--fin-positive)' }}>{missingDocsCount}</strong>
            <small>needs proof</small>
          </div>
        </div>

        {showFilters && (
          <div className="filter-expanded-panel flex flex-wrap gap-2 animate-slide-down">
            {/* Billing type */}
            <div className="inline-flex items-center p-0.5 rounded-lg" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
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
            {/* Project — server-side */}
            <FilterSelect
              value={clientFilter}
              onChange={(value) => {
                setClientFilter(value)
                updateFilterParam('client', value)
              }}
              options={clientNameOptions}
              placeholder="All clients"
              icon={User}
              width={150}
            />
            <FilterSelect
              value={projectFilter}
              onChange={(value) => {
                setProjectFilter(value)
                updateFilterParam('project', value)
              }}
              options={projectOptions}
              placeholder="All projects"
              icon={User}
              width={150}
            />
            <FilterSelect
              value={monthFilter}
              onChange={setMonthFilter}
              options={monthOptions.map(m => ({ value: m, label: monthLabel(m) }))}
              placeholder="All months"
              icon={CalendarDays}
              width={150}
            />
            <FilterSelect
              value={dateFieldFilter}
              onChange={setDateFieldFilter}
              options={[
                { value: 'Raised Date', label: 'Raised Date' },
                { value: 'Cleared Date', label: 'Cleared Date' },
                { value: 'Next followup', label: 'Next Follow-up' },
              ]}
              placeholder="Date field"
              icon={CalendarDays}
              width={160}
              clearable={false}
            />
            <div className="inline-flex items-center gap-2 rounded-xl px-2.5 py-1.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="bg-transparent text-xs outline-none min-w-[124px]" style={{ color: 'var(--text-2)' }} />
              <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>to</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="bg-transparent text-xs outline-none min-w-[124px]" style={{ color: 'var(--text-2)' }} />
            </div>
            <FilterSelect
              value={agingBandFilter}
              onChange={setAgingBandFilter}
              options={Object.keys(agingBuckets).map(bucket => ({ value: bucket, label: bucket }))}
              placeholder="All aging"
              icon={CalendarClock}
              width={135}
            />
            {/* Category — client-side */}
            <FilterSelect
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={categoryOptions}
              placeholder="All categories"
              icon={Tag}
              width={155}
            />
            {/* Raised By — client-side */}
            <FilterSelect
              value={raisedByFilter}
              onChange={setRaisedByFilter}
              options={raisedByOptions}
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
            <div className="w-full" style={{ borderTop: '1px solid var(--glass-border)', margin: '0.25rem 0' }} />
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
      </div>
      </ExecutivePanel>

      {/* ── Error ── */}
      {error && (
        <div role="alert" className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs"
          style={{ background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.18)', color: '#f87171' }}>
          <AlertTriangle size={13} className="shrink-0" />
          {error}
          {/not found/i.test(error) && <span style={{ color: 'var(--text-3)' }}>— backend is deploying, auto-retrying</span>}
          <button onClick={refresh} className="underline ml-1">retry</button>
        </div>
      )}

      {/* ── Mobile card list (sm-down) ── */}
      <div className="invoice-mobile-stack md:hidden">
        {loading && !listData
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="card animate-pulse">
                <div className="skeleton h-3 w-2/5 mb-3 rounded" />
                <div className="skeleton h-5 w-3/5 rounded" />
              </div>
            ))
          : records.length === 0
            ? <EmptyState
                icon={<Receipt size={22} />}
                title="No invoices found"
                subtitle="Adjust your filters or create your first invoice to get started."
                action={isEditor && <button onClick={openNew} className="btn-primary"><Plus size={13} />New invoice</button>}
                compact
              />
            : records.map(r => {
                const f = r.fields || {}
                const outstanding = Number(f['Outstanding Amount'] || 0)
                const refs = parseAttachments(f['Reference'])
                const pdfs = parseAttachments(f['Invoice PDF'])
                const allFiles = [...refs, ...pdfs]
                const isPending = f['Payment Status'] === 'Pending'
                return (
                  <article
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openView(r)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        openView(r)
                      }
                    }}
                    className="invoice-mobile-card w-full text-left animate-slide-up">
                    {/* Top: invoice # + status */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.22em]" style={{ color: 'var(--text-3)' }}>
                          Invoice
                        </p>
                        <p className="font-mono text-[13px] font-bold truncate mt-1" style={{ color: 'var(--text-1)' }}>
                          {f['Invoice Number'] || '—'}
                        </p>
                        <p className="text-[11px] truncate mt-1" style={{ color: 'var(--text-3)' }}>
                          {f['Project'] || '—'} {f['Category'] ? `· ${f['Category']}` : ''}
                        </p>
                      </div>
                      <StatusPill status={f['Payment Status']} />
                    </div>
                    {f['Raised By'] && (
                      <div className="invoice-mobile-meta mt-1">
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-3)' }}>
                          <User size={8} />{f['Raised By']}
                        </span>
                        {f['Milestone'] && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-3)' }}>{f['Milestone']}</span>}
                      </div>
                    )}
                    {/* Middle: amounts */}
                    <div className="invoice-mobile-summary my-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.18em]" style={{ color: 'var(--text-3)' }}>Amount</p>
                        <p className="font-bold tabular-nums text-base mt-1" style={{ color: 'var(--text-1)' }}>
                          {fmt(f['Amount Raised'])}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] uppercase tracking-[0.18em]" style={{ color: 'var(--text-3)' }}>Outstanding</p>
                        <p className="font-bold tabular-nums text-sm mt-1" style={{ color: outstanding > 0 ? 'var(--fin-warning)' : 'var(--text-2)' }}>
                          {outstanding > 0 ? fmt(outstanding) : 'Clear'}
                        </p>
                      </div>
                    </div>
                    {/* Bottom: meta */}
                    <div className="invoice-mobile-foot">
                      <span className="tabular-nums">{fmtDate(f['Raised Date'])}</span>
                      <div className="invoice-mobile-foot-right">
                        {f['Next followup'] && (
                          <span className="flex items-center gap-0.5 tabular-nums" style={{ color: 'var(--fin-warning)' }}>
                            <CalendarClock size={9} />{fmtDate(f['Next followup'])}
                          </span>
                        )}
                        {allFiles.length > 0 && (
                          <span className="flex items-center gap-0.5"><FileText size={10} />{allFiles.length}</span>
                        )}
                        <AgingBadge days={effectiveAging(f)} status={f['Payment Status']} />
                      </div>
                    </div>
                    <div className="invoice-mobile-actions" onClick={e => e.stopPropagation()}>
                      {isEditor && isPending && (
                        <button type="button" onClick={() => openRecordPayment(r)} className="btn-primary">
                          <CheckCircle2 size={13} />Record payment
                        </button>
                      )}
                      {allFiles.length > 0 && (
                        <button type="button" onClick={() => setPreviewDocs({ docs: allFiles, index: 0 })} className="btn-ghost">
                          <Paperclip size={13} />Files ({allFiles.length})
                        </button>
                      )}
                      <button type="button" onClick={() => openView(r)} className="btn-ghost">
                        <Eye size={13} />Details
                      </button>
                    </div>
                  </article>
                )
              })
        }
      </div>

      {/* ── Desktop table (md+) ── */}
      <div className={clsx('data-table-shell hidden md:block', tableDensity === 'compact' && 'is-compact')}>
        <div className="invoice-table-toolbar">
          <div>
            <p>{records.length} invoices in view</p>
            <span>{syncing ? 'Refreshing mirror data...' : `Showing full current scope from ${allRecords.length} loaded invoices`}</span>
          </div>
          <div className="invoice-table-controls">
            <div className="invoice-density-toggle" role="group" aria-label="Table density">
              {['comfortable', 'compact'].map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setTableDensity(mode)}
                  aria-pressed={tableDensity === mode}
                  className={tableDensity === mode ? 'active' : ''}
                >
                  {mode === 'comfortable' ? 'Comfort' : 'Compact'}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setColumnWidths(DEFAULT_INVOICE_COLUMN_WIDTHS)}
              className="btn-ghost"
              style={{ fontSize: '0.75rem', padding: '0.45rem 0.7rem' }}
            >
              <RotateCcw size={12} />Reset widths
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: 1700, tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th className="tbl-head" style={{ width: columnWidths.row }}>
                  <ResizableHead width={columnWidths.row} onResizeStart={(e) => startColumnResize('row', e)}>#</ResizableHead>
                </th>
                <th className="tbl-head" style={{ width: columnWidths.invoice_number }}>
                  <ResizableHead width={columnWidths.invoice_number} onResizeStart={(e) => startColumnResize('invoice_number', e)}><SortLabel col="Invoice Number">Invoice #</SortLabel></ResizableHead>
                </th>
                <th className="tbl-head" style={{ width: columnWidths.client_name }}>
                  <ResizableHead width={columnWidths.client_name} onResizeStart={(e) => startColumnResize('client_name', e)}><SortLabel col="Client Name">Client</SortLabel></ResizableHead>
                </th>
                <th className="tbl-head" style={{ width: columnWidths.project }}>
                  <ResizableHead width={columnWidths.project} onResizeStart={(e) => startColumnResize('project', e)}><SortLabel col="Project">Project</SortLabel></ResizableHead>
                </th>
                <th className="tbl-head" style={{ width: columnWidths.category }}>
                  <ResizableHead width={columnWidths.category} onResizeStart={(e) => startColumnResize('category', e)}><SortLabel col="Category">Category</SortLabel></ResizableHead>
                </th>
                <th className="tbl-head" style={{ width: columnWidths.milestone }}>
                  <ResizableHead width={columnWidths.milestone} onResizeStart={(e) => startColumnResize('milestone', e)}><SortLabel col="Milestone">Milestone</SortLabel></ResizableHead>
                </th>
                <th className="tbl-head" style={{ width: columnWidths.raised_by }}>
                  <ResizableHead width={columnWidths.raised_by} onResizeStart={(e) => startColumnResize('raised_by', e)}><SortLabel col="Raised By">Raised By</SortLabel></ResizableHead>
                </th>
                <th className="tbl-head" style={{ width: columnWidths.raised_date }}>
                  <ResizableHead width={columnWidths.raised_date} onResizeStart={(e) => startColumnResize('raised_date', e)}><SortLabel col="Raised Date">Raised</SortLabel></ResizableHead>
                </th>
                <th className="tbl-head" style={{ width: columnWidths.amount_raised }}>
                  <ResizableHead width={columnWidths.amount_raised} onResizeStart={(e) => startColumnResize('amount_raised', e)}><SortLabel col="Amount Raised">Amount</SortLabel></ResizableHead>
                </th>
                <th className="tbl-head" style={{ width: columnWidths.amount_with_tax }}>
                  <ResizableHead width={columnWidths.amount_with_tax} onResizeStart={(e) => startColumnResize('amount_with_tax', e)}><SortLabel col="Amount with Tax">GST Total</SortLabel></ResizableHead>
                </th>
                <th className="tbl-head" style={{ width: columnWidths.amount_received }}>
                  <ResizableHead width={columnWidths.amount_received} onResizeStart={(e) => startColumnResize('amount_received', e)}><SortLabel col="Amount Received">Received</SortLabel></ResizableHead>
                </th>
                <th className="tbl-head" style={{ width: columnWidths.outstanding_amount }}>
                  <ResizableHead width={columnWidths.outstanding_amount} onResizeStart={(e) => startColumnResize('outstanding_amount', e)}><SortLabel col="Outstanding Amount">Outstanding</SortLabel></ResizableHead>
                </th>
                <th className="tbl-head" style={{ width: columnWidths.payment_status }}>
                  <ResizableHead width={columnWidths.payment_status} onResizeStart={(e) => startColumnResize('payment_status', e)}><SortLabel col="Payment Status">Status</SortLabel></ResizableHead>
                </th>
                <th className="tbl-head" style={{ width: columnWidths.aging }}>
                  <ResizableHead width={columnWidths.aging} onResizeStart={(e) => startColumnResize('aging', e)}><SortLabel col="Agening (Days)">Aging</SortLabel></ResizableHead>
                </th>
                <th className="tbl-head" style={{ width: columnWidths.next_followup }}>
                  <ResizableHead width={columnWidths.next_followup} onResizeStart={(e) => startColumnResize('next_followup', e)}><SortLabel col="Next followup">Next Followup</SortLabel></ResizableHead>
                </th>
                <th className="tbl-head" style={{ width: columnWidths.docs }}>
                  <ResizableHead width={columnWidths.docs} onResizeStart={(e) => startColumnResize('docs', e)}>Docs</ResizableHead>
                </th>
                <th className="tbl-head" style={{ width: columnWidths.actions }}>
                  <ResizableHead width={columnWidths.actions} onResizeStart={(e) => startColumnResize('actions', e)}>Actions</ResizableHead>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && !listData
                ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
                : records.length === 0
                  ? <tr><td colSpan={17}>
                      <EmptyState
                        icon={<Receipt size={22} />}
                        title="No invoices found"
                        subtitle="Adjust your filters or create your first invoice."
                        action={isEditor && <button onClick={openNew} className="btn-primary"><Plus size={13} />New invoice</button>}
                        compact
                      />
                    </td></tr>
                  : records.map((r, rowIndex) => {
                      const f = r.fields || {}
                      const outstanding = Number(f['Outstanding Amount'] || 0)
                      const refs = parseAttachments(f['Reference'])
                      const pdfs = parseAttachments(f['Invoice PDF'])
                      const allFiles = [...refs, ...pdfs]

                      return (
                        <tr
                          key={r.id}
                          className="tbl-row"
                          style={{
                            cursor: 'pointer',
                            background: rowIndex % 2 === 0 ? 'var(--table-row-even)' : 'var(--table-row-odd)',
                            transition: 'transform 180ms ease, box-shadow 180ms ease, background-color 180ms ease',
                          }}
                          onClick={() => openView(r)}
                          onMouseEnter={e => {
                            e.currentTarget.style.borderLeft = '2px solid var(--accent)'
                            e.currentTarget.style.background = 'var(--table-row-hover)'
                            e.currentTarget.style.boxShadow = 'var(--table-row-shadow)'
                            e.currentTarget.style.transform = 'translateY(-1px)'
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.borderLeft = ''
                            e.currentTarget.style.background = rowIndex % 2 === 0 ? 'var(--table-row-even)' : 'var(--table-row-odd)'
                            e.currentTarget.style.boxShadow = ''
                            e.currentTarget.style.transform = ''
                          }}>

                          <td className="tbl-cell" style={{ width: columnWidths.row }}>
                            <span className="text-[11px] font-semibold tabular-nums" style={{ color: 'var(--text-3)' }}>
                              {rowIndex + 1}
                            </span>
                          </td>

                          <td className="tbl-cell" style={{ width: columnWidths.invoice_number }}>
                            <span className="font-mono text-xs font-bold" style={{ color: 'var(--text-1)' }}>
                              {f['Invoice Number'] || '—'}
                            </span>
                          </td>
                          <td className="tbl-cell align-top" style={{ width: columnWidths.client_name }}>
                            <span className="text-xs font-semibold block" style={{ color: 'var(--text-1)', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{f['Client Name'] || f['Client'] || '—'}</span>
                          </td>
                          <td className="tbl-cell align-top" style={{ width: columnWidths.project }}>
                            <div className="min-w-0">
                              <span className="text-xs font-semibold block" style={{ color: 'var(--text-1)', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{f['Project'] || '—'}</span>
                              {f['Description'] && (
                                <span className="block text-[11px] mt-1" style={{ color: 'var(--text-3)', whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.5 }}>
                                  {f['Description']}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="tbl-cell" style={{ width: columnWidths.category }}>
                            <span className="text-[11px]" style={{ color: 'var(--text-2)', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{f['Category'] || '—'}</span>
                          </td>
                          <td className="tbl-cell" style={{ width: columnWidths.milestone }}><span className="text-[11px]" style={{ color: 'var(--text-2)', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{f['Milestone'] || '—'}</span></td>
                          <td className="tbl-cell min-w-0" style={{ width: columnWidths.raised_by, overflow: 'hidden' }}>
                            {f['Raised By']
                              ? <span className="inline-flex max-w-full min-w-0 items-center gap-1 text-[11px] px-2 py-0.5 rounded-full" title={f['Raised By']} style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-2)' }}>
                                  <User size={9} style={{ flexShrink: 0 }} />
                                  <span className="min-w-0 truncate">{f['Raised By']}</span>
                                </span>
                              : <span style={{ color: 'var(--text-3)' }}>—</span>}
                          </td>
                          <td className="tbl-cell" style={{ width: columnWidths.raised_date }}>
                            <span className="text-xs tabular-nums" style={{ color: 'var(--text-2)' }}>{fmtDate(f['Raised Date'])}</span>
                          </td>
                          <td className="tbl-cell" style={{ width: columnWidths.amount_raised }}>
                            <span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--text-1)' }}>
                              {fmt(f['Amount Raised'])}
                            </span>
                          </td>
                          <td className="tbl-cell" style={{ width: columnWidths.amount_with_tax }}>
                            <span className="text-xs tabular-nums" style={{ color: 'var(--text-2)' }}>
                              {fmt(f['Amount with Tax'])}
                            </span>
                          </td>
                          <td className="tbl-cell" style={{ width: columnWidths.amount_received }}>
                            <span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--fin-positive)' }}>
                              {fmt(f['Amount Received'])}
                            </span>
                          </td>
                          <td className="tbl-cell" style={{ width: columnWidths.outstanding_amount }}>
                            {outstanding > 0
                              ? <span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--fin-warning)' }}>{fmt(outstanding)}</span>
                              : <span className="text-xs" style={{ color: 'var(--text-3)' }}>—</span>}
                          </td>
                          <td className="tbl-cell" style={{ width: columnWidths.payment_status }}>
                            <StatusPill status={f['Payment Status']} />
                          </td>
                          <td className="tbl-cell" style={{ width: columnWidths.aging }}>
                            <AgingBadge days={effectiveAging(f)} status={f['Payment Status']} />
                          </td>
                          <td className="tbl-cell" style={{ width: columnWidths.next_followup }}>
                            {f['Next followup']
                              ? <span className="text-xs tabular-nums" style={{ color: effectiveAging(f) > 0 && f['Payment Status'] === 'Pending' ? 'var(--fin-warning)' : 'var(--text-2)' }}>
                                  {fmtDate(f['Next followup'])}
                                </span>
                              : <span style={{ color: 'var(--text-3)' }}>—</span>}
                          </td>

                          {/* Attachment thumbs */}
                          <td className="tbl-cell" onClick={e => e.stopPropagation()} style={{ width: columnWidths.docs }}>
                            {allFiles.length > 0 ? (
                              <div className="flex items-center gap-1">
                                {allFiles.slice(0, 2).map((a, i) => (
                                  <AttachThumb key={i} a={a} size={28} onPreview={() => setPreviewDocs({ docs: allFiles, index: i })} />
                                ))}
                                {allFiles.length > 2 && (
                                  <span className="text-[10px] px-1" style={{ color: 'var(--text-3)' }}>
                                    +{allFiles.length - 2}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs" style={{ color: 'var(--text-3)' }}>—</span>
                            )}
                          </td>

                          {/* View action */}
                          <td className="tbl-cell" onClick={e => e.stopPropagation()} style={{ width: columnWidths.actions }}>
                            <div className="flex flex-wrap gap-2">
                              {isEditor && f['Payment Status'] === 'Pending' && (
                                <button
                                  onClick={() => openRecordPayment(r)}
                                  className="btn-ghost flex items-center gap-1.5"
                                  style={{ fontSize: '0.6875rem', padding: '0.3rem 0.65rem', color: 'var(--fin-positive)', borderColor: 'rgba(34,197,94,0.3)' }}
                                  aria-label={`Record payment for ${f['Invoice Number']}`}>
                                  <CheckCircle2 size={12} />
                                  <span className="text-[11px] font-semibold">Pay</span>
                                </button>
                              )}
                              <button
                                onClick={() => openView(r)}
                                className="btn-ghost flex items-center gap-1.5"
                                style={{ fontSize: '0.6875rem', padding: '0.3rem 0.65rem', color: 'var(--accent)', borderColor: 'rgba(79,70,229,0.3)' }}
                                aria-label={`View ${f['Invoice Number']}`}>
                                <Eye size={12} />
                                <span className="text-[11px] font-semibold">View</span>
                              </button>
                            </div>
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

      {/* ── Drawers — always rendered so exit animations play ── */}
      <InvoiceDetail
        open={drawer?.mode === 'view'}
        invoice={drawer?.mode === 'view' ? drawer.invoice : null}
        onClose={closeDrawer}
        onEdit={() => isEditor && setDrawer({ mode: 'edit', invoice: drawer?.invoice })}
        onRecordPayment={() => isEditor && openRecordPayment(drawer?.invoice)}
        isEditor={isEditor}
        onPreview={(docs, idx) => setPreviewDocs({ docs, index: idx })}
      />
      {isEditor && (
        <InvoiceDrawer
          open={drawer?.mode === 'new' || drawer?.mode === 'edit' || drawer?.mode === 'payment'}
          invoice={drawer?.mode === 'edit' || drawer?.mode === 'payment' ? drawer.invoice : null}
          prefill={drawer?.mode === 'new' || drawer?.mode === 'payment' ? drawer?.prefill : null}
          paymentOnly={drawer?.mode === 'payment'}
          onClose={closeDrawer}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          options={formOptions}
        />
      )}
      {isEditor && shareModal && (
        <ShareLinkModal
          resourceType="invoices"
          selectedRecords={records}
          title={shareTitle}
          recordLabel="invoice"
          enableLiveMode
          viewConfig={sharedViewConfig}
          onClose={() => setShareModal(false)}
        />
      )}
      {isEditor && manageModal && (
        <ManageSharedLinksModal
          resourceType="invoices"
          recordLabel="invoice"
          currentViewConfig={sharedViewConfig}
          visibleRecords={records}
          onClose={() => setManageModal(false)}
        />
      )}
      <DocPreviewModal state={previewDocs} onClose={() => setPreviewDocs(null)} />
    </ExecutiveShell>
  )
}
