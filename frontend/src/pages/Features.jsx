/**
 * Features — an explorer rather than a list.
 *
 * The landing page summarises the modules in a grid. Repeating that here in
 * longer form would be a second wall of cards, so this is built to be driven:
 * pick a module and the panel swaps to a working demonstration of it, on the
 * same sample ledger the sandbox runs on, with the screen it lives on one
 * click away.
 *
 * Keyboard-navigable because a tablist that only responds to a mouse is a
 * tablist that half the people using it cannot reach — arrow keys move, Home
 * and End jump, and the panel is wired to its tab.
 *
 * As with every public page: nothing here reads a workspace. Every figure is
 * sample data computed from demoData, or read off a capture of the sample
 * workspace, and each demo and screen says so.
 */
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Receipt, FolderKanban, BarChart3, FileSearch, Code2, Globe,
  Activity, Share2, ArrowRight, Check, Landmark, FileText, ShieldCheck,
} from 'lucide-react'
import { usePageMeta } from '../hooks/usePageMeta'
import { useInk } from '../hooks/useInk'
import { useReveal } from '../hooks/useReveal'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useReducedMotion } from '../hooks/useReducedMotion'
import PublicLayout from '../components/PublicLayout'
import { Head, PageHead, Closing } from '../components/PublicBits'
import { AnalystDemo, Grain } from '../components/LandingVisuals'
import { MODULES } from '../content/publicContent'
import AgingPreview from '../components/AgingPreview'
import TaxFlowSimulator from '../components/TaxFlowSimulator'
import ContractCitationInspector from '../components/ContractCitationInspector'
import RoiCalculator from '../components/RoiCalculator'
import ProjectMargins from '../components/features/ProjectMargins'
import AnalyticsTrend from '../components/features/AnalyticsTrend'
import ReportFormats from '../components/features/ReportFormats'
import KanbanMove from '../components/features/KanbanMove'
import SharedLinkDemo from '../components/features/SharedLinkDemo'
import GatewayRoute from '../components/features/GatewayRoute'
import ScreenCrop from '../components/features/ScreenCrop'
import ShippedStack from '../components/features/ShippedStack'
import LazyMount from '../components/motion/LazyMount'
import '../styles/public-features.css'

const ShippedShowcase = lazy(() => import('../components/features/ShippedShowcase'))

/* The Pages module's name comes from the shared list, so a rename there
   reaches this page's picker, its panel label and the overview together. */
const PAGES_LABEL = MODULES.find(m => m.visual === 'pages')?.title || 'Pages'

