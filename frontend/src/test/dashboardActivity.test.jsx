import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { api } from '../services/api'

/**
 * Pins the request contract for the Dashboard's aggregate endpoint.
 *
 * The Dashboard used to fetch its 400 most recent invoices in full. It now
 * asks /api/invoices/dashboard-activity for slim chart rows plus the
 * retainer aggregate, passing the user's current month so "overdue" is
 * decided in their timezone rather than the server's.
 */
describe('api.invoices.dashboardActivity', () => {
  let calls
  beforeEach(() => {
    calls = []
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      calls.push(String(url))
      return new Response(JSON.stringify({ activity: [], retainer: { total: 0, overdue_count: 0, healthy: 0, overdue: [] }, month: '2026-10' }),
        { status: 200, headers: { 'content-type': 'application/json' } })
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('hits the aggregate route with the default limit and the given month', async () => {
    await api.invoices.dashboardActivity({ month: '2026-10' })
    const url = calls.find(u => u.includes('/api/invoices/dashboard-activity'))
    expect(url).toBeTruthy()
    const q = new URL(url, 'http://x').searchParams
    expect(q.get('limit')).toBe('400')
    expect(q.get('month')).toBe('2026-10')
  })

  it('omits month when the caller has none, and honours a custom limit', async () => {
    await api.invoices.dashboardActivity({ limit: 50 })
    const q = new URL(calls.find(u => u.includes('dashboard-activity')), 'http://x').searchParams
    expect(q.get('limit')).toBe('50')
    expect(q.has('month')).toBe(false)
  })

  it('returns the parsed body', async () => {
    const out = await api.invoices.dashboardActivity({ month: '2026-10' })
    expect(out.retainer).toEqual({ total: 0, overdue_count: 0, healthy: 0, overdue: [] })
    expect(Array.isArray(out.activity)).toBe(true)
  })
})
