/**
 * The public front door.
 *
 * Until now an unauthenticated visitor hit the login form and nothing else —
 * there was no way to find out what this product does without an account. This
 * page explains the modules and stops there: it describes capability, and never
 * renders a figure, a client, a project or an invoice. Every number below is a
 * label, not data.
 *
 * Built mobile-first because that is where it has most often been wrong: a
 * single column by default, grids that opt into more, no fixed widths, and
 * touch targets that clear 44px.
 */
import { Link } from 'react-router-dom'
import {
  ArrowRight, Receipt, FolderKanban, BarChart3, Sparkles, Globe, Activity,
  ShieldCheck, Share2, Lock, Database, Zap, Check, FileSearch,
} from 'lucide-react'
import { usePageMeta } from '../hooks/usePageMeta'
import PublicLayout from '../components/PublicLayout'
import { useTilt } from '../hooks/useTilt'
import { useReveal } from '../hooks/useReveal'
import {
  Grain, MiniBars, MiniLine, MiniDonut, MiniDocs, AnalystDemo, CountUp,
} from '../components/LandingVisuals'

// Every entry names something that actually ships. A landing page that
// describes features the product does not have is the fastest way to lose the
// trust the rest of it is trying to earn.
const MODULES = [
  {
    icon: Receipt, span: 'span-3', visual: 'bars',
    title: 'Receivables',
    body: 'Invoices with aging bands, collection rate, and GST and TDS tracked separately — because tax withheld at source is not money a client still owes you.',
    points: ['Aging buckets', 'Collection pressure', 'Follow-up tracking'],
  },
  {
    icon: FolderKanban, span: 'span-3', visual: 'donut',
    title: 'Projects',
    body: 'Billing, cost and realised profit per project, with margin and health surfaced before a job quietly goes underwater.',
    points: ['Profit and margin', 'Health signals', 'Client rollups'],
  },
  {
    icon: BarChart3, span: 'span-2', visual: 'line',
    title: 'Analytics',
    body: 'Trends across clients, months and categories, with the underlying rows one click away rather than locked behind a chart.',
    points: ['Monthly trends', 'Client breakdowns', 'CSV export'],
  },
  {
    icon: FileSearch, span: 'span-4', visual: 'docs',
    title: 'Studio — documents',
    body: 'Upload contracts and notes, then ask questions about them. Every answer carries numbered citations you can open to the exact page it came from.',
    points: ['PDF, text, CSV, JSON', 'Page-level citations', 'Answers checked against sources'],
  },
  {
    icon: Sparkles, span: 'span-6', visual: 'demo',
    title: 'Studio — finance data',
    body: 'Ask your invoices and projects a question in plain words. The compiled SQL is shown with every answer, so a figure about money can always be checked.',
    points: ['Plain-language questions', 'The query is always visible', 'Charts and tables'],
  },
  {
    icon: Globe, span: 'span-3',
    title: 'Pages',
    body: 'Describe a page and watch it get written, then publish it on a slug — optionally password-protected, optionally set to expire.',
    points: ['Streamed as it writes', 'Surgical revisions', 'Password and expiry'],
  },
  {
    icon: Activity, span: 'span-3',
    title: 'Status board',
    body: 'A live view of where every client project stands, kept current by webhooks rather than by someone remembering to update a sheet.',
    points: ['Per-client status', 'Attachments', 'Near-real-time'],
  },
  {
    icon: Share2, span: 'span-6',
    title: 'Shared views',
    body: 'Send a filtered, read-only view to a client on a link, and see what they actually opened.',
    points: ['Read-only links', 'Column highlighting', 'View analytics'],
  },
]

const SECURITY = [
  { icon: Lock,        title: 'Nothing on this page is your data',
    body: 'Everything above describes what the product does. Figures, clients, projects and documents live behind sign-in and are never rendered publicly.' },
  { icon: ShieldCheck, title: 'Permissions down to the action',
    body: 'Roles carry defaults and any individual permission can be granted or revoked per person. A change takes effect on the next request, not the next login.' },
  { icon: Database,    title: 'Scoped at the query, not the screen',
    body: 'Row scoping is applied when the query is built, from the session — so a narrower account cannot reach wider data by changing what it asks for.' },
  { icon: Zap,         title: 'Every request is recorded',
    body: 'Who, what, when and from where, written asynchronously so the audit trail never slows down the thing it is auditing.' },
]

