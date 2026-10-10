import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api, getAuthToken, setAuthToken, clearAuthToken } from '../services/api'

const AuthContext = createContext(null)

const ROLE_KEY = 'fintrack-auth-role'
const USER_KEY = 'fintrack-auth-user'
const AUTH_ROLE_KEY = 'fintrack-auth-master-role'
const PERMS_KEY = 'fintrack-auth-permissions'
const IMPERSONATION_KEY = 'fintrack-impersonation'  // stores { originalToken, impersonationToken, targetUser }

// Back-off between /verify retries after a network error, timeout or 5xx.
const VERIFY_RETRY_MS = [2000, 5000, 15000, 30000]

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

/**
 * The stored impersonation, but only while the session it describes is the
 * one signed in. The record holds the superadmin's own token; one left behind
 * by an expired impersonation (or by a build that did not record which token
 * it belonged to) would hand that token to whoever signs in next through
 * "Exit impersonation". Anything that does not match is dropped.
 */
function loadImpersonation() {
  const imp = getStoredJson(IMPERSONATION_KEY, null)
  if (!imp) return null
  const current = getAuthToken()
  if (imp.originalToken && imp.impersonationToken && current && imp.impersonationToken === current) return imp
  setStoredJson(IMPERSONATION_KEY, null)
  return null
}

/**
 * What to show before /verify answers.
 *
 * Every app open used to wait on that round trip — the API is ~200 ms from
 * the browser and its database ~210 ms further, so the spinner sat there for
 * a second or more before a single page could mount or fetch anything.
 *
 * The role, user and permissions /verify returns are already persisted from
 * the last answer (see _applyVerifyResponse). When they exist alongside a
 * token, the app paints with them at once and the pages start their own
 * requests in parallel with /verify, which then reconciles: a changed role
 * or permission set is applied the moment it lands, and a rejected token
 * clears everything and drops to the login screen exactly as before. The
 * API client also fires `fintrack:auth-expired` on any 401, so a revoked
 * session cannot keep a page alive on stale local state.
 */
export function initialAuthStatus() {
  if (!getAuthToken()) return 'unauthed'
  let hasIdentity = false
  try { hasIdentity = !!(localStorage.getItem(ROLE_KEY) || localStorage.getItem(USER_KEY)) } catch {}
  return hasIdentity ? 'authed' : 'loading'
}

export function AuthProvider({ children }) {
  // 'loading' | 'authed' | 'unauthed'
  const [status, setStatus] = useState(initialAuthStatus)
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
  const [impersonation, setImpersonation] = useState(loadImpersonation)

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

  // A sign-in, sign-out or rejected token ends any impersonation: the record
  // holds the superadmin's token and must never outlive the session it was for.
  function _clearImpersonation() {
    setStoredJson(IMPERSONATION_KEY, null)
    setImpersonation(null)
  }

  // Verify stored token on mount — also refreshes the role from server
  useEffect(() => {
    const token = getAuthToken()
    if (!token) return
    let cancelled = false
    let timer = null
    const attempt = async (n) => {
      // Signed out, or signed in afresh, since this check was scheduled
      if (getAuthToken() !== token) return
      try {
        const res = await api.auth.verify()
        if (!cancelled) {
          _applyVerifyResponse(res)
          setStatus('authed')
        }
      } catch (err) {
        if (cancelled) return
        if (err?.status === 401 || err?.status === 403) {
          // The server rejected the token: sign out.
          clearAuthToken()
          setStoredRole(null)
          setStoredJson(USER_KEY, null)
          setStoredJson(PERMS_KEY, null)
          try { localStorage.removeItem(AUTH_ROLE_KEY) } catch {}
          _clearImpersonation()
          setStatus('unauthed')
          return
        }
        // Network error, timeout or 5xx — a cold start, a redeploy, a phone
        // between cells. That says nothing about the token, so keep the
        // identity the app already painted from and ask again shortly. Any
        // real request that gets a 401 meanwhile still signs out.
        timer = setTimeout(() => attempt(n + 1), VERIFY_RETRY_MS[Math.min(n, VERIFY_RETRY_MS.length - 1)])
      }
    }
    attempt(0)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])

  // Listen for 401s from anywhere in the app
  useEffect(() => {
    const onExpired = () => {
      setStoredRole(null)
      setStoredJson(USER_KEY, null)
      setStoredJson(PERMS_KEY, null)
      try { localStorage.removeItem(AUTH_ROLE_KEY) } catch {}
      _clearImpersonation()
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
    _clearImpersonation()
    setAuthToken(res.token)
    _applyVerifyResponse(res)
    setStatus('authed')
  }, [])

  const acceptToken = useCallback(async (token) => {
    if (!token) throw new Error('Missing login token')
    _clearImpersonation()
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
    // impersonationToken ties the record to this session (see loadImpersonation)
    const imp = { originalToken, impersonationToken, targetUser }
    // Persist FIRST before any async work so a reload never loses the state
    setStoredJson(IMPERSONATION_KEY, imp)
    setImpersonation(imp)
    setAuthToken(impersonationToken)
    try {
      const res = await api.auth.verify()
      _applyVerifyResponse(res)
    } catch {
      // Verify failure is non-fatal — impersonation state is already saved.
      // The banner will still show; the next page render will re-verify.
    }
    setStatus('authed')
  }, [])

  // Exit impersonation — end the impersonation session, then restore the admin token
  const exitImpersonation = useCallback(async () => {
    const imp = loadImpersonation()
    // 1. Hide the banner at once
    _clearImpersonation()
    if (!imp) return
    // 2. Revoke the impersonation session with ITS token. Sent with the admin
    //    token (as it used to be), the server found the admin's own session
    //    and refused, so impersonation tokens lived out their full 2 hours.
    try {
      await api.admin.exitImpersonation(imp.impersonationToken)
    } catch (err) {
      // 401: the impersonation session is already over and the API client
      // has signed out. Do not hand the stored admin token back to whoever
      // is at the keyboard.
      if (err?.status === 401) return
      console.warn('Ending the impersonation session failed:', err?.message || err)
    }
    setAuthToken(imp.originalToken)
    // 3. Re-verify to get the correct admin role/permissions
    try {
      const res = await api.auth.verify()
      _applyVerifyResponse(res)
    } catch {
      clearAuthToken()
      setStatus('unauthed')
      return
    }
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
    // Signing out mid-impersonation signs the superadmin out too: their own
    // session is revoked along with the impersonation one, not left live.
    const imp = getStoredJson(IMPERSONATION_KEY, null)
    api.auth.logout(getAuthToken()).catch(() => {})
    if (imp?.originalToken) api.auth.logout(imp.originalToken).catch(() => {})
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
