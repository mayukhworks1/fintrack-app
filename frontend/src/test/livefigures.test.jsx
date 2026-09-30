/**
 * Live data motion.
 *
 * The point of these two components is that they move only when something
 * actually moved. A figure that rolls on mount, or an indicator that pings on
 * every poll, is worse than no motion at all — it reports a change that did
 * not happen, and the reader learns to ignore it. That is the property these
 * tests pin down.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { LiveValue, LiveDot } from '../components/LiveFigures'
import { DashboardMetric, KpiCard as WebKpiCard } from '../pages/webinvoices/ui'
import { ExecutiveStatCard } from '../components/ExecutiveUI'
import { useAutoRefresh } from '../hooks/useAutoRefresh'

/** Drive matchMedia, which jsdom does not implement. */
function setReducedMotion(on) {
  window.matchMedia = vi.fn().mockImplementation(query => ({
    matches: on && query.includes('prefers-reduced-motion'),
    media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

beforeEach(() => setReducedMotion(false))
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

const rupees = v => `₹${Math.round(v)}`

describe('LiveValue', () => {
  it('shows its value on mount without animating it', () => {
    const { container } = render(<LiveValue value={1200} format={rupees} />)
    const el = container.firstChild
    expect(el).toHaveTextContent('₹1200')
    // Rolling on mount would delay reading the number and would claim a
    // change that did not happen — the page merely opened.
    expect(el.className).not.toContain('ft-live-land')
  })

  it('travels to the new value when the value changes', async () => {
    const { container, rerender } = render(<LiveValue value={1000} format={rupees} />)
    const el = container.firstChild
    rerender(<LiveValue value={2000} format={rupees} />)
    expect(el.className).toContain('ft-live-land')
    await waitFor(() => expect(el).toHaveTextContent('₹2000'))
  })

  it('does not animate when the value is re-rendered unchanged', () => {
    const { container, rerender } = render(<LiveValue value={1000} format={rupees} />)
    const el = container.firstChild
    rerender(<LiveValue value={1000} format={rupees} />)
    expect(el.className).not.toContain('ft-live-land')
    expect(el).toHaveTextContent('₹1000')
  })

  it('lands on the value immediately under reduced motion', () => {
    setReducedMotion(true)
    const { container, rerender } = render(<LiveValue value={1000} format={rupees} />)
    const el = container.firstChild
    rerender(<LiveValue value={9999} format={rupees} />)
    expect(el).toHaveTextContent('₹9999')
    expect(el.className).not.toContain('ft-live-land')
  })

  it('renders non-numeric values through the formatter untouched', () => {
    const { container } = render(<LiveValue value={null} format={v => (v == null ? '—' : String(v))} />)
    expect(container.firstChild).toHaveTextContent('—')
  })
})

describe('LiveDot', () => {
  it('does not ping on first render', () => {
    const { container } = render(<LiveDot changeCount={0} />)
    expect(container.querySelector('.ft-live-ping')).toBeNull()
  })

  it('pings when the change count moves, then goes quiet', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { container, rerender } = render(<LiveDot changeCount={0} />)
    rerender(<LiveDot changeCount={1} />)
    expect(container.querySelector('.ft-live-ping')).not.toBeNull()
    await act(async () => { vi.advanceTimersByTime(1300) })
    expect(container.querySelector('.ft-live-ping')).toBeNull()
  })

  it('stays still under reduced motion', () => {
    setReducedMotion(true)
    const { container, rerender } = render(<LiveDot changeCount={0} />)
    rerender(<LiveDot changeCount={1} />)
    expect(container.querySelector('.ft-live-ping')).toBeNull()
  })
})

describe('useAutoRefresh change reporting', () => {
  it('treats the first load as a baseline, not as a change', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ total: 1 })
    const { result } = renderHook(() => useAutoRefresh(fetchFn, 50))
    await waitFor(() => expect(result.current.data).toEqual({ total: 1 }))
    expect(result.current.changeCount).toBe(0)
    expect(result.current.changedAt).toBeNull()
  })

  it('counts a poll that brings something back, and ignores one that does not', async () => {
    let payload = { total: 1 }
    const fetchFn = vi.fn().mockImplementation(() => Promise.resolve(payload))
    const { result } = renderHook(() => useAutoRefresh(fetchFn, 30))
    await waitFor(() => expect(result.current.data).toEqual({ total: 1 }))

    // Several polls over identical data: nothing changed, so nothing is news.
    await waitFor(() => expect(fetchFn.mock.calls.length).toBeGreaterThan(2))
    expect(result.current.changeCount).toBe(0)

    payload = { total: 2 }
    await waitFor(() => expect(result.current.changeCount).toBe(1))
    expect(result.current.changedAt).toBeInstanceOf(Date)
    expect(result.current.data).toEqual({ total: 2 })
  })
})

/**
 * The card primitives these figures are dropped into.
 *
 * DashboardMetric stringifies its `value` so it can print the currency symbol
 * and the digits at different sizes. Handing it a React element rendered the
 * literal text "[object Object]" on three of the most prominent figures in the
 * app — and the build and the whole suite passed while it did. That is the
 * class of mistake this block exists to stop: a component that looks like it
 * takes a node, and does not.
 */
describe('card primitives carry a live figure', () => {
  it('DashboardMetric renders the amount, never a stringified object', () => {
    const { container } = render(
      <DashboardMetric label="Total raised" amount={125000} format={rupees} tone="#fff" />
    )
    expect(container.textContent).not.toContain('[object Object]')
    expect(container.textContent).toContain('125000')
  })

  it('DashboardMetric still takes a plain value for things that are not numbers', () => {
    const { container } = render(<DashboardMetric label="Coverage" value="3 groups" tone="#fff" />)
    expect(container.textContent).toContain('3 groups')
  })

  it.each([
    ['web KpiCard',        WebKpiCard],
    ['ExecutiveStatCard',  ExecutiveStatCard],
  ])('%s accepts a LiveValue node', (_name, Card) => {
    const { container } = render(
      <Card label="Collected" value={<LiveValue value={90210} format={rupees} />} />
    )
    expect(container.textContent).not.toContain('[object Object]')
    expect(container.textContent).toContain('90210')
  })
})
