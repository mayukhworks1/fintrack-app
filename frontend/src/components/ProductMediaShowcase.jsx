import { useState, useRef, useEffect } from 'react'
import {
  Sparkles,
  Receipt, FolderKanban, ShieldCheck, Check, X,
  ArrowRight, Activity
} from 'lucide-react'
import { useTilt } from '../hooks/useTilt'
import LoopVideo from './LoopVideo'

const SHOWCASE_ITEMS = [
  {
    id: 'tax-ledger',
    label: 'Tax Ledger & AI Insights',
    tag: '3D Architecture',
    icon: Receipt,
    title: 'Single-ledger architecture for delivery & tax compliance',
    desc: 'Binds milestone delivery status directly to GST, TDS, and invoice aging. Eliminates end-of-month reconciliation discrepancies between project managers and accounting.',
    video: '/media/pomelli_photoshoot-5.mp4',
    highlights: [
      'Automatic GST & TDS segregation at source',
      'Real-time cashflow vs tax liability breakdown',
      'Zero database drift with upstream bases',
      'Continuous client-wise historical audit',
    ],
    metric: { label: 'Reconciliation Latency', value: '< 30s' },
  },
  {
    id: 'ai-analyst',
    label: 'Autonomous Financial Analyst',
    tag: 'Verified Intelligence',
    icon: Sparkles,
    title: 'Natural language queries compiled into verifiable SQL',
    desc: 'Ask complex financial questions and get exact answers accompanied by the exact parameterized SQL statement. Zero hallucination by mathematical construction.',
    video: '/media/pomelli_photoshoot-5.mp4',
    highlights: [
      'AST-compiled parameterized Postgres queries',
      'Instant aging and overdue client cohorts',
      'Row-level permission scoping at query assembly',
      'Exportable tabular proofs and charts',
    ],
    metric: { label: 'Query Verifiability', value: '100%' },
  },
  {
    id: 'delivery-board',
    label: 'Project Delivery & Kanban',
    tag: 'Live Operations',
    icon: FolderKanban,
    title: 'Operations and cashflow unified on the same records',
    desc: 'Kanban status board updating via Server-Sent Events in real time. Project health, burn rate, and billing readiness visible to every stakeholder.',
    video: '/media/pomelli_photoshoot-6.mp4',
    highlights: [
      'Live SSE streaming — zero manual refresh',
      'Margin and burn rate tracking per deliverable',
      'At-risk milestones surfaced automatically',
      'Customizable workflow states and categories',
    ],
    metric: { label: 'Sync Mechanism', value: 'Live SSE' },
  },
  {
    id: 'security-audit',
    label: 'RBAC & Audit Telemetry',
    tag: 'Enterprise Security',
    icon: ShieldCheck,
    title: 'Cryptographic permissions & asynchronous audit trails',
    desc: 'Eight built-in roles with per-action overrides. Every API request and query is recorded asynchronously with IP, device, and timing telemetry.',
    video: '/media/pomelli_photoshoot-7.mp4',
    highlights: [
      'Granular 8-role matrix with custom overrides',
      'Sandboxed external client sharing links',
      'Non-blocking async telemetry pipeline',
      'Full compliance checklist and change log',
    ],
    metric: { label: 'Access Control', value: '8 Roles' },
  },
]

export default function ProductMediaShowcase() {
  const [activeIdx, setActiveIdx] = useState(0)
  // One view only: the loop. The still blueprint and the switcher between
  // them are gone — a toggle whose two sides show the same subject is a
  // decision handed to the reader for no reason, and on a phone the three
  // controls broke onto their own rows.
  const videoRef = useRef(null)
  const frameTilt = useTilt({ max: 4 })

  const current = SHOWCASE_ITEMS[activeIdx]

  // Switching tab restarts the loop from the top, so the new subject is not
  // joined halfway through someone else's motion.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = 0
    v.play().catch(() => {})
  }, [activeIdx])

  return (
    <div className="w-full">
      {/* ── Main Showcase Container ─────────────────────────────────── */}
      <div
        className="rounded-3xl p-6 sm:p-8 lg:p-10 transition-all duration-300"
        style={{
          background: 'var(--card-bg)',
          border: '1px solid var(--card-border)',
          boxShadow: 'var(--card-shadow)',
        }}
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
          
          {/* ── Left Column: Interactive Tab Selector & Content ───────── */}
          <div className="lg:col-span-6 flex flex-col justify-between">
            {/* Quick Navigation Pills */}
            <div className="flex flex-wrap gap-2 mb-6">
              {SHOWCASE_ITEMS.map((item, idx) => {
                const Icon = item.icon
                const isSelected = idx === activeIdx
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveIdx(idx)}
                    className="flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all duration-200"
                    style={{
                      background: isSelected ? 'var(--accent-dim)' : 'var(--bg-input)',
                      border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--card-border)'}`,
                      color: isSelected ? 'var(--accent)' : 'var(--text-2)',
                      boxShadow: isSelected ? '0 2px 8px var(--accent-glow)' : 'none',
                    }}
                  >
                    <Icon size={14} />
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </div>

            {/* Feature Description Card */}
            <div className="mb-6">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider mb-3"
                   style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                <Sparkles size={12} />
                {current.tag}
              </div>
              <h3 className="ft-display text-xl sm:text-2xl lg:text-[1.65rem] mb-3"
                  style={{ color: 'var(--text-1)', lineHeight: 1.2 }}>
                {current.title}
              </h3>
              <p className="text-sm leading-relaxed mb-6" style={{ color: 'var(--text-2)' }}>
                {current.desc}
              </p>

              {/* Bulleted Points */}
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-6 p-0 list-none">
                {current.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2 text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                    <Check size={14} className="shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>

              {/* Metric Box */}
              <div className="flex items-center gap-4 pt-4 border-t" style={{ borderColor: 'var(--card-border)' }}>
                <div className="rounded-xl px-4 py-2 text-left" style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                  <span className="block text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>{current.metric.label}</span>
                  <span className="font-extrabold text-base tracking-tight" style={{ color: 'var(--accent)' }}>{current.metric.value}</span>
                </div>
                <div className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>
                  A rendered illustration, not a screenshot &mdash; its figures are
                  artwork. The working numbers are in the sandbox above.
                </div>
              </div>
            </div>
          </div>

          {/* ── Right Column: Clean 3D Framed Device / Visualizer ─────── */}
          <div className="lg:col-span-6 flex flex-col items-center justify-center">
            {/* Framed Graphic Frame */}
            <div
              ref={frameTilt}
              className="relative w-full max-w-[380px] sm:max-w-[420px] rounded-2xl overflow-hidden transition-transform duration-300"
              style={{
                background: 'var(--bg-base)',
                border: '1px solid var(--card-border)',
                boxShadow: '0 20px 40px -15px rgba(0,0,0,0.1), 0 0 0 1px var(--card-border)',
                aspectRatio: '768 / 1376',
              }}
            >
              <LoopVideo ref={videoRef} src={current.video} className="w-full h-full object-cover pointer-events-none select-none" />
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
