// Password settings of one existing share link, opened from Links: show the
// current password, change or remove it, and set the auto-approve domains.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Eye, Loader2, Lock, LockOpen, X } from 'lucide-react'
import { api } from '../../services/api'
import { useToast } from '../../context/ToastContext'
import { useDialog } from '../../hooks/useDialog'
import SharePasswordFields, { CopyButton, domainsProblem, passwordProblem } from './SharePasswordFields'
import { parseDomains } from '../../utils/viewUnlock'

export default function LinkProtectionModal({ view, onClose, onSaved }) {
  const dialog = useDialog({ label: 'Link password', onClose })
  const { showToast } = useToast()
  const wasProtected = !!view?.is_password_protected
  const [enabled, setEnabled] = useState(wasProtected)
  const [password, setPassword] = useState('')
  const [domains, setDomains] = useState((view?.auto_approve_domains || []).join(', '))
  const [current, setCurrent] = useState(null)
  const [revealing, setRevealing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [tried, setTried] = useState(false)

  const pwErr = tried ? passwordProblem(enabled, password, { required: !wasProtected }) : ''

  async function reveal() {
    setRevealing(true)
    try {
      const res = await api.sharedViews.revealPassword(view.token)
      setCurrent(res?.password || '')
    } catch (e) {
      showToast(e.message || 'Could not show the password', 'error')
    } finally {
      setRevealing(false)
    }
  }

  async function save() {
    setTried(true)
    setError('')
    if (passwordProblem(enabled, password, { required: !wasProtected }) || (enabled && domainsProblem(domains))) return
    const patch = {}
    if (!enabled && wasProtected) patch.remove_password = true
    if (enabled && password) patch.password = password
    if (enabled) patch.auto_approve_domains = parseDomains(domains)
    if (!Object.keys(patch).length) { onClose(); return }
    setSaving(true)
    try {
      const updated = await api.sharedViews.update(view.token, patch)
      showToast(patch.remove_password ? 'Password removed' : patch.password ? 'Password saved. Anyone already unlocked must enter the new one.' : 'Link settings saved', 'success')
      onSaved?.(updated)
      onClose()
    } catch (e) {
      setError(e.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'var(--scrim)', WebkitBackdropFilter: 'blur(8px)', backdropFilter: 'blur(8px)' }}>
      <div {...dialog.panelProps} className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', maxHeight: '92vh', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'color-mix(in srgb, var(--chart-2) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--chart-2) 25%, transparent)' }}>
              {wasProtected ? <Lock size={15} style={{ color: 'var(--chart-2)' }} aria-hidden="true" /> : <LockOpen size={15} style={{ color: 'var(--chart-2)' }} aria-hidden="true" />}
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Link password</h2>
              <p className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>{view?.title || `…/${view?.token}`}</p>
            </div>
          </div>
          <button aria-label="Close" onClick={onClose} className="btn-icon p-1.5" style={{ color: 'var(--text-3)' }}><X size={16} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {wasProtected && (
            <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
              <p className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>Current password</p>
              <div className="flex items-center gap-1.5">
                <code className="flex-1 min-w-0 text-sm font-mono truncate px-2 py-1.5 rounded-lg" aria-live="polite"
                  style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', color: 'var(--text-1)' }}>
                  {current == null ? '••••••••••••' : (current || 'Not readable')}
                </code>
                {current == null ? (
                  <button type="button" onClick={reveal} disabled={revealing}
                    className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg"
                    style={{ background: 'var(--card-bg)', color: 'var(--accent)', border: '1px solid var(--border)' }}>
                    {revealing ? <Loader2 size={11} className="animate-spin" aria-hidden="true" /> : <Eye size={11} aria-hidden="true" />} Show
                  </button>
                ) : <CopyButton value={current} />}
              </div>
              <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-3)' }}>Showing the password is recorded in the audit log.</p>
            </div>
          )}
          <SharePasswordFields
            enabled={enabled} password={password} domains={domains} error={pwErr}
            required={!wasProtected}
            placeholder={wasProtected ? 'New password (leave blank to keep the current one)' : 'At least 8 characters'}
            onChange={(p) => {
              if ('enabled' in p) setEnabled(p.enabled)
              if ('password' in p) setPassword(p.password)
              if ('domains' in p) setDomains(p.domains)
            }} />
          {wasProtected && !enabled && (
            <p className="text-xs p-2 rounded-lg" role="status" style={{ background: 'color-mix(in srgb, var(--fin-warning) 10%, transparent)', color: 'var(--fin-warning)' }}>
              Saving removes the password: anyone with the link can open it again.
            </p>
          )}
          {error && <p role="alert" className="text-xs p-2 rounded-lg" style={{ background: 'color-mix(in srgb, var(--fin-negative) 8%, transparent)', color: 'var(--fin-negative)' }}>{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          <button type="button" onClick={onClose} className="btn-ghost text-sm px-4 py-2">Cancel</button>
          <button type="button" onClick={save} disabled={saving} className="btn-primary flex items-center gap-2 text-sm px-4 py-2">
            {saving && <Loader2 size={13} className="animate-spin" aria-hidden="true" />} Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
