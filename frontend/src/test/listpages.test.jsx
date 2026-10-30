/**
 * Projects, Tax Ledger and Web Invoices on their server-side lists.
 *
 * Each page used to download a whole table (and poll it) and work out its
 * figures in the browser. They now share hooks/useServerList.js with the
 * Invoices page: one request on load, a debounced search, superseded
 * requests aborted, identical ones shared, the URL as the source of the
 * filters, "Show more" through the cursor, KPI cards that follow the filters
 * with an "of all" hint, and CSV export from the server.
 *
 * The tax ledger's totals moved to the server; the last block re-derives the
 * shared fixture's figures with the old browser code, so the server tests
 * (backend/tests/test_list_queries_pg.py) and these agree on one set of numbers.
 */
import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import fixture from '../../../backend/tests/fixtures/tax_ledger_cases.json'
import { legacyTaxLedger } from './taxLedgerLegacy'

const { api, state, toastFn } = vi.hoisted(() => {
  const state = { projects: null, invoices: null, web: null }
  const anything = () => {
    const own = new Map()
    return new Proxy(function () {}, {
      get(target, key) {
        if (typeof key === 'symbol' || key === 'then') return undefined
        if (!own.has(key)) own.set(key, anything())
        return own.get(key)
      },
      apply: () => Promise.resolve([]),
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
  const blob = (name) => vi.fn().mockResolvedValue({ blob: new Blob(['x\n']), filename: name })
  const api = ns({
    projects: ns({ query: vi.fn((p, o) => state.projects(p, o)), list: vi.fn(), search: vi.fn(), summary: vi.fn() }),
    invoices: ns({
      query: vi.fn((p, o) => state.invoices(p, o)),
      list: vi.fn(),
      exportCsv: blob('tax-ledger_2026-10-30.csv'),
      picklists: vi.fn().mockResolvedValue({}),
    }),
    webInvoices: ns({
      query: vi.fn((p, o) => state.web(p, o)),
      list: vi.fn(), summary: vi.fn(),
      exportCsv: blob('invoices_filtered_2026-10-30.csv'),
      avatarMap: vi.fn().mockResolvedValue({}),
      agingBuckets: vi.fn().mockResolvedValue(null),
      picklists: ns({ get: vi.fn().mockResolvedValue({}) }),
    }),
  })
  const toastFn = Object.assign(vi.fn(), { showToast: vi.fn() })
  return { api, state, toastFn }
})

vi.mock('../services/api', () => ({
  api, API_BASE_URL: '', getAuthToken: () => '', setAuthToken: vi.fn(), clientCacheBust: vi.fn(),
}))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    status: 'authed', role: 'all', authRole: 'superadmin', isAdmin: true, isViewer: false,
    isWeb: false, isAll: true, isEditor: true, isImpersonating: false, isEmailAuth: false,
    user: { email: 'a@b.c' }, userEmail: 'a@b.c', hasPerm: () => true, logout: vi.fn(),
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
vi.mock('../utils/download', () => ({ downloadBlob: vi.fn() }))
vi.mock('./../pages/WebProjects', () => ({ ProjectsWorkspace: () => null }))

import Projects from '../pages/Projects'
import TaxLedger from '../pages/TaxLedger'
import WebInvoices from '../pages/WebInvoices'
import { resetServerListCache, SEARCH_DEBOUNCE_MS } from '../hooks/useServerList'
import { downloadBlob } from '../utils/download'
import { DEFAULT_TAX_PERIOD } from '../pages/tax/useTaxLedgerQuery'

// ── Fake servers: `total` rows in scope, paged through a cursor ─────────────

function paged(params, all, extra) {
  const start = params.cursor ? Number(params.cursor) : 0
  const limit = Number(params.limit || 50)
  const page = all.slice(start, start + limit)
  const data = { records: page, total: all.length, next_cursor: start + limit < all.length ? String(start + limit) : null }
  if (params.aggregates !== '0') Object.assign(data, extra)
  return Promise.resolve({ data, etag: `"e-${JSON.stringify(params)}"` })
}

const project = (i) => ({
  id: `recP${String(i).padStart(4, '0')}`,
  fields: { 'Project Name': `Project ${i}`, 'Client': 'Acme', 'Project Status': '🟢 Active', 'Amount Billed So far': 1000 * i },
})
const projectTotals = (n, billed) => ({
  count: n, total_billed: billed, total_profit: billed / 4, margin: 25, needs_action: Math.ceil(n / 10), blind_spots: 1,
  by_status: { '🟢 Active': n }, by_client: { Acme: n }, by_health: {},
  action_queue: [{ id: 'recP0001', name: 'Project 1', health: 'Critical', rank: 3 }],
  highest_exposure: { id: 'recP0001', name: 'Project 1', billed },
})
function projectServer({ total = 130, filtered = 6 } = {}) {
  return (params) => {
    const narrowed = !!(params.q || params.status || params.client)
    const n = narrowed ? filtered : total
    return paged(params, Array.from({ length: n }, (_, i) => project(i + 1)), {
      aggregates: narrowed ? projectTotals(n, 42_000) : projectTotals(n, 9_000_000),
      workspace: { ...projectTotals(total, 9_000_000), facets: { clients: ['Acme'], statuses: ['🟢 Active'] } },
    })
  }
}

const invoice = (i, extra = {}) => ({
  id: `recI${String(i).padStart(4, '0')}`,
  fields: {
    'Invoice Number': `INV-${i}`, 'Project': 'Bolt', 'Client Name': 'Acme', 'Payment Status': 'Paid',
    'Raised Date': '2026-05-10T12:00:00.000Z', 'Amount Raised': 1000, 'Amount with Tax': 1180, 'Amount Received': 1080,
    ...extra,
  },
})
const taxBlock = (paid, open) => ({
  paid: { count: paid, taxable: paid * 1000, gst: paid * 180, tds: paid * 100, gross: paid * 1180, received: paid * 1080, outstanding: 0 },
  open: { count: open, taxable: open * 1000, gst: 0, tds: 0, gross: open * 1180, received: 0, outstanding: open * 1180, oldest: 45 },
  scope_counts: { tax: paid, open, all: paid + open },
  months: [{ key: '2026-05', count: paid, taxable: paid * 1000, gst: paid * 180, tds: paid * 100, gross: paid * 1180, received: paid * 1080, outstanding: 0 }],
  clients: [{ client: 'Acme', count: paid, taxable: paid * 1000, gst: paid * 180, tds: paid * 100, gross: paid * 1180, received: paid * 1080, outstanding: 0 }],
})
function taxServer({ total = 75, filtered = 3 } = {}) {
  return (params) => {
    const n = params.q ? filtered : total
    return paged(params, Array.from({ length: n }, (_, i) => invoice(i + 1)), {
      aggregates: params.q ? taxBlock(filtered, 1) : taxBlock(total, 9),
      workspace: taxBlock(total, 9),
    })
  }
}

const currency = (n, raised) => ({
  count: n, pending_count: 1, raised, with_tax: raised * 1.18, gst: raised * 0.18, tds: 0, received: raised / 2,
  outstanding: raised / 2, collection_rate: 42.4,
  totals: { amount_raised: raised, amount_with_tax: raised * 1.18, amount_received: raised / 2, outstanding: raised / 2 },
})
const webTotals = (n, raised) => ({
  count: n, active_count: n, raised, with_tax: raised, collected: raised / 2, outstanding: raised / 2, overdue_count: 0,
  by_status: { Paid: { count: n - 1, amount: raised }, Pending: { count: 1, amount: 10 } },
  by_currency: { RS: currency(n, raised) },
  by_project: [{ project: 'Bolt', count: n, raised, received: raised / 2, outstanding: raised / 2, by_currency: { RS: currency(n, raised) }, currencies: ['RS'] }],
  project_count: 1, aging: {}, raised_months: [], cleared_months: [], totals: {},
})
function webServer({ total = 120, filtered = 7 } = {}) {
  return (params) => {
    const narrowed = !!(params.q || params.status || params.project)
    const n = narrowed ? filtered : total
    return paged(params, Array.from({ length: n }, (_, i) => invoice(i + 1, { Currency: 'RS' })), {
      aggregates: narrowed ? webTotals(n, 250_000) : webTotals(n, 9_000_000),
      workspace: { ...webTotals(total, 9_000_000), facets: { months: ['2026-05'] }, overdue_top: [], recent_projects: [] },
    })
  }
}

function deferred() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

let location = null
function Where() {
  location = useLocation()
  return null
}
const at = (url, page) => render(<MemoryRouter initialEntries={[url]}>{page}<Where /></MemoryRouter>)
const calls = (fn) => fn.mock.calls.map(([p]) => p)

beforeEach(() => {
  vi.clearAllMocks()
  resetServerListCache()
  state.projects = projectServer()
  state.invoices = taxServer()
  state.web = webServer()
  location = null
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb) { this.cb = cb }
    observe(el) { this.cb([{ isIntersecting: true, target: el }]) }
    unobserve() {} disconnect() {}
  })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  window.matchMedia = window.matchMedia || (q => ({
    matches: false, media: q, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const typeSearch = async (label, words) => {
  const box = screen.getByRole('textbox', { name: label })
  for (const w of words) fireEvent.change(box, { target: { value: w } })
}
const settle = () => act(async () => { await new Promise(r => setTimeout(r, SEARCH_DEBOUNCE_MS + 80)) })

// ── Projects ───────────────────────────────────────────────────────────────

const statCard = (label) => screen.getByText(label, { selector: '.executive-stat-label' }).closest('.executive-stat-card')

describe('Projects on GET /api/projects/query', () => {
  it('asks once on load, StrictMode included, and no longer polls Teable', async () => {
    render(<StrictMode><MemoryRouter initialEntries={['/projects']}><Projects /></MemoryRouter></StrictMode>)
    await waitFor(() => expect(statCard('Cashflow summary').textContent).toContain('90,00,000'))
    await act(async () => { await new Promise(r => setTimeout(r, 40)) })
    expect(api.projects.query).toHaveBeenCalledTimes(1)
    expect(calls(api.projects.query)[0]).toMatchObject({ limit: '48' })
    expect(api.projects.list).not.toHaveBeenCalled()
    expect(api.projects.search).not.toHaveBeenCalled()
  })

  it('debounces the search into one request and one URL entry', async () => {
    at('/projects', <Projects />)
    await waitFor(() => expect(api.projects.query).toHaveBeenCalledTimes(1))
    await typeSearch('Search projects', ['a', 'ac', 'acm', 'acme'])
    expect(api.projects.query).toHaveBeenCalledTimes(1)
    await settle()
    await waitFor(() => expect(api.projects.query).toHaveBeenCalledTimes(2))
    expect(calls(api.projects.query)[1]).toMatchObject({ q: 'acme' })
    expect(location.search).toBe('?q=acme')
  })

  it('aborts the request a newer search replaced', async () => {
    const slow = deferred()
    const signals = []
    state.projects = (p, o) => { signals.push(o.signal); return p.q === 'slow' ? slow.promise : projectServer()(p) }
    at('/projects?q=slow', <Projects />)
    await waitFor(() => expect(signals).toHaveLength(1))
    await typeSearch('Search projects', ['fast'])
    await settle()
    await waitFor(() => expect(signals[0].aborted).toBe(true))
    expect(signals.at(-1).aborted).toBe(false)
  })

  it('reads status, client and sort from the URL', async () => {
    at('/projects?status=active&client=BG&sort=Profit%20percentage&order=asc', <Projects />)
    await waitFor(() => expect(api.projects.query).toHaveBeenCalled())
    expect(calls(api.projects.query)[0]).toMatchObject({ status: 'active', client: 'BG', sort: 'Profit percentage', order: 'asc' })
  })

  it('KPI cards follow the search, with the portfolio figure as a hint', async () => {
    at('/projects?q=acme', <Projects />)
    await waitFor(() => expect(statCard('Cashflow summary').textContent).toContain('42,000'))
    expect(statCard('Cashflow summary').textContent).toMatch(/of ₹90,00,000 across all 130/)
    expect(statCard('Needs action').textContent).toMatch(/of 13 across all 130/)
    expect(screen.getAllByText('6 results').length).toBeGreaterThan(0)
  })

  it('"Show more" fetches the next cursor page and records it in the URL', async () => {
    at('/projects', <Projects />)
    await waitFor(() => expect(screen.getByText('Showing 48 of 130')).toBeTruthy())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Show 48 more/ })) })
    await waitFor(() => expect(screen.getByText('Showing 96 of 130')).toBeTruthy())
    expect(calls(api.projects.query).at(-1)).toMatchObject({ cursor: '48', aggregates: '0', limit: '48' })
    expect(location.search).toContain('page=2')
  })

  it('offers a way out when nothing matches', async () => {
    state.projects = projectServer({ filtered: 0 })
    at('/projects?q=zzz&status=active', <Projects />)
    await screen.findByText('No results found')
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Search all projects' })) })
    await waitFor(() => expect(calls(api.projects.query).some(p => p.q === 'zzz' && !p.status)).toBe(true))
  })
})

