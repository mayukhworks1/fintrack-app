/**
 * The home page's motion and honesty contracts.
 *
 * - The sandbox tour never moves by itself under reduced motion, and under
 *   normal motion it moves one step per STEP_MS, not on a 100ms tick.
 * - The film announces its real length, shows a poster and loads nothing
 *   before it is asked to.
 * - The film's walkthrough and the tax panel are computed from demoData, and
 *   the panel's arithmetic is the invoice drawer's.
 * - None of the claims the product cannot back appear on the page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DemoWorkspace, { TABS } from '../components/DemoWorkspace'
import ProductFilm, { CHAPTERS, WALKTHROUGH, clock } from '../components/ProductFilm'
import Overstatement, { split } from '../components/Overstatement'
import OneRecord, { PLACES } from '../components/home/OneRecord'
import { VIDEOS } from '../components/motion/media'
import { INVOICES, DELIVERY, TAX_SUMMARY, GST_RATE, TDS_RATE, inr } from '../components/demoData'

vi.mock('../context/ThemeContext', () => ({ useTheme: () => ({ dark: false, toggle: vi.fn() }) }))
vi.mock('../hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }))
vi.mock('../services/api', () => ({ api: {}, API_BASE_URL: '' }))

/* The terms §4.6 of the site plan greps for: claims with nothing behind them. */
const UNBACKED = /26AS|\bAIS\b|TRACES|escrow|ring-fenced|hallucinat|confidence 100|similarity score|cosine|signed by irp|\bD3\b|SHA-256|hash chain|hash verified|immutable|tamper-proof|cryptograph|100% (reconciled|attributed|match|verifiab|auditable)|zero mockups|nova systems|apex corp|custom domain|mayukh\/fintrack/i

function motion(reduce) {
  vi.stubGlobal('matchMedia', (q) => ({
    matches: reduce ? q.includes('prefers-reduced-motion') : false,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  }))
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb) { this.cb = cb }
    observe(el) { this.cb([{ isIntersecting: true, intersectionRatio: 1, target: el }]) }
    disconnect() {}
  })
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const title = (c) => c.querySelector('.ft-chrome-title')?.textContent

describe('the sandbox tour', () => {
  it('does not advance under reduced motion', () => {
    vi.useFakeTimers()
    motion(true)
    const { container } = render(<DemoWorkspace />)
    const before = title(container)
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(20000) })
    expect(title(container)).toBe(before)
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument()
    // It offers Play rather than Pause: nothing is running.
    expect(screen.getByRole('button', { name: 'Play the tour' })).toBeInTheDocument()
  })

  it('moves one step per five seconds, and stops when paused', () => {
    vi.useFakeTimers()
    motion(false)
    const { container } = render(<DemoWorkspace />)
    const label = (id) => `Sample workspace / ${TABS.find(t => t.id === id).label}`
    expect(title(container)).toBe(label('receivables'))
    act(() => { vi.advanceTimersByTime(4900) })
    expect(title(container)).toBe(label('receivables'))
    act(() => { vi.advanceTimersByTime(200) })
    expect(title(container)).toBe(label('delivery'))
    // Step counter, banner and window title move together.
    expect(screen.getByText('Step 2 of 6')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Pause the tour' }))
    act(() => { vi.advanceTimersByTime(20000) })
    expect(title(container)).toBe(label('delivery'))
  })

  it('opens the sample invoice without taking focus from the visitor', () => {
    vi.useFakeTimers()
    motion(false)
    render(<><button>outside</button><DemoWorkspace /></>)
    const outside = screen.getByText('outside')
    outside.focus()
    act(() => { vi.advanceTimersByTime(3000) })   // 56% of the first step
    expect(screen.getByRole('dialog', { name: /INV-2296/ })).toBeInTheDocument()
    expect(document.activeElement).toBe(outside)
  })

  it('describes every step without the claims it cannot back', () => {
    motion(true)
    const { container } = render(<DemoWorkspace />)
    const bar = container.querySelector('.ft-h-tourbar')
    const pills = [...bar.querySelectorAll('.ft-h-tb-pill')]
    expect(pills).toHaveLength(6)
    for (const pill of pills) {
      fireEvent.click(pill)
      expect(container.textContent).not.toMatch(UNBACKED)
    }
  })
})

