import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, Eye, EyeOff, Loader2, AlertCircle, ArrowRight, Mail, Clock } from 'lucide-react'
import BrandMark from '../components/BrandMark'
import { useAuth } from '../context/AuthContext'
import { api } from '../services/api'

const OAUTH_ERROR_MESSAGES = {
  pending_approval: "Your account is awaiting superadmin approval. You'll be notified once it's activated.",
  disabled:         'Your account has been disabled. Contact your administrator for help.',
  rejected:         'Your account request was not approved. Contact your administrator if you think this is a mistake.',
  google_error:     'Google sign-in failed. Please try again or use email login.',
  zoho_error:       'Zoho sign-in failed. Please try again or use email login.',
}

const SESSION_MESSAGES = {
  'session-expired': 'Your session has expired. Please log in again.',
}

export default function Login() {
  const { login, acceptToken } = useAuth()
  const navigate = useNavigate()
  const [oauthToken] = useState(() => {
    const hash = window.location.hash?.replace(/^#/, '')
    if (!hash) return ''
    return new URLSearchParams(hash).get('oauth_token') || ''
  })
  const [email, setEmail] = useState(() => new URLSearchParams(window.location.search).get('email') || '')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [resetToken] = useState(() => new URLSearchParams(window.location.search).get('reset_token') || '')
  const [isInvite]   = useState(() => new URLSearchParams(window.location.search).get('invite') === '1')
  const [inviteEmail] = useState(() => new URLSearchParams(window.location.search).get('email') || '')
  const [sessionReason] = useState(() => new URLSearchParams(window.location.search).get('reason') || '')
  const [legacyMode, setLegacyMode] = useState(false)
  const [registerMode, setRegisterMode] = useState(false)
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [mailing, setMailing] = useState(false)
  const [googleEnabled, setGoogleEnabled] = useState(false)
  const [zohoEnabled,   setZohoEnabled]   = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pendingApproval, setPendingApproval] = useState(false)
  const inputRef = useRef(null)

  // Show session-expired message if redirected from 401
  useEffect(() => {
    if (sessionReason && SESSION_MESSAGES[sessionReason]) {
      setNotice(SESSION_MESSAGES[sessionReason])
    }
  }, [sessionReason])

  useEffect(() => {
    if (!oauthToken) inputRef.current?.focus()
  }, [oauthToken])

  useEffect(() => {
    let cancelled = false
    api.auth.providers()
      .then((res) => {
        if (!cancelled) {
          setGoogleEnabled(Boolean(res?.google))
          setZohoEnabled(Boolean(res?.zoho))
        }
      })
      .catch(() => { if (!cancelled) { setGoogleEnabled(false); setZohoEnabled(false) } })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const oauthError = params.get('oauth_error')
    if (oauthError) {
      window.history.replaceState({}, '', '/login')
      if (oauthError === 'pending_approval') {
        setPendingApproval(true)
        return
      }
      setError(OAUTH_ERROR_MESSAGES[oauthError] || params.get('message') || 'Sign-in failed')
      return
    }
    const hash = window.location.hash?.replace(/^#/, '')
    if (!hash) return
    const fragment = new URLSearchParams(hash)
    const token = fragment.get('oauth_token')
    if (!token) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      setNotice('')
      try {
        await acceptToken(token)
        const next = fragment.get('oauth_next') || '/'
        window.history.replaceState({}, '', '/login')
        if (!cancelled) navigate(next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true })
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Sign-in failed')
          window.history.replaceState({}, '', '/login')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [acceptToken, navigate])

  if (oauthToken && loading) {
    return (
      <div className="login-bg min-h-screen flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm animate-fade-in">
          <div className="flex items-center justify-center gap-2.5 mb-8">
            <BrandMark size={36} />
            <span className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-1)', letterSpacing: '-0.03em' }}>
              FinTrack
            </span>
          </div>
          <div
            className="rounded-2xl p-7 text-center"
            style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--card-border)',
              boxShadow: '0 4px 6px rgba(15,23,42,0.04), 0 16px 40px rgba(15,23,42,0.07)',
            }}
          >
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ background: 'rgba(37,99,235,0.12)', border: '1px solid rgba(37,99,235,0.25)' }}
            >
              <Loader2 size={26} className="animate-spin" style={{ color: '#2563eb' }} />
            </div>
            <h1 className="text-base font-bold mb-2" style={{ color: 'var(--text-1)', letterSpacing: '-0.02em' }}>
              Signing you in
            </h1>
            <p className="text-sm" style={{ color: 'var(--text-3)', lineHeight: 1.6 }}>
              Your {zohoEnabled ? 'SSO' : 'account'} session is being verified. You will be redirected automatically.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const startGoogleLogin = () => {
    if (loading) return
    setError('')
    setNotice('')
    window.location.assign(api.auth.googleStartUrl('/'))
  }

  const startZohoLogin = () => {
    if (loading) return
    setError('')
    setNotice('')
    window.location.assign(api.auth.zohoStartUrl('/'))
  }

  const submit = async (e) => {
    e?.preventDefault()
    if (!password || loading || (!legacyMode && !email && !resetToken)) return
    if ((resetToken || registerMode) && password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (registerMode && password.length < 10) {
      setError('Password must be at least 10 characters')
      return
    }
    setLoading(true)
    setError('')
    setNotice('')
    try {
      if (resetToken) {
        await api.auth.resetPassword(resetToken, password)
        setPassword('')
        setConfirmPassword('')
        // For invite flow: try to auto-login if email is known
        if (isInvite && email) {
          try {
            await login({ email, password })
            navigate('/', { replace: true })
            return
          } catch {
            // fall through to manual sign-in
          }
        }
        setNotice(isInvite ? 'Password set! You can now sign in.' : 'Password updated. Please sign in.')
        window.history.replaceState({}, '', '/login')
        return
      }
      if (registerMode) {
        const res = await api.auth.emailRegister({
          email,
          password,
          first_name: firstName.trim() || undefined,
          last_name: lastName.trim() || undefined,
        })
        setNotice(res?.message || 'Account created. It is pending superadmin approval.')
        setPassword('')
        setConfirmPassword('')
        return
      }
      await login(legacyMode ? password : { email, password })
      setPassword('')
      navigate('/', { replace: true })
    } catch (err) {
      const msg = err?.message || 'Login failed'
      if (msg.includes('403') || msg.toLowerCase().includes('pending_approval')) {
        setPendingApproval(true)
      } else {
        setError(msg.includes('401') || msg.toLowerCase().includes('incorrect') || msg.toLowerCase().includes('invalid email')
          ? legacyMode ? 'Incorrect password — please try again' : 'Invalid email or password'
          : msg.toLowerCase().includes('disabled')
            ? OAUTH_ERROR_MESSAGES.disabled
            : msg.toLowerCase().includes('rejected')
              ? OAUTH_ERROR_MESSAGES.rejected
              : msg)
      }
    } finally {
      setLoading(false)
    }
  }

  const requestReset = async () => {
    if (!email || mailing) {
      setError('Enter your email first')
      return
    }
    setMailing(true)
    setError('')
    setNotice('')
    try {
      const res = await api.auth.forgotPassword(email)
      setNotice(res.message || 'If the account is active, a password reset email has been sent.')
    } catch (err) {
      setError(err?.message || 'Could not request password reset')
    } finally {
      setMailing(false)
    }
  }

  if (pendingApproval) {
    return (
      <div className="login-bg min-h-screen flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm animate-fade-in">
          <div className="flex items-center justify-center gap-2.5 mb-8">
            <BrandMark size={36} />
            <span className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-1)', letterSpacing: '-0.03em' }}>
              FinTrack
            </span>
          </div>
          <div
            className="rounded-2xl p-7 text-center"
            style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--card-border)',
              boxShadow: '0 4px 6px rgba(15,23,42,0.04), 0 16px 40px rgba(15,23,42,0.07)',
            }}
          >
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)' }}
            >
              <Clock size={26} style={{ color: '#f59e0b' }} />
            </div>
            <h1 className="text-base font-bold mb-2" style={{ color: 'var(--text-1)', letterSpacing: '-0.02em' }}>
              Account pending approval
            </h1>
            <p className="text-sm mb-6" style={{ color: 'var(--text-3)', lineHeight: 1.6 }}>
              Your account has been created and is awaiting superadmin approval.
              You'll be able to sign in once it's activated — usually within 24 hours.
            </p>
            <button
              type="button"
              onClick={() => setPendingApproval(false)}
              className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={{ background: 'var(--bg-input)', color: 'var(--text-2)', border: '1px solid var(--card-border)' }}
            >
              Back to sign in
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="login-bg min-h-screen flex items-center justify-center px-4 py-8">

      <div className="w-full max-w-sm animate-fade-in">

        {/* Brand wordmark above card */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <BrandMark size={36} />
          <span className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-1)', letterSpacing: '-0.03em' }}>
            FinTrack
          </span>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-7"
          style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--card-border)',
            boxShadow: '0 4px 6px rgba(15,23,42,0.04), 0 16px 40px rgba(15,23,42,0.07)',
          }}
        >
          <div className="mb-6">
            <h1 className="text-lg font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.02em' }}>
              {resetToken
                ? (isInvite ? 'Set your password' : 'Reset your password')
                : registerMode ? 'Create your account' : 'Sign in to your workspace'}
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
              {resetToken
                ? (isInvite
                    ? 'Choose a password to activate your account'
                    : 'Enter a new password for your account')
                : registerMode
                  ? 'Request access. A superadmin must approve you before login works.'
                  : legacyMode ? 'Temporary legacy access while email auth rolls out' : 'Use your approved email account to continue'}
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {(googleEnabled || zohoEnabled) && !resetToken && !registerMode && !legacyMode && (
              <>
                <div className="flex flex-col gap-2">
                  {googleEnabled && (
                    <button
                      type="button"
                      onClick={startGoogleLogin}
                      disabled={loading}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all"
                      style={{
                        background: 'var(--card-bg)',
                        border: '1px solid var(--card-border)',
                        color: 'var(--text-1)',
                        boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
                        opacity: loading ? 0.6 : 1,
                      }}
                    >
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-black"
                        style={{ background: 'white', color: '#2563eb', border: '1px solid rgba(148,163,184,0.35)' }}
                        aria-hidden="true"
                      >G</span>
                      Continue with Google
                    </button>
                  )}
                  {zohoEnabled && (
                    <button
                      type="button"
                      onClick={startZohoLogin}
                      disabled={loading}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all"
                      style={{
                        background: 'var(--card-bg)',
                        border: '1px solid var(--card-border)',
                        color: 'var(--text-1)',
                        boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
                        opacity: loading ? 0.6 : 1,
                      }}
                    >
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-black"
                        style={{ background: '#E42527', color: '#fff', border: '1px solid rgba(228,37,39,0.3)' }}
                        aria-hidden="true"
                      >Z</span>
                      Continue with Zoho
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.24em]" style={{ color: 'var(--text-3)' }}>
                  <span className="h-px flex-1" style={{ background: 'var(--card-border)' }} />
                  or
                  <span className="h-px flex-1" style={{ background: 'var(--card-border)' }} />
                </div>
              </>
            )}

            {/* Show email read-only on invite so user knows whose account this is */}
            {resetToken && isInvite && email && (
              <div className="rounded-xl px-3 py-2.5 text-sm flex items-center gap-2"
                style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', color: 'var(--text-2)' }}>
                <Mail size={13} style={{ color: '#6366f1', flexShrink: 0 }} />
                {email}
              </div>
            )}
            {!legacyMode && !resetToken && (
              <div>
                <label className="label" htmlFor="ft-email">Email</label>
                <div className="relative">
                  <Mail
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: 'var(--text-3)' }}
                    aria-hidden="true"
                  />
                  <input
                    id="ft-email"
                    ref={inputRef}
                    type="email"
                    name="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError('') }}
                    placeholder="you@company.com"
                    className="input pl-9 pr-3 py-2.5 text-sm rounded-xl"
                    aria-label="Email"
                    autoComplete="email"
                    spellCheck="false"
                    autoCapitalize="off"
                    autoCorrect="off"
                    disabled={loading}
                    maxLength={320}
                  />
                </div>
              </div>
            )}

            {registerMode && !resetToken && (
              <div style={{ display:'flex', gap:10 }}>
                <div style={{ flex:1 }}>
                  <label className="label" htmlFor="ft-first-name">First name</label>
                  <input
                    id="ft-first-name"
                    type="text"
                    value={firstName}
                    onChange={(e) => { setFirstName(e.target.value); setError('') }}
                    placeholder="First"
                    className="input px-3 py-2.5 text-sm rounded-xl"
                    autoComplete="given-name"
                    disabled={loading}
                    maxLength={128}
                  />
                </div>
                <div style={{ flex:1 }}>
                  <label className="label" htmlFor="ft-last-name">Last name</label>
                  <input
                    id="ft-last-name"
                    type="text"
                    value={lastName}
                    onChange={(e) => { setLastName(e.target.value); setError('') }}
                    placeholder="Last"
                    className="input px-3 py-2.5 text-sm rounded-xl"
                    autoComplete="family-name"
                    disabled={loading}
                    maxLength={128}
                  />
                </div>
              </div>
            )}

            {/* Password field */}
            <div>
              <label className="label" htmlFor="ft-password">Password</label>
              <div className="relative">
                <Lock
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: 'var(--text-3)' }}
                  aria-hidden="true"
                />
                <input
                  id="ft-password"
                  ref={legacyMode ? inputRef : null}
                  type={show ? 'text' : 'password'}
                  name="access-password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError('') }}
                  placeholder="Enter your password"
                  className="input pl-9 pr-10 py-2.5 text-sm rounded-xl"
                  style={{
                    borderColor: error ? 'rgba(239,68,68,0.45)' : undefined,
                    boxShadow: error ? '0 0 0 3px rgba(239,68,68,0.1)' : undefined,
                  }}
                  aria-label="Password"
                  aria-invalid={!!error}
                  aria-describedby={error ? 'login-error' : undefined}
                  autoComplete={resetToken || registerMode ? 'new-password' : 'current-password'}
                  spellCheck="false"
                  autoCapitalize="off"
                  autoCorrect="off"
                  disabled={loading}
                  maxLength={128}
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-all"
                  style={{ color: 'var(--text-3)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-input)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  aria-label={show ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {show ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {resetToken && (
              <div>
                <label className="label" htmlFor="ft-password-confirm">Confirm password</label>
                <div className="relative">
                  <Lock
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: 'var(--text-3)' }}
                    aria-hidden="true"
                  />
                  <input
                    id="ft-password-confirm"
                    type={show ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); setError('') }}
                    placeholder="Repeat your new password"
                    className="input pl-9 pr-3 py-2.5 text-sm rounded-xl"
                    autoComplete="new-password"
                    disabled={loading}
                    maxLength={128}
                  />
                </div>
              </div>
            )}

            {registerMode && !resetToken && (
              <div>
                <label className="label" htmlFor="ft-password-confirm">Confirm password</label>
                <div className="relative">
                  <Lock
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: 'var(--text-3)' }}
                    aria-hidden="true"
                  />
                  <input
                    id="ft-password-confirm"
                    type={show ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); setError('') }}
                    placeholder="Repeat your password"
                    className="input pl-9 pr-3 py-2.5 text-sm rounded-xl"
                    autoComplete="new-password"
                    disabled={loading}
                    maxLength={128}
                  />
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div
                id="login-error"
                className="flex items-center gap-2 text-xs px-3 py-2.5 rounded-xl"
                style={{
                  background: 'var(--fin-neg-bg)',
                  border: '1px solid var(--fin-neg-border)',
                  color: 'var(--fin-negative)',
                }}
                role="alert"
                aria-live="polite"
              >
                <AlertCircle size={12} className="flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {notice && (
              <div
                className="flex items-center gap-2 text-xs px-3 py-2.5 rounded-xl"
                style={{
                  background: 'rgba(22,163,74,0.10)',
                  border: '1px solid rgba(22,163,74,0.22)',
                  color: '#16a34a',
                }}
                role="status"
                aria-live="polite"
              >
                <Mail size={12} className="flex-shrink-0" />
                <span>{notice}</span>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !password || (!legacyMode && !email && !resetToken) || ((resetToken || registerMode) && !confirmPassword)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={{
                background: 'var(--accent-btn)',
                color: 'white',
                opacity: loading || !password || (!legacyMode && !email && !resetToken) || ((resetToken || registerMode) && !confirmPassword) ? 0.55 : 1,
                cursor: loading || !password || (!legacyMode && !email && !resetToken) || ((resetToken || registerMode) && !confirmPassword) ? 'not-allowed' : 'pointer',
                boxShadow: loading || !password || (!legacyMode && !email && !resetToken) || ((resetToken || registerMode) && !confirmPassword)
                  ? 'none'
                  : '0 2px 4px rgba(37,99,235,0.2), 0 6px 16px rgba(37,99,235,0.18)',
                transform: 'translateY(0)',
                letterSpacing: '-0.01em',
              }}
              onMouseEnter={e => {
                if (!loading && password && (legacyMode || email || resetToken)) e.currentTarget.style.background = 'var(--accent-btn-hover)'
              }}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--accent-btn)'}
            >
              {loading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {resetToken ? (isInvite ? 'Setting up…' : 'Updating…') : registerMode ? 'Creating…' : 'Signing in…'}
                </>
              ) : (
                <>
                  {resetToken ? (isInvite ? 'Set password & sign in' : 'Update password') : registerMode ? 'Create account' : 'Sign in'}
                  <ArrowRight size={14} aria-hidden="true" />
                </>
              )}
            </button>
            {!resetToken && (
              <div className="flex items-center justify-between gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => { setLegacyMode(v => !v); setRegisterMode(false); setError(''); setNotice(''); setPassword(''); setConfirmPassword('') }}
                  className="font-semibold"
                  style={{ color: 'var(--accent-btn)' }}
                >
                  {legacyMode ? 'Use email login' : 'Use legacy password'}
                </button>
                {!legacyMode && (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => { setRegisterMode(v => !v); setError(''); setNotice(''); setPassword(''); setConfirmPassword('') }}
                      className="font-semibold"
                      style={{ color: 'var(--accent-btn)' }}
                    >
                      {registerMode ? 'Back to sign in' : 'Create account'}
                    </button>
                    {!registerMode && (
                      <button
                        type="button"
                        onClick={requestReset}
                        disabled={mailing}
                        className="font-semibold"
                        style={{ color: mailing ? 'var(--text-3)' : 'var(--accent-btn)' }}
                      >
                        {mailing ? 'Sending…' : 'Forgot password?'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {resetToken && notice && (
              <button
                type="button"
                onClick={() => window.location.assign('/login')}
                className="w-full text-xs font-semibold"
                style={{ color: 'var(--accent-btn)' }}
              >
                Go to sign in
              </button>
            )}
          </form>
        </div>

        <p className="text-[10px] text-center mt-4" style={{ color: 'var(--text-3)' }}>
          {resetToken
            ? (isInvite ? 'Invite links are single-use and expire automatically' : 'Reset links are single-use and expire automatically')
            : registerMode
              ? 'New accounts stay pending until a superadmin approves access'
              : legacyMode ? 'Legacy password is temporary during RBAC migration' : 'Email login requires superadmin approval'}
        </p>
      </div>
    </div>
  )
}