export const FEATURES = [
  {
    id: 'receivables', icon: Receipt, label: 'Invoices',
    headline: 'Know what is owed, how old it is, and what is missing',
    body: 'Invoices carry ageing bands, a collection rate and average days to collect. GST and TDS are separate figures, because tax withheld at source is not money a client still owes you — counting it as outstanding overstates what you can actually collect.',
    points: [
      'Ageing bands — 0-30, 31-60, 61-90, 90+ — clickable as filters',
      'Outstanding, collected and GST totals side by side',
      'Collection rate and average days to collect',
      'Follow-up load: due today, overdue, next follow-up date',
      'Missing docs — invoices with no PDF or payment reference',
      'Retainer templates for recurring monthly billing',
      'Filters on project, category, status and date; CSV export',
    ],
    demo: 'aging',
  },
  {
    id: 'projects', icon: FolderKanban, label: 'Projects',
    headline: 'Catch a job going underwater before it lands',
    body: 'Billed, cost and realised profit per project, with margin and a health signal. The point is to see a project turning bad while there is still something to do about it.',
    points: [
      'Amount billed, actual profit and profit percentage',
      'Health signals — at risk and critical surfaced first',
      'Client rollups and status distribution',
      'Per-project detail with its own invoice history',
      'Top projects by value, and projects running at negative margin',
    ],
    demo: 'margin',
  },
  {
    id: 'analytics', icon: BarChart3, label: 'Analytics',
    headline: 'Trends you can open, not just look at',
    body: 'Cash position, revenue and overdue pressure over time — and every chart is one click from the rows behind it, so a number you do not believe can be checked rather than argued about.',
    points: [
      'Cash position, revenue and outstanding over any period',
      'Collection rate and average days to collect as trends',
      'Overdue pressure and invoices cleared per month',
      'Signals worth noticing — outliers surfaced automatically',
      'Client, project and category breakdowns',
      'Live sync state, so you know how fresh the figures are',
      'Drill through to the underlying rows; CSV export',
    ],
    demo: 'bars',
  },
  {
    id: 'tax', icon: Landmark, label: 'Tax ledger',
    headline: 'GST, month by month, with a filing checklist',
    body: 'Gross billed, GST collected and net receivable per month and per client — kept separate from the collections view, so a filing figure is never confused with a cash figure.',
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
    id: 'documents', icon: FileSearch, label: 'Document intelligence',
    headline: 'Ask your contracts a question',
    body: 'Upload agreements and notes, then ask in plain words. Every answer carries numbered citations, and each one opens the passage and page it came from. An answer you cannot check is barely better than a guess.',
    points: [
      'PDF, text, Markdown, CSV, JSON and log files up to 15 MB',
      'Page-level citations you can open inline',
      'Answers verified against the sources before you see them',
      'Full-text search with meaning-based re-ranking where available',
      'States which retrieval is actually running, rather than implying one',
      'Conversations saved with their sources, and replayable',
    ],
    demo: 'docs',
  },
  {
    id: 'analyst', icon: Code2, label: 'Financial query engine',
    headline: 'It shows you the query it ran',
    body: 'Ask your invoices and projects a question. The model maps it onto a fixed set of measures and the code compiles the SQL — the model never writes SQL itself, and the statement is shown with every answer.',
    points: [
      'Plain-language questions over invoices and projects',
      'The compiled query is shown with every answer',
      'Measures include outstanding, collected, GST, TDS and collection rate',
      'Group by project, category, client, status, month or quarter',
      'Charts, tables or a single figure, chosen to fit the question',
      'Scoped to what your account may already see — never a way around a permission',
    ],
    demo: 'table',
  },
  {
    id: 'reports', icon: FileText, label: 'Executive reports',
    headline: 'A written report, and someone to ask',
    body: 'Generate a period report over your own figures, keep the history, and ask follow-up questions in a chat that already has the current context loaded.',
    points: [
      'Period reports generated over live figures',
      'Report history kept and re-openable',
      'Marked confidential for internal use',
      'Assistant with your current data as context',
      'Brief, detailed or board-style output',
      'A daily AI budget per role, reported honestly rather than guessed',
    ],
    demo: 'analyst',
  },
  {
    id: 'pages', icon: Globe, label: PAGES_LABEL, isNew: true,
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
    id: 'status', icon: Activity, label: 'Delivery & status',
    headline: 'Run the delivery, not just the invoice',
    body: 'This is the half people miss: a real project status board sitting on the same records as the money. A kanban board or an operational list, grouped however you work, updating live as anyone changes anything — including someone editing the underlying table directly rather than going through the app.',
    points: [
      'Kanban board or operational list, grouped by client, project or state',
      'Short status and a detailed note per project',
      'Live over an event stream — no refresh, no stale board',
      'Status options are a picklist you extend, not an enum we ship',
      'AI-drafted status updates from the current position',
      'Attachments on a status entry',
      'Bulk select, advanced filters, and share the view read-only',
    ],
    demo: 'board',
  },
  {
    id: 'shared', icon: Share2, label: 'Shared views',
    headline: 'Send a client a link, see what they opened',
    body: 'A filtered, read-only view on a link — with highlighting for the columns that matter, and analytics for what was actually looked at.',
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
    id: 'admin', icon: ShieldCheck, label: 'Admin & audit', isNew: true,
    headline: 'Every request recorded, every permission adjustable',
    body: 'User approval, a permission matrix down to the individual action, live sessions, and an audit trail written asynchronously so it never becomes the reason a page is slow. The AI gateway sits here too: which provider and model serve each AI task, and what each may spend today.',
    points: [
      'Approve, disable and delete accounts; assign roles',
      'Grant or revoke any single permission per person',
      'Live sessions with device, browser, country and ISP',
      'Full request audit — method, path, status, duration, referer',
      'Record-level change history with changed fields',
      'AI gateway: provider routes tried in order, daily caps, versioned prompts, a call log',
      'Gateway keys kept encrypted on the server; superadmin only',
      'Sync log, mirror health and deployment health checks',
    ],
    demo: 'audit',
  },
]

/* One demonstration per module, each on the sample ledger or a capture. The
   keys stay unique: a drawing beside a claim is read as part of the claim,
   so no two modules share one. */
