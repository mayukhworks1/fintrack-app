// "Require a password" for a share link: the switch, the password field with
// Show / Copy / Generate, and the per-link auto-approve email domains. Used
// by the Share dialogs and by the link editor in Links.
import { useId, useState } from 'react'
import { Check, Copy, Eye, EyeOff, Lock, Wand2 } from 'lucide-react'
import { Toggle } from '../../pages/admin/ui'
import { emailError, generateSharePassword, isValidDomain, parseDomains } from '../../utils/viewUnlock'

export const PASSWORD_MIN = 8

export function passwordProblem(enabled, password, { required = true } = {}) {
  if (!enabled) return ''
  if (!password) return required ? 'Enter a password or press Generate.' : ''
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`
  if (password.length > 128) return 'Use at most 128 characters.'
  return ''
}

export function domainsProblem(text) {
  const bad = parseDomains(text).filter(d => (d.includes('@') ? emailError(d) : !isValidDomain(d)))
  return bad.length ? `${bad[0]} is not a valid ${bad[0].includes('@') ? 'email address' : 'domain'}.` : ''
}

// The badge Links shows on a password-protected link.
export function LockBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded" title="Password protected"
      style={{ background: 'color-mix(in srgb, var(--chart-2) 12%, transparent)', color: 'var(--chart-2)' }}>
      <Lock size={9} aria-hidden="true" /> PASSWORD
    </span>
  )
}

// Links | Access requests switch at the top of the Links manager.
export function LinksTabs({ tab, onTab, pending = 0 }) {
  const tabs = [['links', 'Links'], ['requests', pending ? `Access requests (${pending})` : 'Access requests']]
  return (
    <div role="tablist" aria-label="Links manager" className="flex items-center gap-1 p-1 rounded-xl w-full sm:w-fit"
      style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
      {tabs.map(([id, text]) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => onTab(id)}
          className="flex-1 sm:flex-none px-3 py-1.5 rounded-lg text-xs font-semibold"
          style={tab === id ? { background: 'var(--card-bg)', color: 'var(--text-1)', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' } : { color: 'var(--text-3)' }}>
          {text}
        </button>
      ))}
    </div>
  )
}

export function CopyButton({ value, label = 'Copy', copiedLabel = 'Copied', className = '', disabled = false }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(value) } catch { return }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button type="button" onClick={copy} disabled={disabled || !value}
      className={`flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg ${className}`}
      aria-label={copied ? copiedLabel : `${label} password`}
      style={{ background: copied ? 'color-mix(in srgb, var(--fin-positive) 12%, transparent)' : 'var(--card-bg)', color: copied ? 'var(--fin-positive)' : 'var(--accent)', border: '1px solid var(--border)', opacity: disabled || !value ? 0.5 : 1 }}>
      {copied ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </button>
  )
}

/**
 * Controlled: { enabled, password, domains } with onChange(patch).
 * `placeholder` lets the editor say "Leave blank to keep the current password".
 */
export default function SharePasswordFields({
  enabled, password, domains = '', onChange, error = '', showDomains = true,
  placeholder = 'At least 8 characters', required = true, autoFocus = false,
}) {
  const id = useId()
  const [show, setShow] = useState(false)
  const problem = error || ''
  const domainErr = showDomains && enabled ? domainsProblem(domains) : ''

  const generate = () => {
    onChange({ password: generateSharePassword() })
    setShow(true)
  }

  return (
    <div className="rounded-2xl p-3 space-y-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p id={`${id}-label`} className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--text-2)' }}>
            <Lock size={12} aria-hidden="true" /> Require a password
          </p>
          <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>
            Visitors enter it before they see anything. They can ask you for it; you approve each request.
          </p>
        </div>
        <Toggle checked={enabled} onChange={(v) => onChange({ enabled: v })} label="Require a password" />
      </div>

      {enabled && (
        <>
          <div>
            <label htmlFor={`${id}-pw`} className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--text-2)' }}>Password</label>
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="relative flex-1" style={{ minWidth: 'min(100%, 220px)' }}>
                <input id={`${id}-pw`} type={show ? 'text' : 'password'} value={password}
                  onChange={e => onChange({ password: e.target.value })}
                  className="input-field w-full text-sm font-mono" style={{ paddingRight: 40 }}
                  placeholder={placeholder} autoComplete="new-password" spellCheck={false} maxLength={128}
                  autoFocus={autoFocus} aria-required={required}
                  aria-invalid={!!problem} aria-describedby={problem ? `${id}-err` : undefined} />
                <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'}
                  aria-pressed={show} className="btn-icon absolute right-1 top-1/2 -translate-y-1/2 p-1.5" style={{ color: 'var(--text-3)' }}>
                  {show ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                </button>
              </div>
              <CopyButton value={password} />
              <button type="button" onClick={generate} aria-label="Generate a strong password"
                className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg"
                style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}>
                <Wand2 size={11} aria-hidden="true" /> Generate
              </button>
            </div>
            {problem && <p id={`${id}-err`} role="alert" className="text-[11px] mt-1" style={{ color: 'var(--fin-negative)' }}>{problem}</p>}
          </div>
          {showDomains && (
            <div>
              <label htmlFor={`${id}-dom`} className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--text-2)' }}>
                Auto-approve requests from these emails or domains <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(optional)</span>
              </label>
              <input id={`${id}-dom`} type="text" value={domains} onChange={e => onChange({ domains: e.target.value })}
                className="input-field w-full text-sm" placeholder="e.g. theworks.in" autoComplete="off" spellCheck={false}
                inputMode="url" aria-invalid={!!domainErr} aria-describedby={`${id}-dom-hint`} />
              <p id={`${id}-dom-hint`} role={domainErr ? 'alert' : undefined} className="text-[10px] mt-1"
                style={{ color: domainErr ? 'var(--fin-negative)' : 'var(--text-3)' }}>
                {domainErr || 'Requests from these exact domains get the password by email at once. Leave empty to approve every request yourself.'}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
