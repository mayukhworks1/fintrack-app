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
      'Receivables', 'Projects', 'Analytics', 'Tax ledger', 'AI reports',
      'Studio — documents', 'Studio — finance data', 'Pages', 'Status board',
      'Shared views', 'Admin & audit',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    }
  })

  it('sets the approval expectation before someone tries to register', () => {
    view()
    expect(screen.getByText(/administrator approves each account/i)).toBeInTheDocument()
  })

  it('hides the ambient decoration from assistive tech', () => {
    const { container } = view()
    // Colour fields and texture carry no information; announcing them is noise.
    for (const sel of ['.ft-aurora', '.ft-dotgrid']) {
      expect(container.querySelector(sel)).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('labels the sandbox as invented before anyone reads a figure from it', () => {
    view()
    // The demo is interactive, so unlike a still mockup it cannot be hidden
    // from assistive tech — which makes saying so in the frame the only thing
    // standing between a visitor and a rupee figure they take for real.
    expect(screen.getByText(/Sample data/i)).toBeInTheDocument()
  })

  it('gives in-page nav real anchors', () => {
    const { container } = view()
    for (const id of ['try', 'features', 'trust', 'how', 'privacy', 'faq']) {
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

  // The 3D entrance holds the sandbox at opacity 0 until [data-shown] lands.
  // It is released by the same observer, so without a fallback the single
  // most important thing on the page would be the one thing missing from it.
  it('still shows the sandbox when nothing can observe it', () => {
    const { container } = view()
    expect(container.querySelectorAll('.ft-3d:not([data-shown])')).toHaveLength(0)
  })
})
