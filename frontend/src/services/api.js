const BASE_URL = import.meta.env.VITE_API_URL || ''

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Request failed')
  }
  if (res.status === 204) return null
  return res.json()
}

// ── Projects ──────────────────────────────────────────────────────────────

export const api = {
  projects: {
    list: (params = {}) => {
      const q = new URLSearchParams()
      Object.entries(params).forEach(([k, v]) => v != null && q.set(k, v))
      return request(`/api/projects?${q}`)
    },
    get: (id) => request(`/api/projects/${id}`),
    create: (data) => request('/api/projects', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id) => request(`/api/projects/${id}`, { method: 'DELETE' }),
    search: (q, limit = 20) => request(`/api/projects/search?q=${encodeURIComponent(q)}&limit=${limit}`),
    summary: () => request('/api/projects/summary'),
  },
  ai: {
    chat: (message, history = []) =>
      request('/api/ai/chat', { method: 'POST', body: JSON.stringify({ message, history }) }),
    autofill: (description) =>
      request('/api/ai/autofill', { method: 'POST', body: JSON.stringify({ description }) }),
    analyze: (record_id) =>
      request('/api/ai/analyze', { method: 'POST', body: JSON.stringify({ record_id }) }),
    report: () => request('/api/ai/report'),
  },
}
