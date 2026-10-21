/**
 * How it works, Made yours, Questions, the legal pages and Sign in.
 *
 * What these pin down: the legal pages have their own titles and one <main>;
 * the sign-in form holds the providers' space before they are known and the
 * showcase is not rendered (or downloaded) on a phone; the permission
 * playground's defaults are the seeded ones; the questions search marks what
 * it matched; and the claims that were taken out stay out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => ({ providers: null }))

vi.mock('../context/ThemeContext', () => ({ useTheme: () => ({ dark: false, toggle: vi.fn() }) }))
vi.mock('../hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ login: vi.fn(), acceptToken: vi.fn() }) }))
vi.mock('../services/api', () => ({
  api: {
    auth: {
      providers: vi.fn(() => new Promise((resolve) => { h.providers = resolve })),
      googleStartUrl: vi.fn(() => '/g'),
      zohoStartUrl: vi.fn(() => '/z'),
      forgotPassword: vi.fn(),
      emailRegister: vi.fn(),
      resetPassword: vi.fn(),
    },
  },
  API_BASE_URL: '',
  getAuthToken: () => '',
  setAuthToken: vi.fn(),
  clearAuthToken: vi.fn(),
}))

import { usePageMeta } from '../hooks/usePageMeta'
import Privacy from '../pages/public/Privacy'
import Terms from '../pages/public/Terms'
import HowItWorks from '../pages/public/HowItWorks'
import Customise from '../pages/public/Customise'
import Faq from '../pages/public/Faq'
import Login from '../pages/Login'
import PermissionPlayground, { PEOPLE, MODULES as PERM_MODULES } from '../components/PermissionPlayground'
import SyncPipelineSimulator from '../components/SyncPipelineSimulator'
import { FAQ } from '../content/publicContent'

let wide = false
let reduced = true
beforeEach(() => {
  wide = false
  reduced = true
  h.providers = null
  try { sessionStorage.clear() } catch {}
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb) { this.cb = cb }
    observe(el) { this.cb([{ isIntersecting: true, target: el, intersectionRatio: 1 }]) }
    disconnect() {}
    unobserve() {}
  })
  vi.stubGlobal('matchMedia', (q) => ({
    matches: (q.includes('prefers-reduced-motion: reduce') && reduced) || (wide && q.includes('min-width')),
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  }))
})
afterEach(() => vi.unstubAllGlobals())

const at = (Page) => render(<MemoryRouter><Page /></MemoryRouter>)

describe('privacy and terms', () => {
  it.each([
    [Privacy, 'Privacy policy | FinTrack', '/privacy'],
    [Terms, 'Terms of service | FinTrack', '/terms'],
  ])('%#: sets its own title, and sits in the shell as an article under one <main>', (Page, title, path) => {
    usePageMeta.mockClear()
    const { container } = at(Page)
    expect(usePageMeta).toHaveBeenCalledWith(expect.objectContaining({ title, path }))
    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(container.querySelector('main article')).not.toBeNull()
    expect(container.querySelectorAll('h1')).toHaveLength(1)
    // The heading is the largest thing painted; it is never inside a reveal.
    expect(container.querySelector('h1').closest('.ft-reveal')).toBeNull()
  })

  it('no longer badges the privacy policy as zero-telemetry', () => {
    at(Privacy)
    expect(screen.queryByText(/zero-telemetry/i)).toBeNull()
  })

  it('shows a contents list only on wide screens', () => {
    const { container, unmount } = at(Privacy)
    expect(container.querySelector('.ft-s-legal-toc')).toBeNull()
    unmount()
    wide = true
    const wideView = at(Privacy)
    const toc = wideView.container.querySelector('.ft-s-legal-toc')
    expect(toc).not.toBeNull()
    expect(within(toc).getAllByRole('link')).toHaveLength(6)
  })
})

describe('sign in', () => {
  it('holds the providers’ space at full height before the answer arrives', async () => {
    const { container } = at(Login)
    const pending = container.querySelector('[data-providers="pending"]')
    expect(pending).not.toBeNull()
    expect(pending.getAttribute('aria-hidden')).toBe('true')
    expect(pending.querySelectorAll('.ft-s-skel')).toHaveLength(2)
    expect(screen.getByText(/^or$/i)).toBeInTheDocument()
    expect(screen.queryByText(/continue with google/i)).toBeNull()

    await act(async () => { h.providers({ google: true, zoho: true }) })
    expect(container.querySelector('[data-providers="pending"]')).toBeNull()
    expect(screen.getByText(/continue with google/i)).toBeInTheDocument()
    expect(screen.getByText(/continue with zoho/i)).toBeInTheDocument()
    expect(JSON.parse(sessionStorage.getItem('ft-providers'))).toEqual({ google: true, zoho: true })
  })

  it('reserves nothing when this tab already knows there are no providers', () => {
    sessionStorage.setItem('ft-providers', JSON.stringify({ google: false, zoho: false }))
    const { container } = at(Login)
    expect(container.querySelector('[data-providers]')).toBeNull()
    expect(screen.queryByText(/^or$/i)).toBeNull()
  })

  it('does not render the showcase below 1024px, so a phone downloads none of its images', () => {
    const { container } = at(Login)
    expect(container.querySelector('.ft-showcase')).toBeNull()
    expect(container.querySelectorAll('img')).toHaveLength(0)
  })

  it('renders the showcase on wide screens with only the current and next screen, sized', () => {
    wide = true
    const { container } = at(Login)
    const imgs = container.querySelectorAll('.ft-showcase-frame img')
    expect(imgs).toHaveLength(2)
    for (const img of imgs) {
      expect(img.getAttribute('width')).toBeTruthy()
      expect(img.getAttribute('height')).toBeTruthy()
      expect(img.getAttribute('srcset')).toMatch(/800w.*\d+w/)
    }
    // Its own headline: the form's heading must stay the only one with that text.
    expect(screen.getAllByText(/sign in to your workspace/i)).toHaveLength(1)
    expect(screen.getByRole('button', { name: /pause the screens|play the screens/i })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /sign in/i })).toHaveLength(1)
  })

  it('offers a theme switch that is not named "sign in"', () => {
    at(Login)
    expect(screen.getByRole('button', { name: /switch to (dark|light) mode/i })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /sign in/i })).toHaveLength(1)
  })
})

describe('the permission playground', () => {
  /* Entry permission of each module, granted by the seed to each role
     (backend/app/db/postgres.py, auth_role_permissions). */
  const SEED = {
    Viewer: ['module.dashboard.view', 'module.projects.view', 'module.invoices.view',
      'module.tax.view', 'module.analytics.view', 'module.status.view'],
    Finance: ['module.dashboard.view', 'module.invoices.view', 'module.tax.view', 'module.reports.create'],
    Admin: ['module.dashboard.view', 'module.projects.view', 'module.invoices.view', 'module.tax.view',
      'module.analytics.view', 'module.reports.create', 'module.ai.use', 'module.status.view',
      'module.shared.manage', 'module.admin.view', 'module.studio.view'],
  }

  it('gives each sample person exactly their role’s seeded defaults, over 11 modules', () => {
    expect(PERM_MODULES).toHaveLength(11)
    for (const p of PEOPLE) {
      const granted = PERM_MODULES.filter(([key]) => p.grants.includes(key)).map(([, , perm]) => perm).sort()
      expect(granted, p.role).toEqual([...SEED[p.role]].sort())
    }
  })

  it('marks a per-person change as an override, and shows the refusal when invoices are revoked', () => {
    render(<PermissionPlayground />)
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getByText(/raised by rhea/i)).toBeInTheDocument()
    expect(screen.getByText(/fields->>'Raised By' = \$1/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: /^invoices/i }))
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('override')).toBeInTheDocument()
    expect(screen.getByText(/missing permission: module\.invoices\.view/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Dev\b/ }))
    expect(screen.queryByText(/fields->>'Raised By'/)).toBeNull()
    expect(screen.getAllByText(/raised by/i)).toHaveLength(3)
  })
})

