/**
 * The public front door.
 *
 * Until this page existed an unauthenticated visitor hit the login form and
 * nothing else — there was no way to find out what the product does without
 * an account. It explains the modules, and it lets you use one: the sandbox
 * below the hero is a working copy of the app over an invented ledger.
 *
 * The rule the whole page is built around is negative. Nothing here reads a
 * workspace. Every client, project and figure is fiction, computed in the
 * browser from src/components/demoData.js, and no part of this route makes an
 * API call. Real records live behind sign-in.
 *
 * Built mobile-first because that is where it has most often been wrong: a
 * single column by default, grids that opt into more, no fixed widths, and
 * touch targets that clear 44px.
 */
import { Link } from 'react-router-dom'
import {
  ArrowRight, Receipt, FolderKanban, BarChart3, Sparkles, Globe, Activity,
  ShieldCheck, Share2, Lock, Database, Zap, Check, FileSearch, Landmark,
  FileText, Gauge, GitBranch, ScrollText,
} from 'lucide-react'
import { usePageMeta } from '../hooks/usePageMeta'
import PublicLayout from '../components/PublicLayout'
import DemoWorkspace from '../components/DemoWorkspace'
import { useTilt } from '../hooks/useTilt'
import { useReveal } from '../hooks/useReveal'
import {
  Grain, MiniBars, MiniLine, MiniDonut, MiniDocs, AnalystDemo, CountUp,
} from '../components/LandingVisuals'

