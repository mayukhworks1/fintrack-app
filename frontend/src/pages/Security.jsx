/**
 * Security — how access actually works.
 *
 * The landing page asserts that data is private; this shows the mechanism, so
 * the claim can be checked rather than taken on faith. The hero draws the
 * path every request takes through the server; the matrix below it is the
 * seeded permission defaults, one permission key per row; and the sandbox at
 * the bottom is the admin panel's own request log and session list, on
 * sample data.
 */
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { usePageMeta } from '../hooks/usePageMeta'
import PublicLayout from '../components/PublicLayout'
import { Grain } from '../components/LandingVisuals'
import { Head, PageHead, Reveal, Closing } from '../components/PublicBits'
import AuditTrailSandbox from '../components/AuditTrailSandbox'
import PermissionMatrix from '../components/features/PermissionMatrix'
import RequestPath from '../components/features/RequestPath'
import { SECURITY, TRUST } from '../content/publicContent'
import '../styles/public-security.css'

/* Which stop on the request path each mechanism lives at. */
const STOP = {
  'The model never writes SQL': '3',
  'Scoped where the query is built': '3',
  'Document answers carry citations': '4',
  'Everything is written down': 'A',
}

export default function Security() {
  usePageMeta({
    title: 'Security & access — FinTrack',
    description: 'Roles, per-user permission overrides, query-level row scoping and a full audit trail.',
  })

  return (
    <PublicLayout>
      <section className="relative overflow-hidden">
        <Grain />
        <PageHead eyebrow="Security & access"
                  lines={['Who can see what,', <em key="em">and how it is enforced</em>]}
                  aside={<RequestPath />} asideMobile>
          Access is by invitation and every account is approved by an administrator.
          Every request passes the same four checks, and the matrix below is the
          permission model as it is seeded: pick a role to see what it reaches by default.
        </PageHead>
      </section>

      {/* Not wrapped in a Reveal: this card is on screen at load, and the
          largest thing painted there should never start invisible. */}
      <section className="mx-auto px-4 sm:px-6 pb-16" style={{ maxWidth: 1120 }}>
        <PermissionMatrix />
      </section>

      {/* ── mechanisms, and what is public ── */}
      <section id="mechanisms" className="mx-auto px-4 sm:px-6 pb-16 sm:pb-24" style={{ maxWidth: 1120 }}>
        <Head eyebrow="Why you can trust the answer" title="Four mechanisms, each on the request path">
          Plenty of tools promise not to make things up. These are the places the promise is
          replaced by a mechanism, each tagged with the stop on the request path above where it lives.
        </Head>
        <div className="ft-f-mech">
          <div className="ft-f-trust">
            {TRUST.map(({ icon: Icon, title, body }, i) => (
              <Reveal key={title} delay={Math.min(i, 3) * 70} className="ft-f-trust-card ft-lift">
                <span className="ft-f-trust-top">
                  <Icon size={18} aria-hidden="true" />
                  {STOP[title] && <span className="ft-f-stop" title="Stop on the request path">{STOP[title]}</span>}
                </span>
                <h3 className="ft-display">{title}</h3>
                <p>{body}</p>
              </Reveal>
            ))}
          </div>

          <Reveal id="privacy" className="ft-f-public">
            <h3 className="ft-display">This page is public. Your data is not.</h3>
            <p className="ft-f-public-lede">
              These pages describe the product. They make no API call, and every figure on them is
              sample data computed in your browser.
            </p>
            <ul>
              {SECURITY.map(({ icon: Icon, title, body }) => (
                <li key={title}>
                  <Icon size={16} aria-hidden="true" />
                  <div><b>{title}</b><span>{body}</span></div>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* ── the request log and sessions ── */}
      <section className="mx-auto px-4 sm:px-6 pb-14" style={{ maxWidth: 1120 }}>
        <Head eyebrow="Audit and sessions" title="Every request recorded, every session revocable">
          Each request is queued as its response leaves and written by a background worker, so the
          record never slows the page it records. Sessions are rows on the server: every request
          looks its own up, so revoking one refuses the very next request rather than waiting for a
          token to expire.
        </Head>
        <AuditTrailSandbox />
      </section>

      <Closing title="Request access"
               cta={<Link to="/login" className="ft-btn inline-flex items-center justify-center gap-2 rounded-xl font-bold"
                          style={{ minHeight: 52, padding: '0 30px', background: '#fff',
                                   color: 'var(--accent-btn)', textDecoration: 'none', fontSize: '0.975rem' }}>
                      Sign in <ArrowRight size={17} aria-hidden="true" />
                    </Link>}
               next={<Link to="/faq" className="ft-btn inline-flex items-center justify-center gap-2 rounded-xl font-bold"
                           style={{ minHeight: 52, padding: '0 24px', background: 'rgba(255,255,255,0.14)',
                                    border: '1px solid rgba(255,255,255,0.4)', color: '#fff',
                                    textDecoration: 'none', fontSize: '0.95rem' }}>
                        Next: questions <ArrowRight size={15} aria-hidden="true" />
                      </Link>}>
        Sign in with email, Google or Zoho. An administrator approves the account before it can see anything.
      </Closing>
    </PublicLayout>
  )
}
