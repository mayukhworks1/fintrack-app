// Extracted from WebInvoices.jsx — pure helpers.
import { isRetainerCategory } from '../invoices/shared'

export {
  INVOICE_REQUEST_FORM_URL, STATUSES, STATUS_META, buildRetainerGroups, classifyAgingBand,
  currentMonthKey, dateOnlyValue, endOfMonthIso, firstDayIso, fmt, fmtDate, fmtDateFull,
  invoiceAmountParts, isRetainerCategory, monthKey, monthLabel, parseAttachments, parseIsoDate,
  shiftMonthKey, shortMonthLabel, sortByRaisedDateDesc,
} from '../invoices/shared'

export const DEFAULT_PICKLISTS = {
  Project:     [],
  Category:    [],
  Milestone:   [],
  'Raised By': [],
}

export const EMPTY_FORM = {
  invoice_number: '', project: '', category: '', description: '',
  milestone: '', raised_by: '', raised_date: '', cleared_date: '',
  amount_raised: '', amount_with_tax: '', amount_received: '',
  payment_status: 'Pending', remark: '', next_followup: '',
  reference: [], invoice_pdf: [],
  currency: 'RS',
}

const WEB_INVOICE_SCALAR_FORM_KEYS = [
  'invoice_number',
  'project',
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
  'currency',
]

export const normalizeWebInvoiceScalarForm = (form) => WEB_INVOICE_SCALAR_FORM_KEYS.reduce((acc, key) => {
  const value = form?.[key]
  acc[key] = value == null ? '' : String(value).trim()
  return acc
}, {})

// Currency helpers

const CURRENCY_SYMBOLS = { RS: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'د.إ' }

export function currencySymbol(code) {
  return CURRENCY_SYMBOLS[code] || (code ? `${code} ` : '₹')
}

export function fmtCurrency(n, currency) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '—'
  const sym = currencySymbol(currency || 'RS')
  const formatted = Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  return `${sym}${formatted}`
}

/* ── Field definitions for advanced filter builder ────────────────────────── */

export const INVOICE_FIELDS = [
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

export function getRetainerCategoryOption(options = []) {
  return options.find(isRetainerCategory) || 'Development- Retainer'
}

export function getProjectCategoryOption(options = [], current = '') {
  if (current && !isRetainerCategory(current)) return current
  const explicit = options.find(o => /^project$/i.test(String(o || '').trim()))
  if (explicit) return explicit
  return options.find(o => !isRetainerCategory(o)) || ''
}

export const buildWebInvoiceScalarPayload = (form, { isEdit = false, paymentOnly = false } = {}) => ({
  invoice_number:   form.invoice_number,
  project:          form.project,
  category:         form.category,
  description:      form.description,
  milestone:        form.milestone,
  raised_by:        form.raised_by,
  payment_status:   form.payment_status,
  remark:           form.remark,
  currency:         form.currency,
  amount_raised:    form.amount_raised !== '' ? Number(form.amount_raised) : undefined,
  amount_with_tax:  form.amount_with_tax !== '' ? Number(form.amount_with_tax) : undefined,
  amount_received:  form.amount_received !== '' ? Number(form.amount_received) : undefined,
  raised_date:      form.raised_date ? `${form.raised_date}T00:00:00.000Z` : (isEdit ? null : undefined),
  cleared_date:     form.cleared_date ? `${form.cleared_date}T00:00:00.000Z` : (isEdit ? null : undefined),
  next_followup:    paymentOnly
    ? null
    : form.next_followup ? `${form.next_followup}T00:00:00.000Z` : (isEdit ? null : undefined),
  // Always include attachment arrays so removals (empty list) are persisted to Teable.
  reference:        Array.isArray(form.reference)   ? form.reference   : [],
  invoice_pdf:      Array.isArray(form.invoice_pdf) ? form.invoice_pdf : [],
})

export const KPI_PALETTE = [
  { bg: 'var(--kpi-1-bg)', fg: 'var(--kpi-1-fg)' },
  { bg: 'var(--kpi-2-bg)', fg: 'var(--kpi-2-fg)' },
  { bg: 'var(--kpi-3-bg)', fg: 'var(--kpi-3-fg)' },
  { bg: 'var(--kpi-4-bg)', fg: 'var(--kpi-4-fg)' },
  { bg: 'var(--kpi-5-bg)', fg: 'var(--kpi-5-fg)' },
]

export const HELP_CONTACT = 'Mayukh@theworks.in'
