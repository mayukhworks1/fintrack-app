// What a visitor sees on a password-protected shared view link: the password
// screen, the "request it" form and the sent confirmation. Same branded
// frame as a protected published page.
import { useEffect, useId, useRef, useState } from 'react'
import { api } from '../../services/api'
import { emailError, setViewUnlock } from '../../utils/viewUnlock'
import { PV_THEME, BrandScreen, LockIcon } from '../../components/public/BrandScreen'

export const MailIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" />
  </svg>
)
export const SentIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

const label = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--pv-text)', marginBottom: 6 }
const input = (bad) => ({
  display: 'block', width: '100%', padding: '12px 14px', border: `1px solid ${bad ? '#ef4444' : 'var(--pv-line)'}`,
  borderRadius: 10, fontSize: 16, boxSizing: 'border-box', outline: 'none', background: 'var(--pv-subtle)', color: 'var(--pv-ink)',
  fontFamily: 'inherit',
})
export const primary = (off) => ({
  width: '100%', marginTop: 14, padding: '12px 0', minHeight: 44, background: 'linear-gradient(90deg,#2563eb,#4f46e5)',
  opacity: off ? 0.6 : 1, color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: off ? 'default' : 'pointer',
})
export const linkBtn = {
  background: 'none', border: 'none', padding: '10px 4px', minHeight: 44, color: '#2563eb', fontSize: 14, fontWeight: 600, cursor: 'pointer',
}
const errText = { color: '#ef4444', fontSize: 13, marginTop: 6 }

function PasswordPane({ token, onUnlocked, onGone, onRequest }) {
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)

  const submit = async (e) => {
    e.preventDefault()
    if (!pw || loading) return
    setError(''); setLoading(true)
    try {
      const res = await api.sharedViews.publicUnlock(token, pw)
      setViewUnlock(token, res?.unlock_token || '')
      onUnlocked()
    } catch (err) {
      if (err?.status === 404 || err?.status === 410) { onGone?.(err.message); return }
      setError(err?.status === 429 ? (err.message || 'Too many attempts. Wait a few minutes and try again.')
        : err?.code === 'incorrect_password' ? 'That password isn’t right. Check it and try again.'
          : (err?.message || 'Something went wrong. Please try again.'))
      inputRef.current?.focus()
      inputRef.current?.select()
    } finally { setLoading(false) }
  }

  return (
    <>
      <form onSubmit={submit} style={{ marginTop: 24, textAlign: 'left' }} noValidate>
        <label htmlFor="sv-pw" style={label}>Password</label>
        <div style={{ position: 'relative' }}>
          <input id="sv-pw" ref={inputRef} type={show ? 'text' : 'password'} value={pw} onChange={e => setPw(e.target.value)}
            autoFocus autoComplete="current-password" autoCapitalize="off" spellCheck={false}
            aria-invalid={!!error} aria-describedby={error ? 'sv-pw-err' : undefined}
            style={{ ...input(!!error), paddingRight: 64 }} />
          <button type="button" onClick={() => setShow(v => !v)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
            style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--pv-mute)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '10px 10px', minHeight: 40 }}>
            {show ? 'Hide' : 'Show'}
          </button>
        </div>
        {error && <div id="sv-pw-err" role="alert" style={errText}>{error}</div>}
        <button type="submit" disabled={loading || !pw} style={primary(loading || !pw)}>
          {loading ? 'Checking…' : 'Open shared view'}
        </button>
      </form>
      <p style={{ margin: '14px 0 0', fontSize: 14, color: 'var(--pv-mute)' }}>
        Don’t have the password?{' '}
        <button type="button" onClick={onRequest} style={linkBtn}>Request it</button>
      </p>
    </>
  )
}

/**
 * The "request the password" form. `send(data)` posts it; by default to the
 * shared view `token`, and published pages pass their own.
 */
