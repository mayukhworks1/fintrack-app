/**
 * How it works — the mechanism, on its own page.
 *
 * This was the middle third of a landing page that had reached seventeen
 * screens on a phone. It is the part a technical buyer reads closely and
 * everyone else skips, which is exactly the argument for giving it a route:
 * the people who want it can be sent straight here, and the people who do not
 * are no longer scrolling past it to reach the price of admission.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Maximize2, X, Sparkles } from 'lucide-react'
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
  const [lightboxOpen, setLightboxOpen] = useState(false)

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

        {/* ── 3D Isometric Architecture Callout ──────────────────────────── */}
        <Reveal className="mb-14">
          <div className="relative rounded-3xl overflow-hidden p-6 sm:p-8 lg:p-10 border transition-all"
               style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', boxShadow: 'var(--card-shadow)' }}>
            <div className="flex flex-col lg:flex-row items-center justify-between gap-8">
              <div className="lg:w-7/12">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold mb-3"
                      style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                  <Sparkles size={12} />
                  3D Single-Ledger Pipeline
                </span>
                <h3 className="ft-display text-xl sm:text-2xl mb-2" style={{ color: 'var(--text-1)' }}>
                  Zero database drift by construction
                </h3>
                <p className="text-sm leading-relaxed mb-6" style={{ color: 'var(--text-2)' }}>
                  Every query executed by the AI Analyst or the reporting engine touches the exact same Postgres mirror rows. Tax liabilities, TDS certificates, and milestone statuses remain synchronized without manual reconciliation.
                </p>
                <button
                  onClick={() => setLightboxOpen(true)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
                  style={{ background: 'var(--accent)', color: '#fff' }}
                >
                  <Maximize2 size={13} /> Inspect 3D Blueprint
                </button>
              </div>

              <div
                className="lg:w-5/12 w-full flex items-center justify-center cursor-pointer group"
                onClick={() => setLightboxOpen(true)}
              >
                <div className="relative max-w-[260px] sm:max-w-[280px] rounded-2xl overflow-hidden shadow-xl border transition-transform duration-300 group-hover:scale-105"
                     style={{ borderColor: 'var(--card-border)', background: 'var(--bg-base)' }}>
                  <img
                    src="/media/pomelli_photoshoot-1.png"
                    alt="3D Architecture Pipeline"
                    className="w-full h-auto object-cover"
                  />
                </div>
              </div>
            </div>
          </div>
        </Reveal>

        <hr className="ft-rule mb-14" />
        <Head n="02" eyebrow="One set of rows" title="Walk up the stack">
          Four layers, bottom to top, in the order the data actually moves.
          Scroll the column and the drawing follows.
        </Head>
        <StackStory />
      </section>

      {lightboxOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md"
          onClick={() => setLightboxOpen(false)}
        >
          <div
            className="relative max-w-5xl w-full max-h-[90vh] flex flex-col rounded-2xl overflow-hidden bg-slate-900 border border-slate-700 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-slate-950">
              <span className="text-xs font-bold text-slate-200">
                FinTrack Single-Ledger 3D Architecture Blueprint
              </span>
              <button
                onClick={() => setLightboxOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 overflow-auto flex items-center justify-center">
              <img
                src="/media/pomelli_photoshoot-1.png"
                alt="3D Architecture Pipeline"
                className="max-h-[75vh] object-contain rounded-lg"
              />
            </div>
          </div>
        </div>
      )}

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
