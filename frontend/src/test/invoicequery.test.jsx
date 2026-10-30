/**
 * The Invoices page's data: one hook asks GET /api/invoices/query for a page
 * of rows and the totals of the filtered scope and of the workspace.
 *
 * The hook: the search is debounced before it reaches the URL and the
 * server; a request nobody wants any more is aborted; identical requests in
 * flight are one request (StrictMode's double mount included); the old rows
 * stay while the next answer loads; the URL is the source of the filters.
 *
 * The page: the KPI cards follow the search and filters and say what the
 * whole workspace holds; "Show more" fetches the next keyset page; Export
 * CSV asks the server for the whole filtered scope.
 */
import { StrictMode, useEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'

const { api, state, toastFn } = vi.hoisted(() => {
  const state = { respond: null }
  const pathOf = (params = {}) => {
    const q = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => v != null && v !== '' && v !== false && q.set(k, v === true ? '1' : v))
    return `/api/invoices/query?${q}`
  }
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
  const api = ns({
    invoices: ns({
      queryPath: pathOf,
      query: vi.fn((params, opts) => state.respond(params, opts)),
      exportCsv: vi.fn().mockResolvedValue({ blob: new Blob(['Invoice Number\n']), filename: 'invoices_filtered_2026-10-30.csv' }),
      picklists: vi.fn().mockResolvedValue({}),
      get: vi.fn().mockResolvedValue(null),
    }),
    webInvoices: ns({ avatarMap: vi.fn().mockResolvedValue({}) }),
    projects: ns({ names: vi.fn().mockResolvedValue([]) }),
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
    user: { email: 'a@b.c' }, userEmail: 'a@b.c', hasPerm: () => true,
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

import Invoices from '../pages/Invoices'
import { downloadBlob } from '../utils/download'
import {
  resetInvoiceQueryCache, SEARCH_DEBOUNCE_MS, useInvoiceFilters, useInvoiceQuery,
} from '../pages/invoices/useInvoiceQuery'

// ── Fixtures ────────────────────────────────────────────────────────────────

const rec = (i, extra = {}) => ({
  id: `rec${String(i).padStart(4, '0')}`,
  fields: {
    'Invoice Number': `INV-${i}`, 'Project': i % 2 ? 'Acme Retainer' : 'Bolt', 'Client Name': 'Acme',
    'Category': i % 2 ? 'Development- Retainer' : 'Build', 'Payment Status': i % 3 ? 'Paid' : 'Pending',
    'Raised Date': '2026-10-01T00:00:00.000Z', 'Amount Raised': 1000 + i, ...extra,
  },
})

const totals = (n, raised) => ({
  count: n, paid_count: n - 1, pending_count: 1, cancelled_count: 0, active_count: n,
  raised, with_tax: raised * 1.18, gst: raised * 0.18, tds: 0, collected: raised * 0.5, outstanding: raised * 0.5,
  collection_rate: 42.5, overdue_count: 0, followups_due: 1, missing_docs: 2, open_amount: raised * 0.5,
  totals: { amount_raised: raised, amount_with_tax: raised * 1.18, amount_received: raised * 0.5, outstanding: raised * 0.5, outstanding_raw: raised * 0.5 },
  by_status: { Paid: { count: n - 1, amount: raised }, Pending: { count: 1, amount: 10 } },
  by_project: [{ project: 'Acme Retainer', count: n, raised, received: raised / 2, outstanding: raised / 2 }],
  aging: { '0-14d': { count: 1, amount: 10 }, '15-30d': { count: 0, amount: 0 }, '31-60d': { count: 0, amount: 0 }, '60d+': { count: 0, amount: 0 } },
  raised_months: [{ key: '2026-10', count: n, amount: raised, base: raised, gross: raised, gst: 0, received: 0, deduction: 0, outstanding: 0 }],
  cleared_months: [],
})

const WORKSPACE = {
  ...totals(120, 9_000_000),
  by_project: [{ project: 'Acme Retainer', count: 60, raised: 7_000_000, received: 1, outstanding: 1 }],
  facets: { projects: ['Acme Retainer', 'Bolt'], clients: ['Acme'], categories: ['Build'], milestones: [], raised_by: [], months: ['2026-10'], statuses: ['Paid', 'Pending'] },
  recent_projects: [], overdue_top: [],
}

/** A server: `total` rows in scope, served in pages through a cursor. */
function server({ total = 120, filteredTotal = 7 } = {}) {
  return (params) => {
    const filtered = !!(params.q || params.status || params.project)
    const n = filtered ? filteredTotal : total
    const all = Array.from({ length: n }, (_, i) => rec(i + 1))
    const start = params.cursor ? Number(params.cursor) : 0
    const limit = Number(params.limit || 50)
    const page = all.slice(start, start + limit)
    const data = {
      records: page, total: n, next_cursor: start + limit < n ? String(start + limit) : null,
      limit, sort: 'Raised Date', order: 'desc', filtered, source: 'mirror',
    }
    if (params.aggregates !== '0') {
      data.aggregates = filtered ? totals(n, 250_000) : totals(n, 9_000_000)
      data.workspace = WORKSPACE
    }
    return Promise.resolve({ data, etag: `"e-${JSON.stringify(params)}"` })
  }
}

function deferred() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

function Probe({ onRender, query = true }) {
  const f = useInvoiceFilters()
  const q = useInvoiceQuery(f.filters, { pages: f.pages, onPagesChange: f.setPages, pollMs: 0, enabled: query })
  const loc = useLocation()
  const navigate = useNavigate()
  useEffect(() => { onRender({ ...f, ...q, search: loc.search, navigate }) })
  return null
}

const queryCalls = () => api.invoices.query.mock.calls.map(([p]) => p)

beforeEach(() => {
  vi.clearAllMocks()
  resetInvoiceQueryCache()
  state.respond = server()
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

// ── The hook ───────────────────────────────────────────────────────────────

describe('useInvoiceQuery / useInvoiceFilters', () => {
  it('debounces the search: one request for a burst of keystrokes, after the pause', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let last
    render(<MemoryRouter initialEntries={['/invoices']}><Probe onRender={s => { last = s }} /></MemoryRouter>)
    await waitFor(() => expect(api.invoices.query).toHaveBeenCalledTimes(1))
    for (const text of ['a', 'ac', 'acm', 'acme']) {
      act(() => last.setSearchInput(text))
      await act(async () => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS / 3) })
    }
    expect(api.invoices.query).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS) })
    await waitFor(() => expect(api.invoices.query).toHaveBeenCalledTimes(2))
    expect(queryCalls()[1].q).toBe('acme')
    expect(last.search).toBe('?q=acme')
  })

  it('aborts the request a newer scope replaced, and ignores its answer', async () => {
    const slow = deferred()
    const signals = []
    state.respond = (params, opts) => {
      signals.push(opts.signal)
      return params.status === 'Paid' ? slow.promise : server()(params)
    }
    let last
    render(<MemoryRouter initialEntries={['/invoices?status=Paid']}><Probe onRender={s => { last = s }} /></MemoryRouter>)
    await waitFor(() => expect(signals).toHaveLength(1))
    act(() => last.setFilters({ status: 'Pending' }))
    await waitFor(() => expect(signals).toHaveLength(2))
    await waitFor(() => expect(signals[0].aborted).toBe(true))
    expect(signals[1].aborted).toBe(false)
    await waitFor(() => expect(last.hasData).toBe(true))
    await act(async () => { slow.resolve({ data: { records: [rec(999)], total: 1, next_cursor: null } }) })
    expect(last.records.map(r => r.id)).not.toContain('rec0999')
  })

  it('shares one request between identical callers, StrictMode included', async () => {
    const gate = deferred()
    state.respond = (params) => gate.promise.then(() => server()(params))
    const seen = []
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/invoices?q=acme']}>
          <Probe onRender={s => seen.push(s)} />
          <Probe onRender={() => {}} />
        </MemoryRouter>
      </StrictMode>,
    )
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    gate.resolve()
    await waitFor(() => expect(seen.at(-1).hasData).toBe(true))
    expect(api.invoices.query).toHaveBeenCalledTimes(1)
    expect(api.invoices.query.mock.calls[0][1].signal.aborted).toBe(false)
  })

  it('keeps the previous rows on screen while the next scope loads', async () => {
    let last
    render(<MemoryRouter initialEntries={['/invoices']}><Probe onRender={s => { last = s }} /></MemoryRouter>)
    await waitFor(() => expect(last.records).toHaveLength(50))
    const gate = deferred()
    state.respond = (params) => gate.promise.then(() => server()(params))
    act(() => last.setFilters({ status: 'Pending' }))
    await waitFor(() => expect(last.refreshing).toBe(true))
    expect(last.records).toHaveLength(50)          // no flash of an empty table
    expect(last.loading).toBe(false)
    gate.resolve()
    await waitFor(() => expect(last.records).toHaveLength(7))
    expect(last.total).toBe(7)
  })

  it('reads its filters from the URL and writes them back; back and forward work', async () => {
    let last
    render(<MemoryRouter initialEntries={['/invoices?q=acme&status=Paid&sort=Amount%20Raised&order=asc&page=2']}>
      <Probe onRender={s => { last = s }} />
    </MemoryRouter>)
    await waitFor(() => expect(api.invoices.query).toHaveBeenCalled())
    expect(queryCalls()[0]).toMatchObject({ q: 'acme', status: 'Paid', sort: 'Amount Raised', order: 'asc', limit: '100' })
    expect(last.searchInput).toBe('acme')

    act(() => last.setFilters({ project: 'Bolt', overdue: true }))
    await waitFor(() => expect(last.search).toContain('project=Bolt'))
    expect(last.search).toContain('overdue=1')
    expect(last.search).not.toContain('page=')    // a new scope starts at page one

    act(() => last.navigate(-1))
    await waitFor(() => expect(last.filters.project).toBe(''))
    expect(last.filters.status).toBe('Paid')
    act(() => last.navigate(1))
    await waitFor(() => expect(last.filters.project).toBe('Bolt'))
  })

  it('loads the next page through the cursor and records it in the URL', async () => {
    let last
    render(<MemoryRouter initialEntries={['/invoices']}><Probe onRender={s => { last = s }} /></MemoryRouter>)
    await waitFor(() => expect(last.records).toHaveLength(50))
    await act(async () => { await last.loadMore() })
    await waitFor(() => expect(last.records).toHaveLength(100))
    const more = queryCalls().at(-1)
    expect(more).toMatchObject({ cursor: '50', aggregates: '0', limit: '50' })
    expect(new Set(last.records.map(r => r.id)).size).toBe(100)
    expect(last.search).toContain('page=2')
  })
})

