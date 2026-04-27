const BASE_URL = import.meta.env.VITE_API_URL || ''
const TIMEOUT_MS = 20_000
const AI_TIMEOUT_MS = 90_000  // AI endpoints can take longer

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

// ── Retry-capable fetch with timeout ──────────────────────────────────────
// If options.signal is provided (external AbortController), the caller owns
// cancellation — retries are disabled and the timeout is extended.
async function request(path, options = {}, retries = 2) {
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
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json', ...authHeader, ...rest.headers },
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
      const msg = err.detail || err.message || `HTTP ${res.status}`
      throw new Error(msg)
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
    report:   (opts = {}) =>
      request('/api/ai/report', { signal: opts.signal, timeout: AI_TIMEOUT_MS }),
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
  },
  health: () => request('/health', {}, 0),
  auth: {
    // Password is sent once over HTTPS, never stored client-side.
    // Only the returned token persists in localStorage.
    login:  (password) => request('/api/auth/login',  { method: 'POST', body: JSON.stringify({ password }) }),
    verify: ()         => request('/api/auth/verify', {}, 0),
  },
}
