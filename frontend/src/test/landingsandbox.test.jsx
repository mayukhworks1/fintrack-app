/**
 * A fault inside the sandbox stays inside the sandbox.
 *
 * The nearest error boundary used to be App's, around the whole public page,
 * so the demo's Report → Risk ReferenceError replaced the entire landing page
 * with "Something went wrong". The sandbox now has its own boundary; this pins
 * that the page around it survives whatever the demo throws.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../components/DemoWorkspace', () => ({
  default: function BrokenDemo() { throw new ReferenceError('CLIENTS is not defined') },
}))
vi.mock('../context/ThemeContext', () => ({ useTheme: () => ({ dark: false, toggle: vi.fn() }) }))
vi.mock('../hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }))
vi.mock('../services/api', () => ({ api: {}, API_BASE_URL: '' }))

import Landing from '../pages/Landing'

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb) { this.cb = cb }
    observe(el) { this.cb([{ isIntersecting: true, target: el }]) }
    disconnect() {}
  })
  vi.stubGlobal('matchMedia', (q) => ({
    matches: q.includes('prefers-reduced-motion'),
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the landing page', () => {
  it('keeps rendering when the sandbox throws', () => {
    const { container } = render(<MemoryRouter><Landing /></MemoryRouter>)
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('CLIENTS is not defined')).toBeInTheDocument()
    // The page's own heading and its sign-in link are still there.
    expect(container.querySelectorAll('h1')).toHaveLength(1)
    expect(screen.getAllByRole('link', { name: /Sign in/i }).length).toBeGreaterThan(0)
  })
})
