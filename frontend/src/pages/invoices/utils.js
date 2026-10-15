// Extracted from Invoices.jsx — pure helpers.
import { parseIsoDate } from './shared'

export {
  INVOICE_REQUEST_FORM_URL, STATUSES, STATUS_META, buildRetainerGroups, classifyAgingBand,
  currentMonthKey, dateOnlyValue, endOfMonthIso, firstDayIso, fmt, fmtDate, fmtDateFull,
  invoiceAmountParts, isRetainerCategory, monthKey, monthLabel, parseAttachments,
  shiftMonthKey, shortMonthLabel,
} from './shared'

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

export const projectInitials = (value) => String(value || 'NA')
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

// Attachment fields are held in form state but are not scalars, so they need
// their own comparable shape. Identity is the file token/id where Teable gives
// one and the name otherwise — the presigned `url` rotates between reads and
// would make an untouched form look edited.
const attachmentSignature = (list) => (Array.isArray(list) ? list : [])
  .map(a => a?.token || a?.id || a?.name || '')
  .join('|')

/** Comparable snapshot of everything the drawer can edit, attachments included.
 *
 *  The drawer gates saving on this: comparing scalars alone meant removing a
 *  file registered as "no changes", which left the Save button disabled and made
 *  handleSave return silently — the removal was dropped with no error shown.
 */
export const normalizeInvoiceFormForCompare = (form) => ({
  ...normalizeInvoiceScalarForm(form),
  reference:   attachmentSignature(form?.reference),
  invoice_pdf: attachmentSignature(form?.invoice_pdf),
})

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
  // Attachment arrays must be sent, not just uploaded. Adding a file persists
  // immediately through the upload endpoint, but there is no delete endpoint —
  // removal happens by PATCHing the remaining list. Omitting these meant the
  // file vanished from the form and came back on reload.
  ...(isEdit ? {
    reference:   Array.isArray(form.reference)   ? form.reference   : [],
    invoice_pdf: Array.isArray(form.invoice_pdf) ? form.invoice_pdf : [],
  } : {}),
})

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

/* ── Column visibility ──────────────────────────────────────────────────────
   17 columns overflow any screen, so the table always scrolls sideways. These
   describe which can be hidden and which are structural. `row` and `actions`
   are always on: one is the position index, the other the row's controls.     */

export const INVOICE_COLUMNS = [
  { key: 'row',                label: '#',             locked: true },
  { key: 'invoice_number',     label: 'Invoice #' },
  { key: 'payment_status',     label: 'Status' },
  { key: 'amount_raised',      label: 'Amount' },
  { key: 'aging',              label: 'Aging' },
  { key: 'client_name',        label: 'Client' },
  { key: 'project',            label: 'Project' },
  { key: 'raised_date',        label: 'Raised' },
  { key: 'outstanding_amount', label: 'Outstanding' },
  { key: 'amount_received',    label: 'Received' },
  { key: 'amount_with_tax',    label: 'GST Total' },
  { key: 'category',           label: 'Category' },
  { key: 'milestone',          label: 'Milestone' },
  { key: 'raised_by',          label: 'Raised By' },
  { key: 'next_followup',      label: 'Next Followup' },
  { key: 'docs',               label: 'Docs' },
  { key: 'actions',            label: 'Actions',       locked: true },
]

// Columns hidden on first load. The defaults keep the collections-critical
// view — who owes what, how old — and drop the secondary metadata that pushes
// GST Total off the right edge.
const INVOICE_COLUMNS_HIDDEN_BY_DEFAULT = ['category', 'milestone', 'raised_by', 'next_followup']

export const DEFAULT_INVOICE_COLUMN_VISIBILITY = Object.fromEntries(
  INVOICE_COLUMNS.map(c => [c.key, !INVOICE_COLUMNS_HIDDEN_BY_DEFAULT.includes(c.key)]),
)

export const INVOICE_COLUMN_VISIBILITY_STORAGE_KEY = 'fintrack.invoices.columnVisibility'

/** Merge a persisted choice over the defaults, dropping keys that no longer
 *  exist and forcing locked columns on. */
export function normalizeColumnVisibility(stored) {
  const out = { ...DEFAULT_INVOICE_COLUMN_VISIBILITY }
  if (stored && typeof stored === 'object') {
    for (const col of INVOICE_COLUMNS) {
      if (col.locked) { out[col.key] = true; continue }
      if (typeof stored[col.key] === 'boolean') out[col.key] = stored[col.key]
    }
  }
  return out
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

export function effectiveAging(f) {
  if (f['Payment Status'] && f['Payment Status'] !== 'Pending') return 0
  const teableVal = f['Agening (Days)']
  if (teableVal != null && teableVal !== '' && Number(teableVal) > 0) return Number(teableVal)
  const raised = parseIsoDate(f['Raised Date'])
  if (!raised) return 0
  return Math.floor((Date.now() - raised.getTime()) / 86_400_000)
}
