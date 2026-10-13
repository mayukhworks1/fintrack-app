import { useState, useEffect } from 'react'
import { getAuthToken, API_BASE_URL } from '../services/api'

// One download per avatar URL for the whole session. A list can show the same
// person's picture on every row; without this each row fetched it separately
// (78 copies of a 300 KB image on the invoices screen). Avatar URLs carry a
// ?v= version, so a new upload is a new key. A failed fetch is forgotten so
// the next render can retry.
const cache = new Map()   // avatarUrl -> Promise<objectUrl>

function loadAvatar(avatarUrl) {
  let p = cache.get(avatarUrl)
  if (!p) {
    const token = getAuthToken()
    p = fetch(`${API_BASE_URL}${avatarUrl}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.ok ? r.blob() : Promise.reject(new Error(String(r.status))))
      .then(blob => URL.createObjectURL(blob))
    p.catch(() => cache.delete(avatarUrl))
    cache.set(avatarUrl, p)
  }
  return p
}

export function useAvatarSrc(avatarUrl) {
  const [src, setSrc] = useState(null)

  useEffect(() => {
    if (!avatarUrl) { setSrc(null); return }
    if (!avatarUrl.startsWith('/api/')) {
      // External URL (e.g. Google profile picture) — works without auth
      setSrc(avatarUrl); return
    }
    // Proxy URL — browser can't attach auth headers to <img src>, so fetch manually
    let cancelled = false
    loadAvatar(avatarUrl)
      .then(url => { if (!cancelled) setSrc(url) })
      .catch(() => { if (!cancelled) setSrc(null) })
    return () => { cancelled = true }
  }, [avatarUrl])

  return src
}

// For tests.
export function _clearAvatarCache() { cache.clear() }
