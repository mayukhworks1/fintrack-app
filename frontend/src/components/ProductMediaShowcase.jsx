import { useState, useRef, useEffect } from 'react'
import {
  Sparkles, Play, Pause, Maximize2, Layers,
  Receipt, FolderKanban, ShieldCheck, Check, X,
  ArrowRight, Activity
} from 'lucide-react'
import { useTilt } from '../hooks/useTilt'

const SHOWCASE_ITEMS = [
  {
    id: 'tax-ledger',
    label: 'Tax Ledger & AI Insights',
    tag: '3D Architecture',
    icon: Receipt,
    title: 'Single-ledger architecture for delivery & tax compliance',
    desc: 'Binds milestone delivery status directly to GST, TDS, and invoice aging. Eliminates end-of-month reconciliation discrepancies between project managers and accounting.',
    image: '/media/pomelli_photoshoot-1.png',
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
    image: '/media/pomelli_photoshoot-2.png',
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
    image: '/media/pomelli_photoshoot-3.png',
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
    image: '/media/pomelli_photoshoot-4.png',
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
  const [viewType, setViewType] = useState('image') // 'image' | 'video'
  const [isPlaying, setIsPlaying] = useState(true)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const videoRef = useRef(null)
  const frameTilt = useTilt({ max: 4 })

  const current = SHOWCASE_ITEMS[activeIdx]

  useEffect(() => {
    setViewType('image')
    if (videoRef.current) {
      videoRef.current.currentTime = 0
      videoRef.current.play().catch(() => {})
      setIsPlaying(true)
    }
  }, [activeIdx])

  const togglePlay = () => {
    if (!videoRef.current) return
    if (isPlaying) {
      videoRef.current.pause()
      setIsPlaying(false)
    } else {
      videoRef.current.play().catch(() => {})
      setIsPlaying(true)
    }
  }

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
                  Click the 3D preview on the right to inspect high-definition details.
                </div>
              </div>
            </div>
          </div>

          {/* ── Right Column: Clean 3D Framed Device / Visualizer ─────── */}
          <div className="lg:col-span-6 flex flex-col items-center justify-center">
            {/* View Switcher Controls */}
            <div className="w-full flex items-center justify-between gap-2 mb-3 px-1">
              <div className="inline-flex p-1 rounded-xl"
                   style={{ background: 'var(--bg-input)', border: '1px solid var(--card-border)' }}>
                <button
                  onClick={() => setViewType('image')}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all"
                  style={{
                    background: viewType === 'image' ? 'var(--card-bg)' : 'transparent',
                    color: viewType === 'image' ? 'var(--accent)' : 'var(--text-3)',
                    boxShadow: viewType === 'image' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
                  }}
                >
                  <Layers size={13} />
                  3D Blueprint
                </button>
                <button
                  onClick={() => setViewType('video')}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all"
                  style={{
                    background: viewType === 'video' ? 'var(--card-bg)' : 'transparent',
                    color: viewType === 'video' ? 'var(--accent)' : 'var(--text-3)',
                    boxShadow: viewType === 'video' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
                  }}
                >
                  <Play size={13} />
                  Motion Loop
                </button>
              </div>

              <button
                onClick={() => setLightboxOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all hover:border-[var(--accent)]"
                style={{
                  background: 'var(--bg-input)',
                  border: '1px solid var(--card-border)',
                  color: 'var(--text-2)',
                }}
              >
                <Maximize2 size={13} />
                <span>Fullscreen</span>
              </button>
            </div>

            {/* Framed Graphic Frame */}
            <div
              ref={frameTilt}
              className="relative w-full max-w-[380px] sm:max-w-[420px] rounded-2xl overflow-hidden cursor-pointer transition-transform duration-300 hover:scale-[1.01]"
              style={{
                background: 'var(--bg-base)',
                border: '1px solid var(--card-border)',
                boxShadow: '0 20px 40px -15px rgba(0,0,0,0.1), 0 0 0 1px var(--card-border)',
                aspectRatio: '768 / 1376',
              }}
              onClick={() => viewType === 'image' && setLightboxOpen(true)}
            >
              {viewType === 'image' ? (
                <div className="relative w-full h-full flex items-center justify-center">
                  <img
                    src={current.image}
                    alt={current.title}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-900/30 via-transparent to-transparent opacity-0 hover:opacity-100 transition-opacity flex items-end justify-center pb-4">
                    <span className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/90 text-slate-900 shadow-md backdrop-blur">
                      Click to inspect full resolution
                    </span>
                  </div>
                </div>
              ) : (
                <div className="relative w-full h-full bg-slate-950 flex items-center justify-center">
                  <video
                    ref={videoRef}
                    src={current.video}
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={(e) => { e.stopPropagation(); togglePlay() }}
                    className="absolute bottom-4 right-4 flex items-center justify-center w-8 h-8 rounded-full bg-slate-900/90 text-white border border-slate-700 shadow-md backdrop-blur transition-all"
                    aria-label="Toggle motion video"
                  >
                    {isPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
                  </button>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* ── High-Res Lightbox Modal ─────────────────────────────────── */}
      {lightboxOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/85 backdrop-blur-md"
          onClick={() => setLightboxOpen(false)}
        >
          <div
            className="relative max-w-4xl w-full max-h-[92vh] flex flex-col rounded-2xl overflow-hidden bg-slate-900 border border-slate-700 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-slate-950">
              <span className="text-xs font-bold text-slate-200">
                {current.label} — 3D High-Fidelity Blueprint
              </span>
              <button
                onClick={() => setLightboxOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
                aria-label="Close lightbox"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 overflow-auto flex items-center justify-center bg-slate-950/40">
              <img
                src={current.image}
                alt={current.title}
                className="max-h-[80vh] w-auto object-contain rounded-lg shadow-2xl"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