// ── Tax Ledger ─────────────────────────────────────────────────────────────

const taxCard = (label) => screen.getByText(label).parentElement

describe('Tax Ledger on GET /api/invoices/query', () => {
  it('asks once on load, for the paid register of the financial year', async () => {
    render(<StrictMode><MemoryRouter initialEntries={['/tax']}><TaxLedger /></MemoryRouter></StrictMode>)
    await waitFor(() => expect(taxCard('Taxable Value').textContent).toContain('75,000'))
    await act(async () => { await new Promise(r => setTimeout(r, 40)) })
    expect(api.invoices.query).toHaveBeenCalledTimes(1)
    expect(calls(api.invoices.query)[0]).toMatchObject({ tax_scope: 'tax', period: DEFAULT_TAX_PERIOD, limit: '50' })
    expect(api.invoices.list).not.toHaveBeenCalled()
  })

  it('the cards follow the search, with the whole period as the "of all" hint', async () => {
    at('/tax?q=acme', <TaxLedger />)
    await waitFor(() => expect(taxCard('GST Collected Total').textContent).toContain('₹540'))
    expect(taxCard('GST Collected Total').textContent).toMatch(/of ₹13,500 across all 75 in the period/)
    expect(taxCard('Open Invoices').textContent).toMatch(/across all 9 in the period/)
  })

  it('debounces the search and keeps period and scope in the URL', async () => {
    at('/tax', <TaxLedger />)
    await waitFor(() => expect(api.invoices.query).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByRole('combobox', { name: 'Period' }), { target: { value: 'q3-2026' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Register scope' }), { target: { value: 'open' } })
    await typeSearch('Search invoices', ['b', 'bo', 'bolt'])
    await settle()
    await waitFor(() => expect(calls(api.invoices.query).at(-1)).toMatchObject({ period: 'q3-2026', tax_scope: 'open', q: 'bolt' }))
    expect(calls(api.invoices.query).filter(p => p.q).length).toBe(1)
    expect(location.search).toContain('period=q3-2026')
    expect(location.search).toContain('scope=open')
  })

  it('a custom range asks for those days', async () => {
    at('/tax?period=custom&from=2026-02-01&to=2026-02-20', <TaxLedger />)
    await waitFor(() => expect(api.invoices.query).toHaveBeenCalled())
    expect(calls(api.invoices.query)[0]).toMatchObject({ date_from: '2026-02-01', date_to: '2026-02-20' })
    expect(calls(api.invoices.query)[0].period).toBeUndefined()
  })

  it('exports the whole register from the server', async () => {
    at('/tax?q=acme&scope=all', <TaxLedger />)
    await waitFor(() => expect(taxCard('Taxable Value').textContent).toContain('3,000'))
    await act(async () => { fireEvent.click(screen.getByTitle('Download the whole register as CSV')) })
    await waitFor(() => expect(api.invoices.exportCsv).toHaveBeenCalledTimes(1))
    expect(api.invoices.exportCsv.mock.calls[0][0]).toMatchObject({ q: 'acme', tax_scope: 'all', columns: 'tax', period: DEFAULT_TAX_PERIOD })
    expect(downloadBlob).toHaveBeenCalled()
  })

  it('pages the register with "Show more"', async () => {
    at('/tax', <TaxLedger />)
    await waitFor(() => expect(api.invoices.query).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'All Invoices' }))
    await waitFor(() => expect(screen.getByText('Showing 50 of 75')).toBeTruthy())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Show 25 more/ })) })
    await waitFor(() => expect(screen.getByText('Showing 75 of 75')).toBeTruthy())
    expect(calls(api.invoices.query).at(-1)).toMatchObject({ cursor: '50', aggregates: '0' })
  })

  it('opening a month fetches just that month', async () => {
    at('/tax', <TaxLedger />)
    await waitFor(() => expect(api.invoices.query).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }))
    await act(async () => { fireEvent.click(await screen.findByText(/May 26/, { selector: 'td' })) })
    await waitFor(() => expect(calls(api.invoices.query).some(p => p.month === '2026-05' && p.tax_scope === 'tax')).toBe(true))
  })

  it('inside the web module it reads web invoices, under its own URL names', async () => {
    at('/?tab=tax&tax_q=acme', <TaxLedger source="web" />)
    await waitFor(() => expect(api.webInvoices.query).toHaveBeenCalled())
    expect(calls(api.webInvoices.query)[0]).toMatchObject({ q: 'acme', tax_scope: 'tax' })
    expect(api.invoices.query).not.toHaveBeenCalled()
  })
})

