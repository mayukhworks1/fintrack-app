/**
 * The permission model, small enough to fit in a card.
 *
 * Three sample people, each on a role the database seeds
 * (backend/app/db/postgres.py: auth_roles and auth_role_permissions), and the
 * eleven permission modules those seeds are written against, each shown by
 * its entry permission. A role's defaults are exactly the seed; a switch
 * flipped here is the per-person override the admin panel offers, and is
 * marked as one.
 *
 * Underneath, the two things a grant actually changes:
 *
 *   - whether the invoice list answers at all. Without module.invoices.view
 *     the API refuses with "Missing permission: module.invoices.view"
 *     (require_permission in routers/deps.py);
 *   - which rows it answers with. Roles outside Super Admin, Admin, Manager,
 *     Finance and Web Invoice Admin are scoped to the invoices they raised
 *     (owner_scope_email), which the list query applies as
 *     fields->>'Raised By' = $1 (services/invoice.py).
 *
 * The people, their emails and who raised which invoice are invented; the
 * invoices are three rows of the sandbox ledger.
 */
import { useState } from 'react'
import {
  LayoutDashboard, Receipt, FolderKanban, Landmark, BarChart3, FileText, Sparkles,
  Activity, Share2, FileSearch, ShieldCheck, RotateCcw, Lock,
} from 'lucide-react'
import { useReveal } from '../hooks/useReveal'
import { useInk } from '../hooks/useInk'
import RollNumber from './motion/RollNumber'
import { INVOICES, inr } from './demoData'

/* [module key, label, entry permission, icon] — the eleven module_keys of the
   seeded permissions, leaving out `system` (sync and role management). */
export const MODULES = [
  ['dashboard', 'Dashboard', 'module.dashboard.view', LayoutDashboard],
  ['invoices', 'Invoices', 'module.invoices.view', Receipt],
  ['projects', 'Projects', 'module.projects.view', FolderKanban],
  ['tax', 'Tax ledger', 'module.tax.view', Landmark],
  ['analytics', 'Analytics', 'module.analytics.view', BarChart3],
  ['reports', 'Reports', 'module.reports.create', FileText],
  ['ai', 'AI analyst', 'module.ai.use', Sparkles],
  ['status', 'Status board', 'module.status.view', Activity],
  ['shared', 'Shared views', 'module.shared.manage', Share2],
  ['studio', 'Studio', 'module.studio.view', FileSearch],
  ['admin', 'Admin panel', 'module.admin.view', ShieldCheck],
]

/* Seeded defaults, per role, by module key. */
export const PEOPLE = [
  {
    id: 'rhea', name: 'Rhea', email: 'rhea@example.com', role: 'Viewer',
    note: 'Read-only scoped access.', scoped: true,
    grants: ['dashboard', 'invoices', 'projects', 'tax', 'analytics', 'status'],
  },
  {
    id: 'dev', name: 'Dev', email: 'dev@example.com', role: 'Finance',
    note: 'Invoice, tax ledger, reports and payment operations.', scoped: false,
    grants: ['dashboard', 'invoices', 'tax', 'reports'],
  },
  {
    id: 'priya', name: 'Priya', email: 'priya@example.com', role: 'Admin',
    note: 'Business administration and operational control.', scoped: false,
    grants: ['dashboard', 'invoices', 'projects', 'tax', 'analytics', 'reports', 'ai', 'status', 'shared', 'studio', 'admin'],
  },
]

/* Three rows of the sandbox ledger, and an invented "Raised By" for each. */
const RAISED_BY = { 'INV-2296': 'priya@example.com', 'INV-2271': 'rhea@example.com', 'INV-2327': 'dev@example.com' }
const ROWS = Object.keys(RAISED_BY).map(id => INVOICES.find(i => i.id === id)).filter(Boolean)

const whole = (n) => String(Math.round(n))

