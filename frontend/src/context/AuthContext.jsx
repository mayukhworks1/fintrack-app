import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api, getAuthToken, setAuthToken, clearAuthToken } from '../services/api'

const AuthContext = createContext(null)

const ROLE_KEY = 'fintrack-auth-role'
const USER_KEY = 'fintrack-auth-user'
const AUTH_ROLE_KEY = 'fintrack-auth-master-role'
const PERMS_KEY = 'fintrack-auth-permissions'
const IMPERSONATION_KEY = 'fintrack-impersonation'  // stores { originalToken, user }

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
  // Set of effective permission keys for email-auth users; null = not loaded (legacy/anonymous)
  const [permissions, setPermissions] = useState(() => {
    const stored = getStoredJson(PERMS_KEY, null)
    return Array.isArray(stored) ? new Set(stored) : null
  })
  // Impersonation state — persisted in localStorage so refresh survives
  const [impersonation, setImpersonation] = useState(() => getStoredJson(IMPERSONATION_KEY, null))

  function _applyVerifyResponse(res) {
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
    if (Array.isArray(res?.permissions)) {
      const pset = new Set(res.permissions)
      setPermissions(pset)
      setStoredJson(PERMS_KEY, res.permissions)
    } else {
      setPermissions(null)
      setStoredJson(PERMS_KEY, null)
    }
  }

  // Verify stored token on mount — also refreshes the role from server
  useEffect(() => {
    if (!getAuthToken()) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.auth.verify()
        if (!cancelled) {
          _applyVerifyResponse(res)
          setStatus('authed')
        }
      } catch {
        clearAuthToken()
        setStoredRole(null)
        setStoredJson(USER_KEY, null)
        setStoredJson(PERMS_KEY, null)
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
      setStoredJson(PERMS_KEY, null)
      try { localStorage.removeItem(AUTH_ROLE_KEY) } catch {}
      setUser(null)
      setAuthRole('')
      setPermissions(null)
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
    _applyVerifyResponse(res)
    setStatus('authed')
  }, [])

  const acceptToken = useCallback(async (token) => {
    if (!token) throw new Error('Missing login token')
    try {
      setAuthToken(token)
      const res = await api.auth.verify()
      _applyVerifyResponse(res)
      setStatus('authed')
      return res
    } catch (err) {
      clearAuthToken()
      setStoredRole(null)
      setStoredJson(USER_KEY, null)
      setStoredJson(PERMS_KEY, null)
      try { localStorage.removeItem(AUTH_ROLE_KEY) } catch {}
      setAuthRole('')
      setUser(null)
      setPermissions(null)
      setStatus('unauthed')
      throw err
    }
  }, [])

  // Start impersonating a user — swap to their token, save admin's original token
  const startImpersonation = useCallback(async (impersonationToken, targetUser) => {
    const originalToken = getAuthToken()
    const imp = { originalToken, targetUser }
    setStoredJson(IMPERSONATION_KEY, imp)
    setImpersonation(imp)
    setAuthToken(impersonationToken)
    const res = await api.auth.verify()
    _applyVerifyResponse(res)
    setStatus('authed')
  }, [])

  // Exit impersonation — revoke the impersonation session, restore admin's original token
  const exitImpersonation = useCallback(async () => {
    const imp = getStoredJson(IMPERSONATION_KEY, null)
    if (!imp?.originalToken) return
    try { await api.admin.exitImpersonation() } catch { /* best-effort revoke */ }
    setStoredJson(IMPERSONATION_KEY, null)
    setImpersonation(null)
    setAuthToken(imp.originalToken)
    const res = await api.auth.verify()
    _applyVerifyResponse(res)
    setStatus('authed')
  }, [])

  const updateUser = useCallback((patch) => {
    setUser(u => {
      const next = u ? { ...u, ...patch } : patch
      setStoredJson(USER_KEY, next)
      return next
    })
  }, [])

  const logout = useCallback(() => {
    api.auth.logout().catch(() => {})
    clearAuthToken()
    setStoredRole(null)
    setStoredJson(USER_KEY, null)
    setStoredJson(PERMS_KEY, null)
    setStoredJson(IMPERSONATION_KEY, null)
    try { localStorage.removeItem(AUTH_ROLE_KEY) } catch {}
    setRole('editor')
    setAuthRole('')
    setUser(null)
    setPermissions(null)
    setImpersonation(null)
    setStatus('unauthed')
  }, [])

  // Helper: check if a permission key is granted.
  // Superadmin/admin bypass all permission checks on the backend — mirror that here.
  // Returns true for legacy/non-email sessions (backwards-compatible).
  const BYPASS_ROLES = new Set(['superadmin', 'admin'])
  const hasPerm = useCallback((key) => {
    if (permissions === null) return true        // legacy session — no restriction
    if (BYPASS_ROLES.has(authRole)) return true // superadmin/admin bypass everything
    return permissions.has(key)
  }, [permissions, authRole])

  return (
    <AuthContext.Provider value={{
      status,
      role,
      authRole,
      user,
      permissions,
      hasPerm,
      userEmail: user?.email || '',
      isEmailAuth: Boolean(user?.email),
      isEditor: role === 'editor',
      isViewer: role === 'viewer',
      isWeb:    role === 'web',
      isAll:    role === 'all',
      isAdmin:  role === 'admin',
      impersonation,
      isImpersonating: Boolean(impersonation),
      login,
      acceptToken,
      logout,
      updateUser,
      startImpersonation,
      exitImpersonation,
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
