/**
 * Security — how access actually works.
 *
 * The landing page asserts that data is private; this shows the mechanism, so
 * the claim can be checked rather than taken on faith. The permission matrix
 * is interactive because the shape of the thing is the point: pick a role and
 * watch what it can reach change.
 *
 * The roles and permissions below mirror the real matrix in the app. The
 * checkmarks describe defaults — any individual permission can be granted or
 * revoked per person on top of them.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck, Lock, Database, Zap, KeyRound, ArrowRight, Check, Minus } from 'lucide-react'
import { usePageMeta } from '../hooks/usePageMeta'
import { useReveal } from '../hooks/useReveal'
import PublicLayout from '../components/PublicLayout'
import { Grain } from '../components/LandingVisuals'
import { Head, Card, Grid } from '../components/PublicBits'
import AuditTrailSandbox from '../components/AuditTrailSandbox'
import { SECURITY } from '../content/publicContent'

const ROLES = [
  { key: 'superadmin', label: 'Super Admin', rank: 1,  note: 'Full auth, security and audit control.' },
  { key: 'admin',      label: 'Admin',       rank: 10, note: 'Business administration and operations.' },
  { key: 'manager',    label: 'Manager',     rank: 30, note: 'Scoped team, client and project work.' },
  { key: 'finance',    label: 'Finance',     rank: 40, note: 'Invoices, tax ledger, reports, payments.' },
  { key: 'user',       label: 'User',        rank: 60, note: 'Scoped operational access.' },
  { key: 'viewer',     label: 'Viewer',      rank: 90, note: 'Read-only, scoped.' },
]

// true = granted by default, false = not, 'own' = only their own records.
const MATRIX = [
  ['View invoices',        { superadmin: true, admin: true,  manager: true,  finance: true,  user: 'own', viewer: 'own' }],
  ['Create & edit invoices',{ superadmin: true, admin: true,  manager: true,  finance: true,  user: 'own', viewer: false }],
  ['View projects',        { superadmin: true, admin: true,  manager: true,  finance: true,  user: 'own', viewer: 'own' }],
  ['Tax ledger',           { superadmin: true, admin: true,  manager: false, finance: true,  user: false, viewer: false }],
  ['Studio — ask',         { superadmin: true, admin: true,  manager: true,  finance: true,  user: true,  viewer: false }],
  ['Publish pages',        { superadmin: true, admin: true,  manager: true,  finance: false, user: false, viewer: false }],
  ['Manage users & roles', { superadmin: true, admin: true,  manager: false, finance: false, user: false, viewer: false }],
  ['Read the audit log',   { superadmin: true, admin: true,  manager: false, finance: false, user: false, viewer: false }],
]

const PILLARS = [
  { icon: Lock, title: 'Public means public',
    body: 'These pages describe the product. They make no API call and render no workspace figure — every number on them is invented for illustration and marked so assistive tech does not read it as data.' },
  { icon: Database, title: 'Scoped when the query is built',
    body: 'Row scope comes from the session and is applied as the SQL is compiled, not filtered out afterwards in the browser. A narrower account cannot widen what it sees by changing what it asks for.' },
  { icon: KeyRound, title: 'Sessions are server-side',
    body: 'Every request resolves a live session row. Revoking one takes effect on the next request rather than when a token happens to expire.' },
  { icon: Zap, title: 'Recorded, without slowing anything',
    body: 'Who, what, when and from where — queued and written by a background worker, so the audit trail never becomes the reason a page is slow.' },
]

function Cell({ v }) {
  if (v === true)  return <Check size={15} aria-label="granted" style={{ color: 'var(--fin-positive, #16a34a)' }} />
  if (v === 'own') return <span className="text-[10px] font-bold" style={{ color: 'var(--accent)' }}>OWN</span>
  return <Minus size={14} aria-label="not granted" style={{ color: 'var(--text-3)', opacity: 0.5 }} />
}

export default function Security() {
  const [role, setRole] = useState('manager')
  const head = useReveal()
  usePageMeta({
    title: 'Security & access — FinTrack',
    description: 'Roles, per-user permission overrides, query-level row scoping and a full audit trail.',
  })

  const active = ROLES.find(r => r.key === role)
  const granted = MATRIX.filter(([, m]) => m[role]).length

  return (
    <PublicLayout>
      <section className="relative overflow-hidden">
        <div className="ft-aurora" aria-hidden="true"><span /><span /></div>
        <Grain />
        <div ref={head} className="ft-reveal relative mx-auto px-4 sm:px-6 pt-12 pb-8 sm:pt-16"
             style={{ maxWidth: 1120, zIndex: 1 }}>
          <p className="ft-eyebrow mb-3">Security &amp; access</p>
          <h1 className="ft-display mb-4"
              style={{ fontSize: 'clamp(2rem, 5.6vw, 3.2rem)', lineHeight: 1.08 }}>
            <span className="ft-rise"><span>Who can see what,</span></span>
            <span className="ft-rise">
              <span style={{ transitionDelay: '110ms' }}><em>and how it is enforced</em></span>
            </span>
          </h1>
          <p className="ft-lede">
            Access is by invitation and every account is approved by an administrator.
            Below is the actual shape of the permission model — pick a role to see
            what it reaches by default.
          </p>
        </div>
      </section>

      {/* ── interactive matrix ── */}
      <section className="mx-auto px-4 sm:px-6 pb-14" style={{ maxWidth: 1120 }}>
        <div className="rounded-2xl p-4 sm:p-6"
             style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
          <div role="tablist" aria-label="Roles" className="flex gap-2 overflow-x-auto pb-3">
            {ROLES.map(r => {
              const on = r.key === role
              return (
                <button key={r.key} role="tab" aria-selected={on}
                        onClick={() => setRole(r.key)}
                        className="rounded-xl shrink-0 font-semibold"
                        style={{
                          minHeight: 44, padding: '0 14px', fontSize: 13, cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          background: on ? 'var(--accent-dim)' : 'var(--bg-input)',
                          border: `1px solid ${on ? 'var(--accent-soft)' : 'var(--card-border)'}`,
                          color: on ? 'var(--accent)' : 'var(--text-2)',
                          transition: 'background 200ms ease, color 200ms ease, border-color 200ms ease',
                        }}>
                  {r.label}
                </button>
              )
            })}
          </div>

          <p className="text-[13px] mb-4" style={{ color: 'var(--text-2)' }}>
            <span className="font-bold" style={{ color: 'var(--text-1)' }}>{active.label}</span>
            {' — '}{active.note}{' '}
            <span style={{ color: 'var(--text-3)' }}>
              ({granted} of {MATRIX.length} capabilities by default)
            </span>
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" style={{ borderCollapse: 'collapse', minWidth: 280 }}>
              <caption className="sr-only">Default permissions by role</caption>
              <thead>
                <tr>
                  <th scope="col" className="text-left font-semibold py-2"
                      style={{ color: 'var(--text-3)' }}>Capability</th>
                  <th scope="col" className="text-right font-semibold py-2 pr-2"
                      style={{ color: 'var(--text-3)', width: 90 }}>{active.label}</th>
                </tr>
              </thead>
              <tbody>
                {MATRIX.map(([cap, m]) => (
                  <tr key={cap} style={{ borderTop: '1px solid var(--card-border)' }}>
                    <th scope="row" className="text-left font-medium py-2.5"
                        style={{ color: 'var(--text-1)' }}>{cap}</th>
                    <td className="py-2.5 pr-2">
                      <span className="flex justify-end"><Cell v={m[role]} /></span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] mt-4" style={{ color: 'var(--text-3)' }}>
            <span className="font-bold" style={{ color: 'var(--accent)' }}>OWN</span> means the
            account sees only records it owns. These are defaults — any single permission can be
            granted or revoked for one person without changing their role.
          </p>
        </div>
      </section>

      {/* ── pillars ── */}
      {/* ── What is and is not public ─────────────────────────────────
          This lived at the bottom of the landing page. When that page was
          split it stopped being rendered anywhere at all, which is a poor
          fate for the one section that tells a visitor none of what they
          are looking at belongs to anyone. */}
      <section id="privacy" className="mx-auto px-4 sm:px-6 pb-16 sm:pb-24" style={{ maxWidth: 1120 }}>
        <div className="rounded-3xl p-6 sm:p-10"
             style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
          <Head eyebrow="Access" title="This page is public. Your data is not.">
            Everything described here is capability, and the sandbox on the
            overview is fiction computed in your browser. No figure on these
            pages is read from a workspace, and nothing below the fold belongs
            to anyone.
          </Head>
          <Grid min={250}>
            {SECURITY.map(({ icon, title, body }, i) => (
              <Card key={title} icon={icon} title={title} body={body} delay={Math.min(i, 3) * 70} />
            ))}
          </Grid>
        </div>
      </section>

      {/* ── Tamper-Evident Audit & Session Sandbox ──────────────────────── */}
      <section className="mx-auto px-4 sm:px-6 pb-14" style={{ maxWidth: 1120 }}>
        <Head n="02" eyebrow="Tamper-proof trail" title="Every state change is cryptographically attributed">
          Inspect how role overrides, invoice updates, and query executions produce verifiable SHA-256 event checksums, and test immediate server-side session termination across active devices.
        </Head>
        <AuditTrailSandbox />
      </section>

      <section className="mx-auto px-4 sm:px-6 pb-16 sm:pb-24" style={{ maxWidth: 1120 }}>
        <div className="grid gap-4 sm:gap-5"
             style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' }}>
          {PILLARS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-2xl p-5"
                 style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
              <div className="flex items-center justify-center rounded-xl mb-3"
                   style={{ width: 40, height: 40, background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                <Icon size={19} aria-hidden="true" />
              </div>
              <h2 className="ft-display mb-2" style={{ fontSize: '1.12rem', color: 'var(--text-1)' }}>{title}</h2>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto px-4 sm:px-6 pb-16 sm:pb-24" style={{ maxWidth: 1120 }}>
        <div className="rounded-3xl px-6 py-12 sm:px-12 sm:py-14 text-center"
             style={{ background: 'linear-gradient(135deg, var(--accent-btn), var(--accent-bright))', color: '#fff' }}>
          <ShieldCheck size={26} className="mx-auto mb-3" aria-hidden="true" />
          <h2 className="ft-display mb-3"
              style={{ fontSize: 'clamp(1.5rem, 4.2vw, 2.4rem)', lineHeight: 1.14 }}>
            Request access
          </h2>
          <p className="mx-auto mb-7" style={{ fontSize: '0.975rem', lineHeight: 1.6, opacity: 0.92, maxWidth: 440 }}>
            Sign in with email, Google or Zoho. An administrator approves the account
            before it can see anything.
          </p>
          <Link to="/login"
                className="inline-flex items-center justify-center gap-2 rounded-xl font-bold"
                style={{ minHeight: 52, padding: '0 30px', background: '#fff',
                         color: 'var(--accent-btn)', textDecoration: 'none', fontSize: '0.975rem' }}>
            Sign in <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </section>
    </PublicLayout>
  )
}
