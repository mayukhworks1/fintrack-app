/**
 * The public front door.
 *
 * It used to be the whole site — seventeen screens on a phone, carrying the
 * modules, the mechanism, the configuration story and the FAQ. Everything
 * below the fold was competing with everything else below the fold, and the
 * thing most worth reaching was the thing furthest from the top.
 *
 * It now does one job: say what this is, let you use it, and point at the page
 * that answers whatever you wanted next. Depth lives on its own routes, and
 * the navigation says what each of them holds.
 *
 * The rule the whole site is built around is negative. Nothing here reads a
 * workspace. Every client, project and figure is fiction computed in the
 * browser from demoData.js, and no part of this route makes an API call.
 */
import { Link } from 'react-router-dom'
import { ArrowRight, Sparkles, Check } from 'lucide-react'
import { usePageMeta } from '../hooks/usePageMeta'
import PublicLayout from '../components/PublicLayout'
import DemoWorkspace from '../components/DemoWorkspace'
import { useTilt } from '../hooks/useTilt'
import { useReveal } from '../hooks/useReveal'
import { Grain, CountUp, MiniBars, MiniLine, MiniDonut, MiniDocs } from '../components/LandingVisuals'
import Overstatement from '../components/Overstatement'
import ScrollLit from '../components/ScrollLit'
import { Reveal, Rising, Head, Card, Grid, Closing } from '../components/PublicBits'
import {
  MODULES, PROBLEMS, APP_LD, FAQ_LD, graph,
} from '../content/publicContent'

const LD = graph(APP_LD, FAQ_LD)

/* One mark per module chip, cycled. Drawn marks rather than screenshots:
   a preview that has to be recaptured whenever a screen changes is a
   preview that is wrong within a month. */
const CHIP_PEEK = [
  <MiniBars key="a" />, <MiniDonut key="b" pct={68} />, <MiniLine key="c" />, <MiniDocs key="d" />,
]

/** Lies back until it is reached, then straightens. Chrome, never a data mark. */
function Tilted({ children }) {
  const ref = useReveal({ threshold: 0.08 })
  return <div ref={ref} className="ft-3d">{children}</div>
}