export const MODULES = [
  {
    icon: Receipt, span: 'span-3', visual: 'bars',
    title: 'Receivables',
    body: 'Invoices with aging bands, collection rate and average days to collect. GST and TDS are tracked separately — tax withheld at source is not money a client still owes you.',
    points: ['Aging bands you can filter by', 'Collection rate and follow-up load', 'Missing docs and retainer templates'],
  },
  {
    icon: FolderKanban, span: 'span-3', visual: 'donut',
    title: 'Projects',
    body: 'Billing, cost and realised profit per project, with margin and health surfaced before a job quietly goes underwater.',
    points: ['Profit and margin per project', 'At-risk and critical health signals', 'Client rollups and invoice history'],
  },
  {
    icon: BarChart3, span: 'span-4', visual: 'line',
    title: 'Analytics',
    body: 'Cash position, revenue, collection rate and overdue pressure over any period — plus signals worth noticing, surfaced rather than left to be found. Every chart is one click from the rows behind it.',
    points: ['Cash position and overdue pressure', 'Client, project and category breakdowns', 'Sync state, so you know how fresh it is'],
  },
  {
    icon: Landmark, span: 'span-2',
    title: 'Tax ledger',
    body: 'Gross billed, GST collected and net receivable, month by month — kept apart from the cash view so a filing figure is never mistaken for a collections figure.',
    points: ['Monthly GST and net receivable', 'GST collection rate', 'Filing checklist'],
  },
  {
    icon: FileText, span: 'span-2',
    title: 'AI reports',
    body: 'A written period report over your own figures, kept in a history you can reopen — and an assistant that already has the current context loaded.',
    points: ['Brief, detailed or board-style', 'Report history', 'Assistant with live context'],
  },
  {
    icon: FileSearch, span: 'span-4', visual: 'docs',
    title: 'Studio — documents',
    body: 'Upload contracts and notes, then ask questions about them. Every answer carries numbered citations you can open to the exact page it came from, and the answer is checked against those sources before you see it.',
    points: ['PDF, text, Markdown, CSV, JSON', 'Page-level citations, opened inline', 'Answers checked against sources'],
  },
  {
    icon: Sparkles, span: 'span-6', visual: 'demo',
    title: 'Studio — finance data',
    body: 'Ask your invoices and projects a question in plain words. The model picks measures and groupings; the code compiles the SQL. The statement is shown with every answer, so a figure about money can always be checked.',
    points: ['Outstanding, collected, GST, TDS, collection rate', 'Group by project, client, category, month or quarter', 'Scoped to what your account may already see'],
  },
  {
    icon: Globe, span: 'span-3',
    title: 'Pages',
    body: 'Describe a page and watch it get written, then publish it on a slug — optionally password-protected, optionally set to expire.',
    points: ['Streamed as it writes', 'Surgical revisions and version history', 'Password, expiry and view counts'],
  },
  {
    icon: Activity, span: 'span-3',
    title: 'Status board',
    body: 'A live view of where every client project stands, kept current by webhooks rather than by someone remembering to update a sheet.',
    points: ['Board or list mode', 'Attachments and AI-drafted updates', 'Choose the columns, then share the view'],
  },
  {
    icon: Share2, span: 'span-3',
    title: 'Shared views',
    body: 'Send a filtered, read-only view to a client on a link, and see what they actually opened.',
    points: ['Read-only links with your filters', 'Column highlighting', 'Viewers, opens and an event timeline'],
  },
  {
    icon: ShieldCheck, span: 'span-3',
    title: 'Admin & audit',
    body: 'Account approval, a permission matrix down to the individual action, live sessions, and a full request trail written asynchronously so it never slows the page it is recording.',
    points: ['Permissions granted or revoked per person', 'Every request and every field change', 'Sync log, AI runs, deployment health'],
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

/* Why the product exists, stated as the three things that are actually wrong
   with how this work gets done today. Each one is a problem the modules above
   answer directly — a grievance with no corresponding feature is marketing. */
const PROBLEMS = [
  {
    icon: Gauge,
    title: 'The total is right. Nobody can prove it.',
    body: 'A figure arrives on a dashboard with no way back to the rows underneath. When two reports disagree — and they do — the argument is settled by whoever exported last, not by the data.',
  },
  {
    icon: Landmark,
    title: 'Tax withheld gets counted as money owed.',
    body: 'TDS is deducted by the client before they pay. Most receivables reports quietly leave it in the outstanding column, which overstates what you can actually collect and hides the invoices that are genuinely late.',
  },
  {
    icon: Sparkles,
    title: 'An assistant that guesses is worse than none.',
    body: 'Bolt a chat window onto a ledger and it will confidently invent a total. On money, an answer you cannot check is not a faster answer — it is a liability with better manners.',
  },
]

/* The claim the rest of the product rests on. Every line here is a mechanism,
   not an adjective: something that is either in the code or is not. */
const TRUST = [
  {
    icon: ScrollText,
    title: 'The model never writes SQL',
    body: 'It chooses a measure and a grouping from a fixed set. The application compiles the statement, runs it, and shows it to you next to the answer. There is no path from a sentence to arbitrary SQL, which is the same reason the analyst cannot be talked into reading something it should not.',
  },
  {
    icon: Lock,
    title: 'Scoped where the query is built',
    body: 'Row limits come from the session at the moment the statement is assembled, not from what the screen chose to render. A narrower account cannot widen its own results by changing what it asks for.',
  },
  {
    icon: FileSearch,
    title: 'Document answers carry citations',
    body: 'Ask a contract a question and each claim in the reply is numbered to the passage and page it came from. The answer is checked against those sources before it reaches you, and you can open every one.',
  },
  {
    icon: ScrollText,
    title: 'Everything is written down',
    body: 'Who did what, when, from where, and which fields changed — recorded asynchronously so the audit trail never becomes the reason a page is slow.',
  },
]

const STEPS = [
  {
    icon: Database,
    title: 'Your records stay where they are',
    body: 'The base you already work in remains the system of record. FinTrack reads and writes it directly. There is no migration, no export, and no second place for someone to update instead.',
  },
  {
    icon: GitBranch,
    title: 'Mirrored into Postgres for speed',
    body: 'A mirror is kept current by webhooks, a thirty-second incremental pass and a periodic full reconciliation. Lists filter and sort against the mirror, so a screen full of invoices is instant instead of a round trip per view.',
  },
  {
    icon: Sparkles,
    title: 'Ask it in plain words',
    body: 'Questions are mapped onto a fixed set of measures and groupings and compiled to SQL by the application. You get the answer, the chart and the statement that produced them, every time.',
  },
]

/* Written as questions someone actually types, and answered properly. These
   are the page's most-read text after the hero — and, as a details/summary
   list, they are in the document whether or not anyone opens them. */
const FAQ = [
  {
    q: 'What does FinTrack actually do?',
    a: 'It runs receivables, projects, GST and reporting for businesses that bill by project — agencies, studios, consultancies and firms working on retainers. Invoices carry ageing bands, collection rate and days-to-collect; projects carry billed, cost, realised profit and margin; tax sits in its own ledger; and an AI analyst answers questions across all of it while showing the query it ran.',
  },
  {
    q: 'Is the demo on this page real data?',
    a: 'No. Every client, project, invoice and figure in the sandbox is invented and computed in your browser — the page makes no API call at all. What is real is the behaviour: the filters filter, the columns sort, the ageing bands are genuine predicates over those rows, and the analyst answers are produced by the same function that prints the SQL beside them. Add the columns up and they agree, because there is only one set of rows.',
  },
  {
    q: 'How is this different from a spreadsheet?',
    a: 'A spreadsheet gives you a number with no way back to where it came from, and a second copy of that number the moment someone filters differently. Here every module reads the same records, so a figure on the dashboard and a figure in a report cannot disagree, and any total can be opened to the invoices behind it.',
  },
  {
    q: 'Can the AI analyst invent a figure?',
    a: 'It is not able to. The model never writes SQL — it selects a measure and a grouping from a fixed list, and the application compiles and runs the statement itself. The query is shown with every answer, so a figure about money can be checked rather than trusted. The same design is why the analyst cannot be prompted into reading data the signed-in account is not allowed to see: scoping is applied when the statement is built.',
  },
  {
    q: 'How does it handle GST and TDS?',
    a: 'Separately, and on purpose. GST collected is tracked month by month and per client in its own ledger with a filing checklist, kept apart from the cash view so a filing figure is never mistaken for a collections figure. TDS is tax the client withholds at source before paying — it is reported, but it is never counted as outstanding, because it is not money a client still owes you.',
  },
  {
    q: 'Can I share something with a client without giving them an account?',
    a: 'Yes. Any filtered view can be published as a read-only link, optionally password-protected and set to expire, with the columns you want read first highlighted. You then see unique viewers, page views, which records and attachments were opened, and a timeline of what happened — and you can revoke the link at any time.',
  },
  {
    q: 'What can it do with documents?',
    a: 'Upload contracts, scopes and notes as PDF, text, Markdown, CSV, JSON or logs, then ask questions about them in plain words. Each answer carries numbered citations you can open to the exact passage and page, and answers are verified against those sources before you see them. The interface also states which retrieval is actually running rather than implying a capability it does not have.',
  },
  {
    q: 'Who can see what?',
    a: 'Roles carry sensible defaults and any individual permission can be granted or revoked per person. A change takes effect on the next request rather than the next login. Every request is recorded with method, path, status, duration and origin, and record-level history keeps which fields changed and who changed them.',
  },
  {
    q: 'How do I get an account?',
    a: 'Access is by invitation and an administrator approves each account before it can see anything. You can sign in with email, Google or Zoho. Nothing on this public page is read from a workspace, so there is nothing to see until an account exists.',
  },
]

/* Search engines read this; people read the page. Both should get the same
   claims, which is why every answer below is lifted from the FAQ above
   rather than written separately for a crawler. */
const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareApplication',
      name: 'FinTrack',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description:
        'Receivables, project profitability, GST and TDS tracking, analytics, document search and an AI analyst that shows the query behind every figure — for businesses that bill by project.',
      url: 'https://twfintracker.worksmayukh.space/',
      featureList: [
        'Invoice ageing and collection tracking',
        'Project profitability and margin',
        'GST and TDS ledger',
        'Analytics with drill-through to source rows',
        'AI analyst with the compiled SQL shown',
        'Document question answering with page-level citations',
        'Read-only shared client links with view analytics',
        'Role and per-action permissions with a full audit trail',
      ],
    },
    {
      '@type': 'FAQPage',
      mainEntity: FAQ.map(({ q, a }) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    },
  ],
}

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

