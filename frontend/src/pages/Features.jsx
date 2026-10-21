/**
 * Features: the eleven modules, one after another, each on a real screen.
 *
 * Set as a long document rather than a picker: a contents list at the top,
 * then one section per module with its headline, what it does, a capture
 * of the screen it lives on (cropped to the part that matters, with numbered
 * notes), and the list of what it carries. Modules with no capture worth
 * showing say what they do in words, and nothing is drawn in their place.
 *
 * Nothing here reads a workspace. Every capture is of the sample workspace,
 * and each caption says so.
 */
import { Suspense, lazy } from 'react'
import { usePageMeta } from '../hooks/usePageMeta'
import PublicLayout from '../components/PublicLayout'
import { PageHead, Section, Plate, Reveal, Btn, Closing } from '../components/PublicBits'
import { MODULES } from '../content/publicContent'
import RoiCalculator from '../components/RoiCalculator'
import LazyMount from '../components/motion/LazyMount'
import '../styles/public-features.css'

const ShippedShowcase = lazy(() => import('../components/features/ShippedShowcase'))

/* The Pages module's name comes from the shared list, so a rename there
   reaches this page's contents, its section and the overview together. */
const PAGES_LABEL = MODULES.find(m => m.visual === 'pages')?.title || 'Pages'

