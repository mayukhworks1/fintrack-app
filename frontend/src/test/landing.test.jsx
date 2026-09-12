/**
 * The public front door.
 *
 * The load-bearing property is negative: this page is served to anyone, so it
 * must describe capability and never render a workspace figure. The rest is
 * that a visitor can always find the way in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Landing from '../pages/Landing'

vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ dark: false, toggle: vi.fn() }),
}))
vi.mock('../hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }))
vi.mock('../services/api', () => ({ api: {}, API_BASE_URL: '' }))

const view = () => render(<MemoryRouter><Landing /></MemoryRouter>)

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb) { this.cb = cb }
    observe(el) { this.cb([{ isIntersecting: true, target: el }]) }
    disconnect() {}
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('Landing', () => {
  it('never calls the API — it has no workspace to read', async () => {
    const { api } = await import('../services/api')
    view()
    expect(Object.keys(api)).toHaveLength(0)
  })

  it('says plainly that the data is not public', () => {
    view()
    expect(screen.getByText(/This page is public\. Your data is not\./)).toBeInTheDocument()
    expect(screen.getByText(/Nothing on this page is your data/)).toBeInTheDocument()
  })

  it('gives a visitor several ways to sign in', () => {
    view()
    const signIn = screen.getAllByRole('link', { name: /sign in/i })
    expect(signIn.length).toBeGreaterThanOrEqual(3)
    signIn.forEach(a => expect(a).toHaveAttribute('href', '/login'))
  })

  it('describes every shipped module', () => {
    view()
    for (const title of [
      'Receivables', 'Projects', 'Analytics', 'Studio — documents',
      'Studio — finance data', 'Pages', 'Status board', 'Shared views',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    }
  })

  it('sets the approval expectation before someone tries to register', () => {
    view()
    expect(screen.getByText(/administrator approves each account/i)).toBeInTheDocument()
  })

  it('hides the decorative mockup and aurora from assistive tech', () => {
    const { container } = view()
    // The mockup repeats figures that are illustrative, not real — a screen
    // reader announcing them as data would be actively misleading.
    expect(container.querySelector('.ft-aurora')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('.ft-float')).toHaveAttribute('aria-hidden', 'true')
  })

  it('keeps the illustrative figure out of the accessibility tree', () => {
    view()
    // ₹2,16,000 appears only inside the aria-hidden mockup.
    const shown = screen.queryByText('₹2,16,000')
    if (shown) {
      expect(shown.closest('[aria-hidden="true"]')).not.toBeNull()
    }
  })

  it('gives in-page nav real anchors', () => {
    const { container } = view()
    for (const id of ['features', 'privacy', 'how']) {
      expect(container.querySelector(`#${id}`)).toBeInTheDocument()
    }
  })

  it('reveals content once observed', () => {
    const { container } = view()
    expect(container.querySelector('.ft-reveal[data-shown]')).toBeInTheDocument()
  })
})

describe('Landing without IntersectionObserver', () => {
  beforeEach(() => { vi.stubGlobal('IntersectionObserver', undefined) })

  // The reveal starts at opacity 0. If the observer is missing and nothing
  // falls back, the entire page is invisible — a blank front door.
  it('shows everything rather than staying blank', () => {
    const { container } = view()
    const hidden = container.querySelectorAll('.ft-reveal:not([data-shown])')
    expect(hidden).toHaveLength(0)
  })
})
