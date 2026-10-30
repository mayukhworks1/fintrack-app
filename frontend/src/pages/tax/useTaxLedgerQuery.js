// Data for the Tax Ledger: the URL holds the period, the register scope and
// the search; GET /api/invoices/query (or /api/web-invoices/query for the web
// module) answers one page of the register plus the ledger's totals — paid
// register, open invoices, months and clients — for the search and for the
// period alone. The browser no longer downloads every invoice to add them up.
import { useMemo } from 'react'
import { createListFilters } from '../../hooks/useServerList'
import { invoiceList, webInvoiceList } from '../invoices/useInvoiceQuery'

export const TAX_PAGE_SIZE = 50
export const TAX_SCOPES = ['tax', 'open', 'all']

// Financial year start: April 1
export function fyStartYear(date = new Date()) {
  return date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1
}

export const DEFAULT_TAX_PERIOD = `fy-${fyStartYear()}`

const filtersFor = {}

/** The ledger's filters, under `prefix` when the ledger sits inside another page. */
export function taxFilters(prefix = '') {
  if (!filtersFor[prefix]) {
    filtersFor[prefix] = createListFilters({
      prefix,
      defaults: { q: '', period: DEFAULT_TAX_PERIOD, from: '', to: '', scope: 'tax' },
      keys: { q: 'q', period: 'period', from: 'from', to: 'to', scope: 'scope' },
      pageSize: TAX_PAGE_SIZE,
      normalize(out) {
        if (!TAX_SCOPES.includes(out.scope)) out.scope = 'tax'
        return out
      },
    })
  }
  return filtersFor[prefix]
}

/** The period part of a ledger request: a named period, or a custom range once both ends are set. */
export function periodParams(filters) {
  if (filters.period === 'custom') {
    return filters.from && filters.to ? { date_from: filters.from, date_to: filters.to } : { period: DEFAULT_TAX_PERIOD }
  }
  return { period: filters.period || DEFAULT_TAX_PERIOD }
}

/** Query parameters of the register (the "All Invoices" list and the totals). */
export function taxQueryParams(filters, tz = -new Date().getTimezoneOffset()) {
  return {
    ...periodParams(filters),
    tax_scope: filters.scope || 'tax',
    q: filters.q?.trim() || undefined,
    tz: tz || undefined,
  }
}

export function taxListFor(source) {
  return source === 'web' ? webInvoiceList : invoiceList
}

export function useTaxLedgerQuery(source, filters, opts = {}) {
  const key = JSON.stringify(taxQueryParams(filters))
  const base = useMemo(() => JSON.parse(key), [key])
  return taxListFor(source).useList(base, { pageSize: TAX_PAGE_SIZE, ...opts })
}
