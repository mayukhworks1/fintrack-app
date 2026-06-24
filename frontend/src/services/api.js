import { getDeviceHintHeader } from '../utils/deviceInfo'

const BASE_URL = import.meta.env.VITE_API_URL || ''
/** Absolute base URL for the API — needed when constructing non-fetch connections
 *  like EventSource that don't go through the request() helper. */
export const API_BASE_URL = BASE_URL
const TIMEOUT_MS = 20_000
const AI_TIMEOUT_MS = 90_000  // AI endpoints can take longer

// ── Eagerly resolve the device hint once at module load so it's ready
// on the first request. After this the value is cached for the session.
let _deviceHint = ''
getDeviceHintHeader().then(h => { _deviceHint = h }).catch(() => {})

// ── Auth token helpers ───────────────────────────────────────────────────
// Token is an opaque HMAC-signed string from the backend. We send it via
// Authorization: Bearer. The password is NEVER stored client-side.
const TOKEN_KEY = 'fintrack-auth-token'
export function getAuthToken() {
  try { return localStorage.getItem(TOKEN_KEY) || '' } catch { return '' }
}
export function setAuthToken(t) {
  _clientCache.clear()
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch {}
}
export function clearAuthToken() {
  _clientCache.clear()
  setAuthToken('')
}

// ── In-flight request dedupe ──────────────────────────────────────────────
// Polling hooks across multiple mounted components frequently fire the
// SAME GET in parallel (e.g. /api/projects/summary from Dashboard + /exec
// + Analytics every 10s). We coalesce identical concurrent reads so the
// network and backend only see one request — all subscribers share the
// same promise.
//
// Only safe-method requests (GET) are deduped. Anything with a body or
// non-GET method bypasses entirely (mutations must not share promises).
// Requests with an external `signal` also bypass — the caller wants
// independent cancellation control.
const _inflight = new Map()  // key -> Promise

function _dedupeKey(method, path, fresh = false) { return `${method} ${path} ${fresh ? 'fresh' : 'cached'}` }

async function _dedupedFetch(method, path, runner, externalSignal, fresh = false) {
  if (method !== 'GET' || externalSignal) return runner()
  const key = _dedupeKey(method, path, fresh)
  const existing = _inflight.get(key)
  if (existing) return existing
  const promise = runner().finally(() => _inflight.delete(key))
  _inflight.set(key, promise)
  return promise
}

// ── Client-side memory cache ───────────────────────────────────────────────
// Use a short-lived stale cache for GET reads so route changes and remounts
// feel instant. Manual refresh paths pass `fresh: true`, which bypasses this.
// This keeps first paint fast while preserving a truthful "Refresh means live"
// contract.
const _clientCache = new Map()  // path → { data, ts }
const _CLIENT_TTL  = 8_000      // 8 s

function _ccGet(path, ttl = _CLIENT_TTL) {
  const e = _clientCache.get(path)
  if (!e) return null
  if (Date.now() - e.ts > ttl) { _clientCache.delete(path); return null }
  return e.data
}
function _ccSet(path, data) { _clientCache.set(path, { data, ts: Date.now() }) }

/** Bust all cached entries whose key starts with `prefix`. Call after any
 *  mutation that invalidates a list (create / update / delete). */
export function clientCacheBust(prefix) {
  for (const k of _clientCache.keys()) if (k.startsWith(prefix)) _clientCache.delete(k)
}

function bustInvoiceReads() {
  clientCacheBust('/api/invoices')
}

function bustWebInvoiceReads() {
  clientCacheBust('/api/web-invoices')
}

function bustWebProjectReads() {
  clientCacheBust('/api/web-projects')
}

// ── Retry-capable fetch with timeout ──────────────────────────────────────
// If options.signal is provided (external AbortController), the caller owns
// cancellation — retries are disabled and the timeout is extended.
async function request(path, options = {}, retries = 2) {
  const { signal: externalSignal, timeout, fresh = false, cacheTtl = _CLIENT_TTL, ...rest } = options
  const method = (rest.method || 'GET').toUpperCase()
  const skipClientCache = path.startsWith('/api/admin') || path === '/api/auth/verify'

  if (method === 'GET' && !externalSignal && !fresh && !skipClientCache) {
    const cached = _ccGet(path, cacheTtl)
    if (cached !== null) return cached
  }

  // Coalesce identical concurrent GETs across the app
  const data = await _dedupedFetch(method, path, () =>
    _doRequest(path, { signal: externalSignal, timeout, fresh: fresh || skipClientCache, cacheTtl, ...rest }, retries), externalSignal, fresh || skipClientCache)
  return data
}