const SHEET_SPOTS = [
  { x: 205, y: 302, label: 'Formula bar', body: '=D2+E2: the total is the amount plus its GST.' },
  { x: 480, y: 253, label: 'Number format', body: '₹ Rupee, with Indian digit grouping.' },
  { x: 897, y: 253, label: 'AutoSum', body: 'Sums the selection into the next cell.', side: 'left' },
  { x: 640, y: 455, label: 'Selection', body: 'The status bar sums it: Sum ₹15,94,180 · Count 15.' },
]
// The admin panel's own tabs, as the gateway capture shows them.
const ADMIN_TABS = ['Requests', 'Users & Sessions', 'Permissions', 'AI gateway', 'Insights', 'Sync', 'History', 'System Health']
function AdminDemo() {
  const ref = useReveal({ threshold: 0.2 })
  return (
    <div ref={ref} className="ft-f-demo">
      <p className="ft-f-kicker">The admin panel</p>
      <ul className="ft-f-chips ft-m-seq" aria-label="Admin panel tabs">
        {ADMIN_TABS.map((t, i) => (
          <li key={t} style={{ '--i': i }} data-on={t === 'AI gateway' ? '' : undefined}>{t}</li>
        ))}
      </ul>
      <GatewayRoute />
    </div>
  )
}
const DEMOS = {
  aging: () => <AgingPreview />,
  margin: () => <ProjectMargins />,
  bars: () => <AnalyticsTrend />,
  tax: () => <TaxFlowSimulator />,
  docs: () => <ContractCitationInspector />,
  table: () => <div className="ft-f-demo"><AnalystDemo /></div>,
  analyst: () => <ReportFormats />,
  pages: () => (
    <div className="ft-f-demo">
      <ScreenCrop id="sheet" crop={[0, 215, 1000, 420]} zoom spots={SHEET_SPOTS}
                  alt="The Pages spreadsheet editor with an invoice tracker: formula bar, ₹ formats and a status-bar sum, sample data"
                  caption="The spreadsheet editor in Pages, from the app. Sample data." />
    </div>
  ),
  board: () => <KanbanMove />,
  share: () => <SharedLinkDemo />,
  audit: () => <AdminDemo />,
}

const SAMPLE = 'From the sample workspace on the overview. Sample data.'
const APP = 'From the app, on sample data.'
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
    id: 'gateway-providers', crop: [117, 130, 1366, 830], caption: 'Admin → AI gateway, from the app. Sample data.', zoom: true,
    alt: 'The AI gateway: providers Groq and OpenRouter with their keys, connection checks and today’s usage against caps, sample data',
    spots: [
      { x: 245, y: 350, label: 'Gateway caps', body: 'Limits across every task and provider, reset at midnight IST.' },
      { x: 228, y: 641, label: 'Connection', body: 'A test asks the provider for its model list with the key in use.' },
    ],
  },
}

function ScreenView({ cfg }) {
  return (
    <div className="ft-f-demo">
      <ScreenCrop id={cfg.id} crop={cfg.crop} alt={cfg.alt} caption={cfg.caption} spots={cfg.spots} zoom={!!cfg.zoom} />
    </div>
  )
}

