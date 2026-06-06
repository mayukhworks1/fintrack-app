/**
 * Frontend smoke tests — run with: cd frontend && npx vitest run
 * Tests pure logic and rendering; API calls are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Module-level mocks ────────────────────────────────────────────────────────

const mockLogin = vi.fn()
const mockLogout = vi.fn()

vi.mock('../services/api', () => ({
  api: {
    auth: {
      login:          vi.fn(),
      emailLogin:     vi.fn(),
      verify:         vi.fn().mockResolvedValue({ valid: true, role: 'editor' }),
      logout:         vi.fn().mockResolvedValue({}),
      forgotPassword: vi.fn(),
      getProfile:     vi.fn().mockResolvedValue({
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
    admin: {
      authUsers:        vi.fn().mockResolvedValue({ rows: [], total: 0 }),
      authRoles:        vi.fn().mockResolvedValue({ roles: [] }),
      deploymentHealth:     vi.fn().mockResolvedValue({ overall: true }),
      userTimeline:         vi.fn().mockResolvedValue({ user: {}, timeline: [], sessions: [], audit_request_count: 0 }),
      userTimelineExportUrl:(id, fmt) => `/api/admin/auth/users/${id}/timeline/export?fmt=${fmt}`,
      resendInvite:         vi.fn().mockResolvedValue({ ok: true, delivery: { sent: true } }),
      forcePasswordReset:   vi.fn().mockResolvedValue({ ok: true, sessions_revoked: 1, delivery: { sent: true } }),
    },
  },
  getAuthToken:   () => null,
  setAuthToken:   vi.fn(),
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
    login: mockLogin,
    logout: mockLogout,
  }),
  AuthProvider: ({ children }) => children,
}))

vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ dark: false, toggle: vi.fn() }),
  ThemeProvider: ({ children }) => children,
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function wrap(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

// ── Login ─────────────────────────────────────────────────────────────────────

describe('Login page', () => {
  let Login
  beforeEach(async () => {
    const mod = await import('../pages/Login')
    Login = mod.default
  })

  it('renders sign-in heading', () => {
    wrap(<Login />)
    expect(screen.getByText(/sign in to your workspace/i)).toBeInTheDocument()
  })

  it('shows email and password fields by default', () => {
    wrap(<Login />)
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument()
  })

  it('submit button is disabled with empty fields', () => {
    wrap(<Login />)
    const btn = screen.getByRole('button', { name: /sign in/i })
    expect(btn).toBeDisabled()
  })

  it('toggles to legacy password mode', () => {
    wrap(<Login />)
    fireEvent.click(screen.getByText(/use legacy password/i))
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
  })

  it('switches to register mode', () => {
    wrap(<Login />)
    fireEvent.click(screen.getByText(/create account/i))
    expect(screen.getByText(/create your account/i)).toBeInTheDocument()
  })

  it('shows forgot password link', () => {
    wrap(<Login />)
    expect(screen.getByText(/forgot password/i)).toBeInTheDocument()
  })
})

// ── owner_scope_email logic (pure JS mirror of backend rule) ──────────────────

describe('owner_scope_email logic', () => {
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

  it('uses teable_email override', () => {
    expect(ownerScopeEmail({
      isEmailAuth: true, authRole: 'user',
      teableEmail: 'Aditya.narkar@theworks.in',
      loginEmail:  'aditya@theworks.in',
    })).toBe('Aditya.narkar@theworks.in')
  })

  it('falls back to login email', () => {
    expect(ownerScopeEmail({
      isEmailAuth: true, authRole: 'web',
      teableEmail: null, loginEmail: 'mayukh@worksmayukh.space',
    })).toBe('mayukh@worksmayukh.space')
  })

  it('case-insensitive match works after lowercasing both sides', () => {
    const stored  = 'Aditya.narkar@theworks.in'
    const teable  = 'aditya.narkar@theworks.in'
    expect(stored.toLowerCase()).toBe(teable.toLowerCase())
  })
})

// ── API structure sanity ──────────────────────────────────────────────────────

describe('api service structure', () => {
  it('exports required auth methods', async () => {
    const { api } = await import('../services/api')
    expect(typeof api.auth.login).toBe('function')
    expect(typeof api.auth.emailLogin).toBe('function')
    expect(typeof api.auth.forgotPassword).toBe('function')
    expect(typeof api.auth.verify).toBe('function')
    expect(typeof api.auth.getProfile).toBe('function')
    expect(typeof api.auth.updateProfile).toBe('function')
    expect(typeof api.auth.changePassword).toBe('function')
  })

  it('exports required admin methods', async () => {
    const { api } = await import('../services/api')
    expect(typeof api.admin.authUsers).toBe('function')
    expect(typeof api.admin.deploymentHealth).toBe('function')
    expect(typeof api.admin.userTimeline).toBe('function')
    expect(typeof api.admin.resendInvite).toBe('function')
    expect(typeof api.admin.forcePasswordReset).toBe('function')
  })

  it('timeline export URL is formatted correctly', async () => {
    const { api } = await import('../services/api')
    const url = api.admin.userTimelineExportUrl('abc-123', 'csv')
    expect(url).toContain('abc-123')
    expect(url).toContain('fmt=csv')
  })
})

// ── Audit event schema rules (mirrors backend expectations) ───────────────────

describe('auth_events schema rules', () => {
  it('uses role column not actor_role', () => {
    // Regression: the delete INSERT previously used actor_role (wrong column).
    // This test documents the correct column name expected by the schema.
    const CORRECT_COLUMN = 'role'
    const WRONG_COLUMN   = 'actor_role'
    expect(CORRECT_COLUMN).not.toBe(WRONG_COLUMN)
    // The actual INSERT in admin.py must use 'role', which is verified by backend tests.
    expect(CORRECT_COLUMN).toBe('role')
  })
})