export const FEATURES = [
  {
    id: 'receivables', label: 'Invoices',
    headline: 'Know what is owed, how old it is, and what is missing',
    body: 'Invoices carry ageing bands, a collection rate and average days to collect. GST and TDS are separate figures. Tax withheld at source is money the client will never pay you, so counting it as outstanding overstates what you can collect.',
    points: [
      'Ageing bands of 0-30, 31-60, 61-90 and 90+ days, each a filter',
      'Outstanding, collected and GST totals side by side',
      'Collection rate and average days to collect',
      'Follow-up load: due today, overdue, next follow-up date',
      'Missing documents: invoices with no PDF or payment reference',
      'Retainer templates for recurring monthly billing',
      'Filters on project, category, status and date; CSV export',
    ],
    demo: 'aging',
  },
  {
    id: 'projects', label: 'Projects',
    headline: 'Catch a job going underwater before it lands',
    body: 'Billed, cost and realised profit per project, with margin and a health signal. The point is to see a project turning bad while there is still something to do about it.',
    points: [
      'Amount billed, actual profit and profit percentage',
      'Health signals, with at-risk and critical projects first',
      'Client rollups and status distribution',
      'Per-project detail with its own invoice history',
      'Top projects by value, and projects running at negative margin',
    ],
    demo: 'margin',
  },
  {
    id: 'analytics', label: 'Analytics',
    headline: 'Trends that open to the rows behind them',
    body: 'Cash position, revenue and overdue amounts over time. Every chart is one click from the rows behind it, so a number you doubt can be checked.',
    points: [
      'Cash position, revenue and outstanding over any period',
      'Collection rate and average days to collect as trends',
      'Overdue pressure and invoices cleared per month',
      'Outliers flagged for a second look',
      'Client, project and category breakdowns',
      'Live sync state, so you know how fresh the figures are',
      'Drill through to the underlying rows; CSV export',
    ],
    demo: 'bars',
  },
  {
    id: 'tax', label: 'Tax ledger',
    headline: 'GST, month by month, with a filing checklist',
    body: 'Gross billed, GST collected and net receivable per month and per client, kept apart from the collections view so a filing figure is never read as a cash figure.',
    points: [
      'Gross billed, GST amount and net received per month',
      'GST collection rate',
      'Monthly breakdown by client and project',
      'Filing checklist for the period',
      'Net receivable after tax',
    ],
    demo: 'tax',
  },
  {
    id: 'documents', label: 'Document intelligence',
    headline: 'Ask your contracts a question',
    body: 'Upload agreements and notes, then ask in plain words. Every answer carries numbered citations, and each one opens the passage and page it came from.',
    points: [
      'PDF, text, Markdown, CSV, JSON and log files up to 15 MB',
      'Page-level citations you can open inline',
      'Answers verified against the sources before you see them',
      'Full-text search with meaning-based re-ranking where available',
      'Says which retrieval is actually running',
      'Conversations saved with their sources, and replayable',
    ],
    demo: 'docs',
  },
  {
    id: 'analyst', label: 'Financial query engine',
    headline: 'It shows you the query it ran',
    body: 'Ask your invoices and projects a question. The model maps it onto a fixed set of measures and the application compiles the SQL. The model never writes SQL, and the statement is shown with every answer.',
    points: [
      'Plain-language questions over invoices and projects',
      'The compiled query is shown with every answer',
      'Measures include outstanding, collected, GST, TDS and collection rate',
      'Group by project, category, client, status, month or quarter',
      'Charts, tables or a single figure, chosen to fit the question',
      'Limited to the rows your account may already see',
    ],
    demo: 'table',
  },
  {
    id: 'reports', label: 'Executive reports',
    headline: 'A written report, and someone to ask',
    body: 'Generate a period report over your own figures, keep the history, and ask follow-up questions in a chat that already has the current context loaded.',
    points: [
      'Period reports generated over live figures',
      'Report history kept and re-openable',
      'Marked confidential for internal use',
      'Assistant with your current data as context',
      'Brief, detailed or board-style output',
      'A daily budget per role, shown as it is spent',
    ],
    demo: 'analyst',
  },
  {
    id: 'pages', label: PAGES_LABEL, isNew: true,
    headline: 'Write a page or a sheet, publish it on a link',
    body: 'Pages keeps documents and spreadsheets in folders. The spreadsheet editor has formulas, AutoSum and ₹ number formats; publish either on a link with an optional password, protection code and expiry in IST. Chat apps show a preview card, and each page keeps its views per day, device and country.',
    points: [
      'Spreadsheet editor: formulas, AutoSum, ₹ number formats',
      'Folders and search across pages and sheets',
      'Password, protection code and expiry (IST) on any link',
      'Version history; CSV in and out',
      'Link previews in chat apps',
      'Views per day, device and country for each page',
      'Describe a page and it is written as you watch; revisions edit in place',
    ],
    demo: 'pages',
  },
  {
    id: 'status', label: 'Delivery & status',
    headline: 'Run the delivery from the same records as the invoices',
    body: 'A project status board on the same records as the money. A kanban board or an operational list, grouped however you work, updated live as anyone changes anything, including someone editing the underlying table directly.',
    points: [
      'Kanban board or operational list, grouped by client, project or state',
      'Short status and a detailed note per project',
      'Live over an event stream, with no refresh',
      'Status options are a picklist you extend',
      'Drafted status updates from the current position',
      'Attachments on a status entry',
      'Bulk select, advanced filters, and share the view read-only',
    ],
    demo: 'board',
  },
  {
    id: 'shared', label: 'Shared views',
    headline: 'Send a client a link, see what they opened',
    body: 'A filtered, read-only view on a link, with the columns that matter highlighted and a record of what was opened.',
    points: [
      'Read-only links with your filters baked in',
      'Highlight the columns you want read first',
      'Unique viewers, page views, record opens, attachment opens',
      'Location and device breakdown, and an event timeline',
      'Revocable at any time',
    ],
    demo: 'share',
  },
  {
    id: 'admin', label: 'Admin & audit', isNew: true,
    headline: 'Every request recorded, every permission adjustable',
    body: 'User approval, a permission matrix down to the individual action, live sessions, and an audit trail written asynchronously so it never becomes the reason a page is slow. The AI gateway sits here too: which provider and model serve each AI task, and what each may spend today.',
    points: [
      'Approve, disable and delete accounts; assign roles',
      'Grant or revoke any single permission per person',
      'Live sessions with device, browser, country and ISP',
      'Full request audit: method, path, status, duration, referer',
      'Record-level change history with changed fields',
      'AI gateway: provider routes tried in order, daily caps, versioned prompts, a call log',
      'Gateway keys kept encrypted on the server; superadmin only',
      'Sync log, mirror health and deployment health checks',
    ],
    demo: 'audit',
  },
]


