// Extracted from Invoices.jsx — pure helpers.
import { formatInr } from '../../utils/format'
import { CheckCircle2, Clock, XCircle } from 'lucide-react'

export const STATUSES = ['Paid', 'Pending', 'Cancelled']

export const EMPTY_FORM = {
  invoice_number: '', project: '', client_name: '', category: '', description: '',
  milestone: '', raised_by: '', raised_date: '', cleared_date: '',
  amount_raised: '', amount_with_tax: '', amount_received: '',
  payment_status: 'Pending', remark: '', next_followup: '',
  reference: [], invoice_pdf: [],
}

export const INVOICE_PARSE_FIELD_LABELS = {
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

export const monthKey = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export const monthLabel = (key) => {
  if (!key) return 'All months'
  const [year, month] = key.split('-')
  const d = new Date(Number(year), Number(month) - 1, 1)
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

export const shiftMonthKey = (key, delta) => {
  const [year, month] = key.split('-').map(Number)
  const d = new Date(year, month - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export const shortMonthLabel = (key) => {
  const [year, month] = key.split('-')
  const d = new Date(Number(year), Number(month) - 1, 1)
  return d.toLocaleDateString('en-IN', { month: 'short' })
}

export const projectInitials = (value) => String(value || 'NA')
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0]?.toUpperCase())
  .join('') || 'NA'

export const INVOICE_SCALAR_FORM_KEYS = [
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

export const normalizeInvoiceScalarForm = (form) => INVOICE_SCALAR_FORM_KEYS.reduce((acc, key) => {
  const value = form?.[key]
  acc[key] = value == null ? '' : String(value).trim()
  return acc
}, {})

export const invoiceAmountParts = (fields = {}) => {
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

export const buildInvoiceScalarPayload = (form, { isEdit = false, paymentOnly = false } = {}) => ({
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

export const isRetainerCategory = (value) => /retainer/i.test(String(value || ''))

export const currentMonthKey = () => monthKey(new Date().toISOString())

export const firstDayIso = (key) => `${key}-01T00:00:00.000Z`

export const INVOICE_REQUEST_FORM_URL = 'https://forms.zohopublic.com/theworks/form/TheWorksInvoiceRequest/formperma/EeBkA0aaMt64sMe9n3mxlKggjA-QmVDmTVwrqMHPGOY'

export const INVOICE_SHARE_COLUMNS = [
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
  'Agening (Days)',
  'Raised Date',
  'Cleared Date',
  'Next followup',
  'Description',
  'Remark',
  'Reference',
  'Invoice PDF',
  'Last Modified',
]

export const INVOICE_SHARED_HIGHLIGHTABLE_COLUMNS = [
  'Agening (Days)',
  'Raised Date',
  'Cleared Date',
  'Next followup',
  'Amount Raised',
  'Amount Received',
  'Outstanding Amount',
  'Amount with Tax',
]

export const DEFAULT_INVOICE_COLUMN_WIDTHS = {
  row: 56,
  invoice_number: 150,
  payment_status: 110,
  amount_raised: 130,
  aging: 90,
  client_name: 170,
  project: 240,
  raised_date: 110,
  outstanding_amount: 130,
  amount_received: 120,
  amount_with_tax: 120,
  category: 130,
  milestone: 130,
  raised_by: 180,
  next_followup: 125,
  docs: 110,
  actions: 130,
}

/* ── Field definitions for advanced filter builder ────────────────────────── */

export const INVOICE_FIELDS = [
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

export function parseIsoDate(value) {
  const d = new Date(value || '')
  return Number.isNaN(d.getTime()) ? null : d
}

export function sortByRaisedDateDesc(records = []) {
  return [...records].sort((a, b) => {
    const da = parseIsoDate(a.fields?.['Raised Date'])?.getTime() || 0
    const db = parseIsoDate(b.fields?.['Raised Date'])?.getTime() || 0
    return db - da
  })
}

export const fmt     = (n) => formatInr(n)

export const fmtDate = (d) => {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) }
  catch { return String(d).slice(0, 10) }
}

export const fmtDateFull = (d) => {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) }
  catch { return String(d).slice(0, 10) }
}

export function parseAttachments(cell) {
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

export const isImage = (a) => {
  if (a.mime?.startsWith('image/')) return true
  return /\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i.test(a.url) || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(a.name)
}

export const isPdf = (a) =>
  a.mime === 'application/pdf' ||
  /\.pdf(\?|$)/i.test(a.url) ||
  a.name?.toLowerCase().endsWith('.pdf')

/* ── Status config ───────────────────────────────────────────────────────── */

export const STATUS_META = {
  Paid:      { color: 'var(--fin-positive)', bg: 'var(--fin-pos-bg)',  border: 'var(--fin-pos-border)',  icon: CheckCircle2 },
  Pending:   { color: 'var(--fin-warning)',  bg: 'var(--fin-warn-bg)', border: 'var(--fin-warn-border)', icon: Clock },
  Cancelled: { color: 'var(--fin-negative)', bg: 'var(--fin-neg-bg)', border: 'var(--fin-neg-border)',  icon: XCircle },
}

export function classifyAgingBand(days) {
  const d = Number(days || 0)
  if (d <= 14) return '0-14d'
  if (d <= 30) return '15-30d'
  if (d <= 60) return '31-60d'
  return '60d+'
}

export function dateOnlyValue(value) {
  if (!value) return ''
  return String(value).slice(0, 10)
}

export function endOfMonthIso(key) {
  const [year, month] = key.split('-').map(Number)
  const d = new Date(year, month, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function effectiveAging(f) {
  const teableVal = f['Agening (Days)']
  if (teableVal != null && teableVal !== '' && Number(teableVal) > 0) return Number(teableVal)
  const raised = parseIsoDate(f['Raised Date'])
  if (!raised) return 0
  return Math.floor((Date.now() - raised.getTime()) / 86_400_000)
}
