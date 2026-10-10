/**
 * Follow-ups from the cross-group review of the audit fix branch.
 *
 * A 401 for a request sent with an older token (an impersonation that was just
 * exited) used to wipe the token that had replaced it and bounce the user to
 * the login page. And while a deploy has a new frontend talking to an older
 * server, a live share link could be saved without its filter rules — so the
 * client now checks what the server kept.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { api, getAuthToken, setAuthToken } from '../services/api'
import { liveFiltersDropped } from '../components/SharedLinks'

const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: `status ${status}`,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
})

describe('401 handling only ends the session the request belonged to', () => {
  let fetchMock
  let expired
  const onExpired = () => { expired += 1 }

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expired = 0
    window.addEventListener('fintrack:auth-expired', onExpired)
  })
  afterEach(() => {
    window.removeEventListener('fintrack:auth-expired', onExpired)
    setAuthToken('')
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps a token that replaced the one the server rejected', async () => {
    setAuthToken('impersonation-token')
    fetchMock.mockImplementation(async () => {
      setAuthToken('admin-token')   // exit impersonation lands while the poll is in flight
      return reply(401, { error: { message: 'Session has been revoked' } })
    })
    await expect(api.sharedViews.list('status')).rejects.toMatchObject({ status: 401 })
    expect(getAuthToken()).toBe('admin-token')
    expect(expired).toBe(0)
  })

  it('still signs out when the current token is rejected', async () => {
    setAuthToken('dead-token')
    fetchMock.mockResolvedValue(reply(401, { error: { message: 'Session has been revoked' } }))
    await expect(api.sharedViews.list('invoices')).rejects.toMatchObject({ status: 401 })
    expect(getAuthToken()).toBe('')
    expect(expired).toBe(1)
  })
})

describe('liveFiltersDropped', () => {
  const sent = { filterConditions: [{ field: 'Client', op: 'is', value: 'Acme' }] }

  it('is false when the server kept every rule (view_config as a JSON string)', () => {
    expect(liveFiltersDropped(sent, { view_config: JSON.stringify(sent) })).toBe(false)
  })

  it('is true when an older server dropped the rules', () => {
    expect(liveFiltersDropped(sent, { view_config: { filterClient: '' } })).toBe(true)
    expect(liveFiltersDropped(sent, { view_config: null })).toBe(true)
  })

  it('counts status-board advancedConditions the server stores as filterConditions', () => {
    const status = { advancedConditions: [{ field: 'Status', op: 'is', value: 'On Hold' }] }
    expect(liveFiltersDropped(status, { view_config: { filterConditions: status.advancedConditions } })).toBe(false)
  })

  it('ignores links that carried no rules', () => {
    expect(liveFiltersDropped({ filterClient: 'Acme' }, { view_config: {} })).toBe(false)
  })
})