describe('the film', () => {
  it('says how long it is, from the chapter table, as 0:29', () => {
    motion(false)
    render(<ProductFilm />)
    expect(CHAPTERS.at(-1).end).toBe(28.5)
    expect(clock(CHAPTERS.at(-1).end, true)).toBe('0:29')
    expect(screen.getByRole('button', { name: 'Play the film (0:29)' })).toBeInTheDocument()
    expect(screen.getByText(/The film, 0:29 · captured from the sample workspace/)).toBeInTheDocument()
    expect(screen.queryByText(/24s|0:24/)).toBeNull()
  })

  it('shows a poster and loads nothing until it is played', () => {
    motion(false)
    const { container } = render(<ProductFilm />)
    const video = container.querySelector('video')
    expect(video.getAttribute('preload')).toBe('none')
    expect(video.getAttribute('poster')).toBe(VIDEOS.film.poster)
    expect(video.hasAttribute('autoplay')).toBe(false)
    expect(video.querySelectorAll('source')).toHaveLength(0)
  })

  it('builds the walkthrough from the sample ledger', () => {
    const table = WALKTHROUGH.find(s => s.preview.type === 'table')
    for (const row of table.preview.rows) {
      const inv = INVOICES.find(i => i.id === row.id)
      expect(inv, row.id).toBeTruthy()
      expect(row.client).toBe(inv.client)
      expect(row.amount).toBe(inr(inv.amount))
      expect(row.tds).toBe(inr(inv.tds))
    }
    const lanes = WALKTHROUGH.find(s => s.preview.type === 'kanban').preview.lanes
    for (const l of lanes) {
      expect(DELIVERY.filter(d => d.lane === l.name)).toHaveLength(l.count)
    }
    const tax = WALKTHROUGH.find(s => s.preview.type === 'tax').preview.items
    expect(tax.map(t => t.value)).toEqual([
      inr(TAX_SUMMARY.taxableValue), inr(TAX_SUMMARY.gstCollected),
      inr(TAX_SUMMARY.tdsCollected), inr(TAX_SUMMARY.netReceivable),
    ])
  })

  it('carries none of the claims it cannot back, in either mode', () => {
    motion(true)
    const { container } = render(<ProductFilm />)
    expect(container.textContent).not.toMatch(UNBACKED)
    fireEvent.click(screen.getByRole('button', { name: /Walkthrough/ }))
    for (const s of WALKTHROUGH) {
      fireEvent.click(screen.getByRole('button', { name: s.tabLabel }))
      expect(container.textContent).not.toMatch(UNBACKED)
    }
  })
})

describe('the tax panel', () => {
  it('splits an invoice the way the invoice drawer does', () => {
    const f = split(1000000)
    const B = 1000000
    expect(f.invoice).toBe(Math.round(B * (1 + GST_RATE)))
    expect(f.tds).toBe(Math.round(B * TDS_RATE))
    expect(f.cash).toBe(Math.round(B * (1 + GST_RATE - TDS_RATE)))
    expect(f.gst).toBe(Math.round(B * GST_RATE))
    expect(f.yours).toBe(Math.round(B * (1 - TDS_RATE)))
    expect([f.invoice, f.tds, f.cash, f.gst, f.yours])
      .toEqual([1180000, 100000, 1080000, 180000, 900000])
  })

  it('states the overstatement at the default billing', () => {
    motion(true)
    const { container } = render(<Overstatement />)
    const sentence = container.querySelector('.ft-h-over p[style]')?.textContent || container.textContent
    expect(sentence).toMatch(/shows ₹11,80,000 outstanding overstates the cash coming by ₹1,00,000/)
    expect(sentence).toMatch(/the money that is yours by ₹2,80,000/)
  })

  it('follows the slider', () => {
    motion(true)
    const { container } = render(<Overstatement />)
    fireEvent.change(screen.getByLabelText('Monthly billing, pre-tax'), { target: { value: '3' } })
    const f = split(2500000)
    expect(container.textContent).toContain(`overstates the cash coming by ${inr(f.tds)}`)
    expect(container.textContent).toContain(`yours by ${inr(f.invoice - f.yours)}`)
  })
})

describe('one record, four places', () => {
  it('reads every figure from the sample invoice', () => {
    motion(true)
    render(<OneRecord />)
    const inv = INVOICES.find(i => i.id === 'INV-2296')
    expect(screen.getByText('One sample record')).toBeInTheDocument()
    expect(screen.getByText(`GST ${inr(inv.gst)}`)).toBeInTheDocument()
    expect(screen.getByText(`TDS ${inr(inv.tds)} withheld`)).toBeInTheDocument()
    expect(PLACES.map(p => p.tab)).toEqual(['receivables', 'delivery', 'tax', 'analyst'])
  })

  it('opens each place in the sandbox', () => {
    motion(true)
    const seen = []
    const on = (e) => seen.push(e.detail)
    window.addEventListener('ft-switch-tab', on)
    render(<OneRecord />)
    for (const p of PLACES) fireEvent.click(screen.getByRole('button', { name: new RegExp(p.label) }))
    window.removeEventListener('ft-switch-tab', on)
    expect(seen).toEqual(PLACES.map(p => p.tab))
  })
})

describe('the rendered home page', () => {
  it('carries none of the claims it cannot back', async () => {
    motion(true)
    vi.stubGlobal('matchMedia', (q) => ({
      matches: q.includes('prefers-reduced-motion') || q.includes('min-width'),
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {},
    }))
    const { default: Landing } = await import('../pages/Landing')
    const { container } = render(<MemoryRouter><Landing /></MemoryRouter>)
    // The lazily mounted film arrives a tick later.
    await screen.findByRole('button', { name: 'Play the film (0:29)' })
    expect(container.textContent).not.toMatch(UNBACKED)
    // The sandbox is labelled as sample data before a figure is read from it.
    expect(screen.getByText(/Every figure is sample data/)).toBeInTheDocument()
    // No decorative sweep on the headline, and no em dash in its copy.
    expect(container.querySelector('.ft-shine-text, h1 .ft-shine')).toBeNull()
    expect(container.querySelector('h1').textContent).not.toMatch(/—/)
  })
})