export function RequestPane({ token, send, owner = 'link', onSent, onBack, onGone }) {
  const id = useId()
  const [form, setForm] = useState({ name: '', email: '', message: '', website: '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [loading, setLoading] = useState(false)
  const refs = { name: useRef(null), email: useRef(null), message: useRef(null) }

  const set = (k) => (e) => {
    setForm(f => ({ ...f, [k]: e.target.value }))
    if (errors[k]) setErrors(x => ({ ...x, [k]: '' }))
  }

  const validate = () => {
    const next = {}
    const name = form.name.trim()
    if (!name) next.name = 'Enter your name'
    else if (name.length > 100) next.name = 'Use at most 100 characters'
    const em = emailError(form.email)
    if (em) next.email = em
    if (form.message.length > 1000) next.message = 'Use at most 1000 characters'
    return next
  }

  const submit = async (e) => {
    e.preventDefault()
    if (loading) return
    setFormError('')
    const next = validate()
    setErrors(next)
    const first = ['name', 'email', 'message'].find(k => next[k])
    if (first) { refs[first].current?.focus(); return }
    setLoading(true)
    try {
      const data = { name: form.name.trim(), email: form.email.trim(), message: form.message.trim() || null, website: form.website }
      await (send ? send(data) : api.sharedViews.requestAccess(token, data))
      onSent(form.email.trim())
    } catch (err) {
      if (err?.status === 404 || err?.status === 410) { onGone?.(err.message); return }
      setFormError(err?.message || 'Couldn’t send the request. Please try again.')
    } finally { setLoading(false) }
  }

  const field = (k, text, props = {}, optional = false) => (
    <div style={{ marginTop: 14 }}>
      <label htmlFor={`${id}-${k}`} style={label}>
        {text}{optional && <span style={{ fontWeight: 400, color: 'var(--pv-mute)' }}> (optional)</span>}
      </label>
      {props.as === 'textarea'
        ? <textarea id={`${id}-${k}`} ref={refs[k]} value={form[k]} onChange={set(k)} rows={3} maxLength={1000}
            aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `${id}-${k}-err` : `${id}-${k}-hint`}
            style={{ ...input(!!errors[k]), resize: 'vertical', minHeight: 84 }} />
        : <input id={`${id}-${k}`} ref={refs[k]} value={form[k]} onChange={set(k)} {...props}
            aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `${id}-${k}-err` : undefined} aria-required="true"
            style={input(!!errors[k])} />}
      {errors[k] && <div id={`${id}-${k}-err`} role="alert" style={errText}>{errors[k]}</div>}
      {k === 'message' && !errors[k] && (
        <div id={`${id}-${k}-hint`} style={{ fontSize: 12, color: 'var(--pv-mute)', marginTop: 4, textAlign: 'right' }}>{form.message.length}/1000</div>
      )}
    </div>
  )

  return (
    <form onSubmit={submit} noValidate style={{ marginTop: 18, textAlign: 'left' }} aria-describedby={formError ? `${id}-form-err` : undefined}>
      {field('name', 'Your name', { autoComplete: 'name', maxLength: 120, autoFocus: true })}
      {field('email', 'Work email', { type: 'email', inputMode: 'email', autoComplete: 'email', autoCapitalize: 'off', spellCheck: false, maxLength: 254 })}
      {field('message', 'Message to the owner', { as: 'textarea' }, true)}
      {/* Honeypot: off-screen and skipped by keyboard and screen readers; bots fill it in. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: -10000, top: 'auto', width: 1, height: 1, overflow: 'hidden' }}>
        <label htmlFor={`${id}-website`}>Website</label>
        <input id={`${id}-website`} name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
      </div>
      {formError && <div id={`${id}-form-err`} role="alert" style={{ ...errText, marginTop: 12 }}>{formError}</div>}
      <button type="submit" disabled={loading} style={primary(loading)}>{loading ? 'Sending…' : 'Send request'}</button>
      <p style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--pv-mute)', lineHeight: 1.5 }}>
        The owner of this {owner} will see your name, email and message. If they approve, the password is emailed to you.
      </p>
      <div style={{ textAlign: 'center', marginTop: 4 }}>
        <button type="button" onClick={onBack} style={linkBtn}>I have the password</button>
      </div>
    </form>
  )
}

/** onUnlocked: the unlock token is stored, reload the data. onGone(msg): the link expired or vanished meanwhile. */
export default function ProtectedLink({ token, onUnlocked, onGone, initialPane = 'password' }) {
  const [pane, setPane] = useState(initialPane)
  const [sentTo, setSentTo] = useState('')
  const heading = useRef(null)
  const first = useRef(true)

  // Moving between panes puts focus on the new heading, so screen readers
  // announce where the visitor is (not on first load: the field has it).
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (pane !== 'request') heading.current?.focus()
  }, [pane])

  const common = { product: 'FinTrack', headingRef: heading }
  return (
    <>
      <style>{PV_THEME}</style>
      {pane === 'password' && (
        <BrandScreen {...common} icon={<LockIcon />} title="This shared view is protected"
          message="Enter the password you were given to open it.">
          <PasswordPane token={token} onUnlocked={onUnlocked} onGone={onGone} onRequest={() => setPane('request')} />
        </BrandScreen>
      )}
      {pane === 'request' && (
        <BrandScreen {...common} icon={<MailIcon />} title="Request the password"
          message="Tell the owner who you are. If they approve, you’ll get the password by email.">
          <RequestPane token={token} onBack={() => setPane('password')} onGone={onGone}
            onSent={(email) => { setSentTo(email); setPane('sent') }} />
        </BrandScreen>
      )}
      {pane === 'sent' && (
        <BrandScreen {...common} icon={<SentIcon />} title="Request sent">
          <p role="status" style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: 'var(--pv-mute)' }}>
            If the owner approves, the password will be emailed to <strong style={{ color: 'var(--pv-ink)', overflowWrap: 'anywhere' }}>{sentTo}</strong>.
            You can close this page.
          </p>
          <button type="button" onClick={() => setPane('password')} style={{ ...primary(false), marginTop: 22 }}>I have the password</button>
        </BrandScreen>
      )}
    </>
  )
}
