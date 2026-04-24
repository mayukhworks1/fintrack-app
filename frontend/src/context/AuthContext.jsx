import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api, getAuthToken, setAuthToken, clearAuthToken } from '../services/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  // 'loading' | 'authed' | 'unauthed'
  const [status, setStatus] = useState(() => (getAuthToken() ? 'loading' : 'unauthed'))

  // Verify stored token on mount (token may have expired server-side)
  useEffect(() => {
    if (!getAuthToken()) return
    let cancelled = false
    ;(async () => {
      try {
        await api.auth.verify()
        if (!cancelled) setStatus('authed')
      } catch {
        clearAuthToken()
        if (!cancelled) setStatus('unauthed')
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Listen for 401s from anywhere in the app
  useEffect(() => {
    const onExpired = () => setStatus('unauthed')
    window.addEventListener('fintrack:auth-expired', onExpired)
    return () => window.removeEventListener('fintrack:auth-expired', onExpired)
  }, [])

  const login = useCallback(async (password) => {
    const res = await api.auth.login(password)
    if (!res?.token) throw new Error('Login failed')
    setAuthToken(res.token)
    setStatus('authed')
  }, [])

  const logout = useCallback(() => {
    clearAuthToken()
    setStatus('unauthed')
  }, [])

  return (
    <AuthContext.Provider value={{ status, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
