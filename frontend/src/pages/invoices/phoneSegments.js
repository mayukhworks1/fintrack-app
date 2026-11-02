// The phone's segmented control (All / Pending / Overdue / Paid) mapped onto
// the invoice list's own filters, so a segment is just a view of the URL:
// shareable, back-able, and answered by the same server query.
//
// Overdue is the server's own rule (aggregates.overdue_count): a pending
// invoice more than 30 days old. The list filters say that as status Pending
// plus "raised on or before" the day 31 days ago.
export const INVOICE_SEGMENTS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
]

export const OVERDUE_DAYS = 30

const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The last raised date that counts as overdue today (local calendar day). */
export function overdueCutoff(today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  d.setDate(d.getDate() - (OVERDUE_DAYS + 1))
  return isoDay(d)
}

/** True when the date filters are exactly the Overdue segment's. */
function hasOverdueRange(filters, today) {
  return (filters.dateField || 'Raised Date') === 'Raised Date'
    && !filters.dateFrom && filters.dateTo === overdueCutoff(today)
}

/** The segment `filters` describe, or null when they describe none (e.g. Cancelled). */
export function invoiceSegmentOf(filters, today = new Date()) {
  const status = filters.status || ''
  if (status === 'Pending') return hasOverdueRange(filters, today) ? 'overdue' : 'pending'
  if (status === 'Paid') return 'paid'
  if (status === '') return 'all'
  return null
}

/**
 * The filter change that selects `segment`. Other filters (search, client,
 * project…) are kept; the Overdue date range is only removed when it is the
 * segment's own, never a range the reader chose.
 */
export function invoiceSegmentPatch(segment, filters = {}, today = new Date()) {
  const clearRange = hasOverdueRange(filters, today) ? { dateFrom: '', dateTo: '' } : {}
  switch (segment) {
    case 'pending': return { status: 'Pending', ...clearRange }
    case 'overdue': return { status: 'Pending', dateField: 'Raised Date', dateFrom: '', dateTo: overdueCutoff(today) }
    case 'paid': return { status: 'Paid', ...clearRange }
    default: return { status: '', ...clearRange }
  }
}

/**
 * Removable chips for the filters in force, for a list without its own:
 * [{ key, label, onClear }]. Keys match the Invoices page's chips.
 */
export function invoiceFilterChips(filters, setFilters) {
  const f = filters
  const chips = []
  if (f.status) chips.push({ key: 'status', label: `Status: ${f.status}`, onClear: () => setFilters({ status: '' }) })
  if (f.project) chips.push({ key: 'project', label: `Project: ${f.project}`, onClear: () => setFilters({ project: '' }) })
  if (f.client) chips.push({ key: 'client', label: `Client: ${f.client}`, onClear: () => setFilters({ client: '' }) })
  if (f.category) chips.push({ key: 'category', label: `Category: ${f.category}`, onClear: () => setFilters({ category: '' }) })
  if (f.raisedBy) chips.push({ key: 'raised_by', label: `Owner: ${f.raisedBy}`, onClear: () => setFilters({ raisedBy: '' }) })
  if (f.billing && f.billing !== 'all') chips.push({ key: 'billing', label: `Billing: ${f.billing === 'retainer' ? 'Retainers' : 'Projects'}`, onClear: () => setFilters({ billing: 'all' }) })
  if (f.month) chips.push({ key: 'month', label: `Raised: ${f.month}`, onClear: () => setFilters({ month: '' }) })
  if (f.dateFrom || f.dateTo) chips.push({ key: 'date', label: `${f.dateField}: ${f.dateFrom || 'Start'} to ${f.dateTo || 'Today'}`, onClear: () => setFilters({ dateFrom: '', dateTo: '', dateField: 'Raised Date' }) })
  if (f.aging) chips.push({ key: 'aging', label: `Aging: ${f.aging}`, onClear: () => setFilters({ aging: '' }) })
  if (f.overdue) chips.push({ key: 'overdue', label: 'Open collections', onClear: () => setFilters({ overdue: false }) })
  if (f.hasDocs) chips.push({ key: 'docs', label: 'Has documents', onClear: () => setFilters({ hasDocs: false }) })
  if (f.followupDue) chips.push({ key: 'followup', label: 'Follow-up due', onClear: () => setFilters({ followupDue: false }) })
  const rules = (f.conditions || []).filter(c => c?.field && c?.op)
  if (rules.length) chips.push({ key: 'advanced', label: `${rules.length} advanced rule${rules.length !== 1 ? 's' : ''}`, onClear: () => setFilters({ conditions: [] }) })
  return chips
}