async function requestBlob(path, options = {}) {
  const { signal: externalSignal, timeout, headers: extraHeaders, ...rest } = options
  const controller = new AbortController()
  const timeoutMs = timeout || TIMEOUT_MS
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs)
  let externalAborted = false
  const onExternalAbort = () => { externalAborted = true; controller.abort('external') }
  if (externalSignal) {
    if (externalSignal.aborted) { externalAborted = true; controller.abort('external') }
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }
  try {
    const token = getAuthToken()
    const authHeader = token ? { Authorization: `Bearer ${token}` } : {}
    if (!_deviceHint) {
      try { _deviceHint = await getDeviceHintHeader() } catch {}
    }
    const hintHeader = _deviceHint ? { 'X-Client-Hint': _deviceHint } : {}
    const contentType = extraHeaders === null ? {} : { 'Content-Type': 'application/json' }
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { ...contentType, ...authHeader, ...hintHeader, ...(extraHeaders || {}) },
      signal: controller.signal,
      ...rest,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err?.error?.message || err?.detail || err?.message || `HTTP ${res.status}`)
    }
    const blob = await res.blob()
    return {
      blob,
      filename: res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || null,
      contentType: res.headers.get('content-type') || blob.type || 'application/octet-stream',
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      if (externalAborted) {
        const e = new Error('Request cancelled')
        e.name = 'AbortError'
        throw e
      }
      throw new Error('Request timed out — check your connection')
    }
    throw err
  } finally {
    clearTimeout(timer)
    if (externalSignal) externalSignal.removeEventListener?.('abort', onExternalAbort)
  }
}

async function _doRequest(path, options = {}, retries = 2) {
  const { signal: externalSignal, timeout, fresh = false, cacheTtl = _CLIENT_TTL, headers: extraHeaders, ...rest } = options
  const method = (rest.method || 'GET').toUpperCase()
  if (method !== 'GET') retries = 0
  const controller = new AbortController()
  const timeoutMs = timeout || TIMEOUT_MS
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs)

  // Link external signal: if caller aborts, abort our controller too
  let externalAborted = false
  const onExternalAbort = () => { externalAborted = true; controller.abort('external') }
  if (externalSignal) {
    if (externalSignal.aborted) { externalAborted = true; controller.abort('external') }
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
    retries = 0
  }

  try {
    const token = getAuthToken()
    const authHeader = token ? { Authorization: `Bearer ${token}` } : {}
    // Lazy-resolve the device hint if it wasn't ready at module load.
    if (!_deviceHint) {
      try { _deviceHint = await getDeviceHintHeader() } catch {}
    }
    const hintHeader = _deviceHint ? { 'X-Client-Hint': _deviceHint } : {}
    // extraHeaders===null means "no Content-Type" (multipart — let browser set boundary).
    // extraHeaders===undefined/object means merge into defaults.
    const contentType = extraHeaders === null ? {} : { 'Content-Type': 'application/json' }
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { ...contentType, ...authHeader, ...hintHeader, ...(extraHeaders || {}) },
      signal: controller.signal,
      ...rest,
    })

    // Auto-logout on 401 from a protected endpoint (token expired / revoked)
    if (res.status === 401 && token) {
      clearAuthToken()
      window.dispatchEvent(new CustomEvent('fintrack:auth-expired'))
      // Redirect to login with message after a brief delay to allow context cleanup
      setTimeout(() => {
        if (window.location.pathname !== '/login') {
          window.location.href = '/login?reason=session-expired'
        }
      }, 100)
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      // Backend wraps errors as { error: { code, type, message, request_id } }
      // Older endpoints return { detail: "..." }
      const msg =
        err?.error?.message ||
        err?.detail ||
        err?.message ||
        `HTTP ${res.status}`
      const e = new Error(msg)
      e.status     = res.status
      e.requestId  = err?.error?.request_id
      e.errorType  = err?.error?.type
      throw e
    }

    if (res.status === 204) return null
    const data = await res.json()
    if (method === 'GET' && !fresh) _ccSet(path, data)
    return data

  } catch (err) {
    if (err.name === 'AbortError') {
      if (externalAborted) {
        const e = new Error('Request cancelled')
        e.name = 'AbortError'
        throw e
      }
      throw new Error('Request timed out — check your connection')
    }
    if (retries > 0 && !err.message?.startsWith('HTTP 4')) {
      await new Promise(r => setTimeout(r, 600))
      return request(path, options, retries - 1)
    }
    throw err
  } finally {
    clearTimeout(timer)
    if (externalSignal) externalSignal.removeEventListener?.('abort', onExternalAbort)
  }
}