export default function PermissionPlayground() {
  const ref = useReveal({ threshold: 0.15 })
  const [pid, setPid] = useState('rhea')
  const [overrides, setOverrides] = useState({})
  const at = PEOPLE.findIndex(p => p.id === pid)
  const person = PEOPLE[at]
  const ink = useInk(at, { axis: 'y' })
  const mine = overrides[pid] ?? {}

  const allowed = (key) => (key in mine ? mine[key] : person.grants.includes(key))
  const isOverride = (key) => key in mine && mine[key] !== person.grants.includes(key)
  const toggle = (key) => setOverrides(o => ({ ...o, [pid]: { ...(o[pid] ?? {}), [key]: !allowed(key) } }))
  const reset = () => setOverrides(o => ({ ...o, [pid]: {} }))

  const granted = MODULES.filter(([k]) => allowed(k)).length
  const changed = MODULES.filter(([k]) => isOverride(k)).length
  const canInvoices = allowed('invoices')
  const rows = person.scoped ? ROWS.filter(r => RAISED_BY[r.id] === person.email) : ROWS

  return (
    <div ref={ref} className="ft-reveal ft-s-perm">
      <div className="ft-s-perm-bar">
        <span className="ft-s-perm-title"><ShieldCheck size={16} aria-hidden="true" /> Roles, and one person who differs</span>
        <span className="ft-s-perm-sample">Sample people · seeded role defaults</span>
      </div>

      <div className="ft-s-perm-body">
        <div className="ft-s-perm-left">
          <p className="ft-s-perm-label" id="ft-s-people">1. Pick a person</p>
          <div ref={ink} className="ft-m-ink ft-s-people" role="group" aria-labelledby="ft-s-people">
            {PEOPLE.map(p => (
              <button key={p.id} type="button" aria-pressed={p.id === pid} onClick={() => setPid(p.id)}>
                <span className="ft-s-avatar" aria-hidden="true">{p.name[0]}</span>
                <span className="ft-s-person">
                  <b>{p.name}</b> <span className="ft-s-role">{p.role}</span>
                  <span className="ft-s-person-note">{p.note}</span>
                </span>
              </button>
            ))}
            <span className="ft-m-ink-bar ft-m-ink-pill" aria-hidden="true" />
          </div>

          <p className="ft-s-perm-label">What {person.name}&rsquo;s invoice list runs</p>
          <pre className="ft-s-perm-sql"><code>
            {canInvoices ? (
              <>
                <span>SELECT invoice_number, project, amount_raised</span>
                <span>  FROM invoices_mirror</span>
                <span> WHERE deleted_at IS NULL</span>
                {person.scoped && (
                  <span key={pid} className="ft-s-hl">{`   AND fields->>'Raised By' = $1  -- ${person.email}`}</span>
                )}
                <span> ORDER BY raised_date DESC</span>
              </>
            ) : (
              <span key="403" className="ft-s-hl">403  Missing permission: module.invoices.view</span>
            )}
          </code></pre>
          <p className="ft-s-perm-foot">
            {person.scoped
              ? `${person.role} is not a privileged role, so the list is scoped to invoices ${person.name} raised.`
              : `${person.role} is a privileged role, so no owner filter is added.`}
          </p>
        </div>

        <div className="ft-s-perm-right">
          <div className="ft-s-perm-row">
            <p className="ft-s-perm-label">
              2. Change what {person.name} reaches{' '}
              <span className="ft-s-perm-n"><RollNumber value={granted} format={whole} align="end" /> of {MODULES.length} granted</span>
            </p>
            {changed > 0 && (
              <button type="button" onClick={reset} className="ft-s-perm-reset">
                <RotateCcw size={12} aria-hidden="true" /> Back to {person.role} defaults
              </button>
            )}
          </div>

          <ul className="ft-s-mods">
            {MODULES.map(([key, label, perm, Icon]) => {
              const on = allowed(key)
              const over = isOverride(key)
              return (
                <li key={key}>
                  <button type="button" role="switch" aria-checked={on} onClick={() => toggle(key)}
                          className="ft-s-mod" data-on={on ? '' : undefined} data-override={over ? '' : undefined}
                          title={perm}>
                    <Icon size={14} aria-hidden="true" />
                    <span className="ft-s-mod-label">{label}</span>
                    {over && <span className="ft-s-mod-over ft-m-pop">override</span>}
                    <span className="ft-s-switch" aria-hidden="true"><i /></span>
                  </button>
                </li>
              )
            })}
          </ul>

          <div className="ft-s-perm-table">
            <div className="ft-s-perm-row">
              <p className="ft-s-perm-label">Invoices, as {person.name} sees them</p>
              <span className="ft-s-perm-sample">Sample data</span>
            </div>
            {canInvoices ? (
              <ul className="ft-s-rows">
                {rows.map(r => (
                  <li key={r.id} className="ft-s-row">
                    <span><b>{r.client}</b> <small>{r.id}</small></span>
                    <span className="ft-s-raised">raised by {RAISED_BY[r.id].split('@')[0]}</span>
                    <b className="tabular-nums">{inr(r.amount)}</b>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ft-s-locked"><Lock size={16} aria-hidden="true" />
                Invoices are not in {person.name}&rsquo;s sidebar, and the API refuses the list.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
