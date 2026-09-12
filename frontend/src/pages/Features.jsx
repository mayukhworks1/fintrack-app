/**
 * Features — an explorer rather than a list.
 *
 * The landing page summarises the modules in a grid. Repeating that here in
 * longer form would be a second wall of cards, so this is built to be driven:
 * pick a module on the left and the panel on the right swaps, with a working
 * demonstration of that module rather than a paragraph about it.
 *
 * Keyboard-navigable because a tablist that only responds to a mouse is a
 * tablist that half the people using it cannot reach — arrow keys move, Home
 * and End jump, and the panel is wired to its tab.
 *
 * As with every public page: nothing here reads a workspace. Each demo is
 * invented data, and the panels that show figures are marked so a screen
 * reader does not read them out as real.
 */
import { useCallback, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Receipt, FolderKanban, BarChart3, FileSearch, Sparkles, Globe,
  Activity, Share2, ArrowRight, Check,
} from 'lucide-react'
import { usePageMeta } from '../hooks/usePageMeta'
import { useReveal } from '../hooks/useReveal'
import { useTilt } from '../hooks/useTilt'
import PublicLayout from '../components/PublicLayout'
import {
  AnalystDemo, MiniBars, MiniLine, MiniDonut, MiniDocs, Grain,
} from '../components/LandingVisuals'
import AgingPreview from '../components/AgingPreview'

const FEATURES = [
  {
    id: 'receivables', icon: Receipt, label: 'Receivables',
    headline: 'Know what is owed, and how old it is',
    body: 'Invoices carry aging bands, a collection rate, and GST and TDS as separate figures. Tax withheld at source is not money a client still owes you, and counting it as outstanding overstates what you can actually collect.',
    points: ['Aging bands you can filter by', 'Collection rate on one axis', 'GST and TDS kept apart', 'Follow-up dates and remarks'],
    demo: 'aging',
  },
  {
    id: 'projects', icon: FolderKanban, label: 'Projects',
    headline: 'Catch a job going underwater before it lands',
    body: 'Billed, cost and realised profit per project, with margin and a health signal. The point is to see a project turning bad while there is still something to do about it.',
    points: ['Profit and margin per project', 'Health signals', 'Client rollups', 'Status distribution'],
    demo: 'donut',
  },
  {
    id: 'analytics', icon: BarChart3, label: 'Analytics',
    headline: 'Trends you can open',
    body: 'Months, clients and categories over time — and every chart is one click from the rows behind it, so a number you do not believe can be checked rather than argued about.',
    points: ['Monthly and quarterly trends', 'Client and category breakdowns', 'Drill through to rows', 'CSV export'],
    demo: 'line',
  },
  {
    id: 'documents', icon: FileSearch, label: 'Studio — documents',
    headline: 'Ask your contracts a question',
    body: 'Upload agreements and notes, then ask in plain words. Every answer carries numbered citations, and each one opens the passage and page it came from. An answer you cannot check is barely better than a guess.',
    points: ['PDF, text, Markdown, CSV, JSON', 'Page-level citations', 'Answers verified against sources', 'Says which retrieval is running'],
    demo: 'docs',
  },
  {
    id: 'analyst', icon: Sparkles, label: 'Studio — finance data',
    headline: 'It shows you the query it ran',
    body: 'Ask your invoices and projects a question. The model maps it onto a fixed set of measures and the code compiles the SQL — the model never writes SQL itself, and the statement is shown with every answer.',
    points: ['Plain-language questions', 'The compiled query is always visible', 'Charts, tables and single figures', 'Scoped to what your account may see'],
    demo: 'analyst',
  },
  {
    id: 'pages', icon: Globe, label: 'Pages',
    headline: 'Describe a page, watch it get written',
    body: 'The generator streams as it works, so you see the page appear rather than a spinner. Revisions edit the document in place instead of regenerating it, so the parts you did not mention stay exactly as they were.',
    points: ['Streamed as it writes', 'Surgical revisions, not regeneration', 'Publish on a slug', 'Password and expiry'],
    demo: 'bars',
  },
  {
    id: 'status', icon: Activity, label: 'Status board',
    headline: 'Where everything stands, without asking',
    body: 'A live view per client and project, kept current by webhooks rather than by someone remembering to update a sheet.',
    points: ['Per-client status', 'Attachments', 'Near-real-time updates', 'Shareable'],
    demo: 'bars',
  },
  {
    id: 'shared', icon: Share2, label: 'Shared views',
    headline: 'Send a client a link, see what they opened',
    body: 'A filtered, read-only view on a link — with highlighting for the columns that matter, and analytics for what was actually looked at.',
    points: ['Read-only links', 'Column highlighting', 'View and open analytics', 'Revocable'],
    demo: 'line',
  },
]

const DEMOS = {
  aging:   <AgingPreview />,
  analyst: <AnalystDemo />,
  bars:    <div className="px-2 py-6"><MiniBars /></div>,
  line:    <div className="px-2 py-6"><MiniLine /></div>,
  donut:   <div className="flex justify-center py-6"><MiniDonut pct={68} /></div>,
  docs:    <div className="flex justify-center py-6"><MiniDocs /></div>,
}

