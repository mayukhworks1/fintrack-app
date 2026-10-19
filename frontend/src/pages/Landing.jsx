/**
 * The public front door.
 *
 * It does one job: say what this is, let you use it, and point at the page
 * that answers whatever you wanted next. In order: the headline beside one
 * sample record drawn in the four places it appears; the sandbox; four facts
 * about the software; what is new; the film; the screens; the three problems
 * (with the tax slider); the modules; and the three deeper pages.
 *
 * Nothing here reads a workspace. Every client, project and figure is fiction
 * computed in the browser from demoData.js, and no part of this route makes
 * an API call. The sandbox stays a static import inside its own error
 * boundary; the band of new captures and the film are mounted only as they
 * near the viewport, with their space reserved so nothing below them moves.
 */
import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { usePageMeta } from '../hooks/usePageMeta'
import { useTilt } from '../hooks/useTilt'
import { useReveal } from '../hooks/useReveal'
import { useInView } from '../hooks/useInView'
import { useMediaQuery } from '../hooks/useMediaQuery'
import PublicLayout from '../components/PublicLayout'
import DemoWorkspace from '../components/DemoWorkspace'
import ErrorBoundary from '../components/ErrorBoundary'
import { Grain, MiniBars, MiniDocs } from '../components/LandingVisuals'
import {
  GlyphLedger, GlyphMargin, GlyphTaxSplit, GlyphAnalyst,
  GlyphTable, GlyphShare, GlyphBoard, GlyphAudit,
  GlyphLayers, GlyphSwitches, GlyphPermissions,
} from '../components/Glyphs'
import Overstatement from '../components/Overstatement'
import ScreenGallery from '../components/ScreenGallery'
import LazyMount from '../components/motion/LazyMount'
import OneRecord from '../components/home/OneRecord'
import Facts from '../components/home/Facts'
import ShippedBand from '../components/home/ShippedBand'
import { TotalOpens, TaxSplit, QueryShown } from '../components/home/ProblemVisuals'
import { Reveal, Rising, Rule, Head, Card, Grid, Closing } from '../components/PublicBits'
import { MODULES, PROBLEMS, APP_LD, FAQ_LD, graph } from '../content/publicContent'
import '../styles/public-home.css'

const ProductFilm = lazy(() => import('../components/ProductFilm'))

const LD = graph(APP_LD, FAQ_LD)

/* One mark per module, keyed by the module's `visual`. Drawn marks rather
   than screenshots: a preview that has to be recaptured whenever a screen
   changes is a preview that is wrong within a month. */
const CHIP_PEEK = {
  ledger: <GlyphLedger />, margin: <GlyphMargin />, bars: <MiniBars />,
  tax: <GlyphTaxSplit />, analyst: <GlyphAnalyst />, docs: <MiniDocs />,
  table: <GlyphTable />, pages: <GlyphShare mode="stream" />,
  board: <GlyphBoard />, share: <GlyphShare mode="link" />, audit: <GlyphAudit />,
}

/* A picture for each problem card, in PROBLEMS order. */
const PROBLEM_VISUALS = [TotalOpens, TaxSplit, QueryShown]

const READ_ON = [
  ['/how-it-works', 'How it works', GlyphLayers,
   'Your records stay where they are. Then: why an answer here can be checked, stage by stage.'],
  ['/customise', 'Made yours', GlyphSwitches,
   'What you change yourself, what runs on your own cloud, and what gets built for your case.'],
  ['/security', 'Security & access', GlyphPermissions,
   'Who can see what, scoped at the query rather than the screen, with every request recorded.'],
]

/** Lies back until it is reached, then straightens. Chrome, never a data mark. */
function Tilted({ children }) {
  const ref = useReveal({ threshold: 0.08 })
  return <div ref={ref} className="ft-3d">{children}</div>
}

const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

