import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api, getAuthToken, setAuthToken, clearAuthToken } from '../services/api'

const AuthContext = createContext(null)

const ROLE_KEY = 'fintrack-auth-role'
const USER_KEY = 'fintrack-auth-user'
const AUTH_ROLE_KEY = 'fintrack-auth-master-role'

function getStoredRole() {
  try { return localStorage.getItem(ROLE_KEY) || 'editor' } catch { return 'editor' }
}
function setStoredRole(role) {
  try {
    if (role) localStorage.setItem(ROLE_KEY, role)
    else localStorage.removeItem(ROLE_KEY)
  } catch {}
}
function getStoredJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}
function setStoredJson(key, value) {
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value))
    else localStorage.removeItem(key)
  } catch {}
}

export function AuthProvider({ children }) {
  // 'loading' | 'authed' | 'unauthed'
  const [status, setStatus] = useState(() => (getAuthToken() ? 'loading' : 'unauthed'))
  // 'editor' | 'viewer'
  const [role, setRole] = useState(() => getStoredRole())
  const [authRole, setAuthRole] = useState(() => {
    try { return localStorage.getItem(AUTH_ROLE_KEY) || '' } catch { return '' }
  })
  const [user, setUser] = useState(() => getStoredJson(USER_KEY, null))

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
          setAuthRole(res?.auth_role || '')
          setStoredJson(USER_KEY, res?.user || null)
          try {
            if (res?.auth_role) localStorage.setItem(AUTH_ROLE_KEY, res.auth_role)
            else localStorage.removeItem(AUTH_ROLE_KEY)
          } catch {}
          setUser(res?.user || null)
          setStatus('authed')
        }
      } catch {
        clearAuthToken()
        setStoredRole(null)
        setStoredJson(USER_KEY, null)
        try { localStorage.removeItem(AUTH_ROLE_KEY) } catch {}
        if (!cancelled) setStatus('unauthed')
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Listen for 401s from anywhere in the app
  useEffect(() => {
    const onExpired = () => {
      setStoredRole(null)
      setStoredJson(USER_KEY, null)
      try { localStorage.removeItem(AUTH_ROLE_KEY) } catch {}
      setUser(null)
      setAuthRole('')
      setStatus('unauthed')
    }
    window.addEventListener('fintrack:auth-expired', onExpired)
    return () => window.removeEventListener('fintrack:auth-expired', onExpired)
  }, [])

  const login = useCallback(async (credentials, maybePassword) => {
    const email = typeof credentials === 'object' ? credentials?.email : ''
    const password = typeof credentials === 'object' ? credentials?.password : (maybePassword || credentials)
    const res = email
      ? await api.auth.emailLogin(email, password)
      : await api.auth.login(password)
    if (!res?.token) throw new Error('Login failed')
    setAuthToken(res.token)
    const r = res.role || 'editor'
    setRole(r)
    setStoredRole(r)
    setAuthRole(res.auth_role || '')
    setUser(res.user || null)
    setStoredJson(USER_KEY, res.user || null)
    try {
      if (res.auth_role) localStorage.setItem(AUTH_ROLE_KEY, res.auth_role)
      else localStorage.removeItem(AUTH_ROLE_KEY)
    } catch {}
    setStatus('authed')
  }, [])

  const acceptToken = useCallback(async (token) => {
    if (!token) throw new Error('Missing login token')
    try {
      setAuthToken(token)
      const res = await api.auth.verify()
      const r = res?.role || 'editor'
      setRole(r)
      setStoredRole(r)
      setAuthRole(res?.auth_role || '')
      setUser(res?.user || null)
      setStoredJson(USER_KEY, res?.user || null)
      try {
        if (res?.auth_role) localStorage.setItem(AUTH_ROLE_KEY, res.auth_role)
        else localStorage.removeItem(AUTH_ROLE_KEY)
      } catch {}
      setStatus('authed')
      return res
    } catch (err) {
      clearAuthToken()
      setStoredRole(null)
      setStoredJson(USER_KEY, null)
      try { localStorage.removeItem(AUTH_ROLE_KEY) } catch {}
      setAuthRole('')
      setUser(null)
      setStatus('unauthed')
      throw err
    }
  }, [])

  const updateUser = useCallback((patch) => {
    setUser(u => {
      const next = u ? { ...u, ...patch } : patch
      setStoredJson(USER_KEY, next)
      return next
    })
  }, [])

  const logout = useCallback(() => {
    // Fire server-side session invalidation first (fire-and-forget).
    // The backend marks is_active=false so the admin panel shows "Logged out"
    // rather than "Idle/Valid" for the rest of the 7-day token TTL.
    api.auth.logout().catch(() => {})  // never block logout on network failure
    clearAuthToken()
    setStoredRole(null)
    setStoredJson(USER_KEY, null)
    try { localStorage.removeItem(AUTH_ROLE_KEY) } catch {}
    setRole('editor')
    setAuthRole('')
    setUser(null)
    setStatus('unauthed')
  }, [])

  return (
    <AuthContext.Provider value={{
      status,
      role,
      authRole,
      user,
      userEmail: user?.email || '',
      isEmailAuth: Boolean(user?.email),
      isEditor: role === 'editor',
      isViewer: role === 'viewer',
      isWeb:    role === 'web',
      isAll:    role === 'all',
      isAdmin:  role === 'admin',
      login,
      acceptToken,
      logout,
      updateUser,
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