// ── Web Invoices ───────────────────────────────────────────────────────────

const kpi = (label) => screen.getByText(label).closest('.card')

describe('Web Invoices on GET /api/web-invoices/query', () => {
  it('asks for the list once on load, and not for the summary', async () => {
    render(<StrictMode><MemoryRouter initialEntries={['/?tab=invoices']}><WebInvoices /></MemoryRouter></StrictMode>)
    await waitFor(() => expect(kpi('Total Raised (₹)').textContent).toContain('90,00,000'))
    await act(async () => { await new Promise(r => setTimeout(r, 40)) })
    const lists = calls(api.webInvoices.query).filter(p => !p.billing && !p.date_from && !p.sort)
    expect(lists).toHaveLength(1)
    expect(lists[0].limit).toBe('50')
    expect(api.webInvoices.list).not.toHaveBeenCalled()
    expect(api.webInvoices.summary).not.toHaveBeenCalled()
  })

  it('KPI cards follow the filters, with the all-invoices figure as a hint', async () => {
    at('/?tab=invoices&q=acme', <WebInvoices />)
    await waitFor(() => expect(kpi('Total Raised (₹)').textContent).toContain('2,50,000'))
    expect(kpi('Total Raised (₹)').textContent).toMatch(/of ₹90,00,000 across all 120/)
    expect(screen.getAllByText('7 results').length).toBeGreaterThan(0)
  })

  it('debounces the search and writes it to the URL', async () => {
    at('/?tab=invoices', <WebInvoices />)
    await waitFor(() => expect(api.webInvoices.query).toHaveBeenCalled())
    const before = api.webInvoices.query.mock.calls.length
    await typeSearch('Search invoices', ['b', 'bo', 'bolt'])
    await settle()
    await waitFor(() => expect(calls(api.webInvoices.query).some(p => p.q === 'bolt')).toBe(true))
    expect(api.webInvoices.query.mock.calls.length - before).toBe(1)
    expect(location.search).toContain('q=bolt')
  })

  it('aborts the request a newer filter replaced', async () => {
    const slow = deferred()
    const signals = []
    state.web = (p, o) => { signals.push(o.signal); return p.status === 'Paid' ? slow.promise : webServer()(p) }
    at('/?tab=invoices&status=Paid', <WebInvoices />)
    await waitFor(() => expect(signals).toHaveLength(1))
    expect(signals[0].aborted).toBe(false)
    await typeSearch('Search invoices', ['x'])
    await settle()
    await waitFor(() => expect(signals[0].aborted).toBe(true))
    expect(signals.at(-1).aborted).toBe(false)
    expect(calls(api.webInvoices.query).at(-1)).toMatchObject({ q: 'x', status: 'Paid' })
  })

  it('"Show more" fetches the next cursor page', async () => {
    at('/?tab=invoices', <WebInvoices />)
    await waitFor(() => expect(screen.getAllByText('Showing 50 of 120').length).toBeGreaterThan(0))
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /Show 50 more/ })[0]) })
    await waitFor(() => expect(screen.getAllByText('Showing 100 of 120').length).toBeGreaterThan(0))
    expect(calls(api.webInvoices.query).some(p => p.cursor === '50' && p.aggregates === '0')).toBe(true)
  })

  it('exports the filtered scope from the server', async () => {
    at('/?tab=invoices&q=acme&status=Paid', <WebInvoices />)
    await waitFor(() => expect(kpi('Total Raised (₹)').textContent).toContain('2,50,000'))
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }))
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Filtered \(7\)/ })) })
    await waitFor(() => expect(api.webInvoices.exportCsv).toHaveBeenCalledTimes(1))
    expect(api.webInvoices.exportCsv.mock.calls[0][0]).toMatchObject({ q: 'acme', status: 'Paid' })
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'invoices_filtered_2026-10-30.csv')
  })
})

// ── The tax figures the old browser code gave ──────────────────────────────

describe('tax ledger fixture', () => {
  it.each(fixture.cases.map(c => [c.period || 'custom', c]))('%s: the old browser maths give the recorded figures', (_, c) => {
    const got = legacyTaxLedger(fixture.records, c)
    const close = (a, b) => expect(Math.abs(a - b)).toBeLessThan(0.011)
    for (const k of ['taxable', 'gstAmt', 'tdsAmt', 'gross', 'received', 'outstanding']) close(got.totals[k], c.expected.totals[k])
    expect(got.totals.count).toBe(c.expected.totals.count)
    expect(got.openSummary).toEqual(c.expected.openSummary)
    expect(got.monthlyRows.map(m => m.key)).toEqual(c.expected.monthlyRows.map(m => m.key))
    expect(got.clientRows.map(r => r.client).sort()).toEqual(c.expected.clientRows.map(r => r.client).sort())
    for (const scope of ['tax', 'open', 'all']) {
      expect(legacyTaxLedger(fixture.records, c, { invoiceScope: scope }).scopeIds).toEqual(c.expected.scopes[scope])
    }
  })
})
