// Data for the Invoices page: the URL holds the search, filters, sort and how
// many pages are loaded; GET /api/invoices/query answers one page plus the
// totals of the filtered scope and of the whole workspace.
//
// The fetching itself (debounce, aborts, shared in-flight requests, previous
// rows kept while loading, ETag polls) is hooks/useServerList.js, which the
// Web Invoices, Projects and Tax Ledger pages share; this file describes the
// invoice list's filters and endpoint. Web Invoices uses the same filters
// against GET /api/web-invoices/query (useWebInvoiceQuery).
import { useMemo } from 'react'
import { api } from '../../services/api'
import {
  LIST_POLL_MS, MAX_LIST_ROWS, SEARCH_DEBOUNCE_MS, createListFilters, createListQuery, resetServerListCache,
} from '../../hooks/useServerList'

export { SEARCH_DEBOUNCE_MS }
export const INVOICE_PAGE_SIZE = 50
export const MAX_INVOICE_PAGE = MAX_LIST_ROWS
export const INVOICE_POLL_MS = LIST_POLL_MS

export const DEFAULT_INVOICE_FILTERS = Object.freeze({
  q: '', status: '', project: '', client: '', category: '', raisedBy: '',
  billing: 'all', month: '', aging: '', dateField: 'Raised Date', dateFrom: '', dateTo: '',
  overdue: false, hasDocs: false, followupDue: false, conditions: [],
  sort: 'Raised Date', order: 'desc',
})

// filter -> URL parameter
const URL_KEY = {
  q: 'q', status: 'status', project: 'project', client: 'client', category: 'category',
  raisedBy: 'raised_by', billing: 'billing', month: 'month', aging: 'aging',
  dateField: 'date_field', dateFrom: 'from', dateTo: 'to',
  overdue: 'overdue', hasDocs: 'docs', followupDue: 'followup', conditions: 'adv',
  sort: 'sort', order: 'order',
}

const invoiceFilters = createListFilters({
  defaults: DEFAULT_INVOICE_FILTERS,
  keys: URL_KEY,
  booleans: ['overdue', 'hasDocs', 'followupDue'],
  json: ['conditions'],
  pageSize: INVOICE_PAGE_SIZE,
  normalize(out) {
    if (!['asc', 'desc'].includes(out.order)) out.order = 'desc'
    if (!['all', 'project', 'retainer'].includes(out.billing)) out.billing = 'all'
    return out
  },
})

/** The filters a URL describes, defaults filled in. */
export const readInvoiceFilters = invoiceFilters.read

/** `searchParams` with `patch` applied; defaults are left out of the URL. */
export const writeInvoiceFilters = invoiceFilters.write

/** Rules FilterBuilder would apply (incomplete rows are skipped there too). */
export function activeConditions(conditions = []) {
  return conditions.filter(c => c?.field && c?.op && (
    (c.value !== '' && c.value != null) || ['is_empty', 'is_not_empty'].includes(c.op)))
}

/** Query parameters for GET /api/invoices/query (and /export). */
export function invoiceQueryParams(filters, tz = -new Date().getTimezoneOffset()) {
  const conditions = activeConditions(filters.conditions)
  return {
    q: filters.q?.trim() || undefined,
    status: filters.status || undefined,
    project: filters.project || undefined,
    client: filters.client || undefined,
    category: filters.category || undefined,
    raised_by: filters.raisedBy || undefined,
    billing: filters.billing && filters.billing !== 'all' ? filters.billing : undefined,
    month: filters.month || undefined,
    aging: filters.aging || undefined,
    date_field: (filters.dateFrom || filters.dateTo) && filters.dateField !== 'Raised Date' ? filters.dateField : undefined,
    date_from: filters.dateFrom || undefined,
    date_to: filters.dateTo || undefined,
    overdue: filters.overdue || undefined,
    has_docs: filters.hasDocs || undefined,
    followup_due: filters.followupDue || undefined,
    conditions: conditions.length ? JSON.stringify(conditions.map(({ field, op, value }) => ({ field, op, value }))) : undefined,
    sort: filters.sort && filters.sort !== 'Raised Date' ? filters.sort : undefined,
    order: filters.order && filters.order !== 'desc' ? filters.order : undefined,
    tz: tz || undefined,
  }
}

/**
 * The page's filters, kept in the URL. Discrete changes add a history entry,
 * so back and forward step through them; typing in the search box replaces
 * the entry once the debounce settles.
 */
export function useInvoiceFilters(opts) {
  return invoiceFilters.useFilters(opts)
}

/** For tests: forget shared requests and held ETags. */
export function resetInvoiceQueryCache() {
  resetServerListCache()
}

export const invoiceList = createListQuery({
  endpoint: '/api/invoices/query', fetcher: () => api.invoices.query, label: 'invoices',
})
export const webInvoiceList = createListQuery({
  endpoint: '/api/web-invoices/query', fetcher: () => api.webInvoices.query, label: 'invoices',
})

function useQueryFor(list, filters, { pageSize = INVOICE_PAGE_SIZE, ...opts } = {}) {
  const key = JSON.stringify(invoiceQueryParams(filters))
  const base = useMemo(() => JSON.parse(key), [key])
  return list.useList(base, { pageSize, ...opts })
}

/**
 * The page's data for `filters`: { records, total, nextCursor, aggregates,
 * workspace, loading, refreshing, loadingMore, error, errorStatus, loadMore,
 * refresh, patchRecord, removeRecord }.
 */
export function useInvoiceQuery(filters, opts) {
  return useQueryFor(invoiceList, filters, opts)
}

/** The same, from GET /api/web-invoices/query (totals per currency too). */
export function useWebInvoiceQuery(filters, opts) {
  return useQueryFor(webInvoiceList, filters, opts)
}
