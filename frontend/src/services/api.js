const BASE_URL = import.meta.env.VITE_API_URL || ''
const TIMEOUT_MS = 20_000

// ── Retry-capable fetch with timeout ──────────────────────────────────────
async function request(path, options = {}, retries = 2) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      signal: controller.signal,
      ...options,
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      const msg = err.detail || err.message || `HTTP ${res.status}`
      // Don't retry client errors (4xx)
      if (res.status >= 400 && res.status < 500) throw new Error(msg)
      throw new Error(msg)
    }

    if (res.status === 204) return null
    return res.json()

  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out — check your connection')
    // Retry on network errors / 5xx (not client errors)
    if (retries > 0 && !err.message?.startsWith('HTTP 4')) {
      await new Promise(r => setTimeout(r, 600))
      return request(path, options, retries - 1)
    }
    throw err
  } finally {
    clearTimeout(timer)
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
    chat:     (message, history = []) => request('/api/ai/chat',     { method: 'POST', body: JSON.stringify({ message, history }) }),
    autofill: (description)           => request('/api/ai/autofill', { method: 'POST', body: JSON.stringify({ description }) }),
    analyze:  (record_id)             => request('/api/ai/analyze',  { method: 'POST', body: JSON.stringify({ record_id }) }),
    report:   ()                      => request('/api/ai/report'),
  },
  health: () => request('/health', {}, 0),
}