const SAMPLE = 'From the sample workspace on the overview. Sample data.'
const SCREENS = {
  receivables: {
    id: 'invoices', crop: [246, 80, 1330, 825], caption: SAMPLE,
    alt: 'The invoices screen: outstanding, collected and overdue totals above the invoice list, sample data',
    spots: [
      { x: 1290, y: 157, label: 'Overdue', body: 'Open invoices past their due date.', side: 'left' },
      { x: 905, y: 214, label: 'Status filters', body: 'Overdue, sent and paid narrow the list in place.' },
    ],
  },
  projects: {
    id: 'projects', crop: [248, 378, 1327, 564], caption: SAMPLE,
    alt: 'A project card for Site rebuild: billed, cost, profit and a 76% margin over its four invoices, sample data',
    spots: [
      { x: 1470, y: 399, label: 'Health', body: 'Healthy, watch or at risk, from the margin.', side: 'left' },
      { x: 1395, y: 607, label: 'Margin', body: 'Billed less cost, over billed.', side: 'left' },
    ],
  },
  analytics: {
    id: 'analytics', crop: [248, 272, 1327, 443], caption: SAMPLE,
    alt: 'The analytics chart: billed per month as bars and settled inflow as a line, sample data',
    spots: [
      { x: 545, y: 470, label: 'Billed', body: 'What was invoiced in each month.' },
      { x: 1030, y: 610, label: 'Settled inflow', body: 'What was collected in each month.', side: 'top' },
    ],
  },
  documents: {
    id: 'studio', crop: [246, 75, 1330, 530], caption: SAMPLE,
    alt: 'Studio documents: four uploaded agreements, each indexed, sample data',
    spots: [{ x: 1452, y: 240, label: 'Indexed', body: 'A document is indexed before it can be asked about.', side: 'left' }],
  },
  analyst: {
    id: 'assistant', crop: [246, 125, 1330, 600], caption: SAMPLE,
    alt: 'The assistant: a question, the compiled SQL query and the answer as bars by client, sample data',
    spots: [
      { x: 700, y: 262, label: 'Compiled query', body: 'Written by the application from a measure and a grouping.' },
      { x: 1100, y: 563, label: 'The answer', body: 'Outstanding by client, from the query above.', side: 'left' },
    ],
  },
  pages: {
    id: 'sheet-public', crop: [180, 30, 1240, 690], caption: 'The published sheet, from the app. Sample data.', zoom: true,
    alt: 'A published Invoice tracker sheet with search, CSV download and totals, sample data',
    spots: [{ x: 1262, y: 240, label: 'Download CSV', body: 'Anyone with the link can search the rows and take a copy.', side: 'left' }],
  },
  status: {
    id: 'status', crop: [246, 80, 1330, 580], caption: SAMPLE,
    alt: 'The status board by status: projects in lanes, each with what it is still owed, sample data',
    spots: [
      { x: 600, y: 316, label: 'Owed, on the card', body: 'What the project is still owed, from its invoices.' },
      { x: 1503, y: 100, label: 'Share view', body: 'The board as a read-only link.', side: 'left' },
    ],
  },
  admin: {
    id: 'gateway-providers', crop: [117, 130, 1366, 830], caption: 'Admin, AI gateway, from the app. Sample data.', zoom: true,
    alt: 'The AI gateway: providers Groq and OpenRouter with their keys, connection checks and today’s usage against caps, sample data',
    spots: [
      { x: 245, y: 350, label: 'Gateway caps', body: 'Limits across every task and provider, reset at midnight IST.' },
      { x: 228, y: 641, label: 'Connection', body: 'A test asks the provider for its model list with the key in use.' },
    ],
  },
}


