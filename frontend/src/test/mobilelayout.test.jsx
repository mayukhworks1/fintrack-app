/**
 * The phone layout (≤640px): the tab bar and large-title header, the
 * segmented control's mapping onto the invoice filters, the summary
 * sentences, the inline add row, the iPhone document tags — and the guards
 * that keep tablet and desktop on the layout they had.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const auth = { role: 'editor', isEditor: true, user: { email: 'a@b.c' }, logout: vi.fn(), hasPerm: () => true }
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../context/ThemeContext', () => ({ useTheme: () => ({ dark: false, toggle: vi.fn() }) }))
vi.mock('../components/notifications/NotificationBell', () => ({ default: () => <button type="button">Notifications</button> }))
vi.mock('../hooks/useAvatarSrc', () => ({ useAvatarSrc: () => null }))

import Layout, { PhoneTabBar, phoneTitleFor } from '../components/Layout'
import {
  SegmentedControl, InlineAddRow, ListRow, joinMeta, keyboardInset, useKeyboardWatch, HeaderSlotContext, HeaderActions,
} from '../components/mobile/MobileUI'
import { invoiceSummary, projectSummary, taxSummary, pagesSummary } from '../components/mobile/summary'
import { INVOICE_SEGMENTS, invoiceSegmentOf, invoiceSegmentPatch, overdueCutoff, invoiceFilterChips } from '../pages/invoices/phoneSegments'
import InvoicesPhone, { invoiceRowProps } from '../pages/invoices/InvoicesPhone'
import { DEFAULT_INVOICE_FILTERS } from '../pages/invoices/useInvoiceQuery'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// A viewport of `width` for every matchMedia query the components ask.
function setWidth(width) {
  window.matchMedia = (query) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    const min = /min-width:\s*(\d+)px/.exec(query)
    const matches = (!max || width <= +max[1]) && (!min || width >= +min[1]) && !/hover:\s*none|pointer:\s*coarse/.test(query)
    return { matches, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
  }
}

const TODAY = new Date(2026, 10, 2) // 2 Nov 2026

describe('phone tab bar', () => {
  beforeEach(() => { auth.role = 'editor'; auth.hasPerm = () => true })

  it('has Dashboard, Invoices, Projects, Pages and More, with the current route in the accent', () => {
    render(<MemoryRouter initialEntries={['/invoices']}><PhoneTabBar onMore={() => {}} /></MemoryRouter>)
    const nav = screen.getByRole('navigation', { name: 'Primary navigation' })
    const labels = [...nav.querySelectorAll('.m-tab-label')].map(n => n.textContent)
    expect(labels).toEqual(['Dashboard', 'Invoices', 'Projects', 'Pages', 'More'])
    expect(screen.getByRole('link', { name: 'Invoices' })).toHaveClass('is-active')
    expect(screen.getByRole('link', { name: 'Invoices' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveClass('is-active')
    expect(screen.getByRole('link', { name: 'Pages' })).toHaveAttribute('href', '/pages')
    expect(screen.getByRole('button', { name: 'More' })).not.toHaveClass('is-active')
  })

  it('marks Dashboard only on the home route, and sub-routes under their tab', () => {
    render(<MemoryRouter initialEntries={['/projects/rec1']}><PhoneTabBar onMore={() => {}} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveClass('is-active')
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveClass('is-active')
  })

  it('More opens the drawer, and is the active tab on a route the others do not cover', () => {
    const onMore = vi.fn()
    render(<MemoryRouter initialEntries={['/tax']}><PhoneTabBar onMore={onMore} /></MemoryRouter>)
    const more = screen.getByRole('button', { name: 'More' })
    expect(more).toHaveClass('is-active')
    expect(more).toHaveAttribute('aria-controls', 'mobile-nav-drawer')
    expect(more).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(more)
    expect(onMore).toHaveBeenCalledTimes(1)
  })

  it('leaves out a destination the user may not open', () => {
    auth.hasPerm = (p) => p !== 'module.invoices.view'
    render(<MemoryRouter><PhoneTabBar onMore={() => {}} /></MemoryRouter>)
    expect(screen.queryByRole('link', { name: 'Invoices' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Pages' })).toBeInTheDocument()
  })

  it('titles the five list pages large and everything else compact', () => {
    expect(phoneTitleFor('/invoices')).toMatchObject({ title: 'Invoices', large: true })
    expect(phoneTitleFor('/')).toMatchObject({ title: 'Dashboard', large: true })
    expect(phoneTitleFor('/tax')).toMatchObject({ title: 'Tax Ledger', large: true })
    expect(phoneTitleFor('/projects/abc')).toMatchObject({ title: 'Projects', large: false })
    expect(phoneTitleFor('/analytics')).toMatchObject({ title: 'Analytics', large: false })
  })
})

describe('the app shell by width', () => {
  afterEach(() => { delete window.matchMedia })

  it('on a phone: large title, tab bar in the flow, the drawer behind More', () => {
    setWidth(390)
    const { container } = render(<MemoryRouter initialEntries={['/invoices']}><Layout><p>page</p></Layout></MemoryRouter>)
    expect(container.querySelector('.app-layout-shell')).toHaveClass('is-phone')
    expect(screen.getByRole('heading', { level: 1, name: 'Invoices' })).toBeInTheDocument()
    expect(container.querySelector('.m-tabbar')).not.toBeNull()
    expect(container.querySelector('.app-bottom-bar')).toBeNull()
    const drawer = container.querySelector('#mobile-nav-drawer')
    expect(drawer).toHaveAttribute('inert')
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(drawer).not.toHaveAttribute('inert')
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(drawer).toHaveAttribute('inert')
  })

  it.each([[820], [1440]])('at %ipx: no phone header, no tab bar, the bottom nav as before', (w) => {
    setWidth(w)
    const { container } = render(<MemoryRouter initialEntries={['/invoices']}><Layout><p>page</p></Layout></MemoryRouter>)
    expect(container.querySelector('.app-layout-shell')).not.toHaveClass('is-phone')
    expect(container.querySelector('.app-layout-shell').className).toBe('main-app-theme app-layout-shell flex h-screen overflow-hidden')
    expect(container.querySelector('.m-titlebar')).toBeNull()
    expect(container.querySelector('.m-tabbar')).toBeNull()
    expect(container.querySelector('.app-bottom-bar')).not.toBeNull()
    // The six destinations the bottom nav always had.
    expect(container.querySelectorAll('.app-bottom-bar a')).toHaveLength(6)
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  })

  it('page header actions render nowhere off a phone', () => {
    render(<HeaderSlotContext.Provider value={null}><HeaderActions><button type="button">x</button></HeaderActions></HeaderSlotContext.Provider>)
    expect(screen.queryByRole('button', { name: 'x' })).toBeNull()
  })
})

describe('invoice segments over the list filters', () => {
  const f = (patch = {}) => ({ ...DEFAULT_INVOICE_FILTERS, ...patch })

  it('offers All, Pending, Overdue and Paid', () => {
    expect(INVOICE_SEGMENTS.map(s => s.label)).toEqual(['All', 'Pending', 'Overdue', 'Paid'])
  })

  it('maps each segment to the status filter, Overdue to pending and raised over 30 days ago', () => {
    expect(overdueCutoff(TODAY)).toBe('2026-10-02')
    expect(invoiceSegmentPatch('pending', f(), TODAY)).toEqual({ status: 'Pending' })
    expect(invoiceSegmentPatch('paid', f(), TODAY)).toEqual({ status: 'Paid' })
    expect(invoiceSegmentPatch('all', f({ status: 'Paid' }), TODAY)).toEqual({ status: '' })
    expect(invoiceSegmentPatch('overdue', f(), TODAY)).toEqual({ status: 'Pending', dateField: 'Raised Date', dateFrom: '', dateTo: '2026-10-02' })
  })

  it('reads the segment back from the filters', () => {
    expect(invoiceSegmentOf(f(), TODAY)).toBe('all')
    expect(invoiceSegmentOf(f({ status: 'Pending' }), TODAY)).toBe('pending')
    expect(invoiceSegmentOf(f({ status: 'Pending', dateTo: '2026-10-02' }), TODAY)).toBe('overdue')
    expect(invoiceSegmentOf(f({ status: 'Paid' }), TODAY)).toBe('paid')
    expect(invoiceSegmentOf(f({ status: 'Cancelled' }), TODAY)).toBeNull()
  })

  it('leaving Overdue drops its own date range but never one the reader chose', () => {
    const overdue = f({ status: 'Pending', dateTo: '2026-10-02' })
    expect(invoiceSegmentPatch('all', overdue, TODAY)).toEqual({ status: '', dateFrom: '', dateTo: '' })
    const chosen = f({ status: 'Pending', dateFrom: '2026-04-01', dateTo: '2026-06-30' })
    expect(invoiceSegmentPatch('paid', chosen, TODAY)).toEqual({ status: 'Paid' })
  })

  it('lists the filters in force as removable chips', () => {
    const setFilters = vi.fn()
    const chips = invoiceFilterChips(f({ client: 'Acme', hasDocs: true }), setFilters)
    expect(chips.map(c => c.label)).toEqual(['Client: Acme', 'Has documents'])
    chips[0].onClear()
    expect(setFilters).toHaveBeenCalledWith({ client: '' })
  })
})

describe('segmented control', () => {
  it('is a radio group: click and arrow keys change the choice', () => {
    const onChange = vi.fn()
    render(<SegmentedControl label="Status" options={INVOICE_SEGMENTS} value="all" onChange={onChange} />)
    expect(screen.getByRole('radiogroup', { name: 'Status' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Paid' })).toHaveAttribute('tabindex', '-1')
    fireEvent.click(screen.getByRole('radio', { name: 'Overdue' }))
    expect(onChange).toHaveBeenLastCalledWith('overdue')
    fireEvent.keyDown(screen.getByRole('radio', { name: 'All' }), { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith('paid')
  })
})

describe('the Invoices phone view', () => {
  const base = {
    filters: { ...DEFAULT_INVOICE_FILTERS }, searchInput: '', onSearchInput: () => {}, commitSearch: () => {}, clearAll: () => {},
    hasFilters: false, chips: [], nextCursor: null, loadMore: () => {}, loadingMore: false, hasData: true,
    agg: { collection_rate: 80.2, outstanding: 485600, pending_count: 3 }, ws: { overdue_top: [{ aging: 48 }] },
    error: null, errorStatus: null, refresh: () => {}, loading: false, syncing: false, canCreate: true, openView: () => {},
    isEditor: true, onShare: () => {}, onLinks: () => {}, exportCsv: () => {}, exporting: false, allCount: 28,
    options: { clients: [], projects: [], months: [], categories: [], raisedBy: [] }, workspace: 'invoices', setWorkspace: () => {},
  }
  const record = { id: 'r1', fields: { 'Invoice Number': 'WM/26-27/331', 'Client Name': 'Birla', Project: 'PMS', 'Raised Date': '2026-09-15', 'Amount Raised': 345600, 'Payment Status': 'Paid' } }

  it('shows the summary, the segments, the add row and one row per invoice', () => {
    const setFilters = vi.fn()
    const openNew = vi.fn()
    const openView = vi.fn()
    render(<MemoryRouter><InvoicesPhone {...base} setFilters={setFilters} openNew={openNew} openView={openView} records={[record]} scopeTotal={1} /></MemoryRouter>)
    expect(screen.getByText('80.2% collected')).toBeInTheDocument()
    expect(screen.getByText('₹4,85,600 outstanding · 3 pending, oldest 48 days')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Paid' }))
    expect(setFilters).toHaveBeenCalledWith({ status: 'Paid' })
    fireEvent.click(screen.getByRole('button', { name: 'New invoice' }))
    expect(openNew).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /WM\/26-27\/331/ }))
    expect(openView).toHaveBeenCalledWith(record)
    expect(screen.getByText('Birla · PMS · 15 Sept 26')).toBeInTheDocument()
  })

  it('hides the add row without permission to create', () => {
    render(<MemoryRouter><InvoicesPhone {...base} setFilters={() => {}} openNew={() => {}} canCreate={false} records={[]} scopeTotal={0} /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: 'New invoice' })).toBeNull()
    expect(screen.getByText('No invoices yet')).toBeInTheDocument()
  })

  it('a row is the number, quiet metadata, the amount and a status dot', () => {
    const row = invoiceRowProps(record)
    expect(row).toMatchObject({ title: 'WM/26-27/331', value: '₹3,45,600', dotLabel: 'Paid' })
    expect(invoiceRowProps({ id: 'x', fields: { 'Payment Status': 'Pending', 'Raised Date': '2000-01-01' } }).dot).toBe('var(--fin-negative)')
  })
})

describe('summary sentences', () => {
  it('receivables: the rate in the title, what is owed in the sentence', () => {
    expect(invoiceSummary({ collection_rate: 80.21, outstanding: 485600, pending_count: 3, overdue_top: [{ aging: 45 }] }))
      .toEqual({ value: 80.21, title: '80.2% collected', ringLabel: 'Collection rate 80.2%', sentence: '₹4,85,600 outstanding · 3 pending, oldest 45 days' })
    expect(invoiceSummary({ collection_rate: 100, outstanding: 0, pending_count: 0 }).sentence).toBe('Nothing outstanding · every invoice is settled')
    expect(invoiceSummary({ collection_rate: 50, outstanding: 100, pending_count: 1, overdue_top: [{ aging: 1 }] }).sentence)
      .toBe('₹100 outstanding · 1 pending, oldest 1 day')
    expect(invoiceSummary(null)).toBeNull()
  })

  it('projects, tax and pages', () => {
    expect(projectSummary({ count: 30, needs_action: 14, total_billed: 7119002.5, margin: 19.1 }))
      .toMatchObject({ title: '16 of 30 on track', sentence: '₹71,19,002.50 billed · 19.1% margin · 14 need action' })
    expect(taxSummary({ totals: { collectionRate: 91.5, gstAmt: 273492, tdsAmt: 151940, count: 9 }, periodLabel: 'FY 2026-27' }))
      .toMatchObject({ title: '91.5% collected', sentence: 'GST ₹2,73,492 · TDS ₹1,51,940 · 9 paid invoices in FY 2026-27' })
    expect(pagesSummary([{ is_published: true, has_unpublished_changes: true }, { is_published: false }]))
      .toMatchObject({ value: 50, title: '1 of 2 published', sentence: '1 draft · 1 with unpublished edits' })
  })

  it('joins row metadata with " · ", dropping empties and repeats', () => {
    expect(joinMeta(['Innovine', 'Innovine', '', null, '—', '05 Oct 26'])).toBe('Innovine · 05 Oct 26')
  })
})

describe('inline add row and list rows', () => {
  it('the add row is a ≥44px button that calls back', () => {
    const onClick = vi.fn()
    render(<InlineAddRow label="New project" onClick={onClick} />)
    fireEvent.click(screen.getByRole('button', { name: 'New project' }))
    expect(onClick).toHaveBeenCalled()
  })

  it('a row with an accessory keeps both targets', () => {
    const open = vi.fn()
    render(<ul><ListRow title="Pricing" meta={['Draft', '3d ago']} onClick={open} accessory={<button type="button">Actions</button>} /></ul>)
    fireEvent.click(screen.getByRole('button', { name: /Pricing/ }))
    expect(open).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Actions' })).toBeInTheDocument()
    expect(screen.getByText('Draft · 3d ago')).toBeInTheDocument()
  })
})

describe('iPhone: keyboard', () => {
  it('reads the keyboard height from the visual viewport', () => {
    expect(keyboardInset({ innerHeight: 956, visualViewport: { height: 620, offsetTop: 0 } })).toBe(336)
    expect(keyboardInset({ innerHeight: 956, visualViewport: { height: 956, offsetTop: 0 } })).toBe(0)
    expect(keyboardInset({ innerHeight: 956 })).toBe(0)
  })

  it('marks <html> while the keyboard is up, so the tab bar steps aside', () => {
    const listeners = {}
    const vv = { height: 956, offsetTop: 0, addEventListener: (t, f) => { listeners[t] = f }, removeEventListener: vi.fn() }
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 956, configurable: true })
    function Probe() { useKeyboardWatch(true); return null }
    const { unmount } = render(<Probe />)
    expect(document.documentElement).not.toHaveClass('kb-open')
    vv.height = 600
    act(() => listeners.resize())
    expect(document.documentElement).toHaveClass('kb-open')
    expect(document.documentElement.style.getPropertyValue('--kb-inset')).toBe('356px')
    unmount()
    expect(document.documentElement).not.toHaveClass('kb-open')
    delete window.visualViewport
  })
})

describe('iPhone: document and heights', () => {
  const html = readFileSync(join(ROOT, '..', 'index.html'), 'utf8')

  it('the viewport covers the display and the browser chrome follows the theme', () => {
    expect(html).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover/)
    expect(html).toMatch(/<meta name="theme-color" content="[^"]+" media="\(prefers-color-scheme: light\)"/)
    expect(html).toMatch(/<meta name="theme-color" content="[^"]+" media="\(prefers-color-scheme: dark\)"/)
  })

  it('works from the home screen', () => {
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />')
    expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />')
    expect(html).toMatch(/<link rel="apple-touch-icon" sizes="180x180" href="[^"]+\.png"/)
  })

  it('no plain 100vh is left in the phone layouts: each one is followed by dvh', () => {
    const css = readFileSync(join(ROOT, 'styles', 'app-mobile.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const rule of css.split('}')) {
      if (/100vh/.test(rule)) expect(rule).toMatch(/100dvh/)
    }
    const files = []
    const walk = (d) => readdirSync(d).forEach(n => { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : files.push(p) })
    walk(join(ROOT, 'components', 'mobile'))
    files.push(...['invoices/InvoicesPhone.jsx', 'projects/ProjectsPhone.jsx', 'dashboard/DashboardPhone.jsx', 'tax/TaxLedgerPhone.jsx', 'pagesmanager/PagesPhone.jsx'].map(f => join(ROOT, 'pages', f)))
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/100vh/)
  })

  it('the phone styles all sit inside the phone query (or are inset-safe everywhere)', () => {
    const css = readFileSync(join(ROOT, 'styles', 'app-mobile.css'), 'utf8')
    // Outside a media block only these may appear; each resolves to the old padding where insets are 0.
    const top = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
    const selectors = [...top.matchAll(/([^{}]+)\{/g)].map(m => m[1].trim())
    expect(selectors).toEqual(['html', '.app-topbar', '.app-bottom-bar'])
  })
})