/** Section heading — one shape for all of them, so the page has a rhythm. */
function Head({ eyebrow, title, children, className = '' }) {
  return (
    <Reveal className={`mb-8 ${className}`} style={{ maxWidth: 680 }}>
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] mb-2"
         style={{ color: 'var(--accent)' }}>{eyebrow}</p>
      <h2 className="font-extrabold tracking-tight mb-3"
          style={{ fontSize: 'clamp(1.5rem, 4vw, 2.25rem)', letterSpacing: '-0.025em', lineHeight: 1.15 }}>
        {title}
      </h2>
      {children && (
        <p style={{ fontSize: '1rem', lineHeight: 1.7, color: 'var(--text-2)' }}>{children}</p>
      )}
    </Reveal>
  )
}

const MARQUEE = [
  'Ageing buckets', 'GST & TDS split', 'Cited answers', 'Natural-language queries',
  'Row-level scoping', 'Audit trail', 'Shared links', 'AI page builder',
  'Webhook sync', 'Permission matrix', 'CSV export', 'Collection rate',
  'Tax ledger', 'Period reports', 'Project margin', 'Overdue pressure',
  'Days to collect', 'Field-level history',
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
    title: 'FinTrack — receivables, project profit and an AI analyst that shows its working',
    description:
      'Finance software for businesses that bill by project. Invoice ageing, collection rate, project margin, GST and TDS kept separate, and an AI analyst that prints the query behind every figure. Try the live sandbox — no account needed.',
    path: '/',
    jsonLd: JSON_LD,
  })

  return (
    <PublicLayout>
      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="ft-aurora" aria-hidden="true"><span /><span /></div>
        <div className="ft-dotgrid" aria-hidden="true" />
        <Grain />

        <div className="relative mx-auto px-4 sm:px-6 pt-9 pb-7 sm:pt-14"
             style={{ maxWidth: 1120, zIndex: 1 }}>
          <Reveal style={{ maxWidth: 800 }}>
            <span
              className="inline-flex items-center gap-2 rounded-full text-xs font-semibold mb-4"
              style={{ padding: '6px 12px', background: 'var(--accent-dim)', color: 'var(--accent)' }}
            >
              <Sparkles size={13} aria-hidden="true" />
              Receivables, projects and an analyst that shows its working
            </span>

            <h1
              className="font-extrabold tracking-tight mb-5"
              style={{ fontSize: 'clamp(1.95rem, 5.9vw, 3.5rem)', lineHeight: 1.05, letterSpacing: '-0.035em' }}
            >
              Finance software that
              <br />
              <span style={{ color: 'var(--accent)' }}>shows its working</span>.
            </h1>

            <p className="mb-6" style={{
              fontSize: 'clamp(1rem, 2.1vw, 1.18rem)', lineHeight: 1.6,
              color: 'var(--text-2)', maxWidth: 620,
            }}>
              Receivables, project profitability and GST for businesses that bill
              by project — and an analyst that answers in plain words while
              printing the query behind every figure. You never take a number on
              faith.
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <a
                href="#try"
                className="ft-cta flex items-center justify-center gap-2 rounded-xl font-bold"
                style={{
                  minHeight: 52, padding: '0 26px', background: 'var(--accent-btn)',
                  color: '#fff', textDecoration: 'none', fontSize: '0.975rem',
                  boxShadow: '0 6px 20px var(--accent-glow)',
                }}
              >
                Try it — no account needed <ArrowRight size={17} aria-hidden="true" />
              </a>
              <Link
                to="/login"
                ref={heroCta}
                className="flex items-center justify-center gap-2 rounded-xl font-bold"
                style={{
                  minHeight: 52, padding: '0 26px', background: 'var(--card-bg)',
                  border: '1px solid var(--card-border)', color: 'var(--text-1)',
                  textDecoration: 'none', fontSize: '0.975rem',
                }}
              >
                Sign in
              </Link>
            </div>
          </Reveal>
        </div>

        {/* ── The sandbox ──────────────────────────────────────────────── */}
        <div id="try" className="relative mx-auto px-4 sm:px-6 pb-6" style={{ maxWidth: 1120, zIndex: 1 }}>
          <Reveal>
            <DemoWorkspace />
          </Reveal>
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
            ['Modules', 11, '', 'receivables to audit'],
            ['Permission roles', 8, '', 'each override-able per person'],
            ['Sync latency', 30, 's', 'incremental, plus webhooks'],
            ['Answers with the query shown', 100, '%', 'no exceptions'],
          ].map(([label, value, suffix, sub]) => (
            <div key={label} className="rounded-2xl p-4 sm:p-5"
                 style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
              <p className="font-extrabold tracking-tight"
                 style={{ fontSize: 'clamp(1.6rem, 4vw, 2.3rem)', color: 'var(--accent)', letterSpacing: '-0.02em' }}>
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
        <Head eyebrow="Why this exists"
              title="Three things go wrong with money on projects">
          None of them are exotic. They are what happens when the ledger, the
          project plan and the tax position live in different places and nobody
          owns the reconciliation.
        </Head>
        <div className="grid gap-5"
             style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))' }}>
          {PROBLEMS.map(({ icon: Icon, title, body }, i) => (
            <Reveal key={title} delay={Math.min(i, 3) * 70}
                    className="rounded-2xl p-5 sm:p-6 h-full"
                    style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
              <Icon size={20} aria-hidden="true" style={{ color: 'var(--accent)' }} />
              <h3 className="font-bold mt-3 mb-2" style={{ fontSize: '1.02rem', color: 'var(--text-1)' }}>
                {title}
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Modules ─────────────────────────────────────────────────────── */}
      <section id="features" className="mx-auto px-4 sm:px-6 pb-4" style={{ maxWidth: 1120 }}>
        <Head eyebrow="What is inside" title="Eleven modules, one source of truth">
          Records live in one place and every module reads the same rows, so a
          number on the dashboard and a number in a report cannot disagree.
          Every total opens to the invoices underneath it.
        </Head>

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

      {/* ── Verifiability ───────────────────────────────────────────────── */}
      <section id="trust" className="mx-auto px-4 sm:px-6 py-16 sm:py-24" style={{ maxWidth: 1120 }}>
        <hr className="ft-rule mb-14" />
        <Head eyebrow="Why you can trust the answer"
              title="Checkable by construction, not by policy">
          Plenty of tools promise not to make things up. These are the four
          decisions that mean this one cannot — each of them is in the code, and
          each of them is visible to you while you use it.
        </Head>
        <div className="grid gap-5 sm:gap-6"
             style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))' }}>
          {TRUST.map(({ icon: Icon, title, body }, i) => (
            <Reveal key={title} delay={Math.min(i, 3) * 70}
                    className="rounded-2xl p-5 sm:p-6 h-full"
                    style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
              <div className="flex items-center gap-2.5 mb-2.5">
                <Icon size={18} aria-hidden="true" style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <h3 className="font-bold" style={{ fontSize: '1rem', color: 'var(--text-1)' }}>{title}</h3>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────── */}
      <section id="how" className="mx-auto px-4 sm:px-6 pb-16 sm:pb-24" style={{ maxWidth: 1120 }}>
        <Head eyebrow="How it works" title="Nothing to migrate">
          The fastest way to lose a finance team is to ask them to move their
          records somewhere new on day one. FinTrack sits on top of what they
          already keep.
        </Head>

        <ol className="relative grid gap-4 sm:gap-5 m-0 p-0"
            style={{ listStyle: 'none', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))' }}>
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="relative rounded-2xl p-5 sm:p-6"
                style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
              <div className="flex items-center gap-3 mb-3">
                <span
                  className="flex items-center justify-center rounded-lg font-bold text-sm"
                  style={{ width: 30, height: 30, background: 'var(--accent-dim)', color: 'var(--accent)' }}
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <Icon size={17} aria-hidden="true" style={{ color: 'var(--text-3)' }} />
              </div>
              <h3 className="text-base font-bold mb-2" style={{ color: 'var(--text-1)' }}>{title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{body}</p>

              {/* Direction, shown rather than captioned. Hidden on the last
                  card and whenever the grid has wrapped to one column, where
                  a rightward arrow would point at nothing. */}
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
      </section>

      {/* ── Privacy ─────────────────────────────────────────────────────── */}
      <section id="privacy" className="mx-auto px-4 sm:px-6 pb-16 sm:pb-24" style={{ maxWidth: 1120 }}>
        <div
          className="rounded-3xl p-6 sm:p-10"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
        >
          <Head eyebrow="Access" title="This page is public. Your data is not." className="mb-8">
            Everything described here is capability, and the sandbox above is
            fiction computed in your browser. No figure on this page is read
            from a workspace, and nothing below the fold belongs to anyone.
          </Head>

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

      {/* ── FAQ ─────────────────────────────────────────────────────────── */}
      <section id="faq" className="mx-auto px-4 sm:px-6 pb-16 sm:pb-24" style={{ maxWidth: 820 }}>
        <Head eyebrow="Questions" title="Answers, at length" />
        <div>
          {FAQ.map(({ q, a }, i) => (
            <details key={q} className="ft-faq" open={i === 0}>
              <summary>{q}</summary>
              <div>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{a}</p>
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* ── Close ───────────────────────────────────────────────────────── */}
      <section className="mx-auto px-4 sm:px-6 pb-16 sm:pb-24" style={{ maxWidth: 1120 }}>
        <Reveal
          className="ft-shine rounded-3xl px-6 py-12 sm:px-12 sm:py-16 text-center"
          style={{
            background: 'linear-gradient(135deg, var(--accent-btn), var(--accent-bright))',
            color: '#fff',
          }}
        >
          <h2 className="font-extrabold tracking-tight mb-3"
              style={{ fontSize: 'clamp(1.5rem, 4.5vw, 2.5rem)', letterSpacing: '-0.025em' }}>
            Already have an account?
          </h2>
          <p className="mx-auto mb-7"
             style={{ fontSize: '1rem', lineHeight: 1.6, opacity: 0.92, maxWidth: 480 }}>
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
