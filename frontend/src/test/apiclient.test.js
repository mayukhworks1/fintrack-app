/**
 * The real API client, against a stubbed fetch.
 *
 * Two defects lived here. A failed GET retried by calling request() again,
 * which found the GET's own in-flight promise in the dedupe map and awaited
 * it: the promise never settled, and every later identical GET joined it until
 * a reload — so a single cold-start 503 left a page loading forever, and the
 * error banner and 403 screen could never appear. And retryability was read
 * from the message text, so a 4xx with a JSON body (nearly all of them) was
 * "retried" into the same hang.
 *
 * Separately, error bodies were read as err.error.message || err.detail, which
 * showed FastAPI's 422 detail array as "[object Object]" and an admin
 * { error: "..." } body as "HTTP 503".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { api, apiErrorMessage } from '../services/api'

const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: `status ${status}`,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
})

function track(promise) {
  const state = { done: false }
  promise.then(
    (value) => Object.assign(state, { done: true, value }),
    (error) => Object.assign(state, { done: true, error }),
  )
  return state
}

let fetchMock
beforeEach(() => {
  vi.useFakeTimers()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('GET retries', () => {
  it('recovers from a transient 503 with the second response', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(503, { error: { message: 'Space is waking up' } }))
      .mockResolvedValueOnce(reply(200, { id: 'p1', fields: {} }))
    const call = track(api.projects.get('p1'))
    await vi.advanceTimersByTimeAsync(2000)
    expect(call.done).toBe(true)
    expect(call.value).toEqual({ id: 'p1', fields: {} })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects a 403 once, with its status and message, without retrying', async () => {
    fetchMock.mockResolvedValue(reply(403, { error: { message: 'Insufficient permissions' } }))
    const call = track(api.projects.get('p2'))
    await vi.advanceTimersByTimeAsync(2000)
    expect(call.done).toBe(true)
    expect(call.error.status).toBe(403)
    expect(call.error.message).toBe('Insufficient permissions')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry a 404 either', async () => {
    fetchMock.mockResolvedValue(reply(404, { detail: 'Project not found' }))
    const call = track(api.projects.get('p3'))
    await vi.advanceTimersByTimeAsync(2000)
    expect(call.error.message).toBe('Project not found')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries 429 and network failures, then gives up with the error', async () => {
    fetchMock.mockResolvedValueOnce(reply(429, { error: { message: 'Slow down' } }))
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const call = track(api.projects.get('p4'))
    await vi.advanceTimersByTimeAsync(3000)
    expect(call.done).toBe(true)
    expect(call.error).toBeInstanceOf(TypeError)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('clears the in-flight entry, so the same GET after a failure goes to the network again', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const first = track(api.projects.get('p5'))
    await vi.advanceTimersByTimeAsync(3000)
    expect(first.done).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    fetchMock.mockReset()
    fetchMock.mockResolvedValue(reply(200, { id: 'p5' }))
    const second = track(api.projects.get('p5'))
    await vi.advanceTimersByTimeAsync(100)
    expect(second.value).toEqual({ id: 'p5' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shares one retried request between concurrent identical GETs', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(502, {}))
      .mockResolvedValueOnce(reply(200, { id: 'p6' }))
    const a = track(api.projects.get('p6'))
    const b = track(api.projects.get('p6'))
    await vi.advanceTimersByTimeAsync(2000)
    expect(a.value).toEqual({ id: 'p6' })
    expect(b.value).toEqual({ id: 'p6' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('never retries a mutation', async () => {
    fetchMock.mockResolvedValue(reply(503, { error: { message: 'Teable unavailable' } }))
    const call = track(api.projects.create({ name: 'x' }))
    await vi.advanceTimersByTimeAsync(2000)
    expect(call.error.message).toBe('Teable unavailable')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('error messages', () => {
  it('turns a FastAPI 422 detail array into readable text', async () => {
    fetchMock.mockResolvedValue(reply(422, {
      detail: [
        { loc: ['body', 'amount_raised'], msg: 'Value error, Amount must be greater than zero', type: 'value_error' },
        { loc: ['body', 'raised_by'], msg: 'Value error, Raised By must be a valid email format', type: 'value_error' },
      ],
    }))
    const call = track(api.invoices.create({ amount_raised: 0 }))
    await vi.advanceTimersByTimeAsync(100)
    expect(call.error.status).toBe(422)
    expect(call.error.message).toBe(
      'amount raised: Amount must be greater than zero; raised by: Raised By must be a valid email format'
    )
    expect(call.error.message).not.toContain('[object Object]')
  })

  it('reads a plain string `error` body instead of reporting the status', async () => {
    fetchMock.mockResolvedValue(reply(503, { error: 'HF_TOKEN not configured' }))
    const call = track(api.projects.get('p7'))
    await vi.advanceTimersByTimeAsync(3000)
    expect(call.error.message).toBe('HF_TOKEN not configured')
    expect(call.error.status).toBe(503)
  })

  it('covers every body shape the backend sends', () => {
    expect(apiErrorMessage({ error: { message: 'Enveloped' } }, 400)).toBe('Enveloped')
    expect(apiErrorMessage({ error: 'Flat string' }, 503)).toBe('Flat string')
    expect(apiErrorMessage({ detail: 'Old style' }, 404)).toBe('Old style')
    expect(apiErrorMessage({ detail: [{ loc: ['query', 'limit'], msg: 'Input should be a valid integer' }] }, 422))
      .toBe('limit: Input should be a valid integer')
    expect(apiErrorMessage({ detail: [{ loc: ['body'], msg: 'Field required' }] }, 422)).toBe('Field required')
    expect(apiErrorMessage({ message: 'Bare message' }, 500)).toBe('Bare message')
    expect(apiErrorMessage(null, 502)).toBe('HTTP 502')
    expect(apiErrorMessage({ detail: [] }, 422)).toBe('HTTP 422')
  })
})
