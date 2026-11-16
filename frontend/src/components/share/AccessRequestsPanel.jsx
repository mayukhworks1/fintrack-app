// Links → Access requests: people who asked for a protected link's password.
// Approve emails them the link and its current password; Deny can send a
// short note. Without a mailer, approving shows the password to pass on.
// A published page's Share popover shows the same list for that page
// (pass `pageId`): its requests go to the page routes.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Inbox, Loader2, Mail, RefreshCw, X } from 'lucide-react'
import { api } from '../../services/api'
import { useToast } from '../../context/ToastContext'
import { fmtDateTime } from '../../utils/dates'
import { CopyButton } from './SharePasswordFields'

const STATUS_STYLE = {
  pending: { label: 'PENDING', color: 'var(--fin-warning)' },
  approved: { label: 'APPROVED', color: 'var(--fin-positive)' },
  denied: { label: 'DENIED', color: 'var(--text-3)' },
}

function StatusPill({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.pending
  return (
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: `color-mix(in srgb, ${s.color} 12%, transparent)`, color: s.color }}>
      {s.label}
    </span>
  )
}

function ManualShare({ result, onDone }) {
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus() }, [])
  const why = result.reason === 'email_not_configured'
    ? 'Email isn’t set up on this server, so nothing was sent.'
    : result.reason === 'manual' ? 'Approved without an email.' : 'The email couldn’t be sent.'
  return (
    <div ref={ref} tabIndex={-1} role="alert" className="mt-2 rounded-xl p-3 space-y-2 outline-none"
      style={{ background: 'color-mix(in srgb, var(--fin-warning) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--fin-warning) 25%, transparent)' }}>
      <p className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>Approved. Share the password yourself.</p>
      <p className="text-[11px]" style={{ color: 'var(--text-2)' }}>{why} Send the link and password to {result.request?.email} another way.</p>
      {result.url && (
        <div className="flex items-center gap-1.5">
          <code className="flex-1 min-w-0 text-[11px] font-mono truncate px-2 py-1.5 rounded-lg" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', color: 'var(--text-1)' }}>{result.url}</code>
          <CopyButton value={result.url} label="Copy link" />
        </div>
      )}
      {result.password ? (
        <div className="flex items-center gap-1.5">
          <code className="flex-1 min-w-0 text-sm font-mono truncate px-2 py-1.5 rounded-lg" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', color: 'var(--text-1)' }}>{result.password}</code>
          <CopyButton value={result.password} />
        </div>
      ) : result.reason === 'manual'
        ? <p className="text-[11px]" style={{ color: 'var(--text-2)' }}>Send them the link and the password yourself.</p>
        : <p className="text-[11px]" style={{ color: 'var(--text-2)' }}>This link no longer has a password.</p>}
      <button type="button" onClick={onDone} className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>Done</button>
    </div>
  )
}

function RequestRow({ r, onDecided, actions }) {
  const { showToast } = useToast()
  const [busy, setBusy] = useState('')
  const [denying, setDenying] = useState(false)
  const [note, setNote] = useState('')
  const [notify, setNotify] = useState(true)
  const [manual, setManual] = useState(null)
  const [notStored, setNotStored] = useState('')
  const noteRef = useRef(null)

  useEffect(() => { if (denying) noteRef.current?.focus() }, [denying])

  async function approve(opts = {}) {
    setBusy('approve')
    try {
      const res = await actions.approve(r, opts)
      setNotStored('')
      if (res?.sent) showToast(`Password emailed to ${r.email}`, 'success')
      else setManual(res)
      onDecided({ ...r, ...(res?.request || {}), status: 'approved' }, !res?.sent)
    } catch (e) {
      // A page password set before encrypted copies were kept cannot be
      // emailed: set it again, or approve and share it by hand.
      if (e?.code === 'password_not_stored') setNotStored(e.message || 'Set the password again, then approve.')
      else showToast(e.message || 'Could not approve', 'error')
    } finally { setBusy('') }
  }

  async function deny() {
    setBusy('deny')
    try {
      await actions.deny(r, { note: note.trim() || null, notify })
      showToast('Request denied', 'success')
      setDenying(false)
      onDecided({ ...r, status: 'denied', decision_note: note.trim() || null })
    } catch (e) {
      showToast(e.message || 'Could not deny', 'error')
    } finally { setBusy('') }
  }

  const pending = r.status === 'pending'
  return (
    <li className="rounded-xl p-3" style={{ background: pending ? 'var(--card-bg)' : 'var(--bg-input)', border: '1px solid var(--border)' }}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{r.name}</p>
            <StatusPill status={r.status} />
          </div>
          <a href={`mailto:${r.email}`} className="text-xs inline-flex items-center gap-1 break-all" style={{ color: 'var(--accent)' }}>
            <Mail size={10} aria-hidden="true" />{r.email}
          </a>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            For <strong style={{ color: 'var(--text-2)' }}>{r.view_title || `…/${r.view_token}`}</strong> · {fmtDateTime(r.created_at)}
            {r.decided_via && !pending && <> · {r.decided_via === 'auto' ? 'auto-approved' : `via ${r.decided_via}`}</>}
          </p>
          {r.message && <p className="text-xs mt-1.5 whitespace-pre-wrap rounded-lg px-2 py-1.5" style={{ background: 'var(--bg-input)', color: 'var(--text-2)' }}>{r.message}</p>}
        </div>
        {pending && !denying && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button type="button" onClick={approve} disabled={!!busy}
              className="btn-primary inline-flex items-center gap-1 text-xs px-3 py-1.5"
              aria-label={`Approve and send password to ${r.name}`}>
              {busy === 'approve' ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Check size={12} aria-hidden="true" />} Approve &amp; send
            </button>
            <button type="button" onClick={() => setDenying(true)} disabled={!!busy}
              className="btn-ghost inline-flex items-center gap-1 text-xs px-3 py-1.5" aria-label={`Deny request from ${r.name}`}>
              <X size={12} aria-hidden="true" /> Deny
            </button>
          </div>
        )}
      </div>
      {pending && denying && (
        <div className="mt-2 space-y-2">
          <label htmlFor={`deny-note-${r.id}`} className="block text-[11px] font-semibold" style={{ color: 'var(--text-2)' }}>Note to {r.name} (optional)</label>
          <textarea id={`deny-note-${r.id}`} ref={noteRef} rows={2} maxLength={1000} value={note} onChange={e => setNote(e.target.value)}
            className="input-field w-full text-sm" placeholder="e.g. Please ask your account manager for access." />
          <label className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-2)' }}>
            <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} /> Email them a polite note
          </label>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={deny} disabled={!!busy} className="btn-primary inline-flex items-center gap-1 text-xs px-3 py-1.5">
              {busy === 'deny' && <Loader2 size={12} className="animate-spin" aria-hidden="true" />} Deny request
            </button>
            <button type="button" onClick={() => setDenying(false)} className="btn-ghost text-xs px-3 py-1.5">Cancel</button>
          </div>
        </div>
      )}
      {notStored && pending && (
        <div role="alert" className="mt-2 rounded-xl p-3 space-y-2" style={{ background: 'color-mix(in srgb, var(--fin-warning) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--fin-warning) 25%, transparent)' }}>
          <p className="text-xs" style={{ color: 'var(--text-1)' }}>{notStored}</p>
          <button type="button" onClick={() => approve({ manual: true })} disabled={!!busy} className="btn-ghost text-xs px-3 py-1.5">
            Approve without email, I’ll share it
          </button>
        </div>
      )}
      {manual && <ManualShare result={manual} onDone={() => setManual(null)} />}
    </li>
  )
}

