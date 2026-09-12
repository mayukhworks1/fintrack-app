/**
 * Configuration, shown by letting you do it.
 *
 * "Fully customisable" is the least believable sentence on any product page,
 * because everybody writes it and nobody can check it. This is the real shape
 * of the permission model, small enough to fit in a card and honest enough to
 * be worth showing: roles carry defaults, any single permission can be
 * overridden for one person, and the effect is visible immediately.
 *
 * It mirrors what the application actually does. Permissions are rows in
 * auth_permissions grouped by module; roles map to them through
 * auth_role_permissions; a per-person override is a row in
 * auth_user_permission_grants that wins over the role. Pick a role here and
 * you get its defaults; toggle one and it is marked as an override, exactly
 * as the admin screen marks it.
 *
 * The people are invented. No account, role or grant on this page came from
 * a workspace — it makes no network call at all.
 */
import { useState } from 'react'
import {
  Receipt, FolderKanban, BarChart3, Landmark, FileSearch, Sparkles,
  FileText, Globe, Activity, Share2, ShieldCheck, RotateCcw, Check,
} from 'lucide-react'
import { useReveal } from '../hooks/useReveal'

const MODULES = [
  { key: 'receivables', label: 'Receivables', icon: Receipt },
  { key: 'projects',    label: 'Projects',    icon: FolderKanban },
  { key: 'analytics',   label: 'Analytics',   icon: BarChart3 },
  { key: 'tax',         label: 'Tax ledger',  icon: Landmark },
  { key: 'documents',   label: 'Documents',   icon: FileSearch },
  { key: 'analyst',     label: 'AI analyst',  icon: Sparkles },
  { key: 'reports',     label: 'Reports',     icon: FileText },
  { key: 'pages',       label: 'Pages',       icon: Globe },
  { key: 'status',      label: 'Status board', icon: Activity },
  { key: 'shared',      label: 'Shared links', icon: Share2 },
  { key: 'admin',       label: 'Admin & audit', icon: ShieldCheck },
]

/* Three of the roles, with the defaults each carries. Invented people. */
const ROLES = [
  {
    id: 'viewer', person: 'Rhea', title: 'Client services',
    grants: ['receivables', 'projects', 'status', 'shared'],
  },
  {
    id: 'analyst', person: 'Dev', title: 'Finance analyst',
    grants: ['receivables', 'projects', 'analytics', 'tax', 'documents', 'analyst', 'reports', 'status', 'shared'],
  },
  {
    id: 'admin', person: 'Priya', title: 'Administrator',
    grants: MODULES.map(m => m.key),
  },
]

