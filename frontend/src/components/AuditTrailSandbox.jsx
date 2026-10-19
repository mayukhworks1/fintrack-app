/**
 * The request log and the session list, as the admin panel shows them.
 *
 * Columns are Admin → Requests' own (method, path, status, duration, IP,
 * device, country; every one a column of audit_log), and the sessions are
 * Users & Sessions' cards (device, browser, IP, last seen, Revoke). Paths are
 * real API routes. Everything else is sample: addresses are from the
 * documentation ranges (RFC 5737) and accounts are @example.com.
 *
 * "Revoke sessions" is per account, as in the admin panel: it sets
 * revoked_at on every live session the account has, and deps.py refuses the
 * next request that carries one — which is what happens here: the account's
 * cards are struck through and move to Revoked, and one of its devices'
 * next request lands in the log as a 401. New rows slide in at the top and the rows below make room
 * (FLIP, transform only). Under reduced motion rows simply appear.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { Laptop, Smartphone, Monitor, FileText, KeyRound, Sparkles } from 'lucide-react'
import { prefersReducedMotion } from '../hooks/useReducedMotion'
import RollNumber from './motion/RollNumber'

const INITIAL_ROWS = [
  { id: 'r3', method: 'GET', path: '/api/invoices/aging-buckets', status: 200, ms: 92, ip: '192.0.2.14', device: 'Desktop', country: 'India' },
  { id: 'r2', method: 'PATCH', path: '/api/status/…', status: 200, ms: 141, ip: '198.51.100.23', device: 'Mobile', country: 'India' },
  { id: 'r1', method: 'GET', path: '/api/projects', status: 200, ms: 77, ip: '203.0.113.7', device: 'Desktop', country: 'Singapore' },
]

const ACCOUNTS = [
  { email: 'admin@example.com', role: 'Super Admin', current: true, sessions: [
    { id: 's1', device: 'Desktop', browser: 'Chrome on macOS', ip: '192.0.2.14', seen: 'just now', icon: Laptop },
  ] },
  { email: 'ops@example.com', role: 'Manager', sessions: [
    { id: 's2', device: 'Mobile', browser: 'Safari on iOS', ip: '198.51.100.23', seen: '4 min ago', icon: Smartphone },
    { id: 's3', device: 'Desktop', browser: 'Firefox on Windows', ip: '203.0.113.7', seen: '2 h ago', icon: Monitor },
  ] },
]
const ME = ACCOUNTS[0].sessions[0]

const ACTIONS = [
  { id: 'invoice', label: 'Open an invoice', icon: FileText,
    row: { method: 'GET', path: '/api/invoices/summary', status: 200, ms: 86 } },
  { id: 'permission', label: 'Change a permission', icon: KeyRound,
    row: { method: 'PUT', path: '/api/admin/permissions/users/…/module.invoices.create', status: 200, ms: 118 } },
  { id: 'ask', label: 'Ask the analyst', icon: Sparkles,
    row: { method: 'POST', path: '/api/studio/analyze', status: 200, ms: 1240 } },
]

let seq = 10

function Account({ acct, revoked = false, onRevoke }) {
  return (
    <div className="ft-f-acct" data-revoked={revoked ? '' : undefined}>
      <div className="ft-f-acct-head">
        <b>{acct.email}</b>
        <span>{acct.role}</span>
        {acct.current
          ? <span className="ft-f-tag" data-tone="ok">You</span>
          : revoked
            ? <span className="ft-f-tag" data-tone="bad">Revoked</span>
            : <button type="button" className="ft-f-revoke" onClick={onRevoke}>Revoke sessions</button>}
      </div>
      <ul className="ft-f-sessions">
        {acct.sessions.map(s => {
          const Icon = s.icon
          return (
            <li key={s.id} className="ft-f-sess">
              <Icon size={15} aria-hidden="true" />
              <div>
                <b>{s.device} · {s.browser}</b>
                <span>{s.ip} · {revoked ? 'refused from its next request' : `last seen ${s.seen}`}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Rows below a new one slide down into place instead of jumping. */
function useFlip(ref, dep) {
  const prev = useRef(new Map())
  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    const now = new Map()
    for (const el of box.children) if (el.dataset.key) now.set(el.dataset.key, el.offsetTop)
    if (!prefersReducedMotion()) {
      for (const el of box.children) {
        const was = prev.current.get(el.dataset.key), is = now.get(el.dataset.key)
        if (was == null || was === is || typeof el.animate !== 'function') continue
        el.animate([{ transform: `translateY(${was - is}px)` }, { transform: 'none' }],
          { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' })
      }
    }
    prev.current = now
  }, [ref, dep])
}

