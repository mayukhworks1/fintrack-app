/**
 * The default permissions each role is seeded with.
 *
 * ROLES and every cell below are read from the seed in
 * backend/app/db/postgres.py (auth_roles and auth_role_permissions), one
 * permission key per row, so the matrix can be checked line by line against
 * the SQL. Super Admin is seeded with every permission and also passes every
 * check in require_permission, so it cannot be overridden. "Own" marks the
 * roles whose invoice reads are scoped to records they raised
 * (owner_scope_email in routers/deps.py: every role outside Super Admin,
 * Admin, Manager, Finance and Web Invoice Admin).
 *
 * Wide screens get the whole matrix, eight roles across, with a highlight
 * that slides to the picked role. Phones get one role at a time, picked from
 * a row that scrolls sideways. Either way a "one person" toggle shows the
 * per-person override the admin panel offers: one cell flips, and is marked.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Minus, ArrowRight } from 'lucide-react'
import { useInk } from '../../hooks/useInk'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import RollNumber from '../motion/RollNumber'

export const ROLES = [
  { key: 'superadmin', label: 'Super Admin', short: 'Super Admin', note: 'Full auth, security, system, data and audit control.' },
  { key: 'admin', label: 'Admin', short: 'Admin', note: 'Business administration and operational control.' },
  { key: 'manager', label: 'Manager', short: 'Manager', note: 'Team, client and project operations.' },
  { key: 'finance', label: 'Finance', short: 'Finance', note: 'Invoices, tax ledger, reports and payments.' },
  { key: 'web_admin', label: 'Web Invoice Admin', short: 'Web admin', note: 'Web invoices, web projects and web finance controls.' },
  { key: 'web', label: 'Web Invoice User', short: 'Web user', note: 'Web invoices they raised.' },
  { key: 'user', label: 'User', short: 'User', note: 'Day-to-day operational access.' },
  { key: 'viewer', label: 'Viewer', short: 'Viewer', note: 'Read-only access.' },
]

const ALL = ROLES.map(r => r.key)
const OWN = ['web', 'user', 'viewer']

/* [capability, permission key, roles granted by the seed] */
export const MATRIX = [
  ['View invoices', 'module.invoices.view', ALL],
  ['Create invoices', 'module.invoices.create', ['superadmin', 'admin', 'finance', 'web_admin', 'web']],
  ['Record payments', 'module.invoices.payment', ['superadmin', 'admin', 'manager', 'finance', 'web_admin', 'web']],
  ['View projects', 'module.projects.view', ['superadmin', 'admin', 'manager', 'web_admin', 'user', 'viewer']],
  ['Tax ledger', 'module.tax.view', ['superadmin', 'admin', 'manager', 'finance', 'web_admin', 'viewer']],
  ['Analytics', 'module.analytics.view', ['superadmin', 'admin', 'manager', 'web_admin', 'viewer']],
  ['Generate reports', 'module.reports.create', ['superadmin', 'admin', 'manager', 'finance', 'web_admin']],
  ['Ask the AI analyst', 'module.ai.use', ['superadmin', 'admin', 'manager', 'web_admin']],
  ['Edit the status board', 'module.status.edit', ['superadmin', 'admin', 'manager']],
  ['Share views on a link', 'module.shared.manage', ['superadmin', 'admin', 'web_admin']],
  ['Read the audit log', 'module.admin.audit.view', ['superadmin', 'admin']],
  ['Approve and manage users', 'module.admin.users.*', ['superadmin']],
].map(([cap, key, roles]) => ({
  cap, key,
  cells: Object.fromEntries(ALL.map(r => [r, roles.includes(r) ? (key === 'module.invoices.view' && OWN.includes(r) ? 'own' : true) : false])),
}))

function Cell({ v, override }) {
  return (
    <span className="ft-f-cell" data-v={v === 'own' ? 'own' : v ? 'yes' : 'no'}>
      {v === 'own' ? <b>Own</b> : v
        ? <Check size={15} aria-label="granted" />
        : <Minus size={14} aria-label="not granted" />}
      {override && <span className="ft-f-override ft-m-pop">override</span>}
    </span>
  )
}