export default function PermissionPlayground() {
  const ref = useReveal({ threshold: 0.15 })
  const [roleId, setRoleId] = useState('viewer')
  // Overrides are keyed per role, the way a per-user grant is stored against
  // the person and not against the role they happen to hold.
  const [overrides, setOverrides] = useState({})

  const role = ROLES.find(r => r.id === roleId)
  const roleOverrides = overrides[roleId] ?? {}

  const allowed = (key) =>
    key in roleOverrides ? roleOverrides[key] : role.grants.includes(key)
  const isOverride = (key) =>
    key in roleOverrides && roleOverrides[key] !== role.grants.includes(key)

  const toggle = (key) =>
    setOverrides(o => ({ ...o, [roleId]: { ...(o[roleId] ?? {}), [key]: !allowed(key) } }))

  const reset = () => setOverrides(o => ({ ...o, [roleId]: {} }))

  const visible = MODULES.filter(m => allowed(m.key))
  const overrideCount = MODULES.filter(m => isOverride(m.key)).length

  return (
    <div ref={ref} className="ft-reveal rounded-2xl overflow-hidden"
         style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
      <div className="flex items-center gap-2 px-4 py-2.5 flex-wrap"
           style={{ background: 'var(--bg-input)', borderBottom: '1px solid var(--card-border)' }}>
        <span className="font-bold" style={{ fontSize: 12, color: 'var(--text-1)' }}>
          Permission matrix
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
          pick a person, then change their access
        </span>
        {overrideCount > 0 && (
          <button onClick={reset}
                  className="ml-auto flex items-center gap-1.5 rounded-md font-semibold"
                  style={{ height: 26, padding: '0 9px', fontSize: 11, cursor: 'pointer',
                           background: 'var(--card-bg)', border: '1px solid var(--card-border)',
                           color: 'var(--text-2)' }}>
            <RotateCcw size={11} aria-hidden="true" />
            Back to role defaults
          </button>
        )}
      </div>

      <div className="p-4 grid gap-4"
           style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))' }}>
        <div>
          <p className="font-bold uppercase tracking-[0.14em] mb-2"
             style={{ fontSize: 9.5, color: 'var(--text-3)' }}>Who</p>
          <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Sample people">
            {ROLES.map(r => {
              const on = r.id === roleId
              return (
                <button key={r.id} role="radio" aria-checked={on}
                        onClick={() => setRoleId(r.id)}
                        className="flex items-center gap-2.5 rounded-lg text-left"
                        style={{
                          minHeight: 44, padding: '0 11px', cursor: 'pointer',
                          background: on ? 'var(--accent-dim)' : 'transparent',
                          border: `1px solid ${on ? 'var(--accent-soft)' : 'var(--card-border)'}`,
                        }}>
                  <span className="flex items-center justify-center rounded-full font-bold shrink-0"
                        style={{ width: 26, height: 26, fontSize: 11,
                                 background: on ? 'var(--accent)' : 'var(--bg-input)',
                                 color: on ? '#fff' : 'var(--text-3)' }}>
                    {r.person[0]}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-bold" style={{ fontSize: 12.5, color: on ? 'var(--accent)' : 'var(--text-1)' }}>
                      {r.person}
                    </span>
                    <span className="block truncate" style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
                      {r.title}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          <p className="mt-3" style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-3)' }}>
            A role carries defaults. Any one permission can be granted or revoked
            for a single person without inventing a new role for them.
          </p>
        </div>

        <div>
          <p className="font-bold uppercase tracking-[0.14em] mb-2"
             style={{ fontSize: 9.5, color: 'var(--text-3)' }}>Can see</p>
          <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))' }}>
            {MODULES.map(m => {
              const on = allowed(m.key)
              const over = isOverride(m.key)
              const Icon = m.icon
              return (
                <button key={m.key} onClick={() => toggle(m.key)}
                        aria-pressed={on}
                        aria-label={`${m.label} — ${on ? 'allowed' : 'not allowed'} for ${role.person}`}
                        className="flex items-center gap-2 rounded-lg"
                        style={{
                          minHeight: 34, padding: '0 9px', cursor: 'pointer', textAlign: 'left',
                          background: on ? 'var(--accent-dim)' : 'transparent',
                          border: `1px solid ${over ? 'var(--accent)' : on ? 'var(--accent-soft)' : 'var(--card-border)'}`,
                          transition: 'background 200ms ease, border-color 200ms ease',
                        }}>
                  <Icon size={13} aria-hidden="true"
                        style={{ flexShrink: 0, color: on ? 'var(--accent)' : 'var(--text-3)' }} />
                  <span className="truncate" style={{ fontSize: 11.5, fontWeight: on ? 700 : 500,
                                                      color: on ? 'var(--text-1)' : 'var(--text-3)' }}>
                    {m.label}
                  </span>
                  {over && (
                    <span className="ml-auto rounded font-bold shrink-0"
                          style={{ fontSize: 8, padding: '1px 4px', background: 'var(--accent)', color: '#fff' }}>
                      SET
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* The consequence, spelled out — the thing an admin screen usually
          makes you go and check for yourself. */}
      <div className="px-4 py-3 flex items-start gap-2.5"
           style={{ background: 'var(--bg-input)', borderTop: '1px solid var(--card-border)' }}>
        <Check size={14} aria-hidden="true" style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
        <p style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-2)' }}>
          <strong style={{ color: 'var(--text-1)' }}>{role.person}</strong>{' '}
          {visible.length === 0
            ? 'can currently reach nothing, and would land on an empty workspace.'
            : <>signs in to {visible.length} of {MODULES.length} modules
                {' — '}{visible.map(m => m.label).join(', ')}.</>}
          {overrideCount > 0 && (
            <> {overrideCount} {overrideCount === 1 ? 'permission differs' : 'permissions differ'} from
              the {role.title.toLowerCase()} default. In the product a change like this takes
              effect on their next request, not their next sign-in.</>
          )}
        </p>
      </div>
    </div>
  )
}