export default function Features() {
  const [active, setActive] = useState(0)
  const tabsRef = useRef([])
  usePageMeta({
    title: 'Features — FinTrack',
    description: 'Receivables, projects, analytics, and an AI analyst that shows the query it ran. Explore every module.',
  })

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
    setActive(next)
    tabsRef.current[next]?.focus()
  }, [active])

  const f = FEATURES[active]
  const panelTilt = useTilt({ max: 3 })
  const headRef = useReveal()

  return (
    <PublicLayout>
      <section className="relative overflow-hidden">
        <div className="ft-aurora" aria-hidden="true"><span /><span /></div>
        <Grain />
        <div ref={headRef} className="ft-reveal relative mx-auto px-4 sm:px-6 pt-12 pb-8 sm:pt-16"
             style={{ maxWidth: 1120, zIndex: 1 }}>
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] mb-2"
             style={{ color: 'var(--accent)' }}>Features</p>
          <h1 className="font-extrabold tracking-tight mb-4"
              style={{ fontSize: 'clamp(1.9rem, 5.5vw, 3rem)', letterSpacing: '-0.03em', lineHeight: 1.1 }}>
            Eight modules, one set of rows
          </h1>
          <p style={{ fontSize: 'clamp(0.95rem, 2vw, 1.125rem)', lineHeight: 1.6,
                      color: 'var(--text-2)', maxWidth: 620 }}>
            Pick one to see what it does. Every module reads the same records, so a
            figure on the dashboard and a figure in a report cannot disagree.
          </p>
        </div>
      </section>

      <section className="mx-auto px-4 sm:px-6 pb-16 sm:pb-24" style={{ maxWidth: 1120 }}>
        <div className="grid gap-5 lg:gap-7"
             style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
          <div className="ft-explorer">
            {/* ── the picker ── */}
            <div role="tablist" aria-orientation="vertical" aria-label="Modules"
                 onKeyDown={onKeyDown}
                 className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0">
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
                    onClick={() => setActive(i)}
                    className="flex items-center gap-2.5 rounded-xl text-left shrink-0"
                    style={{
                      minHeight: 48, padding: '0 14px',
                      background: on ? 'var(--accent-dim)' : 'var(--card-bg)',
                      border: `1px solid ${on ? 'var(--accent-soft)' : 'var(--card-border)'}`,
                      color: on ? 'var(--accent)' : 'var(--text-2)',
                      cursor: 'pointer',
                      fontWeight: on ? 700 : 600,
                      fontSize: 13,
                      whiteSpace: 'nowrap',
                      transition: 'background 200ms ease, border-color 200ms ease, color 200ms ease',
                    }}
                  >
                    <Icon size={16} aria-hidden="true" />
                    {item.label}
                  </button>
                )
              })}
            </div>

            {/* ── the panel ── */}
            <div
              ref={panelTilt}
              role="tabpanel"
              id={`panel-${f.id}`}
              aria-labelledby={`tab-${f.id}`}
              // Re-keyed on the active id so React remounts it and the entrance
              // animation plays on every switch, not just the first.
              key={f.id}
              className="tilt tilt-sheen rounded-2xl p-5 sm:p-7"
              style={{
                background: 'var(--card-bg)',
                border: '1px solid var(--card-border)',
                boxShadow: 'var(--card-shadow)',
                animation: 'ft-panel-in 460ms cubic-bezier(0.22,1,0.36,1) both',
              }}
            >
              <h2 className="font-extrabold tracking-tight mb-3"
                  style={{ fontSize: 'clamp(1.25rem, 3vw, 1.75rem)', letterSpacing: '-0.02em' }}>
                {f.headline}
              </h2>
              <p className="text-sm sm:text-[15px] leading-relaxed mb-5"
                 style={{ color: 'var(--text-2)' }}>
                {f.body}
              </p>

              <div className="rounded-xl overflow-hidden mb-5" aria-hidden="true"
                   style={{ background: 'var(--bg-base)', border: '1px solid var(--card-border)' }}>
                {DEMOS[f.demo]}
              </div>

              <ul className="grid gap-2 m-0 p-0" style={{
                listStyle: 'none',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
              }}>
                {f.points.map(p => (
                  <li key={p} className="flex items-start gap-2 text-[13px]"
                      style={{ color: 'var(--text-2)' }}>
                    <Check size={14} aria-hidden="true"
                           style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto px-4 sm:px-6 pb-16 sm:pb-24" style={{ maxWidth: 1120 }}>
        <div className="rounded-3xl px-6 py-12 sm:px-12 sm:py-14 text-center"
             style={{ background: 'linear-gradient(135deg, var(--accent-btn), var(--accent-bright))', color: '#fff' }}>
          <h2 className="font-extrabold tracking-tight mb-3"
              style={{ fontSize: 'clamp(1.4rem, 4vw, 2.2rem)', letterSpacing: '-0.02em' }}>
            See it on your own numbers
          </h2>
          <p className="mx-auto mb-7" style={{ fontSize: '0.975rem', lineHeight: 1.6, opacity: 0.92, maxWidth: 440 }}>
            Access is by invitation — an administrator approves each account.
          </p>
          <Link to="/login"
                className="inline-flex items-center justify-center gap-2 rounded-xl font-bold"
                style={{ minHeight: 52, padding: '0 30px', background: '#fff',
                         color: 'var(--accent-btn)', textDecoration: 'none', fontSize: '0.975rem' }}>
            Sign in <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </section>
    </PublicLayout>
  )
}
