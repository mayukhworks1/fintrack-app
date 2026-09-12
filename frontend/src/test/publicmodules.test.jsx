/**
 * The two public pages have to agree with the product, and with each other.
 *
 * This exists because they did not: the landing page announced "Eight modules"
 * long after eleven shipped, and the features page had no entry at all for the
 * tax ledger, the AI reports or the admin and audit surface. Nothing failed —
 * the count is prose and the module list is a literal, and neither one knows
 * about the other.
 *
 * So the count in each heading is derived here from the array that page
 * actually renders. Adding a module without touching the heading now fails a
 * test rather than shipping a page that undersells the thing it is selling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Landing, { MODULES } from '../pages/Landing'
import Features, { FEATURES } from '../pages/Features'

vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ dark: false, toggle: vi.fn() }),
}))
vi.mock('../hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }))
vi.mock('../services/api', () => ({ api: {}, API_BASE_URL: '' }))

// Only as far as the headings are ever likely to count in words.
const WORDS = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight',
  'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen',
  'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty',
]

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb) { this.cb = cb }
    observe(el) { this.cb([{ isIntersecting: true, target: el }]) }
    disconnect() {}
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('the public pages count their own modules', () => {
  it('the landing heading matches the modules it renders', () => {
    render(<MemoryRouter><Landing /></MemoryRouter>)
    const word = WORDS[MODULES.length]
    expect(word).toBeDefined()
    expect(
      screen.getByRole('heading', { name: new RegExp(`^${word} modules`, 'i') })
    ).toBeInTheDocument()
  })

  it('the landing stat band matches too', () => {
    // Asked for reduced motion so the count-up renders its final value rather
    // than animating to it — the figure is what is under test, not the tween.
    vi.stubGlobal('matchMedia', (q) => ({
      matches: q.includes('prefers-reduced-motion'),
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {},
    }))
    render(<MemoryRouter><Landing /></MemoryRouter>)
    const cell = screen.getByText('Modules').parentElement
    expect(within(cell).getByText(String(MODULES.length))).toBeInTheDocument()
  })

  it('the features heading matches the modules it renders', () => {
    render(<MemoryRouter><Features /></MemoryRouter>)
    const word = WORDS[FEATURES.length]
    expect(word).toBeDefined()
    expect(
      screen.getByRole('heading', { name: new RegExp(`^${word} modules`, 'i') })
    ).toBeInTheDocument()
  })

  it('gives every module a tab you can actually reach', () => {
    render(<MemoryRouter><Features /></MemoryRouter>)
    expect(screen.getAllByRole('tab')).toHaveLength(FEATURES.length)
    for (const { label } of FEATURES) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument()
    }
  })

  it('the two pages describe the same product', () => {
    expect(MODULES).toHaveLength(FEATURES.length)
  })

  // Each demo key has to resolve, or a tab renders an empty frame. The panels
  // only mount one at a time, so a missing key would hide until it is clicked.
  it('every feature panel has a demo to show', () => {
    const { getAllByRole } = render(<MemoryRouter><Features /></MemoryRouter>)
    const tabs = getAllByRole('tab')
    for (let i = 0; i < tabs.length; i++) {
      fireEvent.click(tabs[i])
      const panel = screen.getByRole('tabpanel')
      expect(within(panel).getByRole('heading')).toHaveTextContent(FEATURES[i].headline)
    }
  })
})
