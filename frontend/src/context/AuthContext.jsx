import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api, getAuthToken, setAuthToken, clearAuthToken } from '../services/api'

const AuthContext = createContext(null)

const ROLE_KEY = 'fintrack-auth-role'

function getStoredRole() {
  try { return localStorage.getItem(ROLE_KEY) || 'editor' } catch { return 'editor' }
}
function setStoredRole(role) {
  try {
    if (role) localStorage.setItem(ROLE_KEY, role)
    else localStorage.removeItem(ROLE_KEY)
  } catch {}
}

export function AuthProvider({ children }) {
  // 'loading' | 'authed' | 'unauthed'
  const [status, setStatus] = useState(() => (getAuthToken() ? 'loading' : 'unauthed'))
  // 'editor' | 'viewer'
  const [role, setRole] = useState(() => getStoredRole())

  // Verify stored token on mount — also refreshes the role from server
  useEffect(() => {
    if (!getAuthToken()) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.auth.verify()
        if (!cancelled) {
          const r = res?.role || 'editor'
          setRole(r)
          setStoredRole(r)
          setStatus('authed')
        }
      } catch {
        clearAuthToken()
        setStoredRole(null)
        if (!cancelled) setStatus('unauthed')
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Listen for 401s from anywhere in the app
  useEffect(() => {
    const onExpired = () => {
      setStoredRole(null)
      setStatus('unauthed')
    }
    window.addEventListener('fintrack:auth-expired', onExpired)
    return () => window.removeEventListener('fintrack:auth-expired', onExpired)
  }, [])

  const login = useCallback(async (password) => {
    const res = await api.auth.login(password)
    if (!res?.token) throw new Error('Login failed')
    setAuthToken(res.token)
    const r = res.role || 'editor'
    setRole(r)
    setStoredRole(r)
    setStatus('authed')
  }, [])

  const logout = useCallback(() => {
    clearAuthToken()
    setStoredRole(null)
    setRole('editor')
    setStatus('unauthed')
  }, [])

  return (
    <AuthContext.Provider value={{
      status,
      role,
      isEditor: role === 'editor',
      isViewer: role === 'viewer',
      isWeb:    role === 'web',
      isAll:    role === 'all',
      isAdmin:  role === 'admin',
      login,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