export default function PermissionMatrix() {
  const wide = useMediaQuery('(min-width: 1024px)')
  const [role, setRole] = useState('manager')
  const [override, setOverride] = useState(false)
  const i = ROLES.findIndex(r => r.key === role)
  const ink = useInk(i)
  const active = ROLES[i]

  // The cell a one-person override would flip: the first capability this
  // role does not have by default (Super Admin has every one).
  const flip = useMemo(() => MATRIX.findIndex(m => !m.cells[role]), [role])
  const valueOf = (row, r, idx) => (override && r === role && idx === flip ? true : row.cells[r])
  const granted = MATRIX.filter((m, idx) => valueOf(m, role, idx)).length

  const pick = (k) => { setRole(k); setOverride(false) }

  return (
    <div className="ft-f-matrix">
      {/* A set of toggle buttons, not tabs: picking a role changes the
          highlighted column and the summary, there is no panel to switch. */}
      <div ref={ink} role="group" aria-label="Roles" className="ft-m-ink ft-f-roles">
        {ROLES.map(r => (
          <button key={r.key} type="button" aria-pressed={r.key === role} onClick={() => pick(r.key)}>
            {r.label}
          </button>
        ))}
        <span className="ft-m-ink-bar ft-m-ink-pill" aria-hidden="true" />
      </div>

      <div className="ft-f-matrix-sum">
        <p>
          <b>{active.label}</b> — {active.note}{' '}
          <span className="ft-f-matrix-n">
            <RollNumber value={granted} format={n => String(Math.round(n))} align="end" /> of {MATRIX.length}
            {override ? ' with one override' : ' by default'}
          </span>
        </p>
        {flip >= 0 ? (
          <label className="ft-f-toggle">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            <span aria-hidden="true" />
            Grant one person &ldquo;{MATRIX[flip].cap.toLowerCase()}&rdquo;
          </label>
        ) : (
          <p className="ft-f-matrix-note">Super Admin passes every permission check, so it has nothing to override.</p>
        )}
      </div>

      <div className="ft-f-matrix-scroll">
        {wide && <span className="ft-f-colhi" style={{ '--col': i }} aria-hidden="true" />}
        {wide ? (
          <table className="ft-f-table">
            <caption className="sr-only">Default permissions by role, as seeded</caption>
            <colgroup><col className="ft-f-col-cap" />{ROLES.map(r => <col key={r.key} />)}</colgroup>
            <thead>
              <tr>
                <th scope="col">Capability</th>
                {ROLES.map(r => (
                  <th key={r.key} scope="col" data-on={r.key === role ? '' : undefined}>{r.short}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MATRIX.map((m, idx) => (
                <tr key={m.key}>
                  <th scope="row"><span>{m.cap}</span><code>{m.key}</code></th>
                  {ROLES.map(r => (
                    <td key={r.key} data-on={r.key === role ? '' : undefined}>
                      <span key={r.key === role ? role : 'x'} className={r.key === role ? 'ft-pop' : undefined}
                            style={r.key === role ? { '--i': idx } : undefined}>
                        <Cell v={valueOf(m, r.key, idx)} override={override && r.key === role && idx === flip} />
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="ft-f-table is-one">
            <caption className="sr-only">Default permissions for {active.label}, as seeded</caption>
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col">{active.short}</th>
              </tr>
            </thead>
            <tbody key={role}>
              {MATRIX.map((m, idx) => (
                <tr key={m.key}>
                  <th scope="row"><span>{m.cap}</span></th>
                  <td>
                    <span className="ft-pop" style={{ '--i': idx }}>
                      <Cell v={valueOf(m, role, idx)} override={override && idx === flip} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="ft-f-foot">
        <b>Own</b> means invoices the account raised. These are the defaults each role is seeded
        with; any single permission can be granted or revoked for one person, and the change applies
        on their next request.{' '}
        <Link to="/customise" className="ft-f-link" style={{ marginTop: 0 }}>
          Try per-person overrides <ArrowRight size={13} aria-hidden="true" />
        </Link>
      </p>
    </div>
  )
}
