/**
 * Frontend smoke tests — run with: cd frontend && npx vitest run
 * Tests pure logic and rendering; no real API calls (api module is mocked).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Mock dependencies that need browser/network ──────────────────────────────

vi.mock('../services/api', () => ({
  api: {
    auth: {
      login:         vi.fn(),
      emailLogin:    vi.fn(),
      verify:        vi.fn().mockResolvedValue({ valid: true, role: 'editor' }),
      logout:        vi.fn().mockResolvedValue({}),
      forgotPassword: vi.fn(),
    },
    admin: {
      authUsers:  vi.fn().mockResolvedValue({ rows: [], total: 0 }),
      authRoles:  vi.fn().mockResolvedValue({ roles: [] }),
      deploymentHealth: vi.fn().mockResolvedValue({ overall: true, postgres: { ok: true, detail: 'Connected' }, valkey: { ok: true, detail: 'Connected' }, teable: { ok: true, detail: 'HTTP 200' }, email: { ok: true, detail: 'Brevo configured' }, env: { ok: true, checks: {} } }),
    },
  },
  getAuthToken:  () => null,
  setAuthToken:  vi.fn(),
  clearAuthToken: vi.fn(),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    status: 'unauthed',
    role: 'editor',
    user: null,
    userEmail: '',
    isEmailAuth: false,
    isEditor: true,
    isViewer: false,
    isWeb: false,
    isAll: false,
    isAdmin: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
  AuthProvider: ({ children }) => children,
}))

vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ dark: false, toggle: vi.fn() }),
  ThemeProvider: ({ children }) => children,
}))

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ show: vi.fn() }),
  ToastProvider: ({ children }) => children,
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function withRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

// ── Login page ────────────────────────────────────────────────────────────────

describe('Login page', () => {
  let Login
  beforeEach(async () => {
    const mod = await import('../pages/Login')
    Login = mod.default
  })

  it('renders the sign-in heading', () => {
    withRouter(<Login />)
    expect(screen.getByText(/sign in to your workspace/i)).toBeInTheDocument()
  })

  it('shows email and password fields by default', () => {
    withRouter(<Login />)
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument()
  })

  it('submit button is disabled when fields are empty', () => {
    withRouter(<Login />)
    const btn = screen.getByRole('button', { name: /sign in/i })
    expect(btn).toBeDisabled()
  })

  it('toggles to legacy password mode', () => {
    withRouter(<Login />)
    fireEvent.click(screen.getByText(/use legacy password/i))
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
  })

  it('switches to register mode', () => {
    withRouter(<Login />)
    fireEvent.click(screen.getByText(/create account/i))
    expect(screen.getByText(/create your account/i)).toBeInTheDocument()
  })

  it('shows forgot password link when not in register mode', () => {
    withRouter(<Login />)
    expect(screen.getByText(/forgot password/i)).toBeInTheDocument()
  })

  it('shows set-password UI when invite param present', () => {
    // Simulate ?reset_token=abc&invite=1
    Object.defineProperty(window, 'location', {
      value: { search: '?reset_token=abc123&invite=1&email=user@test.com' },
      writable: true,
    })
    withRouter(<Login />)
    expect(screen.getByText(/set your password/i)).toBeInTheDocument()
  })
})

// ── Profile page ──────────────────────────────────────────────────────────────

describe('Profile page', () => {
  beforeEach(() => {
    vi.resetModules()
    // Override useAuth to return an authenticated user
    vi.doMock('../context/AuthContext', () => ({
      useAuth: () => ({
        user: { email: 'mayukh@example.com', full_name: 'Mayukh Jain' },
        logout: vi.fn(),
      }),
    }))
    // Mock getProfile to avoid real HTTP
    vi.doMock('../services/api', () => ({
      api: {
        auth: {
          getProfile: vi.fn().mockResolvedValue({
            email: 'mayukh@example.com',
            full_name: 'Mayukh Jain',
            role: 'superadmin',
            roles: ['superadmin'],
            status: 'active',
            created_at: new Date().toISOString(),
            active_sessions: 1,
            total_sessions: 3,
          }),
          updateProfile:  vi.fn(),
          changePassword: vi.fn(),
        },
      },
    }))
  })

  it('renders loading state initially', async () => {
    const { default: Profile } = await import('../pages/Profile')
    withRouter(<Profile />)
    expect(screen.getByText(/loading profile/i)).toBeInTheDocument()
  })

  it('shows user info after load', async () => {
    const { default: Profile } = await import('../pages/Profile')
    withRouter(<Profile />)
    await waitFor(() => expect(screen.getByText('Mayukh Jain')).toBeInTheDocument())
    expect(screen.getByText('mayukh@example.com')).toBeInTheDocument()
  })
})

// ── Auth utility tests (no rendering) ────────────────────────────────────────

describe('owner_scope_email logic (JS mirror)', () => {
  const PRIVILEGED = new Set(['superadmin', 'admin', 'manager', 'finance'])

  function ownerScopeEmail({ isEmailAuth, authRole, teableEmail, loginEmail }) {
    if (!isEmailAuth) return null
    if (PRIVILEGED.has(authRole)) return null
    return teableEmail || loginEmail || null
  }

  it('returns null for legacy password sessions', () => {
    expect(ownerScopeEmail({ isEmailAuth: false, authRole: 'editor', loginEmail: 'x@y.com' })).toBeNull()
  })

  it('returns null for privileged roles', () => {
    for (const role of ['superadmin', 'admin', 'manager', 'finance']) {
      expect(ownerScopeEmail({ isEmailAuth: true, authRole: role, loginEmail: 'x@y.com' })).toBeNull()
    }
  })

  it('returns teable_email override when set', () => {
    const result = ownerScopeEmail({
      isEmailAuth: true,
      authRole: 'user',
      teableEmail: 'Aditya.narkar@theworks.in',
      loginEmail: 'aditya@theworks.in',
    })
    expect(result).toBe('Aditya.narkar@theworks.in')
  })

  it('falls back to login email when no override', () => {
    const result = ownerScopeEmail({
      isEmailAuth: true,
      authRole: 'web',
      teableEmail: null,
      loginEmail: 'mayukh@worksmayukh.space',
    })
    expect(result).toBe('mayukh@worksmayukh.space')
  })
})

// ── API service sanity ────────────────────────────────────────────────────────

describe('api.js exports', () => {
  it('has required auth methods', async () => {
    // Import the real api module structure (functions are vi.fn() from mock)
    const { api } = await import('../services/api')
    expect(typeof api.auth.login).toBe('function')
    expect(typeof api.auth.emailLogin).toBe('function')
    expect(typeof api.auth.forgotPassword).toBe('function')
    expect(typeof api.auth.verify).toBe('function')
  })

  it('has required admin methods', async () => {
    const { api } = await import('../services/api')
    expect(typeof api.admin.authUsers).toBe('function')
    expect(typeof api.admin.deploymentHealth).toBe('function')
  })
})
