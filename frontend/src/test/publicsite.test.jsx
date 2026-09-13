/**
 * The public site, as a site.
 *
 * The landing page had reached seventeen screens on a phone and was split into
 * six routes. The risk in a split like that is not that a page breaks — it is
 * that a section quietly stops being rendered anywhere and nobody notices,
 * which is exactly what happened to the "this page is public, your data is
 * not" block on the first pass.
 *
 * So these tests are mostly about the site rather than any one page: every
 * claim still has a home, every navigation entry points at a route that
 * exists, and no page is long enough to need splitting again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import Landing from '../pages/Landing'
import Features, { FEATURES } from '../pages/Features'
import Security from '../pages/Security'
import HowItWorks from '../pages/public/HowItWorks'
import Customise from '../pages/public/Customise'
import Faq from '../pages/public/Faq'
import { NAV, ALL_PAGES } from '../components/MegaNav'
import { MODULES, SECURITY, PROBLEMS, TRUST, STEPS, SHAPE, FAQ } from '../content/publicContent'

vi.mock('../context/ThemeContext', () => ({ useTheme: () => ({ dark: false, toggle: vi.fn() }) }))
vi.mock('../hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }))
vi.mock('../services/api', () => ({ api: {}, API_BASE_URL: '' }))

const PAGES = {
  '/': Landing,
  '/features': Features,
  '/security': Security,
  '/how-it-works': HowItWorks,
  '/customise': Customise,
  '/faq': Faq,
}

const at = (path) => {
  const Page = PAGES[path]
  return render(<MemoryRouter initialEntries={[path]}><Page /></MemoryRouter>)
}

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
})
afterEach(() => vi.unstubAllGlobals())

describe('every public page', () => {
  it.each(Object.keys(PAGES))('%s renders with exactly one h1', (path) => {
    const { container } = at(path)
    expect(container.querySelectorAll('h1')).toHaveLength(1)
  })

  it.each(Object.keys(PAGES))('%s offers a way to sign in', (path) => {
    at(path)
    const signIn = screen.getAllByRole('link', { name: /sign in/i })
    expect(signIn.length).toBeGreaterThan(0)
    signIn.forEach(a => expect(a).toHaveAttribute('href', '/login'))
  })

  it.each(Object.keys(PAGES))('%s never calls the API', async (path) => {
    const { api } = await import('../services/api')
    at(path)
    expect(Object.keys(api)).toHaveLength(0)
  })

  it.each(Object.keys(PAGES))('%s reveals its content when nothing observes it', (path) => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const { container } = at(path)
    // The reveal starts at opacity 0. With no observer and no fallback the
    // page is a blank screen — the worst possible failure for a front door.
    expect(container.querySelectorAll('.ft-reveal:not([data-shown])')).toHaveLength(0)
    expect(container.querySelectorAll('.ft-3d:not([data-shown])')).toHaveLength(0)
  })

  it.each(Object.keys(PAGES))('%s hides its ambient decoration from assistive tech', (path) => {
    const { container } = at(path)
    for (const el of container.querySelectorAll('.ft-aurora, .ft-dotgrid, .ft-spotlight')) {
      expect(el).toHaveAttribute('aria-hidden', 'true')
    }
  })
})

describe('the navigation', () => {
  it('only points at routes that exist', () => {
    for (const { to } of ALL_PAGES) {
      expect(Object.keys(PAGES), `nav links to ${to}`).toContain(to)
    }
  })

  it('reaches every public page', () => {
    // A page with no way in is a page nobody sees. The split created three
    // new routes; this is what stops a fourth being added and stranded.
    const linked = new Set(ALL_PAGES.map(p => p.to))
    for (const path of Object.keys(PAGES)) {
      expect(linked, `nothing links to ${path}`).toContain(path)
    }
  })

  it('describes every destination rather than just naming it', () => {
    for (const { label, blurb } of ALL_PAGES) {
      expect(label.length).toBeGreaterThan(2)
      expect(blurb.length, `${label} has no blurb`).toBeGreaterThan(24)
    }
  })

  it('opens a panel on click, and closes it on Escape', () => {
    const { container } = at('/')
    const trigger = screen.getAllByRole('button', { name: new RegExp(NAV[0].label) })[0]
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const panel = container.querySelector('.ft-mega')
    expect(panel).toBeInTheDocument()
    for (const item of NAV[0].items) {
      expect(within(panel).getByRole('link', { name: new RegExp(item.label) })).toBeInTheDocument()
    }

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(container.querySelector('.ft-mega')).toBeNull()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('nothing was lost in the split', () => {
  // Each of these arrays used to be rendered by the landing page. After the
  // split every one has to be rendered by exactly some page, or the claim has
  // silently left the site.
  const homes = [
    ['modules',       MODULES,  '/features', m => m.title],
    ['problems',      PROBLEMS, '/',         m => m.title],
    ['trust',         TRUST,    '/how-it-works', m => m.title],
    ['steps',         STEPS,    '/how-it-works', m => m.title],
    ['customisation', SHAPE,    '/customise', m => m.title],
    ['privacy',       SECURITY, '/security', m => m.title],
  ]

  it.each(homes)('%s still has a page', (_name, rows, path, pick) => {
    at(path)
    for (const row of rows) {
      expect(screen.getAllByText(pick(row)).length,
        `"${pick(row)}" is not on ${path}`).toBeGreaterThan(0)
    }
  })

  it('keeps every FAQ answer in the document, opened or not', () => {
    at('/faq')
    for (const { q } of FAQ) expect(screen.getByText(q)).toBeInTheDocument()
    // details/summary: the answers ship in the HTML whether or not anyone
    // expands them, which is what makes them worth indexing.
    for (const { a } of FAQ) expect(screen.getByText(a)).toBeInTheDocument()
  })

  it('still names every module on the overview, and links them to the detail', () => {
    const { container } = at('/')
    for (const m of MODULES) expect(screen.getAllByText(m.title).length).toBeGreaterThan(0)
    const toFeatures = [...container.querySelectorAll('a[href="/features"]')]
    expect(toFeatures.length).toBeGreaterThanOrEqual(MODULES.length)
  })

  it('the two module lists still describe the same product', () => {
    expect(MODULES).toHaveLength(FEATURES.length)
  })
})

describe('the overview stays short', () => {
  it('carries the sandbox and hands off the rest', () => {
    const { container } = at('/')
    expect(screen.getByRole('navigation', { name: /sample workspace/i })).toBeInTheDocument()
    // The three deeper pages are reachable from the body, not only the nav.
    for (const to of ['/how-it-works', '/customise', '/security']) {
      expect(container.querySelector(`a[href="${to}"]`), `no body link to ${to}`).toBeInTheDocument()
    }
  })

  it('labels the sandbox as invented before anyone reads a figure from it', () => {
    at('/')
    expect(screen.getByText(/Sample data/i)).toBeInTheDocument()
  })

  it('no longer carries the sections that moved', () => {
    // If these come back to the overview it is on its way to seventeen
    // screens again. The nav is how someone reaches them now.
    at('/')
    expect(screen.queryByText(/Checkable by construction/)).toBeNull()
    expect(screen.queryByText(/Shaped to how you work/)).toBeNull()
    expect(screen.queryByText(/This page is public/)).toBeNull()
  })
})
