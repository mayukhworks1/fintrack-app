/**
 * AuthProvider: what ends a session, and what must not.
 *
 *  - App-start /verify signs out only when the server rejects the token
 *    (401/403). A network error, timeout or 5xx keeps the stored identity and
 *    asks again later.
 *  - The impersonation record holds the superadmin's own token. It must not
 *    outlive the impersonation: a 401, a fresh sign-in or a sign-out clears
 *    it, and a record that does not belong to the current session is dropped.
 *  - Exit impersonation revokes the impersonation session with ITS token
 *    before restoring the admin's.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'

vi.mock('../services/api', () => ({
  api: {
    auth: { verify: vi.fn(), logout: vi.fn(), login: vi.fn(), emailLogin: vi.fn() },
    admin: { exitImpersonation: vi.fn() },
  },
  getAuthToken: () => localStorage.getItem('fintrack-auth-token') || '',
  setAuthToken: vi.fn((t) => {
    if (t) localStorage.setItem('fintrack-auth-token', t)
    else localStorage.removeItem('fintrack-auth-token')
  }),
  clearAuthToken: vi.fn(() => localStorage.removeItem('fintrack-auth-token')),
}))

import { AuthProvider, useAuth } from '../context/AuthContext'
import { api, setAuthToken, clearAuthToken } from '../services/api'

const TOKEN_KEY = 'fintrack-auth-token'
const IMP_KEY = 'fintrack-impersonation'

let ctx
function Probe() {
  ctx = useAuth()
  return null
}
const mount = () => render(<AuthProvider><Probe /></AuthProvider>)
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const httpError = (status, message = `HTTP ${status}`) => Object.assign(new Error(message), { status })

function seedSignedIn(token = 't1') {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem('fintrack-auth-role', 'editor')
  localStorage.setItem('fintrack-auth-user', JSON.stringify({ id: 'u1', email: 'me@x.test' }))
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  api.auth.logout.mockResolvedValue({ logged_out: true })
  api.admin.exitImpersonation.mockResolvedValue({ ok: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('app-start /verify', () => {
  it.each([
    ['a network error', new TypeError('Failed to fetch')],
    ['a timeout', new Error('Request timed out — check your connection')],
    ['a cold-start 503', httpError(503, 'Service Unavailable')],
    ['a 500', httpError(500)],
  ])('keeps the stored session on %s', async (_label, err) => {
    seedSignedIn()
    api.auth.verify.mockRejectedValue(err)
    mount()
    await waitFor(() => expect(api.auth.verify).toHaveBeenCalled())
    await flush()
    expect(ctx.status).toBe('authed')
    expect(localStorage.getItem(TOKEN_KEY)).toBe('t1')
    expect(localStorage.getItem('fintrack-auth-user')).not.toBeNull()
    expect(clearAuthToken).not.toHaveBeenCalled()
  })

  it.each([401, 403])('signs out when the server rejects the token (%i)', async (status) => {
    seedSignedIn()
    api.auth.verify.mockRejectedValue(httpError(status))
    mount()
    await waitFor(() => expect(ctx.status).toBe('unauthed'))
    expect(clearAuthToken).toHaveBeenCalled()
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
    expect(localStorage.getItem('fintrack-auth-user')).toBeNull()
  })

  it('asks again after a transient failure and applies the answer', async () => {
    vi.useFakeTimers()
    seedSignedIn()
    api.auth.verify
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ valid: true, role: 'viewer', user: { id: 'u1', email: 'me@x.test' } })
    mount()
    await flush()
    expect(api.auth.verify).toHaveBeenCalledTimes(1)
    expect(ctx.status).toBe('authed')
    await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
    expect(api.auth.verify).toHaveBeenCalledTimes(2)
    expect(ctx.role).toBe('viewer')
  })
})

describe('impersonation', () => {
  const IMP = { originalToken: 'ADMIN', impersonationToken: 'IMP', targetUser: { email: 'target@x.test' } }

  function seedImpersonating() {
    seedSignedIn('IMP')
    localStorage.setItem(IMP_KEY, JSON.stringify(IMP))
    api.auth.verify.mockResolvedValue({ valid: true, role: 'editor', user: { id: 'u2', email: 'target@x.test' } })
  }

  it('a 401 from anywhere ends it', async () => {
    seedImpersonating()
    mount()
    await flush()
    expect(ctx.isImpersonating).toBe(true)
    act(() => { window.dispatchEvent(new CustomEvent('fintrack:auth-expired')) })
    expect(ctx.isImpersonating).toBe(false)
    expect(localStorage.getItem(IMP_KEY)).toBeNull()
  })

  it('a rejected app-start verify ends it', async () => {
    seedImpersonating()
    api.auth.verify.mockRejectedValue(httpError(401))
    mount()
    await waitFor(() => expect(ctx.status).toBe('unauthed'))
    expect(ctx.isImpersonating).toBe(false)
    expect(localStorage.getItem(IMP_KEY)).toBeNull()
  })

  it('a fresh sign-in ends it, so Exit cannot hand the next person the admin token', async () => {
    seedImpersonating()
    mount()
    await flush()
    await act(async () => { await ctx.acceptToken('VIEWER') })
    expect(ctx.isImpersonating).toBe(false)
    expect(localStorage.getItem(IMP_KEY)).toBeNull()
    await act(async () => { await ctx.exitImpersonation() })
    expect(setAuthToken).not.toHaveBeenCalledWith('ADMIN')
    expect(localStorage.getItem(TOKEN_KEY)).toBe('VIEWER')
  })

  it('a password sign-in ends it too', async () => {
    seedImpersonating()
    api.auth.login.mockResolvedValue({ token: 'NEW', role: 'viewer' })
    mount()
    await flush()
    await act(async () => { await ctx.login('pw') })
    expect(ctx.isImpersonating).toBe(false)
    expect(localStorage.getItem(IMP_KEY)).toBeNull()
  })

  it('drops a record left behind by another session', async () => {
    seedSignedIn('VIEWER')                     // someone else is signed in now
    localStorage.setItem(IMP_KEY, JSON.stringify(IMP))
    api.auth.verify.mockResolvedValue({ valid: true, role: 'viewer' })
    mount()
    await flush()
    expect(ctx.isImpersonating).toBe(false)
    expect(localStorage.getItem(IMP_KEY)).toBeNull()
  })

  it('drops a record that does not say which session it belongs to', async () => {
    seedSignedIn('IMP')
    localStorage.setItem(IMP_KEY, JSON.stringify({ originalToken: 'ADMIN', targetUser: {} }))
    api.auth.verify.mockResolvedValue({ valid: true, role: 'editor' })
    mount()
    await flush()
    expect(ctx.isImpersonating).toBe(false)
  })

  it('exit revokes the impersonation session with its own token, then restores the admin', async () => {
    seedImpersonating()
    const seen = []
    api.admin.exitImpersonation.mockImplementation((token) => {
      seen.push({ token, stored: localStorage.getItem(TOKEN_KEY) })
      return Promise.resolve({ ok: true })
    })
    mount()
    await flush()
    api.auth.verify.mockResolvedValue({ valid: true, role: 'editor', auth_role: 'superadmin', user: { id: 'u1', email: 'admin@x.test' } })
    await act(async () => { await ctx.exitImpersonation() })
    expect(seen).toEqual([{ token: 'IMP', stored: 'IMP' }])
    expect(localStorage.getItem(TOKEN_KEY)).toBe('ADMIN')
    expect(ctx.isImpersonating).toBe(false)
    expect(ctx.authRole).toBe('superadmin')
  })

  it('exit after the impersonation session died does not restore the admin token', async () => {
    seedImpersonating()
    api.admin.exitImpersonation.mockRejectedValue(httpError(401, 'Session has expired'))
    mount()
    await flush()
    await act(async () => { await ctx.exitImpersonation() })
    expect(setAuthToken).not.toHaveBeenCalledWith('ADMIN')
    expect(ctx.isImpersonating).toBe(false)
  })

  it('signing out mid-impersonation revokes both sessions and clears the record', async () => {
    seedImpersonating()
    mount()
    await flush()
    act(() => { ctx.logout() })
    expect(api.auth.logout).toHaveBeenCalledWith('IMP')
    expect(api.auth.logout).toHaveBeenCalledWith('ADMIN')
    expect(localStorage.getItem(IMP_KEY)).toBeNull()
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
    expect(ctx.isImpersonating).toBe(false)
  })
})