SCREENS.tax = {
  id: 'tax', crop: [246, 76, 1330, 870], caption: SAMPLE,
  alt: 'The tax ledger: taxable value, GST, TDS withheld and net receivable, with GST and TDS by client, sample data',
  spots: [
    { x: 1360, y: 190, label: 'TDS withheld', body: 'Deducted by clients at source; reported, never counted as owed.' },
    { x: 330, y: 732, label: 'By client', body: 'Taxable value, GST and TDS for each client.' },
  ],
}

function Module({ f, n }) {
  const shot = SCREENS[f.id]
  return (
    <section id={f.id} className="pb-section pb-f-module" aria-labelledby={`${f.id}-label`}>
      <div className="pb-wrap">
        <div className="pb-row">
          <div className="pb-margin">
            <p className="pb-label" id={`${f.id}-label`}>
              <span className="pb-n">{String(n).padStart(2, '0')}</span>{f.label}
              {f.isNew && <span className="pb-f-new">New</span>}
            </p>
          </div>
          <div className="pb-main">
            <Reveal style={{ maxWidth: '40em' }}>
              <h2 className="pb-h2">{f.headline}</h2>
              <p className="pb-body" style={{ marginTop: 16, fontSize: '1.0625rem' }}>{f.body}</p>
            </Reveal>
            {shot && (
              <Reveal style={{ marginTop: 'clamp(28px, 4vw, 48px)' }}>
                <Plate id={shot.id} crop={shot.crop} alt={shot.alt} fig={n}
                       caption={shot.caption} notes={shot.spots} />
              </Reveal>
            )}
            <ul className="pb-points pb-f-points" aria-label={`${f.label}: what it carries`}>
              {f.points.map(p => <li key={p}>{p}</li>)}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}

export default function Features() {
  usePageMeta({
    title: 'Features | FinTrack',
    description: 'Eleven modules on one set of records: receivables, projects, tax ledger, analytics, documents, an analyst that shows the query it ran, reports, pages and spreadsheets, status, shared views and audit.',
  })

  return (
    <PublicLayout>
      <PageHead eyebrow="Features" lines={['Eleven modules,', <em key="em">one set of rows</em>]}>
        Every module reads the same records, so a figure on the dashboard and a
        figure in a report cannot disagree. Each one below is shown on the
        screen it lives on, from the sample workspace.
      </PageHead>

      <nav className="pb-wrap pb-f-contents" aria-label="Modules on this page">
        <div className="pb-row">
          <div className="pb-margin"><p className="pb-label">Contents</p></div>
          <ol className="pb-main pb-f-toc">
            {FEATURES.map((f, i) => (
              <li key={f.id}>
                <a href={`#${f.id}`}>
                  <span className="pb-n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                  {f.label}
                </a>
              </li>
            ))}
          </ol>
        </div>
      </nav>

      {FEATURES.map((f, i) => <Module key={f.id} f={f} n={i + 1} />)}

      {/* Lazy: the section and its media load when the reader is near, and
          the anchor exists before them, so /features#shipped still lands. */}
      <LazyMount id="shipped" className="ft-f-shipped-slot" rootMargin="250px 0px">
        <Suspense fallback={null}><ShippedShowcase /></Suspense>
      </LazyMount>

      <Section n="12" eyebrow="Your own numbers" wide
               title="What slow collections cost you"
               lede="Set your own billing, your days to collect and what money costs you. The arithmetic is written out beside every result, and none of it is a promise about FinTrack.">
        <div className="pb-instrument"><RoiCalculator /></div>
      </Section>

      <Closing title="See it on your own numbers"
               next={<Btn to="/how-it-works" quiet>Next: how it works</Btn>}>
        Access is by invitation. An administrator approves each account, and
        nothing on these public pages is read from a workspace.
      </Closing>
    </PublicLayout>
  )
}
