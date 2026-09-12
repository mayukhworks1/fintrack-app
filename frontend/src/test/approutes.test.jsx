/**
 * App's own routing.
 *
 * This exists because a blank production page shipped: the signed-out gate
 * referenced `navigate`, which was declared in a different component in the
 * same file. Nothing caught it — the unit tests render pages directly and the
 * build does not resolve identifiers across component scopes, so the first
 * thing that noticed was a white screen on the live site.
 *
 * These render App itself, which is the only way a scope error in it surfaces
 * before a user finds it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

let authState = { status: 'anon', isWeb: false, isAll: false, isAdmin: false, isViewer: false, isImpersonating: false }

vi.mock('../context/AuthContext', () => ({
  useAuth: () => authState,
  AuthProvider: ({ children }) => children,
}))
vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ dark: false, toggle: vi.fn() }),
  ThemeProvider: ({ children }) => children,
}))
vi.mock('../hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }))
// Stubbed: this file tests which screen the gate chooses, not what the
// dashboard renders once chosen. Mounting the real one drags in its whole
// data surface and tests something else.
vi.mock('../pages/Dashboard', () => ({ default: () => <div>dashboard stub</div> }))
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))
vi.mock('../services/api', () => ({
  api: {
    auth: {
      providers: vi.fn().mockResolvedValue({ google: false, zoho: false }),
      login: vi.fn(), emailLogin: vi.fn(), emailRegister: vi.fn(),
      verify: vi.fn().mockResolvedValue({ valid: false }),
      forgotPassword: vi.fn(), resetPassword: vi.fn(),
      googleStartUrl: vi.fn(() => '/api/auth/google/start'),
      zohoStartUrl: vi.fn(() => '/api/auth/zoho/start'),
    },
  },
  API_BASE_URL: '',
  getAuthToken: () => '',
  setAuthToken: vi.fn(),
}))

const App = (await import('../App')).default

function at(path) {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
}

beforeEach(() => {
  authState = { status: 'anon', isWeb: false, isAll: false, isAdmin: false, isViewer: false, isImpersonating: false }
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb) { this.cb = cb }
    observe(el) { this.cb([{ isIntersecting: true, target: el }]) }
    disconnect() {}
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('App routing, signed out', () => {
  // The regression: this threw ReferenceError and rendered nothing at all.
  it('renders the landing page at the root without throwing', async () => {
    at('/')
    expect(await screen.findByText(/Know what you are owed/)).toBeInTheDocument()
  })

  it('sends a deep link to sign-in rather than to marketing', async () => {
    at('/invoices')
    await waitFor(() => {
      expect(screen.queryByText(/Know what you are owed/)).not.toBeInTheDocument()
    })
  })

  // Asserted on the module picker rather than the heading: the heading carries
  // a module count, so a route test written against it fails every time a
  // module is added — which tells you nothing about routing.
  it('serves the features page publicly', async () => {
    at('/features')
    expect(await screen.findByRole('tablist', { name: /modules/i })).toBeInTheDocument()
  })

  it('serves the security page publicly', async () => {
    at('/security')
    expect(await screen.findByText(/Who can see what/)).toBeInTheDocument()
  })

  it('renders sign-in at /login', async () => {
    at('/login')
    await waitFor(() => {
      expect(screen.queryByText(/Know what you are owed/)).not.toBeInTheDocument()
    })
  })
})

describe('App routing, signed in', () => {
  it('does not show the public landing page to an authenticated user', async () => {
    authState = { ...authState, status: 'authed' }
    at('/')
    await waitFor(() => {
      expect(screen.queryByText(/Know what you are owed/)).not.toBeInTheDocument()
    })
  })
})
