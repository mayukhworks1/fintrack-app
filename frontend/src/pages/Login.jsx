import { useState, useRef, useEffect } from 'react'
import { Lock, Eye, EyeOff, Loader2, AlertCircle, Sparkles } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { login } = useAuth()
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const submit = async (e) => {
    e?.preventDefault()
    if (!password || loading) return
    setLoading(true)
    setError('')
    try {
      await login(password)
      // Don't keep plaintext around in memory/DOM any longer than needed
      setPassword('')
    } catch (err) {
      const msg = err?.message || 'Login failed'
      setError(msg.includes('401') || msg.toLowerCase().includes('incorrect')
        ? 'Incorrect password'
        : msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-8"
      style={{ background: 'var(--bg-base)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6 sm:p-8 animate-fade-in"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-6">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{
              background: 'linear-gradient(135deg, rgba(34,197,94,0.2) 0%, rgba(34,197,94,0.05) 100%)',
              border: '1px solid rgba(34,197,94,0.3)',
              boxShadow: '0 0 24px rgba(34,197,94,0.2)',
            }}
          >
            <Sparkles size={24} style={{ color: '#4ade80' }} />
          </div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>FinTrack</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
            Enter your password to continue
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4" autoComplete="off">
          {/* Password field */}
          <div className="relative">
            <Lock
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--text-3)' }}
              aria-hidden="true"
            />
            <input
              ref={inputRef}
              type={show ? 'text' : 'password'}
              name="access-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full rounded-xl pl-9 pr-10 py-2.5 text-sm outline-none transition-all"
              style={{
                background: 'var(--bg-input)',
                border: `1px solid ${error ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`,
                color: 'var(--text-1)',
              }}
              aria-label="Password"
              aria-invalid={!!error}
              autoComplete="new-password"
              spellCheck="false"
              autoCapitalize="off"
              autoCorrect="off"
              disabled={loading}
              maxLength={128}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md transition-all hover:bg-white/5"
              style={{ color: 'var(--text-3)' }}
              aria-label={show ? 'Hide password' : 'Show password'}
              tabIndex={-1}
            >
              {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div
              className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}
              role="alert"
            >
              <AlertCircle size={12} className="flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: loading || !password
                ? 'rgba(34,197,94,0.2)'
                : 'linear-gradient(135deg, #22c55e, #16a34a)',
              color: 'white',
              boxShadow: loading || !password ? 'none' : '0 4px 12px rgba(34,197,94,0.35)',
            }}
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </form>

        <p className="text-[10px] text-center mt-5" style={{ color: 'var(--text-3)' }}>
          Password is verified server-side. Not case-sensitive.
        </p>
      </div>
    </div>
  )
}
