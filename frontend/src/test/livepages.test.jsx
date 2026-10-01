/**
 * The six pages that poll, rendered for real.
 *
 * Every figure on these pages was changed to carry live motion, and none of
 * them had a page-level test. That gap let a genuine defect through: passing
 * a React element to a card that stringifies its value printed the literal
 * text "[object Object]" on three of the most prominent figures in the app,
 * with the build green and the whole suite passing.
 *
 * So these assert the two things a unit test of the component cannot: that the
 * page mounts at all with its real data shape, and that every figure on it
 * renders as a figure rather than as a stringified object.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Profiler } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { api } from '../services/api'

/* Hoisted so the vi.mock factory below can use them: vi.mock is lifted above
   ordinary top-level declarations, which a plain const would fall foul of. */
const { summary, invoiceRecord, projectRecord, list } = vi.hoisted(() => {
  const summary = {
    total_billed: 4820000, total_profit: 1260000, total_cost: 3560000,
    total_projects: 12, target_achieved_count: 7, avg_profit_pct: 26.1,
    by_health: { '🟢 Healthy': 9, '🔴 At risk': 3 },
    by_client: { 'Acme': 2400000, 'Globex': 1180000 },
    total_raised: 4820000, total_received: 3900000, total_outstanding: 920000,
    total_with_tax: 5687600, collection_rate: 80.9, active_invoices: 18,
    by_status: { Paid: 14, Pending: 4 },
  }

  const invoiceRecord = (id, status = 'Pending') => ({
    id,
    fields: {
      'Invoice Number': `INV-${id}`, 'Client Name': 'Acme', 'Project': 'Rebrand',
      'Payment Status': status, 'Amount': 120000, 'Outstanding Amount': status === 'Paid' ? 0 : 120000,
      'Raised Date': '2026-09-01', 'Due Date': '2026-09-30', 'Category': 'Retainer',
      'GST Amount': 21600, 'TDS Amount': 12000, 'Currency': 'RS',
    },
  })

  const projectRecord = (id) => ({
    id,
    fields: {
      'Project Name': `Project ${id}`, 'Client Name': 'Acme', 'Status': 'Active',
      'Health': '🟢 Healthy', 'Amount Billed So far': 480000, 'Profit': 120000,
      'Profit %': 25, 'Total Cost': 360000,
    },
  })

  const list = (records) => ({ records })

  return { summary, invoiceRecord, projectRecord, list }
})

vi.mock('../services/api', () => {
  const ok = (v) => vi.fn().mockResolvedValue(v)

  /* These pages call a wide API surface, and the point of this file is whether
     they render — not whether the fixture author remembered every endpoint. An
     unlisted call resolves to an empty result instead of throwing, so a missing
     mock cannot masquerade as a rendering failure. */
  // Memoised per proxy. Handing back a fresh identity on every property access
  // makes any dependency array that mentions an api member change on every
  // render, which spins the page in an infinite render loop — a hang with no
  // failing assertion, because the loop never yields for the timeout to fire.
  const anything = () => {
    const own = new Map()
    return new Proxy(function () {}, {
      get(target, key) {
        if (typeof key === 'symbol') return undefined
        if (key === 'then') return undefined      // must not look like a promise
        if (!own.has(key)) own.set(key, anything())
        return own.get(key)
      },
      apply: () => Promise.resolve({ records: [] }),
    })
  }

  // Each namespace gets the same fallback, not just the root — otherwise a
  // listed namespace is a closed set and one unlisted method on it throws.
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

  const explicit = {
    projects: ns({
      summary: ok(summary),
      list:    ok(list([projectRecord('p1'), projectRecord('p2')])),
      search:  ok(list([])),
    }),
    invoices: ns({
      summary:      ok(summary),
      list:         ok(list([invoiceRecord('i1'), invoiceRecord('i2', 'Paid')])),
      agingBuckets: ok({ buckets: [] }),
    }),
    webInvoices: ns({
      summary:      ok(summary),
      list:         ok(list([invoiceRecord('w1')])),
      agingBuckets: ok({ buckets: [] }),
      avatarMap:    ok({}),
      picklists:    ns({ get: ok({}) }),
    }),
  }

  const api = ns(explicit)

  return { api, API_BASE_URL: '', getAuthToken: () => '', setAuthToken: vi.fn(), clientCacheBust: vi.fn() }
})

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    status: 'authed', role: 'superadmin', isAdmin: true, isViewer: false,
    isWeb: false, isAll: false, isEditor: true, isImpersonating: false,
    user: { email: 'a@b.c' },
    hasPerm: () => true,
  }),
  AuthProvider: ({ children }) => children,
}))
vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ dark: false, toggle: vi.fn() }),
  ThemeProvider: ({ children }) => children,
}))
vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() }),
  ToastProvider: ({ children }) => children,
}))
vi.mock('../hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }))
vi.mock('../context/ConfirmContext', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
  ConfirmProvider: ({ children }) => children,
}))

