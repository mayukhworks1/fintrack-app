import { useState, useRef, useEffect } from 'react'
import { Lock, Eye, EyeOff, Loader2, AlertCircle, TrendingUp, ArrowRight, Mail } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [legacyMode, setLegacyMode] = useState(false)
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const submit = async (e) => {
    e?.preventDefault()
    if (!password || loading || (!legacyMode && !email)) return
    setLoading(true)
    setError('')
    try {
      await login(legacyMode ? password : { email, password })
      setPassword('')
    } catch (err) {
      const msg = err?.message || 'Login failed'
      setError(msg.includes('401') || msg.toLowerCase().includes('incorrect') || msg.toLowerCase().includes('invalid email')
        ? legacyMode ? 'Incorrect password — please try again' : 'Invalid email or password'
        : msg.includes('403') || msg.toLowerCase().includes('pending_approval')
          ? 'Your account is pending superadmin approval'
        : msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-bg min-h-screen flex items-center justify-center px-4 py-8">

      <div className="w-full max-w-sm animate-fade-in">

        {/* Brand wordmark above card */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--accent-btn)', boxShadow: '0 4px 14px rgba(37,99,235,0.35)' }}
          >
            <TrendingUp size={16} className="text-white" aria-hidden="true" />
          </div>
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
              Sign in to your workspace
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
              {legacyMode ? 'Temporary legacy access while email auth rolls out' : 'Use your approved email account to continue'}
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4" autoComplete="off">
            {!legacyMode && (
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
                  autoComplete="current-password"
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

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !password || (!legacyMode && !email)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={{
                background: 'var(--accent-btn)',
                color: 'white',
                opacity: loading || !password || (!legacyMode && !email) ? 0.55 : 1,
                cursor: loading || !password || (!legacyMode && !email) ? 'not-allowed' : 'pointer',
                boxShadow: loading || !password || (!legacyMode && !email)
                  ? 'none'
                  : '0 2px 4px rgba(37,99,235,0.2), 0 6px 16px rgba(37,99,235,0.18)',
                transform: 'translateY(0)',
                letterSpacing: '-0.01em',
              }}
              onMouseEnter={e => {
                if (!loading && password && (legacyMode || email)) e.currentTarget.style.background = 'var(--accent-btn-hover)'
              }}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--accent-btn)'}
            >
              {loading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight size={14} aria-hidden="true" />
                </>
              )}
            </button>
            <div className="flex items-center justify-between gap-3 text-xs">
              <button
                type="button"
                onClick={() => { setLegacyMode(v => !v); setError(''); setPassword('') }}
                className="font-semibold"
                style={{ color: 'var(--accent-btn)' }}
              >
                {legacyMode ? 'Use email login' : 'Use legacy password'}
              </button>
              {!legacyMode && (
                <span style={{ color: 'var(--text-3)' }}>Forgot password coming next</span>
              )}
            </div>
          </form>
        </div>

        <p className="text-[10px] text-center mt-4" style={{ color: 'var(--text-3)' }}>
          {legacyMode ? 'Legacy password is temporary during RBAC migration' : 'Email login requires superadmin approval'}
        </p>
      </div>
    </div>
  )
}