/** Wraps a block so it animates in the first time it is scrolled to. */
function Reveal({ children, delay = 0, className = '', ...rest }) {
  const ref = useReveal()
  return (
    <div ref={ref} className={`ft-reveal ${className}`}
         style={{ transitionDelay: `${delay}ms` }} {...rest}>
      {children}
    </div>
  )
}

/**
 * The hero's product mockup.
 *
 * Deliberately invented numbers on an invented client list. It has to look
 * like the product without being the product — this page is public, so
 * nothing here may come from a workspace. The figures are static strings; the
 * only thing that moves is the reveal.
 */
function ProductMockup() {
  const ref = useReveal({ threshold: 0.05 })
  const bars = [
    { label: 'Paid',    pct: 100, tone: '#104281' },
    { label: '0-30d',   pct: 62,  tone: '#256abf' },
    { label: '31-60d',  pct: 38,  tone: '#3987e5' },
    { label: '60d+',    pct: 21,  tone: '#86b6ef' },
  ]
  return (
    <div ref={ref} className="ft-reveal ft-float" aria-hidden="true">
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: 'var(--card-bg)',
          border: '1px solid var(--card-border)',
          boxShadow: '0 24px 60px rgba(15,23,42,0.16), 0 4px 14px rgba(15,23,42,0.08)',
        }}
      >
        {/* window chrome */}
        <div className="flex items-center gap-1.5 px-4"
             style={{ height: 38, borderBottom: '1px solid var(--card-border)', background: 'var(--bg-input)' }}>
          {['#ef4444', '#fbbf24', '#22c55e'].map(c => (
            <span key={c} style={{ width: 9, height: 9, borderRadius: 99, background: c, opacity: 0.75 }} />
          ))}
          <span className="ml-2 text-[10px] font-semibold" style={{ color: 'var(--text-3)' }}>
            Receivables
          </span>
        </div>

        <div className="p-4 sm:p-5">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em]"
                  style={{ color: 'var(--text-3)' }}>Outstanding</span>
            <span className="text-[10px] font-semibold" style={{ color: 'var(--accent)' }}>Live</span>
          </div>
          <p className="font-extrabold tabular-nums mb-4"
             style={{ fontSize: 'clamp(1.7rem, 5vw, 2.4rem)', letterSpacing: '-0.02em', color: 'var(--text-1)' }}>
            ₹2,16,000
          </p>

          <div className="flex flex-col gap-2.5">
            {bars.map((b, i) => (
              <div key={b.label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold" style={{ color: 'var(--text-2)' }}>{b.label}</span>
                  <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-3)' }}>{b.pct}%</span>
                </div>
                <div style={{ height: 7, borderRadius: 4, background: 'var(--bg-input)', overflow: 'hidden' }}>
                  <div
                    className="ft-bar"
                    style={{
                      height: '100%', width: `${b.pct}%`, borderRadius: 4,
                      background: b.tone, transitionDelay: `${320 + i * 110}ms`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-3 flex items-center gap-2"
               style={{ borderTop: '1px solid var(--card-border)' }}>
            <Sparkles size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <span className="text-[11px]" style={{ color: 'var(--text-2)' }}>
              “Which clients are slowest to pay?”
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

const MARQUEE = [
  'Aging buckets', 'GST & TDS split', 'Cited answers', 'Natural-language queries',
  'Row-level scoping', 'Audit trail', 'Shared links', 'AI page builder',
  'Webhook sync', 'Permission matrix', 'CSV export', 'Collection rate',
]

function CapabilityMarquee() {
  return (
    <div className="ft-marquee-mask py-3" aria-hidden="true">
      <div className="ft-marquee-track">
        {[0, 1].map(copy => (
          <div key={copy} className="flex items-center gap-3 pr-3">
            {MARQUEE.map(item => (
              <span
                key={item}
                className="whitespace-nowrap rounded-full text-xs font-semibold"
                style={{
                  padding: '8px 15px', background: 'var(--card-bg)',
                  border: '1px solid var(--card-border)', color: 'var(--text-2)',
                }}
              >
                {item}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

const VISUALS = {
  bars:  <MiniBars />,
  line:  <MiniLine />,
  donut: <MiniDonut pct={68} />,
  docs:  <MiniDocs />,
  demo:  <AnalystDemo />,
}

function ModuleCard({ icon: Icon, title, body, points, visual }) {
  const tilt = useTilt({ max: 5 })
  return (
    <article
      ref={tilt}
      className="tilt tilt-sheen ft-edge h-full flex flex-col rounded-2xl p-5 sm:p-6"
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      <div
        className="flex items-center justify-center rounded-xl mb-4"
        style={{
          width: 44, height: 44, flexShrink: 0,
          background: 'var(--accent-dim)', color: 'var(--accent)',
        }}
      >
        <Icon size={21} aria-hidden="true" />
      </div>
      <h3 className="text-base sm:text-lg font-bold mb-2" style={{ color: 'var(--text-1)' }}>
        {title}
      </h3>
      <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--text-2)' }}>
        {body}
      </p>
      {/* Visual sits directly under the copy it illustrates. Pushing it to the
          bottom with a spacer left a dead band across every cell. */}
      {visual && (
        <div className="mb-4">
          {VISUALS[visual]}
        </div>
      )}
      <div className="flex-1" />
      <ul className="flex flex-col gap-1.5 m-0 p-0" style={{ listStyle: 'none' }}>
        {points.map(p => (
          <li key={p} className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-3)' }}>
            <Check size={13} aria-hidden="true" style={{ color: 'var(--accent)', flexShrink: 0 }} />
            {p}
          </li>
        ))}
      </ul>
    </article>
  )
}

export default function Landing() {
  // Rotation of 0: a primary button that tips as you approach it feels
  // unstable. Only the cursor-following glow is wanted here, and that reads
  // --tilt-mx/--tilt-my, which the hook writes regardless of the angle.
  const heroCta = useTilt({ max: 0 })
  usePageMeta({
    title: 'FinTrack — AI finance manager for project businesses',
    description:
      'Receivables, projects, analytics and an AI analyst that cites its sources. Ask your invoices and your contracts a question in plain words.',
  })

  return (
    <PublicLayout>
      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Drifting colour field. Purely decorative, so it is hidden from AT
            and sits behind everything. */}
        <div className="ft-aurora" aria-hidden="true"><span /><span /></div>
        <Grain />

        <div className="relative mx-auto px-4 sm:px-6 pt-12 pb-14 sm:pt-20 sm:pb-20 grid gap-10 lg:gap-14 items-center"
             style={{ maxWidth: 1120, zIndex: 1,
                      gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' }}>
        <Reveal style={{ maxWidth: 760 }}>
          <span
            className="inline-flex items-center gap-2 rounded-full text-xs font-semibold mb-5"
            style={{ padding: '6px 12px', background: 'var(--accent-dim)', color: 'var(--accent)' }}
          >
            <Sparkles size={13} aria-hidden="true" />
            Finance, projects and an analyst that shows its working
          </span>

          <h1
            className="font-extrabold tracking-tight mb-5"
            style={{ fontSize: 'clamp(2rem, 6.5vw, 3.75rem)', lineHeight: 1.08, letterSpacing: '-0.03em' }}
          >
            Know what you are owed,
            <br />
            <span style={{ color: 'var(--accent)' }}>and why</span>.
          </h1>

          <p className="mb-8" style={{
            fontSize: 'clamp(1rem, 2.2vw, 1.225rem)', lineHeight: 1.6,
            color: 'var(--text-2)', maxWidth: 620,
          }}>
            FinTrack runs receivables, projects and reporting for project
            businesses — then lets you ask your invoices and your contracts a
            question in plain words, and shows you the query or the page it
            answered from.
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              to="/login"
              ref={heroCta}
              className="ft-cta flex items-center justify-center gap-2 rounded-xl font-bold"
              style={{
                minHeight: 52, padding: '0 26px', background: 'var(--accent-btn)',
                color: '#fff', textDecoration: 'none', fontSize: '0.975rem',
                boxShadow: '0 6px 20px var(--accent-glow)',
              }}
            >
              Sign in to your workspace <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <a
              href="#features"
              className="flex items-center justify-center gap-2 rounded-xl font-bold"
              style={{
                minHeight: 52, padding: '0 26px', background: 'var(--card-bg)',
                border: '1px solid var(--card-border)', color: 'var(--text-1)',
                textDecoration: 'none', fontSize: '0.975rem',
              }}
            >
              See what it does
            </a>
          </div>

          <p className="mt-5 text-xs" style={{ color: 'var(--text-3)' }}>
            Access is by invitation — an administrator approves each account.
          </p>
        </Reveal>

        <ProductMockup />
        </div>

        <div className="relative mx-auto px-4 sm:px-6 pb-10" style={{ maxWidth: 1120, zIndex: 1 }}>
          <CapabilityMarquee />
        </div>
      </section>

      {/* ── Counts ──────────────────────────────────────────────────────
          Product facts — how many modules, how many roles — not workspace
          figures. They describe the software, so they are safe to show. */}
      <section className="mx-auto px-4 sm:px-6 pb-14 sm:pb-20" style={{ maxWidth: 1120 }}>
        <Reveal className="grid gap-4 sm:gap-5"
                style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(50% - 0.5rem, 200px), 1fr))' }}>
          {[
            ['Modules', 8, ''],
            ['Permission roles', 8, ''],
            ['Sync latency', 30, 's'],
            ['Cited answers', 100, '%'],
          ].map(([label, value, suffix]) => (
            <div key={label} className="rounded-2xl p-4 sm:p-5"
                 style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
              <p className="font-extrabold tracking-tight"
                 style={{ fontSize: 'clamp(1.6rem, 4vw, 2.3rem)', color: 'var(--accent)', letterSpacing: '-0.02em' }}>
                <CountUp to={value} suffix={suffix} />
              </p>
              <p className="text-xs font-semibold mt-1" style={{ color: 'var(--text-3)' }}>{label}</p>
            </div>
          ))}
        </Reveal>
      </section>

      {/* ── Modules ─────────────────────────────────────────────────────── */}
      <section id="features" className="mx-auto px-4 sm:px-6 pb-4" style={{ maxWidth: 1120 }}>
        <Reveal className="mb-8" style={{ maxWidth: 640 }}>
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] mb-2"
             style={{ color: 'var(--accent)' }}>
            What is inside
          </p>
          <h2 className="font-extrabold tracking-tight mb-3"
              style={{ fontSize: 'clamp(1.5rem, 4vw, 2.25rem)', letterSpacing: '-0.02em' }}>
            Eight modules, one source of truth
          </h2>
          <p style={{ fontSize: '0.975rem', lineHeight: 1.65, color: 'var(--text-2)' }}>
            Records live in one place and every module reads the same rows, so a
            number on the dashboard and a number in a report cannot disagree.
          </p>
        </Reveal>

        <div className="ft-bento">
          {MODULES.map((m, i) => (
            // Staggered, but capped — past a handful the last card would wait
            // noticeably longer than the reader does.
            <Reveal key={m.title} delay={Math.min(i, 3) * 70} className={`${m.span} h-full`}>
              <ModuleCard {...m} />
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Privacy ─────────────────────────────────────────────────────── */}
      <section id="privacy" className="mx-auto px-4 sm:px-6 py-16 sm:py-24" style={{ maxWidth: 1120 }}>
        <div
          className="rounded-3xl p-6 sm:p-10"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
        >
          <Reveal className="mb-8" style={{ maxWidth: 640 }}>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] mb-2"
               style={{ color: 'var(--accent)' }}>
              Access
            </p>
            <h2 className="font-extrabold tracking-tight mb-3"
                style={{ fontSize: 'clamp(1.5rem, 4vw, 2.25rem)', letterSpacing: '-0.02em' }}>
              This page is public. Your data is not.
            </h2>
            <p style={{ fontSize: '0.975rem', lineHeight: 1.65, color: 'var(--text-2)' }}>
              Everything described here is capability. Nothing on this page is
              read from a workspace, and no figure below the fold belongs to
              anyone.
            </p>
          </Reveal>

          <div className="grid gap-5 sm:gap-6"
               style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))' }}>
            {SECURITY.map(({ icon: Icon, title, body }, i) => (
              <Reveal key={title} delay={Math.min(i, 3) * 70}>
                <div className="flex items-center gap-2.5 mb-2">
                  <Icon size={17} aria-hidden="true" style={{ color: 'var(--accent)', flexShrink: 0 }} />
                  <h3 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{title}</h3>
                </div>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────── */}
      <section id="how" className="mx-auto px-4 sm:px-6 pb-16 sm:pb-24" style={{ maxWidth: 1120 }}>
        <Reveal className="mb-8" style={{ maxWidth: 640 }}>
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] mb-2"
             style={{ color: 'var(--accent)' }}>
            How it works
          </p>
          <h2 className="font-extrabold tracking-tight"
              style={{ fontSize: 'clamp(1.5rem, 4vw, 2.25rem)', letterSpacing: '-0.02em' }}>
            Edit where you already work
          </h2>
        </Reveal>

        <ol className="grid gap-4 sm:gap-5 m-0 p-0"
            style={{ listStyle: 'none', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' }}>
          {[
            ['Records stay in your tables',
             'Your existing base remains the system of record. FinTrack reads and writes it directly rather than asking you to migrate.'],
            ['Mirrored for speed',
             'A Postgres mirror is kept current by webhooks, a 30-second incremental pass and a full reconciliation, so lists filter and sort instantly.'],
            ['Ask it anything',
             'The analyst maps your question onto a fixed set of measures and compiles the query itself. It never writes free-form SQL, and it shows you what it ran.'],
          ].map(([title, body], i) => (
            <li key={title} className="rounded-2xl p-5 sm:p-6"
                style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
              <span
                className="flex items-center justify-center rounded-lg font-bold text-sm mb-3"
                style={{ width: 30, height: 30, background: 'var(--accent-dim)', color: 'var(--accent)' }}
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <h3 className="text-base font-bold mb-2" style={{ color: 'var(--text-1)' }}>{title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Close ───────────────────────────────────────────────────────── */}
      <section className="mx-auto px-4 sm:px-6 pb-16 sm:pb-24" style={{ maxWidth: 1120 }}>
        <Reveal
          className="rounded-3xl px-6 py-12 sm:px-12 sm:py-16 text-center"
          style={{
            background: 'linear-gradient(135deg, var(--accent-btn), var(--accent-bright))',
            color: '#fff',
          }}
        >
          <h2 className="font-extrabold tracking-tight mb-3"
              style={{ fontSize: 'clamp(1.5rem, 4.5vw, 2.5rem)', letterSpacing: '-0.02em' }}>
            Already have an account?
          </h2>
          <p className="mx-auto mb-7"
             style={{ fontSize: '1rem', lineHeight: 1.6, opacity: 0.92, maxWidth: 460 }}>
            Sign in with email, Google or Zoho. New accounts are approved by an
            administrator before they can see anything.
          </p>
          <Link
            to="/login"
            className="inline-flex items-center justify-center gap-2 rounded-xl font-bold"
            style={{
              minHeight: 52, padding: '0 30px', background: '#fff',
              color: 'var(--accent-btn)', textDecoration: 'none', fontSize: '0.975rem',
            }}
          >
            Sign in <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </Reveal>
      </section>

    </PublicLayout>
  )
}