export default function Features() {
  const [active, setActive] = useState(0)
  const [view, setView] = useState('demo')
  const tabsRef = useRef([])
  const wide = useMediaQuery('(min-width: 1024px)')
  const reduced = useReducedMotion()
  const pickInk = useInk(active, { axis: wide ? 'y' : 'x' })
  const viewInk = useInk(view === 'demo' ? 0 : 1)

  usePageMeta({
    title: 'Features — FinTrack',
    description: 'Eleven modules — receivables, projects, tax ledger, analytics, documents, an AI analyst that shows the query it ran, reports, pages and spreadsheets, status, shared views and audit.',
  })

  const pick = useCallback((i) => { setActive(i); setView('demo') }, [])

  // Roving focus: arrows move between tabs, Home and End jump to the ends.
  const onKeyDown = useCallback((e) => {
    const last = FEATURES.length - 1
    let next = null
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = active === last ? 0 : active + 1
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = active === 0 ? last : active - 1
    if (e.key === 'Home') next = 0
    if (e.key === 'End') next = last
    if (next === null) return
    e.preventDefault()
    pick(next)
    tabsRef.current[next]?.focus({ preventScroll: true })
  }, [active, pick])

  // On a phone the picker is a row that scrolls sideways: bring the active
  // chip to the middle of it without scrolling the page.
  useEffect(() => {
    if (wide) return
    const row = pickInk.current, chip = tabsRef.current[active]
    if (!row || !chip || typeof row.scrollTo !== 'function') return
    const left = chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2
    row.scrollTo({ left: Math.max(0, left), behavior: reduced ? 'auto' : 'smooth' })
  }, [active, wide, reduced, pickInk])

  const f = FEATURES[active]
  const shot = SCREENS[f.id]

  return (
    <PublicLayout>
      <section className="relative overflow-hidden">
        <Grain />
        <PageHead eyebrow="Features"
                  lines={['Eleven modules,', <em key="em">one set of rows</em>]}
                  aside={<ShippedStack />}>
          Pick one to see it working. Every module reads the same records, so a
          figure on the dashboard and a figure in a report cannot disagree.
        </PageHead>
      </section>

      <section className="mx-auto px-4 sm:px-6 pb-16 sm:pb-24" style={{ maxWidth: 1120 }}>
        <div className="ft-explorer ft-f-explorer">
          {/* ── the picker ── */}
          <div className="ft-f-picker">
            <p className="ft-f-count" aria-hidden="true">
              <span>{String(active + 1).padStart(2, '0')}</span> / {FEATURES.length}
            </p>
            <div ref={pickInk} role="tablist" aria-orientation={wide ? 'vertical' : 'horizontal'}
                 aria-label="Modules" onKeyDown={onKeyDown} className="ft-m-ink ft-f-tabs">
              {FEATURES.map((item, i) => {
                const Icon = item.icon
                const on = i === active
                return (
                  <button
                    key={item.id}
                    ref={el => (tabsRef.current[i] = el)}
                    role="tab"
                    id={`tab-${item.id}`}
                    aria-selected={on}
                    aria-controls={`panel-${item.id}`}
                    tabIndex={on ? 0 : -1}
                    onClick={() => pick(i)}
                    className="ft-f-tab"
                  >
                    <Icon size={16} aria-hidden="true" />
                    <span>{item.label}</span>
                    {item.isNew && <span className="ft-f-new">New</span>}
                  </button>
                )
              })}
              <span className="ft-m-ink-bar ft-m-ink-pill" aria-hidden="true" />
              <span className="ft-m-ink-bar" aria-hidden="true" />
            </div>
          </div>

          {/* ── the panel ── */}
          <div
            role="tabpanel"
            id={`panel-${f.id}`}
            aria-labelledby={`tab-${f.id}`}
            key={f.id}
            className="ft-f-panel"
          >
            <div className="ft-f-panel-head">
              <h2 className="ft-display">{f.headline}</h2>
              {shot && (
                <div ref={viewInk} className="ft-m-ink ft-f-seg" role="group" aria-label="Show">
                  <button type="button" aria-pressed={view === 'demo'} onClick={() => setView('demo')}>Demo</button>
                  <button type="button" aria-pressed={view === 'screen'} onClick={() => setView('screen')}>Screen</button>
                  <span className="ft-m-ink-bar ft-m-ink-pill" aria-hidden="true" />
                </div>
              )}
            </div>

            <p className="m-0 mb-4 text-[14px] leading-relaxed text-[var(--text-2)]">{f.body}</p>

            <div className="ft-f-stage">
              {view === 'screen' && shot ? (
                <div key="screen" className="ft-f-swap"><ScreenView cfg={shot} /></div>
              ) : (
                <div key="demo" className="ft-f-swap" role="group"
                     aria-label={`${f.label}: interactive demo with sample data`}>
                  {DEMOS[f.demo]()}
                </div>
              )}
            </div>

            <ul className="ft-f-points">
              {f.points.map(p => (
                <li key={p} className="flex gap-2 text-[13px] leading-snug text-[var(--text-2)]">
                  <Check size={14} aria-hidden="true" className="shrink-0 mt-0.5 text-[var(--accent-ink)]" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Lazy: the section and its media load when the reader is near, and
          the anchor exists before them, so /features#shipped still lands. */}
      <LazyMount id="shipped" className="ft-f-shipped-slot" rootMargin="250px 0px">
        <Suspense fallback={null}><ShippedShowcase /></Suspense>
      </LazyMount>

      <section className="mx-auto px-4 sm:px-6 pb-16 sm:pb-24" style={{ maxWidth: 1120 }}>
        <Head eyebrow="Your own numbers" title="What slow collections cost you">
          Set your own billing, your days to collect and what money costs you. The arithmetic is
          written out beside every result, and none of it is a promise about FinTrack.
        </Head>
        <RoiCalculator />
      </section>

      <Closing title="See it on your own numbers"
               cta={<Link to="/login" className="ft-btn inline-flex items-center justify-center gap-2 rounded-xl font-bold"
                          style={{ minHeight: 52, padding: '0 30px', background: '#fff',
                                   color: 'var(--accent-btn)', textDecoration: 'none', fontSize: '0.975rem' }}>
                      Sign in <ArrowRight size={17} aria-hidden="true" />
                    </Link>}
               next={<Link to="/how-it-works" className="ft-btn inline-flex items-center justify-center gap-2 rounded-xl font-bold"
                           style={{ minHeight: 52, padding: '0 24px', background: 'rgba(255,255,255,0.14)',
                                    border: '1px solid rgba(255,255,255,0.4)', color: '#fff',
                                    textDecoration: 'none', fontSize: '0.95rem' }}>
                        Next: how it works <ArrowRight size={15} aria-hidden="true" />
                      </Link>}>
        Access is by invitation — an administrator approves each account, and
        nothing on these public pages is read from a workspace.
      </Closing>
    </PublicLayout>
  )
}
