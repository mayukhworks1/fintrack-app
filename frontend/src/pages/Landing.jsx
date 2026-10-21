/**
 * The public front door.
 *
 * In order: what this is, the sample workspace to use it, four facts about
 * the software, three screens from the app with notes, the three problems it
 * exists for (with the TDS arithmetic at your own figure), the film, the
 * modules as a contents list, and the three deeper pages.
 *
 * Nothing here reads a workspace. Every client, project and figure is sample
 * data computed in the browser from demoData.js, and no part of this route
 * makes an API call. The sandbox stays a static import inside its own error
 * boundary; the film is mounted only as it nears the viewport, in space
 * reserved for it, so nothing below it moves.
 */
import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { usePageMeta } from '../hooks/usePageMeta'
import PublicLayout from '../components/PublicLayout'
import DemoWorkspace from '../components/DemoWorkspace'
import ErrorBoundary from '../components/ErrorBoundary'
import Overstatement from '../components/Overstatement'
import LazyMount from '../components/motion/LazyMount'
import { Reveal, Section, Plate, Btn, Closing } from '../components/PublicBits'
import { MODULES, PROBLEMS, APP_LD, FAQ_LD, graph } from '../content/publicContent'
import { TOTALS, inrShort } from '../components/demoData'
import '../styles/public-home.css'

const ProductFilm = lazy(() => import('../components/ProductFilm'))

const LD = graph(APP_LD, FAQ_LD)

const READ_ON = [
  ['/how-it-works', 'How it works',
   'Your records stay where they are. A mirror makes them fast, and questions are compiled to SQL you can read.'],
  ['/customise', 'Made yours',
   'What you change yourself, what runs on your own cloud, and what gets built for your case.'],
  ['/security', 'Security & access',
   'Who can see what, with rows limited when the query is built and every request recorded.'],
]

const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