export default function Landing() {
  // Rotation of 0 on both: a primary button that tips as you approach it
  // feels unstable, and the hero must not lean. Only the pointer position
  // these write is wanted — for the CTA's glow and the section's spotlight.
  const heroCta = useTilt({ max: 0 })
  const heroLight = useTilt({ max: 0 })
  // The aurora drifts only while the hero is on screen.
  const [heroView, heroInView] = useInView({ threshold: 0 })
  const wide = useMediaQuery('(min-width: 1100px)')
  const mid = useMediaQuery('(min-width: 640px)')

  usePageMeta({
    title: 'FinTrack — project delivery and project finance on one set of records',
    description:
      'A live delivery board and the money for the same work, in one place. Kanban or list status per project, invoice ageing and collection rate, project margin, GST and TDS kept separate, and an AI analyst that prints the query behind every figure. Try the live sandbox — no account needed.',
    path: '/',
    jsonLd: LD,
  })

  const startTour = (e) => {
    e.preventDefault()
    document.getElementById('try')?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' })
    window.dispatchEvent(new CustomEvent('ft-start-tour'))
  }

  return (
    <PublicLayout>
      {/* ── Hero ────────────────────────────────────────────────────────── */}
      {/* overflow: clip, not hidden. Hidden makes the section a scroll
          container, and the hero's scroll-linked drift would then measure
          its progress against the section instead of the viewport. */}
      <section ref={heroLight} className="ft-h-hero relative" style={{ overflow: 'clip' }}>
        <Grain />
        <div ref={heroView} className={`ft-aurora${heroInView ? '' : ' ft-m-paused'}`} aria-hidden="true">
          <span /><span /><span />
        </div>

        <div className="ft-h-hero-grid relative mx-auto px-4 sm:px-6 pt-9 pb-7 sm:pt-14"
             style={{ maxWidth: 1120, zIndex: 1 }}>
          <Rising className="ft-drift" style={{ maxWidth: 820 }}>
            <span className="ft-h-badge ft-up inline-flex items-center gap-2 rounded-md text-xs font-semibold mb-4 tracking-wide"
                  style={{ padding: '5px 11px', background: 'var(--accent-dim)', color: 'var(--accent-ink, var(--accent))', border: '1px solid var(--card-border)' }}>
              <span className="ft-live-dot" aria-hidden="true" />
              Live sandbox below · sample data
            </span>

            {/* Visible in the first frame: each line settles by a fraction
                of an em, by transform alone, and only when motion is welcome. */}
            {/* The headline's sweep pauses with the aurora when the hero
                is scrolled away. */}
            <h1 className={`ft-display ft-h-title mb-5${heroInView ? '' : ' ft-m-paused'}`}>
              <span className="ft-rise"><span>The delivery and the money,</span></span>
              <span className="ft-rise">
                <span style={{ transitionDelay: '110ms', color: 'var(--accent-ink, var(--accent))' }}>
                  <em className="ft-shine-text">on one set of records</em>.
                </span>
              </span>
            </h1>

            <p className="ft-lede ft-up mb-7" style={{ '--d': '260ms' }}>
              A live board of where every project stands, and the receivables,
              margin and GST for the same work: not two systems somebody
              reconciles on a Friday. Ask it anything in plain words and it
              prints the query behind the answer.
            </p>

            <div className="ft-up flex flex-col sm:flex-row gap-3" style={{ '--d': '380ms' }}>
              <a href="#try" ref={heroCta} onClick={startTour}
                 className="ft-cta ft-magnet flex items-center justify-center gap-2 rounded-xl font-bold cursor-pointer"
                 style={{ minHeight: 52, padding: '0 26px', background: 'var(--accent-btn)',
                          color: 'var(--accent-fg)', textDecoration: 'none', fontSize: '0.975rem',
                          boxShadow: '0 4px 14px var(--accent-glow)' }}>
                Launch Interactive Sandbox <ArrowRight size={17} aria-hidden="true" />
              </a>
              <Link to="/login"
                    className="ft-btn flex items-center justify-center gap-2 rounded-xl font-bold"
                    style={{ minHeight: 52, padding: '0 26px', background: 'var(--card-bg)',
                             border: '1px solid var(--card-border)', color: 'var(--text-1)',
                             textDecoration: 'none', fontSize: '0.975rem' }}>
                Sign in
              </Link>
            </div>

            {mid && !wide && <div className="ft-up mt-5" style={{ '--d': '460ms' }}><OneRecord variant="chips" /></div>}
          </Rising>

          {wide && (
            <div className="ft-h-hero-aside">
              <OneRecord />
            </div>
          )}
        </div>

        {/* ── The sandbox ──────────────────────────────────────────────── */}
        <div id="try" className="relative mx-auto px-4 sm:px-6 pb-12 sm:pb-16"
             style={{ maxWidth: 1120, zIndex: 1 }}>
          {/* Its own boundary: a fault in the sandbox must not take the page down. */}
          <Tilted><ErrorBoundary><DemoWorkspace /></ErrorBoundary></Tilted>
        </div>
      </section>

      {/* Every section below the sandbox is in the page from the start (for
          keyboards, screen readers and find-in-page) but marked ft-m-cv:
          the browser skips laying it out and painting it until it nears the
          screen. --cv-h is the space it holds until then. */}
      {/* ── Facts about the software ───────────────────────────────────── */}
      <section className="ft-m-cv mx-auto px-4 sm:px-6 pb-14 sm:pb-20" style={{ maxWidth: 1120, '--cv-h': '360px' }}
               aria-label="FinTrack in four numbers">
        {/* In the page from the start, so it can be read, searched and
            tabbed to; its figures still count up the first time they are
            scrolled to. */}
        <Facts />
      </section>

      {/* ── New in FinTrack ────────────────────────────────────────────── */}
      <section className="ft-m-cv mx-auto px-4 sm:px-6 pb-14 sm:pb-20" style={{ maxWidth: 1120, '--cv-h': '1000px' }}>
        <Head eyebrow="New in FinTrack" title="Spreadsheets you can publish, and one gateway for AI">
          Pages now edits spreadsheets and publishes them to a client on a
          link; every page reports who opened it; and one gateway decides which
          AI model answers what. Captured from the sample workspace.
        </Head>
        {/* The copy is in the page from the start; the images are lazy and
            the recording's poster waits until it is near. */}
        <ShippedBand />
      </section>

      {/* ── The film ────────────────────────────────────────────────────
          The sandbox proves the thing works by letting you drive it; the
          film says what it is for in the time someone will give a page they
          have just landed on. */}
      <section className="ft-m-cv mx-auto px-4 sm:px-6 pb-14 sm:pb-20" style={{ maxWidth: 1120, '--cv-h': '1000px' }}>
        <Head eyebrow="The film" title="Half a minute of the product">
          Recorded in the sample workspace. Watch it, or read the same ground
          as a walkthrough built from the sandbox&rsquo;s own figures.
        </Head>
        {/* The section sits on the page grid like every other; only the film
            itself is held to 940px. */}
        <LazyMount className="ft-h-lazy-film" style={{ maxWidth: 940 }}>
          <Suspense fallback={null}><ProductFilm /></Suspense>
        </LazyMount>
      </section>

      {/* ── Every screen ────────────────────────────────────────────────
          Real captures of the product, from the same sample workspace the
          sandbox runs on: what it looks like before anyone signs in. */}
      <section className="ft-m-cv mx-auto px-4 sm:px-6 pb-14 sm:pb-20" style={{ maxWidth: 1120, '--cv-h': '640px' }}>
        <Head eyebrow="Every screen" title="See it before you sign in">
          The screens your team works in, on sample data. Pick a group, swipe
          through, or open one to look closer.
        </Head>
        <Reveal><ScreenGallery /></Reveal>
      </section>

      {/* ── The problem ─────────────────────────────────────────────────── */}
      <section className="ft-m-cv mx-auto px-4 sm:px-6 pb-14 sm:pb-20" style={{ maxWidth: 1120, '--cv-h': '1500px' }}>
        <Head n="01" eyebrow="Why this exists"
              title="Three things go wrong when delivery and money live apart">
          None of them are exotic. They are what happens when the board, the
          ledger and the tax position live in different places and nobody owns
          the reconciliation between them.
        </Head>
        <div className="mb-10">
          <Grid min={280}>
            {PROBLEMS.map(({ icon, title, body }, i) => (
              <Card key={title} icon={icon} title={title} body={body}
                    visual={PROBLEM_VISUALS[i]} delay={Math.min(i, 3) * 70} />
            ))}
          </Grid>
        </div>

        {/* The second of those three, at the reader's own numbers. */}
        <Overstatement />
      </section>

      {/* ── Modules, named and nothing more ──────────────────────────────
          The full cards live on /features. Here they are a contents page:
          what ships, at a glance, and one link to the detail. */}
      <section className="ft-m-cv mx-auto px-4 sm:px-6 pb-16 sm:pb-24" style={{ maxWidth: 1120, '--cv-h': '620px' }}>
        <Head n="02" eyebrow="What is inside" title="Eleven modules, one source of truth">
          Records live in one place and every module reads the same rows, so a
          number on the dashboard and a number in a report cannot disagree.
          Every total opens to the invoices underneath it.
        </Head>

        <Reveal className="ft-h-modules grid gap-2">
          {MODULES.map(({ icon: Icon, title, points, visual }) => (
            <Link key={title} to="/features"
                  className="ft-chip ft-chip-peek flex items-start gap-2.5 rounded-xl px-3 py-3"
                  style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)',
                           textDecoration: 'none' }}>
              {/* Pointing at a name, or focusing it, shows the mark that
                  module carries elsewhere on the site. */}
              <span className="peek" aria-hidden="true">
                <span className="flex items-center justify-center" style={{ minHeight: 56 }}>
                  {CHIP_PEEK[visual]}
                </span>
                <span className="block mt-1.5 pt-1.5 font-bold"
                      style={{ fontSize: 11, color: 'var(--text-3)',
                               borderTop: '1px solid var(--card-border)' }}>
                  {title}
                </span>
              </span>
              <Icon size={16} aria-hidden="true" style={{ color: 'var(--accent-ink, var(--accent))', flexShrink: 0, marginTop: 2 }} />
              <span className="min-w-0">
                <span className="block font-bold" style={{ fontSize: 13.5, color: 'var(--text-1)' }}>
                  {title}
                </span>
                {/* Two lines, whole words: a line cut mid-word with an
                    ellipsis reads as unfinished. */}
                <span className="ft-chip-bullet ft-h-module-point" style={{ color: 'var(--text-3)' }}>
                  {points[0]}
                </span>
              </span>
            </Link>
          ))}
          {/* Eleven modules leave the twelfth cell of the grid for the way on. */}
          <Link to="/features" className="ft-chip ft-h-modules-all rounded-xl px-3 py-3">
            Take each one in turn <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </Reveal>
      </section>

      {/* ── Where to go next ───────────────────────────────────────────── */}
      <section className="ft-m-cv mx-auto px-4 sm:px-6 pb-16 sm:pb-24" style={{ maxWidth: 1120, '--cv-h': '700px' }}>
        <Rule className="mb-14" />
        <Head n="03" eyebrow="Read on" title="The rest of it, in three pages">
          How the records get here, what you can change, and who can see what.
        </Head>
        <Grid min={260}>
          {READ_ON.map(([to, title, Glyph, blurb], i) => (
            <Reveal key={to} delay={Math.min(i, 3) * 70} className="h-full">
              <Link to={to} className="ft-chip flex flex-col h-full rounded-2xl p-5 sm:p-6"
                    style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)',
                             textDecoration: 'none' }}>
                <span className="ft-h-readon-glyph ft-h-wipe-box" aria-hidden="true"
                      style={{ '--d': `${120 + i * 90}ms` }}>
                  <Glyph />
                </span>
                <h3 className="ft-display mb-2" style={{ fontSize: '1.14rem', color: 'var(--text-1)' }}>
                  {title}
                </h3>
                <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--text-2)' }}>{blurb}</p>
                <span className="mt-auto inline-flex items-center gap-1.5 font-bold"
                      style={{ fontSize: 13, color: 'var(--accent-ink, var(--accent))' }}>
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
                          className="ft-btn inline-flex items-center justify-center gap-2 rounded-xl font-bold"
                          style={{ minHeight: 52, padding: '0 30px', background: '#fff',
                                   color: 'var(--accent-btn)', textDecoration: 'none',
                                   fontSize: '0.975rem' }}>
                      Sign in <ArrowRight size={17} aria-hidden="true" />
                    </Link>}
               next={<Link to="/faq"
                           className="ft-btn inline-flex items-center justify-center gap-2 rounded-xl font-bold"
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
