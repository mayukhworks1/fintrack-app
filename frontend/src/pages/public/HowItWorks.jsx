/**
 * How it works — the mechanism, on its own page.
 *
 * This was the middle third of a landing page that had reached seventeen
 * screens on a phone. It is the part a technical buyer reads closely and
 * everyone else skips, which is exactly the argument for giving it a route:
 * the people who want it can be sent straight here, and the people who do not
 * are no longer scrolling past it to reach the price of admission.
 */
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { usePageMeta } from '../../hooks/usePageMeta'
import PublicLayout from '../../components/PublicLayout'
import AnalystPipeline from '../../components/AnalystPipeline'
import StackStory from '../../components/StackStory'
import { Grain } from '../../components/LandingVisuals'
import { StaysPut, CitedAnswer, PermissionRows, OneBuildTwoHomes } from '../../components/SceneDiagrams'
import { Head, PageHead, Card, Grid, Closing, Reveal } from '../../components/PublicBits'
import ScrollLit from '../../components/ScrollLit'
import { TRUST, STEPS, APP_LD, crumbs, graph } from '../../content/publicContent'

const LD = graph(APP_LD, crumbs([{ name: 'How it works', path: '/how-it-works' }]))

export default function HowItWorks() {
  usePageMeta({
    title: 'How FinTrack works — nothing to migrate, and every answer checkable',
    description:
      'Your records stay in the base you already use; a Postgres mirror keeps lists instant. The AI analyst picks a measure and a grouping from a fixed list and the application compiles the SQL — so every figure arrives with the query that produced it.',
    path: '/how-it-works',
    jsonLd: LD,
  })

  return (
    <PublicLayout>
      <section className="relative overflow-hidden">
        <div className="ft-aurora" aria-hidden="true"><span /><span /></div>
        <div className="ft-dotgrid" aria-hidden="true" />
        <Grain />
        <PageHead eyebrow="How it works"
                  lines={['Nothing to migrate,', <em key="e">and nothing to take on faith</em>]}>
          The fastest way to lose a finance team is to ask them to move their
          records somewhere new on day one. FinTrack sits on top of what they
          already keep — and shows its working on everything it derives from it.
        </PageHead>
      </section>

      <section className="mx-auto px-4 sm:px-6 pb-16 sm:pb-20" style={{ maxWidth: 1120 }}>
        <Head n="01" eyebrow="The shape of it" title="Three steps, and one set of rows underneath">
          Records stay where they are, a mirror makes them fast, and questions
          are compiled rather than guessed. Everything else in the product is a
          consequence of those three.
        </Head>

        <ol className="relative grid gap-4 sm:gap-5 m-0 p-0 mb-14"
            style={{ listStyle: 'none',
                     gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))' }}>
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="relative rounded-2xl p-5 sm:p-6"
                style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
              <div className="flex items-center gap-3 mb-3">
                <span className="flex items-center justify-center rounded-lg font-bold text-sm"
                      style={{ width: 30, height: 30, background: 'var(--accent-dim)', color: 'var(--accent)' }}
                      aria-hidden="true">{i + 1}</span>
                <Icon size={17} aria-hidden="true" style={{ color: 'var(--text-3)' }} />
              </div>
              <h3 className="ft-display text-lg mb-2" style={{ color: 'var(--text-1)' }}>{title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{body}</p>
              {i < STEPS.length - 1 && (
                <span aria-hidden="true" className="hidden lg:block"
                      style={{ position: 'absolute', right: -14, top: '50%', width: 12, height: 6 }}>
                  <span className="ft-travel" style={{
                    display: 'block', width: 6, height: 6, borderRadius: 99,
                    background: 'var(--accent)', ['--ft-travel-to']: '14px',
                    animationDelay: `${i * 700}ms`,
                  }} />
                </span>
              )}
            </li>
          ))}
        </ol>

        <div className="grid gap-8 lg:gap-12 items-center mb-14"
             style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
          <div><StaysPut /></div>
          <div>
            <h3 className="ft-display mb-2" style={{ fontSize: '1.3rem', color: 'var(--text-1)' }}>
              One direction, on purpose
            </h3>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
              The base your team already works in stays the system of record, and
              the mirror is fed from it. Nothing is moved out, nothing is
              migrated, and there is no second place for someone to update
              instead — which is the failure mode of every finance tool that
              asks you to import first and reconcile later.
            </p>
          </div>
        </div>

        <hr className="ft-rule mb-14" />
        <Head n="02" eyebrow="One set of rows" title="Walk up the stack">
          Four layers, bottom to top, in the order the data actually moves.
          Scroll the column and the drawing follows.
        </Head>
        <StackStory />
      </section>

      <section id="trust" className="mx-auto px-4 sm:px-6 pb-16 sm:pb-24" style={{ maxWidth: 1120 }}>
        <hr className="ft-rule mb-14" />
        <Head n="03" eyebrow="Why you can trust the answer"
              title="Checkable by construction, not by policy">
          Plenty of tools promise not to make things up. This is where the
          promise is replaced by a mechanism — you can see exactly where the
          model's authority stops, and it stops two steps before the number.
        </Head>

        <AnalystPipeline />

        {/* The one sentence on the site that lights word by word. It works
            because it is the only one — a page where every paragraph does
            this is a page you have to wait to read. */}
        <ScrollLit className="mt-6 mb-12 sm:mb-16"
                   style={{ fontSize: 'clamp(1.05rem, 2.1vw, 1.32rem)', lineHeight: 1.62,
                            maxWidth: 760, fontFamily: "'Fraunces', Georgia, serif",
                            letterSpacing: '-0.008em' }}>
          The model's entire output is two values, each chosen from a closed list. There is no route from a sentence to arbitrary SQL — which is also why the analyst cannot be talked into reading rows your account may not see. Scoping is applied when the statement is assembled, below the point where anything the model said still counts.
        </ScrollLit>

        <Grid>
          {TRUST.map(({ icon, title, body }, i) => (
            <Card key={title} icon={icon} title={title} body={body}
                  visual={[undefined, PermissionRows, CitedAnswer, undefined][i]}
                  delay={Math.min(i, 3) * 70} />
          ))}
        </Grid>
      </section>

      <Closing title="See it on your own numbers"
               cta={<Link to="/login" className="inline-flex items-center justify-center gap-2 rounded-xl font-bold"
                          style={{ minHeight: 52, padding: '0 30px', background: '#fff',
                                   color: 'var(--accent-btn)', textDecoration: 'none', fontSize: '0.975rem' }}>
                      Sign in <ArrowRight size={17} aria-hidden="true" />
                    </Link>}
               next={<Link to="/customise" className="inline-flex items-center justify-center gap-2 rounded-xl font-bold"
                           style={{ minHeight: 52, padding: '0 24px', background: 'rgba(255,255,255,0.14)',
                                    border: '1px solid rgba(255,255,255,0.4)', color: '#fff',
                                    textDecoration: 'none', fontSize: '0.95rem' }}>
                       Next: what you can change <ArrowRight size={15} aria-hidden="true" />
                     </Link>}>
        Access is by invitation — an administrator approves each account.
      </Closing>
    </PublicLayout>
  )
}
