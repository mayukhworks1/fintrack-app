import { useState, useEffect } from 'react'
import { getAuthToken, API_BASE_URL } from '../services/api'

export function useAvatarSrc(avatarUrl) {
  const [src, setSrc] = useState(null)

  useEffect(() => {
    if (!avatarUrl) { setSrc(null); return }
    if (!avatarUrl.startsWith('/api/')) {
      // External URL (e.g. Google profile picture) — works without auth
      setSrc(avatarUrl); return
    }
    // Proxy URL — browser can't attach auth headers to <img src>, so fetch manually
    let objectUrl = null
    const token = getAuthToken()
    fetch(`${API_BASE_URL}${avatarUrl}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.ok ? r.blob() : Promise.reject(new Error(String(r.status))))
      .then(blob => {
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      })
      .catch(() => setSrc(null))

    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [avatarUrl])

  return src
}