describe('questions', () => {
  it('marks what the search matched, in questions and answers, and counts them', () => {
    reduced = false
    const { container } = at(Faq)
    expect(container.querySelectorAll('mark')).toHaveLength(0)
    fireEvent.change(screen.getByRole('searchbox', { name: /search the questions/i }), { target: { value: 'TDS' } })
    const marks = container.querySelectorAll('mark.ft-s-hit')
    expect(marks.length).toBeGreaterThan(1)
    for (const m of marks) expect(m.textContent.toLowerCase()).toBe('tds')
    const n = FAQ.filter(f => `${f.q} ${f.a}`.toLowerCase().includes('tds')).length
    expect(screen.getByRole('status')).toHaveTextContent(`${n} of ${FAQ.length} questions match`)
  })

  it('offers a reset when nothing matches', () => {
    at(Faq)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzz-nothing' } })
    fireEvent.click(screen.getByRole('button', { name: /reset filters/i }))
    for (const { q } of FAQ) expect(screen.getByText(q)).toBeInTheDocument()
  })

  it('toggles a topic as a pressed button', () => {
    at(Faq)
    const chip = screen.getByRole('button', { name: 'GST and TDS' })
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('claims that were taken out stay out', () => {
  const GONE = /under 12ms|\b(8\.4|11\.2|6\.9)ms|100% Attributed|3D (Pipeline|Security)|Cryptographic|CNAME|custom domain|white-label|session hash/i

  it.each([['/how-it-works', HowItWorks], ['/customise', Customise]])('%s', (_path, Page) => {
    const { container } = at(Page)
    expect(container.textContent).not.toMatch(GONE)
    expect(container.querySelectorAll('video')).toHaveLength(0)
  })

  it('the sync simulator describes the real cadence and runs a sample event', () => {
    const { container } = render(<SyncPipelineSimulator />)
    expect(container.textContent).toMatch(/every 30 s/)
    expect(container.textContent).toMatch(/every 5 min/)
    fireEvent.click(screen.getByRole('button', { name: /older copy arrives late/i }))
    expect(screen.getByText('Left alone')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /deleted in the base/i }))
    expect(container.querySelector('pre').textContent).toMatch(/deleted_at = NOW\(\)/)
  })
})