// ── The page ───────────────────────────────────────────────────────────────

const kpi = (label) => screen.getByText(label, { selector: '.executive-stat-label' }).closest('.executive-stat-card')

describe('Invoices page on the server-side list', () => {
  it('KPI cards follow the search and filters, with the workspace figure as a hint', async () => {
    render(<MemoryRouter initialEntries={['/invoices?q=acme']}><Invoices /></MemoryRouter>)
    await waitFor(() => expect(kpi('Total raised').textContent).toContain('2,50,000'))
    expect(kpi('Total raised').textContent).toMatch(/of ₹90,00,000 across all 120/)
    expect(screen.getAllByText('7 results').length).toBeGreaterThan(0)
  })

  it('without filters the cards show the workspace and no hint', async () => {
    render(<MemoryRouter initialEntries={['/invoices']}><Invoices /></MemoryRouter>)
    await waitFor(() => expect(kpi('Total raised').textContent).toContain('90,00,000'))
    expect(document.querySelectorAll('.invoice-kpi-of-all')).toHaveLength(0)
  })

  it('"Show more" appends the next page and counts what is shown', async () => {
    render(<MemoryRouter initialEntries={['/invoices']}><Invoices /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByText('Showing 50 of 120').length).toBeGreaterThan(0))
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /Show 50 more/ })[0]) })
    await waitFor(() => expect(screen.getAllByText('Showing 100 of 120').length).toBeGreaterThan(0))
    expect(queryCalls().some(p => p.cursor === '50' && p.aggregates === '0')).toBe(true)
    expect(document.querySelectorAll('table tbody tr.tbl-row')).toHaveLength(100)
  })

  it('exports the whole filtered scope from the server', async () => {
    render(<MemoryRouter initialEntries={['/invoices?q=acme&status=Paid']}><Invoices /></MemoryRouter>)
    await waitFor(() => expect(kpi('Total raised').textContent).toContain('2,50,000'))
    fireEvent.click(screen.getByTitle('Download invoices as CSV'))
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Filtered \(7\)/ })) })
    await waitFor(() => expect(api.invoices.exportCsv).toHaveBeenCalledTimes(1))
    expect(api.invoices.exportCsv.mock.calls[0][0]).toMatchObject({ q: 'acme', status: 'Paid' })
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'invoices_filtered_2026-10-30.csv')
  })

  it('offers a way out when nothing matches', async () => {
    state.respond = server({ filteredTotal: 0 })
    render(<MemoryRouter initialEntries={['/invoices?q=zzz&status=Paid']}><Invoices /></MemoryRouter>)
    expect((await screen.findAllByText('No invoices match')).length).toBeGreaterThan(0)
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /Search all statuses/ })[0]) })
    await waitFor(() => expect(queryCalls().some(p => p.q === 'zzz' && !p.status)).toBe(true))
  })

  it('asks for the list once on load, not once per widget', async () => {
    render(<StrictMode><MemoryRouter initialEntries={['/invoices']}><Invoices /></MemoryRouter></StrictMode>)
    await waitFor(() => expect(kpi('Total raised').textContent).toContain('90,00,000'))
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    const lists = queryCalls().filter(p => !p.date_from && !p.billing)
    expect(lists).toHaveLength(1)
    expect(lists[0].limit).toBe('50')
  })
})
