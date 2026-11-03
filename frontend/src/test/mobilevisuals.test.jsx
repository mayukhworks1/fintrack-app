/**
 * The phone layout's visuals and insight cards: the sparkline, aging bars
 * and column bars with their accessible text, stable client avatars, status
 * pills, sticky sections (and their server totals), the ring's motion and
 * reduced motion, and the insight cards' actions and dismiss-for-today.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

vi.mock('../services/api', () => ({ api: { insights: { cards: vi.fn() } } }))

import { api } from '../services/api'
import {
  Sparkline, AgingBars, MiniBars, ShareBar, Avatar, avatarSlot, initials, StatusPill, invoicePill,
  ListSection, sectionRuns, RowSkeletons, EmptyState, monthSeries,
} from '../components/mobile/Visuals'
import InsightCards, { useInsights, dismissedToday, dismissForToday, DISMISS_KEY } from '../components/mobile/InsightCards'
import { ProgressRing } from '../components/mobile/MobileUI'
import { invoiceSections, bucketPatch, invoiceRowProps } from '../pages/invoices/InvoicesPhone'
import { healthParts } from '../pages/projects/ProjectsPhone'

function setReducedMotion(reduce) {
  window.matchMedia = (query) => ({
    matches: /prefers-reduced-motion/.test(query) ? reduce : false,
    media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  })
}

function Where() {
  const loc = useLocation()
  return <output data-testid="where">{loc.pathname}{loc.search}</output>
}

const CARDS = [
  { id: 'overdue_45', rule: 'overdue_45', tone: 'negative', title: '2 invoices overdue over 45 days', value: '₹4,65,600',
    detail: 'Raised on or before 18 Sep and still pending', action: { label: 'Review', href: '/invoices?status=Pending&to=2026-09-18' } },
  { id: 'gst_due:2026-10', rule: 'gst_due', tone: 'info', title: 'GST due 20 Nov', value: '₹82,800',
    action: { label: 'Open ledger', href: '/tax?period=m-2026-10&scope=all' } },
  { id: 'slow_payer:Innovine', rule: 'slow_payer', tone: 'info', title: 'Innovine pays 12 days late on average',
    action: { label: 'See invoices', href: '/invoices?client=Innovine' } },
  { id: 'followups_due', rule: 'followups_due', tone: 'warning', title: '3 follow-ups due',
    action: { label: 'Open', href: '/invoices?followup=1' } },
]

describe('mini charts', () => {
  it('a sparkline is one image with a summary, and every figure for screen readers', () => {
    const points = [{ label: 'May', value: 0 }, { label: 'Jun', value: 100000 }, { label: 'Oct', value: 106000 }]
    render(<Sparkline title="Cash in" points={points} />)
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('aria-label', 'Cash in: ₹1,06,000 in Oct, up from ₹0 in May')
    const items = [...document.querySelectorAll('ul.sr-only li')].map(li => li.textContent)
    expect(items).toEqual(['May: ₹0', 'Jun: ₹1,00,000', 'Oct: ₹1,06,000'])
    expect(document.querySelectorAll('path')).toHaveLength(2)
  })

  it('a sparkline needs two points', () => {
    const { container } = render(<Sparkline title="Cash in" points={[{ label: 'Oct', value: 5 }]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('aging bars are buttons with their counts and amounts, and a tap hands back the bucket', () => {
    const onSelect = vi.fn()
    const buckets = [
      { key: '0-30', label: '0–30', count: 2, amount: 70000, href: '/invoices?status=Pending&from=2026-10-04' },
      { key: '31-60', label: '31–60', count: 1, amount: 165600, href: '/invoices?status=Pending&from=2026-09-04&to=2026-10-03' },
      { key: '61-90', label: '61–90', count: 0, amount: 0, href: 'x' },
      { key: '90+', label: '90+', count: 0, amount: 0, href: 'y' },
    ]
    render(<AgingBars buckets={buckets} onSelect={onSelect} />)
    expect(screen.getByRole('group')).toHaveAttribute('aria-label', 'Pending by age (days): 3 pending invoices')
    const b = screen.getByRole('button', { name: '31–60 days: 1 invoice, ₹1,65,600. Show them' })
    fireEvent.click(b)
    expect(onSelect).toHaveBeenCalledWith(buckets[1])
    expect(screen.getByRole('button', { name: '61–90 days: 0 invoices, ₹0' })).toBeDisabled()
    // The largest amount is the tallest bar.
    const fills = [...document.querySelectorAll('.m-aging-fill')].map(el => el.style.height)
    expect(fills[1]).toBe('100%')
    expect(fills[2]).toBe('0%')
    // Labels show what the heights show: the amount.
    expect([...document.querySelectorAll('.m-aging-count')].map(el => el.textContent)).toEqual(['₹70K', '₹1.7L', '—', '—'])
  })

  it('column bars and the share bar describe their numbers', () => {
    render(<MiniBars title="GST by month" bars={[{ label: 'Sep', value: 25200 }, { label: 'Oct', value: 82800 }]} />)
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'GST by month: Sep ₹25,200, Oct ₹82,800')
  })

  it('the share bar leaves out empty parts', () => {
    render(<ShareBar title="Health" parts={healthParts({ Healthy: 5, 'At Risk': 3, Unknown: 2 })} />)
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Health: Healthy 5, At risk 3, Untracked 2')
  })

  it('monthSeries fills the missing months with 0, oldest first', () => {
    const s = monthSeries([{ key: '2026-10', count: 4 }, { key: '2026-08', count: 1 }], r => r.count, 4, new Date(2026, 10, 3))
    expect(s.map(p => [p.label, p.value])).toEqual([['Aug', 1], ['Sep', 0], ['Oct', 4], ['Nov', 0]])
  })
})

describe('avatars and pills', () => {
  it('a client keeps its colour whatever the case or spacing, across renders', () => {
    expect(avatarSlot('Innovine')).toBe(avatarSlot(' innovine '))
    const slots = new Set(['Innovine', 'Birla Open Minds', 'Maitrimetal', 'PMS', 'Acme', 'Zoho'].map(avatarSlot))
    expect([...slots].every(n => n >= 1 && n <= 6)).toBe(true)
    expect(slots.size).toBeGreaterThan(1)
    const a = render(<Avatar name="Birla Open Minds" />).container.firstChild
    const b = render(<Avatar name="Birla Open Minds" />).container.firstChild
    expect(a.style.background).toBe(b.style.background)
    expect(a.style.background).toMatch(/^var\(--chart-[1-6]\)$/)
    expect(a).toHaveAttribute('aria-hidden', 'true')
    expect(a.textContent).toBe('BO')
  })

  it('initials', () => {
    expect(initials('innovine')).toBe('IN')
    expect(initials('Birla Open Minds')).toBe('BO')
    expect(initials('')).toBe('?')
  })

  it('an unknown client is a quiet grey, not a palette colour', () => {
    const el = render(<Avatar name="?" />).container.firstChild
    expect(el.style.background).toBe('var(--bg-2)')
  })

  it('invoice pills: paid, pending and overdue with their days, cancelled', () => {
    expect(invoicePill('Paid', 0)).toMatchObject({ tone: 'positive', text: 'Paid' })
    expect(invoicePill('Pending', 14)).toMatchObject({ tone: 'warning', text: 'Pending · 14d', label: 'Pending, 14 days' })
    expect(invoicePill('Pending', 48)).toMatchObject({ tone: 'negative', text: 'Overdue · 48d', label: 'Overdue, 48 days' })
    expect(invoicePill('Pending', 30).tone).toBe('warning')
    expect(invoicePill('Cancelled', 0).tone).toBe('neutral')
  })

  it('a pill reads its full words to a screen reader', () => {
    render(<StatusPill tone="negative" label="Overdue, 48 days">Overdue · 48d</StatusPill>)
    expect(document.querySelector('.m-pill.is-negative')).not.toBeNull()
    expect(screen.getByText('Overdue, 48 days')).toHaveClass('sr-only')
  })

  it('an invoice row carries an avatar and a pill in place of the dot', () => {
    const row = invoiceRowProps({ id: 'r', fields: { 'Invoice Number': 'WM/1', 'Payment Status': 'Pending', 'Raised Date': '2000-01-01', 'Client Name': 'Innovine' } })
    expect(row.pill.tone).toBe('negative')
    expect(row.pill.text).toMatch(/^Overdue · \d+d$/)
    expect(row.leading).toBeTruthy()
  })
})

describe('sticky sections', () => {
  it('a header shows title, count and the section total, in a sticky heading', () => {
    render(<ListSection title="Overdue" count={3} total={345600}><li>row</li></ListSection>)
    const h = screen.getByRole('heading', { level: 3 })
    expect(h).toHaveTextContent('Overdue · 3 · ₹3,45,600')
    expect(h).toHaveClass('m-section-head')
    expect(screen.getByRole('region', { name: /^Overdue\W+3\W+₹3,45,600$/ })).toBeTruthy()
  })

  it('runs follow the list order', () => {
    expect(sectionRuns([1, 1, 2, 2, 1], x => x).map(r => [r.key, r.rows.length])).toEqual([[1, 2], [2, 2], [1, 1]])
  })

  it('the sticky rule keeps under the header', () => {
    const css = readFileSync(join(ROOT, 'styles', 'app-mobile.css'), 'utf8')
    expect(css).toMatch(/\.m-section-head\s*\{[^}]*position:\s*sticky;[^}]*top:\s*var\(--m-sticky-top, 0px\)/)
  })

  const agg = {
    count: 30,
    totals: { amount_raised: 1000000 },
    raised_months: [{ key: '2026-11', count: 2, amount: 50000 }, { key: '2026-10', count: 5, amount: 200000 }],
    aging: { '0-14d': { count: 1, amount: 10000 }, '15-30d': { count: 1, amount: 20000 }, '31-60d': { count: 2, amount: 300000 }, '60d+': { count: 1, amount: 45600 } },
  }
  const today = new Date(2026, 10, 3)

  it('by month for the raised-date sort, with the scope totals', () => {
    const s = invoiceSections({ filters: { sort: 'Raised Date' }, segment: 'all', agg, today })
    expect(s.info.this).toEqual({ title: 'This month', count: 2, total: 50000 })
    expect(s.info.last).toEqual({ title: 'Last month', count: 5, total: 200000 })
    expect(s.info.earlier).toEqual({ title: 'Earlier', count: 23, total: 750000 })
    expect(s.keyOf({ fields: { 'Raised Date': '2026-11-02' } })).toBe('this')
    expect(s.keyOf({ fields: { 'Raised Date': '2026-10-15' } })).toBe('last')
    expect(s.keyOf({ fields: {} })).toBe('earlier')
  })

  it('overdue and within 30 days for the pending segments', () => {
    const s = invoiceSections({ filters: { sort: 'Raised Date' }, segment: 'overdue', agg, today })
    expect(s.info.overdue).toEqual({ title: 'Overdue', count: 3, total: 345600 })
    expect(s.info.due).toEqual({ title: 'Within 30 days', count: 2, total: 30000 })
  })

  it('no sections for another sort, and no totals when currencies mix', () => {
    expect(invoiceSections({ filters: { sort: 'Amount Raised' }, segment: 'all', agg, today })).toBeNull()
    expect(invoiceSections({ filters: { sort: 'Raised Date' }, segment: 'all', agg, today, amounts: false }).info.this.total).toBeUndefined()
  })

  it('an aging bucket link becomes the list filters', () => {
    expect(bucketPatch('/invoices?status=Pending&from=2026-09-04&to=2026-10-03'))
      .toEqual({ status: 'Pending', dateField: 'Raised Date', dateFrom: '2026-09-04', dateTo: '2026-10-03' })
  })
})

describe('skeletons and empty states', () => {
  it('skeleton rows have the row shape: avatar, two lines, value and pill', () => {
    render(<ul><RowSkeletons count={2} /></ul>)
    expect(document.querySelectorAll('.m-skel-avatar')).toHaveLength(2)
    expect(document.querySelectorAll('.m-skel-line')).toHaveLength(4)
    expect(document.querySelectorAll('.m-skel-pill')).toHaveLength(2)
    expect(document.querySelector('li')).toHaveAttribute('aria-hidden', 'true')
  })

  it('an empty state has its icon, line and action', () => {
    const Icon = (p) => <svg data-testid="icon" {...p} />
    render(<ul><EmptyState icon={Icon} title="No invoices yet" action={<button type="button">Clear</button>}>Create one.</EmptyState></ul>)
    expect(screen.getByTestId('icon').closest('.m-empty-icon')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('No invoices yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy()
  })
})

describe('ring motion', () => {
  afterEach(() => { vi.useRealTimers() })

  it('sweeps up from empty', async () => {
    setReducedMotion(false)
    vi.useFakeTimers()
    const raf = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 16)
    try {
      const { container } = render(<ProgressRing value={50} size={56} stroke={5} />)
      const fill = () => Number(container.querySelector('.m-ring-fill').getAttribute('stroke-dashoffset'))
      const c = 2 * Math.PI * 25.5
      expect(fill()).toBeCloseTo(c)                 // empty first
      await act(async () => { vi.advanceTimersByTime(20) })
      expect(fill()).toBeCloseTo(c / 2)             // then its value
    } finally {
      globalThis.requestAnimationFrame = raf
    }
  })

  it('is drawn at its value straight away with reduced motion', () => {
    setReducedMotion(true)
    const { container } = render(<ProgressRing value={50} size={56} stroke={5} />)
    const c = 2 * Math.PI * 25.5
    expect(Number(container.querySelector('.m-ring-fill').getAttribute('stroke-dashoffset'))).toBeCloseTo(c / 2)
  })

  it('the stylesheet stops the motion for reduced motion', () => {
    const css = readFileSync(join(ROOT, 'styles', 'app-mobile.css'), 'utf8')
    const reduced = css.slice(css.indexOf('(prefers-reduced-motion: reduce)'))
    expect(reduced).toMatch(/\.m-aging-fill, \.m-bars-col \{ animation: none; \}/)
    expect(reduced).toMatch(/\.m-ring-fill[^{]*\{ transition: none; \}/)
  })
})

describe('insight cards', () => {
  beforeEach(() => { localStorage.clear() })

  const renderCards = (cards = CARDS) => render(
    <MemoryRouter initialEntries={['/']}>
      <Routes><Route path="*" element={<><InsightCards cards={cards} /><Where /></>} /></Routes>
    </MemoryRouter>,
  )

  it('shows at most three, best first, as a labelled list', () => {
    renderCards()
    const region = screen.getByRole('region', { name: 'Insights' })
    const items = region.querySelectorAll('li.m-insight')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('2 invoices overdue over 45 days · ₹4,65,600')
    expect(screen.queryByText('3 follow-ups due')).toBeNull()
  })

  it.each([
    ['Review', '/invoices?status=Pending&to=2026-09-18'],
    ['Open ledger', '/tax?period=m-2026-10&scope=all'],
    ['See invoices', '/invoices?client=Innovine'],
  ])('“%s” opens %s', (label, href) => {
    renderCards()
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(screen.getByTestId('where').textContent).toBe(href)
  })

  it('a dismissed card is hidden for the day and the next one moves up', () => {
    renderCards()
    fireEvent.click(screen.getByRole('button', { name: 'Hide “2 invoices overdue over 45 days” for today' }))
    expect(screen.queryByText('2 invoices overdue over 45 days')).toBeNull()
    expect(screen.getByText('3 follow-ups due')).toBeTruthy()
    const saved = JSON.parse(localStorage.getItem(DISMISS_KEY))
    expect(saved.ids).toEqual(['overdue_45'])
  })

  it('stays hidden on the next visit the same day, and comes back the next day', () => {
    const today = new Date(2026, 10, 3, 10)
    dismissForToday('overdue_45', today)
    expect(dismissedToday(new Date(2026, 10, 3, 23))).toEqual(['overdue_45'])
    expect(dismissedToday(new Date(2026, 10, 4, 0, 5))).toEqual([])
  })

  it('a stored list is read on mount', () => {
    dismissForToday('overdue_45')
    renderCards()
    expect(screen.queryByText('2 invoices overdue over 45 days')).toBeNull()
  })

  it('broken storage hides nothing', () => {
    localStorage.setItem(DISMISS_KEY, '{not json')
    expect(dismissedToday()).toEqual([])
  })

  it('renders nothing without cards', () => {
    const { container } = render(<MemoryRouter><InsightCards cards={[]} /></MemoryRouter>)
    expect(container).toBeEmptyDOMElement()
  })

  it('useInsights asks for its scope once enabled, and falls back to no cards', async () => {
    api.insights.cards.mockReset()
    api.insights.cards.mockResolvedValueOnce({ cards: CARDS, charts: null })
    function Probe({ scope, enabled }) {
      const { data } = useInsights(scope, { enabled })
      return <span data-testid="n">{data ? data.cards.length : 'loading'}</span>
    }
    const { rerender } = render(<Probe scope="tax" enabled={false} />)
    expect(api.insights.cards).not.toHaveBeenCalled()
    rerender(<Probe scope="tax" enabled />)
    await waitFor(() => expect(screen.getByTestId('n').textContent).toBe('4'))
    expect(api.insights.cards).toHaveBeenCalledWith('tax')
    api.insights.cards.mockRejectedValueOnce(new Error('down'))
    rerender(<Probe scope="projects" enabled />)
    await waitFor(() => expect(screen.getByTestId('n').textContent).toBe('0'))
  })
})