beforeEach(() => {
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
})

const PAGES = [
  ['Dashboard',  () => import('../pages/Dashboard'),  /4,82,0,000|12,60,000/],
  ['Invoices',   () => import('../pages/Invoices'),   /4,82,0,000|48,20,000/],
  ['Analytics',  () => import('../pages/Analytics'),  null],
  ['Projects',   () => import('../pages/Projects'),   null],
  ['TaxLedger',  () => import('../pages/TaxLedger'),  null],
  // The page the "[object Object]" defect actually shipped to.
  ['WebInvoices', () => import('../pages/WebInvoices'), null],
]

describe.each(PAGES)('%s', (name, load) => {
  it('mounts and renders no stringified objects', async () => {
    const Page = (await load()).default
    const { container } = render(<MemoryRouter><Page /></MemoryRouter>)
    // Let the polling hook's first resolve land.
    await waitFor(() => expect(container.textContent.length).toBeGreaterThan(50))
    expect(container.textContent).not.toContain('[object Object]')
    expect(container.textContent).not.toContain('NaN')
    expect(container.textContent).not.toContain('undefined')
  })
})

describe('the figures actually arrive', () => {
  it('Dashboard shows its revenue and profit, not placeholders', async () => {
    const Page = (await import('../pages/Dashboard')).default
    render(<MemoryRouter><Page /></MemoryRouter>)
    // ₹48,20,000 with Indian grouping — proves LiveValue wrote real text into
    // the ref-owned node rather than leaving it empty.
    expect(await screen.findAllByText(/48,20,000/, {}, { timeout: 5000 })).not.toHaveLength(0)
    expect(screen.getAllByText(/12,60,000/).length).toBeGreaterThan(0)
  })
})

/**
 * The render loop this file found.
 *
 * WebInvoices hoisted `listData?.records || []` into a variable and used that
 * variable as an effect dependency. The fallback builds a fresh array on every
 * render, so the effect fired every render, set state, and rendered again —
 * for as long as listData was undefined. That is every initial load until the
 * first fetch resolves, and forever if it fails, which is a pinned CPU on a
 * user's machine rather than a cosmetic problem.
 *
 * Mounting the page is not enough to catch it, because with data on hand the
 * loop stops. This holds the first fetch open, which is when it spins.
 */
describe('WebInvoices while its first fetch is still open', () => {
  it('settles instead of re-rendering itself', async () => {
    api.webInvoices.list.mockImplementation(() => new Promise(() => {}))
    try {
      const Page = (await import('../pages/WebInvoices')).default
      let commits = 0
      // Counted and capped inside the commit itself, not measured after a
      // timer. The loop starves the event loop so completely that a 400ms
      // setTimeout did not fire in 150 seconds — so a test that waits for a
      // timer to check the count hangs instead of failing, and a hang is a
      // much worse signal than a red assertion.
      const onRender = () => {
        commits += 1
        if (commits > 200) throw new Error(`render loop: ${commits} commits with no new data`)
      }
      expect(() => render(
        <Profiler id="webinvoices" onRender={onRender}>
          <MemoryRouter><Page /></MemoryRouter>
        </Profiler>,
      )).not.toThrow()
      await new Promise(resolve => setTimeout(resolve, 300))
      expect(commits).toBeLessThan(40)
    } finally {
      api.webInvoices.list.mockResolvedValue(list([invoiceRecord('w1')]))
    }
  })
})
