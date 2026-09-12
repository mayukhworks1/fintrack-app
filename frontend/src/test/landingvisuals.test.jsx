/**
 * The landing illustrations.
 *
 * These are decorative, so the tests are about the ways decoration fails
 * badly: a counter stuck on zero reads as a broken product, and an
 * illustration announced to a screen reader reads as data.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { CountUp, AnalystDemo, BrandMark, MiniBars, Grain } from '../components/LandingVisuals'

let observers = []
function mockIO({ intersecting = true } = {}) {
  observers = []
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb) { this.cb = cb; observers.push(this) }
    observe() { if (intersecting) this.cb([{ isIntersecting: true }]) }
    disconnect() {}
  })
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })))
})
afterEach(() => vi.unstubAllGlobals())

describe('CountUp', () => {
  it('reaches its target rather than stalling part-way', async () => {
    mockIO()
    let now = 0
    vi.stubGlobal('performance', { now: () => now })
    const frames = []
    vi.stubGlobal('requestAnimationFrame', (cb) => { frames.push(cb); return frames.length })
    vi.stubGlobal('cancelAnimationFrame', () => {})

    render(<CountUp to={8} />)
    // Drive the clock past the duration and flush the queued frames.
    await act(async () => {
      for (let i = 0; i < 60 && frames.length; i++) {
        now += 120
        frames.splice(0).forEach(cb => cb(now))
      }
    })
    expect(screen.getByText('8')).toBeInTheDocument()
  })

  it('shows the real number when there is no observer to trigger it', () => {
    // The failure this guards: a stat band permanently reading 0.
    vi.stubGlobal('IntersectionObserver', undefined)
    render(<CountUp to={30} suffix="s" />)
    expect(screen.getByText('30s')).toBeInTheDocument()
  })

  it('shows the real number under reduced motion', () => {
    mockIO()
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })))
    render(<CountUp to={100} suffix="%" />)
    expect(screen.getByText('100%')).toBeInTheDocument()
  })
})

describe('AnalystDemo', () => {
  it('shows the finished state under reduced motion instead of an empty box', () => {
    mockIO()
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })))
    render(<AnalystDemo />)
    expect(screen.getByText(/Which clients have the most outstanding/)).toBeInTheDocument()
    // The claim the product makes — that it shows its query — must be visible.
    expect(screen.getByText(/Compiled query/)).toBeInTheDocument()
  })
})

describe('decorative marks', () => {
  it('are hidden from assistive tech', () => {
    mockIO()
    const { container } = render(<><BrandMark /><MiniBars /><Grain /></>)
    container.querySelectorAll('svg').forEach(svg => {
      expect(svg).toHaveAttribute('aria-hidden', 'true')
    })
  })
})
