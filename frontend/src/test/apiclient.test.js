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
 *
 * And the admin timeline export was a relative link: it never reached the API
 * host, and a link sends no Authorization header, so it could not have
 * authenticated there either.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { api, apiErrorMessage, API_BASE_URL, setAuthToken } from '../services/api'

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

describe('admin timeline export', () => {
  afterEach(() => setAuthToken(''))

  it('fetches from the API host with the bearer token, never with the token in the URL', async () => {
    setAuthToken('tok-123')
    const blob = new Blob(['timestamp,event_type\n'], { type: 'text/csv' })
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/csv' }),
      blob: async () => blob,
    })
    const call = track(api.admin.userTimelineExport('user 1', 'csv'))
    await vi.advanceTimersByTimeAsync(100)

    expect(call.value.blob).toBe(blob)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${API_BASE_URL}/api/admin/auth/users/user%201/timeline/export?fmt=csv`)
    expect(url).not.toContain('tok-123')
    expect(init.headers.Authorization).toBe('Bearer tok-123')
  })

  it('rejects with the server message when the export is refused', async () => {
    fetchMock.mockResolvedValue(reply(403, { error: { message: 'Admin access required' } }))
    const call = track(api.admin.userTimelineExport('u-1', 'json'))
    await vi.advanceTimersByTimeAsync(100)
    expect(call.error.message).toBe('Admin access required')
  })
})

describe('AI gateway client', () => {
  const GW = `${API_BASE_URL}/api/admin/ai-gateway`

  it('sends a provider key only in the JSON body of a PUT', async () => {
    fetchMock.mockResolvedValue(reply(200, { key: 'openrouter', key_hint: 'cd12' }))
    const call = track(api.admin.aiGateway.setKey('openrouter', 'sk-or-v1-abcdef12'))
    await vi.advanceTimersByTimeAsync(100)
    expect(call.value.key_hint).toBe('cd12')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${GW}/providers/openrouter/key`)
    expect(url).not.toContain('sk-or-v1')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ api_key: 'sk-or-v1-abcdef12' })
  })

  it('maps each write to its method, path and body', async () => {
    fetchMock.mockResolvedValue(reply(200, {}))
    const cases = [
      [() => api.admin.aiGateway.saveProvider('groq', { enabled: false }), 'PATCH', '/providers/groq', { enabled: false }],
      [() => api.admin.aiGateway.removeKey('groq'), 'DELETE', '/providers/groq/key', undefined],
      [() => api.admin.aiGateway.testAll(), 'POST', '/providers/test-all', undefined],
      [() => api.admin.aiGateway.saveTask('chat', { daily_cap: null }), 'PATCH', '/tasks/chat', { daily_cap: null }],
      [() => api.admin.aiGateway.savePrompt('chat', null), 'PUT', '/tasks/chat/prompt', { prompt: null }],
      [() => api.admin.aiGateway.testTask('judge', null), 'POST', '/tasks/judge/test', { input: null }],
      [() => api.admin.aiGateway.saveGlobal({ daily_call_cap: 10 }), 'PATCH', '/global', { daily_call_cap: 10 }],
      [() => api.admin.aiGateway.promptVersion('chat', 3), 'GET', '/tasks/chat/prompt/versions/3', undefined],
    ]
    for (const [run, method, path, body] of cases) {
      fetchMock.mockClear()
      const call = track(run())
      await vi.advanceTimersByTimeAsync(100)
      expect(call.done).toBe(true)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(`${GW}${path}`)
      expect((init.method || 'GET').toUpperCase()).toBe(method)
      expect(init.body === undefined ? undefined : JSON.parse(init.body)).toEqual(body)
    }
  })

  it('leaves empty call-log filters out of the query', async () => {
    fetchMock.mockResolvedValue(reply(200, { total: 0, rows: [] }))
    const call = track(api.admin.aiGateway.calls({ from: '2026-10-01', to: '2026-10-15', task: 'chat', provider: '', status: null, limit: 50, offset: 0 }))
    await vi.advanceTimersByTimeAsync(100)
    expect(call.done).toBe(true)
    expect(fetchMock.mock.calls[0][0]).toBe(`${GW}/calls?from=2026-10-01&to=2026-10-15&task=chat&limit=50&offset=0`)
  })

  it('gives connection tests the long AI timeout and ordinary reads the default one', async () => {
    fetchMock.mockImplementation((url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      setTimeout(() => resolve(reply(200, { ok: true })), 30_000)
    }))
    const test = track(api.admin.aiGateway.testProvider('groq'))
    await vi.advanceTimersByTimeAsync(31_000)
    expect(test.value).toEqual({ ok: true })

    const read = track(api.admin.aiGateway.get())
    await vi.advanceTimersByTimeAsync(100_000)
    expect(read.error.message).toMatch(/timed out/)
  })
})
