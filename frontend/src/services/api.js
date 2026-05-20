import { getDeviceHintHeader } from '../utils/deviceInfo'

const BASE_URL = import.meta.env.VITE_API_URL || ''
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
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch {}
}
export function clearAuthToken() { setAuthToken('') }

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

function _dedupeKey(method, path) { return `${method} ${path}` }

async function _dedupedFetch(method, path, runner, externalSignal) {
  if (method !== 'GET' || externalSignal) return runner()
  const key = _dedupeKey(method, path)
  const existing = _inflight.get(key)
  if (existing) return existing
  const promise = runner().finally(() => _inflight.delete(key))
  _inflight.set(key, promise)
  return promise
}

// ── Retry-capable fetch with timeout ──────────────────────────────────────
// If options.signal is provided (external AbortController), the caller owns
// cancellation — retries are disabled and the timeout is extended.
async function request(path, options = {}, retries = 2) {
  const { signal: externalSignal, timeout, ...rest } = options
  const method = (rest.method || 'GET').toUpperCase()

  // Coalesce identical concurrent GETs across the app
  return _dedupedFetch(method, path, () =>
    _doRequest(path, options, retries), externalSignal)
}

async function _doRequest(path, options = {}, retries = 2) {
  const { signal: externalSignal, timeout, ...rest } = options
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
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json', ...authHeader, ...hintHeader, ...rest.headers },
      signal: controller.signal,
      ...rest,
    })

    // Auto-logout on 401 from a protected endpoint (token expired / revoked)
    if (res.status === 401 && token) {
      clearAuthToken()
      window.dispatchEvent(new CustomEvent('fintrack:auth-expired'))
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
    return res.json()

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
      const q = new URLSearchParams()
      Object.entries(params).forEach(([k, v]) => v != null && v !== '' && q.set(k, v))
      return request(`/api/projects?${q}`)
    },
    get:     (id)       => request(`/api/projects/${id}`),
    create:  (data)     => request('/api/projects',     { method: 'POST',   body: JSON.stringify(data) }),
    update:  (id, data) => request(`/api/projects/${id}`, { method: 'PATCH',  body: JSON.stringify(data) }),
    delete:  (id)       => request(`/api/projects/${id}`, { method: 'DELETE' }),
    search:  (q, limit = 20) => request(`/api/projects/search?q=${encodeURIComponent(q)}&limit=${limit}`),
    summary: ()         => request('/api/projects/summary'),
  },
  ai: {
    chat:     (message, history = [], opts = {}) =>
      request('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ message, history }),
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
        }),
        signal: opts.signal,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err?.detail || err?.message || `HTTP ${res.status}`)
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
      const qs = opts.force ? '?force=true' : ''
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
    list:    (params = {}) => {
      const q = new URLSearchParams()
      Object.entries(params).forEach(([k, v]) => v != null && v !== '' && q.set(k, v))
      return request(`/api/invoices?${q}`)
    },
    summary: ()         => request('/api/invoices/summary'),
    get:     (id)       => request(`/api/invoices/${id}`),
    create:  (data)     => request('/api/invoices', { method: 'POST',   body: JSON.stringify(data) }),
    update:  (id, data) => request(`/api/invoices/${id}`, { method: 'PATCH',  body: JSON.stringify(data) }),
    delete:  (id)       => request(`/api/invoices/${id}`, { method: 'DELETE' }),
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
        return res.json()
      })
    },
  },
  associations: {
    search: (q, limit = 10) =>
      request(`/api/associations/search?q=${encodeURIComponent(q)}&limit=${limit}`),
    getRecord: (sourceTable, teableId) =>
      request(`/api/associations/record/${encodeURIComponent(sourceTable)}/${encodeURIComponent(teableId)}`),
    link: (data) =>
      request('/api/associations/link', { method: 'POST', body: JSON.stringify(data) }),
    unlink: (sourceTable, teableId) =>
      request(`/api/associations/record/${encodeURIComponent(sourceTable)}/${encodeURIComponent(teableId)}`, { method: 'DELETE' }),
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
        return res.json()
      })
    },
    list:    (params = {}) => {
      const q = new URLSearchParams()
      Object.entries(params).forEach(([k, v]) => v != null && v !== '' && q.set(k, v))
      return request(`/api/web-invoices?${q}`)
    },
    summary:  ()          => request('/api/web-invoices/summary'),
    get:      (id)        => request(`/api/web-invoices/${id}`),
    create:   (data)      => request('/api/web-invoices', { method: 'POST',   body: JSON.stringify(data) }),
    update:   (id, data)  => request(`/api/web-invoices/${id}`, { method: 'PATCH',  body: JSON.stringify(data) }),
    delete:   (id)        => request(`/api/web-invoices/${id}`, { method: 'DELETE' }),
    clientNames: ()              => request('/api/web-invoices/client-names'),
    picklists: {
      get:    ()                   => request('/api/web-invoices/picklists'),
      add:    (fieldName, option)  => request(`/api/web-invoices/picklists/${encodeURIComponent(fieldName)}`, {
        method: 'POST', body: JSON.stringify({ option }),
      }),
    },
  },
  webProjects: {
    list: (params = {}) => {
      const q = new URLSearchParams()
      Object.entries(params).forEach(([k, v]) => v != null && v !== '' && q.set(k, v))
      return request(`/api/web-projects?${q}`)
    },
    names:   ()         => request('/api/web-projects/names'),
    summary: ()         => request('/api/web-projects/summary'),
    get:     (id)       => request(`/api/web-projects/${id}`),
    create:  (data)     => request('/api/web-projects', { method: 'POST',   body: JSON.stringify(data) }),
    update:  (id, data) => request(`/api/web-projects/${id}`, { method: 'PATCH',  body: JSON.stringify(data) }),
    delete:  (id)       => request(`/api/web-projects/${id}`, { method: 'DELETE' }),
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
  status: {
    list: (params = {}) => {
      const q = new URLSearchParams()
      Object.entries(params).forEach(([k, v]) => v != null && v !== '' && q.set(k, v))
      return request(`/api/status?${q}`)
    },
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
    // Public — no auth header needed (still uses request() but no token will be found for public users)
    publicGet: (token, opts = {}) => request(`/api/public/view/${token}`, { signal: opts.signal }, 1),
    publicUpdate: (token, recordId, data) => request(`/api/public/view/${token}/records/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  },
  admin: {
    stats:              ()       => request('/api/admin/stats'),
    auditLog:      (p = {})     => { const q = new URLSearchParams(); Object.entries(p).forEach(([k,v]) => v != null && v !== '' && q.set(k,v)); return request(`/api/admin/audit-log?${q}`) },
    purgeAuditLog: ({ days, hours } = {}) => { const q = new URLSearchParams(); if (hours != null) q.set('older_than_hours', hours); else if (days != null) q.set('older_than_days', days); return request(`/api/admin/audit-log/purge?${q}`, { method: 'DELETE' }) },
    // sessions: booleans (active_only) are explicitly stringified so false→"false" reaches FastAPI
    sessions:      (p = {})     => { const q = new URLSearchParams(); Object.entries(p).forEach(([k,v]) => { if (v != null) q.set(k, String(v)) }); return request(`/api/admin/sessions?${q}`) },
    chatSessions:  (p = {})     => { const q = new URLSearchParams(); Object.entries(p).forEach(([k,v]) => v != null && v !== '' && q.set(k,v)); return request(`/api/admin/chat-sessions?${q}`) },
    chatMessages:  (id)         => request(`/api/admin/chat-sessions/${id}`),
    syncLog:       (p = {})     => { const q = new URLSearchParams(); Object.entries(p).forEach(([k,v]) => v != null && v !== '' && q.set(k,v)); return request(`/api/admin/sync-log?${q}`) },
    mirrorProjects:(p = {})     => { const q = new URLSearchParams(); Object.entries(p).forEach(([k,v]) => v != null && v !== '' && q.set(k,v)); return request(`/api/admin/mirror/projects?${q}`) },
    mirrorInvoices:(p = {})     => { const q = new URLSearchParams(); Object.entries(p).forEach(([k,v]) => v != null && v !== '' && q.set(k,v)); return request(`/api/admin/mirror/invoices?${q}`) },
    mirrorWebInvoices:(p = {})  => { const q = new URLSearchParams(); Object.entries(p).forEach(([k,v]) => v != null && v !== '' && q.set(k,v)); return request(`/api/admin/mirror/web-invoices?${q}`) },
    recordHistory: (p = {})     => { const q = new URLSearchParams(); Object.entries(p).forEach(([k,v]) => v != null && v !== '' && q.set(k,v)); return request(`/api/admin/record-history?${q}`) },
    sharedLinks:   (p = {})     => { const q = new URLSearchParams(); Object.entries(p).forEach(([k,v]) => v != null && v !== '' && q.set(k,v)); return request(`/api/admin/shared-links?${q}`) },
    sharedLinkAccesses: (token, limit = 200) => request(`/api/admin/shared-links/${token}/accesses?limit=${limit}`),
    triggerSync:   ()           => request('/api/admin/sync/trigger', { method: 'POST' }),
    diagnoseSync:  ()           => request('/api/admin/sync/diagnose'),
    getLogs:  (logType, limit = 300) => request(`/api/admin/logs/${encodeURIComponent(logType)}?limit=${limit}`),
  },
  health: () => request('/health', {}, 0),
  auth: {
    // Password is sent once over HTTPS, never stored client-side.
    // Only the returned token persists in localStorage.
    login:  (password) => request('/api/auth/login',  { method: 'POST', body: JSON.stringify({ password }) }),
    verify: ()         => request('/api/auth/verify', {}, 0),
    // Fire-and-forget server-side session invalidation — marks the session as
    // logged_out in login_sessions so the admin panel shows honest status.
    logout: ()         => request('/api/auth/logout', { method: 'POST' }, 0),
  },
}
