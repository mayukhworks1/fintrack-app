/**
 * How it works — the mechanism, on its own page.
 *
 * This was the middle third of a landing page that had reached seventeen
 * screens on a phone. It is the part a technical buyer reads closely and
 * everyone else skips, which is exactly the argument for giving it a route:
 * the people who want it can be sent straight here, and the people who do not
 * are no longer scrolling past it to reach the price of admission.
 *
 * Every moving part here moves once and shows a step being taken: the sync
 * cadence draws itself, the three steps join up, a sample record crosses into
 * the mirror, the stack lights the layer being read, and the analyst's work is
 * handed from stage to stage. Nothing loops.
 */
import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { usePageMeta } from '../../hooks/usePageMeta'
import { useReveal } from '../../hooks/useReveal'
import PublicLayout from '../../components/PublicLayout'
import LazyMount from '../../components/motion/LazyMount'
import AnalystPipeline from '../../components/AnalystPipeline'
import StackStory from '../../components/StackStory'
import SyncCadence from '../../components/secondary/SyncCadence'
import { Grain } from '../../components/LandingVisuals'
import { StaysPut } from '../../components/SceneDiagrams'
import { Head, PageHead, Closing, Reveal, Rule } from '../../components/PublicBits'
import ScrollLit from '../../components/ScrollLit'
import { STEPS, APP_LD, crumbs, graph } from '../../content/publicContent'
import '../../styles/public-secondary.css'
import '../../styles/public-secondary-hiw.css'

// Below the fold and the heaviest code on the page: fetched as they approach.
const SyncPipelineSimulator = lazy(() => import('../../components/SyncPipelineSimulator'))

const LD = graph(APP_LD, crumbs([{ name: 'How it works', path: '/how-it-works' }]))

/* The three steps, joined by a line that draws from the first badge to the
   last once the row is reached; the numbers pop in the order they are read. */
function Steps() {
  const ref = useReveal({ threshold: 0.2 })
  return (
    <div ref={ref} className="ft-s-steps" data-hold="">
      <span className="ft-s-steps-line" aria-hidden="true" />
      <ol className="ft-m-seq">
        {STEPS.map(({ icon: Icon, title, body }, i) => (
          <li key={title} style={{ '--i': i }}>
            <div className="ft-lift ft-s-step">
              <span className="ft-s-badge ft-m-pop" style={{ '--d': `${200 + i * 380}ms` }} aria-hidden="true">{i + 1}</span>
              <h3 className="ft-display">
                <Icon size={17} aria-hidden="true" />
                {title}
              </h3>
              <p>{body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

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
        <Grain />
        <PageHead eyebrow="How it works"
                  lines={['Nothing to migrate,', <em key="e">and nothing to take on faith</em>]}
                  aside={<SyncCadence />}>
          The fastest way to lose a finance team is to ask them to move their
          records somewhere new on day one. FinTrack sits on top of what they
          already keep — and shows its working on everything it derives from it.
        </PageHead>
      </section>

      <section className="mx-auto px-4 sm:px-6 pb-16 sm:pb-20" style={{ maxWidth: 1120 }}>
        {/* Spaced off the opening the way every other section is off the
            one before it. */}
        <Head n="01" eyebrow="The shape of it" title="Three steps, and one set of rows underneath"
              className="mt-12 sm:mt-20">
          Records stay where they are, a mirror makes them fast, and questions
          are compiled rather than guessed. Everything else in the product is a
          consequence of those three.
        </Head>

        <Steps />

        <Reveal className="grid gap-8 lg:gap-12 items-center mb-14"
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
        </Reveal>

        {/* The simulator mounts as it approaches, in space held for it, so
            the first render on a phone is the opening and the steps. */}
        <LazyMount className="ft-s-sim-slot mb-14">
          <Suspense fallback={null}><SyncPipelineSimulator /></Suspense>
        </LazyMount>

        <Rule className="mb-14" />
        <Head n="02" eyebrow="One set of rows" title="Walk up the stack">
          Four layers, bottom to top, in the order the data actually moves.
          Scroll the column and the drawing follows.
        </Head>
        {/* In the page from the start: its four headings and paragraphs are
            the section, and the drawing beside them is small. */}
        <StackStory />
      </section>

      <section id="trust" className="mx-auto px-4 sm:px-6 pb-16 sm:pb-24" style={{ maxWidth: 1120 }}>
        <Rule className="mb-14" />
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

        {/* The four mechanism cards that were here are on /security now. They
            are the same kind of claim as the ones already on that page — who
            can reach what, and what enforces it — and this page was 9.5
            screens on a phone, the longest on the site, with 1296px of them
            at the bottom. The narrative above stays: it is the argument, and
            the cards were the appendix to it. */}
        <p className="mt-10">
          <Link to="/security" className="ft-cta-link inline-flex items-center gap-2 font-bold"
                style={{ color: 'var(--accent-ink, var(--accent))', textDecoration: 'none', fontSize: '1rem' }}>
            The four mechanisms behind it, on the security page
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </p>
      </section>

      <Closing title="Walk it yourself in the sandbox"
               cta={<Link to="/#try" className="ft-btn inline-flex items-center justify-center gap-2 rounded-xl font-bold"
                          style={{ minHeight: 52, padding: '0 30px', background: '#fff',
                                   color: 'var(--accent-btn)', textDecoration: 'none', fontSize: '0.975rem' }}>
                      Open the sandbox <ArrowRight size={17} aria-hidden="true" />
                    </Link>}
               next={<Link to="/customise" className="ft-btn inline-flex items-center justify-center gap-2 rounded-xl font-bold"
                           style={{ minHeight: 52, padding: '0 24px', background: 'rgba(255,255,255,0.14)',
                                    border: '1px solid rgba(255,255,255,0.4)', color: '#fff',
                                    textDecoration: 'none', fontSize: '0.95rem' }}>
                       Next: what you can change <ArrowRight size={15} aria-hidden="true" />
                     </Link>}>
        The same records, filters and compiled queries, on sample data in your
        browser. No account needed; signing in is by invitation.
      </Closing>
    </PublicLayout>
  )
}