// ── API surface ───────────────────────────────────────────────────────────
export const api = {
  projects: {
    list: (params = {}) => {
      const { fresh, cacheTtl, ...queryParams } = params
      const q = new URLSearchParams()
      Object.entries(queryParams).forEach(([k, v]) => v != null && v !== '' && q.set(k, v))
      // Always fresh — no cache (backend reads direct from Teable)
      return request(`/api/projects?${q}`, { fresh: true, cacheTtl: 0 })
    },
    get:     (id, opts = {})       => request(`/api/projects/${id}`, { fresh: true, cacheTtl: 0, ...opts }),
    create:  (data)     => request('/api/projects',     { method: 'POST',   body: JSON.stringify(data) }),
    update:  (id, data) => request(`/api/projects/${id}`, { method: 'PATCH',  body: JSON.stringify(data) }),
    delete:  (id)       => request(`/api/projects/${id}`, { method: 'DELETE' }),
    search:  (q, limit = 20) => request(`/api/projects/search?q=${encodeURIComponent(q)}&limit=${limit}`, { fresh: true, cacheTtl: 0 }),
    summary: (opts = {})         => request('/api/projects/summary', { fresh: true, cacheTtl: 0, ...opts }),
    names:   (opts = {})         => request('/api/projects/names', { fresh: true, cacheTtl: 0, ...opts }),
  },
  ai: {
    chat:     (message, history = [], opts = {}) =>
      request('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          message,
          history,
          session_id: opts.sessionId || null,
          response_mode: opts.responseMode || 'brief',
          temperature: typeof opts.temperature === 'number' ? opts.temperature : null,
        }),
        signal: opts.signal,
        timeout: AI_TIMEOUT_MS,
      }),
    chatStream: async (message, history = [], opts = {}) => {
      const token = getAuthToken()
      const authHeader = token ? { Authorization: `Bearer ${token}` } : {}
      if (!_deviceHint) {
        try { _deviceHint = await getDeviceHintHeader() } catch {}
      }
      const hintHeader = _deviceHint ? { 'X-Client-Hint': _deviceHint } : {}
      const res = await fetch(`${BASE_URL}/api/ai/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
          ...hintHeader,
        },
        body: JSON.stringify({
          message,
          history,
          session_id: opts.sessionId || null,
          response_mode: opts.responseMode || 'brief',
          temperature: typeof opts.temperature === 'number' ? opts.temperature : null,
        }),
        signal: opts.signal,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        const error = new Error(err?.detail || err?.message || `HTTP ${res.status}`)
        error.status = res.status
        throw error
      }
      return res
    },
    autofill: (description, opts = {}) =>
      request('/api/ai/autofill', {
        method: 'POST',
        body: JSON.stringify({ description }),
        signal: opts.signal,
        timeout: AI_TIMEOUT_MS,
      }),
    analyze:  (record_id, opts = {}) =>
      request('/api/ai/analyze', {
        method: 'POST',
        body: JSON.stringify({ record_id }),
        signal: opts.signal,
        timeout: AI_TIMEOUT_MS,
      }),
    report:   (opts = {}) => {
      const q = new URLSearchParams()
      if (opts.force) q.set('force', 'true')
      if (opts.template) q.set('template', opts.template)
      const qs = q.toString() ? `?${q.toString()}` : ''
      return request(`/api/ai/report${qs}`, { signal: opts.signal, timeout: AI_TIMEOUT_MS })
    },
    statusBriefing: (opts = {}) =>
      request('/api/ai/status-briefing', { signal: opts.signal, timeout: AI_TIMEOUT_MS }),
    reportInvalidate: () =>
      request('/api/ai/report/invalidate', { method: 'POST' }),
    reportHistory: (limit = 20) =>
      request(`/api/ai/report/history?limit=${limit}`),
    reportHistoryDetail: (id) =>
      request(`/api/ai/report/history/${encodeURIComponent(id)}`),
    reportHistoryDelete: (id) =>
      request(`/api/ai/report/history/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
  invoices: {
    upload: (recordId, fieldName, file) => {
      const form = new FormData()
      form.append('file', file)
      const token = getAuthToken()
      return fetch(`${BASE_URL}/api/invoices/upload/${encodeURIComponent(recordId)}/${encodeURIComponent(fieldName)}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      }).then(async res => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }))
          const e = new Error(err?.detail || `HTTP ${res.status}`)
          e.status = res.status
          throw e
        }
        const data = await res.json()
        bustInvoiceReads()
        return data
      })
    },
    list:    (params = {}) => {
      const { fresh, cacheTtl, ...queryParams } = params
      const q = new URLSearchParams()
      Object.entries(queryParams).forEach(([k, v]) => v != null && v !== '' && q.set(k, v))
      // Always fresh — no client cache for invoices (backend is also cache-free now)
      return request(`/api/invoices?${q}`, { fresh: true, cacheTtl: 0 })
    },
    picklists: (opts = {}) => request('/api/invoices/picklists', { fresh: true, cacheTtl: 0, ...opts }),
    summary: (opts = {})         => request('/api/invoices/summary', opts),
    get:     (id, opts = {})       => request(`/api/invoices/${id}`, opts),
    create:  async (data) => {
      const result = await request('/api/invoices', { method: 'POST', body: JSON.stringify(data) })
      bustInvoiceReads()
      return result
    },
    update:  async (id, data) => {
      const result = await request(`/api/invoices/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
      bustInvoiceReads()
      return result
    },
    delete:  async (id) => {
      const result = await request(`/api/invoices/${id}`, { method: 'DELETE' })
      bustInvoiceReads()
      return result
    },
    agingBuckets: (opts = {}) => request('/api/invoices/aging-buckets', { fresh: true, cacheTtl: 0, ...opts }),
    sendReminder: (id, body = {}) => request(`/api/invoices/${id}/send-reminder`, { method: 'POST', body: JSON.stringify(body) }),
    exportUrl: (params = {}) => {
      const q = new URLSearchParams({ fmt: 'csv' })
      Object.entries(params).forEach(([k, v]) => v != null && v !== '' && q.set(k, v))
      const token = getAuthToken()
      if (token) q.set('token', token)
      return `${BASE_URL}/api/invoices/export?${q}`
    },
    // Upload an invoice file (PDF/image) and get AI-extracted fields back.
    // Uses multipart/form-data — do NOT set Content-Type header (browser sets boundary).
    parse: (file) => {
      const form = new FormData()
      form.append('file', file)
      const token = getAuthToken()
      return fetch(`${BASE_URL}/api/invoices/parse`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      }).then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          // FastAPI validation errors (422) have detail = [{loc,msg,type}] array.
          // Our own errors (400/500) have detail = string.
          // Never let an array reach Error() constructor — it prints as [object Object].
          let msg
          if (body?.detail) {
            msg = Array.isArray(body.detail)
              ? (body.detail[0]?.msg || 'Request validation failed')
              : String(body.detail)
          } else {
            msg = `HTTP ${res.status}`
          }
          const e = new Error(msg)
          e.status = res.status
          throw e
        }
        const data = await res.json()
        bustWebInvoiceReads()
        return data
      })
    },
  },
  webInvoices: {
    // File upload bypasses the standard request() so the browser sets the
    // multipart/form-data Content-Type with the correct boundary automatically.
    upload: (recordId, fieldName, file) => {
      const form = new FormData()
      form.append('file', file)
      const token = getAuthToken()
      return fetch(`${BASE_URL}/api/web-invoices/upload/${encodeURIComponent(recordId)}/${encodeURIComponent(fieldName)}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      }).then(async res => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }))
          const e = new Error(err?.detail || `HTTP ${res.status}`)
          e.status = res.status
          throw e
        }
        const data = await res.json()
        bustWebInvoiceReads()
        return data
      })
    },
    list:    (params = {}) => {
      const { fresh, cacheTtl, ...queryParams } = params
      const q = new URLSearchParams()
      Object.entries(queryParams).forEach(([k, v]) => v != null && v !== '' && q.set(k, v))
      return request(`/api/web-invoices?${q}`, { fresh, cacheTtl })
    },
    summary:  (opts = {})          => request('/api/web-invoices/summary', opts),
    get:      (id, opts = {})        => request(`/api/web-invoices/${id}`, opts),
    create:   async (data) => {
      const result = await request('/api/web-invoices', { method: 'POST', body: JSON.stringify(data) })
      bustWebInvoiceReads()
      return result
    },
    update:   async (id, data) => {
      const result = await request(`/api/web-invoices/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
      bustWebInvoiceReads()
      return result
    },
    delete:   async (id) => {
      const result = await request(`/api/web-invoices/${id}`, { method: 'DELETE' })
      bustWebInvoiceReads()
      return result
    },
    clientNames:  ()              => request('/api/web-invoices/client-names'),
    agingBuckets: (opts = {})    => request('/api/web-invoices/aging-buckets', { fresh: true, cacheTtl: 0, ...opts }),
    avatarMap: ()                => request('/api/web-invoices/avatar-map', { cacheTtl: 120_000 }),
    exportUrl: (params = {}) => {
      const q = new URLSearchParams()
      const token = getAuthToken()
      if (token) q.set('token', token)
      if (params.status)  q.set('status',  params.status)
      if (params.project) q.set('project', params.project)
      if (params.from)    q.set('from',    params.from)
      if (params.to)      q.set('to',      params.to)
      return `${BASE_URL}/api/web-invoices/export?${q}`
    },
    parse: (file) => {
      const form = new FormData()
      form.append('file', file)
      const token = getAuthToken()
      return fetch(`${BASE_URL}/api/web-invoices/parse`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      }).then(async res => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }))
          const e = new Error(err?.detail || `HTTP ${res.status}`)
          e.status = res.status
          throw e
        }
        return res.json()
      })
    },
    picklists: {
      get:    ()                   => request('/api/web-invoices/picklists'),
      add:    async (fieldName, option) => {
        const result = await request(`/api/web-invoices/picklists/${encodeURIComponent(fieldName)}`, {
          method: 'POST', body: JSON.stringify({ option }),
        })
        bustWebInvoiceReads()
        return result
      },
    },
  },
  webProjects: {
    list: (params = {}) => {
      const { fresh, cacheTtl, ...queryParams } = params
      const q = new URLSearchParams()
      Object.entries(queryParams).forEach(([k, v]) => v != null && v !== '' && q.set(k, v))
      return request(`/api/web-projects?${q}`, { fresh, cacheTtl })
    },
    names:   (opts = {})         => request('/api/web-projects/names', { fresh: true, cacheTtl: 0, ...opts }),
    summary: (opts = {})         => request('/api/web-projects/summary', opts),
    get:     (id, opts = {})       => request(`/api/web-projects/${id}`, opts),
    create:  async (data) => {
      const result = await request('/api/web-projects', { method: 'POST', body: JSON.stringify(data) })
      bustWebProjectReads()
      bustWebInvoiceReads()
      return result
    },
    update:  async (id, data) => {
      const result = await request(`/api/web-projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
      bustWebProjectReads()
      bustWebInvoiceReads()
      return result
    },
    delete:  async (id) => {
      const result = await request(`/api/web-projects/${id}`, { method: 'DELETE' })
      bustWebProjectReads()
      bustWebInvoiceReads()
      return result
    },
    resources: {
      listAll: (params = {})    => { const q = new URLSearchParams(params).toString(); return request(`/api/web-resources?${q}`) },
      list:    (projectId)      => request(`/api/web-projects/${projectId}/resources?bust=true`),
      get:     (id)             => request(`/api/web-resources/${id}`),
      create:  (data)           => request('/api/web-resources', { method: 'POST',   body: JSON.stringify(data) }),
      update:  (id, data)       => request(`/api/web-resources/${id}`, { method: 'PATCH',  body: JSON.stringify(data) }),
      delete:  (id)             => request(`/api/web-resources/${id}`, { method: 'DELETE' }),
      assign:   (resourceId, projectId) => request(`/api/web-resources/${resourceId}/assign/${projectId}`, { method: 'POST' }),
      unassign: (resourceId, projectId) => request(`/api/web-resources/${resourceId}/assign/${projectId}`, { method: 'DELETE' }),
    },
  },
  reports: {
    gstSummary: (params = {}) => {
      const q = new URLSearchParams()
      if (params.from) q.set('from', params.from)
      if (params.to)   q.set('to',   params.to)
      return request(`/api/reports/gst-summary?${q}`, { fresh: true, cacheTtl: 0 })
    },
    webGstSummary: (params = {}) => {
      const q = new URLSearchParams()
      if (params.from) q.set('from', params.from)
      if (params.to)   q.set('to',   params.to)
      return request(`/api/reports/web-gst-summary?${q}`, { fresh: true, cacheTtl: 0 })
    },
  },

  status: {
    upload: (recordId, fieldName, file) => {
      const form = new FormData()
      form.append('file', file)
      const token = getAuthToken()
      return fetch(`${BASE_URL}/api/status/upload/${encodeURIComponent(recordId)}/${encodeURIComponent(fieldName)}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      }).then(async res => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }))
          const e = new Error(err?.detail || `HTTP ${res.status}`)
          e.status = res.status
          throw e
        }
        const data = await res.json()
        clientCacheBust('/api/status')
        return data
      })
    },
    list: (params = {}) => {
      const q = new URLSearchParams()
      Object.entries(params).forEach(([k, v]) => v != null && v !== '' && q.set(k, v))
      return request(`/api/status?${q}`)
    },
    options: (opts = {}) => request('/api/status/options', { fresh: true, cacheTtl: 0, ...opts }),
    get:    (id)       => request(`/api/status/${id}`),
    create: (data)     => request('/api/status',      { method: 'POST',   body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/status/${id}`, { method: 'PATCH',  body: JSON.stringify(data) }),
    delete: (id)       => request(`/api/status/${id}`, { method: 'DELETE' }),
    picklists: {
      get: () => request('/api/status/picklists'),
      add: (fieldName, option) => request(`/api/status/picklists/${encodeURIComponent(fieldName)}`, {
        method: 'POST',
        body: JSON.stringify({ option }),
      }),
    },
    aiUpdate: (record_ids, extra_context = '') =>
      request('/api/status/ai-update', {
        method: 'POST',
        body: JSON.stringify({ record_ids, extra_context }),
        timeout: AI_TIMEOUT_MS,
      }),
  },
  sharedViews: {
    list: (resourceType = '') => request(resourceType ? `/api/shared-views?resource_type=${encodeURIComponent(resourceType)}` : '/api/shared-views'),
    get:  (token)     => request(`/api/shared-views/${token}`),
    create: (data)    => request('/api/shared-views', { method: 'POST', body: JSON.stringify(data) }),
    update: (token, data) => request(`/api/shared-views/${token}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (token)   => request(`/api/shared-views/${token}`, { method: 'DELETE' }),
    accesses: (token) => request(`/api/shared-views/${token}/accesses`),
    deleteAccesses: (token, accessIds) => request(`/api/shared-views/${token}/accesses`, {
      method: 'DELETE',
      body: JSON.stringify({ access_ids: accessIds }),
    }),
    // Public — no auth header needed (still uses request() but no token will be found for public users)
    publicGet: (token, opts = {}) => {
      const path = opts.fresh
        ? `/api/public/view/${token}?bust=${Date.now()}`
        : `/api/public/view/${token}`
      return request(path, { signal: opts.signal }, 1)
    },
    publicUpdate: (token, recordId, data) => request(`/api/public/view/${token}/records/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
    // Fire-and-forget event (record_detail, attachment_open). Uses sendBeacon if available.
    recordEvent: (token, data) => {
      const url = `${BASE_URL}/api/public/view/${encodeURIComponent(token)}/event`
      const body = JSON.stringify(data)
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))
        return
      }
      fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } }).catch(() => {})
    },
    stats: (token) => request(`/api/shared-views/${token}/stats`),
  },
  admin: {
    stats:              (opts = {})       => request('/api/admin/stats', opts),
    auditLog:      (p = {})     => { const q = new URLSearchParams(); Object.entries(p).forEach(([k,v]) => v != null && v !== '' && q.set(k,v)); return request(`/api/admin/audit-log?${q}`) },
    purgeAuditLog: ({ days, hours } = {}) => { const q = new URLSearchParams(); if (hours != null) q.set('older_than_hours', hours); else if (days != null) q.set('older_than_days', days); return request(`/api/admin/audit-log/purge?${q}`, { method: 'DELETE' }) },
    // sessions: booleans (active_only) are explicitly stringified so false→"false" reaches FastAPI
    sessions:      (p = {})     => { const q = new URLSearchParams(); Object.entries(p).forEach(([k,v]) => { if (v != null) q.set(k, String(v)) }); return request(`/api/admin/sessions?${q}`) },
    purgeSessions: ({ days } = {}) => { const q = new URLSearchParams(); if (days != null) q.set('older_than_days', days); return request(`/api/admin/sessions/purge?${q}`, { method: 'DELETE' }) },
    authRoles:     ()           => request('/api/admin/auth/roles'),
    authUsers:     (p = {})     => { const q = new URLSearchParams(); Object.entries(p).forEach(([k,v]) => v != null && v !== '' && q.set(k,v)); return request(`/api/admin/auth/users?${q}`, { fresh: true }) },
    createAuthUser: (data = {}) => request('/api/admin/auth/users', { method: 'POST', body: JSON.stringify(data) }),
    approveAuthUser: (id, data = {}) => request(`/api/admin/auth/users/${encodeURIComponent(id)}/approve`, { method: 'PATCH', body: JSON.stringify(data) }),
    rejectAuthUser:  (id, data = {}) => request(`/api/admin/auth/users/${encodeURIComponent(id)}/reject`, { method: 'PATCH', body: JSON.stringify(data) }),
    disableAuthUser: (id, data = {}) => request(`/api/admin/auth/users/${encodeURIComponent(id)}/disable`, { method: 'PATCH', body: JSON.stringify(data) }),
    reactivateAuthUser: (id, data = {}) => request(`/api/admin/auth/users/${encodeURIComponent(id)}/reactivate`, { method: 'PATCH', body: JSON.stringify(data) }),
    updateAuthUserRole: (id, data = {}) => request(`/api/admin/auth/users/${encodeURIComponent(id)}/role`, { method: 'PATCH', body: JSON.stringify(data) }),
    revokeAuthUserSessions: (id) => request(`/api/admin/auth/users/${encodeURIComponent(id)}/sessions/revoke`, { method: 'POST' }),
    updateAuthUserName: (id, data = {}) => request(`/api/admin/auth/users/${encodeURIComponent(id)}/name`, { method: 'PATCH', body: JSON.stringify(data) }),
    setTeableEmail: (id, data = {}) => request(`/api/admin/auth/users/${encodeURIComponent(id)}/teable-email`, { method: 'PATCH', body: JSON.stringify(data) }),
    deleteAuthUser:       (id, force = false) => request(`/api/admin/auth/users/${encodeURIComponent(id)}?force=${force}`, { method: 'DELETE' }),
    userTimeline:         (id, p = {})  => { const q = new URLSearchParams(); Object.entries(p).forEach(([k,v]) => v != null && q.set(k,v)); return request(`/api/admin/auth/users/${encodeURIComponent(id)}/timeline?${q}`) },
    userTimelineExportUrl:(id, fmt='csv') => `${typeof window !== 'undefined' ? '' : ''}/api/admin/auth/users/${encodeURIComponent(id)}/timeline/export?fmt=${fmt}`,
    resendInvite:         (id)          => request(`/api/admin/auth/users/${encodeURIComponent(id)}/resend-invite`, { method: 'POST' }),
    forcePasswordReset:   (id)          => request(`/api/admin/auth/users/${encodeURIComponent(id)}/force-password-reset`, { method: 'POST' }),
    setUserPassword:      (id, password) => request(`/api/admin/auth/users/${encodeURIComponent(id)}/set-password`, { method: 'POST', body: JSON.stringify({ password }) }),
    impersonate:          (id)           => request(`/api/admin/impersonate/${encodeURIComponent(id)}`, { method: 'POST' }),
    exitImpersonation:    ()             => request('/api/admin/impersonate/exit', { method: 'POST' }),
    deploymentHealth:     (opts = {})   => request('/api/admin/deployment-health', opts),
    testEmail: (data = {}) => request('/api/admin/auth/email/test', { method: 'POST', body: JSON.stringify(data) }),
    testSmtp:  (data = {}) => request('/api/admin/auth/email/test', { method: 'POST', body: JSON.stringify(data) }), // alias
    chatSessions:  (p = {})     => { const q = new URLSearchParams(); Object.entries(p).forEach(([k,v]) => v != null && v !== '' && q.set(k,v)); return request(`/api/admin/chat-sessions?${q}`) },
    chatMessages:  (id)         => request(`/api/admin/chat-sessions/${id}`),
    aiGenerations: (p = {})     => { const q = new URLSearchParams(); Object.entries(p).forEach(([k,v]) => v != null && v !== '' && q.set(k,v)); return request(`/api/admin/ai-generations?${q}`) },
    aiGeneration:  (id)         => request(`/api/admin/ai-generations/${id}`),
    syncLog:       (p = {})     => { const q = new URLSearchParams(); Object.entries(p).forEach(([k,v]) => v != null && v !== '' && q.set(k,v)); return request(`/api/admin/sync-log?${q}`) },
    mirrorProjects:(p = {})     => { const q = new URLSearchParams(); Object.entries(p).forEach(([k,v]) => v != null && v !== '' && q.set(k,v)); return request(`/api/admin/mirror/projects?${q}`) },
    mirrorInvoices:(p = {})     => { const q = new URLSearchParams(); Object.entries(p).forEach(([k,v]) => v != null && v !== '' && q.set(k,v)); return request(`/api/admin/mirror/invoices?${q}`) },
    mirrorWebInvoices:(p = {})  => { const q = new URLSearchParams(); Object.entries(p).forEach(([k,v]) => v != null && v !== '' && q.set(k,v)); return request(`/api/admin/mirror/web-invoices?${q}`) },
    recordHistory: (p = {})     => { const q = new URLSearchParams(); Object.entries(p).forEach(([k,v]) => v != null && v !== '' && q.set(k,v)); return request(`/api/admin/record-history?${q}`) },
    sharedLinks:   (p = {})     => { const q = new URLSearchParams(); Object.entries(p).forEach(([k,v]) => v != null && v !== '' && q.set(k,v)); return request(`/api/admin/shared-links?${q}`) },
    sharedLinkAccesses: (token, limit = 200) => request(`/api/admin/shared-links/${token}/accesses?limit=${limit}`),
    sharedLinkStats: (token) => request(`/api/admin/shared-links/${token}/stats`),
    triggerSync:   ()           => request('/api/admin/sync/trigger', { method: 'POST' }),
    triggerAgingRefresh: ()      => request('/api/admin/sync/aging-refresh', { method: 'POST' }),
    diagnoseSync:  ()           => request('/api/admin/sync/diagnose'),
    getLogs:  (logType, limit = 300) => request(`/api/admin/logs/${encodeURIComponent(logType)}?limit=${limit}`),
    insightConfigs: (p = {}) => { const q = new URLSearchParams(); Object.entries(p).forEach(([k, v]) => v != null && v !== '' && q.set(k, v)); return request(`/api/admin/insight-configs?${q}`) },
    insightExports: (p = {}) => { const q = new URLSearchParams(); Object.entries(p).forEach(([k, v]) => v != null && v !== '' && q.set(k, v)); return request(`/api/admin/insight-exports?${q}`) },
    permissionMatrix: () => request('/api/admin/permissions/matrix'),
    setUserPermission: (userId, permKey, granted) => request(
      `/api/admin/permissions/users/${encodeURIComponent(userId)}/${encodeURIComponent(permKey)}`,
      { method: 'PUT', body: JSON.stringify({ granted }) }
    ),
  },
  insights: {
    listConfigs: (p = {}) => { const q = new URLSearchParams(); Object.entries(p).forEach(([k, v]) => v != null && v !== '' && q.set(k, v)); return request(`/api/insights/configs?${q}`) },
    createConfig: (data) => request('/api/insights/configs', { method: 'POST', body: JSON.stringify(data) }),
    updateConfig: (id, data) => request(`/api/insights/configs/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deleteConfig: (id) => request(`/api/insights/configs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    export: (data, opts = {}) => requestBlob('/api/insights/export', { method: 'POST', body: JSON.stringify(data), signal: opts.signal, timeout: AI_TIMEOUT_MS }),
  },
  health: () => request('/health', {}, 0),
  auth: {
    // Password is sent once over HTTPS, never stored client-side.
    // Only the returned token persists in localStorage.
    login:  (password) => request('/api/auth/login',  { method: 'POST', body: JSON.stringify({ password }) }),
    emailLogin: (email, password) => request('/api/auth/email/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    emailRegister: (data) => request('/api/auth/email/register', { method: 'POST', body: JSON.stringify(data) }),
    emailBootstrap: (data) => request('/api/auth/email/bootstrap', { method: 'POST', body: JSON.stringify(data) }),
    providers: () => request('/api/auth/providers', {}, 0),
    googleStartUrl: (next = '/') => `${API_BASE_URL}/api/auth/google/start?next=${encodeURIComponent(next || '/')}`,
    zohoStartUrl:   (next = '/') => `${API_BASE_URL}/api/auth/zoho/start?next=${encodeURIComponent(next || '/')}`,
    forgotPassword: (email) => request('/api/auth/email/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
    resetPassword: (token, password) => request('/api/auth/email/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
    verify: ()         => request('/api/auth/verify', {}, 0),
    logout: ()         => request('/api/auth/logout', { method: 'POST' }, 0),
    getProfile:      ()       => request('/api/auth/profile'),
    updateProfile:   (data)   => request('/api/auth/profile', { method: 'PATCH', body: JSON.stringify(data) }),
    changePassword:  (data)   => request('/api/auth/change-password', { method: 'POST', body: JSON.stringify(data) }),
    uploadAvatar: (file) => {
      const form = new FormData()
      form.append('file', file)
      return request('/api/auth/profile/avatar', { method: 'POST', body: form, headers: null })
    },
    deleteAvatar: () => request('/api/auth/profile/avatar', { method: 'DELETE' }),
  },
}