export default function Landing() {
  usePageMeta({
    title: 'FinTrack: project delivery and project finance on one set of records',
    description:
      'A live delivery board and the money for the same work, in one place, for firms in India that bill by project. Invoice ageing and collection rate, project margin, GST and TDS kept separate, and an analyst that prints the query behind every figure. Try the sample workspace without an account.',
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
      {/* ── Opening ─────────────────────────────────────────────────────── */}
      <div className="pb-wrap pb-open">
        <div className="pb-row">
          <div className="pb-margin">
            <p className="pb-label">For firms in India that bill by project</p>
          </div>
          <div className="pb-main">
            <h1 className="pb-display ft-h-title">
              The delivery and the money, <em>on one set of records.</em>
            </h1>
            <p className="pb-lede">
              A live board of where every project stands, and the receivables,
              margin and GST for the same work. Ask a question in plain words
              and FinTrack prints the query behind the answer.
            </p>
            <div className="pb-actions">
              <Btn href="#try" onClick={startTour}>Take the guided tour</Btn>
              <Btn to="/login" quiet>Sign in</Btn>
            </div>
          </div>
        </div>
      </div>

      {/* ── The sample workspace ─────────────────────────────────────────── */}
      <section id="try" className="pb-sandbox" aria-label="The sample workspace">
        <div className="pb-wrap">
          {/* Its own boundary: a fault in the sandbox must not take the page down. */}
          <ErrorBoundary><DemoWorkspace /></ErrorBoundary>
          <p className="pb-cap">
            <b>The sample workspace.</b>
            Every figure is sample data, computed in your browser. Filters,
            sorting and the analyst all work; nothing here reads a real account.
          </p>
        </div>
      </section>

      {/* ── Four facts ──────────────────────────────────────────────────── */}
      <Section flush={false} eyebrow="In four figures">
        <dl className="pb-facts" aria-label="FinTrack in four figures">
          <div><dd className="pb-num">{MODULES.length}</dd><dt>Modules, from receivables to audit, reading the same rows</dt></div>
          <div><dd className="pb-num">8</dd><dt>Permission roles, each adjustable for one person</dt></div>
          <div><dd className="pb-num">30 s</dd><dt>Between incremental syncs, behind instant webhooks</dt></div>
          <div><dd className="pb-num">0</dd><dt>Lines of SQL written by the model. It picks a measure and a grouping; the code writes the query</dt></div>
        </dl>
      </Section>

      {/* ── Screens from the app ────────────────────────────────────────── */}
      <Section n="01" eyebrow="The screens"
               title="What your team works in"
               lede={`Captured from the sample workspace, where ${inrShort(TOTALS.outstanding)} is outstanding across the open invoices. All of it is sample data.`}>
        <div style={{ display: 'grid', gap: 'clamp(48px, 7vw, 96px)' }}>
          <Reveal>
            <Plate id="dashboard" fig={1} crop={[246, 76, 1330, 870]}
                   alt="The dashboard: net revenue, direct costs, gross margin, outstanding, collected and overdue, above the active projects, sample data"
                   caption="The dashboard. Revenue, cost and margin above the money still owed."
                   notes={[
                     { x: 530, y: 430, label: 'Outstanding', body: 'Pre-tax, across the open invoices. Opens to the invoices underneath.' },
                     { x: 1400, y: 285, label: 'Gross margin', body: 'Billed less cost, over billed.' },
                     { x: 560, y: 680, label: 'Engagements', body: 'Billing and margin for each project, from its own invoices.' },
                   ]} />
          </Reveal>
          <Reveal>
            <Plate id="status" fig={2} crop={[246, 80, 1330, 580]}
                   alt="The status board by status: projects in lanes, each with what it is still owed, sample data"
                   caption="The status board. Delivery state on the same records as the money."
                   notes={[
                     { x: 705, y: 316, label: 'Owed, on the card', body: 'What the project is still owed, from its invoices.' },
                     { x: 1490, y: 228, label: 'Delivered', body: 'Finished work, still showing what it is owed until it is paid.' },
                   ]} />
          </Reveal>
          <Reveal>
            <Plate id="tax" fig={3} crop={[246, 76, 1330, 870]}
                   alt="The tax ledger: taxable value, GST, TDS withheld, gross invoiced and net receivable, with GST and TDS by client, sample data"
                   caption="The tax ledger. GST and TDS by client, apart from the cash view."
                   notes={[
                     { x: 1440, y: 215, label: 'TDS withheld', body: 'Deducted by clients at source. Reported here, never counted as owed.' },
                     { x: 1010, y: 372, label: 'Net receivable', body: 'What lands in the bank once TDS is withheld.' },
                     { x: 640, y: 732, label: 'By client', body: 'Taxable value, GST and TDS for each client this quarter.' },
                   ]} />
          </Reveal>
        </div>
      </Section>

      {/* ── Why it exists ──────────────────────────────────────────────── */}
      <Section n="02" eyebrow="Why this exists"
               title="Three things go wrong when delivery and money live apart"
               lede="None of them is exotic. They happen when the board, the ledger and the tax position sit in different places and nobody owns the reconciliation.">
        <ol className="pb-list pb-list-num">
          {PROBLEMS.map(({ title, body }, i) => (
            <li key={title}>
              <span className="pb-n" aria-hidden="true">{i + 1}</span>
              <div>
                <h3 className="pb-h3s">{title}</h3>
                <p className="pb-body" style={{ marginTop: 8 }}>{body}</p>
              </div>
            </li>
          ))}
        </ol>
        {/* The second of those three, at the reader's own figure. */}
        <div style={{ marginTop: 'clamp(32px, 4vw, 48px)' }}>
          <Overstatement />
        </div>
      </Section>

      {/* ── The film ────────────────────────────────────────────────────── */}
      <Section n="03" eyebrow="The film" title="Half a minute of the product"
               lede="Recorded in the sample workspace. Watch it, or read the same ground as a walkthrough built from the sandbox's own figures.">
        <LazyMount className="ft-h-lazy-film">
          <Suspense fallback={null}><ProductFilm /></Suspense>
        </LazyMount>
      </Section>

      {/* ── Contents ───────────────────────────────────────────────────── */}
      <Section n="04" eyebrow="What is inside" title="Eleven modules, one set of records"
               lede="Every module reads the same rows, so a figure on the dashboard and a figure in a report cannot disagree.">
        <ol className="pb-list pb-h-index">
          {MODULES.map(({ id, title, points }, i) => (
            <li key={title}>
              <Link to={`/features#${id}`} className="pb-h-index-row">
                <span className="pb-n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                <span className="pb-h-index-t">{title}</span>
                <span className="pb-h-index-d">{points[0]}</span>
              </Link>
            </li>
          ))}
        </ol>
        <p style={{ marginTop: 20 }}>
          <Link to="/features" className="pb-link">All eleven modules, each on a real screen</Link>
        </p>
      </Section>

      {/* ── Read on ─────────────────────────────────────────────────────── */}
      <Section n="05" eyebrow="Read on" title="The rest of it, in three pages">
        <ul className="pb-list pb-cols">
          {READ_ON.map(([to, title, blurb]) => (
            <li key={to}>
              <h3 className="pb-h3s"><Link to={to} className="pb-h-readon">{title}</Link></h3>
              <p className="pb-body" style={{ marginTop: 8 }}>{blurb}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Closing title="Already have an account?"
               next={<Btn to="/faq" quiet>Read the questions</Btn>}>
        Sign in with email, Google or Zoho. An administrator approves each new
        account before it can see anything.
      </Closing>
    </PublicLayout>
  )
}