export default function Landing() {
  // Rotation of 0 on both: a primary button that tips as you approach it
  // feels unstable, and the hero must not lean. Only the pointer position
  // these write is wanted — for the CTA's glow and the section's spotlight.
  const heroCta = useTilt({ max: 0 })
  const heroLight = useTilt({ max: 0 })

  usePageMeta({
    title: 'FinTrack — receivables, project profit and an AI analyst that shows its working',
    description:
      'Finance software for businesses that bill by project. Invoice ageing, collection rate, project margin, GST and TDS kept separate, and an AI analyst that prints the query behind every figure. Try the live sandbox — no account needed.',
    path: '/',
    jsonLd: LD,
  })

  return (
    <PublicLayout>
      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section ref={heroLight} className="relative overflow-hidden">
        <div className="ft-aurora" aria-hidden="true"><span /><span /></div>
        <div className="ft-dotgrid" aria-hidden="true" />
        <div className="ft-spotlight" aria-hidden="true" />
        <Grain />

        <div className="relative mx-auto px-4 sm:px-6 pt-9 pb-7 sm:pt-14"
             style={{ maxWidth: 1120, zIndex: 1 }}>
          <Rising style={{ maxWidth: 820 }}>
            <span className="inline-flex items-center gap-2 rounded-full text-xs font-semibold mb-4"
                  style={{ padding: '6px 12px', background: 'var(--accent-dim)', color: 'var(--accent)' }}>
              <Sparkles size={13} aria-hidden="true" />
              Receivables, projects and an analyst that shows its working
            </span>

            {/* Two lines, each rising out of its own mask on a stagger. A
                headline that assembles reads as composed; the same words
                fading in as one block read as loaded. */}
            <h1 className="ft-display mb-5"
                style={{ fontSize: 'clamp(2.05rem, 6.2vw, 3.9rem)', lineHeight: 1.04,
                         letterSpacing: '-0.03em' }}>
              <span className="ft-rise"><span>Finance software that</span></span>
              <span className="ft-rise">
                <span style={{ transitionDelay: '110ms', color: 'var(--accent)' }}>
                  <em>shows its working</em>.
                </span>
              </span>
            </h1>

            <p className="ft-lede mb-7">
              Receivables, project profitability and GST for businesses that bill
              by project — and an analyst that answers in plain words while
              printing the query behind every figure. You never take a number on
              faith.
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <a href="#try" ref={heroCta}
                 className="ft-cta ft-magnet flex items-center justify-center gap-2 rounded-xl font-bold"
                 style={{ minHeight: 52, padding: '0 26px', background: 'var(--accent-btn)',
                          color: '#fff', textDecoration: 'none', fontSize: '0.975rem',
                          boxShadow: '0 6px 20px var(--accent-glow)' }}>
                Try it — no account needed <ArrowRight size={17} aria-hidden="true" />
              </a>
              <Link to="/login"
                    className="flex items-center justify-center gap-2 rounded-xl font-bold"
                    style={{ minHeight: 52, padding: '0 26px', background: 'var(--card-bg)',
                             border: '1px solid var(--card-border)', color: 'var(--text-1)',
                             textDecoration: 'none', fontSize: '0.975rem' }}>
                Sign in
              </Link>
            </div>
          </Rising>
        </div>

        {/* ── The sandbox ──────────────────────────────────────────────── */}
        <div id="try" className="relative mx-auto px-4 sm:px-6 pb-12 sm:pb-16"
             style={{ maxWidth: 1120, zIndex: 1 }}>
          <Tilted><DemoWorkspace /></Tilted>
        </div>
      </section>

      {/* ── Counts ──────────────────────────────────────────────────────
          Product facts — how many modules, how many roles — not workspace
          figures. They describe the software, so they are safe to show. */}
      <section className="mx-auto px-4 sm:px-6 pb-14 sm:pb-20" style={{ maxWidth: 1120 }}>
        <Reveal className="grid gap-4 sm:gap-5"
                style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(50% - 0.5rem, 200px), 1fr))' }}>
          {[
            ['Modules', 11, '', 'receivables to audit'],
            ['Permission roles', 8, '', 'each override-able per person'],
            ['Sync latency', 30, 's', 'incremental, plus webhooks'],
            ['Answers with the query shown', 100, '%', 'no exceptions'],
          ].map(([label, value, suffix, sub]) => (
            <div key={label} className="rounded-2xl p-4 sm:p-5"
                 style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
              <p className="font-extrabold tracking-tight"
                 style={{ fontSize: 'clamp(1.6rem, 4vw, 2.3rem)', color: 'var(--accent)',
                          letterSpacing: '-0.02em' }}>
                <CountUp to={value} suffix={suffix} />
              </p>
              <p className="text-xs font-semibold mt-1" style={{ color: 'var(--text-1)' }}>{label}</p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>{sub}</p>
            </div>
          ))}
        </Reveal>
      </section>

      {/* ── The problem ─────────────────────────────────────────────────── */}
      <section className="mx-auto px-4 sm:px-6 pb-14 sm:pb-20" style={{ maxWidth: 1120 }}>
        <Head n="01" eyebrow="Why this exists"
              title="Three things go wrong with money on projects">
          None of them are exotic. They are what happens when the ledger, the
          project plan and the tax position live in different places and nobody
          owns the reconciliation.
        </Head>
        <Grid min={280} className="mb-10">
          {PROBLEMS.map(({ icon, title, body }, i) => (
            <Card key={title} icon={icon} title={title} body={body} delay={Math.min(i, 3) * 70} />
          ))}
        </Grid>

        {/* The second of those three, at the reader's own numbers. Stated in
            prose it lands as a technicality; with a figure they chose
            themselves it lands as money. */}
        <Overstatement />
      </section>

      {/* ── Modules, named and nothing more ──────────────────────────────
          The full cards live on /features, where there is room to say what
          each one does. Here they are a contents page: what ships, at a
          glance, and one link to the detail. */}
      <section className="mx-auto px-4 sm:px-6 pb-16 sm:pb-24" style={{ maxWidth: 1120 }}>
        <Head n="02" eyebrow="What is inside" title="Eleven modules, one source of truth">
          Records live in one place and every module reads the same rows, so a
          number on the dashboard and a number in a report cannot disagree.
          Every total opens to the invoices underneath it.
        </Head>

        <Reveal className="grid gap-2 mb-7"
                style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 216px), 1fr))' }}>
          {MODULES.map(({ icon: Icon, title, points }, i) => (
            <Link key={title} to="/features"
                  className="ft-chip ft-chip-peek flex items-start gap-2.5 rounded-xl px-3 py-3"
                  style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)',
                           textDecoration: 'none' }}>
              {/* Pointing at a name shows the mark that module carries
                  elsewhere on the site. Eleven names in a grid was the
                  flattest block on the page. */}
              <span className="peek" aria-hidden="true">
                <span className="flex items-center justify-center" style={{ minHeight: 56 }}>
                  {CHIP_PEEK[i % CHIP_PEEK.length]}
                </span>
                <span className="block mt-1.5 pt-1.5 font-bold"
                      style={{ fontSize: 11, color: 'var(--text-3)',
                               borderTop: '1px solid var(--card-border)' }}>
                  {title}
                </span>
              </span>
              <Icon size={16} aria-hidden="true" style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
              <span className="min-w-0">
                <span className="block font-bold" style={{ fontSize: 13.5, color: 'var(--text-1)' }}>
                  {title}
                </span>
                <span className="block truncate" style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                  {points[0]}
                </span>
              </span>
            </Link>
          ))}
        </Reveal>

        <Reveal>
          <Link to="/features"
                className="inline-flex items-center gap-2 rounded-xl font-bold"
                style={{ minHeight: 46, padding: '0 20px', background: 'var(--card-bg)',
                         border: '1px solid var(--card-border)', color: 'var(--text-1)',
                         textDecoration: 'none', fontSize: '0.93rem' }}>
            Take each one in turn <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </Reveal>
      </section>

      {/* ── Where to go next ─────────────────────────────────────────────
          A short page only works if it hands you somewhere. */}
      <section className="mx-auto px-4 sm:px-6 pb-16 sm:pb-24" style={{ maxWidth: 1120 }}>
        <hr className="ft-rule mb-14" />
        <Head n="03" eyebrow="Read on" title="The rest of it, in three pages">
          Split up rather than stacked, because a page that takes seventeen
          screens on a phone is a page nobody finishes.
        </Head>
        <Grid min={260}>
          {[
            ['/how-it-works', 'How it works',
             'Your records stay where they are. Then: why an answer here can be checked, stage by stage.'],
            ['/customise', 'Made yours',
             'What you change yourself, what runs on your own cloud, and what gets built for your case.'],
            ['/security', 'Security & access',
             'Who can see what, scoped at the query rather than the screen, with every request recorded.'],
          ].map(([to, title, blurb], i) => (
            <Reveal key={to} delay={Math.min(i, 3) * 70} className="h-full">
              <Link to={to} className="ft-chip flex flex-col h-full rounded-2xl p-5 sm:p-6"
                    style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)',
                             textDecoration: 'none' }}>
                <h3 className="ft-display mb-2" style={{ fontSize: '1.14rem', color: 'var(--text-1)' }}>
                  {title}
                </h3>
                <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--text-2)' }}>{blurb}</p>
                <span className="mt-auto inline-flex items-center gap-1.5 font-bold"
                      style={{ fontSize: 13, color: 'var(--accent)' }}>
                  Read it <ArrowRight size={14} aria-hidden="true" />
                </span>
              </Link>
            </Reveal>
          ))}
        </Grid>
      </section>

      {/* ── Close ───────────────────────────────────────────────────────── */}
      <Closing title="Already have an account?"
               cta={<Link to="/login"
                          className="inline-flex items-center justify-center gap-2 rounded-xl font-bold"
                          style={{ minHeight: 52, padding: '0 30px', background: '#fff',
                                   color: 'var(--accent-btn)', textDecoration: 'none',
                                   fontSize: '0.975rem' }}>
                      Sign in <ArrowRight size={17} aria-hidden="true" />
                    </Link>}
               next={<Link to="/faq"
                           className="inline-flex items-center justify-center gap-2 rounded-xl font-bold"
                           style={{ minHeight: 52, padding: '0 24px', background: 'rgba(255,255,255,0.14)',
                                    border: '1px solid rgba(255,255,255,0.4)', color: '#fff',
                                    textDecoration: 'none', fontSize: '0.95rem' }}>
                       Questions <ArrowRight size={15} aria-hidden="true" />
                     </Link>}>
        Sign in with email, Google or Zoho. New accounts are approved by an
        administrator before they can see anything.
      </Closing>
    </PublicLayout>
  )
}
