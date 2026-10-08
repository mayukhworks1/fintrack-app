/**
 * What the app shows before /verify answers.
 *
 * Every app open used to block on that round trip. With a token and a stored
 * identity the app must paint immediately and let /verify reconcile; without
 * an identity it must still wait, and with no token it is signed out.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../services/api', () => ({
  api: { auth: { verify: vi.fn(), logout: vi.fn() }, admin: { exitImpersonation: vi.fn() } },
  getAuthToken: () => localStorage.getItem('fintrack-auth-token') || '',
  setAuthToken: vi.fn(),
  clearAuthToken: vi.fn(),
}))

import { initialAuthStatus } from '../context/AuthContext'

describe('initial auth status', () => {
  beforeEach(() => localStorage.clear())

  it('is unauthed with no token, whatever else is stored', () => {
    localStorage.setItem('fintrack-auth-role', 'editor')
    expect(initialAuthStatus()).toBe('unauthed')
  })

  it('paints at once when a token and a stored role exist (legacy login)', () => {
    localStorage.setItem('fintrack-auth-token', 't')
    localStorage.setItem('fintrack-auth-role', 'web')
    expect(initialAuthStatus()).toBe('authed')
  })

  it('paints at once when a token and a stored user exist (email login)', () => {
    localStorage.setItem('fintrack-auth-token', 't')
    localStorage.setItem('fintrack-auth-user', JSON.stringify({ id: 'u1', email: 'a@b.c' }))
    expect(initialAuthStatus()).toBe('authed')
  })

  it('still waits for /verify when a token has no identity beside it', () => {
    localStorage.setItem('fintrack-auth-token', 't')
    expect(initialAuthStatus()).toBe('loading')
  })
})