const VIEW_ACTIONS = {
  load: (resourceType) => api.sharedViews.accessRequests({ resource_type: resourceType }),
  approve: (r) => api.sharedViews.approveRequest(r.id),
  deny: (r, data) => api.sharedViews.denyRequest(r.id, data),
}

function pageActions(pageId) {
  return {
    load: () => api.pages.accessRequests(pageId),
    approve: (r, opts = {}) => api.pages.approveRequest(pageId, r.id, opts.manual ? { manual: true } : {}),
    deny: (r, data) => api.pages.denyRequest(pageId, r.id, data),
  }
}

export default function AccessRequestsPanel({ resourceType = '', pageId = '', onPendingChange, compact = false }) {
  const actions = pageId ? pageActions(pageId) : VIEW_ACTIONS
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('pending')
  const [mailer, setMailer] = useState(true)
  // Rows decided here stay in view until the next refresh, so a manual
  // password hand-off is not whisked away by the Pending filter.
  const [recent, setRecent] = useState(() => new Set())

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await actions.load(resourceType)
      setItems(res?.requests || [])
      setRecent(new Set())
      setMailer(res?.mailer_configured !== false)
      onPendingChange?.(res?.pending || 0)
    } catch (e) {
      setError(e.message || 'Could not load requests')
    } finally { setLoading(false) }
  }, [resourceType, pageId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const decided = (row) => {
    setRecent(prev => new Set(prev).add(row.id))
    setItems(list => {
      const next = list.map(x => x.id === row.id ? { ...x, ...row } : x)
      onPendingChange?.(next.filter(x => x.status === 'pending').length)
      return next
    })
  }

  const shown = filter === 'all' ? items : items.filter(r => r.status === filter || recent.has(r.id))
  const counts = { pending: items.filter(r => r.status === 'pending').length, all: items.length }

  return (
    <section aria-label="Access requests" className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div role="tablist" aria-label="Filter requests" className="flex items-center rounded-lg p-0.5" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
          {[['pending', `Pending (${counts.pending})`], ['approved', 'Approved'], ['denied', 'Denied'], ['all', `All (${counts.all})`]].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={filter === id} onClick={() => setFilter(id)}
              className="px-2.5 py-1 rounded-md text-[11px] font-semibold"
              style={{ color: filter === id ? 'var(--text-1)' : 'var(--text-3)', background: filter === id ? 'var(--card-bg)' : 'transparent' }}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={load} className="btn-icon p-1.5" aria-label="Refresh requests" style={{ color: 'var(--text-3)' }}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
        </button>
      </div>
      {!mailer && (
        <p className="text-[11px] p-2 rounded-lg" style={{ background: 'color-mix(in srgb, var(--fin-warning) 8%, transparent)', color: 'var(--text-2)' }}>
          Email isn’t set up on this server. Approving shows you the password so you can share it yourself.
        </p>
      )}
      {error && <p role="alert" className="text-xs" style={{ color: 'var(--fin-negative)' }}>{error}</p>}
      {loading && !items.length && <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin" style={{ color: 'var(--text-3)' }} aria-label="Loading requests" /></div>}
      {!loading && shown.length === 0 && !error && (
        <div className="text-center py-8">
          <Inbox size={22} className="mx-auto mb-2 opacity-40" style={{ color: 'var(--text-3)' }} aria-hidden="true" />
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>{filter === 'pending' ? 'No requests waiting.' : 'No requests here.'}</p>
          {!compact && <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>When someone asks for a protected {pageId ? 'page' : 'link'}’s password, it shows up here.</p>}
        </div>
      )}
      <ul className="space-y-2">
        {shown.map(r => <RequestRow key={r.id} r={r} onDecided={decided} actions={actions} />)}
      </ul>
    </section>
  )
}