export default function AuditTrailSandbox() {
  const [rows, setRows] = useState(INITIAL_ROWS)
  const [revoked, setRevoked] = useState([])
  const [total, setTotal] = useState(INITIAL_ROWS.length)
  const body = useRef(null)
  const timers = useRef([])
  useFlip(body, rows)
  useLayoutEffect(() => () => timers.current.forEach(clearTimeout), [])

  const push = (row) => {
    const id = `r${++seq}`
    setRows(prev => [{ ...row, id, fresh: true }, ...prev.map(r => ({ ...r, fresh: false }))].slice(0, 6))
    setTotal(t => t + 1)
  }

  const act = (a) => push({ ...a.row, ip: ME.ip, device: ME.device, country: 'India' })

  const revoke = (acct) => {
    if (revoked.includes(acct.email)) return
    setRevoked(prev => [...prev, acct.email])
    push({ method: 'POST', path: '/api/admin/auth/users/…/sessions/revoke', status: 200, ms: 64, ip: ME.ip, device: ME.device, country: 'India' })
    // One of its devices tries again: refused at the session check.
    const s = acct.sessions[0]
    timers.current.push(setTimeout(() => {
      push({ method: 'GET', path: '/api/invoices', status: 401, ms: 9, ip: s.ip, device: s.device, country: 'India', note: 'Session has been revoked' })
    }, prefersReducedMotion() ? 0 : 900))
  }

  const reset = () => {
    timers.current.forEach(clearTimeout)
    setRevoked([]); setRows(INITIAL_ROWS); setTotal(INITIAL_ROWS.length)
  }

  const live = ACCOUNTS.filter(a => !revoked.includes(a.email))
  const gone = ACCOUNTS.filter(a => revoked.includes(a.email))
  const activeCount = live.reduce((n, a) => n + a.sessions.length, 0)

  return (
    <div className="ft-f-audit">
      <div className="ft-f-audit-bar">
        <div className="ft-f-audit-acts" role="group" aria-label="Make a request as admin@example.com">
          {ACTIONS.map(a => {
            const Icon = a.icon
            return (
              <button key={a.id} type="button" onClick={() => act(a)}>
                <Icon size={14} aria-hidden="true" /> {a.label}
              </button>
            )
          })}
        </div>
        <dl className="ft-f-audit-count">
          <div><dt>Requests recorded</dt><dd><RollNumber value={total} align="start" /></dd></div>
          <div><dt>Active sessions</dt><dd><RollNumber value={activeCount} align="start" /></dd></div>
        </dl>
      </div>

      <div className="ft-f-audit-grid">
        <section aria-label="Requests" className="ft-f-audit-log">
          <p className="ft-f-kicker">Admin → Requests</p>
          {/* Focusable, so the columns past the edge on a phone can be
              scrolled to from the keyboard. */}
          <div className="ft-f-audit-scroll" tabIndex={0} role="region" aria-label="Recent requests, scrolls sideways">
            <table className="ft-f-reqs">
              <caption className="sr-only">Recent requests, newest first, sample data</caption>
              <thead>
                <tr><th scope="col">Method</th><th scope="col">Path</th><th scope="col">Status</th><th scope="col">Time</th><th scope="col">IP</th><th scope="col">Device</th><th scope="col">Country</th></tr>
              </thead>
              <tbody ref={body} aria-live="polite">
                {rows.map(r => (
                  <tr key={r.id} data-key={r.id} data-fresh={r.fresh ? '' : undefined}>
                    <td><span className="ft-f-method" data-m={r.method}>{r.method}</span></td>
                    <td className="ft-f-path-cell"><code title={r.path}>{r.path}</code>{r.note && <small>{r.note}</small>}</td>
                    <td><span className="ft-f-status" data-ok={r.status < 400 ? '' : undefined}>{r.status}</span></td>
                    <td className="tabular-nums">{r.ms.toLocaleString('en-IN')} ms</td>
                    <td className="tabular-nums">{r.ip}</td>
                    <td>{r.device}</td>
                    <td>{r.country}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-label="Sessions" className="ft-f-audit-sess">
          <p className="ft-f-kicker">Users &amp; Sessions</p>
          {live.map(a => <Account key={a.email} acct={a} onRevoke={() => revoke(a)} />)}
          {gone.length > 0 && (
            <>
              <p className="ft-f-kicker ft-f-revoked-h">
                Revoked
                <button type="button" className="ft-f-ghost" onClick={reset}>Reset the demo</button>
              </p>
              {gone.map(a => <Account key={a.email} acct={a} revoked />)}
            </>
          )}
        </section>
      </div>
      <p className="ft-f-foot">
        Sample data. Addresses are documentation ranges, accounts are @example.com, and the paths are
        the app&rsquo;s own API routes.
      </p>
    </div>
  )
}
